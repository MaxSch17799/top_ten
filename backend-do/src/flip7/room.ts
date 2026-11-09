import { roomJson, broadcastViews, runSocketMutation, addSocket } from '../platform/transport.js';
import { commitRoom, RoomCommitError, reconnectClients } from '../platform/persistence.js';
import type { FlipAction } from "../../../shared/flip7.js";
import type { Env } from "../env.js";
import { generateShortId, generateToken, normalizeNickname } from "../utils.js";
import { trackUsageEvent } from "../usageMonitor.js";
import {
  applyAction,
  createState,
  expireState,
  GameError,
  serializeForPlayer,
  nextDeadline,
  type StoredPlayer,
  type FlipState,
} from "./engine.js";

/** Transport adapter only. Secrets stay in this server-side, persisted room value. */
export class Flip7Room {
  private state: FlipState | null = null;
  private loaded = false;
  private clients = new Map<string, Set<WebSocket>>();
  constructor(
    private ctx: DurableObjectState,
    private env: Env,
  ) {}
  async exists(): Promise<boolean> {
    if (!this.loaded) {
      this.state =
        (await this.ctx.storage.get<FlipState>("flip7")) ?? null;
      if (this.state)
        for (const p of Object.values(this.state.players)) {
          p.connected = false;
          p.disconnectedAt ??= Date.now();
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

  private async save(s: FlipState = this.state!): Promise<void> {
    await commitRoom(this.ctx.storage, 'flip7', s, s.phase === 'COMPLETED' ? null : Math.max(Date.now() + 1, nextDeadline(s)));
  }
  private track(type: "GAME_CREATED" | "GAME_STATE_CHANGED" | "GAME_ENDED") {
    const s = this.state!;
    this.ctx.waitUntil(
      trackUsageEvent(this.env, {
        type,
        gameId: s.gameId,
        phase:
          s.phase === "LOBBY"
            ? "LOBBY"
            : s.phase === "COMPLETED"
              ? "ENDED"
              : "ACTIVE",
        connectedPlayers: Object.values(s.players).filter((p) => p.connected)
          .length,
      }).catch(() => undefined),
    );
  }
  private broadcast() {
    broadcastViews(this.clients, id => serializeForPlayer(this.state!, id), id => id === '$display' || !!this.state!.players[id]);
  }

  private async expire() {
    if (this.state) {
      const next = structuredClone(this.state);
      if (expireState(next)) {
        await this.save(next);
        this.state = next;
        this.broadcast();
        this.track(
          next.phase === "COMPLETED" ? "GAME_ENDED" : "GAME_STATE_CHANGED",
        );
      }
    }
  }
  async alarm() {
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
      } catch (e) {
        if (e instanceof RoomCommitError) {
          this.invalidate();
          return this.json(request, { error: 'ROOM_COMMIT_UNCERTAIN', message: e.message, retryable: true }, 503);
        }
        return this.json(
          request,
          {
            error: "FLIP7_ACTION_FAILED",
            message: e instanceof Error ? e.message : "Invalid request",
          },
          e instanceof GameError ? e.status : 400,
        );
      }
    });
  }
  private async handle(request: Request): Promise<Response> {
    await this.exists();
    const url = new URL(request.url);
    if (url.pathname === "/api/internal/create" && request.method === "POST") {
      if (
        this.state ||
        (await this.ctx.storage.get("state")) ||
        (await this.ctx.storage.get("just-one")) ||
        (await this.ctx.storage.get("sounds-fishy")) ||
        (await this.ctx.storage.get("wavelength")) ||
        (await this.ctx.storage.get("uno")) || (await this.ctx.storage.get("monopoly-deal"))
      )
        return this.json(request, { error: "CODE_IN_USE" }, 409);
      const p = (await request.json()) as Record<string, unknown>,
        nickname = normalizeNickname(String(p.hostNickname ?? ""));
      if (!nickname) throw new GameError("Enter a nickname");
      const host: StoredPlayer = {
        playerId: generateShortId(8),
        nickname,
        role: "HOST",
        connected: false,
        disconnectedAt: Date.now(),
        token: generateToken(48),
      };
      const next = createState(
        String(p.gameId),
        host,
        generateToken(56),
        p.settings ?? {},
      );
      await this.save(next);
      this.state = next;
      this.track("GAME_CREATED");
      return this.json(request, {
        gameType: "flip7",
        gameId: next.gameId,
        hostToken: host.token,
        playerId: host.playerId,
        playerToken: host.token,
        role: "HOST",
        joinPath: `/g/${next.gameId}`,
      });
    }
    if (!this.state)
      return this.json(
        request,
        { error: "NOT_FOUND", message: "Lobby not found" },
        404,
      );
    await this.expire();
    const s = this.state!,
      match = url.pathname.match(/^\/api\/game\/([^/]+)\/([^/]+)$/);
    if (!match || match[1] !== s.gameId)
      return this.json(request, { error: "NOT_FOUND" }, 404);
    const route = match[2];
    if (route === "info" && request.method === "GET")
      return this.json(request, { gameType: "flip7", phase: s.phase });
    if (route === "join" && request.method === "POST") {
      const p = (await request.json()) as Record<string, unknown>;
      if (s.phase !== "LOBBY")
        throw new GameError(
          "This game has started. Reconnect on your original browser, or wait for the host to return to the lobby.",
          409,
        );
      if (s.order.length >= 12)
        throw new GameError("The lobby is full (12 players)", 409);
      const nickname = normalizeNickname(String(p.nickname ?? ""));
      if (!nickname) throw new GameError("Enter a nickname");
      if (
        Object.values(s.players).some(
          (v) => v.nickname.toLowerCase() === nickname.toLowerCase(),
        )
      )
        throw new GameError("That nickname is already in use");
      const next = structuredClone(s),
        player: StoredPlayer = {
          playerId: generateShortId(8),
          nickname,
          role: "PLAYER",
          token: generateToken(48),
          connected: false,
          disconnectedAt: Date.now(),
        };
      next.players[player.playerId] = player;
      next.order.push(player.playerId);
      next.version++;
      next.revision++;
      next.expiresAt = Date.now() + 30 * 60_000;
      await this.save(next);
      this.state = next;
      this.broadcast();
      return this.json(request, {
        gameType: "flip7",
        playerId: player.playerId,
        playerToken: player.token,
        role: "PLAYER",
        status: "ACTIVE",
      });
    }
    const token =
      request.headers.get("Authorization")?.replace(/^Bearer /, "") ??
      url.searchParams.get("token");
    const player = Object.values(s.players).find((p) => p.token === token),
      display = token === s.displayToken;
    if (!player && !display)
      throw new GameError("Your session is missing or expired", 401);
    const id = player?.playerId ?? "$display";
    if (route === "state" && request.method === "GET")
      return Number(url.searchParams.get("sinceVersion")) >= s.version
        ? this.json(request, null, 204)
        : this.json(request, serializeForPlayer(s, id));
    if (route === "action" && request.method === "POST") {
      const action = (await request.json()) as FlipAction;
      if (!player) throw new GameError("The shared display is read-only", 403);
      const next = structuredClone(s);
      applyAction(next, player.playerId, action);
      await this.save(next);
      this.state = next;
      this.broadcast();
      if (s.phase !== next.phase)
        this.track(
          next.phase === "COMPLETED" ? "GAME_ENDED" : "GAME_STATE_CHANGED",
        );
      return this.json(request, { success: true, version: next.version });
    }
    if (
      route === "ws" &&
      request.headers.get("Upgrade")?.toLowerCase() === "websocket"
    ) {
      const [client, server] = Object.values(new WebSocketPair());
      server.accept();
      const sockets = addSocket(this.clients, id, server);
      if (player) {
        player.connected = true;
        player.disconnectedAt = null;
      }
      s.version++;
      let closed = false;
      const close = () => {
        if (closed) return;
        closed = true;
        runSocketMutation(this.ctx, async () => {
          sockets.delete(server);
          const live = this.state?.players[id];
          if (!live || live.connected === (sockets.size > 0)) return;
          live.connected = sockets.size > 0;
          live.disconnectedAt = live.connected ? null : Date.now();
          this.state!.version++;
          await this.save();
          this.broadcast();
        }, () => this.invalidate());
      };
      server.addEventListener("close", close);
      server.addEventListener("error", close);
      server.addEventListener("message", (e) => {
        if (e.data === '{"type":"PING"}') {
          try {
            server.send('{"type":"PONG"}');
          } catch {
            close();
          }
        }
      });
      await this.save();
      this.broadcast();
      return new Response(null, { status: 101, webSocket: client });
    }
    return this.json(request, { error: "NOT_FOUND" }, 404);
  }
}
