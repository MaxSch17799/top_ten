import test from 'node:test';
import assert from 'node:assert/strict';
import { GAME_TYPES, isGameType, isStandaloneGameType } from '../shared/games.js';
import { games } from '../frontend/src/lib/games.js';

test('stable game IDs preserve the API allowlist and Top 10 creation fallback', () => {
  const legacy = ['top10', 'just-one', 'sounds-fishy', 'wavelength', 'uno', 'monopoly-deal', 'flip7', 'skyjo'];
  assert.deepEqual([...GAME_TYPES], legacy);
  for (const id of legacy) {
    assert.equal(isGameType(id), true);
    assert.equal(isStandaloneGameType(id), id !== 'top10');
  }
  for (const value of [undefined, null, '', 'TOP10', 'unknown', 'constructor', '__proto__', 0, [], {}]) {
    assert.equal(isGameType(value), false);
    assert.equal(isStandaloneGameType(value), false);
  }
  // The HTTP boundary historically coerces gameType before checking the allowlist.
  for (const value of [...legacy, undefined, null, ['skyjo'], {}]) {
    assert.equal(isGameType(String(value)), legacy.includes(String(value)));
    assert.equal(isStandaloneGameType(String(value)), legacy.slice(1).includes(String(value)));
  }
});

test('every registered game has exactly one distinct homepage entry and URL', () => {
  assert.deepEqual(games.map(g => g.id).sort(), [...GAME_TYPES].sort());
  assert.equal(new Set(games.map(g => g.path)).size, games.length);
  for (const game of games) {
    assert.equal(game.path, `/${game.id}`);
    for (const text of [game.title, game.description, game.players, game.mark, game.kind]) assert.ok(text.trim());
  }
});
