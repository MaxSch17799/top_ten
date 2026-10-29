import {
  defaultJustOneSettings,
  type Clue,
  type JustOneAction,
  type JustOnePlayer,
  type JustOneSettings,
  type JustOneView,
  type Outcome,
  type PotentialDuplicate,
  type RoundResult,
  type WordBank,
} from '../../../shared/justOne.js';
import {
  justOneBanks,
  justOneBankSummaries,
} from '../generated/justOneBanks.js';
import { compareWords, normalizeWord, processClues } from './language.js';

export interface StoredPlayer extends JustOnePlayer {
  token: string;
}
export interface JustOneState {
  gameType: 'just-one';
  gameId: string;
  version: number;
  generation: number;
  phase: JustOneView['phase'];
  hostToken: string;
  players: Record<string, StoredPlayer>;
  order: string[];
  settings: JustOneSettings;
  roundSettings: JustOneSettings | null;
  round: number;
  score: number;
  remaining: number | null;
  guesserId: string | null;
  nextGuesserId: string | null;
  expected: string[];
  clueCount: number;
  submissions: Record<string, string[]>;
  clueDrafts: Record<string, string[]>;
  guessDraft: string | null;
  clues: Clue[];
  potential: PotentialDuplicate[];
  word: string | null;
  options: string[];
  usedWords: string[];
  committedGuess: string | null;
  result: RoundResult | null;
  history: RoundResult[];
  deadline: number | null;
  paused: boolean;
  pausedRemaining: number | null;
  expiresAt: number;
  endedReason: string | null;
  processed: string[];
}
export class GameError extends Error {
  constructor(
    message: string,
    public status = 400,
  ) {
    super(message);
  }
}
const requireCondition: (
  condition: unknown,
  message: string,
  status?: number,
) => asserts condition = (condition, message, status = 400) => {
  if (!condition) throw new GameError(message, status);
};
export function checkedSettings(
  current: JustOneSettings,
  value: unknown,
): JustOneSettings {
  requireCondition(
    value && typeof value === 'object' && !Array.isArray(value),
    'Invalid settings',
  );
  const input = value as Record<string, unknown>;
  requireCondition(
    Object.keys(input).every((key) => key in defaultJustOneSettings),
    'Unknown setting',
  );
  const s = {
    ...defaultJustOneSettings,
    ...current,
    ...input,
  } as JustOneSettings;
  requireCondition(
    !!justOneBanks[s.bankId],
    'Selected word bank is unavailable',
  );
  requireCondition(
    ['original', 'fixed', 'infinite'].includes(s.scoring) &&
      ['automatic', 'five'].includes(s.selection) &&
      ['typed', 'verbal'].includes(s.guessing),
    'Invalid game mode',
  );
  requireCondition(
    Number.isInteger(s.length) && s.length >= 1 && s.length <= 1000,
    'Game length must be 1–1000',
  );
  requireCondition(
    [0, 1, 2].includes(s.cluesPerPlayer),
    'Clues per player must be automatic, one or two',
  );
  requireCondition(
    typeof s.clueTimer === 'boolean' &&
      typeof s.guessTimer === 'boolean' &&
      typeof s.autoSubmitClues === 'boolean' &&
      typeof s.autoSubmitGuess === 'boolean',
    'Invalid timer setting',
  );
  for (const seconds of [s.clueSeconds, s.guessSeconds])
    requireCondition(
      Number.isInteger(seconds) && seconds >= 5 && seconds <= 1800,
      'Timer duration must be 5–1800 seconds',
    );
  return s;
}
export function createState(
  gameId: string,
  host: StoredPlayer,
  hostToken: string,
  settings: unknown,
  now = Date.now(),
): JustOneState {
  return {
    gameType: 'just-one',
    gameId,
    hostToken,
    version: 1,
    generation: 1,
    phase: 'LOBBY',
    players: { [host.playerId]: host },
    order: [host.playerId],
    settings: checkedSettings(defaultJustOneSettings, settings ?? {}),
    roundSettings: null,
    round: 0,
    score: 0,
    remaining: 13,
    guesserId: null,
    nextGuesserId: null,
    expected: [],
    clueCount: 1,
    submissions: {},
    clueDrafts: {},
    guessDraft: null,
    clues: [],
    potential: [],
    word: null,
    options: [],
    usedWords: [],
    committedGuess: null,
    result: null,
    history: [],
    deadline: null,
    paused: false,
    pausedRemaining: null,
    expiresAt: now + 30 * 60_000,
    endedReason: null,
    processed: [],
  };
}
// Keep existing deployed rooms playable when settings/state fields are added.
export function upgradeState(s: JustOneState): void {
  s.settings = { ...defaultJustOneSettings, ...s.settings };
  if (s.roundSettings)
    s.roundSettings = { ...defaultJustOneSettings, ...s.roundSettings };
  s.clueDrafts ??= {};
  s.guessDraft ??= null;
}
export function reviewerId(s: JustOneState): string | null {
  const candidates = s.expected.filter((id) => !!s.players[id]);
  return (
    candidates.find(
      (id) => s.players[id].role === 'HOST' && s.players[id].connected,
    ) ??
    candidates.find((id) => s.players[id].connected) ??
    candidates.find((id) => s.players[id].role === 'HOST') ??
    candidates[0] ??
    null
  );
}
function bankFor(s: JustOneState): WordBank {
  return justOneBanks[s.roundSettings?.bankId ?? s.settings.bankId];
}
function timerDuration(s: JustOneState): number | null {
  if (s.phase === 'CLUES' && s.settings.clueTimer)
    return s.settings.clueSeconds * 1000;
  if (s.phase === 'GUESSING' && s.settings.guessTimer)
    return s.settings.guessSeconds * 1000;
  return null;
}
function resetTimer(s: JustOneState, now: number): void {
  const duration = timerDuration(s);
  s.deadline = !s.paused && duration !== null ? now + duration : null;
  s.pausedRemaining = s.paused ? duration : null;
}
function finish(s: JustOneState, outcome: Outcome, now: number): void {
  requireCondition(!s.result, 'This round has already been scored', 409);
  requireCondition(s.word, 'No selected word');
  const result: RoundResult = {
    round: s.round,
    word: s.word,
    guess: s.committedGuess,
    outcome,
    scoreBefore: s.score,
    remainingBefore: s.remaining,
  };
  s.result = result;
  applyScore(s, result);
  s.history = [...s.history.slice(-99), result];
  s.phase = 'RESULT';
  s.deadline = null;
  s.pausedRemaining = null;
  s.expiresAt = now + 2 * 60 * 60_000;
}
function applyScore(s: JustOneState, result: RoundResult): void {
  s.score = result.scoreBefore + (result.outcome === 'correct' ? 1 : 0);
  s.remaining =
    result.remainingBefore === null
      ? null
      : Math.max(0, result.remainingBefore - 1);
  if (s.settings.scoring === 'original' && result.outcome === 'incorrect') {
    if (s.remaining !== null && s.remaining > 0) s.remaining--;
    else s.score = Math.max(0, s.score - 1);
  }
}
function reveal(s: JustOneState, now: number): void {
  if (!s.clues.some((c) => !c.eliminated)) finish(s, 'no-clues', now);
  else {
    s.phase = 'GUESSING';
    resetTimer(s, now);
  }
}
function review(s: JustOneState): void {
  s.clues = s.expected.flatMap((id) =>
    (s.submissions[id] ?? []).map((text, i) => ({
      id: `${id}:${i}`,
      playerId: id,
      text,
      eliminated: false,
      reason: null,
    })),
  );
  s.potential = processClues(s.clues, s.word!, bankFor(s).language);
  // A brief explicit review lets players remove translations, homophones and invented words.
  // Obvious duplicates have already been eliminated; only one reviewer finalizes the board.
  s.phase = 'REVIEW';
  s.deadline = null;
  s.pausedRemaining = null;
}
function beginClues(s: JustOneState, now: number): void {
  s.phase = 'CLUES';
  resetTimer(s, now);
}
function nextRound(s: JustOneState, now: number): void {
  for (const player of Object.values(s.players)) player.pending = false;
  const active = s.order.filter((id) => s.players[id]?.participating);
  requireCondition(
    active.length >= 3,
    'At least three participating players are required',
  );
  s.roundSettings = { ...s.settings };
  let available = bankFor(s).cards.filter((card) =>
    card.words.every((word) => !s.usedWords.includes(normalizeWord(word))),
  );
  if (!available.length && s.settings.scoring !== 'original') {
    // A new shuffled cycle only begins after the current bank is exhausted.
    s.usedWords = [];
    available = bankFor(s).cards.filter(
      (card) => !card.words.includes(s.word ?? ''),
    );
    if (!available.length) available = bankFor(s).cards;
  }
  requireCondition(
    available.length > 0,
    'No unseen cards remain in this bank. Select another bank or restart.',
  );
  const random = new Uint32Array(2);
  crypto.getRandomValues(random);
  const card = available[random[0] % available.length];
  s.usedWords.push(...card.words.map(normalizeWord));
  const previousIndex = active.indexOf(s.guesserId ?? '');
  s.guesserId =
    s.nextGuesserId && active.includes(s.nextGuesserId)
      ? s.nextGuesserId
      : active[(previousIndex + 1) % active.length];
  s.nextGuesserId = null;
  s.round++;
  s.expected = active.filter((id) => id !== s.guesserId);
  s.clueCount = s.settings.cluesPerPlayer || (active.length <= 4 ? 2 : 1);
  s.submissions = {};
  s.clueDrafts = {};
  s.guessDraft = null;
  s.clues = [];
  s.potential = [];
  s.result = null;
  s.committedGuess = null;
  s.options = [...card.words];
  s.word = null;
  s.deadline = null;
  s.pausedRemaining = null;
  if (s.settings.selection === 'five') s.phase = 'SELECTION';
  else {
    s.word = card.words[random[1] % 5];
    beginClues(s, now);
  }
}
export function expireState(s: JustOneState, now = Date.now()): boolean {
  upgradeState(s);
  if (['LOBBY', 'COMPLETED'].includes(s.phase)) {
    if (s.phase === 'LOBBY' && now >= s.expiresAt) {
      s.phase = 'COMPLETED';
      s.endedReason = 'Lobby expired after inactivity';
      return true;
    }
    return false;
  }
  if (now >= s.expiresAt) {
    s.phase = 'COMPLETED';
    s.endedReason = 'Session expired after two hours of inactivity';
    s.deadline = null;
    return true;
  }
  if (s.paused || s.deadline === null || now < s.deadline) return false;
  if (s.phase === 'CLUES') {
    if (s.settings.autoSubmitClues) {
      for (const id of s.expected) {
        if (s.submissions[id]) continue;
        const clues = (s.clueDrafts[id] ?? [])
          .map((clue) => clue.trim())
          .filter(Boolean);
        if (clues.length) s.submissions[id] = clues;
      }
    }
    review(s);
  } else if (s.phase === 'GUESSING') {
    if (
      s.settings.guessing === 'typed' &&
      s.settings.autoSubmitGuess &&
      s.guessDraft?.trim()
    )
      commitGuess(s, s.guessDraft, now);
    else finish(s, 'pass', now);
  }
  return true;
}
function commitGuess(s: JustOneState, guess: string, now: number): void {
  s.committedGuess = guess.trim();
  const match = compareWords(s.committedGuess, s.word!, bankFor(s).language);
  if (match === 'possible') {
    s.phase = 'ANSWER_REVIEW';
    s.deadline = null;
  } else finish(s, match === 'equal' ? 'correct' : 'incorrect', now);
}
export function applyAction(
  s: JustOneState,
  actorId: string,
  action: JustOneAction,
  now = Date.now(),
): void {
  upgradeState(s);
  const actor = s.players[actorId];
  requireCondition(actor, 'Player not found', 401);
  requireCondition(
    action &&
      typeof action.type === 'string' &&
      typeof action.id === 'string' &&
      action.id.length >= 8 &&
      action.id.length <= 100,
    'Invalid action',
  );
  requireCondition(
    action.generation === s.generation,
    'This action belongs to a previous game',
    409,
  );
  const key = `${actorId}:${action.id}`;
  if (s.processed.includes(key)) return;
  requireCondition(
    action.round === s.round &&
      (action.type === 'settings' || action.phase === s.phase),
    'The phase changed. Please try again.',
    409,
  );
  const p = action.payload ?? {};
  const host = () =>
    requireCondition(actor.role === 'HOST', 'Only the host can do this', 403);
  const reviewer = () =>
    requireCondition(
      actorId === reviewerId(s) && actorId !== s.guesserId,
      'Only the non-guesser reviewer can do this',
      403,
    );
  const phase = (...phases: JustOneView['phase'][]) =>
    requireCondition(
      phases.includes(s.phase),
      'Action not allowed in this phase',
      409,
    );
  if (s.paused)
    requireCondition(
      [
        'pause',
        'settings',
        'timer',
        'end',
        'participation',
        'next-guesser',
        'draft-clues',
        'draft-guess',
      ].includes(action.type),
      'Game is paused',
      409,
    );
  switch (action.type) {
    case 'settings': {
      host();
      const updated = checkedSettings(s.settings, p);
      if (s.phase !== 'LOBBY')
        requireCondition(
          updated.length === s.settings.length &&
            updated.scoring === s.settings.scoring,
          'Scoring and length can only change in the lobby',
        );
      const timerChanged =
        s.phase === 'CLUES'
          ? updated.clueTimer !== s.settings.clueTimer ||
            updated.clueSeconds !== s.settings.clueSeconds
          : s.phase === 'GUESSING' &&
            (updated.guessTimer !== s.settings.guessTimer ||
              updated.guessSeconds !== s.settings.guessSeconds);
      s.settings = updated;
      if (timerChanged) resetTimer(s, now);
      break;
    }
    case 'reorder': {
      host();
      phase('LOBBY');
      requireCondition(
        Array.isArray(p.order) &&
          p.order.length === s.order.length &&
          new Set(p.order).size === s.order.length &&
          p.order.every((id) => typeof id === 'string' && s.order.includes(id)),
        'Invalid seat order',
      );
      s.order = p.order as string[];
      break;
    }
    case 'participation': {
      host();
      requireCondition(
        typeof p.playerId === 'string' &&
          s.players[p.playerId] &&
          typeof p.participating === 'boolean',
        'Invalid player',
      );
      s.players[p.playerId].participating = p.participating;
      // Current-round membership stays fixed to protect secrets; exclusions apply next round.
      break;
    }
    case 'next-guesser': {
      host();
      requireCondition(
        p.playerId === null ||
          (typeof p.playerId === 'string' &&
            s.players[p.playerId]?.participating),
        'Choose a participating player',
      );
      s.nextGuesserId = p.playerId as string | null;
      break;
    }
    case 'start': {
      host();
      phase('LOBBY');
      const total =
        s.settings.scoring === 'original'
          ? 13
          : s.settings.scoring === 'infinite'
            ? null
            : s.settings.length;
      requireCondition(
        s.settings.scoring !== 'original' ||
          (total !== null && bankFor(s).cards.length >= total),
        `This word bank has ${bankFor(s).cards.length} cards. Original scoring needs 13; choose custom rounds or another bank.`,
      );
      s.remaining = total;
      nextRound(s, now);
      break;
    }
    case 'choose': {
      phase('SELECTION');
      requireCondition(
        actorId === s.guesserId,
        'Only the guesser chooses a number',
        403,
      );
      requireCondition(
        Number.isInteger(p.number) &&
          Number(p.number) >= 1 &&
          Number(p.number) <= 5,
        'Choose 1–5',
      );
      s.word = s.options[Number(p.number) - 1];
      beginClues(s, now);
      break;
    }
    case 'clues': {
      phase('CLUES');
      requireCondition(
        s.expected.includes(actorId),
        'You are not a clue-giver this round',
        403,
      );
      requireCondition(
        !s.submissions[actorId],
        'Your clues are already locked',
        409,
      );
      requireCondition(
        Array.isArray(p.clues) &&
          p.clues.length === s.clueCount &&
          p.clues.every(
            (c) =>
              typeof c === 'string' && c.trim().length > 0 && c.length <= 60,
          ),
        'Enter every clue (maximum 60 characters each)',
      );
      s.submissions[actorId] = (p.clues as string[]).map((c) =>
        c.normalize('NFKC').trim(),
      );
      if (s.expected.every((id) => s.submissions[id])) review(s);
      break;
    }
    case 'draft-clues': {
      phase('CLUES');
      requireCondition(
        s.expected.includes(actorId),
        'Only clue-givers can save clue drafts',
        403,
      );
      requireCondition(
        !s.submissions[actorId],
        'Your clues are already locked',
        409,
      );
      requireCondition(
        Array.isArray(p.clues) &&
          p.clues.length === s.clueCount &&
          p.clues.every(
            (clue) => typeof clue === 'string' && clue.length <= 60,
          ),
        'Invalid clue draft',
      );
      s.clueDrafts[actorId] = (p.clues as string[]).map((clue) =>
        clue.normalize('NFKC'),
      );
      break;
    }
    case 'draft-guess': {
      phase('GUESSING');
      requireCondition(
        actorId === s.guesserId && s.settings.guessing === 'typed',
        'Only the typed guesser can save an answer draft',
        403,
      );
      requireCondition(
        s.committedGuess === null &&
          typeof p.guess === 'string' &&
          p.guess.length <= 100,
        'Invalid answer draft',
      );
      s.guessDraft = p.guess as string;
      break;
    }
    case 'close-clues':
      host();
      phase('CLUES');
      review(s);
      break;
    case 'review-clue': {
      reviewer();
      phase('REVIEW');
      const clue = s.clues.find((c) => c.id === p.clueId);
      requireCondition(
        clue && typeof p.eliminated === 'boolean',
        'Unknown clue',
      );
      clue.eliminated = p.eliminated;
      clue.reason = p.eliminated
        ? 'Removed by reviewer'
        : 'Restored by reviewer';
      break;
    }
    case 'review-group': {
      reviewer();
      phase('REVIEW');
      const group = s.potential[Number(p.index)];
      requireCondition(group, 'Unknown suggestion');
      if (p.eliminate === true)
        for (const clue of s.clues)
          if (group.ids.includes(clue.id)) {
            clue.eliminated = true;
            clue.reason = group.reason;
          }
      s.potential.splice(Number(p.index), 1);
      break;
    }
    case 'reveal':
      reviewer();
      phase('REVIEW');
      reveal(s, now);
      break;
    case 'guess': {
      phase('GUESSING');
      requireCondition(
        actorId === s.guesserId,
        'Only the guesser can answer',
        403,
      );
      requireCondition(
        s.settings.guessing === 'typed' && s.committedGuess === null,
        'Typed guessing is unavailable',
        409,
      );
      requireCondition(
        typeof p.guess === 'string' &&
          p.guess.trim().length > 0 &&
          p.guess.length <= 100,
        'Enter an answer',
      );
      commitGuess(s, p.guess, now);
      break;
    }
    case 'adjudicate': {
      requireCondition(
        actorId !== s.guesserId &&
          (actorId === reviewerId(s) ||
            (actor.role === 'HOST' && s.expected.includes(actorId))),
        'Only the non-guesser reviewer or host can do this',
        403,
      );
      phase('GUESSING', 'ANSWER_REVIEW');
      requireCondition(
        s.phase === 'ANSWER_REVIEW' || s.settings.guessing === 'verbal',
        'Use typed guessing',
      );
      requireCondition(
        ['correct', 'incorrect', 'pass'].includes(String(p.outcome)),
        'Invalid outcome',
      );
      finish(s, p.outcome as Outcome, now);
      break;
    }
    case 'pass':
      phase('GUESSING');
      requireCondition(
        actorId === s.guesserId,
        'Only the guesser can pass',
        403,
      );
      finish(s, 'pass', now);
      break;
    case 'skip-round': {
      host();
      phase('SELECTION', 'CLUES', 'REVIEW', 'GUESSING');
      // An absent guesser or reviewer must not strand an untimed game.
      if (!s.word) s.word = s.options[0];
      finish(s, 'pass', now);
      break;
    }
    case 'correct-result': {
      host();
      phase('RESULT', 'COMPLETED');
      requireCondition(
        s.result &&
          ['correct', 'incorrect', 'pass', 'no-clues'].includes(
            String(p.outcome),
          ),
        'Invalid correction',
      );
      s.result.outcome = p.outcome as Outcome;
      s.result.corrected = true;
      applyScore(s, s.result);
      s.history[s.history.length - 1] = { ...s.result };
      if (
        s.phase === 'COMPLETED' &&
        (s.remaining === null || s.remaining > 0) &&
        !s.endedReason
      )
        s.phase = 'RESULT';
      break;
    }
    case 'next':
      host();
      phase('RESULT');
      if (s.remaining === 0) s.phase = 'COMPLETED';
      else nextRound(s, now);
      break;
    case 'pause': {
      host();
      requireCondition(
        !['LOBBY', 'COMPLETED', 'RESULT'].includes(s.phase),
        'No active phase to pause',
      );
      if (!s.paused) {
        s.pausedRemaining =
          s.deadline === null ? null : Math.max(0, s.deadline - now);
        s.deadline = null;
        s.paused = true;
      } else {
        s.paused = false;
        s.deadline =
          s.pausedRemaining === null ? null : now + s.pausedRemaining;
        s.pausedRemaining = null;
      }
      break;
    }
    case 'timer': {
      host();
      phase('CLUES', 'GUESSING');
      if (p.operation === 'reset') resetTimer(s, now);
      else if (p.operation === 'add') {
        if (s.paused && s.pausedRemaining !== null) s.pausedRemaining += 30_000;
        else if (s.deadline !== null)
          s.deadline = Math.max(now, s.deadline) + 30_000;
      } else throw new GameError('Unknown timer operation');
      break;
    }
    case 'end':
      host();
      s.phase = 'COMPLETED';
      s.endedReason = 'Ended by host';
      s.deadline = null;
      s.paused = false;
      break;
    case 'restart': {
      host();
      phase('COMPLETED');
      s.generation++;
      s.phase = 'LOBBY';
      s.round = 0;
      s.score = 0;
      s.remaining = 13;
      s.history = [];
      s.result = null;
      s.roundSettings = null;
      s.guesserId = null;
      s.nextGuesserId = null;
      s.word = null;
      s.options = [];
      s.usedWords = [];
      s.submissions = {};
      s.clueDrafts = {};
      s.guessDraft = null;
      s.expected = [];
      s.clues = [];
      s.potential = [];
      s.committedGuess = null;
      s.paused = false;
      s.pausedRemaining = null;
      s.endedReason = null;
      s.deadline = null;
      for (const player of Object.values(s.players)) player.pending = false;
      break;
    }
    default:
      throw new GameError('Unknown action');
  }
  s.processed = [...s.processed.slice(-199), key];
  s.expiresAt = now + (s.phase === 'LOBBY' ? 30 : 120) * 60_000;
  s.version++;
}
export function serializeForPlayer(
  s: JustOneState,
  playerId: string,
  now = Date.now(),
): JustOneView {
  upgradeState(s);
  requireCondition(s.players[playerId], 'Player not found', 401);
  const inRound = s.expected.includes(playerId) || playerId === s.guesserId;
  const revealed = ['RESULT', 'COMPLETED'].includes(s.phase);
  const clueGiver = s.expected.includes(playerId);
  const reviewer = reviewerId(s);
  const v: JustOneView = {
    gameType: 'just-one',
    gameId: s.gameId,
    version: s.version,
    generation: s.generation,
    serverNow: now,
    phase: s.phase,
    yourPlayerId: playerId,
    yourRole: s.players[playerId].role,
    players: s.order.map((id) => {
      const p = s.players[id];
      return {
        playerId: p.playerId,
        nickname: p.nickname,
        role: p.role,
        connected: p.connected,
        participating: p.participating,
        pending: p.pending,
      };
    }),
    order: s.order,
    settings: s.settings,
    roundSettings: s.roundSettings,
    banks: justOneBankSummaries,
    round: s.round,
    score: s.score,
    remaining: s.remaining,
    maxPlayers: 10,
    guesserId: s.guesserId,
    reviewerId: reviewer,
    nextGuesserId: s.nextGuesserId,
    clueCount: s.clueCount,
    submitted: Object.keys(s.submissions),
    expected: s.expected,
    ownClues: s.submissions[playerId] ?? null,
    ownClueDraft:
      clueGiver && s.phase === 'CLUES'
        ? (s.clueDrafts[playerId] ?? null)
        : null,
    ownGuessDraft:
      playerId === s.guesserId && s.phase === 'GUESSING' ? s.guessDraft : null,
    result: s.result,
    history: s.history,
    deadline: s.deadline,
    paused: s.paused,
    pausedRemaining: s.pausedRemaining,
    endedReason: s.endedReason,
  };
  if (revealed || (clueGiver && s.phase !== 'SELECTION'))
    v.word = s.word ?? undefined;
  if (clueGiver && s.phase === 'SELECTION') v.options = s.options;
  if (playerId === reviewer && s.phase === 'REVIEW') {
    v.reviewClues = s.clues;
    v.potentialDuplicates = s.potential;
  }
  if (
    inRound &&
    ['GUESSING', 'ANSWER_REVIEW', 'RESULT', 'COMPLETED'].includes(s.phase)
  )
    v.survivingClues = s.clues.filter((c) => !c.eliminated).map((c) => c.text);
  if (
    s.committedGuess !== null &&
    ['ANSWER_REVIEW', 'RESULT', 'COMPLETED'].includes(s.phase)
  )
    v.committedGuess = s.committedGuess;
  return v;
}
