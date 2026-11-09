import { roomJson, broadcastViews, removeSocket, runSocketMutation } from '../platform/transport.js';
import { commitRoom, RoomCommitError, reconnectClients } from '../platform/persistence.js';
import type { FishyAction } from '../../../shared/soundsFishy.js';
import type { Env } from '../env.js';
import { generateShortId, generateToken, normalizeNickname } from '../utils.js';
import { trackUsageEvent } from '../usageMonitor.js';
import {
  applyAction,
  createState,
  expireState,
  GameError,
  serializeForPlayer,
  type FishyState,
  type StoredPlayer,
  playerDisconnected,
} from './engine.js';

// Reuse the existing Durable Object namespace and room-code registry.
export class SoundsFishyRoom {
  private state: FishyState | null = null;
  private loaded = false;
  private clients = new Map<string, Set<WebSocket>>();
  constructor(
    private ctx: DurableObjectState,
    private env: Env,
  ) {}

  async exists(): Promise<boolean> {
    if (!this.loaded) {
      this.state =
        (await this.ctx.storage.get<FishyState>('sounds-fishy')) ?? null;
      // Connections from a previous isolate are gone; tokens and gameplay survive.
      if (this.state) {
        for (const player of Object.values(this.state.players))
          { player.connected = false; player.disconnectedAt ??= Date.now(); }
      }
      this.loaded = true;
    }
    return this.state !== null;
  }
  private invalidate() {
    this.state = null; this.loaded = false;
    reconnectClients(this.clients);
  }
  private json = roomJson;

  private track(
    type: 'GAME_CREATED' | 'GAME_STATE_CHANGED' | 'GAME_ENDED',
  ): void {
    const s = this.state!;
    this.ctx.waitUntil(
      trackUsageEvent(this.env, {
        type,
        gameId: s.gameId,
        phase:
          s.phase === 'LOBBY'
            ? 'LOBBY'
            : s.phase === 'COMPLETED'
              ? 'ENDED'
              : 'ACTIVE',
        connectedPlayers: Object.values(s.players).filter((p) => p.connected)
          .length,
      }).catch(() => undefined),
    );
  }
  private async save(s: FishyState = this.state!): Promise<void> {
    await commitRoom(this.ctx.storage, 'sounds-fishy', s, s.phase === 'COMPLETED' ? null : Math.max(Date.now() + 1, Math.min(s.expiresAt, s.deadline ?? Infinity)));
  }
  private broadcast() {
    broadcastViews(this.clients, id => serializeForPlayer(this.state!, id));
  }

  private async expire(): Promise<void> {
    if (this.state && expireState(this.state)) {
      this.state.version++;
      await this.save();
      this.broadcast();
      this.track(
        this.state.phase === 'COMPLETED' ? 'GAME_ENDED' : 'GAME_STATE_CHANGED',
      );
    }
  }
  async alarm(): Promise<void> {
    await this.ctx.blockConcurrencyWhile(async () => {
      try {
        if (await this.exists()) {
          await this.expire();
          await this.save();
        }
      } catch (error) {
        if (error instanceof RoomCommitError) this.invalidate();
        throw error;
      }
    });
  }
  async fetch(request: Request): Promise<Response> {
    return this.ctx.blockConcurrencyWhile(async () => {
      try {
        return await this.handle(request);
      } catch (error) {
        if (error instanceof RoomCommitError) {
          this.invalidate();
          return this.json(request, { error: 'ROOM_COMMIT_UNCERTAIN', message: error.message, retryable: true }, 503);
        }
        return this.json(
          request,
          {
            error:
              error instanceof GameError
                ? 'GAME_ACTION_FAILED'
                : 'INVALID_REQUEST',
            message: error instanceof Error ? error.message : 'Invalid request',
          },
          error instanceof GameError ? error.status : 400,
        );
      }
    });
  }
  private async handle(request: Request): Promise<Response> {
    await this.exists();
    const url = new URL(request.url);
    if (url.pathname === '/api/internal/create') {
      if (this.state || (await this.ctx.storage.get('state')) || (await this.ctx.storage.get('just-one')))
        return this.json(request, { error: 'CODE_IN_USE' }, 409);
      const p = (await request.json()) as Record<string, unknown>;
      const nickname = normalizeNickname(String(p.hostNickname ?? ''));
      if (!nickname) throw new GameError('Enter a nickname');
      const host: StoredPlayer = {
        playerId: generateShortId(8),
        nickname,
        role: 'HOST',
        connected: false,
        disconnectedAt: Date.now(),
        participating: true,
        pending: false,
        token: generateToken(48),
      };
      this.state = createState(
        String(p.gameId),
        host,
        generateToken(56),
        p.settings,
      );
      await this.save();
      this.track('GAME_CREATED');
      return this.json(request, {
        gameType: 'sounds-fishy',
        gameId: this.state.gameId,
        hostToken: this.state.hostToken,
        playerId: host.playerId,
        playerToken: host.token,
        role: 'HOST',
        joinPath: `/g/${this.state.gameId}`,
      });
    }
    if (!this.state)
      return this.json(
        request,
        { error: 'NOT_FOUND', message: 'Lobby not found' },
        404,
      );
    await this.expire();
    const s = this.state;
    const match = url.pathname.match(/^\/api\/game\/([^/]+)\/([^/]+)$/);
    if (!match || match[1] !== s.gameId)
      return this.json(request, { error: 'NOT_FOUND' }, 404);
    const route = match[2];
    if (route === 'info' && request.method === 'GET')
      return this.json(request, { gameType: 'sounds-fishy', phase: s.phase });
    if (route === 'join' && request.method === 'POST') {
      if (s.order.length >= 10) throw new GameError('Lobby is full', 409);
      const p = (await request.json()) as { nickname?: string };
      const nickname = normalizeNickname(String(p.nickname ?? ''));
      if (!nickname) throw new GameError('Enter a nickname');
      if (Object.values(s.players).some(player => player.nickname.toLocaleLowerCase() === nickname.toLocaleLowerCase()))
        throw new GameError('That nickname is already in use');
      const player: StoredPlayer = {
        playerId: generateShortId(8),
        nickname,
        role: 'PLAYER',
        connected: false,
        disconnectedAt: Date.now(),
        participating: s.phase === 'LOBBY',
        pending: s.phase !== 'LOBBY',
        token: generateToken(48),
      };
      s.players[player.playerId] = player;
      s.order.push(player.playerId);
      s.scores[player.playerId] = 0;
      s.version++;
      s.expiresAt = Date.now() + (s.phase === 'LOBBY' ? 30 : 120) * 60_000;
      await this.save();
      this.broadcast();
      return this.json(request, {
        playerId: player.playerId,
        playerToken: player.token,
        role: 'PLAYER',
        status: player.pending ? 'PENDING' : 'ACTIVE',
        gameType: 'sounds-fishy',
      });
    }
    const token =
      request.headers.get('Authorization')?.replace(/^Bearer /, '') ??
      url.searchParams.get('token');
    const player = Object.values(s.players).find((p) => p.token === token);
    const display = token === s.displayToken;
    if (!player && !display) throw new GameError('Your session is missing or expired', 401);
    const viewerId = player?.playerId ?? '$display';
    if (route === 'state' && request.method === 'GET') {
      if (Number(url.searchParams.get('sinceVersion')) >= s.version)
        return this.json(request, null, 204);
      return this.json(request, serializeForPlayer(s, viewerId));
    }
    if (route === 'action' && request.method === 'POST') {
      // Consume the forwarded body before returning an early display rejection.
      const action = (await request.json()) as FishyAction;
      if (!player) throw new GameError('The shared display is read-only', 403);
      // Copy first: invalid commands cannot partially change the authoritative state.
      const next = structuredClone(s);
      applyAction(next, player.playerId, action);
      await this.save(next);
      this.state = next;
      this.broadcast();
      if (s.phase !== next.phase)
        this.track(
          next.phase === 'COMPLETED' ? 'GAME_ENDED' : 'GAME_STATE_CHANGED',
        );
      return this.json(request, { success: true, version: next.version });
    }
    if (
      route === 'ws' &&
      request.headers.get('Upgrade')?.toLowerCase() === 'websocket'
    ) {
      const [client, server] = Object.values(new WebSocketPair());
      server.accept();
      const sockets = this.clients.get(viewerId) ?? new Set<WebSocket>();
      // Bound sockets per identity while permitting a refreshed tab to replace its old socket.
      if (sockets.size >= 3) {
        const old = sockets.values().next().value;
        old?.close(1000, 'Replaced');
        sockets.delete(old!);
      }
      sockets.add(server);
      this.clients.set(viewerId, sockets);
      if (player) { player.connected = true; player.disconnectedAt = null; }
      s.version++;
      const close = () => {
        runSocketMutation(this.ctx, async () => {
          if (!removeSocket(this.clients, viewerId, sockets, server)) return;
          const live = this.state?.players[viewerId];
          if (!live) return;
          if (live.connected === (sockets.size > 0)) return;
          if (sockets.size === 0) playerDisconnected(this.state!, viewerId);
          else { live.connected = true; live.disconnectedAt = null; }
          this.state!.version++;
          await this.save();
          this.broadcast();
          this.track('GAME_STATE_CHANGED');
        }, () => this.invalidate());
      };
      server.addEventListener('close', close);
      server.addEventListener('error', close);
      server.addEventListener('message', (event) => {
        if (event.data === '{"type":"PING"}')
          try {
            server.send('{"type":"PONG"}');
          } catch {
            close();
          }
      });
      await this.save();
      this.broadcast();
      this.track('GAME_STATE_CHANGED');
      return new Response(null, { status: 101, webSocket: client });
    }
    return this.json(request, { error: 'NOT_FOUND' }, 404);
  }
}
