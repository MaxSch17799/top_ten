import test, { before, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import { fixture } from './support/historical-source.js';

let runtime: Miniflare;
let sequence = 0, roomName = '';
beforeEach(() => { roomName = `probe-${++sequence}`; });
before(async () => {
  const bundled = await build({ entryPoints: ['tests/support/runtime-probe.ts'], bundle: true, write: false, format: 'esm', platform: 'browser', target: 'es2022' });
  runtime = new Miniflare(convertV4MiniflareOptions({ name: 'probe', modules: true, script: bundled.outputFiles[0].text, compatibilityDate: '2026-01-14', durableObjects: { ROOMS: { className: 'RuntimeProbe', useSQLite: true } } }));
});
after(async () => { await runtime?.dispose(); });
const call = (route: string, body?: unknown, token?: string) => runtime.dispatchFetch(`http://local.test/${route}`, {
  method: body === undefined ? 'GET' : 'POST', headers: { 'Content-Type': 'application/json', 'X-Probe-Room': roomName, ...(token ? { Authorization: `Bearer ${token}` } : {}) },
  ...(body === undefined ? {} : { body: JSON.stringify(body) }),
});
function liveFixture(name: string) {
  const f = fixture(name), delta = Date.now() - f.now;
  const timestamps = new Set(['at', 'createdAt', 'updatedAt', 'expiresAt', 'deadline', 'pausedAt', 'disconnectedAt', 'nextAt', 'nextRoundAt', 'turnDeadline', 'hostLastSeenAt', 'lastSeenAt', 'lobbyActivityAt', 'roundStartedAt', 'inactivityWarningAt', 'inactivityEndsAt', 'joinedAt']);
  const shift = (value: any): any => Array.isArray(value) ? value.map(shift) : value && typeof value === 'object' ? Object.fromEntries(Object.entries(value).map(([key, v]) => [key, typeof v === 'number' && timestamps.has(key) ? v + delta : shift(v)])) : value;
  f.state = shift(f.state); return f;
}

for (const name of ['just-one', 'sounds-fishy', 'wavelength', 'uno', 'monopoly-deal', 'skyjo', 'flip7']) {
  test(`local SQLite runtime: ${name} survives an unconfirmed committed action and eviction`, async () => {
    const f = liveFixture(name);
    await call('seed', { key: f.key, state: f.state });
    await call('fault', { operation: 'afterCommit' });
    const response = await call(`api/game/1234/${f.command.route}`, f.command.body, f.token);
    assert.equal(response.status, 503);
    const stored = (await (await call('inspect')).json() as any).values[f.key];
    assert.notDeepEqual(stored, f.state);
    await runtime.unsafeEvictDurableObject('probe', 'RuntimeProbe', { name: roomName });
    assert.equal((await call(`api/game/1234/${f.command.route}`, f.command.body, f.token)).status, 200);
    assert.deepEqual((await (await call('inspect')).json() as any).values[f.key], stored);
  });
}

test('local SQLite runtime: a committed decision alarm survives eviction and fires without clients', async () => {
  const f = liveFixture('skyjo'); f.state.pausedAt = null; f.state.deadline = Date.now() + 700;
  await call('seed', { key: f.key, state: f.state });
  assert.equal((await call('api/game/1234/action', f.command.body, f.token)).status, 200);
  await runtime.unsafeEvictDurableObject('probe', 'RuntimeProbe', { name: roomName });
  let saved: any;
  for (let i = 0; i < 100; i++) {
    saved = await (await call('inspect')).json();
    if (saved.values['probe-alarm-runs'] && saved.values.skyjo.pausedAt !== null) break;
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  assert.ok(saved.values['probe-alarm-runs'] >= 1);
  assert.ok(saved.values.skyjo.pausedAt >= f.state.deadline);
  assert.deepEqual(saved.values.skyjo.pending, f.state.pending);
});

test('local SQLite runtime: Top 10 never broadcasts a prompt before it is persisted', async () => {
  const f = liveFixture('top10'); await call('seed', { key: f.key, state: f.state });
  const host = f.state.players[f.state.roundHostPlayerId];
  const connect = async () => {
    const messages: any[] = [];
    const response = await runtime.dispatchFetch(`http://local.test/api/game/1234/ws?token=${host.playerToken}`, { headers: { Upgrade: 'websocket', 'X-Probe-Room': roomName } });
    assert.equal(response.status, 101);
    const ws = response.webSocket!;
    ws.addEventListener('message', event => messages.push(JSON.parse(String(event.data)))); ws.accept();
    for (let i = 0; i < 100 && !messages.length; i++) await new Promise(resolve => setTimeout(resolve, 10));
    return { ws, messages };
  };
  const first = await connect();
  const before = (await (await call('inspect')).json() as any).values.state;
  const promptId = before.roundPromptsByRound[before.round].promptIds[0];
  await call('fault', { operation: 'put' });
  const closed = new Promise(resolve => first.ws.addEventListener('close', resolve));
  first.ws.send(JSON.stringify({ type: 'HOST_CHOOSE_PROMPT', promptId }));
  await closed;
  assert.ok(!first.messages.some(message => message.payload?.chosenPromptId === promptId));
  assert.deepEqual((await (await call('inspect')).json() as any).values.state, before);
  const second = await connect();
  second.ws.send(JSON.stringify({ type: 'HOST_CHOOSE_PROMPT', promptId }));
  for (let i = 0; i < 100 && !second.messages.some(message => message.payload?.chosenPromptId === promptId); i++) await new Promise(resolve => setTimeout(resolve, 10));
  assert.ok(second.messages.some(message => message.payload?.chosenPromptId === promptId));
  assert.equal((await (await call('inspect')).json() as any).values.state.roundPromptsByRound[before.round].chosenPromptId, promptId);
  second.ws.close();
});

for (const name of ['top10', 'just-one', 'sounds-fishy', 'wavelength', 'uno', 'monopoly-deal', 'skyjo', 'flip7']) for (const operation of ['put', 'setAlarm', 'deleteAlarm']) {
  test(`local SQLite runtime: ${name} recovers ${operation} failure without a partial command`, { timeout: 30_000 }, async () => {
    const f = liveFixture(name);
    await call('seed', { key: f.key, state: f.state });
    const viewerToken = f.gameType === 'top10' ? f.state.players[f.actor].playerToken : f.token;
    const read = async () => (await call('api/game/1234/state', undefined, viewerToken)).json() as Promise<any>;
    const before = await read();
    await call('fault', { operation });
    const ending = operation === 'deleteAlarm', top10 = f.gameType === 'top10';
    const host = Object.values(f.state.players).find((p: any) => p.role === 'HOST') as any;
    const token = ending && !top10 ? host.token : f.token;
    const body = ending && !top10 ? { ...f.command.body, type: 'end', payload: {} } : f.command.body;
    const route = `api/game/1234/${ending && top10 ? 'end' : f.command.route}`;
    const response = await call(route, body, token);
    assert.equal(response.status, 503, await response.clone().text());
    assert.equal((await response.json() as any).retryable, true);
    const stored = await (await call('inspect')).json() as any;
    assert.deepEqual(stored.values[f.key], f.state);
    const recovered = await read();
    for (const key of ['phase', 'round', 'revision', 'step', 'yourCard', 'pending', 'settings']) assert.deepEqual(recovered[key], before[key], key);
    await runtime.unsafeEvictDurableObject('probe', 'RuntimeProbe', { name: roomName });
    assert.equal((await call(route, body, token)).status, 200);
    const committed = await read();
    await runtime.unsafeEvictDurableObject('probe', 'RuntimeProbe', { name: roomName });
    if (!top10) assert.equal((await call(route, body, token)).status, 200);
    const retry = await read();
    for (const key of ['phase', 'round', 'revision', 'step', 'yourCard', 'pending', 'settings']) assert.deepEqual(retry[key], committed[key], key);
  });
}
