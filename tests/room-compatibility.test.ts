import test from 'node:test';
import assert from 'node:assert/strict';
import { GameDurableObject } from '../backend-do/src/game.js';
import { GAME_TYPES } from '../shared/games.js';
import { checkedDealSettings } from '../shared/monopolyDeal.js';
import { DurableHarness, createRequest, roomRequest } from './support/durable-harness.js';
import { CHECKPOINT, ROLLBACK, fixture, importHistorical } from './support/historical-source.js';

const names = [...GAME_TYPES, 'deal-staged-payment', 'skyjo-final-turns'];
const room = (h: DurableHarness) => new GameDurableObject(h.ctx, h.env);
async function read(target: GameDurableObject, token: string) {
  const response = await target.fetch(roomRequest('1234', 'state', token));
  assert.equal(response.status, 200, await response.clone().text());
  return response.json() as Promise<any>;
}
function tokens(f: any): string[] {
  return Object.entries(f.state.players).map(([, p]: any) => p.token ?? p.playerToken).concat(f.state.displayToken ? [f.state.displayToken] : []);
}

for (const name of names) {
  test(`${name}: frozen baseline loads, commits, reloads and remains readable by rollback code`, async t => {
    const f = fixture(name);
    assert.equal(f.source.synthetic, true);
    assert.ok([CHECKPOINT, ROLLBACK].includes(f.source.commit));
    t.mock.method(Date, 'now', () => f.now);
    const h = new DurableHarness({ [f.key]: f.state }), target = room(h);
    assert.equal((await target.fetch(roomRequest('1234', 'state', 'forged'))).status, 401);
    for (const [id, expected] of Object.entries(f.views) as [string, any][]) {
      const token = id === '$display' ? f.state.displayToken : f.state.players[id].token ?? f.state.players[id].playerToken;
      // Deal explicitly upgrades settings on load; this is the only expected baseline change.
      if (f.gameType === 'monopoly-deal') expected.settings = checkedDealSettings(expected.settings);
      assert.deepEqual(await read(target, token), expected, `${name}: viewer ${id}`);
    }
    const unchanged = h.snapshot();
    if (f.state.displayToken) {
      const response = await target.fetch(roomRequest('1234', 'action', f.state.displayToken, {
        ...f.command.body, id: 'fixture-display-cannot-end', type: 'end', payload: {},
      }));
      assert.equal(response.status, 403);
      assert.deepEqual(h.snapshot(), unchanged);
    }
    if (f.command.route === 'action') {
      const malformed = await target.fetch(roomRequest('1234', 'action', f.token, {}));
      assert.equal(malformed.status, 400);
      assert.deepEqual(h.snapshot(), unchanged);
    }
    const request = () => roomRequest('1234', f.command.route, f.token, f.command.body);
    const response = await target.fetch(request());
    assert.equal(response.status, 200, await response.clone().text());
    await h.drain();
    assert.ok(h.writes.includes(f.key));
    const saved = h.snapshot();
    assert.deepEqual(Object.keys(saved), [f.key]);
    const restoredHarness = new DurableHarness(saved), restored = room(restoredHarness);
    for (const token of tokens(f)) assert.deepEqual(await read(restored, token), await read(target, token));
    if (f.command.route === 'action') {
      // An identical retry after an eviction must not toggle pause, pay twice or reapply a move.
      const before = await read(restored, f.token);
      assert.equal((await restored.fetch(request())).status, 200);
      assert.deepEqual(await read(restored, f.token), before);
      assert.deepEqual(restoredHarness.snapshot(), saved);
    }
    const { GameDurableObject: RollbackRoom } = await importHistorical(ROLLBACK, 'backend-do/src/game.ts');
    const rollbackHarness = new DurableHarness(saved), rollback = new RollbackRoom(rollbackHarness.ctx, rollbackHarness.env);
    for (const token of tokens(f)) assert.deepEqual(await read(rollback, token), await read(restored, token), `${name}: rollback projection`);
    // A rollback must continue play, not merely deserialize or acknowledge an old ID.
    const rollbackState = saved[f.key] as any;
    const host = Object.values(rollbackState.players).find((p: any) => p.role === 'HOST') as any;
    const hostToken = f.gameType === 'top10' ? rollbackState.hostToken : host.token;
    const end = f.gameType === 'top10' ? {} : {
      id: 'fixture-new-command-after-rollback', type: 'end', payload: {},
      generation: rollbackState.generation, round: rollbackState.round, roundId: rollbackState.roundId,
      revision: rollbackState.revision, phase: rollbackState.phase,
    };
    const ended = await rollback.fetch(roomRequest('1234', f.gameType === 'top10' ? 'end' : 'action', hostToken, end));
    assert.equal(ended.status, 200, await ended.clone().text());
    await rollbackHarness.drain();
    assert.ok(rollbackHarness.writes.includes(f.key));
    assert.equal((rollbackHarness.snapshot()[f.key] as any).phase, f.gameType === 'top10' ? 'ENDED' : 'COMPLETED');
    const forwardAgain = room(new DurableHarness(rollbackHarness.snapshot()));
    for (const token of tokens(f)) assert.deepEqual(await read(forwardAgain, token), await read(rollback, token));
  });
}

for (const completed of [false, true]) {
  test(`actual dispatcher rejects all 64 game collisions (${completed ? 'completed' : 'active'} owners), cold and warm`, async t => {
    t.mock.method(Date, 'now', () => fixture('skyjo').now);
    for (const existing of GAME_TYPES) for (const incoming of GAME_TYPES) {
      const f = fixture(existing), state = structuredClone(f.state);
      if (completed) state.phase = existing === 'top10' ? 'ENDED' : 'COMPLETED';
      const h = new DurableHarness({ [f.key]: state }), target = room(h), before = h.snapshot();
      for (const attempt of ['cold', 'warm']) {
        const response = await target.fetch(createRequest(incoming));
        assert.equal(response.status, 409, `${existing} owns code; ${incoming} create (${attempt})`);
        assert.deepEqual(h.snapshot(), before);
      }
    }
  });
}

test('dispatcher preserves legacy precedence when an inconsistent historical store has multiple keys', async t => {
  t.mock.method(Date, 'now', () => fixture('skyjo').now);
  const precedence = ['skyjo', 'flip7', 'monopoly-deal', 'uno', 'wavelength', 'sounds-fishy', 'just-one', 'top10'];
  for (let i = 0; i < precedence.length; i++) {
    const fixtures = precedence.slice(i).map(fixture), h = new DurableHarness(Object.fromEntries(fixtures.map(f => [f.key, f.state])));
    const response = await room(h).fetch(roomRequest('1234', 'info'));
    assert.equal(response.status, 200);
    assert.equal((await response.json() as any).gameType, precedence[i]);
    assert.deepEqual(h.snapshot(), Object.fromEntries(fixtures.map(f => [f.key, f.state])));
  }
});

test('omitted gameType still creates Top 10 and warm routing stops rereading room keys', async t => {
  t.mock.method(Date, 'now', () => fixture('top10').now);
  for (const id of [undefined, ...GAME_TYPES]) {
    const h = new DurableHarness(), target = room(h), response = await target.fetch(createRequest(id));
    assert.equal(response.status, 200);
    const created = await response.json() as any;
    const key = id === undefined || id === 'top10' ? 'state' : id;
    assert.deepEqual(Object.keys(h.snapshot()), [key]);
    const first = await target.fetch(roomRequest('1234', 'info'));
    assert.equal(first.status, 200);
    assert.equal((await first.json() as any).gameType, id ?? 'top10');
    const count = h.reads.length;
    assert.equal((await target.fetch(roomRequest('1234', 'info'))).status, 200);
    assert.equal(h.reads.length, count, `${id ?? 'legacy'} warm info`);
    assert.ok(created.playerToken);
    await h.drain();
  }
});

test('serialized duplicate commands cannot affect an independent lobby', async t => {
  const f = fixture('skyjo'); t.mock.method(Date, 'now', () => f.now);
  const h = new DurableHarness({ [f.key]: f.state }), other = new DurableHarness({ [f.key]: f.state });
  const target = room(h), untouched = other.snapshot();
  const send = () => target.fetch(roomRequest('1234', 'action', f.token, f.command.body));
  const results = await Promise.all([send(), send()]);
  assert.deepEqual(results.map(r => r.status), [200, 200]);
  assert.deepEqual(other.snapshot(), untouched);
  assert.equal((h.snapshot().skyjo as any).processed.filter((p: any) => p.id === f.command.body.id).length, 1);
  assert.equal((await read(room(other), f.token)).settings.displayMode, 'normal');
});

test('frozen private draws, final turns and staged payments have meaningful content', () => {
  const sky = fixture('skyjo'), s = sky.state;
  assert.equal(s.step, 'replace'); assert.ok(s.pausedAt); assert.equal(s.pending.source, 'deck'); assert.ok(s.deadline > s.pausedAt);
  for (const name of ['just-one', 'sounds-fishy', 'wavelength']) assert.ok(fixture(name).state.pausedRemaining > 0, `${name}: nonempty saved timer`);
  for (const [id, view] of Object.entries(sky.views) as [string, any][]) {
    assert.deepEqual(view.yourCard, id === s.pending.owner ? s.pending.card : null);
    assert.equal(view.pending.card, null);
    assert.ok(view.players.every((p: any) => p.grid.filter((slot: any) => slot?.value === null).length > 0));
    assert.equal(view.deck, undefined); assert.equal(view.processed, undefined);
  }
  const final = fixture('skyjo-final-turns').state;
  assert.equal(final.finalTurns.length, 2); assert.ok(!final.finalTurns.includes(final.finisher));
  const deal = fixture('deal-staged-payment').state;
  assert.equal(deal.pending.stage, 'payment'); assert.equal(deal.pending.amount, 1); assert.equal(deal.pending.amountPerTarget, 2);
  assert.equal(deal.pending.targets.length, 2); assert.equal(deal.settings.rules.bankFirstPayments, true);
});

test('storage harness clones values and supports independent write/alarm failure injection', async () => {
  const original = { values: [1] }, h = new DurableHarness({ test: original });
  original.values.push(2);
  const value = await h.ctx.storage.get<any>('test'); value.values.push(3);
  assert.deepEqual(h.snapshot(), { test: { values: [1] } });
  h.failNext = 'put'; await assert.rejects(h.ctx.storage.put('test', value), /Injected put failure/);
  assert.deepEqual(h.snapshot(), { test: { values: [1] } });
  h.failNext = 'setAlarm'; await assert.rejects(h.ctx.storage.setAlarm(100), /Injected setAlarm failure/);
  assert.equal(h.alarm, null);
});
