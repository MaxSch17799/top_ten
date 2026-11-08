import test from "node:test";
import assert from "node:assert/strict";
import {
  buildStatus,
  type UsageMonitorEnv,
} from "../backend-do/src/usageMonitor.js";

const now = Date.parse("2026-10-30T16:00:00Z");
const env = {
  USAGE_WARN_PERCENT: "80",
  USAGE_BLOCK_PERCENT: "95",
} as UsageMonitorEnv;
function fixture() {
  return {
    dayUtc: "2026-10-30",
    gameCreateCount: 0,
    adminLoginCount: 0,
    adminWriteCount: 0,
    d1RowsRead: 0,
    d1RowsWritten: 0,
    activeGames: {} as Record<
      string,
      {
        gameId: string;
        phase: "LOBBY" | "ACTIVE";
        phaseStartedAt: number;
        lastActivityAt: number;
        connectedPlayers: number;
      }
    >,
  };
}
test("expired usage entries cannot indefinitely block new lobbies", () => {
  const s = fixture();
  for (let i = 0; i < 29; i++)
    s.activeGames[String(i)] = {
      gameId: String(i),
      phase: "LOBBY",
      phaseStartedAt: now - 24 * 60 * 60_000,
      lastActivityAt: now - 4 * 60 * 60_000,
      connectedPlayers: 0,
    };
  const v = buildStatus(s, env, now);
  assert.equal(v.nearLimit, false);
  assert.equal(v.hardBlock, false);
  assert.equal(v.counters.activeLobbies, 0);
  assert.equal(v.counters.estimatedDoDurationGbSecondsToday, 0);
});
test("live rooms still count with their phase-specific inactivity bounds", () => {
  const s = fixture();
  s.activeGames.lobby = {
    gameId: "lobby",
    phase: "LOBBY",
    phaseStartedAt: now - 20 * 60_000,
    lastActivityAt: now - 20 * 60_000,
    connectedPlayers: 3,
  };
  s.activeGames.game = {
    gameId: "game",
    phase: "ACTIVE",
    phaseStartedAt: now - 100 * 60_000,
    lastActivityAt: now - 100 * 60_000,
    connectedPlayers: 5,
  };
  const v = buildStatus(s, env, now);
  assert.equal(v.counters.activeLobbies, 1);
  assert.equal(v.counters.activeGames, 1);
  assert.equal(v.counters.connectedPlayersNow, 8);
  assert.equal(v.counters.estimatedDoDurationGbSecondsToday, 900);
  assert.equal(buildStatus(s, env, now + 20 * 60_000).counters.activeGames, 0);
});
test("database usage and real active duration still enforce configured guards", () => {
  const s = fixture();
  s.d1RowsRead = 4_000_000;
  assert.equal(buildStatus(s, env, now).nearLimit, true);
  assert.equal(buildStatus(s, env, now).hardBlock, false);
  s.d1RowsRead = 4_750_000;
  assert.equal(buildStatus(s, env, now).hardBlock, true);
  s.d1RowsRead = 0;
  s.d1RowsWritten = 95_000;
  assert.equal(buildStatus(s, env, now).hardBlock, true);
  s.d1RowsWritten = 0;
  for (let i = 0; i < 4; i++)
    s.activeGames[String(i)] = {
      gameId: String(i),
      phase: "ACTIVE",
      phaseStartedAt: now - 7 * 60 * 60_000,
      lastActivityAt: now - 1_000,
      connectedPlayers: 2,
    };
  assert.equal(buildStatus(s, env, now).nearLimit, true);
  assert.equal(buildStatus(s, env, now).hardBlock, true);
});
