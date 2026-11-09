import type { Env } from '../../backend-do/src/game.js';

/** Serialization and invocation double, not an emulator of Cloudflare I/O gates. */
export class DurableHarness {
  private values = new Map<string, unknown>();
  private queue: Promise<unknown> = Promise.resolve();
  private tasks: Promise<unknown>[] = [];
  readonly reads: string[] = [];
  readonly writes: string[] = [];
  alarm: number | null = null;
  failNext: 'put' | 'setAlarm' | 'deleteAlarm' | null = null;

  constructor(initial: Record<string, unknown> = {}) {
    for (const [key, value] of Object.entries(initial)) this.values.set(key, structuredClone(value));
  }
  snapshot(): Record<string, unknown> {
    return structuredClone(Object.fromEntries(this.values));
  }
  private check(operation: NonNullable<DurableHarness['failNext']>) {
    if (this.failNext === operation) {
      this.failNext = null;
      throw new Error(`Injected ${operation} failure`);
    }
  }
  readonly ctx = {
    storage: {
      get: async (key: string) => {
        this.reads.push(key);
        return structuredClone(this.values.get(key));
      },
      put: async (key: string, value: unknown) => {
        this.check('put');
        this.values.set(key, structuredClone(value));
        this.writes.push(key);
      },
      setAlarm: async (at: number | Date) => { this.check('setAlarm'); this.alarm = Number(at); },
      deleteAlarm: async () => { this.check('deleteAlarm'); this.alarm = null; },
    },
    blockConcurrencyWhile: <T>(fn: () => Promise<T>): Promise<T> => {
      const next = this.queue.then(fn);
      this.queue = next.catch(() => undefined);
      return next;
    },
    waitUntil: (task: Promise<unknown>) => { this.tasks.push(task); },
  } as unknown as DurableObjectState;
  readonly env = {} as Env;
  async drain() {
    await this.queue;
    while (this.tasks.length) await Promise.all(this.tasks.splice(0));
  }
}

export function roomRequest(gameId: string, route: string, token?: string, body?: unknown) {
  return new Request(`https://local.test/api/game/${gameId}/${route}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

export function createRequest(gameType?: string, settings?: unknown) {
  return new Request('https://local.test/api/internal/create', {
    method: 'POST', body: JSON.stringify({ gameId: '1234', hostNickname: 'Fixture Host', ...(gameType ? { gameType } : {}), ...(settings ? { settings } : {}) }),
  });
}
