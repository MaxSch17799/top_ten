import type { JustOneAction } from '../../../shared/justOne.js';
import type { Env } from '../game.js';
import { generateShortId, generateToken, normalizeNickname } from '../utils.js';
import { trackUsageEvent } from '../usageMonitor.js';
import {
  applyAction,
  createState,
  expireState,
  GameError,
  serializeForPlayer,
  type JustOneState,
  type StoredPlayer,
} from './engine.js';

// The existing Durable Object namespace remains the registry for both games.
export class JustOneRoom {
  private state: JustOneState | null = null;
  private loaded = false;
  private clients = new Map<string, Set<WebSocket>>();
  constructor(
    private ctx: DurableObjectState,
    private env: Env,
  ) {}

  async exists(): Promise<boolean> {
    if (!this.loaded) {
      this.state =
        (await this.ctx.storage.get<JustOneState>('just-one')) ?? null;
      // Connections from a previous isolate are gone; tokens and gameplay survive.
      if (this.state)
        for (const player of Object.values(this.state.players))
          player.connected = false;
      this.loaded = true;
    }
    return this.state !== null;
  }
  private json(request: Request, data: unknown, status = 200): Response {
    return new Response(data === null ? null : JSON.stringify(data), {
      status,
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-store',
        'Access-Control-Allow-Origin': request.headers.get('Origin') ?? '*',
        'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
        'Access-Control-Allow-Headers':
          'Content-Type,Authorization,X-Player-Token,X-Host-Token',
      },
    });
  }
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
  private async save(): Promise<void> {
    const s = this.state!;
    await this.ctx.storage.put('just-one', s);
    if (s.phase === 'COMPLETED') await this.ctx.storage.deleteAlarm();
    else
      await this.ctx.storage.setAlarm(
        Math.max(Date.now() + 1, Math.min(s.expiresAt, s.deadline ?? Infinity)),
      );
  }
  private broadcast(): void {
    for (const [id, sockets] of this.clients) {
      const data = JSON.stringify({
        type: 'STATE',
        payload: serializeForPlayer(this.state!, id),
      });
      for (const socket of sockets) {
        try {
          socket.send(data);
        } catch {
          try {
            socket.close();
          } catch {
            /* close event normally updates presence */
          }
        }
      }
    }
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
      if (await this.exists()) {
        await this.expire();
        await this.save();
      }
    });
  }
  async fetch(request: Request): Promise<Response> {
    return this.ctx.blockConcurrencyWhile(async () => {
      try {
        return await this.handle(request);
      } catch (error) {
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
      if (this.state || (await this.ctx.storage.get('state')))
        return this.json(request, { error: 'CODE_IN_USE' }, 409);
      const p = (await request.json()) as Record<string, unknown>;
      const nickname = normalizeNickname(String(p.hostNickname ?? ''));
      if (!nickname) throw new GameError('Enter a nickname');
      const host: StoredPlayer = {
        playerId: generateShortId(8),
        nickname,
        role: 'HOST',
        connected: false,
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
        gameType: 'just-one',
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
    const s = this.state;
    const match = url.pathname.match(/^\/api\/game\/([^/]+)\/([^/]+)$/);
    if (!match || match[1] !== s.gameId)
      return this.json(request, { error: 'NOT_FOUND' }, 404);
    const route = match[2];
    await this.expire();
    if (route === 'info' && request.method === 'GET')
      return this.json(request, { gameType: 'just-one', phase: s.phase });
    if (route === 'join' && request.method === 'POST') {
      if (s.phase === 'COMPLETED')
        throw new GameError('The game has finished. Ask the host to restart.');
      if (s.order.length >= 10) throw new GameError('Lobby is full', 409);
      const p = (await request.json()) as { nickname?: string };
      const nickname = normalizeNickname(String(p.nickname ?? ''));
      if (!nickname) throw new GameError('Enter a nickname');
      const player: StoredPlayer = {
        playerId: generateShortId(8),
        nickname,
        role: 'PLAYER',
        connected: false,
        participating: true,
        pending: s.phase !== 'LOBBY',
        token: generateToken(48),
      };
      s.players[player.playerId] = player;
      s.order.push(player.playerId);
      s.version++;
      s.expiresAt = Date.now() + (s.phase === 'LOBBY' ? 30 : 120) * 60_000;
      await this.save();
      this.broadcast();
      return this.json(request, {
        playerId: player.playerId,
        playerToken: player.token,
        role: 'PLAYER',
        status: player.pending ? 'PENDING' : 'ACTIVE',
        gameType: 'just-one',
      });
    }
    const token =
      request.headers.get('Authorization')?.replace(/^Bearer /, '') ??
      url.searchParams.get('token');
    const player = Object.values(s.players).find((p) => p.token === token);
    if (!player) throw new GameError('Your session is missing or expired', 401);
    if (route === 'state' && request.method === 'GET') {
      if (Number(url.searchParams.get('sinceVersion')) >= s.version)
        return this.json(request, null, 204);
      return this.json(request, serializeForPlayer(s, player.playerId));
    }
    if (route === 'action' && request.method === 'POST') {
      const action = (await request.json()) as JustOneAction;
      // Copy first: invalid commands cannot partially change the authoritative state.
      const next = structuredClone(s);
      applyAction(next, player.playerId, action);
      this.state = next;
      await this.save();
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
      const sockets = this.clients.get(player.playerId) ?? new Set<WebSocket>();
      // Bound sockets per identity while permitting a refreshed tab to replace its old socket.
      if (sockets.size >= 3) {
        const old = sockets.values().next().value;
        old?.close(1000, 'Replaced');
        sockets.delete(old!);
      }
      sockets.add(server);
      this.clients.set(player.playerId, sockets);
      player.connected = true;
      s.version++;
      const close = () => {
        void this.ctx.blockConcurrencyWhile(async () => {
          sockets.delete(server);
          const live = this.state!.players[player.playerId];
          if (live.connected === sockets.size > 0) return;
          live.connected = sockets.size > 0;
          this.state!.version++;
          await this.save();
          this.broadcast();
          this.track('GAME_STATE_CHANGED');
        });
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
