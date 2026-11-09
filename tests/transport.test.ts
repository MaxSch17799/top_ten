import test from 'node:test';
import assert from 'node:assert/strict';
import { addSocket, removeSocket, broadcastViews, roomJson } from '../backend-do/src/platform/transport.js';

function socket() {
  const sent: string[] = [], closed: unknown[][] = [];
  return { sent, closed, ws: { send: (value: string) => sent.push(value), close: (...args: unknown[]) => closed.push(args) } as unknown as WebSocket };
}
test('broadcasts project once per identity, never share private views, and remove revoked viewers', () => {
  const alice = socket(), secondTab = socket(), bob = socket(), tv = socket(), removed = socket();
  const clients = new Map([['alice', new Set([alice.ws, secondTab.ws])], ['bob', new Set([bob.ws])], ['$display', new Set([tv.ws])], ['removed', new Set([removed.ws])]]);
  const calls: string[] = [];
  broadcastViews(clients, id => { calls.push(id); return { privateCard: id === 'alice' ? 7 : null }; }, id => id !== 'removed');
  assert.deepEqual(calls, ['alice', 'bob', '$display']);
  assert.deepEqual(alice.sent, secondTab.sent);
  assert.equal(JSON.parse(alice.sent[0]).payload.privateCard, 7);
  for (const viewer of [bob, tv]) assert.equal(JSON.parse(viewer.sent[0]).payload.privateCard, null);
  assert.deepEqual(removed.closed, [[1008, 'Removed from lobby']]);
  assert.equal(clients.has('removed'), false);
});
test('socket membership replaces the oldest fourth tab without changing another identity', () => {
  const clients = new Map<string, Set<WebSocket>>(), tabs = Array.from({ length: 4 }, socket), other = socket();
  addSocket(clients, 'bob', other.ws);
  for (const tab of tabs) addSocket(clients, 'alice', tab.ws);
  assert.deepEqual(tabs[0].closed, [[1000, 'Replaced']]);
  assert.deepEqual([...clients.get('alice')!], tabs.slice(1).map(t => t.ws));
  assert.deepEqual([...clients.get('bob')!], [other.ws]);
});
test('room JSON preserves modern protocol headers and empty 204 bodies', async () => {
  const response = roomJson(new Request('https://local.test', { headers: { Origin: 'https://friends.test' } }), null, 204);
  assert.equal(response.status, 204); assert.equal(await response.text(), '');
  assert.equal(response.headers.get('Access-Control-Allow-Origin'), 'https://friends.test');
  assert.equal(response.headers.get('Cache-Control'), 'no-store');
});

test('late closes from invalidated sockets cannot change replacement membership', () => {
  const clients = new Map<string, Set<WebSocket>>(), old = socket(), fresh = socket();
  const previous = addSocket(clients, 'alice', old.ws);
  previous.clear(); clients.clear();
  const current = addSocket(clients, 'alice', fresh.ws);
  assert.equal(removeSocket(clients, 'alice', previous, old.ws), false);
  assert.deepEqual([...current], [fresh.ws]);
  assert.equal(removeSocket(clients, 'alice', current, fresh.ws), true);
  assert.equal(current.size, 0);
});
