import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  defaultWaveSettings,
  WAVE_GEOMETRY as G,
  waveScore,
  type WaveAction,
  type WaveSettings,
  type WaveView,
} from "../shared/wavelength.js";
import { validateWavePack } from "../shared/wavePack.mjs";
import {
  applyAction,
  createState,
  draw,
  expireState,
  generateTarget,
  playerDisconnected,
  serializeForPlayer,
  type StoredPlayer,
  type WaveState,
} from "../backend-do/src/wavelength/engine.js";
import {
  compactHistory,
  WavelengthRoom,
} from "../backend-do/src/wavelength/room.js";
import type { Env } from "../backend-do/src/game.js";
import { coopBand } from "../frontend/src/lib/waveI18n.js";

const now = 1_000_000;
function room(settings: Partial<WaveSettings> = {}) {
  const host: StoredPlayer = {
    playerId: "a",
    nickname: "A",
    role: "HOST",
    connected: true,
    team: 0,
    token: "token-a",
    disconnectedAt: null,
  };
  const s = createState("1234", host, "host-token", settings, now);
  for (const [i, id] of ["b", "c", "d", "e", "f"].entries()) {
    s.players[id] = {
      ...host,
      playerId: id,
      nickname: id,
      role: "PLAYER",
      token: `token-${id}`,
      team: (i + 1) % 2,
    };
    s.order.push(id);
  }
  return s;
}
function command(
  s: WaveState,
  id: string,
  type: string,
  payload: Record<string, unknown> = {},
  at = now,
): WaveAction {
  const a: WaveAction = {
    id: crypto.randomUUID(),
    type,
    generation: s.generation,
    roundId: s.roundId,
    phase: s.phase,
    revision: s.revision,
    payload,
  };
  applyAction(s, id, a, at);
  return a;
}
function start(settings: Partial<WaveSettings> = {}) {
  const s = room(settings);
  command(s, "a", "start");
  return s;
}
function round(
  s: WaveState,
  points: 0 | 2 | 3 | 4,
  side: "left" | "right" = "left",
) {
  if (s.phase === "CLUE")
    command(s, s.psychicId!, "clue", { text: "An existing thing" });
  s.target = 90;
  const dial = 90 + { 0: 40, 2: 16, 3: 8, 4: 0 }[points];
  if (!s.controllerId)
    command(
      s,
      s.order.find(
        (id) =>
          id !== s.psychicId &&
          (s.settings.gameMode === "cooperative" ||
            s.players[id].team === s.activeTeam),
      )!,
      "claim",
    );
  command(s, s.controllerId!, "lock", { value: dial, epoch: s.controlEpoch });
  if (s.phase === "PREDICTION")
    command(
      s,
      s.order.find((id) => s.players[id].team === 1 - s.activeTeam)!,
      "predict",
      { side },
    );
}

test("geometry scores both sides, all boundaries, and the higher value at an edge", () => {
  for (const direction of [-1, 1])
    for (const [distance, points] of [
      [0, 4],
      [G.centerHalf, 4],
      [G.centerHalf + 0.001, 3],
      [G.adjacentOuter, 3],
      [G.adjacentOuter + 0.001, 2],
      [G.outer, 2],
      [G.outer + 0.001, 0],
    ]) {
      assert.equal(waveScore(90, 90 + direction * distance).points, points);
    }
  assert.equal(waveScore(-3.9, 0).points, 4);
  assert.equal(waveScore(183.9, 180).points, 4);
  assert.equal(waveScore(-3.9, 180).points, 0);
  assert.equal(waveScore(183.9, 0).points, 0);
});
test("conditioned target distribution permits clipped centers, is symmetric, and never wraps", () => {
  const values = Array.from({ length: 20000 }, generateTarget);
  assert(values.every((v) => v > -4 && v < 184));
  assert(values.some((v) => v < 0));
  assert(values.some((v) => v > 180));
  assert(Math.abs(values.reduce((a, b) => a + b) / values.length - 90) < 2);
  const bins = Array(10).fill(0);
  values.forEach((v) => bins[Math.min(9, Math.floor(((v + 4) / 188) * 10))]++);
  assert(bins.every((count) => count > 1650 && count < 2350));
});
test("official 0/1 start; party has no clue submission; correct prediction scores except on center", () => {
  const s = start();
  assert.deepEqual(s.scores, [0, 1]);
  assert.equal(s.phase, "DIAL");
  assert.equal(s.psychicId, "a");
  round(s, 3);
  assert.deepEqual(s.scores, [3, 2]);
  assert.equal(s.result?.opponentPoints, 1);
  command(s, "a", "next");
  round(s, 4);
  assert.equal(s.result?.opponentPoints, 0);
  assert.deepEqual(s.scores, [3, 6]);
});
test("wrong prediction and equality score zero; no ordinary one-point wedges", () => {
  const s = start();
  round(s, 2, "right");
  assert.equal(s.result?.opponentPoints, 0);
  assert.equal(s.result?.points, 2);
  assert.equal(waveScore(90, 90).points, 4);
});
test("catch-up repeats while behind, uses another Psychic, and stops at tie/ahead", () => {
  const s = start({ targetScore: 100 });
  s.scores = [0, 15];
  const psychics: string[] = [];
  for (let i = 0; i < 3; i++) {
    psychics.push(s.psychicId!);
    round(s, 4);
    assert.equal(s.catchUpTurn, true);
    assert.equal(s.nextTeam, 0);
    command(s, "a", "next");
  }
  assert.equal(new Set(psychics).size, 3);
  round(s, 4);
  assert.equal(s.catchUpTurn, false);
  assert.equal(s.nextTeam, 1);
  const tied = start({ targetScore: 100 });
  tied.scores = [0, 4];
  round(tied, 4);
  assert.equal(tied.catchUpTurn, false);
});
test("Psychics rotate independently with uneven team sizes", () => {
  const s = start({ targetScore: 200, catchUp: false });
  s.players.f.team = 0;
  const teams: string[][] = [[], []];
  for (let i = 0; i < 12; i++) {
    teams[s.activeTeam].push(s.psychicId!);
    round(s, 0, "right");
    command(s, "a", "next");
  }
  assert.equal(new Set(teams[0].slice(0, 4)).size, 4);
  assert.equal(new Set(teams[1].slice(0, 2)).size, 2);
});
test("target victory and sudden death wait for complete pairs, repeat ties and count prediction bonuses", () => {
  const victory = start();
  victory.scores = [8, 3];
  round(victory, 2);
  assert.equal(victory.winner, 0);
  const s = start();
  s.scores = [8, 9];
  round(s, 2);
  assert.deepEqual(s.scores, [10, 10]);
  assert.equal(s.tiebreak?.remaining, 2);
  command(s, "a", "next");
  round(s, 3);
  assert.equal(s.winner, null);
  assert.equal(s.tiebreak?.remaining, 1);
  command(s, "a", "next");
  round(s, 3);
  assert.equal(s.winner, null);
  assert.equal(s.tiebreak?.pair, 2);
  assert.equal(s.tiebreak?.remaining, 2);
  command(s, "a", "next");
  round(s, 4);
  assert.equal(s.winner, null);
  command(s, "a", "next");
  round(s, 0, "right");
  assert.notEqual(s.winner, null);
});
test("fixed-round house rule ignores target threshold but resolves ties with paired sudden death", () => {
  const s = start({ fixedRounds: 2, targetScore: 1 });
  round(s, 3);
  assert.equal(s.winner, null);
  command(s, "a", "next");
  round(s, 0, "right");
  assert.equal(s.winner, 0);
});
test("cooperative center is 3 plus a round; adjacent 3 has no bonus; seven ordinary rounds end", () => {
  const s = start({ gameMode: "cooperative" });
  assert.deepEqual(s.scores, [0, 0]);
  assert.equal(s.remaining, 7);
  round(s, 4);
  assert.equal(s.phase, "REVEAL");
  assert.equal(s.result?.points, 3);
  assert.equal(s.remaining, 7);
  command(s, "a", "next");
  round(s, 3);
  assert.equal(s.result?.points, 3);
  assert.equal(s.result?.centerHit, false);
  assert.equal(s.remaining, 6);
  for (let i = 0; i < 6; i++) {
    command(s, "a", "next");
    round(s, 0);
  }
  assert.equal(s.remaining, 0);
  assert.equal(s.winner, 0);
});
test("remote clue locks, chat completes gameplay and even a host Psychic cannot hint again", () => {
  const s = start({ mode: "written" });
  assert.equal(s.phase, "CLUE");
  command(s, "a", "clue", { text: "A midnight picnic" });
  assert.equal(s.clue, "A midnight picnic");
  assert.throws(() => command(s, "a", "clue", { text: "Different" }));
  assert.throws(() => command(s, "a", "chat", { text: "Further hints" }));
  command(s, "c", "chat", { text: "I think a bit left" });
  assert.equal(serializeForPlayer(s, "b").chat.length, 1);
  round(s, 3);
  command(s, "a", "chat", { text: "Now I can explain" }, now + 1000);
  assert.equal(s.chat.length, 2);
});
test("all public roles exclude target and candidates, including host, display and spectator", () => {
  const s = start();
  s.psychicId = "c";
  s.players.f.team = null;
  for (const id of ["a", "b", "d", "e", "f", "$display"]) {
    const v = serializeForPlayer(s, id),
      json = JSON.stringify(v);
    assert(!Object.hasOwn(v, "target"));
    assert(!Object.hasOwn(v, "candidates"));
    for (const key of [
      '"token"',
      '"hostToken"',
      '"used"',
      '"rotation"',
      '"before"',
      '"center"',
    ])
      assert(!json.includes(key), key);
  }
  assert.equal(serializeForPlayer(s, "c").target, s.target);
  const selection = start({ selection: "two" });
  assert.equal(selection.target, null);
  assert.equal(serializeForPlayer(selection, "a").candidates?.length, 2);
  assert(!Object.hasOwn(serializeForPlayer(selection, "a"), "target"));
  assert(
    !Object.hasOwn(serializeForPlayer(selection, "$display"), "candidates"),
  );
  command(selection, "a", "choose", { index: 1 });
  assert(selection.target !== null);
  assert.equal(selection.candidates.length, 0);
});
test("roles, stale revisions, sequence numbers, duplicate lock/prediction and generation replay are enforced", () => {
  const s = start(),
    controllerId = s.controllerId!;
  assert.throws(() =>
    command(s, "a", "lock", { value: 90, epoch: s.controlEpoch }),
  );
  assert.throws(() =>
    command(s, "b", "move", { value: 20, epoch: s.controlEpoch, sequence: 1 }),
  );
  command(s, controllerId, "move", {
    value: 30,
    epoch: s.controlEpoch,
    sequence: 2,
  });
  assert.throws(() =>
    command(s, controllerId, "move", {
      value: 10,
      epoch: s.controlEpoch,
      sequence: 1,
    }),
  );
  const locked = command(s, controllerId, "lock", {
    value: 60,
    epoch: s.controlEpoch,
  });
  applyAction(s, controllerId, locked);
  assert.equal(s.dial, 60);
  assert.throws(() =>
    command(s, controllerId, "move", {
      value: 10,
      epoch: s.controlEpoch,
      sequence: 3,
    }),
  );
  const prediction = command(s, "b", "predict", { side: "left" }),
    scores = [...s.scores];
  applyAction(s, "b", prediction);
  assert.deepEqual(s.scores, scores);
  command(s, "a", "restart");
  assert.throws(() =>
    applyAction(s, "b", { ...prediction, id: crypto.randomUUID() }),
  );
});
test("control takeover is deterministic and disconnect permits handover without revealing secrets", () => {
  const s = start(),
    epoch = s.controlEpoch;
  command(s, "e", "claim");
  assert.equal(s.controllerId, "e");
  assert(s.controlEpoch > epoch);
  assert.throws(() => command(s, "c", "lock", { value: 20, epoch }));
  playerDisconnected(s, "e", now);
  assert.equal(s.controllerId, null);
  command(s, "c", "claim");
  assert.equal(s.controllerId, "c");
  assert(!Object.hasOwn(serializeForPlayer(s, "c"), "target"));
});
test("mode and language changes are queued without resetting the deck, points or round", () => {
  const s = start(),
    secret = s.target,
    roundId = s.roundId;
  command(s, "a", "settings", {
    mode: "written",
    packId: "wavelength-de-classic-v1",
  });
  assert.equal(s.roundSettings?.mode, "party");
  assert.equal(s.target, secret);
  assert.equal(s.roundId, roundId);
  round(s, 0);
  command(s, "a", "next");
  assert.equal(s.phase, "CLUE");
  assert.equal(s.spectrum?.id.slice(0, 2), "de");
  assert.equal(s.used[defaultWaveSettings.packId].length, 1);
});
test("reopen is allowed before reveal; void after reveal restores scores and uses a fresh target/round", () => {
  const s = start();
  command(s, s.controllerId!, "lock", { value: 100, epoch: s.controlEpoch });
  command(s, "a", "reopen");
  assert.equal(s.phase, "DIAL");
  const id = s.roundId;
  round(s, 3);
  assert.throws(() => command(s, "a", "reopen"));
  command(s, "a", "void", { reason: "Accidental reveal" });
  assert.deepEqual(s.scores, [0, 1]);
  assert.notEqual(s.roundId, id);
  assert.equal(s.phase, "DIAL");
  assert.equal(s.history.at(-1)?.void, true);
});
test("host confirmation reveals first and commits exactly once; corrections recalculate victory and catch-up", () => {
  const s = start({ automaticScoring: false });
  s.scores = [6, 9];
  round(s, 4);
  assert.equal(s.phase, "REVIEW");
  assert.deepEqual(s.scores, [6, 9]);
  assert(serializeForPlayer(s, "$display").target !== undefined);
  command(s, "a", "confirm", { points: 4, opponentPoints: 1 });
  assert.deepEqual(s.scores, [10, 9]);
  assert.equal(s.winner, 0);
  assert.equal(s.result?.opponentPoints, 0);
  command(s, "a", "correct", {
    points: 2,
    opponentPoints: 0,
    reason: "Agreed house ruling",
  });
  assert.equal(s.winner, null);
  assert.deepEqual(s.scores, [8, 9]);
  assert.throws(() =>
    command(s, "a", "confirm", { points: 4, opponentPoints: 0 }),
  );
});
test("timers pause, resume, add and reset using server deadlines, expire once and never fabricate clues", () => {
  const s = start({ mode: "written", clueSeconds: 10, dialSeconds: 20 });
  assert.equal(s.deadline, now + 10000);
  command(s, "a", "pause", {}, now + 2000);
  assert.equal(s.pausedRemaining, 8000);
  assert.equal(s.deadline, null);
  command(s, "a", "add-time", {}, now + 4000);
  assert.equal(s.pausedRemaining, 38000);
  command(s, "a", "resume", {}, now + 5000);
  assert.equal(s.deadline, now + 43000);
  command(s, "a", "reset-timer", {}, now + 6000);
  assert.equal(s.deadline, now + 16000);
  assert(expireState(s, now + 17000));
  assert.equal(s.phase, "CLUE");
  assert.equal(s.clue, null);
  assert(!expireState(s, now + 18000));
  command(s, "a", "clue", { text: "A submarine" }, now + 19000);
  command(s, "a", "settings", { dialSeconds: 30 }, now + 20000);
  assert.equal(s.deadline, now + 50000);
});
test("automatic expiry locks current dial, skips missing prediction without bonus, and auto-next runs on server", () => {
  const s = start({
    dialSeconds: 1,
    predictionSeconds: 1,
    autoExpiry: true,
    autoNextSeconds: 5,
  });
  assert(expireState(s, now + 1001));
  assert.equal(s.phase, "PREDICTION");
  assert(expireState(s, now + 2002));
  assert.equal(s.phase, "REVEAL");
  assert.equal(s.result?.opponentPoints, 0);
  const scores = [...s.scores];
  assert(!expireState(s, now + 2003));
  assert.deepEqual(s.scores, scores);
  assert(expireState(s, now + 7003));
  assert.equal(s.round, 2);
});
test("JSON persistence restores roles, targets, timers, history and deduplication", () => {
  const s = start({ mode: "written", clueSeconds: 20 });
  const a = command(s, "a", "clue", { text: "Cinnamon toast" });
  const restored = JSON.parse(JSON.stringify(s)) as WaveState;
  assert.deepEqual(
    serializeForPlayer(restored, "a", now),
    serializeForPlayer(s, "a", now),
  );
  applyAction(restored, "a", a);
  assert.equal(restored.version, s.version);
  round(restored, 2);
  assert.equal(restored.history.length, 1);
});
test("shuffle bag avoids repetitions, preserves pack-specific used cards and excludes immediate boundary repeat", () => {
  const s = room(),
    ids = Array.from({ length: 200 }, () => draw(s).id);
  assert.equal(new Set(ids).size, 200);
  assert.notEqual(draw(s).id, ids.at(-1));
  assert.equal(s.cycle[s.settings.packId], 2);
  s.settings.packId = "wavelength-de-classic-v1";
  assert(draw(s).id.startsWith("de-"));
  assert.equal(s.used[defaultWaveSettings.packId].length, 1);
});
test("both full packs validate; malformed types, executable content and reversed duplicate pairs are rejected", () => {
  for (const language of ["en", "de"]) {
    const p = JSON.parse(
      readFileSync(
        new URL(
          `../spectrum-packs/wavelength/wavelength_${language}_classic_v1.json`,
          import.meta.url,
        ),
        "utf8",
      ),
    );
    assert.equal(validateWavePack(p).spectrums.length, 200);
    const duplicate = structuredClone(p);
    duplicate.spectrums.push({
      ...p.spectrums[0],
      id: "duplicate",
      left: p.spectrums[0].right,
      right: p.spectrums[0].left,
    });
    assert.throws(() => validateWavePack(duplicate));
    for (const update of [
      { language: "fr" },
      { schemaVersion: 2 },
      { spectrums: [] },
      { development: "true" },
    ])
      assert.throws(() => validateWavePack({ ...p, ...update }));
    const bad = structuredClone(p);
    bad.spectrums[0].left = "<script>alert(1)</script>";
    assert.throws(() => validateWavePack(bad));
  }
});
test("invalid configuration, insufficient teams, spectators and forged identities are rejected", () => {
  assert.throws(() => room({ fixedRounds: 3 }));
  assert.throws(() => room({ targetScore: 0 }));
  assert.throws(() => room({ dialSeconds: -1 }));
  const s = room();
  s.players.c.team = null;
  s.players.e.team = null;
  assert.throws(() => command(s, "a", "start"));
  const active = start();
  active.players.f.team = null;
  assert.throws(() => command(active, "f", "claim"));
  assert.throws(() => command(active, "f", "chat", { text: "Hi" }));
  assert.throws(() => serializeForPlayer(active, "forged"));
  assert.throws(() =>
    command(active, "a", "settings", { gameMode: "cooperative" }),
  );
});
test("host recovery requires 60 seconds offline and transfers no Psychic privileges", () => {
  const s = start();
  playerDisconnected(s, "a", now);
  assert.throws(() => command(s, "b", "claim-host", {}, now + 59000));
  command(s, "b", "claim-host", {}, now + 60001);
  assert.equal(s.players.b.role, "HOST");
  assert(!Object.hasOwn(serializeForPlayer(s, "b"), "target"));
});

test("host can assign a driver and skip missing prediction with zero bonus; malformed player keys fail", () => {
  const s = start();
  command(s, "a", "controller", { playerId: "e" });
  assert.equal(s.controllerId, "e");
  assert.throws(() => command(s, "a", "controller", { playerId: "a" }));
  command(s, "e", "lock", { value: 20, epoch: s.controlEpoch });
  command(s, "a", "skip-prediction", { reason: "Opponents disconnected" });
  assert.equal(s.result?.opponentPoints, 0);
  const lobby = room();
  assert.throws(() =>
    command(lobby, "a", "team", { playerId: "__proto__", team: 0 }),
  );
  assert.throws(() =>
    command(lobby, "a", "transfer-host", { playerId: "constructor" }),
  );
  assert.throws(() => serializeForPlayer(lobby, "__proto__"));
  assert.throws(() => command(lobby, "__proto__", "chat", { text: "Forged" }));
});

test("cooperative result bands include every exact boundary", () => {
  const ranges = [
    [0, 3],
    [4, 6],
    [7, 9],
    [10, 12],
    [13, 15],
    [16, 18],
    [19, 21],
    [22, 24],
    [25, 100],
  ];
  const bands = ranges.map(([a, b]) => {
    assert.equal(coopBand(a), coopBand(b));
    return coopBand(a);
  });
  assert.equal(new Set(bands).size, 9);
});

test("long Unicode history/chat stays below the DO storage limit without losing scores or the current secret", () => {
  const s = start({ targetScore: 200 });
  round(s, 3);
  s.history = Array.from({ length: 100 }, () => ({
    ...structuredClone(s.result!),
    reason: "🧠".repeat(100),
  }));
  s.chat = Array.from({ length: 80 }, (_, i) => ({
    id: String(i),
    playerId: "c",
    at: now + i,
    text: "🧠".repeat(150),
  }));
  s.audit = Array.from({ length: 100 }, () => ({
    at: now,
    actor: "a",
    message: "🧠".repeat(100),
  }));
  s.processed = Array.from(
    { length: 400 },
    (_, i) => `${i}:${"x".repeat(100)}`,
  );
  const scores = [...s.scores],
    target = s.target,
    used = structuredClone(s.used),
    before = structuredClone(s.before);
  compactHistory(s);
  assert(Buffer.byteLength(JSON.stringify(s), "utf8") <= 120000);
  assert.deepEqual(s.scores, scores);
  assert.equal(s.target, target);
  assert.deepEqual(s.used, used);
  assert.deepEqual(s.before, before);
  assert(s.history.length >= 1);
});

test("real room HTTP adapter persists and restores secrets, authenticates tokens, and applies rejected actions atomically", async () => {
  const values = new Map<string, unknown>();
  let alarm: number | null = null;
  const ctx = {
    storage: {
      transaction: async (fn: (tx: DurableObjectStorage) => Promise<unknown>) => fn(ctx.storage),
      get: async (key: string) => structuredClone(values.get(key)),
      put: async (key: string, value: unknown) => {
        values.set(key, structuredClone(value));
      },
      setAlarm: async (at: number) => {
        alarm = at;
      },
      deleteAlarm: async () => {
        alarm = null;
      },
    },
    blockConcurrencyWhile: async <T>(fn: () => Promise<T>) => fn(),
    waitUntil: (p: Promise<unknown>) => {
      void p.catch(() => undefined);
    },
  } as unknown as DurableObjectState;
  let adapter = new WavelengthRoom(ctx, {} as Env);
  const call = (path: string, token?: string, payload?: unknown) =>
    adapter.fetch(
      new Request(`https://room/api/${path}`, {
        method: payload ? "POST" : "GET",
        headers: {
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
          "Content-Type": "application/json",
        },
        ...(payload ? { body: JSON.stringify(payload) } : {}),
      }),
    );
  const created = await call("internal/create", undefined, {
    gameId: "4321",
    hostNickname: "Host",
    settings: {},
  });
  assert.equal(created.status, 200);
  const host = (await created.json()) as {
    playerId: string;
    playerToken: string;
  };
  const participants = [host];
  for (let i = 0; i < 3; i++) {
    const joined = await call("game/4321/join", undefined, {
      nickname: `Guest ${i}`,
    });
    assert.equal(joined.status, 200);
    participants.push((await joined.json()) as typeof host);
  }
  const state = async (token: string) =>
    (await (await call("game/4321/state", token)).json()) as WaveView;
  const a = async (
    seat: typeof host,
    type: string,
    payload: Record<string, unknown> = {},
  ) => {
    const s = await state(seat.playerToken);
    return call("game/4321/action", seat.playerToken, {
      id: crypto.randomUUID(),
      type,
      generation: s.generation,
      roundId: s.roundId,
      phase: s.phase,
      revision: s.revision,
      payload,
    });
  };
  assert.equal((await a(host, "start")).status, 200);
  const original = await state(host.playerToken);
  assert(original.target !== undefined);
  assert(alarm !== null);
  assert.equal((await call("game/4321/state", "fake-token")).status, 401);
  const display = await state(original.displayToken!);
  assert(!Object.hasOwn(display, "target"));
  assert.equal(display.yourRole, "DISPLAY");
  const before = structuredClone(values.get("wavelength"));
  assert.equal(
    (await a(participants[1], "settings", { mode: "written" })).status,
    403,
  );
  assert.deepEqual(values.get("wavelength"), before);
  // New adapter instance represents a DO isolate restart with no in-memory state or sockets.
  adapter = new WavelengthRoom(ctx, {} as Env);
  const restored = await state(host.playerToken);
  assert.equal(restored.target, original.target);
  assert.equal(restored.roundId, original.roundId);
  assert.equal(restored.phase, "DIAL");
  for (const seat of participants.slice(1))
    assert(!Object.hasOwn(await state(seat.playerToken), "target"));
  const driver = participants.find(
    (p) => p.playerId === restored.controllerId,
  )!;
  assert.equal(
    (await a(driver, "lock", { value: 90, epoch: restored.controlEpoch }))
      .status,
    200,
  );
  assert.equal(
    (await a(participants[1], "predict", { side: "left" })).status,
    200,
  );
  assert.equal((await state(host.playerToken)).history.length, 1);
  assert.equal((await a(host, "end")).status, 200);
  assert.equal(alarm, null);
});
