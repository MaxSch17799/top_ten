import test from "node:test";
import assert from "node:assert/strict";
import {
  CLASSIC_RULES,
  DEFAULT_UNO_SETTINGS,
  UNO_PROFILES,
  checkedUnoSettings,
  type UnoAction,
  type UnoCard,
  type UnoColor,
  type UnoRules,
} from "../shared/uno.js";
import {
  applyAction,
  cardPoints,
  createState,
  drawCards,
  expireState,
  legalCard,
  makeDeck,
  serializeForPlayer,
  shuffle,
  startRound,
  type StoredPlayer,
  type UnoState,
} from "../backend-do/src/uno/engine.js";
import { UnoRoom } from "../backend-do/src/uno/room.js";
import type { Env } from "../backend-do/src/game.js";

const now = 1_000_000;

test("single-round winner goes out even when opponents hold only zeros", () => {
  const s = room();
  s.hands.a = [card("5")];
  s.hands.b = [card("0", "blue")];
  s.hands.c = [card("0", "green")];
  play(s, "a", s.hands.a[0]);
  assert.equal(s.result?.points, 0);
  assert.deepEqual(s.winners, ["a"]);
});
const card = (
  value: UnoCard["value"],
  color: UnoColor | null = "red",
): UnoCard => ({
  id: crypto.randomUUID(),
  value,
  color: value === "wild" || value === "draw4" ? null : color,
});
function room(rules: Partial<UnoRules> = {}, count = 3): UnoState {
  const host: StoredPlayer = {
    playerId: "a",
    nickname: "Alice",
    role: "HOST",
    token: "token-a",
    connected: true,
    disconnectedAt: null,
  };
  const s = createState(
    "1234",
    host,
    "display-secret",
    { rules: { ...CLASSIC_RULES, ...rules } },
    now,
  );
  for (const id of ["b", "c", "d"].slice(0, count - 1)) {
    s.players[id] = {
      ...host,
      playerId: id,
      nickname: id,
      role: "PLAYER",
      token: `token-${id}`,
    };
    s.order.push(id);
  }
  s.phase = "PLAY";
  s.round = 1;
  s.turn = "a";
  s.color = "red";
  s.discard = [card("5")];
  s.deck = Array.from({ length: 75 }, (_, i) =>
    card(String(i % 10) as UnoCard["value"], i % 2 ? "blue" : "green"),
  );
  for (const id of s.order) {
    s.hands[id] = [card("8", "yellow"), card("9", "blue")];
    s.scores[id] = 0;
    s.wins[id] = 0;
  }
  return s;
}
function action(
  s: UnoState,
  id: string,
  type: string,
  payload: Record<string, unknown> = {},
): UnoAction {
  return {
    id: crypto.randomUUID(),
    generation: s.generation,
    revision: s.revision,
    round: s.round,
    type,
    payload,
  };
}
function command(
  s: UnoState,
  id: string,
  type: string,
  payload: Record<string, unknown> = {},
  at = now,
) {
  const a = action(s, id, type, payload),
    next = structuredClone(s);
  applyAction(next, id, a, at);
  Object.assign(s, next);
  return a;
}
function play(s: UnoState, id: string, c: UnoCard, extra = {}) {
  return command(s, id, "play", { cardIds: [c.id], ...extra });
}

test("classic deck has 108 unique cards, correct multiplicities and scoring", () => {
  const deck = makeDeck();
  assert.equal(deck.length, 108);
  assert.equal(new Set(deck.map((c) => c.id)).size, 108);
  for (const color of ["red", "yellow", "green", "blue"]) {
    assert.equal(deck.filter((c) => c.color === color).length, 25);
    assert.equal(
      deck.filter((c) => c.color === color && c.value === "0").length,
      1,
    );
    for (const value of ["1", "9", "reverse", "skip", "draw2"])
      assert.equal(
        deck.filter((c) => c.color === color && c.value === value).length,
        2,
      );
  }
  assert.equal(deck.filter((c) => c.value === "draw4").length, 4);
  assert.equal(cardPoints(card("9")), 9);
  assert.equal(cardPoints(card("skip")), 20);
  assert.equal(cardPoints(card("wild")), 50);
  assert.deepEqual(
    shuffle([1, 2, 3], () => 0),
    [2, 3, 1],
  );
});
test("dealing preserves all cards and gives seven cards to 2–10 players", () => {
  for (let count = 2; count <= 10; count++) {
    const s = room({}, 2);
    while (s.order.length < count) {
      const id = `p${s.order.length}`;
      s.players[id] = {
        ...s.players.a,
        playerId: id,
        role: "PLAYER",
        token: id,
      };
      s.order.push(id);
    }
    const deck = makeDeck(),
      starter = deck.find((c) => c.value === "3")!;
    deck.splice(deck.indexOf(starter), 1);
    deck.splice(deck.length - 7 * count, 0, starter);
    startRound(s, now, deck);
    for (const id of s.order) assert.equal(s.hands[id].length, 7);
    assert.equal(
      s.deck.length + s.discard.length + Object.values(s.hands).flat().length,
      108,
    );
  }
});
test("opening action cards and opening wild behave correctly", () => {
  for (const value of ["3", "skip", "reverse", "draw2", "wild"] as const) {
    const s = room(),
      deck = makeDeck(),
      first = card(value);
    deck.splice(deck.length - 21, 0, first);
    startRound(s, now, deck);
    assert.equal(s.discard.at(-1)!.value, value);
    assert.equal(
      s.turn,
      value === "reverse"
        ? "a"
        : value === "skip" || value === "draw2"
          ? "c"
          : "b",
    );
    assert.equal(s.hands.b.length, value === "draw2" ? 9 : 7);
    if (value === "wild") {
      assert.equal(s.phase, "COLOR");
      assert.throws(() => command(s, "a", "color", { color: "blue" }));
      command(s, "b", "color", { color: "blue" });
      assert.equal(s.color, "blue");
      assert.equal(s.turn, "b");
    }
  }
});
test("legal matches include color, number, symbol and wild; illegal moves are atomic", () => {
  const s = room();
  const cards = [
    card("2"),
    card("5", "blue"),
    card("reverse", "green"),
    card("wild"),
  ];
  s.hands.a = cards;
  assert.deepEqual(
    cards.map((c) => legalCard(s, "a", c)),
    [true, true, false, true],
  );
  const saved = structuredClone(s);
  assert.throws(() => play(s, "a", cards[2]));
  assert.deepEqual(s, saved);
  assert.throws(() => play(s, "b", s.hands.b[0]));
  assert.throws(() => play(s, "a", cards[3], { color: "purple" }));
  play(s, "a", cards[3], { color: "green" });
  assert.equal(s.color, "green");
  assert.equal(s.turn, "b");
});
test("voluntary draw allows only drawn card, and player may keep it and pass", () => {
  const s = room();
  s.hands.a = [card("6"), card("7")];
  const c = card("8");
  s.deck.push(c);
  command(s, "a", "draw");
  assert.equal(s.drawnCardId, c.id);
  assert.equal(s.turn, "a");
  assert.throws(() => play(s, "a", s.hands.a[0]));
  assert.throws(() => command(s, "a", "draw"));
  command(s, "a", "pass");
  assert.equal(s.turn, "b");
  const t = room();
  t.deck.push(card("1", "blue"));
  command(t, "a", "draw");
  assert.equal(t.turn, "b");
});
test("drawn +4 is not legal when an existing card matches active color", () => {
  const s = room();
  s.hands.a = [card("8")];
  s.deck.push(card("draw4"));
  command(s, "a", "draw");
  assert.equal(s.turn, "b");
  assert.equal(s.drawnCardId, null);
});
test("skip, reverse and two-player special turns", () => {
  for (const count of [2, 3])
    for (const value of ["skip", "reverse", "draw2"] as const) {
      const s = room({}, count),
        c = card(value);
      s.hands.a.push(c);
      play(s, "a", c);
      assert.equal(s.turn, count === 2 ? "a" : "c");
      if (value === "reverse") assert.equal(s.direction, -1);
      if (value === "draw2") assert.equal(s.hands.b.length, 4);
    }
});
test("classic never allows stacking and draw penalty skips exactly one player", () => {
  const s = room(),
    c = card("draw2");
  s.hands.a.push(c);
  s.hands.b.push(card("draw2"));
  play(s, "a", c);
  assert.equal(s.pending, null);
  assert.equal(s.turn, "c");
  assert.equal(s.hands.b.length, 5);
});
test("+4 restrictions examine color, not matching numbers or symbols", () => {
  const s = room(),
    four = card("draw4");
  s.hands.a = [four, card("5", "blue")];
  assert.ok(legalCard(s, "a", four));
  s.hands.a.push(card("7"));
  assert.equal(legalCard(s, "a", four), false);
  assert.throws(() => play(s, "a", four, { color: "blue" }));
});
test("+4 challenge succeeds against a deliberate bluff; evidence is private to challenger", () => {
  const s = room(),
    four = card("draw4"),
    evidence = card("8");
  s.hands.a = [four, evidence];
  play(s, "a", four, { color: "blue", bluff: true });
  assert.equal(serializeForPlayer(s, "b").pending?.canChallenge, true);
  assert.equal(serializeForPlayer(s, "a").pending?.canChallenge, false);
  assert.throws(() => command(s, "c", "challenge"));
  command(s, "b", "challenge");
  assert.equal(s.hands.a.length, 5);
  assert.equal(s.hands.b.length, 2);
  assert.equal(s.turn, "b");
  assert.equal(
    serializeForPlayer(s, "b").challengeProof?.cards[0].id,
    evidence.id,
  );
  assert.equal(serializeForPlayer(s, "a").challengeProof, undefined);
  assert.equal(serializeForPlayer(s, "$display").challengeProof, undefined);
});
test("+4 failed challenge costs six, accept costs four, both skip", () => {
  for (const type of ["challenge", "draw"]) {
    const s = room(),
      four = card("draw4");
    s.hands.a.push(four);
    play(s, "a", four, { color: "blue" });
    command(s, "b", type);
    assert.equal(s.hands.b.length, type === "challenge" ? 8 : 6);
    assert.equal(s.turn, "c");
    assert.equal(s.pending, null);
  }
});
test("UNO call is explicit; catching draws two, self rescue works, next action closes window", () => {
  const s = room(),
    c = card("3");
  s.hands.a = [c, card("7", "blue")];
  play(s, "a", c);
  assert.equal(s.unoVulnerable, "a");
  command(s, "c", "catch");
  assert.equal(s.hands.a.length, 3);
  assert.equal(s.turn, "b");
  assert.throws(() => command(s, "b", "catch"));
  for (const sayUno of [true, false]) {
    const t = room(),
      c = card("2");
    t.hands.a = [c, card("9", "green")];
    play(t, "a", c, { sayUno });
    if (!sayUno) command(t, "a", "uno");
    assert.equal(t.unoVulnerable, null);
    assert.ok(t.declared.includes("a"));
  }
  const t = room(),
    c2 = card("1");
  t.hands.a = [c2, card("9", "green")];
  play(t, "a", c2);
  command(t, "b", "draw");
  assert.equal(t.unoVulnerable, null);
  assert.throws(() => command(t, "c", "catch"));
});
test("automatic skip/penalty preserves UNO catch window", () => {
  for (const value of ["skip", "draw2", "reverse"] as const) {
    const s = room(),
      c = card(value);
    s.hands.a = [c, card("9", "blue")];
    play(s, "a", c);
    assert.equal(s.unoVulnerable, "a");
    command(s, "b", "catch");
    assert.equal(s.hands.a.length, 3);
  }
});
test("discard reshuffles keep top card and available deck never invents cards", () => {
  const s = room();
  s.deck = [];
  const top = card("4");
  s.discard = [card("2"), card("3"), top];
  const before = s.hands.a.length;
  assert.equal(drawCards(s, "a", 5), 2);
  assert.equal(s.hands.a.length, before + 2);
  assert.deepEqual(s.discard, [top]);
  assert.equal(s.deck.length, 0);
});
test("exhausted, unplayable table ends drawn round after everyone passes", () => {
  const s = room();
  s.deck = [];
  for (const id of s.order) {
    s.hands[id] = [card("1", "blue")];
  }
  command(s, "a", "draw");
  command(s, "b", "draw");
  command(s, "c", "draw");
  assert.equal(s.phase, "COMPLETED");
  assert.equal(s.result?.winner, null);
});
test("final +2 applies before scoring and final +4 waits for challenge/acceptance", () => {
  for (const value of ["draw2", "draw4"] as const) {
    const s = room(),
      c = card(value);
    s.hands.a = [c];
    const before = s.hands.b.length;
    play(s, "a", c, { color: "green" });
    if (value === "draw4") {
      assert.equal(s.phase, "PLAY");
      assert.equal(s.outCandidate, "a");
      assert.equal(s.result, null);
      command(s, "b", "draw");
    }
    assert.equal(s.phase, "COMPLETED");
    assert.equal(s.hands.b.length, before + (value === "draw2" ? 2 : 4));
    assert.equal(s.result?.winner, "a");
    assert.equal(
      s.scores.a,
      [...s.hands.b, ...s.hands.c].reduce((n, c) => n + cardPoints(c), 0),
    );
  }
});
test("fixed rounds auto-start through persisted alarm, scores accumulate, points target finishes", () => {
  const s = room();
  s.settings.mode = "rounds";
  s.settings.rounds = 2;
  const c = card("3");
  s.hands.a = [c];
  play(s, "a", c);
  assert.equal(s.phase, "ROUND_OVER");
  const score = s.scores.a;
  assert.equal(expireState(s, now + 11_999), false);
  assert.equal(expireState(s, now + 12_000), true);
  assert.equal(s.round, 2);
  assert.equal(s.scores.a, score);
  assert.equal(s.phase === "PLAY" || s.phase === "COLOR", true);
  s.phase = "PLAY";
  s.turn = "a";
  s.color = "red";
  s.hands.a = [card("2")];
  play(s, "a", s.hands.a[0]);
  assert.equal(s.phase, "COMPLETED");
  const t = room();
  t.settings.mode = "points";
  t.settings.targetScore = 50;
  t.hands.a = [card("3")];
  t.hands.b = [card("wild")];
  play(t, "a", t.hands.a[0]);
  assert.equal(t.phase, "COMPLETED");
});
test("+2 stacking accumulates, any color +2 matches, paying loses turn", () => {
  const s = room({ stack2: true });
  const a = card("draw2"),
    b = card("draw2", "blue");
  s.hands.a.push(a);
  s.hands.b.push(b);
  play(s, "a", a);
  assert.equal(s.pending?.amount, 2);
  play(s, "b", b);
  assert.equal(s.pending?.amount, 4);
  assert.equal(s.turn, "c");
  command(s, "c", "draw");
  assert.equal(s.hands.c.length, 6);
  assert.equal(s.turn, "a");
});
test("+4 stacking accepts old challenge, applies new color restriction, only latest is challenged", () => {
  const s = room({ stack4: true });
  const a = card("draw4"),
    b = card("draw4");
  s.hands.a = [a, card("7", "yellow")];
  s.hands.b = [b, card("1", "blue")];
  play(s, "a", a, { color: "blue" });
  assert.throws(() => play(s, "b", b, { color: "green" }));
  play(s, "b", b, { color: "green", bluff: true });
  assert.equal(s.pending?.amount, 8);
  command(s, "c", "challenge");
  assert.equal(s.hands.b.length, 5);
  assert.equal(s.pending?.amount, 4);
  assert.equal(s.pending?.kind, "draw4");
  assert.equal(s.pending?.offender, null);
  assert.equal(s.turn, "c");
  assert.throws(() => command(s, "c", "challenge"));
  command(s, "c", "draw");
  assert.equal(s.hands.c.length, 6);
});
test("failed challenge on stack draws accumulated debt plus two", () => {
  const s = room({ stack4: true });
  const a = card("draw4"),
    b = card("draw4");
  s.hands.a.push(a);
  s.hands.b.push(b);
  play(s, "a", a, { color: "green" });
  play(s, "b", b, { color: "blue" });
  command(s, "c", "challenge");
  assert.equal(s.hands.c.length, 12);
});
test("mixed stacking requires both switches and +2 on +4 must match chosen color", () => {
  assert.throws(() => checkedUnoSettings({ rules: { mixedStack: true } }));
  const s = room({ stack2: true, stack4: true, mixedStack: true }),
    a = card("draw4"),
    b = card("draw2", "blue"),
    bad = card("draw2", "green");
  s.hands.a.push(a);
  s.hands.b.push(b, bad);
  play(s, "a", a, { color: "blue" });
  assert.throws(() => play(s, "b", bad));
  play(s, "b", b);
  assert.equal(s.pending?.amount, 6);
  assert.equal(s.pending?.kind, "draw2");
});
test("mixed +2 then guilty +4 challenge preserves old +2 debt even if discard reshuffles", () => {
  const s = room({ stack2: true, stack4: true, mixedStack: true }),
    a = card("draw2"),
    b = card("draw4");
  s.hands.a.push(a);
  s.hands.b.push(b, card("2"));
  play(s, "a", a);
  play(s, "b", b, { color: "green", bluff: true });
  s.deck = [];
  command(s, "c", "challenge");
  assert.equal(s.pending?.kind, "draw2");
  assert.equal(s.pending?.amount, 2);
});
test("going out ends stacking chain, final +4 remains challengeable", () => {
  for (const value of ["draw2", "draw4"] as const) {
    const s = room({ stack2: true, stack4: true }),
      c = card(value);
    s.hands.a = [c];
    s.hands.b.push(card(value));
    play(s, "a", c, { color: "blue" });
    if (value === "draw4") {
      assert.equal(serializeForPlayer(s, "b").legalCardIds.length, 0);
      assert.ok(serializeForPlayer(s, "b").pending?.canChallenge);
      command(s, "b", "draw");
    }
    assert.equal(s.phase, "COMPLETED");
    assert.equal(s.result?.winner, "a");
  }
});
test("jump-in requires exact card, runs effects and excludes penalties, wilds, drawn stage", () => {
  const s = room({ jumpIn: true });
  const c = card("5");
  s.hands.c.push(c);
  play(s, "c", c);
  assert.equal(s.turn, "a");
  const t = room({ jumpIn: true });
  t.hands.c.push(card("5", "blue"));
  assert.equal(legalCard(t, "c", t.hands.c.at(-1)!), false);
  const u = room({ jumpIn: true, stack2: true });
  const two = card("draw2");
  u.hands.a.push(two);
  u.hands.c.push(card("draw2"));
  play(u, "a", two);
  assert.throws(() => play(u, "c", u.hands.c.at(-1)!));
  const v = room({ jumpIn: true });
  v.deck.push(card("3"));
  command(v, "a", "draw");
  v.hands.c.push(card("5"));
  assert.equal(legalCard(v, "c", v.hands.c.at(-1)!), false);
});
test("7 swaps and 0 rotates in current direction; transfer before checking winner", () => {
  const s = room({ sevenZero: true }),
    seven = card("7");
  s.hands.a = [seven, card("2")];
  const oldB = s.hands.b.map((c) => c.id);
  play(s, "a", seven, { target: "b" });
  assert.deepEqual(
    s.hands.a.map((c) => c.id),
    oldB,
  );
  assert.equal(s.hands.b.length, 1);
  assert.ok(s.declared.includes("b"));
  const t = room({ sevenZero: true }),
    final = card("7");
  t.hands.a = [final];
  play(t, "a", final, { target: "c" });
  assert.equal(t.result?.winner, "c");
  for (const direction of [1, -1] as const) {
    const u = room({ sevenZero: true }),
      zero = card("0");
    u.direction = direction;
    u.hands.a = [zero];
    play(u, "a", zero);
    assert.equal(u.result?.winner, direction === 1 ? "b" : "c");
  }
  const v = room({ sevenZero: true });
  v.hands.a.push(card("7"));
  assert.throws(() => play(v, "a", v.hands.a.at(-1)!));
});
test("multiple identical number cards only, limit two, one 7–0 trigger, no drawn multi", () => {
  const s = room({ multiples: true });
  s.hands.a = [card("5"), card("5"), card("8", "green")];
  command(s, "a", "play", {
    cardIds: s.hands.a.slice(0, 2).map((c) => c.id),
    sayUno: true,
  });
  assert.equal(s.hands.a.length, 1);
  assert.ok(s.declared.includes("a"));
  for (const value of ["skip", "reverse", "draw2", "wild"] as const) {
    const t = room({ multiples: true });
    t.hands.a = [card(value), card(value), card("8")];
    assert.throws(() =>
      command(t, "a", "play", {
        cardIds: t.hands.a.slice(0, 2).map((c) => c.id),
        color: "red",
      }),
    );
  }
  const t = room({ multiples: true, sevenZero: true });
  t.hands.a = [card("7"), card("7")];
  command(t, "a", "play", { cardIds: t.hands.a.map((c) => c.id), target: "b" });
  assert.equal(t.result?.winner, "b");
});
test("draw until playable stops at legal card; forced play prevents draw/pass/evading stack", () => {
  const s = room({ drawUntil: true });
  const legal = card("7");
  s.deck = [legal, card("4", "blue"), card("2", "yellow")];
  command(s, "a", "draw");
  assert.equal(s.hands.a.length, 5);
  assert.equal(s.drawnCardId, legal.id);
  const t = room({ forcedPlay: true });
  t.hands.a.push(card("7"));
  assert.throws(() => command(t, "a", "draw"));
  const u = room({ forcedPlay: true });
  u.deck.push(card("7"));
  command(u, "a", "draw");
  assert.throws(() => command(u, "a", "pass"));
  play(u, "a", u.hands.a.at(-1)!);
  const v = room({ forcedPlay: true, stack2: true });
  const two = card("draw2");
  v.hands.a.push(two);
  v.hands.b.push(card("draw2"));
  play(v, "a", two);
  assert.throws(() => command(v, "b", "draw"));
});
test("profiles validate types, limits and every supported house-rule combination", () => {
  for (const p of UNO_PROFILES)
    assert.equal(
      checkedUnoSettings({ ...DEFAULT_UNO_SETTINGS, rules: p.rules }).profileId,
      p.id,
    );
  for (let mask = 0; mask < 256; mask++) {
    const rules = Object.fromEntries(
      Object.keys(CLASSIC_RULES).map((key, index) => [
        key,
        !!(mask & (1 << index)),
      ]),
    );
    if (rules.mixedStack && (!rules.stack2 || !rules.stack4))
      assert.throws(() => checkedUnoSettings({ rules }));
    else assert.deepEqual(checkedUnoSettings({ rules }).rules, rules);
  }
  for (const raw of [
    { mode: "x" },
    { rounds: 0 },
    { rounds: 101 },
    { targetScore: 1 },
    { rules: { jumpIn: 1 } },
    { rules: null },
  ])
    assert.throws(() => checkedUnoSettings(raw));
});
test("host permissions, locked rules, stale revisions and deduplicated retries", () => {
  const s = room();
  assert.throws(() => command(s, "b", "end"));
  assert.throws(() => command(s, "a", "settings", { rules: { jumpIn: true } }));
  const stale = action(s, "a", "draw");
  s.deck.push(card("3"));
  const a = command(s, "a", "draw"),
    version = s.version;
  applyAction(s, "a", a);
  assert.equal(s.version, version);
  assert.throws(() => applyAction(s, "a", stale));
  command(s, "a", "restart");
  assert.equal(s.generation, 2);
  assert.equal(s.phase, "LOBBY");
  assert.equal(s.order.length, 3);
  assert.throws(() => applyAction(s, "a", a));
  command(s, "a", "transfer-host", { playerId: "b" });
  assert.equal(s.players.b.role, "HOST");
  assert.throws(() => command(s, "a", "end"));
  command(s, "b", "kick", { playerId: "c" });
  assert.equal(s.players.c, undefined);
});
test("host, opponents and display never receive private state or other hands", () => {
  const s = room();
  s.hands.a.push(card("draw4"));
  for (const id of ["a", "b", "$display"]) {
    const v = serializeForPlayer(s, id),
      json = JSON.stringify(v);
    assert.equal(v.hand.length, id === "$display" ? 0 : s.hands[id].length);
    for (const other of s.order.filter((p) => p !== id))
      for (const c of s.hands[other]) assert.equal(json.includes(c.id), false);
    for (const c of s.deck) assert.equal(json.includes(c.id), false);
    for (const secret of ["token-a", "token-b", "token-c", "display-secret"])
      assert.equal(
        json.includes(secret),
        secret === "display-secret" && id === "a",
      );
    assert.equal("hands" in v, false);
    assert.equal("deck" in v, false);
    assert.equal("processed" in v, false);
  }
});
test("complete simulated games conserve all 108 cards under every valid rule combination", () => {
  for (let mask = 0; mask < 256; mask++) {
    const rules = Object.fromEntries(
      Object.keys(CLASSIC_RULES).map((key, index) => [
        key,
        !!(mask & (1 << index)),
      ]),
    ) as unknown as UnoRules;
    if (rules.mixedStack && (!rules.stack2 || !rules.stack4)) continue;
    const s = room(rules);
    s.round = 0;
    s.phase = "LOBBY";
    command(s, "a", "start");
    let steps = 0;
    while (s.phase !== "COMPLETED" && steps++ < 2500) {
      const id = s.turn!,
        v = serializeForPlayer(s, id);
      if (s.phase === "COLOR") command(s, id, "color", { color: "red" });
      else if (v.legalCardIds.length) {
        const c = s.hands[id].find((c) => c.id === v.legalCardIds[0])!;
        const colors = ["red", "yellow", "green", "blue"] as const;
        const best = [...colors].sort(
          (a, b) =>
            s.hands[id].filter((c) => c.color === b).length -
            s.hands[id].filter((c) => c.color === a).length,
        )[0];
        play(s, id, c, {
          color: best,
          target: s.order.find((p) => p !== id),
          sayUno: true,
        });
      } else if (v.canDraw) command(s, id, "draw");
      else if (v.canPass) command(s, id, "pass");
      else assert.fail(`No move for combination ${mask}`);
      const cards = [...s.deck, ...s.discard, ...Object.values(s.hands).flat()];
      assert.equal(cards.length, 108);
      assert.equal(new Set(cards.map((c) => c.id)).size, 108);
    }
    assert.equal(s.phase, "COMPLETED", `Combination ${mask} should finish`);
  }
});
test("Durable Object adapter persists, authenticates, projects and rejects invalid actions atomically", async () => {
  const store = new Map<string, unknown>(),
    pending: Promise<unknown>[] = [];
  const ctx = {
    storage: {
      transaction: async (fn: (tx: DurableObjectStorage) => Promise<unknown>) => fn(ctx.storage),
      get: async (k: string) => structuredClone(store.get(k)),
      put: async (k: string, v: unknown) => {
        store.set(k, structuredClone(v));
      },
      setAlarm: async () => {},
      deleteAlarm: async () => {},
    },
    blockConcurrencyWhile: async (fn: () => Promise<unknown>) => fn(),
    waitUntil: (p: Promise<unknown>) => pending.push(p),
  } as unknown as DurableObjectState;
  const r = new UnoRoom(ctx, {} as Env);
  const req = (route: string, token?: string, data?: unknown) =>
    new Request(`https://internal/api/game/1234/${route}`, {
      method: data === undefined ? "GET" : "POST",
      headers: token ? { Authorization: `Bearer ${token}` } : {},
      body: data === undefined ? undefined : JSON.stringify(data),
    });
  const created = await r.fetch(
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
  assert.equal((await r.fetch(req("state", "wrong"))).status, 401);
  const joined = (await (
    await r.fetch(req("join", undefined, { nickname: "Guest" }))
  ).json()) as { playerId: string; playerToken: string };
  let s = store.get("uno") as UnoState;
  const a = action(s, host.playerId, "start");
  assert.equal((await r.fetch(req("action", host.playerToken, a))).status, 200);
  s = store.get("uno") as UnoState;
  assert.equal(
    (
      await r.fetch(
        req(
          "action",
          joined.playerToken,
          action(s, joined.playerId, "settings", {}),
        ),
      )
    ).status,
    403,
  );
  const before = structuredClone(store.get("uno"));
  const invalid = action(s, s.turn!, "play", { cardIds: ["invented"] });
  assert.equal(
    (await r.fetch(req("action", s.players[s.turn!].token, invalid))).status,
    400,
  );
  assert.deepEqual(store.get("uno"), before);
  const resumed = new UnoRoom(ctx, {} as Env);
  const view = (await (
    await resumed.fetch(req("state", host.playerToken))
  ).json()) as { hand: UnoCard[] };
  assert.equal(view.hand.length, s.hands[host.playerId].length);
  const displayToken = s.displayToken;
  const displayView = (await (
    await resumed.fetch(req("state", displayToken))
  ).json()) as { hand: UnoCard[] };
  assert.equal(displayView.hand.length, 0);
  assert.equal(
    (
      await resumed.fetch(
        req("action", displayToken, action(s, "$display", "draw")),
      )
    ).status,
    403,
  );
  assert.equal(
    (await resumed.fetch(req("join", undefined, { nickname: "Late" }))).status,
    409,
  );
  await Promise.allSettled(pending);
});
