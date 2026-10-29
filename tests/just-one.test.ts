import test from 'node:test';
import assert from 'node:assert/strict';
import {
  applyAction,
  createState,
  expireState,
  reviewerId,
  serializeForPlayer,
  type JustOneState,
  type StoredPlayer,
} from '../backend-do/src/justOne/engine.js';
import {
  compareWords,
  normalizeWord,
  processClues,
} from '../backend-do/src/justOne/language.js';
import { justOneBanks } from '../backend-do/src/generated/justOneBanks.js';
import { validateWordBank } from '../shared/wordBank.mjs';
import type { JustOneAction, JustOneSettings } from '../shared/justOne.js';

const now = 1_000_000;
const player = (
  id: string,
  role: 'HOST' | 'PLAYER' = 'PLAYER',
): StoredPlayer => ({
  playerId: id,
  nickname: id,
  role,
  connected: true,
  participating: true,
  pending: false,
  token: `secret-${id}`,
});
function lobby(
  settings: Partial<JustOneSettings> = {},
  count = 3,
): JustOneState {
  const s = createState(
    '1234',
    player('host', 'HOST'),
    'host-secret',
    settings,
    now,
  );
  for (let i = 1; i < count; i++) {
    const p = player(`p${i}`);
    s.players[p.playerId] = p;
    s.order.push(p.playerId);
  }
  return s;
}
function action(
  s: JustOneState,
  type: string,
  payload: Record<string, unknown> = {},
): JustOneAction {
  return {
    id: crypto.randomUUID(),
    type,
    generation: s.generation,
    round: s.round,
    phase: s.phase,
    payload,
  };
}
function act(
  s: JustOneState,
  type: string,
  payload: Record<string, unknown> = {},
  actor = 'host',
  time = now,
): JustOneAction {
  const a = action(s, type, payload);
  applyAction(s, actor, a, time);
  return a;
}
function start(
  settings: Partial<JustOneSettings> = {},
  count = 3,
): JustOneState {
  const s = lobby(settings, count);
  act(s, 'start');
  return s;
}
function submit(s: JustOneState) {
  const words = [
    'ocean',
    'morning',
    'window',
    'engine',
    'plastic',
    'coffee',
    'grass',
    'cloud',
    'spice',
  ];
  s.expected.forEach((id, i) =>
    act(
      s,
      'clues',
      {
        clues: Array.from(
          { length: s.clueCount },
          (_, j) => `${words[(i * 2 + j) % words.length]}`,
        ),
      },
      id,
    ),
  );
}
function guessing(s: JustOneState) {
  submit(s);
  act(s, 'reveal', {}, reviewerId(s)!);
}

test('defaults, automatic small-group clues, host rotation and original scoring', () => {
  const s = start();
  assert.equal(s.guesserId, 'host');
  assert.equal(s.phase, 'CLUES');
  assert.equal(s.clueCount, 2);
  assert.equal(s.remaining, 13);
  assert.equal(s.deadline, null);
  guessing(s);
  act(s, 'guess', { guess: s.word!.toUpperCase() });
  assert.equal(s.score, 1);
  assert.equal(s.remaining, 12);
  act(s, 'next');
  assert.equal(s.guesserId, 'p1');
  guessing(s);
  act(s, 'guess', { guess: 'xyzzy' }, 'p1');
  assert.equal(s.remaining, 10);
  assert.equal(s.score, 1);
});
test('five-word selection sends only numbered choice to guesser, and no bank/card/seed leaks', () => {
  const s = start({ selection: 'five' });
  const g = serializeForPlayer(s, 'host');
  const c = serializeForPlayer(s, 'p1');
  assert.equal(g.word, undefined);
  assert.equal(g.options, undefined);
  assert.equal(c.options?.length, 5);
  assert(!JSON.stringify(g).includes('host-secret'));
  assert(!JSON.stringify(g).includes('secret-p1'));
  assert(!('seed' in g));
  assert(!('usedWords' in g));
  assert.throws(
    () => act(s, 'choose', { number: 1 }, 'p1'),
    /Only the guesser/,
  );
  act(s, 'choose', { number: 4 });
  assert.equal(s.word, c.options![3]);
  assert.equal(s.phase, 'CLUES');
});
test('clues remain private and host guesser cannot access review or mystery word', () => {
  const s = start();
  act(s, 'clues', { clues: ['ocean', 'morning'] }, 'p1');
  assert.deepEqual(serializeForPlayer(s, 'p1').ownClues, ['ocean', 'morning']);
  assert.equal(serializeForPlayer(s, 'p2').ownClues, null);
  assert.equal(serializeForPlayer(s, 'host').word, undefined);
  assert(!JSON.stringify(serializeForPlayer(s, 'host')).includes('ocean'));
  act(s, 'clues', { clues: ['window', 'engine'] }, 'p2');
  assert.equal(s.phase, 'REVIEW');
  assert.equal(reviewerId(s), 'p1');
  assert.equal(serializeForPlayer(s, 'host').reviewClues, undefined);
  assert.equal(serializeForPlayer(s, 'p2').reviewClues, undefined);
  assert.equal(serializeForPlayer(s, 'p1').reviewClues?.length, 4);
  assert.throws(() => act(s, 'reveal'), /non-guesser reviewer/);
  assert.throws(
    () => act(s, 'review-clue', { clueId: s.clues[0].id, eliminated: false }),
    /non-guesser reviewer/,
  );
});
test('all copies of duplicates, including same-player duplicates, are eliminated', () => {
  const s = start();
  s.expected.forEach((id) =>
    act(s, 'clues', { clues: ['Horse', 'horses'] }, id),
  );
  assert(s.clues.every((c) => c.eliminated));
  act(s, 'reveal', {}, reviewerId(s)!);
  assert.equal(s.phase, 'RESULT');
  assert.equal(s.result?.outcome, 'no-clues');
  assert.equal(s.remaining, 12);
});
test('reviewer can restore, remove and resolve uncertain groups', () => {
  const s = start();
  s.expected.forEach((id) =>
    act(s, 'clues', { clues: ['planet', 'planer'] }, id),
  );
  assert(s.potential.length > 0);
  const reviewer = reviewerId(s)!;
  act(s, 'review-clue', { clueId: s.clues[0].id, eliminated: false }, reviewer);
  assert.equal(s.clues[0].eliminated, false);
  act(s, 'review-group', { index: 0, eliminate: true }, reviewer);
  assert.equal(s.clues[0].eliminated, true);
  act(s, 'review-clue', { clueId: s.clues[0].id, eliminated: false }, reviewer);
  act(s, 'reveal', {}, reviewer);
  assert.equal(s.phase, 'GUESSING');
  assert.equal(serializeForPlayer(s, s.guesserId!).survivingClues?.length, 1);
});
test('typed and verbal modes switch without replacing the word or scoring', () => {
  const s = start();
  guessing(s);
  const word = s.word;
  const deadline = s.deadline;
  act(s, 'settings', { guessing: 'verbal' });
  assert.equal(s.word, word);
  assert.equal(s.phase, 'GUESSING');
  assert.equal(s.deadline, deadline);
  assert.equal(s.score, 0);
  assert.throws(() => act(s, 'guess', { guess: word }), /unavailable/);
  assert.throws(
    () => act(s, 'adjudicate', { outcome: 'correct' }),
    /non-guesser reviewer/,
  );
  act(s, 'adjudicate', { outcome: 'correct' }, reviewerId(s)!);
  assert.equal(s.score, 1);
});
test('borderline answer remains one committed attempt across mode changes', () => {
  const s = start();
  s.word = 'Castle';
  guessing(s);
  act(s, 'guess', { guess: 'castel' });
  assert.equal(s.phase, 'ANSWER_REVIEW');
  act(s, 'settings', { guessing: 'verbal' });
  assert.throws(() => act(s, 'guess', { guess: 'Castle' }), /not allowed/);
  assert.equal(s.committedGuess, 'castel');
  act(s, 'adjudicate', { outcome: 'correct' }, reviewerId(s)!);
  assert.equal(s.score, 1);
});
test('late and replayed actions cannot double-score or advance twice', () => {
  const s = start();
  const late = action(s, 'clues', { clues: ['ocean', 'morning'] });
  guessing(s);
  const a = act(s, 'guess', { guess: s.word });
  const version = s.version;
  applyAction(s, 'host', a, now);
  assert.equal(s.score, 1);
  assert.equal(s.version, version);
  assert.throws(() => applyAction(s, 'p1', late, now), /phase changed/);
  const next = act(s, 'next');
  applyAction(s, 'host', next, now);
  assert.equal(s.round, 2);
});
test('permissions and a minimum of three players are enforced server-side', () => {
  const s = lobby();
  for (const type of [
    'start',
    'end',
    'settings',
    'reorder',
    'participation',
    'next-guesser',
  ])
    assert.throws(() => act(s, type, {}, 'p1'), /Only the host/);
  act(s, 'participation', { playerId: 'p2', participating: false });
  assert.throws(() => act(s, 'start'), /three/);
  assert.throws(
    () => act(s, 'reorder', { order: ['host', 'host', 'p1'] }),
    /Invalid seat order/,
  );
});
test('clue timer expires authoritatively, even without submissions or clients', () => {
  const s = start({ clueTimer: true, clueSeconds: 60 });
  assert.equal(s.deadline, now + 60_000);
  assert.equal(expireState(s, now + 59_999), false);
  assert.equal(expireState(s, now + 60_000), true);
  assert.equal(s.phase, 'REVIEW');
  act(s, 'reveal', {}, reviewerId(s)!, now + 60_000);
  assert.equal(s.result?.outcome, 'no-clues');
});
test('guess timer expiry passes once, and repeated alarms do not rescore', () => {
  const s = start({ guessTimer: true, guessSeconds: 30 });
  guessing(s);
  assert.equal(s.deadline, now + 30_000);
  expireState(s, now + 30_000);
  assert.equal(s.result?.outcome, 'pass');
  assert.equal(s.remaining, 12);
  assert.equal(expireState(s, now + 30_001), false);
  assert.equal(s.remaining, 12);
});
test('pause, resume, add, reset, disable and duration changes preserve authoritative timers', () => {
  const s = start({ clueTimer: true });
  act(s, 'pause', {}, 'host', now + 10_000);
  assert.equal(s.pausedRemaining, 50_000);
  assert.equal(s.deadline, null);
  assert.equal(expireState(s, now + 120_000), false);
  act(s, 'timer', { operation: 'add' });
  assert.equal(s.pausedRemaining, 80_000);
  act(s, 'pause', {}, 'host', now + 120_000);
  assert.equal(s.deadline, now + 200_000);
  act(s, 'settings', { clueSeconds: 90 }, 'host', now + 130_000);
  assert.equal(s.deadline, now + 220_000);
  act(s, 'settings', { clueTimer: false });
  assert.equal(s.deadline, null);
  act(s, 'settings', { clueTimer: true });
  act(s, 'timer', { operation: 'reset' });
  assert.equal(s.deadline, now + 90_000);
});
test('word mode, clue count and bank switch only affect the next round', () => {
  const s = start();
  const word = s.word;
  act(s, 'settings', {
    selection: 'five',
    bankId: 'just_one_de_classic_v1',
    cluesPerPlayer: 1,
  });
  assert.equal(s.word, word);
  assert.equal(s.roundSettings?.bankId, 'just_one_en_classic_v1');
  assert.equal(s.clueCount, 2);
  act(s, 'skip-round');
  act(s, 'next');
  assert.equal(s.phase, 'SELECTION');
  assert.equal(s.clueCount, 1);
  assert.equal(s.roundSettings?.bankId, 'just_one_de_classic_v1');
});
test('original final-card penalty removes a won card, never below zero', () => {
  const s = start();
  s.remaining = 1;
  s.score = 4;
  guessing(s);
  act(s, 'guess', { guess: 'xyzzy' });
  assert.equal(s.score, 3);
  assert.equal(s.remaining, 0);
  act(s, 'correct-result', { outcome: 'correct' });
  assert.equal(s.score, 5);
  act(s, 'correct-result', { outcome: 'incorrect' });
  assert.equal(s.score, 3);
  act(s, 'next');
  assert.equal(s.phase, 'COMPLETED');
  const zero = start();
  zero.remaining = 1;
  guessing(zero);
  act(zero, 'guess', { guess: 'xyzzy' });
  assert.equal(zero.score, 0);
});
test('fixed rounds consume exactly one turn, including wrong guesses and passes', () => {
  const s = start({ scoring: 'fixed', length: 3 });
  guessing(s);
  act(s, 'guess', { guess: 'xyzzy' });
  assert.equal(s.remaining, 2);
  act(s, 'next');
  guessing(s);
  act(s, 'pass', {}, s.guesserId!);
  assert.equal(s.remaining, 1);
  act(s, 'next');
  guessing(s);
  act(s, 'guess', { guess: s.word }, s.guesserId!);
  assert.equal(s.remaining, 0);
  assert.equal(s.round, 3);
  assert.equal(s.score, 1);
  act(s, 'next');
  assert.equal(s.phase, 'COMPLETED');
});
test('a full original game draws no repeated cards or words', () => {
  const s = start();
  const seen = new Set<string>();
  while (s.phase !== 'COMPLETED') {
    assert(!seen.has(s.word!));
    seen.add(s.word!);
    guessing(s);
    act(s, 'guess', { guess: s.word }, s.guesserId!);
    act(s, 'next');
  }
  assert.equal(s.round, 13);
  assert.equal(s.score, 13);
  assert.equal(s.usedWords.length, 65);
});
test('wrong original guesses shorten the game to seven turns rather than thirteen', () => {
  const s = start();
  while (s.phase !== 'COMPLETED') {
    guessing(s);
    act(s, 'guess', { guess: 'xyzzy' }, s.guesserId!);
    act(s, 'next');
  }
  assert.equal(s.round, 7);
  assert.equal(s.score, 0);
  assert.equal(s.remaining, 0);
});
test('restart retains identities, clears secrets, and rejects previous-game commands', () => {
  const s = start();
  const old = action(s, 'skip-round');
  act(s, 'end');
  act(s, 'restart');
  assert.equal(s.phase, 'LOBBY');
  assert.equal(s.score, 0);
  assert.equal(s.history.length, 0);
  assert.equal(s.word, null);
  assert.equal(s.players.host.token, 'secret-host');
  act(s, 'start');
  assert.throws(() => applyAction(s, 'host', old), /previous game/);
});
test('late joiners and spectators receive no current word, options or private clues', () => {
  const s = start();
  const p = player('late');
  p.pending = true;
  s.players.late = p;
  s.order.push('late');
  submit(s);
  const view = serializeForPlayer(s, 'late');
  assert.equal(view.word, undefined);
  assert.equal(view.options, undefined);
  assert.equal(view.reviewClues, undefined);
  act(s, 'reveal', {}, reviewerId(s)!);
  assert.equal(serializeForPlayer(s, 'late').survivingClues, undefined);
  act(s, 'skip-round');
  act(s, 'next');
  assert.equal(s.players.late.pending, false);
  assert(s.expected.includes('late'));
});
test('disconnected reviewers delegate, and host can skip an absent player’s round', () => {
  const s = start();
  assert.equal(reviewerId(s), 'p1');
  s.players.p1.connected = false;
  assert.equal(reviewerId(s), 'p2');
  submit(s);
  act(s, 'reveal', {}, 'p2');
  act(s, 'skip-round');
  assert.equal(s.result?.outcome, 'pass');
  act(s, 'next');
  act(s, 'next-guesser', { playerId: 'p2' });
  act(s, 'skip-round');
  act(s, 'next');
  assert.equal(s.guesserId, 'p2');
});
test('large groups default to one clue and support manual clue-count override', () => {
  assert.equal(start({}, 7).clueCount, 1);
  assert.equal(start({ cluesPerPlayer: 2 }, 7).clueCount, 2);
});
test('invalid settings, unknown banks and insufficient decks fail clearly', () => {
  assert.throws(() => lobby({ bankId: 'missing' }), /unavailable/);
  assert.throws(() => lobby({ clueSeconds: -1 }), /duration/);
  assert.throws(() => lobby({ guessing: 'bad' } as never), /mode/);
  assert.throws(() => lobby({ surprise: true } as never), /Unknown setting/);
  assert.equal(start({ scoring: 'fixed', length: 100 }).remaining, 100);
  const bank = justOneBanks.just_one_en_classic_v1;
  const originalCards = bank.cards;
  try {
    bank.cards = originalCards.slice(0, 2);
    assert.throws(
      () => start({ scoring: 'fixed', length: 3 }),
      /word bank has 2 cards/,
    );
  } finally {
    bank.cards = originalCards;
  }
  const s = start();
  assert.throws(
    () => act(s, 'settings', { scoring: 'fixed' }),
    /only change in the lobby/,
  );
});
test('English and German normalization handles Unicode, orthography and inflections conservatively', () => {
  assert.equal(normalizeWord('  Ａpple\u200b '), 'apple');
  for (const [a, b, lang] of [
    ['Horse', 'horses', 'en'],
    ['Japan', 'Japanese', 'en'],
    ['colour', 'color', 'en'],
    ['children', 'child', 'en'],
    ['Straße', 'Strasse', 'de'],
    ['Häusern', 'Haus', 'de'],
    ['Blume', 'Blumen', 'de'],
    ['Äpfel', 'Apfel', 'de'],
    ['Elephant', 'Elephnat', 'en'],
  ] as const)
    assert.equal(compareWords(a, b, lang), 'equal', `${a}/${b}`);
  assert.equal(compareWords('cat', 'dog', 'en'), 'different');
  assert.notEqual(compareWords('plane', 'planet', 'en'), 'equal');
  assert.notEqual(compareWords('apple', 'fruit', 'en'), 'equal');
  assert.equal(compareWords('castle', 'castel', 'en'), 'possible');
  assert.notEqual(compareWords('martial', 'marital', 'en'), 'equal');
  assert.notEqual(compareWords('new', 'news', 'en'), 'equal');
  assert.notEqual(compareWords('das', 'dass', 'de'), 'equal');
});
test('invalid clue formats and mystery-word derivatives are eliminated, not synonyms', () => {
  const clues = ['two words', 'Japanese', 'island'].map((text, i) => ({
    id: String(i),
    playerId: 'p',
    text,
    eliminated: false,
    reason: null as string | null,
  }));
  processClues(clues, 'Japan', 'en');
  assert(clues[0].eliminated);
  assert(clues[1].eliminated);
  assert(!clues[2].eliminated);
});
test('bank validator checks unique ids, exactly five words, language, version and repeated words', () => {
  const good = structuredClone(justOneBanks.just_one_en_classic_v1);
  validateWordBank(good);
  const short = structuredClone(good);
  short.cards[0].words.pop();
  assert.throws(() => validateWordBank(short), /five words/);
  const repeat = structuredClone(good);
  repeat.cards[1].words[0] = good.cards[0].words[0];
  assert.throws(() => validateWordBank(repeat), /Repeated word/);
  const ids = structuredClone(good);
  ids.cards[1].id = ids.cards[0].id;
  assert.throws(() => validateWordBank(ids), /unique/);
  validateWordBank({ ...good, language: 'fr' });
  assert.throws(
    () => validateWordBank({ ...good, language: 'invalid!' }),
    /language/,
  );
  assert.throws(() => validateWordBank({ ...good, version: 0 }), /version/);
});
test('published English and German banks contain 110 cards and 550 unique words each', () => {
  for (const language of ['en', 'de']) {
    const bank = justOneBanks[`just_one_${language}_classic_v1`];
    validateWordBank(bank);
    assert.equal(bank.language, language);
    assert.equal(bank.cards.length, 110);
    assert.equal(bank.cards.flatMap((card) => card.words).length, 550);
    assert.notEqual(bank.development, true);
  }
});
