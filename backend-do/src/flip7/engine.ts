import {
  checkedFlipSettings, flipLabel, flipScore, type FlipAction, type FlipCard, type FlipEvent,
  type FlipHand, type FlipPending, type FlipPhase, type FlipResult, type FlipRules, type FlipSettings, type FlipView,
} from '../../../shared/flip7.js';

export class GameError extends Error { constructor(message: string, public status = 400) { super(message); } }
function need(ok: unknown, message: string, status = 400): asserts ok { if (!ok) throw new GameError(message, status); }
export interface StoredPlayer { playerId: string; nickname: string; role: 'HOST' | 'PLAYER'; token: string; connected: boolean; disconnectedAt: number | null }
type Task = { kind: 'deal'; owner: string } | { kind: 'effect'; owner: string; card: FlipCard }
  | { kind: 'forced'; owner: string; remaining: number; queued: FlipCard[] };
export interface FlipState {
  gameId: string; version: number; revision: number; generation: number; phase: FlipPhase;
  players: Record<string, StoredPlayer>; order: string[]; displayToken: string; settings: FlipSettings;
  hands: Record<string, FlipHand>; totals: Record<string, number>; deck: FlipCard[]; discard: FlipCard[];
  round: number; dealer: string | null; turn: string | null; initial: boolean;
  tasks: Task[]; pending: FlipPending | null; continuation: string | null;
  nextAt: number | null; deadline: number | null; nextRoundAt: number | null; pausedAt: number | null;
  result: FlipResult | null; history: FlipResult[]; winner: string | null; endedReason: string | null;
  events: FlipEvent[]; eventSequence: number; expiresAt: number;
  processed: { id: string; actor: string }[];
}
const emptyHand = (): FlipHand => ({ cards: [], status: 'active', flip7: false });
const active = (s: FlipState, id: string) => s.hands[id]?.status === 'active';
const name = (s: FlipState, id: string) => s.players[id]?.nickname ?? 'Player';
const hasCard = (s: FlipState, id: string) => s.hands[id]?.cards.length > 0;
function event(s: FlipState, now: number, type: FlipEvent['type'], actor: string | null, message: string, extra: Partial<FlipEvent> = {}) {
  s.events.push({ ...extra, id: ++s.eventSequence, at: now, type, actor, message });
  s.events = s.events.slice(-60);
}
export function createState(gameId: string, host: StoredPlayer, displayToken: string, raw: unknown = {}, now = Date.now()): FlipState {
  return { gameId, players: { [host.playerId]: host }, order: [host.playerId], displayToken,
    settings: checkedFlipSettings(raw), phase: 'LOBBY', version: 1, revision: 0, generation: 1,
    hands: {}, totals: {}, deck: [], discard: [], round: 0, dealer: null, turn: null,
    initial: false, tasks: [], pending: null, continuation: null, nextAt: null, deadline: null,
    nextRoundAt: null, pausedAt: null, result: null, history: [], winner: null, endedReason: null,
    events: [], eventSequence: 0, expiresAt: now + 30 * 60_000, processed: [] };
}
/** All physical cards have stable, unique IDs. The standard recipe is 79 + 6 + 9. */
export function makeDeck(rules: FlipRules): FlipCard[] {
  const recipe: { kind: FlipCard['kind']; value: number; count: number }[] = [
    ...Array.from({ length: 13 }, (_, value) => ({ kind: 'number' as const, value, count: Math.max(1, value) })),
    ...[2, 4, 6, 8, 10].map(value => ({ kind: 'bonus' as const, value, count: 1 })),
    { kind: 'double', value: 0, count: 1 }, { kind: 'freeze', value: 0, count: rules.freeze },
    { kind: 'flip-three', value: 0, count: rules.flipThree }, { kind: 'second-chance', value: 0, count: rules.secondChance },
  ];
  return recipe.flatMap(c => Array.from({ length: c.count }, (_, n) => ({ id: `${c.kind}-${c.value}-${n}`, kind: c.kind, value: c.value })));
}
function shuffle(cards: FlipCard[]) {
  for (let i = cards.length - 1; i > 0; i--) {
    const bound = Math.floor(0x100000000 / (i + 1)) * (i + 1);
    let r: number;
    do { r = crypto.getRandomValues(new Uint32Array(1))[0]; } while (r >= bound);
    const j = r % (i + 1); [cards[i], cards[j]] = [cards[j], cards[i]];
  }
  return cards;
}
function releaseTasks(s: FlipState) {
  if (s.pending) s.discard.push(s.pending.card);
  for (const t of s.tasks) {
    if (t.kind === 'effect') s.discard.push(t.card);
    if (t.kind === 'forced') s.discard.push(...t.queued);
  }
  s.tasks = []; s.pending = null; s.deadline = null; s.nextAt = null;
}
function finishRound(s: FlipState, now: number, flip7: string | null = null) {
  if (s.phase !== 'PLAY') return;
  releaseTasks(s); s.turn = null; s.initial = false; s.continuation = null;
  const scores: Record<string, number> = {};
  for (const id of s.order) {
    const hand = s.hands[id]; scores[id] = flipScore(hand, s.settings.rules); s.totals[id] += scores[id];
    s.discard.push(...hand.cards.filter(c => c.kind === 'second-chance'));
    hand.cards = hand.cards.filter(c => c.kind !== 'second-chance');
  }
  const max = Math.max(...Object.values(s.totals));
  const leaders = s.order.filter(id => s.totals[id] === max);
  const threshold = s.settings.rules.fixedRounds ? s.round >= s.settings.rules.fixedRounds : max >= s.settings.rules.target;
  s.result = { round: s.round, scores, totals: { ...s.totals }, flip7, tied: threshold && leaders.length > 1 };
  s.history.push(s.result); s.history = s.history.slice(-100);
  event(s, now, 'score', flip7, `Round ${s.round} banked${s.result.tied ? ' · tied leaders: everyone plays another round' : ''}`);
  if (threshold && leaders.length === 1) {
    s.phase = 'COMPLETED'; s.winner = leaders[0]; s.nextRoundAt = null;
    event(s, now, 'win', s.winner, `${name(s, s.winner)} wins with ${max} points!`);
  } else { s.phase = 'RESULTS'; s.nextRoundAt = s.settings.autoNext ? now + 10_000 : null; }
}
function pickNext(s: FlipState, after: string, now: number) {
  const i = s.order.indexOf(after);
  s.turn = Array.from({ length: s.order.length }, (_, n) => s.order[(i + n + 1) % s.order.length]).find(id => active(s, id)) ?? null;
  if (!s.turn) { finishRound(s, now); return; }
  s.deadline = s.settings.rules.turnSeconds ? now + s.settings.rules.turnSeconds * 1000 : null;
}
function draw(s: FlipState, owner: string, now: number, forced?: Extract<Task, { kind: 'forced' }>) {
  if (!s.deck.length && s.discard.length) { s.deck = shuffle(s.discard.splice(0)); event(s, now, 'shuffle', null, 'Discard pile shuffled · table cards stay in place'); }
  if (!s.deck.length) { event(s, now, 'system', null, 'No drawable cards remain · banking the table'); finishRound(s, now); return; }
  const card = s.deck.pop()!, hand = s.hands[owner];
  event(s, now, 'draw', owner, `${name(s, owner)} flips ${flipLabel(card)}`, { card, remaining: forced?.remaining });
  if (card.kind === 'number') {
    if (hand.cards.some(c => c.kind === 'number' && c.value === card.value)) {
      const chance = hand.cards.find(c => c.kind === 'second-chance');
      if (chance) {
        hand.cards = hand.cards.filter(c => c.id !== chance.id); s.discard.push(card, chance);
        event(s, now, 'save', owner, `${name(s, owner)} is saved by Second Chance!`, { card });
      } else { hand.cards.push(card); hand.status = 'busted'; event(s, now, 'bust', owner, `${name(s, owner)} busts · duplicate ${card.value}`, { card }); }
    } else {
      hand.cards.push(card);
      if (hand.cards.filter(c => c.kind === 'number').length >= s.settings.rules.unique) {
        hand.flip7 = true; event(s, now, 'flip7', owner, `${name(s, owner)} flips ${s.settings.rules.unique}! +${s.settings.rules.bonus} bonus`);
        finishRound(s, now, owner);
      }
    }
  } else if (card.kind === 'bonus' || card.kind === 'double') hand.cards.push(card);
  else if (card.kind === 'second-chance' && !hand.cards.some(c => c.kind === 'second-chance')) {
    hand.cards.push(card); event(s, now, 'second-chance', owner, `${name(s, owner)} is protected`, { card });
  } else if (forced && card.kind !== 'second-chance') forced.queued.push(card);
  else s.tasks.unshift({ kind: 'effect', owner, card });
}
function eligible(s: FlipState, owner: string, card: FlipCard) {
  return s.order.filter(id => active(s, id) && (card.kind !== 'second-chance' || (id !== owner && !s.hands[id].cards.some(c => c.kind === 'second-chance'))));
}
function resolve(s: FlipState, target: string, now: number) {
  const pending = s.pending!;
  need(pending.eligible.includes(target) && active(s, target), 'Choose an eligible active player');
  s.pending = null; s.deadline = null;
  const card = pending.card;
  if (card.kind === 'second-chance') {
    s.hands[target].cards.push(card); event(s, now, 'second-chance', target, `${name(s, target)} receives Second Chance`, { card });
  } else {
    s.discard.push(card);
    if (card.kind === 'freeze') { s.hands[target].status = 'frozen'; event(s, now, 'freeze', target, `${name(s, target)} is frozen · ${flipScore(s.hands[target], s.settings.rules)} secured`, { card }); }
    else { s.tasks.unshift({ kind: 'forced', owner: target, remaining: 3, queued: [] }); event(s, now, 'flip-three', target, `${name(s, target)} must flip three`, { card, remaining: 3 }); }
  }
}
/** Resolve bookkeeping immediately, but expose each automatic draw as its own durable transition. */
function settle(s: FlipState, now: number) {
  while (s.phase === 'PLAY' && !s.pending) {
    if (!s.order.some(id => active(s, id))) { finishRound(s, now); return; }
    const t = s.tasks[0];
    if (!t) {
      s.nextAt = null;
      if (s.initial) { s.initial = false; pickNext(s, s.dealer!, now); }
      else if (s.continuation) { const original = s.continuation; s.continuation = null; pickNext(s, original, now); }
      return;
    }
    // A frozen owner can still assign actions already earned by a completed
    // Flip Three. Only a bust cancels those effects; all targets stay active.
    if (t.kind === 'effect' ? s.hands[t.owner].status === 'busted' : !active(s, t.owner)) {
      s.tasks.shift(); if (t.kind === 'effect') s.discard.push(t.card); if (t.kind === 'forced') s.discard.push(...t.queued); continue;
    }
    if (t.kind === 'effect') {
      s.tasks.shift(); const targets = eligible(s, t.owner, t.card);
      if (!targets.length) { s.discard.push(t.card); continue; }
      s.pending = { owner: t.owner, card: t.card, eligible: targets }; s.nextAt = null;
      s.deadline = s.settings.rules.actionSeconds ? now + s.settings.rules.actionSeconds * 1000 : null;
      if (targets.length === 1) { resolve(s, targets[0], now); continue; }
      return;
    }
    if (t.kind === 'forced' && !t.remaining) {
      s.tasks.shift(); s.tasks.unshift(...t.queued.map(card => ({ kind: 'effect' as const, owner: t.owner, card }))); continue;
    }
    s.nextAt ??= now + 650; return;
  }
}
export function beginRound(s: FlipState, now: number) {
  if (s.round) {
    for (const h of Object.values(s.hands)) s.discard.push(...h.cards);
    s.dealer = s.order[(s.order.indexOf(s.dealer!) + 1) % s.order.length];
  } else { s.deck = shuffle(makeDeck(s.settings.rules)); s.discard = []; s.dealer = s.order[0]; }
  s.round++; s.hands = Object.fromEntries(s.order.map(id => [id, emptyHand()]));
  s.phase = 'PLAY'; s.result = null; s.winner = null; s.endedReason = null; s.turn = null;
  s.pending = null; s.continuation = null; s.nextRoundAt = null; s.deadline = null; s.initial = true;
  const first = (s.order.indexOf(s.dealer!) + 1) % s.order.length;
  s.tasks = s.order.map((_, n) => ({ kind: 'deal', owner: s.order[(first + n) % s.order.length] }));
  s.nextAt = now + 400; event(s, now, 'round', s.dealer, `Round ${s.round} · ${name(s, s.dealer!)} deals`);
}
function tick(s: FlipState, now: number) {
  s.nextAt = null;
  const t = s.tasks[0];
  if (t && active(s, t.owner)) {
    if (t.kind === 'deal') { s.tasks.shift(); draw(s, t.owner, now); }
    else if (t.kind === 'forced' && t.remaining) { t.remaining--; draw(s, t.owner, now, t); }
  }
  settle(s, now);
}
function playDecision(s: FlipState, actor: string, type: 'hit' | 'stay', now: number) {
  need(s.turn === actor && !s.pending && !s.tasks.length && !s.initial && active(s, actor), 'Wait for your turn', 409);
  s.deadline = null;
  if (type === 'stay') {
    need(hasCard(s, actor), 'You need a card in front of you to Stay');
    s.hands[actor].status = 'stayed'; event(s, now, 'system', actor, `${name(s, actor)} stays · ${flipScore(s.hands[actor], s.settings.rules)} secured`); pickNext(s, actor, now);
  } else { s.continuation = actor; draw(s, actor, now); settle(s, now); }
}
export function applyAction(s: FlipState, actor: string, a: FlipAction, now = Date.now()) {
  need(s.players[actor], 'Unknown player', 401);
  need(a && typeof a.id === 'string' && a.id.length > 0 && a.id.length <= 100, 'Missing action ID');
  if (s.processed.some(p => p.id === a.id && p.actor === actor)) return;
  need(a.generation === s.generation && a.round === s.round, 'The game changed. Please try again.', 409);
  const presentation = a.type === 'display-mode';
  // Display changes never invalidate an in-flight gameplay decision.
  if (!presentation) need(a.revision === s.revision, 'The table changed. Please try again.', 409);
  const p = a.payload ?? {}, host = s.players[actor].role === 'HOST';
  const admin = ['settings', 'reorder', 'remove', 'start', 'pause', 'resume', 'extend', 'next-round', 'restart', 'lobby', 'end', 'recover', 'display-mode'];
  if (admin.includes(a.type)) need(host, 'Only the host can do that', 403);
  if (presentation) {
    need(p.mode === 'normal' || p.mode === 'tv', 'Invalid display mode'); s.settings.displayMode = p.mode;
  } else if (a.type === 'settings') {
    need(s.phase === 'LOBBY', 'Gameplay rules are locked after starting', 409); s.settings = checkedFlipSettings(p.settings);
  } else if (a.type === 'reorder') {
    need(s.phase === 'LOBBY', 'Order is locked after starting', 409);
    need(Array.isArray(p.order) && p.order.length === s.order.length && new Set(p.order).size === s.order.length && p.order.every(id => typeof id === 'string' && s.players[id]), 'Invalid player order'); s.order = p.order as string[];
  } else if (a.type === 'remove') {
    need(s.phase === 'LOBBY' && typeof p.playerId === 'string' && p.playerId !== actor && s.players[p.playerId], 'Only other lobby players can be removed');
    delete s.players[p.playerId]; s.order = s.order.filter(id => id !== p.playerId);
  } else if (a.type === 'start') {
    need(s.phase === 'LOBBY' && s.order.length >= 2, 'Invite at least one friend to start');
    s.totals = Object.fromEntries(s.order.map(id => [id, 0])); beginRound(s, now);
  } else if (a.type === 'pause') {
    need((s.phase === 'PLAY' || s.phase === 'RESULTS') && s.pausedAt === null, 'Game cannot be paused now'); s.pausedAt = now;
  } else if (a.type === 'resume') {
    need(s.pausedAt !== null, 'Game is not paused'); const elapsed = now - s.pausedAt;
    for (const k of ['nextAt', 'deadline', 'nextRoundAt'] as const) if (s[k] !== null) s[k] += elapsed;
    s.pausedAt = null;
  } else if (a.type === 'extend') {
    need(s.deadline !== null, 'No decision timer is running'); s.deadline += 30_000;
  } else if (a.type === 'next-round') {
    need(s.phase === 'RESULTS' && s.pausedAt === null, 'Wait for the round results'); beginRound(s, now);
  } else if (a.type === 'restart' || a.type === 'lobby') {
    releaseTasks(s); s.generation++; s.round = 0; s.totals = {}; s.hands = {}; s.deck = []; s.discard = [];
    s.phase = 'LOBBY'; s.pausedAt = null; s.turn = null; s.dealer = null; s.initial = false; s.continuation = null;
    s.nextRoundAt = null; s.winner = null; s.result = null; s.history = []; s.endedReason = null;
    if (a.type === 'restart') { need(s.order.length >= 2, 'Need two players'); s.totals = Object.fromEntries(s.order.map(id => [id, 0])); beginRound(s, now); }
  } else if (a.type === 'end') {
    releaseTasks(s); s.phase = 'COMPLETED'; s.pausedAt = null; s.turn = null; s.nextRoundAt = null; s.endedReason = 'Ended by host';
    event(s, now, 'system', actor, 'Game ended by host · completed round totals retained');
  } else {
    need(s.phase === 'PLAY' && s.pausedAt === null, 'Game is not accepting decisions', 409);
    if (a.type === 'target') {
      need(s.pending && s.pending.owner === actor, 'This is not your action', 403);
      resolve(s, String(p.target), now); settle(s, now);
    } else if (a.type === 'hit' || a.type === 'stay') playDecision(s, actor, a.type, now);
    else if (a.type === 'recover') {
      const id = s.pending?.owner ?? s.turn;
      need(id && !s.players[id].connected, 'Recovery is only for the disconnected decision maker');
      if (s.pending) { resolve(s, s.pending.eligible.includes(id) ? id : s.pending.eligible[0], now); settle(s, now); }
      else playDecision(s, id, hasCard(s, id) ? 'stay' : 'hit', now);
      event(s, now, 'system', actor, `Host resolved ${name(s, id)}'s disconnected turn`);
    } else throw new GameError('Unknown action');
  }
  s.version++; if (!presentation) s.revision++;
  if (!presentation) s.expiresAt = now + (s.phase === 'LOBBY' ? 30 * 60_000 : 24 * 60 * 60_000);
  s.processed.push({ id: a.id, actor }); s.processed = s.processed.slice(-200);
}
export function expireState(s: FlipState, now = Date.now()): boolean {
  if (s.phase === 'COMPLETED') return false;
  let changed = false;
  if (now >= s.expiresAt) { releaseTasks(s); s.phase = 'COMPLETED'; s.turn = null; s.nextRoundAt = null; s.endedReason = 'Session expired after inactivity'; changed = true; }
  else if (s.pausedAt !== null) return false;
  else if (s.phase === 'RESULTS' && s.nextRoundAt !== null && now >= s.nextRoundAt) { beginRound(s, now); changed = true; }
  else if (s.phase === 'PLAY' && s.deadline !== null && now >= s.deadline) {
    if (s.pending) { const p = s.pending; resolve(s, p.eligible.includes(p.owner) ? p.owner : p.eligible[0], now); settle(s, now); }
    else if (s.turn) playDecision(s, s.turn, s.settings.rules.timeout === 'stay' && hasCard(s, s.turn) ? 'stay' : 'hit', now);
    event(s, now, 'system', null, 'Decision timer expired · automatic choice'); changed = true;
  } else if (s.phase === 'PLAY' && s.nextAt !== null && now >= s.nextAt) { tick(s, now); changed = true; }
  if (changed) { s.version++; s.revision++; }
  return changed;
}
export function nextDeadline(s: FlipState) {
  return Math.min(s.expiresAt, ...(s.pausedAt !== null ? [] : [s.nextAt, s.deadline, s.nextRoundAt].filter((v): v is number => v !== null)));
}
export function serializeForPlayer(s: FlipState, id: string, now = Date.now()): FlipView {
  const own = s.players[id], forced = s.tasks.find(t => t.kind === 'forced');
  const decision = s.phase === 'PLAY' && s.pausedAt === null && s.turn === id && !s.pending && !s.tasks.length && !s.initial;
  return {
    gameType: 'flip7', gameId: s.gameId, version: s.version, revision: s.revision, generation: s.generation,
    phase: s.phase, paused: s.pausedAt !== null, settings: structuredClone(s.settings), round: s.round,
    players: s.order.map(playerId => { const p = s.players[playerId], hand = s.hands[playerId] ?? emptyHand(); return { playerId, nickname: p.nickname, role: p.role, connected: p.connected, hand: structuredClone(hand), total: s.totals[playerId] ?? 0, potential: flipScore(hand, s.settings.rules) }; }),
    dealer: s.dealer, turn: s.turn, dealing: s.initial, pending: structuredClone(s.pending),
    forced: forced?.kind === 'forced' ? { playerId: forced.owner, remaining: forced.remaining } : null,
    deckCount: s.deck.length, discardCount: s.discard.length, events: structuredClone(s.events),
    result: structuredClone(s.result), history: structuredClone(s.history), winner: s.winner, endedReason: s.endedReason,
    deadline: s.deadline, nextRoundAt: s.nextRoundAt, serverNow: s.pausedAt ?? now,
    yourPlayerId: own?.playerId ?? null, yourRole: own?.role ?? 'DISPLAY',
    canHit: !!own && decision, canStay: !!own && decision && hasCard(s, id),
    ...(own?.role === 'HOST' ? { displayUrl: `/g/${s.gameId}/display#token=${encodeURIComponent(s.displayToken)}` } : {}),
  };
}
