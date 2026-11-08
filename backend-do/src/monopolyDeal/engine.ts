import {
  DEAL_COLORS,
  DEAL_GROUPS,
  DEAL_EFFECTS,
  checkedDealSettings,
  completeDealSet,
  dealSetCount,
  dealRent,
  dealAssets,
  buildableDealColor,
  type DealAction,
  type DealCard,
  type DealColor,
  type DealEffect,
  type DealEvent,
  type DealPending,
  type DealPhase,
  type DealResult,
  type DealSettings,
  type DealSet,
  type DealTable,
  type DealView,
} from "../../../shared/monopolyDeal.js";

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
export interface DealState {
  gameId: string;
  version: number;
  revision: number;
  generation: number;
  phase: DealPhase;
  players: Record<string, StoredPlayer>;
  order: string[];
  displayToken: string;
  settings: DealSettings;
  round: number;
  turn: string | null;
  playsLeft: number;
  hands: Record<string, DealCard[]>;
  tables: Record<string, DealTable>;
  deck: DealCard[];
  discard: DealCard[];
  pending: DealPending | null;
  turnDeadline: number | null;
  turnRemaining: number | null;
  events: DealEvent[];
  eventSequence: number;
  setSequence: number;
  result: DealResult | null;
  history: DealResult[];
  wins: Record<string, number>;
  winners: string[];
  expiresAt: number;
  processed: { id: string; actor: string }[];
  rng: number[];
}
function requireRule(v: unknown, message: string, status = 400): asserts v {
  if (!v) throw new GameError(message, status);
}
const name = (s: DealState, id: string) => s.players[id]?.nickname ?? "Player";
function event(
  s: DealState,
  type: DealEvent["type"],
  actor: string | null,
  message: string,
  extra: Partial<DealEvent> = {},
) {
  s.events.push({ ...extra, id: ++s.eventSequence, type, actor, message });
  s.events = s.events.slice(-35);
}
const emptyTable = (): DealTable => ({
  bank: [],
  sets: [],
  looseBuildings: [],
});
export function createState(
  gameId: string,
  host: StoredPlayer,
  displayToken: string,
  raw: unknown = {},
  now = Date.now(),
  seed = Array.from(crypto.getRandomValues(new Uint32Array(4))),
): DealState {
  return {
    gameId,
    players: { [host.playerId]: host },
    order: [host.playerId],
    displayToken,
    settings: checkedDealSettings(raw),
    phase: "LOBBY",
    version: 1,
    revision: 0,
    generation: 1,
    round: 0,
    turn: null,
    playsLeft: 0,
    hands: {},
    tables: {},
    deck: [],
    discard: [],
    pending: null,
    turnDeadline: null,
    turnRemaining: null,
    events: [],
    eventSequence: 0,
    setSequence: 0,
    result: null,
    history: [],
    wins: {},
    winners: [],
    expiresAt: now + 30 * 60_000,
    processed: [],
    rng: seed.some(Boolean) ? seed : [1, 2, 3, 4],
  };
}
/** xoshiro128**. Random state remains private; all transitions replay from a snapshot. */
function random(s: DealState) {
  const rot = (x: number, k: number) => (x << k) | (x >>> (32 - k));
  const a = s.rng,
    r = Math.imul(rot(Math.imul(a[1], 5), 7), 9) >>> 0,
    t = a[1] << 9;
  a[2] ^= a[0];
  a[3] ^= a[1];
  a[1] ^= a[2];
  a[0] ^= a[3];
  a[2] ^= t;
  a[3] = rot(a[3], 11);
  return r;
}
function shuffle(s: DealState, a: DealCard[]) {
  for (let i = a.length - 1; i > 0; i--) {
    const bound = Math.floor(0x100000000 / (i + 1)) * (i + 1);
    let r;
    do {
      r = random(s);
    } while (r >= bound);
    const j = r % (i + 1);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
export function makeDeck(prefix = "deal"): DealCard[] {
  const deck: DealCard[] = [];
  const add = (n: number, c: Omit<DealCard, "id">) => {
    for (let i = 0; i < n; i++)
      deck.push({
        ...c,
        colors: [...c.colors],
        id: `${prefix}-${deck.length}`,
      });
  };
  for (const [value, n] of [
    [1, 6],
    [2, 5],
    [3, 3],
    [4, 3],
    [5, 2],
    [10, 1],
  ])
    add(n, { kind: "money", title: `${value} Million`, value, colors: [] });
  const names: Record<DealColor, string[]> = {
    brown: ["Ember Lane", "Acorn Court"],
    lightBlue: ["Cloud Walk", "Harbor View", "Silver Street"],
    pink: ["Rose Arcade", "Blossom Place", "Velvet Way"],
    orange: ["Sunset Square", "Amber Avenue", "Lantern Row"],
    red: ["Ruby Market", "Crimson Drive", "Scarlet Park"],
    yellow: ["Golden Mile", "Lemon Grove", "Sunflower Hill"],
    green: ["Emerald Gardens", "Cedar Heights", "Willow Crescent"],
    darkBlue: ["Midnight Bay", "Sapphire Terrace"],
    railroad: [
      "North Station",
      "East Station",
      "South Station",
      "West Station",
    ],
    utility: ["Power Works", "Water Works"],
  };
  for (const color of DEAL_COLORS)
    for (const title of names[color])
      add(1, {
        kind: "property",
        title,
        value: DEAL_GROUPS[color].value,
        colors: [color],
      });
  const pairs: [DealColor, DealColor, number][] = [
    ["brown", "lightBlue", 1],
    ["pink", "orange", 2],
    ["red", "yellow", 2],
    ["green", "darkBlue", 1],
    ["railroad", "green", 1],
    ["railroad", "lightBlue", 1],
    ["railroad", "utility", 1],
  ];
  for (const [a, b, n] of pairs)
    add(n, {
      kind: "wild",
      title: "Property Wild",
      value: Math.max(DEAL_GROUPS[a].value, DEAL_GROUPS[b].value),
      colors: [a, b],
    });
  // Railroad / sky blue is worth 4M in the standard deck, railroad / utility 2M.
  const railSky = deck.find(
    (c) =>
      c.kind === "wild" &&
      c.colors.includes("railroad") &&
      c.colors.includes("lightBlue"),
  );
  if (railSky) railSky.value = 4;
  add(2, {
    kind: "wild",
    title: "Any-color Wild",
    value: 0,
    colors: [...DEAL_COLORS],
  });
  for (const [a, b] of [
    ["brown", "lightBlue"],
    ["pink", "orange"],
    ["red", "yellow"],
    ["green", "darkBlue"],
    ["railroad", "utility"],
  ] as [DealColor, DealColor][])
    add(2, {
      kind: "action",
      title: "Rent",
      value: 1,
      colors: [a, b],
      effect: "rent",
    });
  for (const [effect, n, value] of [
    ["passGo", 10, 1],
    ["wildRent", 3, 3],
    ["doubleRent", 2, 1],
    ["debtCollector", 3, 3],
    ["birthday", 3, 2],
    ["slyDeal", 3, 3],
    ["forcedDeal", 3, 3],
    ["dealBreaker", 2, 5],
    ["justSayNo", 3, 4],
    ["house", 3, 3],
    ["hotel", 2, 4],
  ] as [DealEffect, number, number][])
    add(n, {
      kind: "action",
      title: DEAL_EFFECTS[effect].title,
      value,
      colors: [],
      effect,
    });
  return deck;
}
export function drawCards(s: DealState, id: string, n: number) {
  let count = 0;
  for (let i = 0; i < n; i++) {
    if (!s.deck.length && s.discard.length) {
      s.deck = shuffle(s, s.discard);
      s.discard = [];
    }
    const c = s.deck.pop();
    if (!c) break;
    s.hands[id].push(c);
    count++;
  }
  if (count)
    event(
      s,
      "draw",
      id,
      `${name(s, id)} drew ${count} card${count === 1 ? "" : "s"}.`,
      { target: id },
    );
  return count;
}
function beginTurn(s: DealState, id: string, now: number) {
  s.turn = id;
  s.phase = "PLAY";
  s.playsLeft = s.settings.rules.playsPerTurn;
  s.turnRemaining = null;
  s.turnDeadline = s.settings.rules.turnSeconds
    ? now + s.settings.rules.turnSeconds * 1000
    : null;
  event(s, "turn", id, `${name(s, id)}’s turn.`);
  drawCards(s, id, s.hands[id].length === 0 ? 5 : s.settings.rules.drawPerTurn);
  checkWin(s);
}
export function startRound(s: DealState, now = Date.now(), deck?: DealCard[]) {
  s.round++;
  s.pending = null;
  s.result = null;
  s.tables = {};
  s.hands = {};
  s.discard = [];
  s.winners = [];
  s.deck = deck ?? shuffle(s, makeDeck(`g${s.generation}r${s.round}`));
  for (const id of s.order) {
    s.hands[id] = [];
    s.tables[id] = emptyTable();
    s.wins[id] ??= 0;
  }
  for (let i = 0; i < s.settings.rules.startingHand; i++)
    for (const id of s.order) {
      const c = s.deck.pop();
      if (c) s.hands[id].push(c);
    }
  event(s, "notice", null, `Game ${s.round}: ${s.settings.profileName}.`);
  beginTurn(s, s.order[(s.round - 1) % s.order.length], now);
}
function checkWin(s: DealState) {
  if (!["PLAY", "DISCARD"].includes(s.phase)) return;
  const winner = [s.turn!, ...s.order.filter((id) => id !== s.turn)].find(
    (id) =>
      s.tables[id] && dealSetCount(s.tables[id]) >= s.settings.rules.setsToWin,
  );
  if (!winner) return;
  s.wins[winner] = (s.wins[winner] ?? 0) + 1;
  s.result = { round: s.round, winner, totals: { ...s.wins } };
  s.history.push(s.result);
  s.history = s.history.slice(-15);
  const done =
    s.settings.mode === "single" ||
    (s.settings.mode === "games" && s.round >= s.settings.games) ||
    (s.settings.mode === "bestOf" &&
      s.wins[winner] >= Math.ceil(s.settings.games / 2)) ||
    (s.settings.mode === "bestOf" && s.round >= s.settings.games);
  s.phase = done ? "COMPLETED" : "ROUND_OVER";
  s.turn = null;
  s.pending = null;
  s.turnDeadline = null;
  if (done) {
    const best = Math.max(...Object.values(s.wins));
    s.winners = s.order.filter((id) => s.wins[id] === best);
  }
  event(
    s,
    "win",
    winner,
    `${name(s, winner)} wins game ${s.round} with ${s.settings.rules.setsToWin} different complete colors!`,
  );
}
function normalizeTable(s: DealState, id: string) {
  const t = s.tables[id];
  for (const set of t.sets)
    if (!completeDealSet(set)) {
      for (const building of [set.house, set.hotel])
        if (building) {
          s.discard.push(building);
          event(
            s,
            "notice",
            id,
            `${name(s, id)}’s ${building.title} was discarded because its set became incomplete.`,
          );
        }
      set.house = null;
      set.hotel = null;
    }
  t.sets = t.sets.filter((set) => set.cards.length > 0);
}
function placeProperty(
  s: DealState,
  id: string,
  c: DealCard,
  color: unknown,
  setId: unknown,
) {
  requireRule(c.kind === "property" || c.kind === "wild", "Choose a property");
  requireRule(
    DEAL_COLORS.includes(color as DealColor) &&
      c.colors.includes(color as DealColor),
    "Choose an allowed property color",
  );
  const t = s.tables[id];
  let set = setId ? t.sets.find((v) => v.id === setId) : undefined;
  if (setId)
    requireRule(
      set &&
        set.color === color &&
        set.cards.length < DEAL_GROUPS[set.color].size,
      "That group cannot receive this property",
    );
  if (!set) {
    set = {
      id: `set-${s.generation}-${++s.setSequence}`,
      color: color as DealColor,
      cards: [],
      house: null,
      hotel: null,
    };
    t.sets.push(set);
  }
  const was = completeDealSet(set);
  set.cards.push(c);
  event(
    s,
    "property",
    id,
    `${name(s, id)} placed ${c.title} in ${DEAL_GROUPS[set.color].name}.`,
    { card: c },
  );
  if (!was && completeDealSet(set))
    event(
      s,
      "set",
      id,
      `${name(s, id)} completed a ${DEAL_GROUPS[set.color].name} set!`,
    );
}
function property(s: DealState, id: string, cardId: unknown) {
  const set = s.tables[id]?.sets.find((v) =>
    v.cards.some((c) => c.id === cardId),
  );
  const card = set?.cards.find((c) => c.id === cardId);
  requireRule(set && card, "Choose a property on the table");
  return { set, card };
}
function detachProperty(
  s: DealState,
  id: string,
  cardId: string,
  deferNormalize = false,
) {
  const p = property(s, id, cardId);
  p.set.cards = p.set.cards.filter((c) => c.id !== cardId);
  if (!deferNormalize) normalizeTable(s, id);
  return p.card;
}
function pauseTurn(s: DealState, now: number) {
  s.turnRemaining =
    s.turnDeadline === null ? null : Math.max(1, s.turnDeadline - now);
  s.turnDeadline = null;
}
function resumeTurn(s: DealState, now: number) {
  s.turnDeadline = s.turnRemaining === null ? null : now + s.turnRemaining;
  s.turnRemaining = null;
}
function responseDeadline(s: DealState, now: number) {
  return s.settings.rules.responseSeconds
    ? now + s.settings.rules.responseSeconds * 1000
    : null;
}
function attack(
  s: DealState,
  actor: string,
  kind: DealEffect,
  targets: string[],
  now: number,
  extra: Partial<DealPending> = {},
) {
  requireRule(targets.length > 0, "Choose an opponent");
  pauseTurn(s, now);
  s.pending = {
    actor,
    kind,
    targets,
    amount: 0,
    index: 0,
    target: targets[0],
    responder: targets[0],
    cancelled: false,
    depth: 0,
    stage: "response",
    placements: [],
    deadline: responseDeadline(s, now),
    ...extra,
  };
}
function advanceAttack(s: DealState, now: number) {
  checkWin(s);
  if (!s.pending) return;
  const p = s.pending;
  p.index++;
  if (p.index >= p.targets.length) {
    s.pending = null;
    resumeTurn(s, now);
    return;
  }
  p.target = p.targets[p.index];
  p.responder = p.target;
  p.cancelled = false;
  p.depth = 0;
  p.stage = "response";
  p.placements = [];
  p.deadline = responseDeadline(s, now);
}
function placementsOrAdvance(s: DealState, now: number) {
  const p = s.pending!;
  if (p.placements.length) {
    p.stage = "placement";
    p.responder = p.placements[0].owner;
    p.deadline = responseDeadline(s, now);
  } else {
    for (const owner of s.order) normalizeTable(s, owner);
    advanceAttack(s, now);
  }
}
function resolveAttack(s: DealState, now: number) {
  const p = s.pending!;
  if (p.cancelled) {
    event(
      s,
      "no",
      p.target,
      `${name(s, p.target)} blocked ${DEAL_EFFECTS[p.kind].title}.`,
    );
    advanceAttack(s, now);
    return;
  }
  if (["rent", "wildRent", "debtCollector", "birthday"].includes(p.kind)) {
    p.stage = "payment";
    p.responder = p.target;
    p.deadline = responseDeadline(s, now);
    if (!dealAssets(s.tables[p.target]).length) {
      event(
        s,
        "payment",
        p.target,
        `${name(s, p.target)} has no payable assets. The debt is cleared.`,
      );
      advanceAttack(s, now);
    } else if (s.settings.rules.autoPay)
      pay(s, p.target, automaticPayment(s.tables[p.target], p.amount), now);
    return;
  }
  if (p.kind === "dealBreaker") {
    const table = s.tables[p.target],
      set = table.sets.find((v) => v.id === p.targetSetId)!;
    table.sets = table.sets.filter((v) => v.id !== set.id);
    s.tables[p.actor].sets.push(set);
    event(
      s,
      "steal",
      p.actor,
      `${name(s, p.actor)} stole ${name(s, p.target)}’s complete ${DEAL_GROUPS[set.color].name} set, including its buildings.`,
      { target: p.target },
    );
  } else {
    const taken = detachProperty(
      s,
      p.target,
      p.targetCardId!,
      p.kind === "forcedDeal",
    );
    p.placements.push({ owner: p.actor, card: taken });
    if (p.kind === "forcedDeal")
      p.placements.push({
        owner: p.target,
        card: detachProperty(s, p.actor, p.giveCardId!, true),
      });
    event(
      s,
      "steal",
      p.actor,
      `${name(s, p.actor)} ${p.kind === "forcedDeal" ? "swapped properties with" : `stole ${taken.title} from`} ${name(s, p.target)}.`,
      { target: p.target, card: taken },
    );
  }
  placementsOrAdvance(s, now);
}
/** Opt-in deterministic convenience, also the documented payment deadline fallback. */
export function automaticPayment(t: DealTable, amount: number): string[] {
  const cards = [...t.bank]
    .sort((a, b) => a.value - b.value)
    .concat(
      dealAssets(t)
        .filter((c) => !t.bank.some((b) => b.id === c.id))
        .sort((a, b) => a.value - b.value),
    );
  const ids: string[] = [];
  let total = 0;
  for (const c of cards) {
    if (total >= amount) break;
    ids.push(c.id);
    total += c.value;
  }
  return ids;
}
function pay(s: DealState, id: string, raw: unknown, now: number) {
  const p = s.pending!;
  requireRule(
    p?.stage === "payment" && p.responder === id,
    "You do not owe a payment now",
  );
  requireRule(
    Array.isArray(raw) &&
      raw.every((v) => typeof v === "string") &&
      new Set(raw).size === raw.length,
    "Choose distinct tabled assets",
  );
  const assets = dealAssets(s.tables[id]),
    selected = raw.map((cid) => assets.find((c) => c.id === cid));
  requireRule(
    selected.every(Boolean),
    "Pay only with your bank or valued tabled properties/buildings",
  );
  const cards = selected as DealCard[],
    total = cards.reduce((n, c) => n + c.value, 0),
    available = assets.reduce((n, c) => n + c.value, 0);
  requireRule(
    total >= p.amount ||
      (total === available && cards.length === assets.length),
    "Cover the debt, or surrender every payable asset if you cannot",
  );
  // Remove all selected assets before discarding buildings on any broken sets.
  const table = s.tables[id],
    recipient = s.tables[p.actor];
  for (const c of cards) {
    const bank = table.bank.some((b) => b.id === c.id);
    if (bank) {
      table.bank = table.bank.filter((b) => b.id !== c.id);
      recipient.bank.push(c);
      continue;
    }
    const set = table.sets.find(
      (v) =>
        v.cards.some((b) => b.id === c.id) ||
        v.house?.id === c.id ||
        v.hotel?.id === c.id,
    );
    if (set?.house?.id === c.id) {
      set.house = null;
      recipient.bank.push(c);
    } else if (set?.hotel?.id === c.id) {
      set.hotel = null;
      recipient.bank.push(c);
    } else if (set) {
      set.cards = set.cards.filter((b) => b.id !== c.id);
      p.placements.push({ owner: p.actor, card: c });
    }
  }
  normalizeTable(s, id);
  // A remaining hotel cannot stand without its house.
  for (const set of table.sets)
    if (set.hotel && !set.house) {
      s.discard.push(set.hotel);
      set.hotel = null;
    }
  event(
    s,
    "payment",
    id,
    `${name(s, id)} paid ${total}M to ${name(s, p.actor)} (${cards.filter((c) => c.kind === "property" || c.kind === "wild").length} properties)${total > p.amount ? "; no change" : total < p.amount ? "; remaining debt cleared" : ""}.`,
    { target: p.actor },
  );
  placementsOrAdvance(s, now);
}
function play(
  s: DealState,
  id: string,
  p: Record<string, unknown>,
  now: number,
) {
  requireRule(
    s.phase === "PLAY" && s.turn === id && !s.pending && s.playsLeft > 0,
    "Wait for your turn and any pending responses",
  );
  const c = s.hands[id].find((c) => c.id === p.cardId);
  requireRule(c, "Choose a card in your hand");
  const remove = () => {
    s.hands[id] = s.hands[id].filter((v) => v.id !== c.id);
    s.playsLeft--;
  };
  if (p.mode === "bank") {
    requireRule(
      (c.kind === "money" || c.kind === "action") && c.value > 0,
      "Property cards cannot be banked",
    );
    remove();
    s.tables[id].bank.push(c);
    event(s, "bank", id, `${name(s, id)} banked ${c.value}M.`, { card: c });
    return;
  }
  if (p.mode === "property") {
    placeProperty(s, id, c, p.color, p.setId);
    remove();
    checkWin(s);
    return;
  }
  requireRule(
    p.mode === "action" && c.kind === "action" && c.effect,
    "Choose how to play this card",
  );
  const effect = c.effect,
    opponent = String(p.target ?? ""),
    others = s.order.filter((v) => v !== id);
  const target = () =>
    requireRule(others.includes(opponent), "Choose an opponent");
  if (effect === "house" || effect === "hotel") {
    const set = s.tables[id].sets.find((v) => v.id === p.setId);
    requireRule(
      set && completeDealSet(set) && buildableDealColor(set.color),
      "Choose a complete colored property set",
    );
    requireRule(
      effect === "house" ? !set.house : set.house && !set.hotel,
      effect === "house"
        ? "One House per set"
        : "A Hotel needs a House; one Hotel per set",
    );
    remove();
    set[effect] = c;
    event(
      s,
      "property",
      id,
      `${name(s, id)} built a ${c.title} on ${DEAL_GROUPS[set.color].name}.`,
      { card: c },
    );
    return;
  }
  requireRule(
    effect !== "justSayNo" && effect !== "doubleRent",
    "Use this card in a response or with a Rent card, or bank it",
  );
  let amount = 0,
    targets = [opponent],
    doubles: DealCard[] = [];
  if (effect === "rent" || effect === "wildRent") {
    const set = s.tables[id].sets.find((v) => v.id === p.setId);
    requireRule(
      set &&
        dealRent(set) > 0 &&
        (effect === "wildRent" || c.colors.includes(set.color)),
      "Choose a matching property group with a rent value",
    );
    requireRule(
      p.doubleIds === undefined ||
        (Array.isArray(p.doubleIds) &&
          p.doubleIds.length <= 2 &&
          new Set(p.doubleIds).size === p.doubleIds.length),
      "Choose up to two distinct Double Rent cards",
    );
    doubles = ((p.doubleIds ?? []) as string[]).map((cid) => {
      const d = s.hands[id].find(
        (v) => v.id === cid && v.effect === "doubleRent",
      );
      requireRule(d, "Double Rent must come from your hand");
      return d;
    });
    requireRule(
      s.playsLeft >= 1 + doubles.length,
      "Each Double Rent needs an available play",
    );
    amount = dealRent(set) * 2 ** doubles.length;
    if (effect === "rent") targets = others;
    else target();
  } else if (effect === "birthday") {
    amount = 2;
    targets = others;
  } else if (effect === "debtCollector") {
    target();
    amount = 5;
  } else if (effect === "slyDeal" || effect === "forcedDeal") {
    target();
    const stolen = property(s, opponent, p.targetCardId);
    requireRule(
      !completeDealSet(stolen.set),
      "Individual properties in complete sets are protected",
    );
    if (effect === "forcedDeal") property(s, id, p.giveCardId);
  } else if (effect === "dealBreaker") {
    requireRule(
      s.settings.rules.dealBreaker,
      "Deal Breaker is disabled by the active profile",
    );
    target();
    requireRule(
      s.tables[opponent].sets.some(
        (v) => v.id === p.targetSetId && completeDealSet(v),
      ),
      "Choose an opponent’s complete set",
    );
  } else requireRule(effect === "passGo", "Unknown action");
  remove();
  s.discard.push(c);
  for (const d of doubles) {
    s.hands[id] = s.hands[id].filter((v) => v.id !== d.id);
    s.discard.push(d);
    s.playsLeft--;
  }
  event(
    s,
    "action",
    id,
    `${name(s, id)} played ${c.title}${amount ? `: ${amount}M ${targets.length > 1 ? "from every opponent" : `from ${name(s, opponent)}`}` : ""}${doubles.length ? ` (${doubles.length}× Double Rent)` : ""}.`,
    {
      card: c,
      ...(targets.length === 1 && effect !== "passGo"
        ? { target: opponent }
        : {}),
    },
  );
  if (effect === "passGo") drawCards(s, id, 2);
  else
    attack(s, id, effect, targets, now, {
      amount,
      ...(typeof p.targetSetId === "string"
        ? { targetSetId: p.targetSetId }
        : {}),
      ...(typeof p.targetCardId === "string"
        ? { targetCardId: p.targetCardId }
        : {}),
      ...(typeof p.giveCardId === "string" ? { giveCardId: p.giveCardId } : {}),
    });
}
function endTurn(s: DealState, now: number) {
  if (s.hands[s.turn!].length > s.settings.rules.handLimit) {
    s.phase = "DISCARD";
    return;
  }
  beginTurn(s, s.order[(s.order.indexOf(s.turn!) + 1) % s.order.length], now);
}
function apply(s: DealState, id: string, a: DealAction, now: number) {
  requireRule(Object.hasOwn(s.players, id), "Unknown player", 401);
  requireRule(
    a &&
      typeof a.id === "string" &&
      a.id.length >= 8 &&
      a.id.length <= 100 &&
      typeof a.type === "string",
    "Invalid action",
  );
  if (s.processed.some((v) => v.id === a.id && v.actor === id)) return;
  requireRule(
    a.generation === s.generation &&
      a.round === s.round &&
      a.revision === s.revision,
    "The table changed. Try again with the latest state.",
    409,
  );
  const p = a.payload ?? {};
  requireRule(
    p && typeof p === "object" && !Array.isArray(p),
    "Invalid action options",
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
      "next",
    ].includes(a.type)
  )
    requireRule(
      s.players[id].role === "HOST",
      "Only the host can do this",
      403,
    );
  switch (a.type) {
    case "settings":
      requireRule(
        s.phase === "LOBBY",
        "Rules are locked after the game starts",
      );
      s.settings = checkedDealSettings(p.settings, s.settings);
      break;
    case "start":
      requireRule(
        s.phase === "LOBBY" && s.order.length >= 2 && s.order.length <= 5,
        "Monopoly Deal needs 2–5 players",
      );
      startRound(s, now);
      break;
    case "next":
      requireRule(s.phase === "ROUND_OVER", "No next game yet");
      startRound(s, now);
      break;
    case "restart": {
      const fresh = createState(
        s.gameId,
        s.players[id],
        s.displayToken,
        s.settings,
        now,
        [...s.rng],
      );
      Object.assign(fresh, {
        players: s.players,
        order: s.order,
        version: s.version,
        revision: s.revision,
        generation: s.generation + 1,
        processed: s.processed,
        eventSequence: s.eventSequence,
      });
      Object.assign(s, fresh);
      event(
        s,
        "notice",
        id,
        "The host returned to the lobby. Match scores reset.",
      );
      break;
    }
    case "end":
      s.phase = "COMPLETED";
      s.pending = null;
      s.turn = null;
      s.turnDeadline = null;
      {
        const best = Math.max(0, ...Object.values(s.wins));
        s.winners = best ? s.order.filter((v) => s.wins[v] === best) : [];
      }
      event(s, "notice", id, "The host ended the match.");
      break;
    case "kick":
      requireRule(
        s.phase === "LOBBY" &&
          typeof p.playerId === "string" &&
          p.playerId !== id &&
          Object.hasOwn(s.players, p.playerId),
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
        "Invalid seat order",
      );
      s.order = p.order as string[];
      break;
    case "transfer-host":
      requireRule(
        typeof p.playerId === "string" &&
          Object.hasOwn(s.players, p.playerId) &&
          p.playerId !== id,
        "Choose another player",
      );
      s.players[id].role = "PLAYER";
      s.players[p.playerId].role = "HOST";
      break;
    case "play":
      play(s, id, p, now);
      break;
    case "end-turn":
      requireRule(
        s.phase === "PLAY" && s.turn === id && !s.pending,
        "Finish the pending action before ending your turn",
      );
      endTurn(s, now);
      break;
    case "discard": {
      requireRule(
        s.phase === "DISCARD" && s.turn === id,
        "No discard needed now",
      );
      const ids = p.cardIds;
      requireRule(
        Array.isArray(ids) &&
          new Set(ids).size === ids.length &&
          ids.length === s.hands[id].length - s.settings.rules.handLimit &&
          ids.every((cid) => s.hands[id].some((c) => c.id === cid)),
        "Select exactly the excess cards from your hand",
      );
      const removed = s.hands[id].filter((c) => ids.includes(c.id));
      s.discard.push(...removed);
      s.hands[id] = s.hands[id].filter((c) => !ids.includes(c.id));
      event(
        s,
        "notice",
        id,
        `${name(s, id)} discarded ${removed.length} cards.`,
      );
      endTurn(s, now);
      break;
    }
    case "move": {
      requireRule(
        s.phase === "PLAY" &&
          s.turn === id &&
          !s.pending &&
          s.settings.rules.rearrange,
        "Rearrange only during your turn, after resolving actions, when allowed by the rules",
      );
      const { set, card } = property(s, id, p.cardId);
      requireRule(
        card.kind === "wild" || p.color === set.color,
        "Ordinary properties must keep their color",
      );
      requireRule(p.setId !== set.id, "Choose a different property group");
      detachProperty(s, id, card.id);
      placeProperty(s, id, card, p.color, p.setId);
      checkWin(s);
      break;
    }
    case "move-building": {
      requireRule(
        s.phase === "PLAY" &&
          s.turn === id &&
          !s.pending &&
          s.settings.rules.rearrange,
        "Move buildings only on your turn when rearrangement is allowed",
      );
      const from = s.tables[id].sets.find(
          (v) => v.house?.id === p.cardId || v.hotel?.id === p.cardId,
        ),
        to = s.tables[id].sets.find((v) => v.id === p.setId);
      requireRule(
        from &&
          to &&
          from !== to &&
          completeDealSet(to) &&
          buildableDealColor(to.color),
        "Choose another eligible complete colored set",
      );
      if (from.hotel?.id === p.cardId) {
        requireRule(to.house && !to.hotel, "A Hotel needs a House");
        to.hotel = from.hotel;
        from.hotel = null;
      } else {
        requireRule(
          !to.house && !from.hotel,
          "Move the Hotel first and choose a set without a House",
        );
        to.house = from.house;
        from.house = null;
      }
      break;
    }
    case "respond": {
      const pending = s.pending;
      requireRule(
        pending?.stage === "response" && pending.responder === id,
        "Wait for your response opportunity",
      );
      if (p.no === true) {
        const card = s.hands[id].find(
          (c) => c.id === p.cardId && c.effect === "justSayNo",
        );
        requireRule(card, "Choose a Just Say No from your hand");
        if (s.settings.rules.ownTurnNoCostsPlay && s.turn === id) {
          requireRule(
            s.playsLeft > 0,
            "The 2024 printed rule needs a remaining play for an own-turn No",
          );
          s.playsLeft--;
        }
        s.hands[id] = s.hands[id].filter((c) => c.id !== card.id);
        s.discard.push(card);
        pending.cancelled = !pending.cancelled;
        pending.depth++;
        pending.responder =
          id === pending.actor ? pending.target : pending.actor;
        pending.deadline = responseDeadline(s, now);
        event(
          s,
          "no",
          id,
          `${name(s, id)} played Just Say No${pending.depth > 1 ? " to counter the previous No" : ""}!`,
          { card, target: pending.responder },
        );
      } else {
        requireRule(p.no === false, "Accept or play Just Say No");
        resolveAttack(s, now);
      }
      break;
    }
    case "pay":
      pay(s, id, p.cardIds, now);
      break;
    case "place-received": {
      const pending = s.pending;
      requireRule(
        pending?.stage === "placement" &&
          pending.responder === id &&
          pending.placements[0]?.owner === id,
        "No property to place now",
      );
      placeProperty(s, id, pending.placements[0].card, p.color, p.setId);
      pending.placements.shift();
      placementsOrAdvance(s, now);
      break;
    }
    default:
      throw new GameError("Unknown Monopoly Deal action");
  }
  s.revision++;
  s.version++;
  s.expiresAt = now + (s.phase === "LOBBY" ? 30 : 120) * 60_000;
  s.processed.push({ id: a.id, actor: id });
  s.processed = s.processed.slice(-160);
}
/** Atomic even for callers outside the transport adapter: invalid moves cannot partly mutate state. */
export function applyAction(
  s: DealState,
  id: string,
  a: DealAction,
  now = Date.now(),
): void {
  const next = structuredClone(s);
  apply(next, id, a, now);
  Object.assign(s, next);
}
export function nextDeadline(s: DealState) {
  return Math.min(
    s.expiresAt,
    s.pending?.deadline ?? Infinity,
    s.turnDeadline ?? Infinity,
  );
}
export function expireState(s: DealState, now = Date.now()): boolean {
  if (s.phase === "COMPLETED") return false;
  if (now >= s.expiresAt) {
    s.phase = "COMPLETED";
    s.turn = null;
    s.pending = null;
    s.turnDeadline = null;
    event(s, "notice", null, "This room expired after inactivity.");
  } else if (s.pending?.deadline && now >= s.pending.deadline) {
    event(
      s,
      "notice",
      s.pending.responder,
      "Response time expired; applying the lobby’s default.",
    );
    if (s.pending.stage === "payment")
      pay(
        s,
        s.pending.responder,
        automaticPayment(s.tables[s.pending.responder], s.pending.amount),
        now,
      );
    else if (s.pending.stage === "placement") {
      const item = s.pending.placements[0],
        color = item.card.colors[0],
        group = s.tables[item.owner].sets.find(
          (g) => g.color === color && g.cards.length < DEAL_GROUPS[color].size,
        );
      placeProperty(s, item.owner, item.card, color, group?.id);
      s.pending.placements.shift();
      placementsOrAdvance(s, now);
    } else resolveAttack(s, now);
  } else if (
    s.turnDeadline &&
    now >= s.turnDeadline &&
    s.turn &&
    ["PLAY", "DISCARD"].includes(s.phase)
  ) {
    const hand = s.hands[s.turn],
      count = Math.max(0, hand.length - s.settings.rules.handLimit),
      ids = [...hand]
        .sort((a, b) => b.value - a.value || a.id.localeCompare(b.id))
        .slice(0, count)
        .map((c) => c.id);
    s.discard.push(...hand.filter((c) => ids.includes(c.id)));
    s.hands[s.turn] = hand.filter((c) => !ids.includes(c.id));
    event(
      s,
      "notice",
      s.turn,
      `Turn time expired${count ? `; discarded ${count} highest-value hand cards` : ""}.`,
    );
    endTurn(s, now);
  } else return false;
  s.version++;
  s.revision++;
  return true;
}
export function serializeForPlayer(
  s: DealState,
  viewer: string,
  now = Date.now(),
): DealView {
  const player = Object.hasOwn(s.players, viewer)
    ? s.players[viewer]
    : undefined;
  const v: DealView = {
    gameType: "monopoly-deal",
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
      table: structuredClone(s.tables[id] ?? emptyTable()),
      completeSets: s.tables[id] ? dealSetCount(s.tables[id]) : 0,
      wins: s.wins[id] ?? 0,
    })),
    round: s.round,
    turn: s.turn,
    playsLeft: s.playsLeft,
    hand: player ? structuredClone(s.hands[viewer] ?? []) : [],
    deckCount: s.deck.length,
    discardCount: s.discard.length,
    top: structuredClone(s.discard.at(-1) ?? null),
    pending: structuredClone(s.pending),
    turnDeadline: s.turnDeadline,
    events: structuredClone(s.events),
    result: structuredClone(s.result),
    history: structuredClone(s.history),
    winners: [...s.winners],
    serverNow: now,
  };
  if (player?.role === "HOST") v.displayToken = s.displayToken;
  return v;
}
