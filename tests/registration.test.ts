import test from 'node:test';
import assert from 'node:assert/strict';
import { GAME_TYPES } from '../shared/games.js';
import { GameDurableObject } from '../backend-do/src/game.js';
import { registrations, ROOM_PRECEDENCE } from '../backend-do/src/registration.js';
import { SerialExecutor } from '../backend-do/src/platform/execution.js';
import { DurableHarness, createRequest, roomRequest } from './support/durable-harness.js';

test('registrations cover every game once, with unique storage keys and legacy precedence', () => {
  assert.deepEqual(Object.keys(registrations).sort(), [...GAME_TYPES].sort());
  assert.equal(new Set(Object.values(registrations).map(r => r.storageKey)).size, GAME_TYPES.length);
  assert.deepEqual(ROOM_PRECEDENCE, ['skyjo', 'flip7', 'monopoly-deal', 'uno', 'wavelength', 'sounds-fishy', 'just-one', 'top10']);
  for (const id of GAME_TYPES) assert.doesNotThrow(() => registrations[id].preflight(undefined));
});

test('concurrent creation reserves exactly one game for all 64 incoming game pairs', async () => {
  for (const first of GAME_TYPES) for (const second of GAME_TYPES) {
    const h = new DurableHarness(), room = new GameDurableObject(h.ctx, h.env);
    const responses = await Promise.all([room.fetch(createRequest(first)), room.fetch(createRequest(second))]);
    assert.deepEqual(responses.map(r => r.status), [200, 409], `${first} / ${second}`);
    assert.deepEqual(Object.keys(h.snapshot()), [registrations[first].storageKey]);
    const info = await room.fetch(roomRequest('1234', 'info'));
    assert.equal((await info.json() as { gameType: string }).gameType, first);
    await h.drain();
  }
});

test('a rejected operation does not poison subsequent serialized work', async () => {
  const execution = new SerialExecutor(), order: number[] = [];
  const failed = execution.run(async () => { order.push(1); throw new Error('expected'); });
  const next = execution.run(async () => { order.push(2); return 42; });
  await assert.rejects(failed, /expected/);
  assert.equal(await next, 42);
  assert.deepEqual(order, [1, 2]);
});
