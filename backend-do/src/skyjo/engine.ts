import {
  checkedSkySettings, type SkyAction, type SkyCard, type SkyEvent, type SkyPhase,
  type SkyResult, type SkySettings, type SkyStep, type SkyView,
} from '../../../shared/skyjo.js';

export class GameError extends Error { constructor(message: string, public status = 400) { super(message); } }
function need(ok: unknown, message: string, status = 400): asserts ok { if (!ok) throw new GameError(message, status); }
export interface StoredPlayer { playerId: string; nickname: string; role: 'HOST' | 'PLAYER'; token: string; connected: boolean; disconnectedAt: number | null }
export interface Slot { card: SkyCard; faceUp: boolean }
export interface SkyState {
  gameId: string; version: number; revision: number; generation: number; phase: SkyPhase; step: SkyStep;
  players: Record<string, StoredPlayer>; order: string[]; displayToken: string; settings: SkySettings;
  grids: Record<string, (Slot | null)[]>; starting: Record<string, number>; totals: Record<string, number>;
  deck: SkyCard[]; discard: SkyCard[]; rng: number | null; round: number; turn: string | null;
  pending: { owner: string; source: 'deck' | 'discard'; card: SkyCard } | null;
  finisher: string | null; finalTurns: string[]; previousFinisher: string | null;
  deadline: number | null; nextRoundAt: number | null; pausedAt: number | null;
  result: SkyResult | null; history: SkyResult[]; winners: string[]; endedReason: string | null;
  events: SkyEvent[]; eventSequence: number; expiresAt: number; processed: { id: string; actor: string }[];
}
const name = (s: SkyState, id: string) => s.players[id]?.nickname ?? 'Player';
const hidden = (s: SkyState, id: string) => s.grids[id].filter(c => c && !c.faceUp).length;
function event(s: SkyState, now: number, type: SkyEvent['type'], actor: string | null, message: string, extra: Partial<SkyEvent> = {}) {
  s.events.push({ ...extra, id: ++s.eventSequence, at: now, type, actor, message }); s.events = s.events.slice(-60);
}
/** Production uses Web Crypto; supplying a seed makes test shuffles reproducible. */
export function createState(gameId: string, host: StoredPlayer, displayToken: string, raw: unknown = {}, now = Date.now(), seed?: number): SkyState {
  return { gameId, players: { [host.playerId]: host }, order: [host.playerId], displayToken,
    settings: checkedSkySettings(raw), version: 1, revision: 0, generation: 1, phase: 'LOBBY', step: 'choose',
    grids: {}, starting: {}, totals: {}, deck: [], discard: [], rng: seed ?? null, round: 0, turn: null, pending: null,
    finisher: null, finalTurns: [], previousFinisher: null, deadline: null, nextRoundAt: null, pausedAt: null,
    result: null, history: [], winners: [], endedReason: null, events: [], eventSequence: 0,
    expiresAt: now + 30 * 60_000, processed: [] };
}
export function makeDeck(): SkyCard[] {
  return Array.from({ length: 15 }, (_, i) => i - 2).flatMap(value =>
    Array.from({ length: value === -2 ? 5 : value === 0 ? 15 : 10 }, (_, n) => ({ id: `sky-${value}-${n}`, value })));
}
function shuffle(s: SkyState, cards: SkyCard[]) {
  for (let i = cards.length - 1; i > 0; i--) {
    let j: number;
    if (s.rng === null) {
      // Rejection sampling avoids modulo bias and gives production decks full cryptographic entropy.
      const bound = Math.floor(4294967296 / (i + 1)) * (i + 1); let r: number;
      do { r = crypto.getRandomValues(new Uint32Array(1))[0]; } while (r >= bound);
      j = r % (i + 1);
    } else {
      s.rng = (s.rng + 0x6D2B79F5) >>> 0;
      let t = s.rng; t = Math.imul(t ^ t >>> 15, t | 1); t ^= t + Math.imul(t ^ t >>> 7, t | 61);
      j = Math.floor(((t ^ t >>> 14) >>> 0) / 4294967296 * (i + 1));
    }
    [cards[i], cards[j]] = [cards[j], cards[i]];
  }
  return cards;
}
function setTimer(s: SkyState, now: number) { s.deadline = s.settings.rules.turnSeconds ? now + s.settings.rules.turnSeconds * 1000 : null; }
export function beginRound(s: SkyState, now: number) {
  s.round++; s.phase = 'SETUP'; s.step = 'choose'; s.turn = null; s.pending = null; s.finisher = null; s.finalTurns = [];
  s.nextRoundAt = null; s.result = null; s.deck = shuffle(s, makeDeck()); s.discard = [];
  s.grids = Object.fromEntries(s.order.map(id => [id, []])); s.starting = Object.fromEntries(s.order.map(id => [id, 0]));
  for (let i = 0; i < 12; i++) for (const id of s.order) s.grids[id].push({ card: s.deck.pop()!, faceUp: false });
  s.discard.push(s.deck.pop()!); setTimer(s, now);
  event(s, now, 'deal', null, `Round ${s.round} · choose ${s.settings.rules.startingCards} cards to turn over`);
}
export function removeColumns(s: SkyState, id: string, now: number) {
  if (!s.settings.rules.columns) return;
  const g = s.grids[id];
  for (let c = 0; c < 4; c++) {
    const indices = [c, c + 4, c + 8], slots = indices.map(i => g[i]);
    if (slots.every(v => v?.faceUp) && slots.every(v => v!.card.value === slots[0]!.card.value)) {
      // The replaced/discarded card is already on the pile. Triplet goes on top, top row to bottom row.
      for (const i of indices) { s.discard.push(g[i]!.card); g[i] = null; }
      event(s, now, 'column', id, `${name(s, id)} clears a column of ${slots[0]!.card.value}s`, { column: c, card: slots[0]!.card });
    }
  }
}
function finishRound(s: SkyState, now: number) {
  need(s.finisher, 'No round finisher');
  for (const id of s.order) {
    for (const slot of s.grids[id]) if (slot) slot.faceUp = true;
    removeColumns(s, id, now);
  }
  const raw = Object.fromEntries(s.order.map(id => [id, s.grids[id].reduce((sum, c) => sum + (c?.card.value ?? 0), 0)]));
  const scores = { ...raw }, doubled = s.settings.rules.penalty && raw[s.finisher] > 0 && s.order.some(id => id !== s.finisher && raw[id] <= raw[s.finisher!]);
  if (doubled) scores[s.finisher] *= 2;
  for (const id of s.order) s.totals[id] += scores[id];
  s.result = { round: s.round, raw, scores, totals: { ...s.totals }, finisher: s.finisher, doubled };
  s.history.push(structuredClone(s.result)); s.history = s.history.slice(-100);
  s.previousFinisher = s.finisher; s.turn = null; s.pending = null; s.deadline = null; s.finalTurns = [];
  const done = s.settings.rules.fixedRounds ? s.round >= s.settings.rules.fixedRounds : s.order.some(id => s.totals[id] >= s.settings.rules.target);
  s.phase = done ? 'COMPLETED' : 'RESULTS';
  event(s, now, 'score', s.finisher, doubled ? `${name(s, s.finisher)} did not finish strictly lowest: ${raw[s.finisher]} × 2 = ${scores[s.finisher]}` : `Round ${s.round} scored · lowest total wins`);
  if (done) {
    const min = Math.min(...Object.values(s.totals)); s.winners = s.order.filter(id => s.totals[id] === min);
    event(s, now, 'win', s.winners[0], `${s.winners.map(id => name(s, id)).join(' & ')} ${s.winners.length > 1 ? 'share the win' : 'wins'}!`);
  } else s.nextRoundAt = s.settings.autoNext ? now + 15_000 : null;
}
function finishTurn(s: SkyState, actor: string, now: number) {
  removeColumns(s, actor, now); s.pending = null; s.step = 'choose';
  if (!s.finisher && hidden(s, actor) === 0) {
    s.finisher = actor; const i = s.order.indexOf(actor);
    s.finalTurns = s.order.slice(i + 1).concat(s.order.slice(0, i));
    event(s, now, 'final', actor, `${name(s, actor)} closes the round · everyone else gets one last turn`);
  } else if (s.finisher) s.finalTurns.shift();
  if (s.finisher) {
    // An empty grid has no legal target; its final turn is already complete.
    while (s.finalTurns.length && !s.grids[s.finalTurns[0]].some(Boolean)) s.finalTurns.shift();
    if (!s.finalTurns.length) { finishRound(s, now); return; }
    s.turn = s.finalTurns[0];
  } else s.turn = s.order[(s.order.indexOf(actor) + 1) % s.order.length];
  setTimer(s, now);
}
function setupReveal(s: SkyState, actor: string, index: number, now: number) {
  need(s.starting[actor] < s.settings.rules.startingCards, 'Your starting cards are already revealed');
  const slot = s.grids[actor][index]; need(slot && !slot.faceUp, 'Choose a face-down card');
  slot.faceUp = true; s.starting[actor]++;
  event(s, now, 'flip', actor, `${name(s, actor)} reveals ${slot.card.value}`, { index, card: slot.card });
  if (s.order.every(id => s.starting[id] === s.settings.rules.startingCards)) {
    // Stable seat order breaks equal starting sums. Later rounds use the previous finisher.
    s.turn = s.previousFinisher ?? s.order.reduce((best, id) => visibleScore(s, id) > visibleScore(s, best) ? id : best, s.order[0]);
    for (const id of s.order) removeColumns(s, id, now);
    s.phase = 'PLAY'; setTimer(s, now);
    event(s, now, 'system', s.turn, `${name(s, s.turn)} starts${s.previousFinisher ? ' · ended the previous round' : ' · highest opening sum (seat order breaks ties)'}`);
  }
}
function visibleScore(s: SkyState, id: string) { return s.grids[id].reduce((sum, c) => sum + (c?.faceUp ? c.card.value : 0), 0); }
function draw(s: SkyState, actor: string, now: number) {
  if (!s.deck.length) {
    need(s.discard.length > 1, 'Draw pile unavailable. Take the discard instead.');
    const top = s.discard.pop()!; s.deck = shuffle(s, s.discard); s.discard = [top];
    event(s, now, 'shuffle', null, 'Draw pile replenished · top discard stays in place');
  }
  s.pending = { owner: actor, card: s.deck.pop()!, source: 'deck' }; s.step = 'drawn';
  event(s, now, 'draw', actor, `${name(s, actor)} draws a private card`);
}
function play(s: SkyState, actor: string, type: string, p: Record<string, unknown>, now: number) {
  need(s.turn === actor, 'Wait for your turn', 409);
  if (type === 'draw' || type === 'take') {
    need(s.step === 'choose' && !s.pending, 'Finish your selected card first', 409);
    if (type === 'draw') draw(s, actor, now);
    else {
      need(s.discard.length, 'The discard pile is empty');
      s.pending = { owner: actor, source: 'discard', card: s.discard.pop()! }; s.step = 'replace';
      event(s, now, 'take', actor, `${name(s, actor)} takes ${s.pending.card.value}`, { card: s.pending.card });
    }
  } else if (type === 'return-discard') {
    need(s.step === 'replace' && s.pending?.source === 'discard' && s.pending.owner === actor, 'No selected discard to return');
    // No new information was revealed. Restore the pile without advancing the turn or its timer.
    const card = s.pending.card; s.discard.push(card); s.pending = null; s.step = 'choose';
    event(s, now, 'system', actor, `${name(s, actor)} returns ${card.value} to the discard pile`, { card });
  } else if (type === 'keep') {
    need(s.step === 'drawn' && s.pending?.source === 'deck', 'No drawn card to keep'); s.step = 'replace';
  } else if (type === 'cancel-keep') {
    need(s.step === 'replace' && s.pending?.source === 'deck' && s.pending.owner === actor, 'No kept draw to reconsider');
    // Reopen the decision about this same private card; never return it to the deck.
    s.step = 'drawn';
    event(s, now, 'system', actor, `${name(s, actor)} is reconsidering a private card`);
  } else if (type === 'discard') {
    need(s.step === 'drawn' && s.pending?.source === 'deck', 'No drawn card to discard');
    need(hidden(s, actor) > 0, 'No hidden cards remain. You must replace a card.');
    const card = s.pending.card; s.discard.push(card); s.pending = null; s.step = 'reveal';
    event(s, now, 'discard', actor, `${name(s, actor)} discards ${card.value} · choose a hidden card to reveal`, { card });
  } else if (type === 'replace' || type === 'reveal') {
    need(Number.isInteger(p.index) && Number(p.index) >= 0 && Number(p.index) < 12, 'Invalid grid position');
    const index = Number(p.index), slot = s.grids[actor][index]; need(slot, 'That column has been removed');
    if (type === 'replace') {
      need(s.step === 'replace' && s.pending, 'Select a card to place first');
      const card = s.pending.card; s.discard.push(slot.card); s.grids[actor][index] = { card, faceUp: true };
      event(s, now, 'swap', actor, `${name(s, actor)} places ${card.value}, discards ${slot.card.value}`, { index, card });
    } else {
      need(s.step === 'reveal' && !slot.faceUp, 'Choose a face-down card'); slot.faceUp = true;
      event(s, now, 'flip', actor, `${name(s, actor)} reveals ${slot.card.value}`, { index, card: slot.card });
    }
    finishTurn(s, actor, now);
  } else throw new GameError('Unknown action');
}
/** Explicit automatic policy: first hidden position, otherwise first occupied; never inspect hidden values. */
function automatic(s: SkyState, now: number) {
  if (s.phase === 'SETUP') {
    for (const id of s.order) while (s.phase === 'SETUP' && s.starting[id] < s.settings.rules.startingCards) setupReveal(s, id, s.grids[id].findIndex(c => c && !c.faceUp), now);
    return;
  }
  const id = s.turn!; const h = s.grids[id].findIndex(c => c && !c.faceUp), index = h >= 0 ? h : s.grids[id].findIndex(Boolean);
  if (s.step === 'choose') draw(s, id, now);
  if (s.step === 'drawn') play(s, id, h >= 0 ? 'discard' : 'keep', {}, now);
  play(s, id, s.step === 'reveal' ? 'reveal' : 'replace', { index }, now);
}
export function applyAction(s: SkyState, actor: string, a: SkyAction, now = Date.now()) {
  need(s.players[actor], 'Unknown player', 401);
  need(a && typeof a.id === 'string' && a.id.length > 0 && a.id.length <= 100, 'Missing action ID');
  if (s.processed.some(p => p.actor === actor && p.id === a.id)) return;
  need(a.generation === s.generation && a.round === s.round, 'The round changed. Please try again.', 409);
  const presentation = a.type === 'display-mode', setup = a.type === 'setup' && s.phase === 'SETUP';
  // Simultaneous initial reveals commute; presentation never invalidates pending gameplay requests.
  if (!presentation && !setup) need(a.revision === s.revision, 'The table changed. Please try again.', 409);
  const p = a.payload ?? {}, admin = ['settings', 'reorder', 'remove', 'start', 'pause', 'resume', 'extend', 'next-round', 'restart', 'lobby', 'end', 'recover', 'display-mode'];
  if (admin.includes(a.type)) need(s.players[actor].role === 'HOST', 'Only the host can do that', 403);
  if (presentation) {
    need(p.mode === 'normal' || p.mode === 'tv', 'Invalid display mode'); s.settings.displayMode = p.mode;
  } else if (a.type === 'settings') {
    need(s.phase === 'LOBBY', 'Gameplay rules are locked after starting', 409); s.settings = checkedSkySettings(p.settings);
  } else if (a.type === 'reorder') {
    need(s.phase === 'LOBBY', 'Seat order is locked after starting', 409);
    need(Array.isArray(p.order) && p.order.length === s.order.length && new Set(p.order).size === s.order.length && p.order.every(id => typeof id === 'string' && s.order.includes(id)), 'Invalid seat order'); s.order = p.order as string[];
  } else if (a.type === 'remove') {
    need(s.phase === 'LOBBY' && typeof p.playerId === 'string' && p.playerId !== actor && s.order.includes(p.playerId), 'Only other lobby players can be removed');
    delete s.players[p.playerId]; s.order = s.order.filter(id => id !== p.playerId);
  } else if (a.type === 'start') {
    need(s.phase === 'LOBBY' && s.order.length >= 2 && s.order.length <= 8, 'Skyjo needs 2–8 players');
    s.totals = Object.fromEntries(s.order.map(id => [id, 0])); beginRound(s, now);
  } else if (a.type === 'pause') {
    need(['SETUP', 'PLAY', 'RESULTS'].includes(s.phase) && s.pausedAt === null, 'Cannot pause now'); s.pausedAt = now;
  } else if (a.type === 'resume') {
    need(s.pausedAt !== null, 'Game is not paused'); const elapsed = now - s.pausedAt;
    if (s.deadline !== null) s.deadline += elapsed; if (s.nextRoundAt !== null) s.nextRoundAt += elapsed; s.pausedAt = null;
  } else if (a.type === 'extend') {
    need(s.deadline !== null, 'No turn timer running'); s.deadline += 30_000;
  } else if (a.type === 'next-round') {
    need(s.phase === 'RESULTS' && s.pausedAt === null, 'Wait for round results'); beginRound(s, now);
  } else if (a.type === 'restart' || a.type === 'lobby') {
    s.generation++; s.round = 0; s.phase = 'LOBBY'; s.grids = {}; s.starting = {}; s.totals = {}; s.deck = []; s.discard = [];
    s.turn = null; s.pending = null; s.finisher = null; s.finalTurns = []; s.previousFinisher = null; s.step = 'choose';
    s.deadline = null; s.nextRoundAt = null; s.pausedAt = null; s.result = null; s.history = []; s.winners = []; s.endedReason = null; s.events = [];
    if (a.type === 'restart') { need(s.order.length >= 2, 'Need two players'); s.totals = Object.fromEntries(s.order.map(id => [id, 0])); beginRound(s, now); }
  } else if (a.type === 'end') {
    if (s.pending) s.discard.push(s.pending.card); s.pending = null; s.turn = null; s.deadline = null; s.nextRoundAt = null;
    s.phase = 'COMPLETED'; s.pausedAt = null; s.endedReason = 'Ended by host · completed round totals retained';
    event(s, now, 'system', actor, s.endedReason);
  } else {
    need((s.phase === 'SETUP' || s.phase === 'PLAY') && s.pausedAt === null, 'Game is not accepting moves', 409);
    if (a.type === 'setup') {
      need(s.phase === 'SETUP' && Number.isInteger(p.index) && Number(p.index) >= 0 && Number(p.index) < 12, 'Invalid starting selection');
      setupReveal(s, actor, Number(p.index), now);
    } else if (a.type === 'recover') {
      if (s.phase === 'SETUP') need(s.order.filter(id => s.starting[id] < s.settings.rules.startingCards).every(id => !s.players[id].connected), 'Wait for connected players to choose their starting cards');
      else need(s.turn && !s.players[s.turn].connected, 'Recovery is only for an offline player');
      automatic(s, now); event(s, now, 'system', actor, 'Host resolved an offline decision using the automatic policy');
    } else { need(s.phase === 'PLAY', 'Choose your starting cards first'); play(s, actor, a.type, p, now); }
  }
  s.version++; if (!presentation) s.revision++;
  s.expiresAt = now + (s.phase === 'LOBBY' ? 30 * 60_000 : 24 * 60 * 60_000);
  s.processed.push({ id: a.id, actor }); s.processed = s.processed.slice(-300);
}
export function expireState(s: SkyState, now = Date.now()): boolean {
  if (s.phase === 'COMPLETED') return false;
  if (now >= s.expiresAt) {
    if (s.pending) s.discard.push(s.pending.card); s.pending = null; s.phase = 'COMPLETED'; s.turn = null; s.deadline = null; s.nextRoundAt = null; s.endedReason = 'Session expired after inactivity';
  } else if (s.pausedAt !== null) return false;
  else if (s.phase === 'RESULTS' && s.nextRoundAt !== null && now >= s.nextRoundAt) beginRound(s, now);
  else if (s.deadline !== null && now >= s.deadline && (s.phase === 'SETUP' || s.phase === 'PLAY')) {
    if (s.settings.rules.timeout === 'pause') {
      s.pausedAt = now; setTimer(s, now); event(s, now, 'system', null, 'Timer expired · game paused for the host to resume');
    } else { automatic(s, now); event(s, now, 'system', null, 'Timer expired · automatic policy applied'); }
    s.expiresAt = now + 24 * 60 * 60_000;
  } else return false;
  s.version++; s.revision++; return true;
}
export function nextDeadline(s: SkyState) {
  return Math.min(s.expiresAt, ...(s.pausedAt !== null ? [] : [s.deadline, s.nextRoundAt].filter((v): v is number => v !== null)));
}
/** Explicit allowlist projection: no deck, seed, tokens, hidden identities, or other player's drawn value. */
export function serializeForPlayer(s: SkyState, id: string, now = Date.now()): SkyView {
  const own = s.players[id];
  return {
    gameType: 'skyjo', gameId: s.gameId, version: s.version, revision: s.revision, generation: s.generation,
    phase: s.phase, step: s.step, paused: s.pausedAt !== null, settings: structuredClone(s.settings), round: s.round,
    players: s.order.map(playerId => { const p = s.players[playerId], grid = s.grids[playerId] ?? []; return {
      playerId, nickname: p.nickname, role: p.role, connected: p.connected, total: s.totals[playerId] ?? 0,
      grid: grid.map((c, i) => c ? { id: c.faceUp ? c.card.id : `hidden-${s.round}-${playerId}-${i}`, value: c.faceUp ? c.card.value : null } : null),
      visible: grid.reduce((sum, c) => sum + (c?.faceUp ? c.card.value : 0), 0), hidden: grid.filter(c => c && !c.faceUp).length,
      startingRevealed: s.starting[playerId] ?? 0,
    }; }),
    turn: s.turn, finisher: s.finisher, finalTurns: [...s.finalTurns],
    pending: s.pending ? { owner: s.pending.owner, source: s.pending.source, card: s.pending.source === 'discard' ? { ...s.pending.card } : null } : null,
    yourCard: s.pending?.owner === id ? { ...s.pending.card } : null,
    deckCount: s.deck.length, discardCount: s.discard.length, discardTop: s.discard.length ? { ...s.discard.at(-1)! } : null,
    events: structuredClone(s.events), result: structuredClone(s.result), history: structuredClone(s.history), winners: [...s.winners],
    deadline: s.deadline, nextRoundAt: s.nextRoundAt, serverNow: s.pausedAt ?? now, endedReason: s.endedReason,
    yourPlayerId: own?.playerId ?? null, yourRole: own?.role ?? 'DISPLAY',
    ...(own?.role === 'HOST' ? { displayUrl: `/g/${s.gameId}/display#token=${encodeURIComponent(s.displayToken)}` } : {}),
  };
}
