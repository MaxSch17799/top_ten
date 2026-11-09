import test from 'node:test';
import assert from 'node:assert/strict';
import { CommandSender } from '../frontend/src/lib/commandSender.js';
import { ApiError } from '../frontend/src/lib/http.js';

const action = { id: 'same-id', generation: 3, revision: 7, payload: { position: 2 } };
test('uncertain retry retains the submitted decision and rejects concurrent submissions', async () => {
  const sender = new CommandSender<typeof action>();
  const sent: typeof action[] = [], retries: (typeof action | null)[] = [];
  let release!: () => void, refreshed = 0, settled = 0;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const operations = {
    execute: async (value: typeof action) => { sent.push(value); await gate; throw new ApiError('uncertain', 'ROOM_COMMIT_UNCERTAIN', { retryable: true }, 503); },
    refresh: async () => { refreshed++; }, start() {}, settled: () => { settled++; },
    failed: (_error: unknown, pending: typeof action | null) => { retries.push(pending); },
  };
  const original = structuredClone(action), pending = sender.send(original, operations);
  original.payload.position = 9;
  assert.equal(await sender.send(action, operations), false);
  release(); assert.equal(await pending, false);
  assert.deepEqual(retries, [action]); assert.equal(refreshed, 1); assert.equal(settled, 1);
  assert.equal(await sender.send(retries[0]!, { ...operations, execute: async value => { sent.push(value); } }), true);
  assert.deepEqual(sent, [action, action]);
});
test('illegal moves and failed readbacks never offer to replay a confirmed command', async () => {
  for (const failure of ['illegal', 'afterCommit', 'refresh']) {
    const sender = new CommandSender<typeof action>(), retries: unknown[] = [];
    await sender.send(action, {
      execute: async () => { if (failure === 'illegal') throw new ApiError('illegal', 'INVALID', {}, 400); },
      afterCommit: async () => { if (failure === 'afterCommit') throw new Error('read failed'); },
      refresh: async () => { if (failure === 'refresh') throw new Error('refresh failed'); },
      start() {}, settled() {}, failed: (_error, retry) => { retries.push(retry); },
    });
    assert.deepEqual(retries, [null], failure);
  }
});
