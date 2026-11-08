import test from "node:test";
import assert from "node:assert/strict";
import { MonopolyDealRoom } from "../backend-do/src/monopolyDeal/room.js";
import type { Env } from "../backend-do/src/game.js";
import {
  applyAction,
  createState,
  makeDeck,
  startRound,
  drawCards,
  expireState,
  serializeForPlayer,
  automaticPayment,
  type DealState,
} from "../backend-do/src/monopolyDeal/engine.js";
import {
  CLASSIC_DEAL_RULES,
  DEAL_COLORS,
  DEAL_GROUPS,
  DEFAULT_DEAL_SETTINGS,
  checkedDealSettings,
  completeDealSet,
  dealAssets,
  dealRent,
  dealSetCount,
  type DealAction,
  type DealCard,
  type DealColor,
  type DealEffect,
  type DealRules,
  type DealSet,
  type DealView,
} from "../shared/monopolyDeal.js";

let sequence = 0;
const card = (predicate: (c: DealCard) => boolean) => ({
  ...makeDeck().find(predicate)!,
  id: `test-card-${++sequence}`,
});
const actionCard = (effect: DealEffect) => card((c) => c.effect === effect);
const money = (value = 1) =>
  card((c) => c.kind === "money" && c.value === value);
const prop = (color: DealColor) =>
  card((c) => c.kind === "property" && c.colors[0] === color);
const wild = (color?: DealColor) =>
  card(
    (c) =>
      c.kind === "wild" &&
      (color
        ? c.colors.length === 2 && c.colors.includes(color)
        : c.value === 0),
  );
function room(
  players = 2,
  rules: Partial<DealRules> = {},
  start = true,
): DealState {
  const host = {
    playerId: "p0",
    nickname: "Anna",
    role: "HOST" as const,
    connected: true,
    token: "secret-p0",
    disconnectedAt: null,
  };
  const s = createState(
    "1234",
    host,
    "secret-display",
    { ...DEFAULT_DEAL_SETTINGS, rules: { ...CLASSIC_DEAL_RULES, ...rules } },
    1000,
    [1, 2, 3, 4],
  );
  for (let i = 1; i < players; i++) {
    const id = `p${i}`;
    s.players[id] = {
      ...host,
      playerId: id,
      nickname: `Player ${i}`,
      role: "PLAYER",
      token: `secret-${id}`,
    };
    s.order.push(id);
  }
  if (start) startRound(s, 1000);
  return s;
}
function act(
  s: DealState,
  id: string,
  type: string,
  payload: Record<string, unknown> = {},
  now = 2000,
) {
  const a = {
    id: `request-${++sequence}`,
    type,
    payload,
    generation: s.generation,
    revision: s.revision,
    round: s.round,
  };
  applyAction(s, id, a, now);
  return a;
}
function hand(s: DealState, id: string, ...cards: DealCard[]) {
  s.hands[id] = cards;
  return cards;
}
function group(
  s: DealState,
  id: string,
  color: DealColor,
  n = DEAL_GROUPS[color].size,
): DealSet {
  const set: DealSet = {
    id: `test-set-${++sequence}`,
    color,
    cards: Array.from({ length: n }, () => prop(color)),
    house: null,
    hotel: null,
  };
  s.tables[id].sets.push(set);
  return set;
}
function play(
  s: DealState,
  id: string,
  c: DealCard,
  options: Record<string, unknown> = {},
) {
  if (!s.hands[id].some((v) => v.id === c.id)) s.hands[id].push(c);
  return act(s, id, "play", { cardId: c.id, mode: "action", ...options });
}
const accept = (s: DealState) =>
  act(s, s.pending!.responder, "respond", { no: false });
function placeReceived(s: DealState, color?: DealColor, setId = "") {
  const p = s.pending!,
    item = p.placements[0];
  act(s, item.owner, "place-received", {
    color: color ?? item.card.colors[0],
    setId,
  });
}
const unchanged = (s: DealState, operation: () => void, pattern?: RegExp) => {
  const before = structuredClone(s);
  assert.throws(operation, pattern);
  assert.deepEqual(s, before);
};

test("106-card classic inventory, exact money values and action counts", () => {
  const deck = makeDeck();
  assert.equal(deck.length, 106);
  assert.equal(new Set(deck.map((c) => c.id)).size, 106);
  for (const [kind, count] of [
    ["money", 20],
    ["property", 28],
    ["wild", 11],
    ["action", 47],
  ])
    assert.equal(deck.filter((c) => c.kind === kind).length, count);
  for (const [effect, count] of [
    ["passGo", 10],
    ["rent", 10],
    ["wildRent", 3],
    ["doubleRent", 2],
    ["justSayNo", 3],
    ["house", 3],
    ["hotel", 2],
    ["dealBreaker", 2],
    ["debtCollector", 3],
    ["birthday", 3],
    ["slyDeal", 3],
    ["forcedDeal", 3],
  ])
    assert.equal(deck.filter((c) => c.effect === effect).length, count);
  for (const [value, count] of [
    [1, 6],
    [2, 5],
    [3, 3],
    [4, 3],
    [5, 2],
    [10, 1],
  ])
    assert.equal(
      deck.filter((c) => c.kind === "money" && c.value === value).length,
      count,
    );
  assert.equal(
    deck.filter((c) => c.kind === "wild" && c.value === 0).length,
    2,
  );
  assert.equal(
    deck.find(
      (c) =>
        c.kind === "wild" &&
        c.colors.includes("lightBlue") &&
        c.colors.includes("railroad"),
    )?.value,
    4,
  );
  assert.ok(
    deck.filter((c) => c.effect === "wildRent").every((c) => c.value === 3),
  );
});
test("all rent schedules, property values and set sizes", () => {
  for (const color of DEAL_COLORS) {
    const s = room();
    const g = group(s, "p0", color);
    assert.equal(g.cards[0].value, DEAL_GROUPS[color].value);
    assert.ok(completeDealSet(g));
    assert.equal(dealRent(g), DEAL_GROUPS[color].rent.at(-1));
  }
});
test("deal five plus first draw, empty hand draws five, turn order rotates", () => {
  const s = room(5);
  assert.equal(s.hands.p0.length, 7);
  assert.equal(s.hands.p4.length, 5);
  assert.equal(s.deck.length, 79);
  assert.equal(s.turn, "p0");
  s.hands.p1 = [];
  act(s, "p0", "end-turn");
  assert.equal(s.turn, "p1");
  assert.equal(s.hands.p1.length, 5);
  assert.equal(s.playsLeft, 3);
});
test("same snapshot/action deterministic including shuffle and reshuffle", () => {
  const a = room(3, {}, false),
    b = structuredClone(a);
  const cmd: DealAction = {
    id: "deterministic-01",
    type: "start",
    round: 0,
    generation: 1,
    revision: 0,
  };
  applyAction(a, "p0", cmd, 1000);
  applyAction(b, "p0", cmd, 1000);
  assert.deepEqual(a, b);
  a.discard.push(...a.deck);
  a.deck = [];
  b.discard.push(...b.deck);
  b.deck = [];
  drawCards(a, "p0", 3);
  drawCards(b, "p0", 3);
  assert.deepEqual(a, b);
});
test("draw pile reshuffles every discard and safely stops when all cards are tabled", () => {
  const s = room();
  s.deck = [];
  s.discard = [money(5), prop("red")];
  const before = s.hands.p0.length;
  assert.equal(drawCards(s, "p0", 5), 2);
  assert.equal(s.hands.p0.length, before + 2);
  assert.equal(s.discard.length, 0);
  assert.equal(drawCards(s, "p0", 1), 0);
});
test("three-play budget, out-of-turn moves and property banking are enforced atomically", () => {
  const s = room();
  hand(s, "p0", money(), money(), money(), money(), prop("brown"));
  unchanged(
    s,
    () => act(s, "p1", "play", { mode: "bank", cardId: s.hands.p0[0].id }),
    /turn/,
  );
  unchanged(
    s,
    () => act(s, "p0", "play", { mode: "bank", cardId: s.hands.p0.at(-1)!.id }),
    /cannot be banked/,
  );
  for (let i = 0; i < 3; i++)
    act(s, "p0", "play", { mode: "bank", cardId: s.hands.p0[0].id });
  assert.equal(s.playsLeft, 0);
  unchanged(
    s,
    () => act(s, "p0", "play", { mode: "bank", cardId: s.hands.p0[0].id }),
    /turn/,
  );
});
test("banked action is permanent money and cannot respond from bank", () => {
  const s = room();
  const no = actionCard("justSayNo");
  hand(s, "p0", no);
  play(s, "p0", no, { mode: "bank" });
  assert.equal(s.tables.p0.bank[0].effect, "justSayNo");
  assert.equal(s.hands.p0.length, 0);
  act(s, "p0", "end-turn");
  play(s, "p1", actionCard("debtCollector"), { target: "p0" });
  unchanged(
    s,
    () => act(s, "p0", "respond", { no: true, cardId: no.id }),
    /hand/,
  );
});
test("Pass Go draws two for one play; unused plays may be passed", () => {
  const s = room();
  hand(s, "p0", actionCard("passGo"));
  play(s, "p0", s.hands.p0[0]);
  assert.equal(s.hands.p0.length, 2);
  assert.equal(s.playsLeft, 2);
  act(s, "p0", "end-turn");
  assert.equal(s.turn, "p1");
});
test("hand limit is end-of-turn only and requires exactly excess own cards", () => {
  const s = room();
  hand(s, "p0", ...Array.from({ length: 10 }, () => money()));
  act(s, "p0", "end-turn");
  assert.equal(s.phase, "DISCARD");
  unchanged(
    s,
    () =>
      act(s, "p0", "discard", {
        cardIds: s.hands.p0.slice(0, 2).map((c) => c.id),
      }),
    /exactly/,
  );
  act(s, "p0", "discard", { cardIds: s.hands.p0.slice(0, 3).map((c) => c.id) });
  assert.equal(s.hands.p0.length, 7);
  assert.equal(s.turn, "p1");
});
test("duplicate complete colors count once; overflow property placement is illegal", () => {
  const s = room();
  const g = group(s, "p0", "brown");
  group(s, "p0", "brown");
  assert.equal(dealSetCount(s.tables.p0), 1);
  const c = prop("brown");
  hand(s, "p0", c);
  unchanged(
    s,
    () => play(s, "p0", c, { mode: "property", color: "brown", setId: g.id }),
    /cannot receive/,
  );
  play(s, "p0", c, { mode: "property", color: "brown" });
  assert.equal(s.tables.p0.sets.length, 3);
});
test("rainbow-only has no rent/completion; two-color wild is an anchor", () => {
  const s = room();
  const g = group(s, "p0", "brown", 0);
  g.cards = [wild(), wild()];
  assert.equal(dealRent(g), 0);
  assert.equal(completeDealSet(g), false);
  g.cards[0] = wild("brown");
  assert.equal(completeDealSet(g), true);
  assert.equal(dealRent(g), 2);
});
test("property moves cost no play, fixed colors stay fixed, wildcard reassignment obeys colors", () => {
  const s = room();
  const from = group(s, "p0", "brown", 1);
  const c = wild("brown");
  from.cards.push(c);
  const before = s.playsLeft;
  act(s, "p0", "move", { cardId: c.id, color: "lightBlue" });
  assert.equal(s.playsLeft, before);
  assert.equal(s.tables.p0.sets[1].color, "lightBlue");
  unchanged(
    s,
    () => act(s, "p0", "move", { cardId: c.id, color: "red" }),
    /allowed/,
  );
  unchanged(
    s,
    () => act(s, "p0", "move", { cardId: from.cards[0].id, color: "red" }),
    /keep their color/,
  );
});
test("ordinary properties may regroup on own turn; house-rule can disable rearrangement", () => {
  const s = room();
  const a = group(s, "p0", "brown", 1),
    b = group(s, "p0", "brown", 1);
  act(s, "p0", "move", { cardId: a.cards[0].id, color: "brown", setId: b.id });
  assert.ok(completeDealSet(s.tables.p0.sets[0]));
  const t = room(2, { rearrange: false });
  const g = group(t, "p0", "brown", 1);
  unchanged(
    t,
    () => act(t, "p0", "move", { cardId: g.cards[0].id, color: "brown" }),
    /Rearrange/,
  );
});
test("House/Hotel prerequisites, no railroad/utility, cumulative rent +7", () => {
  const s = room();
  const g = group(s, "p0", "brown"),
    rail = group(s, "p0", "railroad");
  const h = actionCard("house"),
    hotel = actionCard("hotel");
  hand(s, "p0", h, hotel);
  unchanged(s, () => play(s, "p0", hotel, { setId: g.id }), /House/);
  unchanged(s, () => play(s, "p0", h, { setId: rail.id }), /colored/);
  play(s, "p0", h, { setId: g.id });
  play(s, "p0", hotel, { setId: g.id });
  assert.equal(dealRent(s.tables.p0.sets[0]), 9);
});
test("breaking a built group discards buildings and does not bank them", () => {
  const s = room();
  const g = group(s, "p0", "brown");
  g.cards[1] = wild();
  g.house = actionCard("house");
  g.hotel = actionCard("hotel");
  act(s, "p0", "move", { cardId: g.cards[1].id, color: "red" });
  assert.equal(s.discard.length, 2);
  assert.equal(s.tables.p0.sets[0].house, null);
  assert.equal(s.tables.p0.bank.length, 0);
});
test("paired rent hits everyone independently; two doubles use three plays and multiply ×4", () => {
  const s = room(3);
  const g = group(s, "p0", "brown");
  g.house = actionCard("house");
  g.hotel = actionCard("hotel");
  const rent = card((c) => c.effect === "rent" && c.colors.includes("brown")),
    d1 = actionCard("doubleRent"),
    d2 = actionCard("doubleRent");
  hand(s, "p0", rent, d1, d2);
  play(s, "p0", rent, { setId: g.id, doubleIds: [d1.id, d2.id] });
  assert.equal(s.playsLeft, 0);
  assert.equal(s.pending?.amount, 36);
  assert.deepEqual(s.pending?.targets, ["p1", "p2"]);
  accept(s);
  assert.equal(s.pending?.target, "p2");
  accept(s);
  assert.equal(s.pending, null);
});
test("wild rent chooses exactly one target and rent colors are checked", () => {
  const s = room(3);
  const g = group(s, "p0", "red", 1);
  const bad = card((c) => c.effect === "rent" && c.colors.includes("brown"));
  hand(s, "p0", bad);
  unchanged(s, () => play(s, "p0", bad, { setId: g.id }), /matching/);
  play(s, "p0", actionCard("wildRent"), { setId: g.id, target: "p2" });
  assert.deepEqual(s.pending?.targets, ["p2"]);
  assert.equal(s.pending?.amount, 2);
});
test("Double Rent cannot be played alone and cannot exceed turn budget or repeat same card", () => {
  const s = room();
  const g = group(s, "p0", "red");
  const d = actionCard("doubleRent"),
    r = actionCard("wildRent");
  hand(s, "p0", d, r);
  unchanged(s, () => play(s, "p0", d), /Rent card/);
  unchanged(
    s,
    () =>
      play(s, "p0", r, { setId: g.id, target: "p1", doubleIds: [d.id, d.id] }),
    /distinct/,
  );
  s.playsLeft = 1;
  unchanged(
    s,
    () => play(s, "p0", r, { setId: g.id, target: "p1", doubleIds: [d.id] }),
    /available play/,
  );
});
test("Sly Deal protects completed groups and recipient chooses placement of eligible property", () => {
  const s = room();
  const protectedSet = group(s, "p1", "brown"),
    open = group(s, "p1", "red", 1),
    sly = actionCard("slyDeal");
  hand(s, "p0", sly);
  unchanged(
    s,
    () =>
      play(s, "p0", sly, {
        target: "p1",
        targetCardId: protectedSet.cards[0].id,
      }),
    /protected/,
  );
  play(s, "p0", sly, { target: "p1", targetCardId: open.cards[0].id });
  accept(s);
  assert.equal(s.pending?.stage, "placement");
  assert.equal(s.tables.p0.sets.length, 0);
  placeReceived(s, "red");
  assert.equal(s.tables.p0.sets[0].cards[0].title, "Ruby Market");
  assert.equal(s.pending, null);
});
test("Forced Deal transfers both properties and allows offering own completed-set card", () => {
  const s = room();
  const own = group(s, "p0", "brown"),
    other = group(s, "p1", "red", 1);
  own.house = actionCard("house");
  const give = own.cards[0].id,
    take = other.cards[0].id;
  play(s, "p0", actionCard("forcedDeal"), {
    target: "p1",
    targetCardId: take,
    giveCardId: give,
  });
  accept(s);
  assert.equal(s.pending?.placements.length, 2);
  placeReceived(s, "red");
  placeReceived(s, "brown");
  assert.ok(s.tables.p0.sets.some((g) => g.cards.some((c) => c.id === take)));
  assert.ok(s.tables.p1.sets.some((g) => g.cards.some((c) => c.id === give)));
  assert.equal(s.discard.filter((c) => c.effect === "house").length, 1);
});
test("same-color Forced Deal replacement keeps complete group and buildings atomically", () => {
  const s = room();
  const own = group(s, "p0", "brown"),
    other = group(s, "p1", "brown", 1);
  own.house = actionCard("house");
  const ownId = own.id;
  play(s, "p0", actionCard("forcedDeal"), {
    target: "p1",
    targetCardId: other.cards[0].id,
    giveCardId: own.cards[0].id,
  });
  accept(s);
  placeReceived(s, "brown", ownId);
  placeReceived(s, "brown");
  assert.ok(s.tables.p0.sets.find((g) => g.id === ownId)?.house);
});
test("Deal Breaker transfers a complete group plus buildings, and can be disabled", () => {
  const s = room();
  const g = group(s, "p1", "brown");
  g.house = actionCard("house");
  g.hotel = actionCard("hotel");
  play(s, "p0", actionCard("dealBreaker"), { target: "p1", targetSetId: g.id });
  accept(s);
  assert.equal(s.tables.p1.sets.length, 0);
  assert.equal(s.tables.p0.sets[0].hotel?.effect, "hotel");
  const t = room(2, { dealBreaker: false });
  const q = group(t, "p1", "brown");
  const c = actionCard("dealBreaker");
  hand(t, "p0", c);
  unchanged(
    t,
    () => play(t, "p0", c, { target: "p1", targetSetId: q.id }),
    /disabled/,
  );
});
test("debts only accept table assets; overpayment gives no change, banked actions remain money", () => {
  const s = room();
  const banked = actionCard("dealBreaker");
  s.tables.p1.bank.push(banked, money(2));
  play(s, "p0", actionCard("debtCollector"), { target: "p1" });
  accept(s);
  const handId = s.hands.p1[0].id;
  unchanged(s, () => act(s, "p1", "pay", { cardIds: [handId] }), /tabled/);
  act(s, "p1", "pay", { cardIds: s.tables.p1.bank.map((c) => c.id) });
  assert.equal(
    s.tables.p0.bank.reduce((n, c) => n + c.value, 0),
    7,
  );
  assert.equal(s.tables.p1.bank.length, 0);
  assert.equal(s.pending, null);
});

test("Classic allows choosing a property while keeping money in the bank", () => {
  const s = room();
  const g = group(s, "p1", "green", 1),
    cash = money(5);
  s.tables.p1.bank.push(cash);
  play(s, "p0", actionCard("birthday"));
  accept(s);
  act(s, "p1", "pay", { cardIds: [g.cards[0].id] });
  assert.equal(s.tables.p1.bank[0].id, cash.id);
  assert.equal(s.pending?.stage, "placement");
  placeReceived(s, "green");
  assert.equal(s.pending, null);
});

test("bank-first house rule rejects property/mixed payments, persists partial debt and deduplicates bank payment", () => {
  const s = room(2, { bankFirstPayments: true });
  const g = group(s, "p1", "green", 1),
    cash = money(2);
  s.tables.p1.bank.push(cash);
  play(s, "p0", actionCard("debtCollector"), { target: "p1" });
  accept(s);
  unchanged(
    s,
    () => act(s, "p1", "pay", { cardIds: [g.cards[0].id] }),
    /Bank-first/,
  );
  unchanged(
    s,
    () => act(s, "p1", "pay", { cardIds: [cash.id, g.cards[0].id] }),
    /Bank-first/,
  );
  const command = act(s, "p1", "pay", { cardIds: [cash.id] });
  assert.equal(s.pending?.stage, "payment");
  assert.equal(s.pending?.amount, 3);
  assert.equal(s.tables.p1.bank.length, 0);
  assert.equal(s.tables.p0.bank.length, 1);
  const resumed = JSON.parse(JSON.stringify(s)) as DealState;
  applyAction(resumed, "p1", command);
  assert.equal(resumed.pending?.amount, 3);
  assert.equal(resumed.tables.p0.bank.length, 1);
  act(resumed, "p1", "pay", { cardIds: [g.cards[0].id] });
  placeReceived(resumed, "green");
  assert.equal(resumed.pending, null);
  assert.equal(resumed.tables.p1.bank.length, 0);
});

test("bank-first sufficient funds permits chosen bank cards and overpayment without forcing the entire bank", () => {
  const s = room(2, { bankFirstPayments: true });
  group(s, "p1", "red", 1);
  const large = money(10),
    small = money(1);
  s.tables.p1.bank.push(large, small);
  play(s, "p0", actionCard("debtCollector"), { target: "p1" });
  accept(s);
  unchanged(
    s,
    () => act(s, "p1", "pay", { cardIds: [small.id] }),
    /Cover the debt/,
  );
  act(s, "p1", "pay", { cardIds: [large.id] });
  assert.equal(s.pending, null);
  assert.equal(s.tables.p1.bank[0].id, small.id);
  assert.equal(s.tables.p1.sets.length, 1);
});

test("a partial bank payment does not reduce the next opponent's Birthday debt", () => {
  const s = room(3, { bankFirstPayments: true });
  const property = group(s, "p1", "brown", 1),
    firstBank = money(1),
    secondBank = money(2);
  s.tables.p1.bank.push(firstBank);
  s.tables.p2.bank.push(secondBank);
  play(s, "p0", actionCard("birthday"));
  accept(s);
  act(s, "p1", "pay", { cardIds: [firstBank.id] });
  assert.equal(s.pending?.amount, 1);
  act(s, "p1", "pay", { cardIds: [property.cards[0].id] });
  placeReceived(s, "brown");
  assert.equal(s.pending?.target, "p2");
  assert.equal(s.pending?.amount, 2);
  accept(s);
  act(s, "p2", "pay", { cardIds: [secondBank.id] });
  assert.equal(s.pending, null);
  assert.equal(
    s.tables.p0.bank.reduce((n, c) => n + c.value, 0),
    3,
  );
});

test("bank-first insolvency clears debt after bank and all eligible properties, retaining zero-value wilds", () => {
  const s = room(2, { bankFirstPayments: true });
  const g = group(s, "p1", "brown", 1),
    zero = wild();
  g.cards.push(zero);
  const cash = money(1);
  s.tables.p1.bank.push(cash);
  play(s, "p0", actionCard("debtCollector"), { target: "p1" });
  accept(s);
  act(s, "p1", "pay", { cardIds: [cash.id] });
  assert.equal(s.pending?.amount, 4);
  act(s, "p1", "pay", { cardIds: [g.cards[0].id] });
  placeReceived(s, "brown");
  assert.equal(s.pending, null);
  assert.equal(s.tables.p1.sets[0].cards[0].id, zero.id);
});

test("bank-first integrates with automatic payments and both payment timeout stages", () => {
  for (const autoPay of [true, false]) {
    const s = room(2, {
      bankFirstPayments: true,
      autoPay,
      responseSeconds: 15,
    });
    const g = group(s, "p1", "red", 1);
    s.tables.p1.bank.push(money(2));
    assert.deepEqual(
      automaticPayment(s.tables.p1, 5, true),
      s.tables.p1.bank.map((c) => c.id),
    );
    play(s, "p0", actionCard("debtCollector"), { target: "p1" });
    accept(s);
    if (!autoPay) {
      expireState(s, 17_000);
      assert.equal(s.pending?.amount, 3);
      assert.equal(s.pending?.stage, "payment");
      expireState(s, 32_000);
    }
    assert.equal(s.pending?.stage, "placement");
    assert.equal(s.pending?.placements[0].card.id, g.cards[0].id);
    placeReceived(s, "red");
    assert.equal(s.pending, null);
  }
});

test("older saved rules gain the official payment default; bank-first only accepts booleans", () => {
  const rules = { ...CLASSIC_DEAL_RULES } as Partial<DealRules>;
  delete rules.bankFirstPayments;
  assert.equal(checkedDealSettings({ rules }).rules.bankFirstPayments, false);
  assert.equal(
    checkedDealSettings({ rules: { bankFirstPayments: true } }).rules
      .bankFirstPayments,
    true,
  );
  assert.throws(() =>
    checkedDealSettings({ rules: { bankFirstPayments: "yes" } }),
  );
});
test("insolvency requires all valued assets; zero wilds cannot pay and stay with debtor", () => {
  const s = room();
  const g = group(s, "p1", "brown", 1);
  const rainbow = wild();
  g.cards.push(rainbow);
  s.tables.p1.bank.push(money(1));
  play(s, "p0", actionCard("debtCollector"), { target: "p1" });
  accept(s);
  unchanged(
    s,
    () => act(s, "p1", "pay", { cardIds: [s.tables.p1.bank[0].id] }),
    /every payable/,
  );
  unchanged(s, () => act(s, "p1", "pay", { cardIds: [rainbow.id] }), /tabled/);
  act(s, "p1", "pay", { cardIds: dealAssets(s.tables.p1).map((c) => c.id) });
  assert.equal(s.pending?.stage, "placement");
  placeReceived(s, "brown");
  assert.equal(s.tables.p1.sets[0].cards[0].id, rainbow.id);
  assert.equal(s.pending, null);
});
test("buildings can pay and arrive banked; selected buildings transfer before broken-set cleanup", () => {
  const s = room();
  const g = group(s, "p1", "brown");
  g.house = actionCard("house");
  g.hotel = actionCard("hotel");
  play(s, "p0", actionCard("debtCollector"), { target: "p1" });
  accept(s);
  const assets = dealAssets(s.tables.p1);
  act(s, "p1", "pay", { cardIds: assets.map((c) => c.id) });
  while (s.pending?.stage === "placement") placeReceived(s);
  assert.equal(
    s.tables.p0.bank.filter((c) => c.effect === "house" || c.effect === "hotel")
      .length,
    2,
  );
  assert.equal(s.discard.filter((c) => c.effect === "house").length, 0);
});
test("Just Say No counter-counter chains are independent of three-play budget in Classic", () => {
  const s = room();
  const a = actionCard("debtCollector"),
    n0 = actionCard("justSayNo"),
    n1 = actionCard("justSayNo"),
    n2 = actionCard("justSayNo");
  hand(s, "p0", a, n0);
  hand(s, "p1", n1, n2);
  play(s, "p0", a, { target: "p1" });
  const left = s.playsLeft;
  act(s, "p1", "respond", { no: true, cardId: n1.id });
  act(s, "p0", "respond", { no: true, cardId: n0.id });
  act(s, "p1", "respond", { no: true, cardId: n2.id });
  assert.equal(s.pending?.depth, 3);
  assert.equal(s.playsLeft, left);
  assert.equal(s.pending?.cancelled, true);
  accept(s);
  assert.equal(s.pending, null);
  assert.equal(s.turn, "p0");
});
test("2024 own-turn No consumes one play and cannot exceed limit; off-turn remains free", () => {
  const s = room(2, { ownTurnNoCostsPlay: true });
  const n0 = actionCard("justSayNo"),
    n1 = actionCard("justSayNo");
  hand(s, "p0", n0);
  hand(s, "p1", n1);
  play(s, "p0", actionCard("debtCollector"), { target: "p1" });
  act(s, "p1", "respond", { no: true, cardId: n1.id });
  assert.equal(s.playsLeft, 2);
  act(s, "p0", "respond", { no: true, cardId: n0.id });
  assert.equal(s.playsLeft, 1);
  const t = room(2, { ownTurnNoCostsPlay: true });
  const a = actionCard("justSayNo"),
    b = actionCard("justSayNo");
  hand(t, "p0", a);
  hand(t, "p1", b);
  t.playsLeft = 1;
  play(t, "p0", actionCard("debtCollector"), { target: "p1" });
  act(t, "p1", "respond", { no: true, cardId: b.id });
  unchanged(
    t,
    () => act(t, "p0", "respond", { no: true, cardId: a.id }),
    /remaining play/,
  );
  accept(t);
});
test("Birthday has independent responses and payments for each opponent; no collateral cancellation", () => {
  const s = room(3);
  const no = actionCard("justSayNo");
  hand(s, "p1", no);
  s.tables.p2.bank.push(money(2));
  play(s, "p0", actionCard("birthday"));
  act(s, "p1", "respond", { no: true, cardId: no.id });
  accept(s);
  assert.equal(s.pending?.target, "p2");
  accept(s);
  assert.equal(s.pending?.stage, "payment");
  act(s, "p2", "pay", { cardIds: [s.tables.p2.bank[0].id] });
  assert.equal(s.pending, null);
  assert.equal(s.tables.p0.bank[0].value, 2);
});
test("pending action blocks all unrelated moves, end-turn and wrong-player responses", () => {
  const s = room(3);
  play(s, "p0", actionCard("birthday"));
  unchanged(s, () => act(s, "p0", "end-turn"), /pending/);
  unchanged(s, () => act(s, "p2", "respond", { no: false }), /opportunity/);
  const c = s.hands.p0[0];
  unchanged(
    s,
    () => act(s, "p0", "play", { cardId: c.id, mode: "bank" }),
    /pending/,
  );
});
test("automatic win includes wildcard completion and three different colors", () => {
  const s = room();
  group(s, "p0", "brown");
  group(s, "p0", "darkBlue");
  const g = group(s, "p0", "red", 2);
  const w = wild();
  hand(s, "p0", w);
  play(s, "p0", w, { mode: "property", color: "red", setId: g.id });
  assert.equal(s.phase, "COMPLETED");
  assert.deepEqual(s.winners, ["p0"]);
  assert.equal(s.wins.p0, 1);
});
test("Forced Deal can create immediate off-turn winner after received property placement", () => {
  const s = room();
  group(s, "p1", "brown");
  group(s, "p1", "darkBlue");
  const red = group(s, "p1", "red", 2),
    own = group(s, "p0", "red", 1),
    take = group(s, "p1", "orange", 1);
  play(s, "p0", actionCard("forcedDeal"), {
    target: "p1",
    targetCardId: take.cards[0].id,
    giveCardId: own.cards[0].id,
  });
  accept(s);
  placeReceived(s, "orange");
  placeReceived(s, "red", red.id);
  assert.equal(s.result?.winner, "p1");
});
test("multi-game scoring, best-of threshold and starting player rotation", () => {
  const s = room(2, {}, false);
  s.settings.mode = "bestOf";
  s.settings.games = 3;
  act(s, "p0", "start");
  for (const color of ["brown", "red"] as const) group(s, "p0", color);
  const g = group(s, "p0", "darkBlue", 1),
    c = prop("darkBlue");
  play(s, "p0", c, { mode: "property", color: "darkBlue", setId: g.id });
  assert.equal(s.phase, "ROUND_OVER");
  act(s, "p0", "next");
  assert.equal(s.turn, "p1");
  assert.equal(s.wins.p0, 1);
  act(s, "p1", "end-turn");
  group(s, "p0", "brown");
  group(s, "p0", "red");
  const q = group(s, "p0", "darkBlue", 1);
  play(s, "p0", prop("darkBlue"), {
    mode: "property",
    color: "darkBlue",
    setId: q.id,
  });
  assert.equal(s.phase, "COMPLETED");
  assert.equal(s.history.length, 2);
  assert.equal(s.wins.p0, 2);
});
test("house-rule combinations and strict settings validation", () => {
  const s = room(2, {
    setsToWin: 2,
    startingHand: 3,
    handLimit: 5,
    playsPerTurn: 5,
    drawPerTurn: 3,
  });
  assert.equal(s.hands.p0.length, 6);
  assert.equal(s.hands.p1.length, 3);
  assert.equal(s.playsLeft, 5);
  group(s, "p0", "brown");
  play(s, "p0", prop("darkBlue"), { mode: "property", color: "darkBlue" });
  const g = s.tables.p0.sets.find((g) => g.color === "darkBlue")!;
  play(s, "p0", prop("darkBlue"), {
    mode: "property",
    color: "darkBlue",
    setId: g.id,
  });
  assert.equal(s.phase, "COMPLETED");
  for (const rules of [
    { setsToWin: 1 },
    { responseSeconds: 1 },
    { turnSeconds: 20 },
    { autoPay: "yes" },
    { playsPerTurn: Infinity },
  ])
    assert.throws(() => checkedDealSettings({ rules }));
});
test("rules are locked, host permissions and safe restart generation reject stale actions", () => {
  const s = room();
  unchanged(
    s,
    () => act(s, "p0", "settings", { settings: DEFAULT_DEAL_SETTINGS }),
    /locked/,
  );
  unchanged(s, () => act(s, "p1", "end"), /host/);
  const old = {
    id: "old-command-1",
    type: "end-turn",
    revision: s.revision,
    generation: s.generation,
    round: s.round,
  };
  act(s, "p0", "restart");
  assert.equal(s.phase, "LOBBY");
  assert.equal(s.generation, 2);
  unchanged(s, () => applyAction(s, "p0", old), /table changed/);
});

test("host controls reject inherited object names as player identities", () => {
  const s = room(2, {}, false);
  for (const playerId of ["__proto__", "constructor", "toString"]) {
    unchanged(
      s,
      () => act(s, "p0", "transfer-host", { playerId }),
      /another player/,
    );
    unchanged(s, () => act(s, "p0", "kick", { playerId }), /lobby/);
    unchanged(s, () => act(s, playerId, "start"), /Unknown player/);
    assert.equal(serializeForPlayer(s, playerId).yourRole, "DISPLAY");
  }
  assert.equal(Object.hasOwn(Object.prototype, "role"), false);
});
test("request retry is idempotent, stale competing commands rejected, invalid action atomic", () => {
  const s = room();
  const c = money();
  hand(s, "p0", c);
  const request = act(s, "p0", "play", { mode: "bank", cardId: c.id });
  const done = structuredClone(s);
  applyAction(s, "p0", request);
  assert.deepEqual(s, done);
  unchanged(
    s,
    () => applyAction(s, "p0", { ...request, id: "new-request-01" }),
    /table changed/,
  );
});
test("private projections never expose deck, RNG, tokens or another hand, including host/display", () => {
  const s = room(3);
  for (const id of ["p0", "p1", "$display"]) {
    const v = serializeForPlayer(s, id);
    assert.equal(v.hand.length, id === "$display" ? 0 : s.hands[id].length);
    const json = JSON.stringify(v);
    for (const secret of [
      "secret-p0",
      "secret-p1",
      "secret-p2",
      '"rng"',
      '"hands"',
      '"processed"',
    ])
      assert.ok(!json.includes(secret));
    assert.equal("displayToken" in v, id === "p0");
    for (const other of s.order.filter((v) => v !== id))
      for (const c of s.hands[other])
        assert.ok(!json.includes(JSON.stringify(c.id)));
  }
});
test("JSON persistence/reconnection resumes exact unresolved counter/payment/placement", () => {
  const s = room();
  group(s, "p1", "brown", 1);
  play(s, "p0", actionCard("debtCollector"), { target: "p1" });
  let reloaded = JSON.parse(JSON.stringify(s)) as DealState;
  assert.deepEqual(
    serializeForPlayer(reloaded, "p1", 1),
    serializeForPlayer(s, "p1", 1),
  );
  accept(reloaded);
  act(reloaded, "p1", "pay", {
    cardIds: dealAssets(reloaded.tables.p1).map((c) => c.id),
  });
  reloaded = JSON.parse(JSON.stringify(reloaded));
  placeReceived(reloaded, "brown");
  assert.equal(reloaded.pending, null);
});
test("independent simultaneous rooms have isolated cards, rules and response chains", () => {
  const a = room(2),
    b = room(5, { playsPerTurn: 5 });
  const before = structuredClone(b);
  play(a, "p0", actionCard("birthday"));
  assert.deepEqual(b, before);
  assert.equal(a.pending?.targets.length, 1);
  assert.equal(b.pending, null);
});
test("optional response timeout accepts and payment timeout uses documented bank-first fallback", () => {
  const s = room(2, { responseSeconds: 15 });
  s.tables.p1.bank.push(money(5));
  play(s, "p0", actionCard("debtCollector"), { target: "p1" });
  assert.equal(expireState(s, 16_999), false);
  assert.equal(expireState(s, 17_000), true);
  assert.equal(s.pending?.stage, "payment");
  assert.equal(expireState(s, 32_000), true);
  assert.equal(s.pending, null);
  assert.equal(s.tables.p0.bank[0].value, 5);
});
test("turn timer pauses during attack and resumes remaining time; expiry discards and rotates", () => {
  const s = room(2, { turnSeconds: 30 });
  play(s, "p0", actionCard("debtCollector"), { target: "p1" });
  assert.equal(s.turnDeadline, null);
  accept(s);
  assert.equal(s.turnDeadline, 31_000);
  hand(s, "p0", ...Array.from({ length: 9 }, () => money(5)));
  expireState(s, 31_000);
  assert.equal(s.turn, "p1");
  assert.equal(s.hands.p0.length, 7);
  assert.equal(s.discard.filter((c) => c.kind === "money").length, 2);
});
test("opt-in auto-payment resolves no strategic prompt; default remains manual", () => {
  const s = room(2, { autoPay: true });
  s.tables.p1.bank.push(money(5));
  play(s, "p0", actionCard("debtCollector"), { target: "p1" });
  accept(s);
  assert.equal(s.pending, null);
  const t = room();
  t.tables.p1.bank.push(money(5));
  play(t, "p0", actionCard("debtCollector"), { target: "p1" });
  accept(t);
  assert.equal(t.pending?.stage, "payment");
  assert.deepEqual(automaticPayment(t.tables.p1, 5), [t.tables.p1.bank[0].id]);
});

test("complete deterministic games conserve all 106 cards and never reveal another hand", () => {
  for (let run = 0; run < 12; run++) {
    const s = room(2 + (run % 4), { setsToWin: run % 3 === 0 ? 2 : 3 });
    s.rng = [run + 1, 19, 71, 82];
    startRound(s, 1000);
    for (let move = 0; move < 2000 && s.phase !== "COMPLETED"; move++) {
      const all = [
        ...s.deck,
        ...s.discard,
        ...Object.values(s.hands).flat(),
        ...Object.values(s.tables).flatMap((t) => [
          ...t.bank,
          ...t.sets.flatMap((g) => [
            ...g.cards,
            ...(g.house ? [g.house] : []),
            ...(g.hotel ? [g.hotel] : []),
          ]),
        ]),
        ...(s.pending?.placements.map((p) => p.card) ?? []),
      ];
      assert.equal(all.length, 106);
      assert.equal(new Set(all.map((c) => c.id)).size, 106);
      if (s.pending) {
        if (s.pending.stage === "response") accept(s);
        else if (s.pending.stage === "payment")
          act(s, s.pending.responder, "pay", {
            cardIds: automaticPayment(
              s.tables[s.pending.responder],
              s.pending.amount,
            ),
          });
        else {
          const p = s.pending.placements[0],
            color = p.card.colors[0],
            set = s.tables[p.owner].sets.find(
              (g) =>
                g.color === color && g.cards.length < DEAL_GROUPS[color].size,
            );
          placeReceived(s, color, set?.id);
        }
        continue;
      }
      const id = s.turn!,
        h = s.hands[id];
      if (s.phase === "DISCARD") {
        act(s, id, "discard", {
          cardIds: h
            .slice(0, h.length - s.settings.rules.handLimit)
            .map((c) => c.id),
        });
        continue;
      }
      if (s.playsLeft === 0 || h.length === 0) {
        act(s, id, "end-turn");
        continue;
      }
      const c =
        h.find((c) => c.kind === "property" || c.kind === "wild") ??
        h.find((c) =>
          ["birthday", "debtCollector", "passGo"].includes(c.effect ?? ""),
        ) ??
        h[0];
      if (c.kind === "property" || c.kind === "wild") {
        const color = c.colors[0],
          target = s.tables[id].sets.find(
            (g) =>
              g.color === color && g.cards.length < DEAL_GROUPS[color].size,
          );
        play(s, id, c, { mode: "property", color, setId: target?.id });
      } else if (
        ["birthday", "debtCollector", "passGo"].includes(c.effect ?? "")
      )
        play(s, id, c, { target: s.order.find((v) => v !== id) });
      else play(s, id, c, { mode: "bank" });
    }
    assert.equal(s.phase, "COMPLETED", `simulation ${run} should finish`);
  }
});

test("real room adapter authenticates, persists, deduplicates concurrent commands and restores unresolved actions", async () => {
  const store = new Map<string, unknown>(),
    tasks: Promise<unknown>[] = [];
  let alarm = 0,
    queue: Promise<unknown> = Promise.resolve();
  const ctx = {
    storage: {
      get: async (k: string) => structuredClone(store.get(k)),
      put: async (k: string, v: unknown) => {
        store.set(k, structuredClone(v));
      },
      setAlarm: async (v: number) => {
        alarm = v;
      },
      deleteAlarm: async () => {
        alarm = 0;
      },
    },
    blockConcurrencyWhile: (fn: () => Promise<unknown>) => {
      const next = queue.then(fn);
      queue = next.catch(() => {});
      return next;
    },
    waitUntil: (p: Promise<unknown>) => tasks.push(p),
  } as unknown as DurableObjectState;
  let room = new MonopolyDealRoom(ctx, {} as Env);
  const req = (route: string, token?: string, data?: unknown) =>
    new Request(`https://internal/api/game/1234/${route}`, {
      method: data === undefined ? "GET" : "POST",
      headers: token ? { Authorization: `Bearer ${token}` } : {},
      body: data === undefined ? undefined : JSON.stringify(data),
    });
  const created = await room.fetch(
    new Request("https://internal/api/internal/create", {
      method: "POST",
      body: JSON.stringify({ gameId: "1234", hostNickname: "Host" }),
    }),
  );
  assert.equal(created.status, 200);
  const host = (await created.json()) as {
    playerId: string;
    playerToken: string;
  };
  const joined = (await (
    await room.fetch(req("join", undefined, { nickname: "Guest" }))
  ).json()) as { playerId: string; playerToken: string };
  assert.equal((await room.fetch(req("state", "forged"))).status, 401);
  const state = () => store.get("monopoly-deal") as DealState;
  const command = (
    type: string,
    payload: Record<string, unknown> = {},
  ): DealAction => ({
    id: `adapter-request-${++sequence}`,
    type,
    payload,
    generation: state().generation,
    revision: state().revision,
    round: state().round,
  });
  assert.equal(
    (await room.fetch(req("action", joined.playerToken, command("start"))))
      .status,
    403,
  );
  assert.equal(
    (await room.fetch(req("action", host.playerToken, command("start"))))
      .status,
    200,
  );
  assert.ok(alarm > Date.now());
  const invalid = command("play", {
      cardId: "invented",
      mode: "property",
      color: "red",
    }),
    before = structuredClone(state());
  assert.equal(
    (await room.fetch(req("action", host.playerToken, invalid))).status,
    400,
  );
  assert.deepEqual(state(), before);
  const one = command("end-turn"),
    two = command("end-turn");
  const results = await Promise.all([
    room.fetch(req("action", host.playerToken, one)),
    room.fetch(req("action", host.playerToken, two)),
  ]);
  assert.deepEqual(results.map((r) => r.status).sort(), [200, 409]);
  assert.equal(
    (await room.fetch(req("action", host.playerToken, one))).status,
    200,
  );
  // Seed only test storage, then create a fresh adapter as a Durable Object eviction would.
  const snapshot = structuredClone(state()),
    active = snapshot.turn!;
  const demand = actionCard("debtCollector");
  snapshot.hands[active] = [demand];
  delete (snapshot.settings.rules as Partial<DealRules>).bankFirstPayments;
  snapshot.tables[host.playerId].bank.push(money(5));
  store.set("monopoly-deal", snapshot);
  room = new MonopolyDealRoom(ctx, {} as Env);
  assert.equal(
    (
      await room.fetch(
        req(
          "action",
          joined.playerToken,
          command("play", {
            cardId: demand.id,
            mode: "action",
            target: host.playerId,
          }),
        ),
      )
    ).status,
    200,
  );
  const pending = structuredClone(state().pending);
  room = new MonopolyDealRoom(ctx, {} as Env);
  const v = (await (
    await room.fetch(req("state", host.playerToken))
  ).json()) as DealView;
  assert.deepEqual(v.pending, pending);
  assert.equal(v.hand.length, snapshot.hands[host.playerId].length);
  assert.equal(v.settings.rules.bankFirstPayments, false);
  assert.ok(!JSON.stringify(v).includes(joined.playerToken));
  assert.equal(
    (
      await room.fetch(
        req("action", host.playerToken, command("respond", { no: false })),
      )
    ).status,
    200,
  );
  assert.equal(state().pending?.stage, "payment");
  room = new MonopolyDealRoom(ctx, {} as Env);
  const ds = state().displayToken;
  const display = (await (
    await room.fetch(req("state", ds))
  ).json()) as DealView;
  assert.equal(display.hand.length, 0);
  assert.equal(display.displayToken, undefined);
  assert.equal(
    (await room.fetch(req("action", ds, command("respond", { no: false }))))
      .status,
    403,
  );
  assert.equal(
    (
      await room.fetch(
        req(
          "action",
          host.playerToken,
          command("pay", {
            cardIds: state().tables[host.playerId].bank.map((c) => c.id),
          }),
        ),
      )
    ).status,
    200,
  );
  assert.equal(state().pending, null);
  assert.equal(
    (await room.fetch(req("join", undefined, { nickname: "Late" }))).status,
    409,
  );
  assert.equal(
    (
      await room.fetch(
        req(`state?sinceVersion=${state().version}`, host.playerToken),
      )
    ).status,
    204,
  );
  await Promise.allSettled(tasks);
});

test("enabled placement deadline chooses documented first color and open group; disabled timers never decide", () => {
  const s = room(2, { responseSeconds: 15 });
  const open = group(s, "p1", "red", 1),
    own = group(s, "p0", "red", 1);
  play(s, "p0", actionCard("slyDeal"), {
    target: "p1",
    targetCardId: open.cards[0].id,
  });
  accept(s);
  assert.equal(s.pending?.stage, "placement");
  expireState(s, 17_000);
  assert.equal(s.pending, null);
  assert.equal(s.tables.p0.sets.find((g) => g.id === own.id)?.cards.length, 2);
  const t = room();
  play(t, "p0", actionCard("birthday"));
  assert.equal(expireState(t, 100_000), false);
  assert.equal(t.pending?.stage, "response");
});
