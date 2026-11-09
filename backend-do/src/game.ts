import { isGameType } from '../../shared/games.js';
import type { Env } from './env.js';
import { createAdapters, ROOM_PRECEDENCE, type RoomAdapter } from './registration.js';
import { SerialExecutor } from './platform/execution.js';
export type { Env } from './env.js';
export type { Phase, PlayerStatus, PlayerRole, GameEndReason, InactivityKind } from './top10/room.js';

/** Stable Cloudflare class. Ownership is resolved before invoking any creation path. */
export class GameDurableObject {
  private readonly rooms;
  private readonly execution = new SerialExecutor();
  private owner: Promise<RoomAdapter | null> | undefined;
  constructor(ctx: DurableObjectState, env: Env) { this.rooms = createAdapters(ctx, env); }

  private resolveOwner(): Promise<RoomAdapter | null> {
    this.owner ??= (async () => {
      for (const id of ROOM_PRECEDENCE) if (await this.rooms[id].exists()) return this.rooms[id];
      return null;
    })().catch(error => { this.owner = undefined; throw error; });
    return this.owner;
  }

  fetch(request: Request): Promise<Response> {
    return this.execution.run(async () => {
      if (request.method === 'OPTIONS') return this.rooms.top10.fetch(request);
      const owner = await this.resolveOwner();
      if (new URL(request.url).pathname === '/api/internal/create') {
        if (owner) return new Response(JSON.stringify({ error: 'CODE_IN_USE' }), {
          status: 409, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'Access-Control-Allow-Origin': request.headers.get('Origin') ?? '*' },
        });
        const payload = await request.clone().json() as Record<string, unknown>;
        const room = this.rooms[isGameType(payload.gameType) ? payload.gameType : 'top10'];
        const response = await room.fetch(request);
        if (await room.exists()) this.owner = Promise.resolve(room);
        return response;
      }
      return (owner ?? this.rooms.top10).fetch(request);
    });
  }

  alarm(): Promise<void> {
    return this.execution.run(async () => { await (await this.resolveOwner() ?? this.rooms.top10).alarm(); });
  }
}
