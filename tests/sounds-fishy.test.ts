import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { applyAction, checkedSettings, createState, expireState, playerDisconnected, roundTotal, scoreRound, serializeForPlayer, type FishyState, type StoredPlayer } from '../backend-do/src/soundsFishy/engine.js';
import { defaultFishySettings, type FishyAction, type FishySettings } from '../shared/soundsFishy.js';
import { fishyBanks, fishyBankSummaries } from '../backend-do/src/generated/soundsFishyBanks.js';
// The same dependency-free validator is used by the build script.
// @ts-ignore plain JavaScript module
import { validateFishyBank } from '../shared/fishyBank.mjs';
const now = 1_000_000;
function player(i: number): StoredPlayer { return { playerId: `p${i}`, token: `token-${i}`, nickname: `Player ${i}`, role: i ? 'PLAYER' : 'HOST', connected: true, disconnectedAt: null, participating: true, pending: false }; }
function lobby(count = 4, settings: Partial<FishySettings> = {}) {
  const s = createState('1234', player(0), 'private-host-token', { ...defaultFishySettings, ...settings }, now);
  for (let i = 1; i < count; i++) { const p = player(i); s.players[p.playerId] = p; s.order.push(p.playerId); s.scores[p.playerId] = 0; }
  return s;
}
function command(s: FishyState, type: string, payload: Record<string, unknown> = {}, actor = 'p0', at = now): FishyAction {
  const a: FishyAction = { id: crypto.randomUUID(), type, payload, generation: s.generation, roundId: s.roundId, phase: s.phase };
  applyAction(s, actor, a, at); return a;
}
function start(count = 4, settings: Partial<FishySettings> = {}) { const s = lobby(count, settings); command(s, 'start'); return s; }
const blue = (s: FishyState) => s.fish.find(id => s.roles[id] === 'blue')!;
const reds = (s: FishyState) => s.fish.filter(id => s.roles[id] === 'red');

test('official totals for every supported size and clockwise equal Guesser rotations', () => {
  assert.deepEqual(Array.from({ length: 7 }, (_, i) => roundTotal(defaultFishySettings, i + 4)), [8, 10, 6, 7, 8, 9, 10]);
  for (let n = 4; n <= 10; n++) {
    const s = start(n), turns: string[] = [];
    for (let i = 0; i < s.totalRounds; i++) {
      turns.push(s.guesserId!);
      assert.equal(Object.keys(s.roles).length, n - 1);
      assert.equal(Object.values(s.roles).filter(r => r === 'blue').length, 1);
      assert.equal(Object.values(s.roles).filter(r => r === 'red').length, n - 2);
      assert(!Object.hasOwn(s.roles, s.guesserId!));
      command(s, 'present'); command(s, 'bank'); command(s, 'next');
    }
    assert.equal(s.phase, 'COMPLETED');
    assert.deepEqual(turns, Array.from({ length: s.totalRounds }, (_, i) => `p${i % n}`));
    assert.equal(serializeForPlayer(s, 'p0').winners.length, n);
  }
});
test('official scoring: zero bank, early bank, blue first/after reds, all reds bonus', () => {
  const roles = { a: 'red', b: 'blue', c: 'red', d: 'red' } as const;
  assert.deepEqual(scoreRound('g', roles, []), { g: 0, a: 0, b: 0, c: 0, d: 0 });
  assert.deepEqual(scoreRound('g', roles, ['a']), { g: 1, a: 0, b: 0, c: 1, d: 1 });
  assert.deepEqual(scoreRound('g', roles, ['b']), { g: 0, a: 1, b: 3, c: 1, d: 1 });
  assert.deepEqual(scoreRound('g', roles, ['a', 'b']), { g: 0, a: 0, b: 2, c: 2, d: 2 });
  assert.deepEqual(scoreRound('g', roles, ['a', 'c', 'd']), { g: 4, a: 0, b: 0, c: 0, d: 0 });
  assert.throws(() => scoreRound('g', roles, ['b', 'a']), /after blue/);
  assert.throws(() => scoreRound('g', roles, ['a', 'a']), /Invalid eliminations/);
});
test('all reds finish automatically; earlier totals survive catching blue', () => {
  const s = start(); s.scores.p0 = 5; command(s, 'present');
  for (const id of reds(s)) command(s, 'eliminate', { playerId: id });
  assert.equal(s.result?.outcome, 'all-reds'); assert.equal(s.scores.p0, 8);
  command(s, 'next'); command(s, 'present'); const guesser = s.guesserId!; s.scores[guesser] = 11;
  command(s, 'eliminate', { playerId: blue(s) }); assert.equal(s.scores[guesser], 11);
});
test('duplicate action IDs, repeated eliminations, stale round IDs and restarts cannot rescore', () => {
  const s = start(); command(s, 'present');
  const id = reds(s)[0], a = command(s, 'eliminate', { playerId: id });
  const v = s.version; applyAction(s, 'p0', a, now); assert.equal(s.version, v);
  assert.throws(() => command(s, 'eliminate', { playerId: id }), /unavailable/);
  const bank = command(s, 'bank'), scores = { ...s.scores };
  applyAction(s, 'p0', bank, now); assert.deepEqual(s.scores, scores);
  assert.throws(() => command(s, 'eliminate', { playerId: blue(s) }), /cannot eliminate/);
  const old = { ...a, id: crypto.randomUUID() }; command(s, 'next');
  assert.throws(() => applyAction(s, 'p0', old, now), /stale/);
  command(s, 'restart'); assert.equal(s.generation, 2); assert.equal(s.question, null);
  command(s, 'start'); assert.throws(() => applyAction(s, 'p0', old, now), /stale/);
});
test('host Guesser/public/spectator/reconnection projections contain no current secrets', () => {
  const s = start(4, { mode: 'written' });
  const secret = s.question!.answer;
  command(s, 'submit', { answer: 'invented answer' }, reds(s)[0]);
  for (const id of ['p0', '$display', 'late']) {
    const v = serializeForPlayer(structuredClone(s), id);
    assert.equal(v.answer, undefined); assert.equal(v.ownRole, undefined);
    assert.deepEqual(v.roles, {}); assert.equal(v.answers, undefined);
    assert.equal(v.explanation, undefined); assert.equal(v.sources, undefined);
    const json = JSON.stringify(v);
    for (const key of ['acceptedAnswers', 'verificationNotes', 'private-host-token', 'token-', 'invented answer']) assert(!json.includes(key));
    assert(!Object.values(v).includes(secret));
  }
  const red = reds(s)[0], v = serializeForPlayer(s, red);
  assert.equal(v.answer, secret); assert.equal(v.ownRole, 'red'); assert.deepEqual(v.roles, {});
  assert.equal(v.ownSubmission, 'invented answer'); assert.equal(v.explanation, undefined);
  command(s, 'submit', {}, blue(s)); command(s, 'submit', { answer: 'another bluff' }, reds(s)[1]);
  assert.equal(s.phase, 'ELIMINATION');
  assert.equal(serializeForPlayer(s, 'p0').answer, undefined);
  assert.equal(Object.keys(serializeForPlayer(s, '$display').answers!).length, 3);
});
test('non-guesser host, including host as Blue, gets only their own private role', () => {
  const s = lobby(); command(s, 'starting-player', { playerId: 'p1' }); command(s, 'start');
  const b = blue(s); [s.roles.p0, s.roles[b]] = ['blue', s.roles.p0];
  const v = serializeForPlayer(s, 'p0'); assert.equal(v.ownRole, 'blue'); assert.equal(v.answer, s.question!.answer); assert.deepEqual(v.roles, {});
  assert.equal(serializeForPlayer(s, 'p1').answer, undefined);
  command(s, 'settings', { facilitator: false });
  command(s, 'present', {}, 'p1'); command(s, 'bank', {}, 'p1'); command(s, 'next'); command(s, 'present', {}, 'p2');
  assert.throws(() => command(s, 'eliminate', { playerId: s.fish[0] }), /Only the Guesser/);
});
test('written collection reveals atomically, locks Blue to truth and rejects equivalent bluffs', () => {
  const s = start(4, { mode: 'written' }); const b = blue(s), red = reds(s)[0];
  const a = command(s, 'submit', { answer: 'malicious incorrect edit' }, b);
  assert.equal(s.submissions[b], s.question!.answer);
  applyAction(s, b, a, now); assert.equal(Object.keys(s.submissions).length, 1);
  assert.throws(() => command(s, 'submit', { answer: 'different' }, b), /locked/);
  assert.throws(() => command(s, 'submit', { answer: s.question!.answer.toUpperCase() }, red), /matches the real/);
  s.question!.acceptedAnswers.push('Die äquivalente Antwort');
  assert.throws(() => command(s, 'submit', { answer: 'DIE ÄQUIVALENTE ANTWORT!' }, red), /matches the real/);
  assert.throws(() => command(s, 'submit', { answer: ' ' }, red), /1–240/);
  assert.throws(() => command(s, 'submit', { answer: 'x'.repeat(241) }, red), /1–240/);
  command(s, 'submit', { answer: 'Grüße aus dem Meer' }, red);
  assert.equal(serializeForPlayer(s, 'p0').answers, undefined);
  command(s, 'submit', { answer: 'A different bluff' }, reds(s)[1]);
  assert.equal(s.phase, 'ELIMINATION'); assert.equal(serializeForPlayer(s, 'p0').answers![red], 'Grüße aus dem Meer');
});
test('permissions reject impersonation, player score edits and unauthorized settings', () => {
  const s = start(4, { facilitator: false }); command(s, 'present');
  for (const type of ['settings', 'next', 'void', 'score', 'transfer-host', 'end', 'restart']) assert.throws(() => command(s, type, {}, 'p1'), /Only the host/);
  assert.throws(() => command(s, 'bank', {}, 'p1'), /Only the Guesser/);
  assert.throws(() => command(s, 'bank', {}, 'unknown'), /Unknown player/);
  assert.throws(() => command(s, 'submit', { answer: 'fake' }), /Only fish/);
});
test('timers stay authoritative, preserve pause remainders, bank once and pause missing written answers', () => {
  const s = start(4, { preparationSeconds: 15, decisionSeconds: 30 });
  command(s, 'pause', {}, 'p0', now + 5000); assert.equal(s.pausedRemaining, 10_000);
  assert.equal(expireState(s, now + 100_000), false);
  command(s, 'resume', {}, 'p0', now + 100_000); assert.equal(s.deadline, now + 110_000);
  assert(expireState(s, now + 110_000)); assert.equal(s.phase, 'ELIMINATION');
  assert(expireState(s, now + 140_000)); assert.equal(s.result?.outcome, 'banked');
  const scores = { ...s.scores }; assert.equal(expireState(s, now + 140_001), false); assert.deepEqual(s.scores, scores);
  const w = start(4, { mode: 'written', preparationSeconds: 15 });
  assert(expireState(w, now + 15000)); assert(w.paused); assert.equal(w.phase, 'COLLECTION'); assert.deepEqual(w.submissions, {});
});
test('mode switches preserve private assignments and submissions until the next round', () => {
  const s = start(4, { mode: 'written' }); const id = blue(s), q = s.question!.id, roles = { ...s.roles };
  command(s, 'submit', {}, id); command(s, 'settings', { mode: 'party' });
  assert.equal(s.roundSettings!.mode, 'written'); assert.deepEqual(s.roles, roles); assert.equal(s.question!.id, q); assert(s.submissions[id]);
  for (const red of reds(s)) command(s, 'submit', { answer: `bluff ${red}` }, red);
  command(s, 'bank'); command(s, 'next'); assert.equal(s.phase, 'PREPARATION'); assert.equal(s.roundSettings!.mode, 'party');
});
test('disconnect/reconnect preserves Blue and submissions and pauses a missing Guesser', () => {
  const s = start(4, { mode: 'written' }); const b = blue(s), roles = { ...s.roles };
  playerDisconnected(s, b, now); assert(s.paused); assert.deepEqual(s.roles, roles);
  s.players[b].connected = true; command(s, 'resume'); command(s, 'submit', {}, b);
  playerDisconnected(s, b, now); assert(!s.paused); assert.equal(serializeForPlayer(s, b).ownSubmission, s.question!.answer);
  for (const red of reds(s)) command(s, 'submit', { answer: `bluff ${red}` }, red);
  playerDisconnected(s, s.guesserId!, now); assert(s.paused); assert.equal(serializeForPlayer(s, s.guesserId!).answer, undefined);
});
test('voiding rolls back scoring, replay keeps Guesser, changes roles/round ID and uses a new question', () => {
  const s = start(); const oldId = s.roundId, q = s.question!.id; command(s, 'present'); command(s, 'eliminate', { playerId: reds(s)[0] }); command(s, 'bank');
  assert(s.scores.p0 > 0); command(s, 'void', { reason: 'Ambiguous answer' }); assert(Object.values(s.scores).every(n => n === 0));
  command(s, 'next'); assert.equal(s.round, 1); assert.equal(s.guesserId, 'p0'); assert.notEqual(s.roundId, oldId); assert.notEqual(s.question!.id, q);
  const fresh = s.question!.id; command(s, 'replace'); assert.notEqual(s.question!.id, fresh); assert.equal(s.guesserId, 'p0');
});
test('host transfer/recovery preserve roles, require grace period and revoke old host authority', () => {
  const s = start(), roles = { ...s.roles };
  command(s, 'transfer-host', { playerId: 'p1' }); assert.deepEqual(s.roles, roles);
  assert.throws(() => command(s, 'pause'), /Only the host/);
  command(s, 'pause', {}, 'p1'); playerDisconnected(s, 'p1', now);
  assert.throws(() => command(s, 'claim-host', {}, 'p2', now + 59000), /60 seconds/);
  command(s, 'claim-host', {}, 'p2', now + 61000); assert.equal(s.players.p2.role, 'HOST'); assert.deepEqual(s.roles, roles);
  assert(s.audit.length === 2);
});
test('voiding a corrected result restores its prior totals without negative scores or residual corrections', () => {
  const s = start(); command(s, 'present'); command(s, 'eliminate', { playerId: reds(s)[0] }); command(s, 'bank');
  command(s, 'score', { playerId: 'p0', delta: -1, reason: 'Remove mistaken point' });
  assert.equal(s.scores.p0, 0);
  command(s, 'score', { playerId: 'p1', delta: 3, reason: 'Result adjustment' });
  command(s, 'void', { reason: 'Invalid question after review' });
  assert(Object.values(s.scores).every(n => n === 0));
  command(s, 'next'); assert.equal(s.guesserId, 'p0'); assert.equal(s.round, 1);
});
test('custom lengths, starting seat, late spectators and score audit remain explicit', () => {
  assert.equal(roundTotal({ ...defaultFishySettings, lengthMode: 'rotations', rotations: 3 }, 5), 15);
  const s = lobby(4, { lengthMode: 'rounds', rounds: 1 }); command(s, 'starting-player', { playerId: 'p2' }); command(s, 'start'); assert.equal(s.guesserId, 'p2');
  const late = player(4); late.pending = true; late.participating = false; s.players.p4 = late; s.order.push('p4');
  assert.equal(serializeForPlayer(s, 'p4').answer, undefined);
  command(s, 'present'); command(s, 'bank'); command(s, 'next'); assert(!serializeForPlayer(s, 'p0').winners.includes('p4'));
  command(s, 'score', { playerId: 'p1', delta: 2, reason: 'Host correction' }); assert.equal(s.scores.p1, 2); assert.equal(s.audit.length, 1);
  command(s, 'restart'); assert(s.players.p4.participating); assert(!s.players.p4.pending);
});
test('automatic progression can be cancelled or paused without scoring twice', () => {
  const s = start(4, { autoNext: true }); command(s, 'present'); command(s, 'bank'); assert.equal(s.deadline, now + 8000);
  command(s, 'settings', { autoNext: false }); assert.equal(s.deadline, null); assert.equal(expireState(s, now + 9000), false);
  command(s, 'settings', { autoNext: true }); command(s, 'pause'); assert.equal(expireState(s, now + 9000), false);
  command(s, 'resume'); assert(expireState(s, now + 8000)); assert.equal(s.round, 2);
});
test('bank import validates contract, empty/invalid fields, duplicate IDs and duplicate prompts', () => {
  for (const bank of Object.values(fishyBanks)) validateFishyBank(bank);
  const bank = structuredClone(Object.values(fishyBanks)[0]);
  assert.throws(() => validateFishyBank({ ...bank, questions: [] }), /empty/);
  assert.throws(() => validateFishyBank({ ...bank, schemaVersion: 2 }), /schemaVersion/);
  const ids = structuredClone(bank); ids.questions[1].id = ids.questions[0].id; assert.throws(() => validateFishyBank(ids), /unique/);
  const duplicate = structuredClone(bank); duplicate.questions[1].question = duplicate.questions[0].question.toUpperCase(); assert.throws(() => validateFishyBank(duplicate), /duplicate question/);
  const noSource = structuredClone(bank); noSource.questions[0].sources = []; assert.throws(() => validateFishyBank(noSource), /sources/);
  assert.throws(() => checkedSettings(defaultFishySettings, { bankId: 'missing' }), /unavailable/);
  assert.throws(() => checkedSettings(defaultFishySettings, { bankId: '__proto__' }), /unavailable/);
  assert.throws(() => command(lobby(3), 'start'), /4–10/);
});
test('question draws never repeat until exhaustion, report cycles, retain used voided questions and fallback safely', () => {
  const s = start(4, { lengthMode: 'rounds', rounds: 200 }); const seen = new Set<string>();
  const size = fishyBanks[s.settings.bankId].questions.length;
  for (let i = 0; i < size; i++) { assert(!seen.has(s.question!.id)); seen.add(s.question!.id); command(s, 'present'); command(s, 'bank'); if (i < size - 1) command(s, 'next'); }
  const last = s.question!.id; command(s, 'next'); assert.notEqual(s.question!.id, last); assert.equal(s.cycle[s.settings.bankId], 2); assert.match(s.notice!, /exhausted/);
  s.settings.bankId = 'removed-after-deployment'; command(s, 'replace'); assert(Object.hasOwn(fishyBanks, s.settings.bankId));
});
test('installed classic English and German banks have 150 full questions each and stay private throughout a draw cycle', () => {
  for (const language of ['en', 'de']) {
    const bankId = `sounds-fishy-classic-${language}`, bank = fishyBanks[bankId];
    validateFishyBank(bank);
    assert.equal(bank.language, language);
    assert.equal(bank.title, language === 'en' ? 'Classic English' : 'Classic German');
    assert.equal(bank.questions.length, 150);
    assert.notEqual(bank.development, true);
    const summary = fishyBankSummaries.find(b => b.bankId === bankId)!;
    assert.equal(summary.questionCount, 150); assert.equal(summary.development, false);
    assert(bank.questions.every(q => q.id.startsWith(`sf-${language}-`) && !q.id.includes('sample')));
    assert.deepEqual(JSON.parse(readFileSync(`question-banks/sounds-fishy/${bankId}.json`, 'utf8')), bank);
    const s = start(4, { bankId }), seen = new Set<string>();
    for (let i = 0; i < 150; i++) {
      assert(!seen.has(s.question!.id)); seen.add(s.question!.id);
      for (const id of ['p0', '$display']) {
        const v = serializeForPlayer(s, id);
        assert.equal(v.answer, undefined); assert.equal(v.sources, undefined);
        assert.equal(v.explanation, undefined); assert.deepEqual(v.roles, {});
      }
      command(s, 'replace');
    }
    assert.equal(seen.size, 150); assert.equal(s.cycle[bankId], 2);
  }
});
test('public asset tree has no secret bank, generated server bank or private bank fields', () => {
  const inspect = (dir: string) => { for (const entry of readdirSync(dir, { withFileTypes: true })) { const path = `${dir}/${entry.name}`; if (entry.isDirectory()) inspect(path); else if (/\.(json|js|html)$/.test(path)) { const text = readFileSync(path, 'utf8'); assert(!text.includes('verificationNotes'), path); assert(!text.includes('sf-en-'), path); assert(!text.includes('sf-de-'), path); } } };
  inspect('frontend/public'); if (existsSync('frontend/dist')) inspect('frontend/dist');
});
