import { defaultFishySettings, type FishRole, type FishyAction, type FishyAudit, type FishyPlayer, type FishyQuestion, type FishyResult, type FishySettings, type FishyView } from '../../../shared/soundsFishy.js';
import { fishyBanks, fishyBankSummaries } from '../generated/soundsFishyBanks.js';

export class GameError extends Error { constructor(message: string, public status = 400) { super(message); } }
function need(ok: unknown, message: string, status = 400): asserts ok { if (!ok) throw new GameError(message, status); }
export interface StoredPlayer extends FishyPlayer { token: string; disconnectedAt: number | null }
export interface FishyState {
  gameType: 'sounds-fishy'; gameId: string; version: number; generation: number;
  roundId: string; hostToken: string; displayToken: string; phase: FishyView['phase'];
  players: Record<string, StoredPlayer>; order: string[]; settings: FishySettings;
  roundSettings: FishySettings | null; round: number; totalRounds: number;
  guesserId: string | null; nextGuesserId: string | null; fish: string[];
  roles: Record<string, FishRole>; submissions: Record<string, string>;
  question: FishyQuestion | null; used: Record<string, string[]>; cycle: Record<string, number>;
  eliminated: string[]; scores: Record<string, number>; result: FishyResult | null;
  scoreBeforeResult?: Record<string, number> | null;
  deadline: number | null; paused: boolean; pausedRemaining: number | null;
  expiresAt: number; endedReason: string | null; notice: string | null;
  processed: string[]; audit: FishyAudit[];
}
export function roundTotal(settings: FishySettings, count: number): number {
  return settings.lengthMode === 'rounds' ? settings.rounds : count * (settings.lengthMode === 'rotations' ? settings.rotations : count <= 5 ? 2 : 1);
}
export function checkedSettings(current: FishySettings, value: unknown): FishySettings {
  need(value && typeof value === 'object' && !Array.isArray(value), 'Invalid settings');
  need(Object.keys(value).every(k => Object.hasOwn(defaultFishySettings, k)), 'Unknown setting');
  const s = { ...current, ...value } as FishySettings;
  need(Object.hasOwn(fishyBanks, s.bankId), 'Selected question bank is unavailable');
  need(['party', 'written'].includes(s.mode) && ['official', 'rotations', 'rounds'].includes(s.lengthMode), 'Invalid game mode');
  need(Number.isInteger(s.rotations) && s.rotations >= 1 && s.rotations <= 20, 'Rotations must be 1–20');
  need(Number.isInteger(s.rounds) && s.rounds >= 1 && s.rounds <= 200, 'Rounds must be 1–200');
  need([0, 15, 30, 45, 60].includes(s.preparationSeconds) && [0, 30, 60, 90, 120].includes(s.decisionSeconds), 'Invalid timer duration');
  need(typeof s.autoNext === 'boolean' && typeof s.facilitator === 'boolean', 'Invalid switch');
  return s;
}
export function createState(gameId: string, host: StoredPlayer, hostToken: string, settings: unknown, now = Date.now()): FishyState {
  const defaults = { ...defaultFishySettings };
  if (!Object.hasOwn(fishyBanks, defaults.bankId)) defaults.bankId = fishyBankSummaries[0]?.bankId ?? '';
  return {
    gameType: 'sounds-fishy', gameId, hostToken, displayToken: crypto.randomUUID(),
    version: 1, generation: 1, roundId: '', phase: 'LOBBY', players: { [host.playerId]: host },
    order: [host.playerId], settings: checkedSettings(defaults, settings ?? {}), roundSettings: null,
    round: 0, totalRounds: 0, guesserId: null, nextGuesserId: null, fish: [], roles: {},
    submissions: {}, question: null, used: {}, cycle: {}, eliminated: [], scores: { [host.playerId]: 0 },
    result: null, scoreBeforeResult: null, deadline: null, paused: false, pausedRemaining: null, expiresAt: now + 30 * 60_000,
    endedReason: null, notice: null, processed: [], audit: [],
  };
}
const active = (s: FishyState) => s.order.filter(id => s.players[id].participating && !s.players[id].pending);
const inRound = (s: FishyState) => ['PREPARATION', 'COLLECTION', 'ELIMINATION'].includes(s.phase);
function randomIndex(n: number): number {
  const limit = Math.floor(0x100000000 / n) * n;
  let x: number; do { x = crypto.getRandomValues(new Uint32Array(1))[0]; } while (x >= limit);
  return x % n;
}
function audit(s: FishyState, actor: string, message: string, now: number) {
  s.audit.push({ at: now, actor, message }); s.audit = s.audit.slice(-100);
}
function draw(s: FishyState): FishyQuestion {
  let bank = fishyBanks[s.settings.bankId];
  if (!bank) {
    bank = Object.values(fishyBanks)[0];
    need(bank, 'No question banks are installed');
    s.settings.bankId = bank.bankId;
    s.notice = 'The selected bank is unavailable. An installed bank was selected.';
  }
  let used = s.used[bank.bankId] ?? [];
  let pool = bank.questions.filter(q => !used.includes(q.id));
  if (!pool.length) {
    const last = used[used.length - 1];
    used = []; s.cycle[bank.bankId] = (s.cycle[bank.bankId] ?? 1) + 1;
    s.notice = 'Question bank exhausted. A new shuffled cycle has started.';
    pool = bank.questions.filter(q => bank.questions.length === 1 || q.id !== last);
  }
  const q = pool[randomIndex(pool.length)];
  s.used[bank.bankId] = [...used, q.id]; s.cycle[bank.bankId] ??= 1;
  // Snapshot the chosen card: a deployment cannot change an active round's answer.
  return structuredClone(q);
}
function setDeadline(s: FishyState, now: number, seconds: number) {
  s.deadline = seconds ? now + seconds * 1000 : null;
  s.pausedRemaining = null;
}
function setupRound(s: FishyState, now: number, replay = false) {
  const ids = active(s);
  need(ids.length >= 4 && ids.length <= 10, 'Sounds Fishy needs 4–10 active players');
  s.notice = null;
  const previous = s.guesserId;
  const guesser = replay && previous && ids.includes(previous) ? previous :
    s.round === 0 && s.nextGuesserId && ids.includes(s.nextGuesserId) ? s.nextGuesserId :
    ids[(ids.indexOf(previous ?? '') + 1) % ids.length];
  const question = draw(s);
  s.roundSettings = { ...s.settings }; s.question = question;
  if (!replay) s.round++;
  s.roundId = crypto.randomUUID(); s.guesserId = guesser;
  // Speaking order starts clockwise after the guesser.
  const at = ids.indexOf(guesser);
  s.fish = [...ids.slice(at + 1), ...ids.slice(0, at)];
  const blue = randomIndex(s.fish.length);
  s.roles = Object.fromEntries(s.fish.map((id, i) => [id, i === blue ? 'blue' : 'red']));
  s.submissions = {}; s.eliminated = []; s.result = null; s.scoreBeforeResult = null;
  s.paused = false; s.pausedRemaining = null;
  s.phase = s.roundSettings.mode === 'party' ? 'PREPARATION' : 'COLLECTION';
  setDeadline(s, now, s.roundSettings.preparationSeconds);
}
/** Pure official scoring. An elimination sequence cannot continue after the blue fish. */
export function scoreRound(guesser: string, roles: Record<string, FishRole>, eliminated: string[]): Record<string, number> {
  const ids = Object.keys(roles);
  need(ids.length >= 3 && !Object.hasOwn(roles, guesser) && Object.values(roles).filter(r => r === 'blue').length === 1 && Object.values(roles).every(r => r === 'red' || r === 'blue'), 'Invalid fish assignments');
  need(new Set(eliminated).size === eliminated.length && eliminated.every(id => Object.hasOwn(roles, id)), 'Invalid eliminations');
  const blueIndex = eliminated.findIndex(id => roles[id] === 'blue');
  need(blueIndex < 0 || blueIndex === eliminated.length - 1, 'No elimination after blue');
  const blueCaught = blueIndex >= 0;
  const points: Record<string, number> = { [guesser]: blueCaught ? 0 : eliminated.length + (eliminated.length === ids.length - 1 ? 1 : 0) };
  for (const id of ids) points[id] = roles[id] === 'red' ? eliminated.includes(id) ? 0 : eliminated.length : blueCaught ? ids.length - eliminated.length : 0;
  return points;
}
function finish(s: FishyState, outcome: FishyResult['outcome'], now: number, reason: string | null = null) {
  need(inRound(s) && !s.result, 'Round is already resolved');
  s.scoreBeforeResult = { ...s.scores };
  const points = outcome === 'void' ? Object.fromEntries([s.guesserId!, ...s.fish].map(id => [id, 0])) : scoreRound(s.guesserId!, s.roles, s.eliminated);
  for (const [id, n] of Object.entries(points)) s.scores[id] = (s.scores[id] ?? 0) + n;
  s.result = { round: s.round, roundId: s.roundId, outcome, points, reason };
  s.phase = 'RESULT'; s.paused = false;
  setDeadline(s, now, s.settings.autoNext && outcome !== 'void' ? 8 : 0);
}
function next(s: FishyState, now: number) {
  need(s.phase === 'RESULT', 'Wait for the round result');
  if (s.result?.outcome === 'void') setupRound(s, now, true);
  else if (s.round >= s.totalRounds) { s.phase = 'COMPLETED'; s.deadline = null; }
  else setupRound(s, now);
}
function pause(s: FishyState, now: number) {
  if (s.paused) return;
  s.pausedRemaining = s.deadline === null ? null : Math.max(0, s.deadline - now);
  s.deadline = null; s.paused = true;
}
export function playerDisconnected(s: FishyState, id: string, now = Date.now()) {
  const p = s.players[id]; if (!p) return;
  p.connected = false; p.disconnectedAt = now;
  if (inRound(s) && (id === s.guesserId || (s.phase === 'COLLECTION' && s.fish.includes(id) && !Object.hasOwn(s.submissions, id)))) {
    pause(s, now); s.notice = 'A required player disconnected. Reconnect, then resume; or void and replay.';
  }
}
const normalize = (s: string) => s.normalize('NFKC').toLocaleLowerCase().replace(/[\u200b-\u200d\ufeff]/g, '').replace(/[^\p{L}\p{N}]/gu, '');
export function applyAction(s: FishyState, actor: string, a: FishyAction, now = Date.now()) {
  need(a && typeof a.id === 'string' && a.id.length >= 8 && a.id.length <= 100 && typeof a.type === 'string', 'Invalid action');
  need(Object.hasOwn(s.players, actor), 'Unknown player', 401);
  if (s.processed.includes(`${actor}:${a.id}`)) return;
  need(a.generation === s.generation && a.roundId === s.roundId && a.phase === s.phase, 'This action is stale. Refresh and try again.', 409);
  const p = a.payload ?? {}; need(p && typeof p === 'object' && !Array.isArray(p), 'Invalid payload');
  const host = s.players[actor].role === 'HOST';
  const requireHost = () => need(host, 'Only the host can do that', 403);
  const decision = () => need(actor === s.guesserId || (host && s.roundSettings?.facilitator), 'Only the Guesser or enabled host facilitator can do that', 403);
  need(!s.paused || ['resume', 'settings', 'void', 'transfer-host', 'claim-host', 'end', 'restart', 'score', 'leave'].includes(a.type), 'The game is paused');
  switch (a.type) {
    case 'settings': {
      requireHost(); const updated = checkedSettings(s.settings, p);
      if (s.phase !== 'LOBBY') need(updated.lengthMode === s.settings.lengthMode && updated.rotations === s.settings.rotations && updated.rounds === s.settings.rounds, 'Restart to change game length');
      s.settings = updated;
      if (inRound(s)) s.notice = updated.mode !== s.roundSettings?.mode ? `${updated.mode === 'written' ? 'Written' : 'Party'} mode will start next round.` : 'Settings saved for the next round.';
      if (s.phase === 'RESULT') {
        if (s.paused) s.pausedRemaining = updated.autoNext && s.result?.outcome !== 'void' ? 8000 : null;
        else setDeadline(s, now, updated.autoNext && s.result?.outcome !== 'void' ? 8 : 0);
      }
      break;
    }
    case 'order': {
      requireHost(); need(s.phase === 'LOBBY', 'Seat order is locked after start');
      const ids = p.order;
      need(Array.isArray(ids) && ids.length === s.order.length && new Set(ids).size === ids.length && ids.every(id => typeof id === 'string' && s.order.includes(id)), 'Invalid seat order');
      s.order = ids as string[]; break;
    }
    case 'starting-player': requireHost(); need(s.phase === 'LOBBY' && active(s).includes(String(p.playerId)), 'Choose an active starting player'); s.nextGuesserId = String(p.playerId); break;
    case 'participation': {
      requireHost(); need(s.phase === 'LOBBY', 'Change participants before the game or restart');
      need(Object.hasOwn(s.players, String(p.playerId)), 'Invalid player');
      const player = s.players[String(p.playerId)]; need(player && typeof p.participating === 'boolean', 'Invalid player');
      player.participating = p.participating; break;
    }
    case 'start': requireHost(); need(s.phase === 'LOBBY', 'Game already started'); s.totalRounds = roundTotal(s.settings, active(s).length); setupRound(s, now); break;
    case 'present': decision(); need(s.phase === 'PREPARATION', 'Answers are not ready'); s.phase = 'ELIMINATION'; setDeadline(s, now, s.roundSettings!.decisionSeconds); break;
    case 'submit': {
      need(s.phase === 'COLLECTION' && s.fish.includes(actor), 'Only fish can submit during collection', 403);
      need(!Object.hasOwn(s.submissions, actor), 'Your answer is already locked');
      const text = s.roles[actor] === 'blue' ? s.question!.answer : p.answer;
      need(typeof text === 'string' && text.trim().length > 0 && text.length <= 240 && !/[\u0000-\u001f\u007f]/.test(text) && normalize(text).length > 0, 'Enter an answer of 1–240 characters');
      if (s.roles[actor] === 'red') need(![s.question!.answer, ...s.question!.acceptedAnswers].some(x => normalize(x) === normalize(text)), 'That matches the real answer. Invent a different bluff.');
      s.submissions[actor] = text.trim();
      if (s.fish.every(id => Object.hasOwn(s.submissions, id))) { s.phase = 'ELIMINATION'; setDeadline(s, now, s.roundSettings!.decisionSeconds); }
      break;
    }
    case 'eliminate': {
      decision(); need(s.phase === 'ELIMINATION', 'You cannot eliminate now');
      const id = String(p.playerId); need(s.fish.includes(id) && !s.eliminated.includes(id), 'This fish is unavailable');
      s.eliminated.push(id);
      if (s.roles[id] === 'blue') finish(s, 'blue', now);
      else if (s.eliminated.length === s.fish.length - 1) finish(s, 'all-reds', now);
      else setDeadline(s, now, s.roundSettings!.decisionSeconds);
      break;
    }
    case 'bank': decision(); need(s.phase === 'ELIMINATION', 'You cannot bank now'); finish(s, 'banked', now); break;
    case 'next': requireHost(); next(s, now); break;
    case 'pause': requireHost(); need(inRound(s) || s.phase === 'RESULT', 'No active round'); pause(s, now); break;
    case 'resume': need(host || actor === s.guesserId, 'Only host or Guesser can resume', 403); need(s.paused, 'Game is not paused'); s.deadline = s.pausedRemaining === null ? null : now + s.pausedRemaining; s.paused = false; s.pausedRemaining = null; s.notice = null; break;
    case 'replace': requireHost(); need(['PREPARATION', 'COLLECTION'].includes(s.phase) && Object.keys(s.submissions).length === 0, 'Use void/replay once answers are given'); audit(s, actor, 'Replaced question; fresh roles, same Guesser', now); setupRound(s, now, true); break;
    case 'void': {
      requireHost(); need(inRound(s) || s.phase === 'RESULT', 'No round to void');
      const reason = typeof p.reason === 'string' ? p.reason.trim().slice(0, 200) : '';
      need(reason, 'Give a reason for voiding this round');
      if (s.result) {
        need(s.result.outcome !== 'void', 'This round is already void');
        // Corrections made to this result are voided with it, so rollback cannot
        // produce negative scores after a host has already removed its points.
        if (s.scoreBeforeResult) s.scores = Object.fromEntries(s.order.map(id => [id, s.scoreBeforeResult![id] ?? 0]));
        else for (const [id, n] of Object.entries(s.result.points)) s.scores[id] -= n;
        s.result = { ...s.result, outcome: 'void', points: Object.fromEntries(Object.keys(s.result.points).map(id => [id, 0])), reason };
        s.paused = false; setDeadline(s, now, 0);
      } else finish(s, 'void', now, reason);
      audit(s, actor, `Voided round ${s.round}: ${reason}`, now); break;
    }
    case 'score': {
      requireHost(); const id = String(p.playerId), delta = p.delta;
      need(Object.hasOwn(s.players, id) && typeof delta === 'number' && Number.isInteger(delta) && Math.abs(delta) <= 100, 'Invalid score correction');
      need(typeof p.reason === 'string' && p.reason.trim().length > 0, 'Give a reason for the correction');
      need((s.scores[id] ?? 0) + delta >= 0, 'Scores cannot be negative');
      s.scores[id] = (s.scores[id] ?? 0) + delta;
      audit(s, actor, `${s.players[id].nickname}: ${delta >= 0 ? '+' : ''}${delta} (${p.reason.trim().slice(0, 200)})`, now); break;
    }
    case 'transfer-host': {
      requireHost(); need(Object.hasOwn(s.players, String(p.playerId)), 'Choose another player');
      const target = s.players[String(p.playerId)]; need(target && target.playerId !== actor, 'Choose another player');
      s.players[actor].role = 'PLAYER'; target.role = 'HOST'; audit(s, actor, `Host transferred to ${target.nickname}`, now); break;
    }
    case 'claim-host': {
      const old = Object.values(s.players).find(x => x.role === 'HOST');
      need(old && !old.connected && old.disconnectedAt !== null && now - old.disconnectedAt >= 60_000 && s.players[actor].participating && !s.players[actor].pending, 'Host recovery is available after 60 seconds offline');
      old.role = 'PLAYER'; s.players[actor].role = 'HOST'; audit(s, actor, `Recovered host from ${old.nickname}`, now); break;
    }
    case 'leave': {
      const player = s.players[actor];
      if (s.phase === 'LOBBY') { need(!host || s.order.length === 1, 'Transfer host before leaving'); player.participating = false; }
      else if (inRound(s) && (actor === s.guesserId || s.fish.includes(actor))) { pause(s, now); s.notice = 'A player left. Their round is preserved; reconnect or restart with the remaining group.'; }
      playerDisconnected(s, actor, now); break;
    }
    case 'end': requireHost(); if (inRound(s)) finish(s, 'void', now, 'Game ended by host'); s.phase = 'COMPLETED'; s.paused = false; s.deadline = null; s.endedReason = 'Ended by host'; break;
    case 'restart': {
      requireHost(); s.generation++; s.phase = 'LOBBY'; s.round = 0; s.roundId = ''; s.totalRounds = 0;
      s.guesserId = null; s.nextGuesserId = null; s.fish = []; s.roles = {}; s.question = null; s.roundSettings = null;
      s.submissions = {}; s.eliminated = []; s.result = null; s.scoreBeforeResult = null; s.used = {}; s.cycle = {}; s.deadline = null;
      s.paused = false; s.pausedRemaining = null; s.endedReason = null; s.notice = null;
      for (const x of Object.values(s.players)) { if (x.pending) x.participating = true; x.pending = false; }
      s.scores = Object.fromEntries(s.order.map(id => [id, 0])); s.audit = []; break;
    }
    default: throw new GameError('Unknown action');
  }
  s.processed.push(`${actor}:${a.id}`); s.processed = s.processed.slice(-1000);
  s.version++; s.expiresAt = now + (s.phase === 'LOBBY' ? 30 : 120) * 60_000;
}
export function expireState(s: FishyState, now = Date.now()): boolean {
  if (s.phase === 'COMPLETED') return false;
  if (now >= s.expiresAt) {
    if (inRound(s)) finish(s, 'void', now, 'Session expired');
    s.phase = 'COMPLETED'; s.deadline = null; s.paused = false; s.endedReason = 'Session expired'; return true;
  }
  if (s.paused || s.deadline === null || now < s.deadline) return false;
  if (s.phase === 'PREPARATION') { s.phase = 'ELIMINATION'; setDeadline(s, now, s.roundSettings!.decisionSeconds); }
  else if (s.phase === 'COLLECTION') { s.deadline = null; pause(s, now); s.notice = 'Time is up. Waiting for missing answers; host can resume or void the round.'; }
  else if (s.phase === 'ELIMINATION') finish(s, 'banked', now);
  else if (s.phase === 'RESULT') next(s, now);
  else return false;
  return true;
}
export function serializeForPlayer(s: FishyState, id: string, now = Date.now()): FishyView {
  const p = s.players[id];
  const resolved = !!s.result;
  const publicRoles = Object.fromEntries(Object.entries(s.roles).filter(([playerId]) => resolved || s.eliminated.includes(playerId)));
  const bank = fishyBanks[s.settings.bankId];
  const v: FishyView = {
    gameType: 'sounds-fishy', gameId: s.gameId, version: s.version, generation: s.generation,
    roundId: s.roundId, serverNow: now, phase: s.phase, yourPlayerId: p?.playerId ?? '', yourRole: p?.role ?? 'DISPLAY',
    players: s.order.map(playerId => { const { token: _token, disconnectedAt: _at, ...player } = s.players[playerId]; return player; }),
    order: [...s.order], settings: { ...s.settings }, roundSettings: s.roundSettings && { ...s.roundSettings }, banks: fishyBankSummaries,
    round: s.round, totalRounds: s.phase === 'LOBBY' ? roundTotal(s.settings, active(s).length) : s.totalRounds,
    guesserId: s.guesserId, nextGuesserId: s.nextGuesserId, fish: [...s.fish], scores: { ...s.scores }, submitted: Object.keys(s.submissions),
    roles: publicRoles, eliminated: [...s.eliminated], provisional: s.eliminated.filter(x => s.roles[x] === 'red').length,
    result: s.result && structuredClone(s.result), deadline: s.deadline, paused: s.paused, pausedRemaining: s.pausedRemaining,
    notice: s.notice, endedReason: s.endedReason, winners: [], audit: structuredClone(s.audit),
    poolRemaining: bank ? bank.questions.filter(q => !(s.used[bank.bankId] ?? []).includes(q.id)).length : 0,
    poolCycle: s.cycle[s.settings.bankId] ?? 1,
  };
  if (s.question) v.question = s.question.question;
  if (resolved && s.question) { v.answer = s.question.answer; v.explanation = s.question.explanation; v.sources = structuredClone(s.question.sources); }
  else if (p && s.fish.includes(id)) { v.answer = s.question!.answer; v.ownRole = s.roles[id]; }
  if (p && Object.hasOwn(s.submissions, id)) v.ownSubmission = s.submissions[id];
  if (s.phase === 'ELIMINATION' || resolved) v.answers = { ...s.submissions };
  if (p?.role === 'HOST') v.displayToken = s.displayToken;
  if (s.phase === 'COMPLETED') {
    const eligible = s.order.filter(x => s.players[x].participating && !s.players[x].pending);
    const top = Math.max(...eligible.map(x => s.scores[x] ?? 0)); v.winners = eligible.filter(x => (s.scores[x] ?? 0) === top);
  }
  return v;
}
