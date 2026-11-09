import test from 'node:test';
import assert from 'node:assert/strict';
import { applyAction, beginRound, createState, expireState, makeDeck, nextDeadline, serializeForPlayer, type FlipState } from '../backend-do/src/flip7/engine.js';
import { Flip7Room } from '../backend-do/src/flip7/room.js';
import type { Env } from '../backend-do/src/game.js';
import { CLASSIC_FLIP_RULES, DEFAULT_FLIP_SETTINGS, FLIP_PROFILES, checkedFlipSettings, flipScore, type FlipAction, type FlipCard, type FlipRules, type FlipView } from '../shared/flip7.js';

let seq = 0;
const card = (kind: FlipCard['kind'], value = 0): FlipCard => ({ id: `test-${++seq}`, kind, value });
const num = (v: number) => card('number', v);
function room(n = 3, rules: Partial<FlipRules> = {}, start = true): FlipState {
  const host = { playerId: 'p0', nickname: 'Anna', role: 'HOST' as const, token: 'secret-host', connected: true, disconnectedAt: null };
  const s = createState('1234', host, 'secret-display', { ...DEFAULT_FLIP_SETTINGS, autoNext: false, rules: { ...CLASSIC_FLIP_RULES, ...rules } }, 1000);
  for (let i = 1; i < n; i++) { const id = `p${i}`; s.players[id] = { ...host, playerId: id, nickname: `Player ${i}`, role: 'PLAYER', token: `secret-${id}` }; s.order.push(id); }
  if (start) {
    act(s, 'p0', 'start'); s.deck = Array.from({ length: n }, (_, i) => num(i + 1)).reverse(); drain(s);
    s.deck = makeDeck(s.settings.rules);
  }
  return s;
}
function action(s: FlipState, type: string, payload: Record<string, unknown> = {}): FlipAction {
  return { id: `action-${++seq}`, type, payload, round: s.round, generation: s.generation, revision: s.revision };
}
function act(s: FlipState, actor: string, type: string, payload: Record<string, unknown> = {}, now = 2000) { applyAction(s, actor, action(s, type, payload), now); }
function drain(s: FlipState) {
  for (let i = 0; i < 500 && s.nextAt !== null && !s.pending && s.phase === 'PLAY'; i++) expireState(s, s.nextAt);
}
function rig(s: FlipState, ...cards: FlipCard[]) { s.deck = cards.reverse(); }
function target(s: FlipState, id: string) { assert.ok(s.pending); act(s, s.pending.owner, 'target', { target: id }); }
function conserved(s: FlipState) {
  const cards = [...s.deck, ...s.discard, ...Object.values(s.hands).flatMap(h => h.cards), ...(s.pending ? [s.pending.card] : []),
    ...s.tasks.flatMap(t => t.kind === 'effect' ? [t.card] : t.kind === 'forced' ? t.queued : [])];
  assert.equal(cards.length, makeDeck(s.settings.rules).length);
  assert.equal(new Set(cards.map(c => c.id)).size, cards.length);
}

test('standard deck is exactly 94 distinct cards: 79 numbers, 6 modifiers, 9 actions', () => {
  const d = makeDeck(CLASSIC_FLIP_RULES); assert.equal(d.length, 94); assert.equal(new Set(d.map(c => c.id)).size, 94);
  for (let i = 0; i <= 12; i++) assert.equal(d.filter(c => c.kind === 'number' && c.value === i).length, Math.max(1, i));
  for (const kind of ['freeze', 'flip-three', 'second-chance']) assert.equal(d.filter(c => c.kind === kind).length, 3);
  assert.deepEqual(d.filter(c => c.kind === 'bonus').map(c => c.value), [2, 4, 6, 8, 10]); assert.equal(d.filter(c => c.kind === 'double').length, 1);
});
test('initial action interrupts dealing, and Freeze can target an undealt player', () => {
  const s = room(3, {}, false); act(s, 'p0', 'start'); rig(s, card('freeze'), num(8), num(3));
  expireState(s, s.nextAt!); assert.equal(s.pending?.owner, 'p1'); assert.equal(s.hands.p0.cards.length, 0);
  target(s, 'p2'); assert.equal(s.hands.p2.status, 'frozen'); drain(s);
  assert.equal(s.hands.p2.cards.length, 0); assert.equal(s.hands.p0.cards[0].value, 8); assert.equal(s.turn, 'p1');
  assert.equal(serializeForPlayer(s, 'p1').canStay, false);
});
test('Stay is legal with a zero, modifier, or Second Chance, but not an empty hand', () => {
  for (const c of [num(0), card('bonus', 2), card('second-chance')]) {
    const s = room(); s.hands.p1.cards = [c]; assert.equal(serializeForPlayer(s, 'p1').canStay, true); act(s, 'p1', 'stay'); assert.equal(s.hands.p1.status, 'stayed');
  }
  const s = room(); s.hands.p1.cards = []; assert.throws(() => act(s, 'p1', 'stay'), /card in front/);
});
test('duplicate bust gives zero this round, preserves previous totals and retains the duplicate', () => {
  const s = room(); s.totals.p1 = 80; rig(s, num(1)); act(s, 'p1', 'hit');
  assert.equal(s.hands.p1.status, 'busted'); assert.equal(s.hands.p1.cards.length, 2); assert.equal(s.turn, 'p2');
  act(s, 'p2', 'stay'); act(s, 'p0', 'stay'); assert.equal(s.result?.scores.p1, 0); assert.equal(s.totals.p1, 80);
});
test('Second Chance discards itself and the duplicate; ordinary turn ends without another draw', () => {
  const s = room(); const chance = card('second-chance'); s.hands.p1.cards.push(chance); rig(s, num(1), num(9)); act(s, 'p1', 'hit');
  assert.equal(s.hands.p1.status, 'active'); assert.equal(s.hands.p1.cards.length, 1); assert.equal(s.discard.length, 2); assert.equal(s.turn, 'p2'); assert.equal(s.deck.length, 1);
});
test('extra Second Chance is passed only to an eligible active unprotected player', () => {
  const s = room(4); s.hands.p1.cards.push(card('second-chance')); s.hands.p2.cards.push(card('second-chance')); s.hands.p3.status = 'stayed';
  rig(s, card('second-chance')); act(s, 'p1', 'hit'); assert.equal(s.pending, null); // sole eligible target is automatic
  assert.ok(s.hands.p0.cards.some(c => c.kind === 'second-chance')); assert.equal(s.turn, 'p2');
});
test('extra Second Chance is discarded when every eligible player already holds one', () => {
  const s = room(); for (const h of Object.values(s.hands)) h.cards.push(card('second-chance'));
  rig(s, card('second-chance')); act(s, 'p1', 'hit'); assert.equal(s.discard.length, 1); assert.equal(s.pending, null); assert.equal(s.turn, 'p2');
});
test('Freeze banks points, can target self, and is not prevented by Second Chance', () => {
  const s = room(); s.hands.p1.cards.push(card('second-chance'), card('bonus', 8)); rig(s, card('freeze')); act(s, 'p1', 'hit'); target(s, 'p1');
  assert.equal(s.hands.p1.status, 'frozen'); assert.equal(flipScore(s.hands.p1, s.settings.rules), 9); assert.ok(s.hands.p1.cards.some(c => c.kind === 'second-chance')); assert.equal(s.turn, 'p2');
});
test('only active player must Freeze themself and end the round', () => {
  const s = room(); s.hands.p0.status = 'stayed'; s.hands.p2.status = 'busted'; rig(s, card('freeze')); act(s, 'p1', 'hit');
  assert.equal(s.hands.p1.status, 'frozen'); assert.equal(s.phase, 'RESULTS');
});
test('Flip Three consumes number, modifier and action cards and resumes original turn order', () => {
  const s = room(); rig(s, card('flip-three'), num(9), card('bonus', 10), card('second-chance'));
  act(s, 'p1', 'hit'); target(s, 'p0'); assert.equal(serializeForPlayer(s, 'p1').forced?.remaining, 3);
  drain(s); assert.equal(s.hands.p0.cards.length, 4); assert.equal(s.turn, 'p2'); assert.equal(s.tasks.length, 0);
});
test('Second Chance revealed during forced draws can prevent the very next duplicate', () => {
  const s = room(); rig(s, card('flip-three'), card('second-chance'), num(1), num(9)); act(s, 'p1', 'hit'); target(s, 'p1'); drain(s);
  assert.equal(s.hands.p1.status, 'active'); assert.equal(s.hands.p1.cards.length, 2); assert.equal(s.turn, 'p2'); assert.equal(s.deck.length, 0);
});
test('multiple Second Chances during Flip Three interrupt for a gift, then resume remaining forced draws', () => {
  const s = room(); s.hands.p1.cards.push(card('second-chance')); rig(s, card('flip-three'), card('second-chance'), num(10), num(11));
  act(s, 'p1', 'hit'); target(s, 'p1'); expireState(s, s.nextAt!); assert.equal(s.pending?.card.kind, 'second-chance');
  assert.equal(serializeForPlayer(s, 'p1').forced?.remaining, 2); target(s, 'p0'); drain(s); assert.equal(s.turn, 'p2'); assert.ok(s.hands.p0.cards.some(c => c.kind === 'second-chance'));
});
test('Freeze and nested Flip Three wait until the three draws finish; bust discards both', () => {
  const s = room(); rig(s, card('flip-three'), card('freeze'), card('flip-three'), num(1)); act(s, 'p1', 'hit'); target(s, 'p1');
  expireState(s, s.nextAt!); assert.equal(s.pending, null); expireState(s, s.nextAt!); assert.equal(s.pending, null); drain(s);
  assert.equal(s.hands.p1.status, 'busted'); assert.equal(s.pending, null); assert.equal(s.discard.length, 3); assert.equal(s.turn, 'p2');
});
test('nested action ownership follows forced recipient and returns to the original ordinary turn', () => {
  const s = room(); rig(s, card('flip-three'), card('flip-three'), num(4), num(5), num(6), num(7), num(8));
  act(s, 'p1', 'hit'); target(s, 'p0'); drain(s); assert.equal(s.pending?.owner, 'p0'); assert.equal(s.pending?.card.kind, 'flip-three');
  target(s, 'p2'); drain(s); assert.equal(s.turn, 'p2'); assert.equal(s.hands.p2.cards.length, 4);
});
test('a frozen owner still assigns previously earned queued effects to other active players', () => {
  const s = room(); rig(s, card('flip-three'), card('freeze'), card('flip-three'), num(8), num(9), num(10), num(11)); act(s, 'p1', 'hit'); target(s, 'p1'); drain(s);
  assert.equal(s.pending?.card.kind, 'freeze'); target(s, 'p1'); assert.equal(s.hands.p1.status, 'frozen');
  assert.equal(s.pending?.owner, 'p1'); assert.deepEqual(s.pending?.eligible, ['p0', 'p2']); target(s, 'p0'); drain(s);
  assert.equal(s.turn, 'p2'); assert.equal(s.discard.length, 3); assert.equal(s.hands.p0.cards.length, 4);
});
test('initial Flip Three resolves before continuing the ordinary initial card deal', () => {
  const s = room(3, {}, false); act(s, 'p0', 'start'); rig(s, card('flip-three'), num(9), num(10), num(11), num(12), num(7));
  expireState(s, s.nextAt!); assert.equal(s.pending?.owner, 'p1'); target(s, 'p2'); drain(s);
  assert.equal(s.hands.p2.cards.length, 4); assert.equal(s.hands.p0.cards[0].value, 7); assert.equal(s.hands.p1.cards.length, 0); assert.equal(s.turn, 'p1');
});
test('Flip 7 stops forced draws immediately, discards queued effects and scores everyone', () => {
  const s = room(); s.hands.p1.cards = [0, 1, 2, 3, 4, 5].map(num); s.hands.p0.status = 'busted'; s.hands.p2.status = 'stayed';
  rig(s, card('flip-three'), card('freeze'), num(6), num(12)); act(s, 'p1', 'hit'); // sole active player auto-targets
  drain(s); assert.equal(s.phase, 'RESULTS'); assert.equal(s.deck.length, 1); assert.equal(s.result?.flip7, 'p1'); assert.equal(s.result?.scores.p1, 36); assert.equal(s.result?.scores.p0, 0); assert.equal(s.result?.scores.p2, 2); assert.equal(s.pending, null);
});
test('x2 multiplies only numbers; bonuses and Flip 7 bonus are added afterward', () => {
  const h = { cards: [num(12), num(8), card('double'), card('bonus', 10), card('bonus', 4)], status: 'active' as const, flip7: true };
  assert.equal(flipScore(h, CLASSIC_FLIP_RULES), 69);
});
test('round transition preserves deck order, collects all table cards, clears protection and rotates dealer', () => {
  const s = room(); s.hands.p0.cards.push(card('second-chance')); const deck = structuredClone(s.deck);
  act(s, 'p1', 'stay'); act(s, 'p2', 'stay'); act(s, 'p0', 'stay'); assert.equal(s.phase, 'RESULTS'); act(s, 'p0', 'next-round');
  assert.deepEqual(s.deck, deck); assert.equal(s.dealer, 'p1'); assert.equal(s.round, 2); assert.equal(s.discard.length, 4); assert.equal(s.hands.p0.cards.length, 0);
});
test('mid-round reshuffle uses only eligible discards, retaining busted and stayed cards', () => {
  const s = room(); s.deck = []; const retained = [num(12), num(12)]; s.hands.p0.cards = retained; s.hands.p0.status = 'busted'; s.hands.p2.status = 'stayed'; s.discard = [num(10)];
  act(s, 'p1', 'hit'); assert.deepEqual(s.hands.p0.cards, retained); assert.equal(s.hands.p2.cards.length, 1); assert.equal(s.hands.p1.cards.at(-1)?.value, 10); assert.equal(s.discard.length, 0);
});
test('unused Second Chance cards are discarded as soon as the round ends', () => {
  const s = room(); const chance = card('second-chance'); s.hands.p1.cards.push(chance);
  act(s, 'p1', 'stay'); act(s, 'p2', 'stay'); act(s, 'p0', 'stay');
  assert.equal(s.phase, 'RESULTS'); assert.ok(s.discard.some(c => c.id === chance.id));
  assert.ok(Object.values(s.hands).every(h => h.cards.every(c => c.kind !== 'second-chance')));
});
test('a unique leader wins only after the round; tied leaders require everyone in the next round', () => {
  const s = room(3, { target: 20 }); s.totals = { p0: 17, p1: 19, p2: 18 };
  act(s, 'p1', 'stay'); assert.equal(s.phase, 'PLAY'); act(s, 'p2', 'stay'); act(s, 'p0', 'stay');
  assert.equal(s.phase, 'RESULTS'); assert.equal(s.result?.tied, true); assert.equal(s.winner, null); act(s, 'p0', 'next-round'); assert.equal(Object.keys(s.hands).length, 3);
  rig(s, num(4), num(5), num(6)); drain(s); act(s, s.turn!, 'stay'); act(s, s.turn!, 'stay'); act(s, s.turn!, 'stay'); assert.equal(s.phase, 'COMPLETED'); assert.equal(s.winner, 'p1');
});
test('custom profiles change deck, unique threshold, bonus and fixed round winning', () => {
  const s = room(2, { freeze: 0, flipThree: 1, secondChance: 2, unique: 3, bonus: 30, fixedRounds: 1 });
  assert.equal(makeDeck(s.settings.rules).length, 88); s.hands.p1.cards = [num(1), num(2)]; rig(s, num(3)); act(s, 'p1', 'hit');
  assert.equal(s.phase, 'COMPLETED'); assert.equal(s.totals.p1, 36); assert.equal(s.winner, 'p1');
  assert.equal(FLIP_PROFILES[1].rules.target, 100); assert.equal(FLIP_PROFILES[2].rules.target, 300);
});
test('settings validation rejects invalid input and rules lock after start', () => {
  for (const raw of [{ rules: { unique: 14 } }, { rules: { target: NaN } }, { rules: { freeze: -1 } }, { rules: [] }, { rules: { turnSeconds: '10' } }, { displayMode: 'evil' }, { autoNext: 'yes' }]) assert.throws(() => checkedFlipSettings(raw));
  const s = room(); assert.throws(() => act(s, 'p0', 'settings', { settings: DEFAULT_FLIP_SETTINGS }), /locked/);
  assert.throws(() => act(s, 'p1', 'display-mode', { mode: 'tv' }), /host/);
});
test('Normal ↔ TV preserves every gameplay field, deadline, forced sequence and pending choice', () => {
  const s = room(3, { actionSeconds: 30 }); rig(s, card('flip-three')); act(s, 'p1', 'hit');
  const snapshot = () => ({ deck: s.deck, discard: s.discard, hands: s.hands, totals: s.totals, round: s.round, turn: s.turn, tasks: s.tasks, pending: s.pending, deadline: s.deadline, nextAt: s.nextAt, revision: s.revision, generation: s.generation });
  const before = structuredClone(snapshot()), v = serializeForPlayer(s, 'p1');
  const pendingAction = { ...action(s, 'target', { target: 'p0' }), revision: v.revision };
  act(s, 'p0', 'display-mode', { mode: 'tv' }); assert.deepEqual(snapshot(), before);
  act(s, 'p0', 'display-mode', { mode: 'normal' }); assert.deepEqual(snapshot(), before);
  applyAction(s, 'p1', pendingAction); assert.equal(s.pending, null); assert.equal(serializeForPlayer(s, 'p0').forced?.remaining, 3);
  const forcedBefore = structuredClone(snapshot()); act(s, 'p0', 'display-mode', { mode: 'tv' }); assert.deepEqual(snapshot(), forcedBefore);
});
test('display snapshots expose the full table but never tokens, draw order or host powers', () => {
  const s = room(), v = serializeForPlayer(s, '$display'), text = JSON.stringify(v);
  assert.equal(v.yourRole, 'DISPLAY'); assert.equal(v.yourPlayerId, null); assert.equal(v.displayUrl, undefined); assert.equal(v.canHit, false); assert.equal(v.players.length, 3);
  assert.ok(v.players.every(p => p.hand.cards.length === 1)); assert.ok(!text.includes('secret-')); assert.ok(!('deck' in v));
});
test('duplicate actions are idempotent and stale concurrent decisions cannot draw twice', () => {
  const s = room(); rig(s, num(8), num(9)); const a = action(s, 'hit'), other = action(s, 'hit'); applyAction(s, 'p1', a);
  const v = s.version; applyAction(s, 'p1', a); assert.equal(s.version, v); assert.equal(s.deck.length, 1); assert.throws(() => applyAction(s, 'p1', other), /table changed/);
  const old = action(s, 'pause'); act(s, 'p0', 'restart'); assert.throws(() => applyAction(s, 'p0', old), /game changed/);
});
test('pause preserves forced draws and shifts turn, action and round timers exactly on resume', () => {
  const s = room(3, { actionSeconds: 20 }); rig(s, card('flip-three'), num(10), num(11), num(12)); act(s, 'p1', 'hit'); const deadline = s.deadline!;
  act(s, 'p0', 'pause', {}, 2500); assert.equal(expireState(s, 50000), false); assert.throws(() => target(s, 'p0'), /not accepting/);
  act(s, 'p0', 'extend', {}, 50000); act(s, 'p0', 'resume', {}, 52500); assert.equal(s.deadline, deadline + 80000);
  target(s, 'p0'); const at = s.nextAt!; act(s, 'p0', 'pause', {}, 3000); act(s, 'p0', 'resume', {}, 9000); assert.equal(s.nextAt, at + 6000);
});
test('timeouts Stay safely, Hit empty hands, and resolve pending targets without a client', () => {
  const s = room(3, { turnSeconds: 5, actionSeconds: 5 }); assert.ok(s.deadline); expireState(s, s.deadline!); assert.equal(s.hands.p1.status, 'stayed');
  s.hands.p2.cards = []; rig(s, card('freeze')); expireState(s, s.deadline!); assert.equal(s.pending?.owner, 'p2');
  expireState(s, s.deadline!); assert.equal(s.hands.p2.status, 'frozen'); assert.equal(s.turn, 'p0');
});
test('host recovery only resolves an offline decision maker and preserves their seat', () => {
  const s = room(); assert.throws(() => act(s, 'p0', 'recover'), /disconnected/); s.players.p1.connected = false; act(s, 'p0', 'recover'); assert.equal(s.hands.p1.status, 'stayed'); assert.equal(s.order.length, 3);
  rig(s, card('freeze')); act(s, 'p2', 'hit'); s.players.p2.connected = false; act(s, 'p0', 'recover'); assert.equal(s.hands.p2.status, 'frozen');
});
test('serialized durable state resumes pending effects; simultaneous rooms remain independent', () => {
  const s = room(), other = room(); rig(s, card('flip-three'), num(5), num(6), num(7)); act(s, 'p1', 'hit');
  const restored = JSON.parse(JSON.stringify(s)) as FlipState; target(restored, 'p0'); drain(restored); assert.equal(restored.turn, 'p2'); assert.ok(s.pending); assert.equal(other.round, 1); assert.equal(other.hands.p0.cards.length, 1);
});
test('auto next round is an authoritative alarm and can be paused during results', () => {
  const s = room(); s.settings.autoNext = true; act(s, 'p1', 'stay'); act(s, 'p2', 'stay'); act(s, 'p0', 'stay');
  const at = s.nextRoundAt!; assert.equal(nextDeadline(s), at); act(s, 'p0', 'pause', {}, at - 1000); assert.equal(expireState(s, at + 5000), false);
  act(s, 'p0', 'resume', {}, at + 9000); assert.equal(s.nextRoundAt, at + 10000); expireState(s, s.nextRoundAt!); assert.equal(s.round, 2);
});
test('full randomized games preserve every card through action chains, reshuffles, ties and completion', () => {
  for (let run = 0; run < 20; run++) {
    const s = room(6, { target: 100 }, false); act(s, 'p0', 'start'); conserved(s);
    for (let i = 0; i < 7000 && s.phase !== 'COMPLETED'; i++) {
      if (s.pending) target(s, s.pending.eligible[(i + run) % s.pending.eligible.length]);
      else if (s.nextAt !== null) expireState(s, s.nextAt);
      else if (s.phase === 'RESULTS') act(s, 'p0', 'next-round');
      else if (s.turn) act(s, s.turn, s.hands[s.turn].cards.filter(c => c.kind === 'number').length >= (i % 3 + 3) && hasAny(s, s.turn) ? 'stay' : 'hit');
      else assert.fail('No legal transition');
      conserved(s);
    }
    assert.equal(s.phase, 'COMPLETED'); assert.ok(s.winner); assert.ok(s.totals[s.winner] >= 100);
  }
});
function hasAny(s: FlipState, id: string) { return s.hands[id].cards.length > 0; }

function adapter(stored?: FlipState) {
  const data = new Map<string, unknown>(); if (stored) data.set('flip7', structuredClone(stored));
  const storage = { transaction: async (fn: (tx: unknown) => Promise<unknown>) => fn(storage), get: async (key: string) => structuredClone(data.get(key)), put: async (key: string, value: unknown) => { data.set(key, structuredClone(value)); }, setAlarm: async () => {}, deleteAlarm: async () => {} };
  const ctx = { storage, blockConcurrencyWhile: async (f: () => Promise<unknown>) => f(), waitUntil: (p: Promise<unknown>) => { void p; } };
  return { room: new Flip7Room(ctx as unknown as DurableObjectState, {} as Env), data };
}
function req(route: string, token?: string, payload?: unknown) { return new Request(`https://test/api/game/1234/${route}`, { method: payload === undefined ? 'GET' : 'POST', headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), 'Content-Type': 'application/json' }, ...(payload === undefined ? {} : { body: JSON.stringify(payload) }) }); }
test('room rejects unauthenticated requests, allows display refresh, denies every display mutation', async () => {
  const s = room(); s.expiresAt = Date.now() + 600000; const a = adapter(s);
  assert.equal((await a.room.fetch(req('state'))).status, 401);
  const r = await a.room.fetch(req('state', 'secret-display')); assert.equal(r.status, 200); const v = await r.json() as FlipView; assert.equal(v.yourRole, 'DISPLAY');
  for (const type of ['hit', 'target', 'pause', 'display-mode', 'end', 'settings']) assert.equal((await a.room.fetch(req('action', 'secret-display', action(s, type)))).status, 403);
  const again = await a.room.fetch(req('state', 'secret-display')); assert.equal(again.status, 200); assert.deepEqual((await again.json() as FlipView).players, v.players);
});
test('room reconnect restores the original player identity, cards and pending target without changing revision', async () => {
  const s = room(); s.expiresAt = Date.now() + 600000; rig(s, card('freeze')); act(s, 'p1', 'hit', {}, Date.now());
  const a = adapter(s); const v = await (await a.room.fetch(req('state', 'secret-p1'))).json() as FlipView;
  assert.equal(v.yourPlayerId, 'p1'); assert.equal(v.pending?.owner, 'p1'); assert.equal(v.revision, s.revision); assert.equal(v.players[1].connected, false);
  assert.equal((await a.room.fetch(req('action', 'secret-p1', action(s, 'target', { target: 'p0' })))).status, 200);
  const b = adapter(a.data.get('flip7') as FlipState); const restored = await (await b.room.fetch(req('state', 'secret-p1'))).json() as FlipView;
  assert.equal(restored.pending, null); assert.equal(restored.players[0].hand.status, 'frozen'); assert.equal(restored.turn, 'p2');
});
