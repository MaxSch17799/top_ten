import test from 'node:test';
import assert from 'node:assert/strict';
import { applyAction, beginRound, createState, expireState, makeDeck, nextDeadline, removeColumns, serializeForPlayer, type SkyState, type Slot } from '../backend-do/src/skyjo/engine.js';
import { SkyjoRoom } from '../backend-do/src/skyjo/room.js';
import type { Env } from '../backend-do/src/game.js';
import { checkedSkySettings, CLASSIC_SKY_RULES, DEFAULT_SKY_SETTINGS, SKY_PROFILES, type SkyAction, type SkyCard, type SkyRules, type SkyView } from '../shared/skyjo.js';

let seq = 0;
const card = (value: number): SkyCard => ({ id: `test-${++seq}`, value });
const slot = (value: number, faceUp = true): Slot => ({ card: card(value), faceUp });
function room(n = 3, rules: Partial<SkyRules> = {}, play = true): SkyState {
  const host = { playerId: 'p0', nickname: 'Anna', role: 'HOST' as const, token: 'secret-host', connected: true, disconnectedAt: null };
  const s = createState('1234', host, 'secret-display', { ...DEFAULT_SKY_SETTINGS, autoNext: false, rules: { ...CLASSIC_SKY_RULES, ...rules } }, 1000, 12345);
  for (let i = 1; i < n; i++) { const id = `p${i}`; s.players[id] = { ...host, playerId: id, nickname: `Player ${i}`, role: 'PLAYER', token: `secret-${id}` }; s.order.push(id); }
  act(s, 'p0', 'start');
  if (play) for (const id of s.order) for (let i = 0; i < s.settings.rules.startingCards; i++) act(s, id, 'setup', { index: i });
  return s;
}
function action(s: SkyState, type: string, payload: Record<string, unknown> = {}): SkyAction { return { id: `action-${++seq}`, type, payload, generation: s.generation, revision: s.revision, round: s.round }; }
function act(s: SkyState, actor: string, type: string, payload: Record<string, unknown> = {}, now = 2000) { applyAction(s, actor, action(s, type, payload), now); }
function conserved(s: SkyState) {
  const cards = [...s.deck, ...s.discard, ...Object.values(s.grids).flatMap(g => g.flatMap(c => c ? [c.card] : [])), ...(s.pending ? [s.pending.card] : [])];
  assert.equal(cards.length, 150); assert.equal(new Set(cards.map(c => c.id)).size, 150);
}
function endable(n = 3, rules: Partial<SkyRules> = {}) {
  const s = room(n, { columns: false, ...rules }); s.turn = 'p0';
  for (const id of s.order) s.grids[id] = Array.from({ length: 12 }, (_, i) => slot(id === 'p0' ? 1 : 2, i !== 11));
  return s;
}
function drawDiscardReveal(s: SkyState, index: number) { const id = s.turn!; act(s, id, 'draw'); act(s, id, 'discard'); act(s, id, 'reveal', { index }); }
function close(s: SkyState) { drawDiscardReveal(s, 11); while (s.phase === 'PLAY') drawDiscardReveal(s, 11); }

test('standard deck has 150 unique cards and the exact -2 through 12 distribution', () => {
  const d = makeDeck(); assert.equal(d.length, 150); assert.equal(new Set(d.map(c => c.id)).size, 150);
  for (let v = -2; v <= 12; v++) assert.equal(d.filter(c => c.value === v).length, v === -2 ? 5 : v === 0 ? 15 : 10);
});
test('2–8 players receive twelve hidden cards, one discard, and the correct draw pile', () => {
  for (const n of [2, 6, 8]) { const s = room(n, {}, false); assert.equal(s.phase, 'SETUP'); assert.equal(s.deck.length, 150 - n * 12 - 1); assert.equal(s.discard.length, 1); assert.ok(Object.values(s.grids).every(g => g.length === 12 && g.every(c => c && !c.faceUp))); conserved(s); }
});
test('identical secret seeds produce deterministic deals; different seeds change them', () => {
  const s = room(2, {}, false), other = room(2, {}, false); assert.deepEqual(s.deck, other.deck);
  other.rng = 567; beginRound(other, 2000); assert.notDeepEqual(s.deck, other.deck);
});
test('opening reveals commute across simultaneous players and highest sum starts; tied sums use seat order', () => {
  const s = room(3, {}, false);
  s.grids.p0[0] = slot(-2, false); s.grids.p0[1] = slot(12, false);
  s.grids.p1[0] = slot(5, false); s.grids.p1[1] = slot(5, false);
  s.grids.p2[0] = slot(-1, false); s.grids.p2[1] = slot(3, false);
  const sameRevision = s.revision;
  for (const id of s.order) for (const index of [0, 1]) applyAction(s, id, { ...action(s, 'setup', { index }), revision: sameRevision });
  assert.equal(s.phase, 'PLAY'); assert.equal(s.turn, 'p0'); assert.throws(() => act(s, 'p0', 'setup', { index: 2 }));
});
test('hidden values and identities remain absent even for their owner and the host', () => {
  const s = room(); for (const id of ['p0', 'p1', '$display']) {
    const v = serializeForPlayer(s, id), text = JSON.stringify({ ...v, displayUrl: undefined }); assert.ok(v.players.every(p => p.grid.filter(c => c?.value === null).length === 10));
    assert.ok(!('rng' in v) && !('deck' in v) && !('displayToken' in v)); assert.ok(!text.includes('secret-'));
    for (const p of s.order) for (const c of s.grids[p]) if (c && !c.faceUp) assert.ok(!text.includes(`"${c.card.id}"`));
  }
});
test('drawn values are private through Keep, and become public only on placement', () => {
  const s = room(), id = s.turn!; act(s, id, 'draw'); const c = s.pending!.card;
  for (const stage of [0, 1]) {
    assert.deepEqual(serializeForPlayer(s, id).yourCard, c);
    for (const viewer of s.order.filter(p => p !== id).concat('$display')) { const v = serializeForPlayer(s, viewer); assert.equal(v.yourCard, null); assert.equal(v.pending?.card, null); assert.ok(!v.events.some(e => e.card?.id === c.id)); }
    if (!stage) act(s, id, 'keep');
  }
  act(s, id, 'replace', { index: 3 }); assert.equal(serializeForPlayer(s, '$display').players.find(p => p.playerId === id)!.grid[3]?.value, c.value); conserved(s);
});
test('canceling Keep reopens the same private draw without changing piles, grids, turn or timer', () => {
  const s = room(3, { turnSeconds: 30 }), id = s.turn!; act(s, id, 'draw');
  const snapshot = () => structuredClone({ pending: s.pending, deck: s.deck, discard: s.discard, grids: s.grids, totals: s.totals, turn: s.turn, deadline: s.deadline, finisher: s.finisher, finalTurns: s.finalTurns, rng: s.rng });
  const before = snapshot(), drawn = s.pending!.card;
  act(s, id, 'keep', {}, 2500); act(s, id, 'cancel-keep', {}, 3000);
  assert.equal(s.step, 'drawn'); assert.deepEqual(snapshot(), before); conserved(s);
  assert.deepEqual(serializeForPlayer(s, id).yourCard, drawn);
  for (const viewer of s.order.filter(p => p !== id).concat('$display')) {
    const v = serializeForPlayer(s, viewer); assert.equal(v.yourCard, null); assert.equal(v.pending?.card, null);
    assert.ok(!v.events.some(e => e.card?.id === drawn.id));
  }
  act(s, id, 'discard'); assert.equal(s.step, 'reveal'); assert.deepEqual(s.discard.at(-1), drawn);
  act(s, id, 'reveal', { index: 4 }); assert.notEqual(s.turn, id); conserved(s);
});

test('cancel-keep rejects public discard selections, unkept draws, committed moves, other players and paused play', () => {
  const reject = (s: SkyState, id: string) => { const before = structuredClone(s); assert.throws(() => act(s, id, 'cancel-keep')); assert.deepEqual(s, before); };
  const s = room(), id = s.turn!; reject(s, id); act(s, id, 'take'); reject(s, id); act(s, id, 'return-discard');
  act(s, id, 'draw'); reject(s, id); act(s, id, 'keep'); reject(s, s.order.find(p => p !== id)!);
  act(s, 'p0', 'pause'); reject(s, id); act(s, 'p0', 'resume'); act(s, id, 'cancel-keep');
  act(s, id, 'discard'); reject(s, id); act(s, id, 'reveal', { index: 4 }); reject(s, id);
  const placed = room(), actor = placed.turn!; act(placed, actor, 'draw'); act(placed, actor, 'keep'); act(placed, actor, 'replace', { index: 4 }); reject(placed, actor);
});

test('cancel-keep retries cannot reopen a later Keep decision and stale requests leave it intact', () => {
  const s = room(), id = s.turn!; act(s, id, 'draw'); act(s, id, 'keep');
  const cancel = action(s, 'cancel-keep'); applyAction(s, id, cancel); const reopened = structuredClone(s);
  applyAction(s, id, cancel); assert.deepEqual(s, reopened); act(s, id, 'keep'); const kept = structuredClone(s);
  applyAction(s, id, cancel); assert.deepEqual(s, kept);
  assert.throws(() => applyAction(s, id, { ...action(s, 'cancel-keep'), revision: s.revision - 1 }), /table changed/);
  assert.deepEqual(s, kept); act(s, id, 'cancel-keep'); conserved(s);
});

test('a selected discard can be placed, but cannot be discarded as a draw or used to peek at a target', () => {
  const s = room(), id = s.turn!, c = s.discard.at(-1)!, old = s.grids[id][4]!.card;
  act(s, id, 'take'); assert.equal(s.step, 'replace'); assert.deepEqual(serializeForPlayer(s, '$display').pending?.card, c);
  assert.throws(() => act(s, id, 'discard')); assert.throws(() => act(s, id, 'draw')); assert.throws(() => act(s, id, 'reveal', { index: 4 }));
  act(s, id, 'replace', { index: 4 }); assert.deepEqual(s.grids[id][4], { card: c, faceUp: true }); assert.deepEqual(s.discard.at(-1), old); conserved(s);
});
test('returning a selected discard restores exact pile order without touching cards, scores, turn or deadline', () => {
  for (const multipleDiscards of [false, true]) {
    const s = room(3, { turnSeconds: 30 }), id = s.turn!;
    if (multipleDiscards) s.discard.push(s.deck.pop()!, s.deck.pop()!);
    const snapshot = () => structuredClone({ phase: s.phase, round: s.round, deck: s.deck, discard: s.discard, grids: s.grids, starting: s.starting, totals: s.totals, turn: s.turn, finisher: s.finisher, finalTurns: s.finalTurns, deadline: s.deadline, nextRoundAt: s.nextRoundAt, rng: s.rng });
    const before = snapshot(), selected = s.discard.at(-1)!;
    act(s, id, 'take', {}, 2100); conserved(s); assert.equal(s.discard.length, before.discard.length - 1);
    act(s, id, 'return-discard', {}, 5000); conserved(s);
    assert.equal(s.pending, null); assert.equal(s.step, 'choose'); assert.deepEqual(snapshot(), before);
    assert.deepEqual(serializeForPlayer(s, '$display').discardTop, selected);
    assert.match(s.events.at(-1)!.message, /returns .* to the discard pile/);
    act(s, id, 'draw', {}, 5100); assert.deepEqual(s.pending?.card, before.deck.at(-1)); assert.equal(s.pending?.source, 'deck'); conserved(s);
  }
});

test('returning a discard does not consume a final turn, including after switching display modes', () => {
  const s = endable(3, { turnSeconds: 30 }); drawDiscardReveal(s, 11);
  const id = s.turn!, finalTurns = [...s.finalTurns], deadline = s.deadline;
  act(s, id, 'take'); act(s, 'p0', 'display-mode', { mode: 'tv' }); act(s, id, 'return-discard');
  assert.equal(s.turn, id); assert.deepEqual(s.finalTurns, finalTurns); assert.equal(s.deadline, deadline);
  assert.equal(s.finisher, 'p0'); assert.equal(s.phase, 'PLAY'); assert.equal(s.step, 'choose');
  drawDiscardReveal(s, 11); assert.equal(s.turn, 'p2'); assert.deepEqual(s.finalTurns, ['p2']);
});

test('return-discard cannot undo draws, keeps, public discards, flips or completed swaps and rejects other players or paused play', () => {
  const reject = (s: SkyState, actor: string) => {
    const before = structuredClone(s); assert.throws(() => act(s, actor, 'return-discard')); assert.deepEqual(s, before);
  };
  for (const stage of ['setup', 'choose', 'drawn', 'kept', 'discarded', 'revealed', 'swapped']) {
    const s = room(3, {}, stage !== 'setup'), id = s.turn ?? 'p0';
    if (stage === 'swapped') { act(s, id, 'take'); act(s, id, 'replace', { index: 4 }); }
    else if (['drawn', 'kept', 'discarded', 'revealed'].includes(stage)) {
      act(s, id, 'draw');
      if (stage === 'kept') act(s, id, 'keep');
      else if (stage !== 'drawn') { act(s, id, 'discard'); if (stage === 'revealed') act(s, id, 'reveal', { index: 4 }); }
    }
    reject(s, id);
  }
  const s = room(), id = s.turn!; act(s, id, 'take'); reject(s, s.order.find(p => p !== id)!);
  act(s, 'p0', 'pause'); reject(s, id); act(s, 'p0', 'resume'); act(s, id, 'return-discard'); conserved(s);
});

test('take/return retries cannot duplicate cards or reverse a later discard selection', () => {
  const s = room(), id = s.turn!, take = action(s, 'take'); applyAction(s, id, take);
  const cancel = action(s, 'return-discard'); applyAction(s, id, cancel);
  const returned = structuredClone(s); applyAction(s, id, take); applyAction(s, id, cancel); assert.deepEqual(s, returned);
  act(s, id, 'take'); const selectedAgain = structuredClone(s);
  applyAction(s, id, cancel); assert.deepEqual(s, selectedAgain);
  assert.throws(() => applyAction(s, id, { ...action(s, 'return-discard'), revision: s.revision - 1 }), /table changed/);
  assert.deepEqual(s, selectedAgain); act(s, id, 'return-discard'); conserved(s);
});

test('discarding a draw requires revealing exactly one hidden position', () => {
  const s = room(), id = s.turn!; act(s, id, 'draw'); const c = s.pending!.card; act(s, id, 'discard'); assert.equal(s.step, 'reveal'); assert.deepEqual(s.discard.at(-1), c);
  assert.throws(() => act(s, id, 'reveal', { index: 0 }), /face-down/); assert.throws(() => act(s, id, 'replace', { index: 2 }));
  act(s, id, 'reveal', { index: 2 }); assert.ok(s.grids[id][2]!.faceUp); assert.notEqual(s.turn, id); conserved(s);
});
test('a drawn card replaces both revealed and hidden positions without extra flips', () => {
  for (const index of [0, 7]) { const s = room(), id = s.turn!, old = s.grids[id][index]!.card; act(s, id, 'draw'); const c = s.pending!.card; act(s, id, 'keep'); act(s, id, 'replace', { index }); assert.deepEqual(s.discard.at(-1), old); assert.deepEqual(s.grids[id][index], { card: c, faceUp: true }); conserved(s); }
});
test('matching columns clear automatically after the exchanged card, retaining exact positions and discard order', () => {
  const s = room(); s.turn = 'p0'; const a = slot(7), b = slot(7), old = slot(12, false); s.grids.p0[2] = a; s.grids.p0[6] = b; s.grids.p0[10] = old;
  const incoming = card(7); s.discard.push(incoming); act(s, 'p0', 'take'); act(s, 'p0', 'replace', { index: 10 });
  assert.deepEqual(s.discard.slice(-4), [old.card, a.card, b.card, incoming]); assert.ok([2, 6, 10].every(i => s.grids.p0[i] === null)); assert.equal(s.grids.p0.length, 12); assert.ok(s.grids.p0[3]);
});
test('negative matching columns must clear; hidden matches do not clear', () => {
  const s = room(); for (const value of [-2, -1]) { for (const i of [0, 4, 8]) s.grids.p0[i] = slot(value); removeColumns(s, 'p0', 2000); assert.ok([0, 4, 8].every(i => s.grids.p0[i] === null)); }
  for (const i of [0, 4, 8]) s.grids.p0[i] = slot(4, i !== 8); removeColumns(s, 'p0', 2000); assert.ok(s.grids.p0[0]);
});
test('removed positions, invalid coordinates, and out-of-turn actions are rejected', () => {
  const s = room(); s.turn = 'p0'; s.grids.p0[0] = null; act(s, 'p0', 'take');
  for (const index of [-1, 12, 1.2, '2', null, 0]) assert.throws(() => act(s, 'p0', 'replace', { index }));
  assert.throws(() => act(s, 'p1', 'replace', { index: 3 }), /turn/);
});
test('the finisher gets no extra turn; all other players get exactly one in seat order', () => {
  const s = endable(8); drawDiscardReveal(s, 11); assert.equal(s.finisher, 'p0'); assert.deepEqual(s.finalTurns, s.order.slice(1));
  for (let i = 1; i < 8; i++) { assert.equal(s.turn, `p${i}`); drawDiscardReveal(s, 11); }
  assert.equal(s.phase, 'RESULTS'); assert.equal(s.turn, null); assert.equal(s.history.length, 1);
});
test('clearing the last hidden-containing column can finish a round, and empty positions score zero', () => {
  const s = endable(2, { columns: true }); s.grids.p0 = Array(12).fill(null); s.grids.p0[0] = slot(4); s.grids.p0[4] = slot(4); s.grids.p0[8] = slot(4, false);
  drawDiscardReveal(s, 8); assert.equal(s.finisher, 'p0'); drawDiscardReveal(s, 11); assert.equal(s.result?.raw.p0, 0);
});
test('final reveals remove extra matching columns before calculating scores', () => {
  const s = endable(2, { columns: true }); s.grids.p1 = Array.from({ length: 12 }, (_, i) => slot(i % 4, i < 2));
  drawDiscardReveal(s, 11); drawDiscardReveal(s, 3); assert.equal(s.phase, 'RESULTS'); assert.ok(s.grids.p1.every(c => c === null)); assert.equal(s.result?.raw.p1, 0);
});
test('positive finisher scores double on a lower or tied opponent score, after final reveals', () => {
  for (const other of [0, 1]) { const s = endable(2); s.grids.p1 = Array.from({ length: 12 }, (_, i) => slot(other, i !== 11)); close(s); assert.equal(s.result?.raw.p0, 12); assert.equal(s.result?.scores.p0, 24); assert.ok(s.result?.doubled); }
});
test('strictly lowest, zero, and negative finisher scores are never doubled', () => {
  for (const value of [1, 0, -1, -2]) { const s = endable(2); s.grids.p0 = Array.from({ length: 12 }, (_, i) => slot(value, i !== 11)); close(s); assert.equal(s.result?.scores.p0, value * 12); assert.equal(s.result?.doubled, false); }
  const s = endable(2); s.grids.p0 = Array.from({ length: 12 }, (_, i) => slot(-1, i !== 11)); s.grids.p1 = Array.from({ length: 12 }, (_, i) => slot(-2, i !== 11)); close(s); assert.equal(s.result?.scores.p0, -12);
});
test('threshold is checked after a round and lowest cumulative score wins, including co-winners', () => {
  const s = endable(3); s.totals = { p0: 0, p1: 90, p2: -12 }; drawDiscardReveal(s, 11); assert.equal(s.phase, 'PLAY'); drawDiscardReveal(s, 11); drawDiscardReveal(s, 11);
  assert.equal(s.phase, 'COMPLETED'); assert.deepEqual(s.winners, ['p0', 'p2']); assert.equal(s.totals.p1, 114);
});
test('previous round finisher starts the next round independently of opening sums', () => {
  const s = endable(2); close(s); act(s, 'p0', 'next-round'); for (const id of s.order) for (const index of [0, 1]) act(s, id, 'setup', { index }); assert.equal(s.turn, 'p0'); assert.equal(s.round, 2);
});
test('house rules independently disable columns and penalty, adjust opening cards and use fixed rounds', () => {
  const s = endable(2, { fixedRounds: 1, columns: false, penalty: false, startingCards: 4 }); s.grids.p1 = Array.from({ length: 12 }, (_, i) => slot(0, i !== 11)); close(s);
  assert.equal(s.phase, 'COMPLETED'); assert.equal(s.result?.scores.p0, 12); assert.ok(s.grids.p1.every(Boolean)); assert.equal(s.result?.doubled, false); assert.equal(SKY_PROFILES[1].rules.target, 50); assert.equal(SKY_PROFILES[2].rules.target, 150);
});
test('draw pile exhaustion preserves the top discard and shuffles all other discards', () => {
  const s = room(); s.discard.push(...s.deck); s.deck = []; const top = s.discard.at(-1)!; act(s, s.turn!, 'draw'); assert.deepEqual(s.discard, [top]); assert.ok(s.deck.length > 0); assert.ok(s.events.some(e => e.type === 'shuffle')); conserved(s);
});
test('a final-turn player with no hidden positions must keep and replace a drawn card', () => {
  const s = endable(2); s.grids.p1[11]!.faceUp = true; drawDiscardReveal(s, 11); act(s, 'p1', 'draw'); assert.throws(() => act(s, 'p1', 'discard'), /No hidden/); act(s, 'p1', 'keep'); act(s, 'p1', 'replace', { index: 4 }); assert.equal(s.phase, 'RESULTS');
});
test('invalid settings, permissions, and mid-game rule changes are rejected', () => {
  for (const raw of [null, [], { rules: [] }, { rules: { target: NaN } }, { rules: { startingCards: 12 } }, { rules: { turnSeconds: '10' } }, { rules: { columns: 1 } }, { displayMode: 'x' }, { autoNext: 1 }]) assert.throws(() => checkedSkySettings(raw));
  const s = room(); assert.throws(() => act(s, 'p0', 'settings', { settings: DEFAULT_SKY_SETTINGS }), /locked/); assert.throws(() => act(s, 'p1', 'pause'), /host/); assert.throws(() => act(s, '$display', 'draw'), /Unknown/);
});
test('lobby management accepts only actual seats, supports reordering/removal, and requires two players', () => {
  const s = room(2); act(s, 'p0', 'lobby');
  for (const id of ['__proto__', 'constructor', 'missing']) {
    assert.throws(() => act(s, 'p0', 'reorder', { order: ['p0', id] }), /Invalid seat/);
    assert.throws(() => act(s, 'p0', 'remove', { playerId: id }), /lobby players/);
  }
  act(s, 'p0', 'reorder', { order: ['p1', 'p0'] }); assert.deepEqual(s.order, ['p1', 'p0']);
  assert.throws(() => act(s, 'p1', 'remove', { playerId: 'p0' }), /host/);
  act(s, 'p0', 'remove', { playerId: 'p1' }); assert.equal(s.order.length, 1); assert.throws(() => act(s, 'p0', 'start'), /2–8/);
});
test('duplicate commands are idempotent, stale races cannot draw twice, and restart rejects old generations', () => {
  const s = room(), id = s.turn!, a = action(s, 'draw'), b = action(s, 'draw'); applyAction(s, id, a); const before = structuredClone(s); applyAction(s, id, a); assert.deepEqual(s, before); assert.throws(() => applyAction(s, id, b), /table changed/);
  const old = action(s, 'keep'); act(s, 'p0', 'restart'); assert.throws(() => applyAction(s, id, old), /round changed/); assert.equal(s.round, 1);
});
test('dynamic display switching preserves every gameplay field and accepts an in-flight decision', () => {
  const s = room(3, { turnSeconds: 30 }); act(s, s.turn!, 'draw'); const a = action(s, 'keep');
  const snapshot = () => ({ ...s, settings: { ...s.settings, displayMode: 'normal' }, version: 0, processed: [], expiresAt: 0 });
  const before = structuredClone(snapshot()); act(s, 'p0', 'display-mode', { mode: 'tv' }); assert.deepEqual(snapshot(), before); act(s, 'p0', 'display-mode', { mode: 'normal' }); assert.deepEqual(snapshot(), before);
  applyAction(s, s.turn!, a); assert.equal(s.step, 'replace');
});
test('pause/resume shifts deadlines, preserves a private draw, and blocks gameplay while paused', () => {
  const s = room(3, { turnSeconds: 20 }); act(s, s.turn!, 'draw'); const c = s.pending!.card, deadline = s.deadline!; act(s, 'p0', 'pause', {}, 2500); assert.equal(expireState(s, 50000), false); assert.throws(() => act(s, s.turn!, 'keep'), /not accepting/);
  act(s, 'p0', 'extend', {}, 50000); act(s, 'p0', 'resume', {}, 52500); assert.equal(s.deadline, deadline + 80000); assert.deepEqual(s.pending?.card, c);
});
test('timers default off; pause timeout makes no decision; resume supplies a new full turn budget', () => {
  assert.equal(room().deadline, null); const s = room(2, { turnSeconds: 5 }); const before = structuredClone(s.grids), at = s.deadline!; expireState(s, at); assert.equal(s.pausedAt, at); assert.deepEqual(s.grids, before); act(s, 'p0', 'resume', {}, at + 50000); assert.equal(s.deadline, at + 55000);
});
test('explicit automatic timeouts resolve setup, draw, kept/taken cards, and reveal without choosing by hidden values', () => {
  for (const step of ['choose', 'drawn', 'replace', 'take', 'reveal']) {
    const s = room(2, { turnSeconds: 5, timeout: 'automatic' }), id = s.turn!;
    if (step === 'take') act(s, id, 'take'); else if (step !== 'choose') { act(s, id, 'draw'); if (step === 'replace') act(s, id, 'keep'); if (step === 'reveal') act(s, id, 'discard'); }
    expireState(s, s.deadline!); assert.notEqual(s.turn, id); assert.equal(s.step, 'choose'); assert.ok(s.grids[id][2]!.faceUp); conserved(s);
  }
  const s = room(8, { turnSeconds: 5, timeout: 'automatic' }, false); expireState(s, s.deadline!); assert.equal(s.phase, 'PLAY'); assert.ok(Object.values(s.starting).every(v => v === 2)); conserved(s);
});
test('host recovery requires an offline decision maker and uses the documented automatic policy', () => {
  const s = room(); assert.throws(() => act(s, 'p0', 'recover'), /offline/); const id = s.turn!; s.players[id].connected = false; act(s, 'p0', 'recover'); assert.notEqual(s.turn, id); assert.equal(s.order.length, 3); conserved(s);
});
test('automatic rounds use authoritative alarms and preserve the results countdown across pause', () => {
  const s = endable(2); s.settings.autoNext = true; close(s); const at = s.nextRoundAt!; assert.equal(nextDeadline(s), at); act(s, 'p0', 'pause', {}, at - 1000); assert.equal(expireState(s, at + 5000), false); act(s, 'p0', 'resume', {}, at + 9000); expireState(s, at + 10000); assert.equal(s.phase, 'SETUP'); assert.equal(s.round, 2);
});
test('full games at 2, 6 and 8 players preserve all 150 physical cards across every transition', () => {
  for (let run = 0; run < 15; run++) {
    const s = room([2, 6, 8][run % 3], { fixedRounds: 3 }, false); s.rng = run * 1001 + 3;
    for (let i = 0; i < 8000 && s.phase !== 'COMPLETED'; i++) {
      if (s.phase === 'SETUP') { for (const id of s.order) for (let j = 0; j < s.settings.rules.startingCards; j++) act(s, id, 'setup', { index: j }); }
      else if (s.phase === 'RESULTS') act(s, 'p0', 'next-round');
      else {
        const id = s.turn!, g = s.grids[id], h = g.findIndex(c => c && !c.faceUp), index = h >= 0 ? h : g.findIndex(Boolean);
        if (s.step === 'choose') act(s, id, i % 5 === 0 ? 'take' : 'draw');
        else if (s.step === 'drawn') act(s, id, i % 3 === 0 && h >= 0 ? 'discard' : 'keep');
        else act(s, id, s.step, { index });
      }
      conserved(s);
    }
    assert.equal(s.phase, 'COMPLETED'); assert.equal(s.history.length, 3); assert.ok(s.winners.length); for (const id of s.winners) assert.equal(s.totals[id], Math.min(...Object.values(s.totals)));
  }
});

function adapter(stored: SkyState) {
  const data = new Map<string, unknown>([['skyjo', structuredClone(stored)]]);
  const storage = { get: async (key: string) => structuredClone(data.get(key)), put: async (key: string, v: unknown) => { data.set(key, structuredClone(v)); }, setAlarm: async () => {}, deleteAlarm: async () => {} };
  const ctx = { storage, blockConcurrencyWhile: async (f: () => Promise<unknown>) => f(), waitUntil: (p: Promise<unknown>) => { void p; } };
  return { room: new SkyjoRoom(ctx as unknown as DurableObjectState, {} as Env), data };
}
function req(route: string, token?: string, payload?: unknown) { return new Request(`https://test/api/game/1234/${route}`, { method: payload === undefined ? 'GET' : 'POST', headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), 'Content-Type': 'application/json' }, ...(payload === undefined ? {} : { body: JSON.stringify(payload) }) }); }
test('room authentication rejects displays from every mutation and returns safe snapshots on refresh', async () => {
  const s = room(); s.expiresAt = Date.now() + 600000; const a = adapter(s); assert.equal((await a.room.fetch(req('state'))).status, 401);
  const v = await (await a.room.fetch(req('state', 'secret-display'))).json() as SkyView; assert.equal(v.yourRole, 'DISPLAY'); assert.equal(v.displayUrl, undefined); assert.equal(v.yourCard, null);
  for (const type of ['draw', 'keep', 'cancel-keep', 'return-discard', 'reveal', 'pause', 'display-mode', 'end', 'settings']) assert.equal((await a.room.fetch(req('action', 'secret-display', action(s, type)))).status, 403);
});
test('durable reload restores private pending decisions and separate lobbies remain independent', async () => {
  const s = room(); s.expiresAt = Date.now() + 600000; const id = s.turn!; act(s, id, 'draw', {}, Date.now()); const pending = s.pending!.card;
  const a = adapter(s), other = adapter(room()); const token = s.players[id].token;
  const v = await (await a.room.fetch(req('state', token))).json() as SkyView; assert.equal(v.yourPlayerId, id); assert.deepEqual(v.yourCard, pending); assert.equal(v.revision, s.revision);
  assert.equal((await a.room.fetch(req('action', token, action(s, 'keep')))).status, 200);
  const b = adapter(a.data.get('skyjo') as SkyState), restored = await (await b.room.fetch(req('state', token))).json() as SkyView; assert.equal(restored.step, 'replace'); assert.deepEqual(restored.yourCard, pending); assert.equal((other.data.get('skyjo') as SkyState).pending, null);
});
test('a kept private draw can be reconsidered after durable reload without returning it to the deck', async () => {
  const s = room(), id = s.turn!; act(s, id, 'draw', {}, Date.now()); act(s, id, 'keep', {}, Date.now());
  const a = adapter(s), token = s.players[id].token, card = s.pending!.card, deck = structuredClone(s.deck);
  assert.equal((await a.room.fetch(req('action', token, action(s, 'cancel-keep')))).status, 200);
  const stored = a.data.get('skyjo') as SkyState; conserved(stored); assert.deepEqual(stored.deck, deck);
  const b = adapter(stored), restored = await (await b.room.fetch(req('state', token))).json() as SkyView;
  assert.equal(restored.step, 'drawn'); assert.deepEqual(restored.yourCard, card); assert.equal(restored.pending?.source, 'deck');
  const display = await (await b.room.fetch(req('state', 'secret-display'))).json() as SkyView;
  assert.equal(display.yourCard, null); assert.equal(display.pending?.card, null);
});

test('a discard selection can be returned after durable reload and the restored pile persists on the next reload', async () => {
  const s = room(), id = s.turn!, discard = structuredClone(s.discard), deck = structuredClone(s.deck), grids = structuredClone(s.grids);
  act(s, id, 'take', {}, Date.now()); const a = adapter(s), token = s.players[id].token;
  const selected = await (await a.room.fetch(req('state', token))).json() as SkyView;
  assert.deepEqual(selected.yourCard, discard.at(-1));
  assert.equal((await a.room.fetch(req('action', token, action(s, 'return-discard')))).status, 200);
  const stored = a.data.get('skyjo') as SkyState; conserved(stored);
  assert.deepEqual(stored.discard, discard); assert.deepEqual(stored.deck, deck); assert.deepEqual(stored.grids, grids);
  const b = adapter(stored), restored = await (await b.room.fetch(req('state', token))).json() as SkyView;
  assert.equal(restored.step, 'choose'); assert.equal(restored.pending, null); assert.equal(restored.yourCard, null);
  assert.equal(restored.turn, id); assert.deepEqual(restored.discardTop, discard.at(-1));
});

test('rejected room commands do not mutate persisted state, even on malformed payloads', async () => {
  const s = room(); s.expiresAt = Date.now() + 600000; const a = adapter(s), before = structuredClone(a.data.get('skyjo'));
  assert.equal((await a.room.fetch(req('action', 'secret-host', action(s, 'replace', { index: 200 })))).status, 400);
  assert.deepEqual(a.data.get('skyjo'), before);
});
