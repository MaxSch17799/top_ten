import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { readUnoProfiles, writeUnoProfiles } from '../frontend/src/lib/unoProfiles.js';
import { loadDealProfiles, saveDealProfiles } from '../frontend/src/lib/dealProfiles.js';
import { loadFlipProfiles, saveFlipProfiles } from '../frontend/src/lib/flipProfiles.js';
import { loadSkyProfiles, saveSkyProfiles } from '../frontend/src/lib/skyProfiles.js';
import { loadSessionForGame, saveSession, clearSession } from '../frontend/src/lib/session.js';

const frozen = JSON.parse(readFileSync(new URL('./fixtures/browser-storage.json', import.meta.url), 'utf8'));
const profiles = [
  { name: 'UNO', key: 'game-night-uno-profiles-v1', load: readUnoProfiles, save: writeUnoProfiles, limit: 50 },
  { name: 'Deal', key: 'game-night-deal-profiles-v1', load: loadDealProfiles, save: saveDealProfiles, limit: 30 },
  { name: 'Flip 7', key: 'game-night-flip7-profiles-v1', load: loadFlipProfiles, save: saveFlipProfiles, limit: 30 },
  { name: 'Skyjo', key: 'game-night-skyjo-profiles-v1', load: loadSkyProfiles, save: saveSkyProfiles, limit: 30 },
];

function browser(t: any) {
  const data = new Map<string, string>();
  let unavailable = false;
  const storage = {
    getItem: (key: string) => { if (unavailable) throw new Error('Storage unavailable'); return data.get(key) ?? null; },
    setItem: (key: string, value: string) => { if (unavailable) throw new Error('Storage unavailable'); data.set(key, value); },
    removeItem: (key: string) => { if (unavailable) throw new Error('Storage unavailable'); data.delete(key); },
  };
  // Restore existing descriptors too, including Node's optional native localStorage getter.
  for (const [key, value] of Object.entries({ localStorage: storage, window: { localStorage: storage } })) {
    const descriptor = Object.getOwnPropertyDescriptor(globalThis, key);
    Object.defineProperty(globalThis, key, { configurable: true, value });
    t.after(() => { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key); });
  }
  return { data, fail: () => { unavailable = true; } };
}

for (const p of profiles) {
  test(`${p.name}: frozen profiles preserve key, validation, trimming, duplicates and descriptions`, t => {
    const b = browser(t); b.data.set(p.key, JSON.stringify(frozen.profiles));
    const result = p.load();
    assert.deepEqual(result.map(v => v.id), p.name === 'UNO' ? ['custom-first', 'custom-last'] : ['custom-first', 'custom-first', 'custom-last']);
    assert.equal(result[0].name, p.name === 'UNO' ? 'First profile' : '  First profile  ');
    assert.equal((result[0] as any).description, p.name === 'UNO' ? 'Your saved house rules.' : p.name === 'Deal' ? 'Saved on this browser' : undefined);
    assert.ok(result[0].rules);
    for (const malformed of ['null', '{}', '"string"', '{not json']) {
      b.data.set(p.key, malformed); assert.deepEqual(p.load(), []);
    }
    b.fail(); assert.deepEqual(p.load(), []);
    // Writers currently report storage errors to callers. A refactor must not silently swallow them.
    assert.throws(() => p.save([]), /Storage unavailable/);
  });

  test(`${p.name}: limits apply before validation and saved bytes remain compatible`, t => {
    const b = browser(t), many = Array.from({ length: 60 }, (_, i) => ({ id: `custom-${i}`, name: `Profile ${i}`, rules: {} }));
    b.data.set(p.key, JSON.stringify(many)); assert.equal(p.load().length, p.limit);
    b.data.set(p.key, JSON.stringify([...Array(p.limit).fill(null), many[0]])); assert.deepEqual(p.load(), []);
    const accepted = many.slice(0, 2);
    p.save(accepted as any);
    assert.equal(b.data.get(p.key), JSON.stringify(accepted));
    p.save(many as any); assert.equal(JSON.parse(b.data.get(p.key)!).length, p.limit);
    b.data.set(p.key, JSON.stringify([{ ...many[0], id: 'custom-' + 'a'.repeat(100), name: 'N'.repeat(60) }]));
    assert.equal(p.load()[0].id.length, 80); assert.equal(p.load()[0].name.length, 40);
  });
}

test('legacy and per-room sessions preserve precedence, isolated rooms and refresh behavior', t => {
  const b = browser(t), { session, otherSession } = frozen;
  b.data.set('top10-top10-session', JSON.stringify(session));
  assert.deepEqual(loadSessionForGame('1234'), session); assert.equal(loadSessionForGame('5678'), null);
  saveSession(otherSession);
  assert.equal(b.data.get('top10-top10-session'), JSON.stringify(otherSession));
  assert.equal(b.data.get('party-session-5678'), JSON.stringify(otherSession));
  saveSession(session);
  assert.deepEqual(loadSessionForGame('1234'), session); assert.deepEqual(loadSessionForGame('5678'), otherSession);
  // Current clearSession clears only the legacy/current key; per-room recovery survives.
  clearSession(); assert.equal(b.data.has('top10-top10-session'), false);
  assert.deepEqual(loadSessionForGame('1234'), session); assert.deepEqual(loadSessionForGame('5678'), otherSession);
});

test('malformed per-room sessions do not fall back to a different legacy identity; storage errors propagate', t => {
  const b = browser(t);
  b.data.set('top10-top10-session', JSON.stringify(frozen.session));
  for (const raw of ['{broken', JSON.stringify(frozen.otherSession)]) {
    b.data.set('party-session-1234', raw); assert.equal(loadSessionForGame('1234'), null);
  }
  b.fail(); assert.throws(() => loadSessionForGame('1234'), /Storage unavailable/);
  assert.throws(() => saveSession(frozen.session), /Storage unavailable/);
});
