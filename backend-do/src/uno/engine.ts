import {
  UNO_COLORS,
  checkedUnoSettings,
  isUnoNumber,
  sameUnoCard,
  unoCardLabel,
  type UnoAction,
  type UnoCard,
  type UnoColor,
  type UnoEvent,
  type UnoPhase,
  type UnoResult,
  type UnoSettings,
  type UnoView,
} from "../../../shared/uno.js";

export class GameError extends Error {
  constructor(
    message: string,
    public status = 400,
  ) {
    super(message);
  }
}
export interface StoredPlayer {
  playerId: string;
  nickname: string;
  role: "HOST" | "PLAYER";
  connected: boolean;
  token: string;
  disconnectedAt: number | null;
}
interface Penalty {
  amount: number;
  kind: "draw2" | "draw4";
  offender: string | null;
  guilty: boolean;
  evidence: UnoCard[];
  previousColor: UnoColor;
  previousDebt: number;
  previousKind: "draw2" | "draw4" | null;
}
export interface UnoState {
  gameId: string;
  version: number;
  revision: number;
  generation: number;
  phase: UnoPhase;
  players: Record<string, StoredPlayer>;
  order: string[];
  hostToken: string;
  displayToken: string;
  settings: UnoSettings;
  round: number;
  dealer: number;
  turn: string | null;
  direction: 1 | -1;
  color: UnoColor | null;
  hands: Record<string, UnoCard[]>;
  deck: UnoCard[];
  discard: UnoCard[];
  scores: Record<string, number>;
  wins: Record<string, number>;
  drawnCardId: string | null;
  pending: Penalty | null;
  outCandidate: string | null;
  unoVulnerable: string | null;
  declared: string[];
  passes: number;
  events: UnoEvent[];
  eventSequence: number;
  result: UnoResult | null;
  history: UnoResult[];
  winners: string[];
  nextRoundAt: number | null;
  expiresAt: number;
  processed: { id: string; actor: string }[];
  proof: {
    viewer: string;
    offender: string;
    cards: UnoCard[];
    guilty: boolean;
    color: UnoColor;
  } | null;
}
function requireRule(
  condition: unknown,
  message: string,
  status = 400,
): asserts condition {
  if (!condition) throw new GameError(message, status);
}
export function randomIndex(max: number): number {
  const ceiling = Math.floor(0x100000000 / max) * max,
    v = new Uint32Array(1);
  do {
    crypto.getRandomValues(v);
  } while (v[0] >= ceiling);
  return v[0] % max;
}
export function shuffle<T>(cards: T[], random = randomIndex): T[] {
  for (let i = cards.length - 1; i > 0; i--) {
    const j = random(i + 1);
    [cards[i], cards[j]] = [cards[j], cards[i]];
  }
  return cards;
}
export function makeDeck(): UnoCard[] {
  const cards: UnoCard[] = [];
  const add = (color: UnoColor | null, value: UnoCard["value"]) =>
    cards.push({ id: crypto.randomUUID(), color, value });
  for (const color of UNO_COLORS) {
    add(color, "0");
    for (let copy = 0; copy < 2; copy++) {
      for (let n = 1; n <= 9; n++) add(color, String(n) as UnoCard["value"]);
      for (const value of ["skip", "reverse", "draw2"] as const)
        add(color, value);
    }
  }
  for (let i = 0; i < 4; i++) {
    add(null, "wild");
    add(null, "draw4");
  }
  return cards;
}
export function createState(
  gameId: string,
  host: StoredPlayer,
  displayToken: string,
  raw: unknown = {},
  now = Date.now(),
): UnoState {
  return {
    gameId,
    players: { [host.playerId]: host },
    order: [host.playerId],
    hostToken: host.token,
    displayToken,
    settings: checkedUnoSettings(raw),
    phase: "LOBBY",
    version: 1,
    revision: 0,
    generation: 1,
    round: 0,
    dealer: 0,
    turn: null,
    direction: 1,
    color: null,
    hands: {},
    deck: [],
    discard: [],
    scores: {},
    wins: {},
    drawnCardId: null,
    pending: null,
    outCandidate: null,
    unoVulnerable: null,
    declared: [],
    passes: 0,
    events: [],
    eventSequence: 0,
    result: null,
    history: [],
    winners: [],
    nextRoundAt: null,
    expiresAt: now + 30 * 60_000,
    processed: [],
    proof: null,
  };
}
function event(
  s: UnoState,
  type: UnoEvent["type"],
  actor: string | null,
  message: string,
  extra: Partial<UnoEvent> = {},
) {
  s.events.push({ ...extra, id: ++s.eventSequence, type, actor, message });
  s.events = s.events.slice(-20);
}
const name = (s: UnoState, id: string) => s.players[id]?.nickname ?? "Player";
function next(s: UnoState, id: string, steps = 1) {
  return s.order[
    (s.order.indexOf(id) + s.direction * steps + s.order.length * 4) %
      s.order.length
  ];
}
function turnTo(s: UnoState, id: string) {
  s.turn = id;
  s.drawnCardId = null;
}
export function drawCards(s: UnoState, id: string, amount: number): number {
  let count = 0;
  for (let i = 0; i < amount; i++) {
    if (!s.deck.length && s.discard.length > 1) {
      const top = s.discard.pop()!;
      s.deck = shuffle(s.discard);
      s.discard = [top];
    }
    const card = s.deck.pop();
    if (!card) break;
    s.hands[id].push(card);
    count++;
  }
  if (count) {
    s.declared = s.declared.filter((p) => p !== id);
    if (s.unoVulnerable === id) s.unoVulnerable = null;
    event(
      s,
      "draw",
      id,
      `${name(s, id)} drew ${count} card${count === 1 ? "" : "s"}.`,
      { count, target: id },
    );
  }
  return count;
}
export function startRound(
  s: UnoState,
  now = Date.now(),
  deck = shuffle(makeDeck()),
) {
  s.round++;
  s.phase = "PLAY";
  s.direction = 1;
  s.deck = deck;
  s.discard = [];
  s.hands = {};
  s.pending = null;
  s.outCandidate = null;
  s.unoVulnerable = null;
  s.declared = [];
  s.drawnCardId = null;
  s.proof = null;
  s.passes = 0;
  s.result = null;
  s.nextRoundAt = null;
  for (const id of s.order) {
    s.hands[id] = [];
    s.scores[id] ??= 0;
    s.wins[id] ??= 0;
  }
  for (let i = 0; i < 7; i++)
    for (const id of s.order) s.hands[id].push(s.deck.pop()!);
  // A starting +4 returns to the shuffled draw pile; it is never a penalty.
  let first = s.deck.pop()!;
  while (first.value === "draw4") {
    s.deck.unshift(first);
    shuffle(s.deck);
    first = s.deck.pop()!;
  }
  s.discard.push(first);
  s.color = first.color;
  const dealer = s.order[s.dealer % s.order.length],
    left = next(s, dealer);
  turnTo(s, left);
  event(s, "round", null, `Round ${s.round}. Seven cards each.`);
  if (first.value === "reverse") {
    s.direction = -1;
    turnTo(s, dealer);
    event(
      s,
      "reverse",
      null,
      "Opening Reverse: dealer starts, counterclockwise.",
    );
  } else if (first.value === "skip") {
    turnTo(s, next(s, left));
    event(s, "skip", null, `${name(s, left)} is skipped by the opening card.`, {
      target: left,
    });
  } else if (first.value === "draw2") {
    drawCards(s, left, 2);
    turnTo(s, next(s, left));
  } else if (first.value === "wild") s.phase = "COLOR";
  s.expiresAt = now + 120 * 60_000;
}
function matches(s: UnoState, c: UnoCard) {
  const top = s.discard.at(-1)!;
  return c.color === null || c.color === s.color || c.value === top.value;
}
function legalFour(s: UnoState, id: string) {
  return !s.hands[id].some((c) => c.color === s.color);
}
function stackable(s: UnoState, c: UnoCard) {
  const p = s.pending!,
    r = s.settings.rules;
  if (c.value === "draw2")
    return (
      r.stack2 && (p.kind === "draw2" || (r.mixedStack && c.color === s.color))
    );
  return (
    c.value === "draw4" && r.stack4 && (p.kind === "draw4" || r.mixedStack)
  );
}
export function legalCard(
  s: UnoState,
  id: string,
  c: UnoCard,
  bluff = false,
): boolean {
  if (
    s.phase !== "PLAY" ||
    !s.hands[id]?.some((v) => v.id === c.id) ||
    s.outCandidate
  )
    return false;
  if (s.turn !== id)
    return (
      s.settings.rules.jumpIn &&
      !s.pending &&
      !s.drawnCardId &&
      c.color !== null &&
      sameUnoCard(c, s.discard.at(-1)!)
    );
  if (s.pending)
    return (
      stackable(s, c) && (c.value !== "draw4" || bluff || legalFour(s, id))
    );
  if (s.drawnCardId && c.id !== s.drawnCardId) return false;
  return matches(s, c) && (c.value !== "draw4" || bluff || legalFour(s, id));
}
export function cardPoints(c: UnoCard) {
  return isUnoNumber(c) ? Number(c.value) : c.color === null ? 50 : 20;
}
function finishRound(s: UnoState, winner: string | null, now: number) {
  const remaining = Object.fromEntries(
    s.order.map((id) => [
      id,
      s.hands[id].reduce((n, c) => n + cardPoints(c), 0),
    ]),
  );
  const points = winner
    ? Object.entries(remaining).reduce(
        (n, [id, value]) => n + (id === winner ? 0 : value),
        0,
      )
    : 0;
  if (winner) {
    s.scores[winner] += points;
    s.wins[winner]++;
  }
  s.result = {
    round: s.round,
    winner,
    points,
    remaining,
    totals: { ...s.scores },
  };
  s.history.push(s.result);
  s.history = s.history.slice(-100);
  s.pending = null;
  s.outCandidate = null;
  s.turn = null;
  s.drawnCardId = null;
  s.unoVulnerable = null;
  s.proof = null;
  const done =
    s.settings.mode === "single" ||
    (s.settings.mode === "rounds" && s.round >= s.settings.rounds) ||
    (s.settings.mode === "points" &&
      winner !== null &&
      s.scores[winner] >= s.settings.targetScore);
  s.phase = done ? "COMPLETED" : "ROUND_OVER";
  s.nextRoundAt = done ? null : now + 12_000;
  if (done) {
    const high = Math.max(...s.order.map((id) => s.scores[id]));
    s.winners =
      s.settings.mode === "single" && winner
        ? [winner]
        : s.order.filter((id) => s.scores[id] === high);
  }
  event(
    s,
    "round",
    winner,
    winner
      ? `${name(s, winner)} wins the round! +${points} points.`
      : "The deck is blocked. Round drawn; no points awarded.",
  );
}
function payPenalty(s: UnoState, id: string, now: number) {
  const p = s.pending!;
  drawCards(s, id, p.amount);
  s.pending = null;
  if (s.outCandidate) {
    finishRound(s, s.outCandidate, now);
    return;
  }
  turnTo(s, next(s, id));
  event(s, "skip", id, `${name(s, id)} misses a turn.`, { target: id });
}
function afterHands(s: UnoState) {
  s.declared = [];
  s.unoVulnerable = null;
  for (const id of s.order)
    if (s.hands[id].length === 1) {
      s.declared.push(id);
      event(s, "uno", id, `${name(s, id)} has UNO after the hand transfer!`);
    }
}
function play(
  s: UnoState,
  id: string,
  p: Record<string, unknown>,
  now: number,
) {
  const ids = p.cardIds;
  requireRule(
    Array.isArray(ids) &&
      ids.length > 0 &&
      ids.length <= 2 &&
      ids.every((v) => typeof v === "string") &&
      new Set(ids).size === ids.length,
    "Choose one card, or two identical number cards",
  );
  const cards = ids.map((cid) => s.hands[id]?.find((c) => c.id === cid));
  requireRule(cards.every(Boolean), "Those cards are not in your hand");
  const chosen = cards as UnoCard[],
    c = chosen[0],
    jumped = id !== s.turn;
  requireRule(
    legalCard(s, id, c, p.bluff === true),
    "That card cannot be played now",
  );
  if (chosen.length > 1)
    requireRule(
      s.settings.rules.multiples &&
        !jumped &&
        !s.drawnCardId &&
        !s.pending &&
        isUnoNumber(c) &&
        sameUnoCard(c, chosen[1]),
      "Only two identical number cards can be played together on your normal turn",
    );
  if (c.color === null)
    requireRule(
      UNO_COLORS.includes(p.color as UnoColor),
      "Choose the next color",
    );
  if (s.settings.rules.sevenZero && c.value === "7")
    requireRule(
      typeof p.target === "string" &&
        p.target !== id &&
        s.order.includes(p.target),
      "Choose a player to swap hands with",
    );
  const previousColor = s.color!,
    previousDebt = s.pending?.amount ?? 0,
    previousKind = s.pending?.kind ?? null;
  const guilty = c.value === "draw4" && !legalFour(s, id),
    evidence = s.hands[id]
      .filter((v) => !ids.includes(v.id))
      .map((v) => ({ ...v }));
  s.unoVulnerable = null;
  s.proof = null;
  s.passes = 0;
  s.pending = null;
  s.hands[id] = s.hands[id].filter((v) => !ids.includes(v.id));
  s.discard.push(...chosen);
  s.color = c.color ?? (p.color as UnoColor);
  s.declared = s.declared.filter((v) => v !== id);
  s.drawnCardId = null;
  event(
    s,
    "play",
    id,
    `${name(s, id)} ${jumped ? "jumped in with" : "played"} ${chosen.length > 1 ? "two " : ""}${unoCardLabel(c)}${c.color === null ? ` → ${s.color}` : ""}.`,
    { card: c, count: chosen.length },
  );
  if (s.hands[id].length === 1) {
    if (p.sayUno === true) {
      s.declared.push(id);
      event(s, "uno", id, `${name(s, id)} calls UNO!`);
    } else s.unoVulnerable = id;
  }
  if (s.settings.rules.sevenZero && c.value === "7") {
    const target = p.target as string;
    [s.hands[id], s.hands[target]] = [s.hands[target], s.hands[id]];
    event(
      s,
      "swap",
      id,
      `${name(s, id)} swapped hands with ${name(s, target)}.`,
      { target },
    );
    afterHands(s);
  } else if (s.settings.rules.sevenZero && c.value === "0") {
    const old = { ...s.hands };
    for (const from of s.order) s.hands[next(s, from)] = old[from];
    event(s, "swap", id, "All hands pass in the playing direction.");
    afterHands(s);
  }
  const winner = s.order.find((v) => s.hands[v].length === 0) ?? null;
  if (c.value === "draw2" || c.value === "draw4") {
    s.pending = {
      kind: c.value,
      amount: previousDebt + (c.value === "draw2" ? 2 : 4),
      offender: c.value === "draw4" ? id : null,
      guilty,
      evidence,
      previousColor,
      previousDebt,
      previousKind,
    };
    s.outCandidate = winner;
    turnTo(s, next(s, id));
    if (c.value === "draw2" && (!s.settings.rules.stack2 || winner))
      payPenalty(s, s.turn!, now);
    return;
  }
  if (winner) {
    finishRound(s, winner, now);
    return;
  }
  if (c.value === "reverse") {
    s.direction = s.direction === 1 ? -1 : 1;
    event(s, "reverse", id, "Playing direction reversed.");
  }
  const skipped =
    c.value === "skip" || (c.value === "reverse" && s.order.length === 2);
  if (skipped)
    event(s, "skip", id, `${name(s, next(s, id))} is skipped.`, {
      target: next(s, id),
    });
  turnTo(s, next(s, id, skipped ? 2 : 1));
}
function drawTurn(s: UnoState, id: string, now: number) {
  requireRule(s.turn === id && !s.drawnCardId, "You cannot draw now");
  const legal = s.hands[id].some((c) => legalCard(s, id, c));
  requireRule(
    !s.settings.rules.forcedPlay || !legal,
    "Forced play: play a legal card",
  );
  s.unoVulnerable = null;
  s.proof = null;
  if (s.pending) {
    payPenalty(s, id, now);
    return;
  }
  let playable = false,
    drawn = 0;
  do {
    if (!drawCards(s, id, 1)) break;
    drawn++;
    const c = s.hands[id].at(-1)!;
    playable = legalCard(s, id, c);
    s.drawnCardId = playable ? c.id : null;
  } while (s.settings.rules.drawUntil && !playable && drawn < 108);
  if (drawn) s.passes = 0;
  else s.passes++;
  if (!playable) turnTo(s, next(s, id));
  if (s.passes >= s.order.length) finishRound(s, null, now);
}
/** All callers apply to a clone and persist before publishing it. Revision excludes presence. */
export function applyAction(
  s: UnoState,
  id: string,
  action: UnoAction,
  now = Date.now(),
) {
  requireRule(s.players[id], "Unknown player", 401);
  requireRule(
    action &&
      typeof action.id === "string" &&
      action.id.length > 0 &&
      action.id.length <= 100,
    "Missing request ID",
  );
  if (s.processed.some((v) => v.id === action.id && v.actor === id)) return;
  requireRule(
    action.generation === s.generation &&
      action.round === s.round &&
      action.revision === s.revision,
    "The table changed. Please try again.",
    409,
  );
  const host = s.players[id].role === "HOST",
    p = action.payload ?? {};
  requireRule(
    p && typeof p === "object" && !Array.isArray(p),
    "Invalid action",
  );
  if (
    [
      "settings",
      "start",
      "restart",
      "end",
      "kick",
      "reorder",
      "transfer-host",
    ].includes(action.type)
  )
    requireRule(host, "Only the host can do that", 403);
  switch (action.type) {
    case "settings":
      requireRule(s.phase === "LOBBY", "Rules are locked after starting");
      s.settings = checkedUnoSettings(p, s.settings);
      break;
    case "start":
      requireRule(
        s.phase === "LOBBY" && s.order.length >= 2 && s.order.length <= 10,
        "UNO needs 2–10 players in the lobby",
      );
      s.dealer = randomIndex(s.order.length);
      startRound(s, now);
      break;
    case "restart": {
      const fresh = createState(
        s.gameId,
        s.players[s.order.find((v) => s.players[v].role === "HOST")!],
        s.displayToken,
        s.settings,
        now,
      );
      Object.assign(s, fresh, {
        players: s.players,
        order: s.order,
        generation: s.generation + 1,
        version: s.version,
        revision: s.revision,
        eventSequence: s.eventSequence,
      });
      event(s, "notice", id, "Back in the lobby. Scores reset; profiles kept.");
      break;
    }
    case "end":
      s.phase = "COMPLETED";
      s.pending = null;
      s.nextRoundAt = null;
      s.turn = null;
      {
        const high = Math.max(0, ...Object.values(s.scores));
        s.winners = s.order.filter((v) => (s.scores[v] ?? 0) === high);
      }
      event(s, "notice", id, "The host ended the game.");
      break;
    case "kick":
      requireRule(
        s.phase === "LOBBY" &&
          typeof p.playerId === "string" &&
          p.playerId !== id &&
          s.players[p.playerId],
        "Players can only be removed in the lobby",
      );
      delete s.players[p.playerId];
      s.order = s.order.filter((v) => v !== p.playerId);
      break;
    case "reorder":
      requireRule(
        s.phase === "LOBBY" &&
          Array.isArray(p.order) &&
          p.order.length === s.order.length &&
          new Set(p.order).size === s.order.length &&
          p.order.every((v) => s.order.includes(String(v))),
        "Invalid seating order",
      );
      s.order = p.order as string[];
      break;
    case "transfer-host":
      requireRule(
        typeof p.playerId === "string" &&
          s.players[p.playerId] &&
          p.playerId !== id,
        "Choose another player",
      );
      s.players[id].role = "PLAYER";
      s.players[p.playerId].role = "HOST";
      s.hostToken = s.players[p.playerId].token;
      event(s, "notice", id, `${name(s, p.playerId)} is now the host.`);
      break;
    case "next":
      requireRule(s.phase === "ROUND_OVER", "No next round yet");
      s.dealer = (s.dealer + 1) % s.order.length;
      startRound(s, now);
      break;
    case "color":
      requireRule(
        s.phase === "COLOR" &&
          s.turn === id &&
          UNO_COLORS.includes(p.color as UnoColor),
        "The starting player chooses a color",
      );
      s.color = p.color as UnoColor;
      s.phase = "PLAY";
      break;
    case "play":
      requireRule(s.phase === "PLAY", "Cards cannot be played yet");
      play(s, id, p, now);
      break;
    case "draw":
      requireRule(s.phase === "PLAY", "Cards cannot be drawn yet");
      drawTurn(s, id, now);
      break;
    case "pass":
      requireRule(
        s.phase === "PLAY" &&
          s.turn === id &&
          s.drawnCardId &&
          !s.settings.rules.forcedPlay,
        "You can only pass after drawing a playable card",
      );
      s.unoVulnerable = null;
      turnTo(s, next(s, id));
      break;
    case "uno":
      requireRule(
        s.phase === "PLAY" && s.hands[id]?.length === 1,
        "Call UNO when you have one card left",
      );
      requireRule(!s.declared.includes(id), "You already called UNO");
      s.declared.push(id);
      if (s.unoVulnerable === id) s.unoVulnerable = null;
      event(s, "uno", id, `${name(s, id)} calls UNO!`);
      break;
    case "catch": {
      const target = s.unoVulnerable;
      requireRule(
        s.phase === "PLAY" &&
          target &&
          target !== id &&
          s.hands[target].length === 1,
        "No missed UNO call to catch",
      );
      drawCards(s, target, 2);
      s.unoVulnerable = null;
      event(
        s,
        "catch",
        id,
        `${name(s, id)} caught ${name(s, target)}: draw two!`,
        { target },
      );
      break;
    }
    case "challenge": {
      requireRule(
        s.phase === "PLAY" &&
          s.turn === id &&
          s.pending?.kind === "draw4" &&
          s.pending.offender,
        "Only the targeted player can challenge the latest +4",
      );
      const penalty = s.pending;
      s.unoVulnerable = null;
      s.proof = {
        viewer: id,
        offender: penalty.offender!,
        cards: penalty.evidence,
        guilty: penalty.guilty,
        color: penalty.previousColor,
      };
      s.pending = null;
      if (penalty.guilty) {
        drawCards(s, penalty.offender!, 4);
        s.outCandidate = null;
        if (penalty.previousDebt)
          s.pending = {
            ...penalty,
            kind: penalty.previousKind!,
            amount: penalty.previousDebt,
            offender: null,
            evidence: [],
            guilty: false,
            previousDebt: 0,
            previousKind: null,
          };
        event(
          s,
          "challenge",
          id,
          `Challenge successful! ${name(s, penalty.offender!)} draws four. You keep your turn${penalty.previousDebt ? ` with ${penalty.previousDebt} earlier penalty cards still pending` : ""}.`,
        );
      } else {
        drawCards(s, id, penalty.amount + 2);
        event(
          s,
          "challenge",
          id,
          `Challenge failed: ${name(s, id)} draws ${penalty.amount + 2} and misses a turn.`,
        );
        if (s.outCandidate) finishRound(s, s.outCandidate, now);
        else turnTo(s, next(s, id));
      }
      break;
    }
    default:
      throw new GameError("Unknown UNO action");
  }
  s.revision++;
  s.version++;
  s.expiresAt = now + (s.phase === "LOBBY" ? 30 : 120) * 60_000;
  s.processed.push({ id: action.id, actor: id });
  s.processed = s.processed.slice(-160);
}
export function expireState(s: UnoState, now = Date.now()): boolean {
  if (s.phase === "COMPLETED") return false;
  if (now >= s.expiresAt) {
    s.phase = "COMPLETED";
    s.nextRoundAt = null;
    s.turn = null;
    event(s, "notice", null, "This room expired after inactivity.");
  } else if (
    s.phase === "ROUND_OVER" &&
    s.nextRoundAt !== null &&
    now >= s.nextRoundAt
  ) {
    s.dealer = (s.dealer + 1) % s.order.length;
    startRound(s, now);
  } else return false;
  s.version++;
  s.revision++;
  return true;
}
export function serializeForPlayer(
  s: UnoState,
  viewer: string,
  now = Date.now(),
): UnoView {
  const player = s.players[viewer],
    hand = player ? (s.hands[viewer] ?? []) : [];
  const legalCardIds = hand
    .filter((c) => legalCard(s, viewer, c))
    .map((c) => c.id);
  const mine = s.phase === "PLAY" && s.turn === viewer;
  const result: UnoView = {
    gameType: "uno",
    gameId: s.gameId,
    version: s.version,
    revision: s.revision,
    generation: s.generation,
    phase: s.phase,
    yourPlayerId: viewer,
    yourRole: player?.role ?? "DISPLAY",
    order: [...s.order],
    settings: structuredClone(s.settings),
    players: s.order.map((id) => ({
      playerId: id,
      nickname: s.players[id].nickname,
      role: s.players[id].role,
      connected: s.players[id].connected,
      cardCount: s.hands[id]?.length ?? 0,
      score: s.scores[id] ?? 0,
      wins: s.wins[id] ?? 0,
      saidUno: s.declared.includes(id),
    })),
    round: s.round,
    turn: s.turn,
    direction: s.direction,
    color: s.color,
    top: s.discard.at(-1) ? { ...s.discard.at(-1)! } : null,
    deckCount: s.deck.length,
    hand: structuredClone(hand),
    legalCardIds,
    bluffCardIds: hand
      .filter(
        (c) =>
          c.value === "draw4" &&
          !legalCardIds.includes(c.id) &&
          legalCard(s, viewer, c, true),
      )
      .map((c) => c.id),
    canDraw:
      !!mine &&
      !s.drawnCardId &&
      (!s.settings.rules.forcedPlay || !legalCardIds.length),
    canPass: !!mine && !!s.drawnCardId && !s.settings.rules.forcedPlay,
    drawnCardId: mine ? s.drawnCardId : null,
    pending: s.pending
      ? {
          amount: s.pending.amount,
          kind: s.pending.kind,
          offender: s.pending.offender,
          canChallenge:
            !!mine && !!s.pending.offender && s.pending.kind === "draw4",
        }
      : null,
    unoVulnerable: s.unoVulnerable,
    events: structuredClone(s.events),
    result: structuredClone(s.result),
    history: structuredClone(s.history),
    winners: [...s.winners],
    nextRoundAt: s.nextRoundAt,
    serverNow: now,
  };
  if (player?.role === "HOST") result.displayToken = s.displayToken;
  if (s.proof?.viewer === viewer)
    result.challengeProof = {
      offender: s.proof.offender,
      cards: structuredClone(s.proof.cards),
      guilty: s.proof.guilty,
      color: s.proof.color,
    };
  return result;
}
