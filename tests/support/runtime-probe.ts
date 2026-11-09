/** Test-only Worker: never imported by the production entry point. */
import { GameDurableObject } from '../../backend-do/src/game.js';

export class RuntimeProbe {
  private fail: string | null = null;
  private room: GameDurableObject;
  constructor(private ctx: DurableObjectState) { this.room = this.makeRoom(); }
  private wrap<T extends object>(storage: T): T {
    return new Proxy(storage, { get: (target, key) => {
      const value = Reflect.get(target, key, target);
      if (key === 'transaction') return async (callback: (tx: unknown) => unknown) => {
        const result = await value.call(target, (tx: object) => callback(this.wrap(tx)));
        if (this.fail === 'afterCommit') { this.fail = null; throw new Error('Injected lost commit acknowledgement'); }
        return result;
      };
      if (typeof value !== 'function') return value;
      return (...args: unknown[]) => {
        if (this.fail === key) { this.fail = null; throw new Error(`Injected ${String(key)} failure`); }
        return value.apply(target, args);
      };
    } });
  }
  private makeRoom() {
    const context = {
      storage: this.wrap(this.ctx.storage),
      blockConcurrencyWhile: this.ctx.blockConcurrencyWhile.bind(this.ctx),
      waitUntil: this.ctx.waitUntil.bind(this.ctx),
    };
    return new GameDurableObject(context as DurableObjectState, {} as never);
  }
  async fetch(request: Request): Promise<Response> {
    const path = new URL(request.url).pathname;
    if (path === '/seed') {
      const { key, state } = await request.json() as { key: string; state: unknown };
      await this.ctx.storage.deleteAll(); await this.ctx.storage.deleteAlarm();
      await this.ctx.storage.put(key, state); this.room = this.makeRoom();
      return Response.json({ ok: true });
    }
    if (path === '/fault') { this.fail = (await request.json() as { operation: string }).operation; return Response.json({ ok: true }); }
    if (path === '/inspect') {
      return Response.json({ values: Object.fromEntries(await this.ctx.storage.list()), alarm: await this.ctx.storage.getAlarm() });
    }
    if (path === '/reload') { this.room = this.makeRoom(); return Response.json({ ok: true }); }
    return this.room.fetch(request);
  }
  async alarm() {
    await this.ctx.storage.put('probe-alarm-runs', (await this.ctx.storage.get<number>('probe-alarm-runs') ?? 0) + 1);
    return this.room.alarm();
  }
}
export default { fetch(request: Request, env: { ROOMS: DurableObjectNamespace }) { return env.ROOMS.get(env.ROOMS.idFromName(request.headers.get('X-Probe-Room') ?? 'probe')).fetch(request); } };
