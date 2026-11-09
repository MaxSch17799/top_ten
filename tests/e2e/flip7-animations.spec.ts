import { test, expect, type Browser, type Page, type WebSocketRoute } from '@playwright/test';
import { createState, serializeForPlayer } from '../../backend-do/src/flip7/engine';
import { DEFAULT_FLIP_SETTINGS, type FlipEvent, type FlipView } from '../../shared/flip7';

const roomCode = '7077';
const now = Date.now();
function initial(): FlipView {
  const host = { playerId: 'anna', nickname: 'Anna', role: 'HOST' as const, token: 'test-anna', connected: true, disconnectedAt: null };
  const s = createState(roomCode, host, 'test-tv', DEFAULT_FLIP_SETTINGS, now);
  s.players.ben = { ...host, playerId: 'ben', nickname: 'Ben', role: 'PLAYER', token: 'test-ben' };
  s.order.push('ben'); s.phase = 'PLAY'; s.round = 1; s.turn = 'ben'; s.dealer = 'anna';
  s.hands = { anna: { cards: [{ id: 'n8', kind: 'number', value: 8 }], status: 'active', flip7: false }, ben: { cards: [{ id: 'n9', kind: 'number', value: 9 }], status: 'active', flip7: false } };
  return serializeForPlayer(s, 'anna', now);
}
async function client(browser: Browser, role: 'normal' | 'party' | 'tv', reducedMotion = false, width?: number) {
  const context = await browser.newContext({ viewport: { width: width ?? (role === 'tv' ? 1920 : 390), height: role === 'tv' ? 1080 : 844 }, reducedMotion: reducedMotion ? 'reduce' : 'no-preference' });
  const page = await context.newPage(); let state = initial(); let socket: WebSocketRoute | undefined;
  await page.clock.install({ time: now });
  if (role === 'party') state.settings.displayMode = 'tv';
  if (role === 'tv') { state.yourRole = 'DISPLAY'; state.yourPlayerId = null; delete state.displayUrl; }
  await page.addInitScript(({ roomCode }) => { localStorage.setItem(`party-session-${roomCode}`, JSON.stringify({ gameId: roomCode, playerId: 'anna', playerToken: 'test-anna', role: 'HOST' })); }, { roomCode });
  await page.route(`**/api/game/${roomCode}/info`, r => r.fulfill({ json: { gameType: 'flip7' } }));
  await page.route(`**/api/game/${roomCode}/state?**`, r => r.fulfill({ json: state }));
  await page.routeWebSocket(`**/api/game/${roomCode}/ws?**`, ws => { socket = ws; ws.send(JSON.stringify({ type: 'STATE', payload: state })); ws.onMessage(message => { if (message === '{"type":"PING"}') ws.send('{"type":"PONG"}'); }); });
  await page.goto(`/g/${roomCode}${role === 'tv' ? '/display#token=test-tv' : ''}`);
  await expect(page.locator('.f7-header')).toBeVisible();
  // Observe delivery on the routed socket after Playwright installs its WebSocket.
  await page.evaluate(() => {
    const dispatch = WebSocket.prototype.dispatchEvent;
    WebSocket.prototype.dispatchEvent = function(event: Event) {
      const result = dispatch.call(this, event);
      if (event instanceof MessageEvent) {
        try {
          const message = JSON.parse(String(event.data));
          if (message.type === 'STATE') document.documentElement.dataset.fixtureSnapshotVersion = String(message.payload.version);
        } catch { /* PONG */ }
      }
      return result;
    };
  });
  // Screenshots and multi-page assertions can outlast a reveal on slower machines.
  // Advance browser time deliberately; keep every reading-time/queue assertion.
  await page.clock.pauseAt(now + 60_000);
  return { context, page, push: async (events: FlipEvent[], change: Partial<FlipView> = {}) => {
    state = { ...state, ...change, events, version: state.version + 1 };
    expect(socket).toBeTruthy(); socket!.send(JSON.stringify({ type: 'STATE', payload: state }));
    // Sending through the route does not mean the browser has received its frame yet.
    await expect.poll(() => page.evaluate(() => document.documentElement.dataset.fixtureSnapshotVersion)).toBe(String(state.version));
    await page.clock.runFor(100); // Deliver the snapshot and its requestAnimationFrame presentation.
  } };
}
function draw(id: number, kind: 'second-chance' | 'freeze' | 'flip-three'): FlipEvent {
  return { id, at: now, actor: 'ben', type: 'draw', message: `Ben flips ${kind}`, card: { id: `action-${id}`, kind, value: 0 } };
}
async function screenshot(page: Page, name: string) {
  await page.screenshot({ path: `test-results/${name}.png`, style: '.f7-action-scene,.f7-action-feature-card,.f7-action-fan > div,.f7-action-crystal,.f7-action-icicles { animation: none !important; }' });
}

test('action reveals reach every normal phone, Party controller and TV, stay readable and survive ordinary updates', async ({ browser }) => {
  const clients = await Promise.all(['normal', 'party', 'tv'].map(role => client(browser, role as 'normal' | 'party' | 'tv')));
  try {
    const event = draw(1, 'second-chance');
    await Promise.all(clients.map(c => c.push([event, { ...event, id: 2, type: 'second-chance', message: 'Ben is protected' }])));
    for (const c of clients) {
      const reveal = c.page.getByRole('status', { name: 'Action card reveal' });
      await expect(reveal).toBeVisible(); await expect(reveal).toContainText('Ben drew'); await expect(reveal).toContainText('Second Chance'); await expect(reveal).toContainText('Ben is protected');
      await expect(reveal.locator('.f7-action-heart')).toHaveText('♥');
      expect(await reveal.evaluate(el => getComputedStyle(el).pointerEvents)).toBe('none');
    }
    await screenshot(clients[1].page, 'flip7-second-chance-controller');
    // Quick flashes were the reported bug: all clients must retain the reveal at 3 seconds.
    await Promise.all(clients.map(c => c.page.clock.runFor(3000)));
    for (const c of clients) {
      await c.push([event, { ...event, id: 2, type: 'second-chance', message: 'Ben is protected' }, { id: 3, at: now, actor: 'ben', type: 'draw', message: 'Ben flips 11', card: { id: 'n11', kind: 'number', value: 11 } }], c === clients[0] ? { settings: { ...DEFAULT_FLIP_SETTINGS, displayMode: 'tv' } } : {});
      if (c === clients[0]) await expect(c.page.locator('.f7-controller-party')).toBeVisible();
      await expect(c.page.locator('.f7-action-reveal')).toBeVisible();
    }
    for (const c of clients) {
      await c.page.clock.runFor(2000);
      await expect(c.page.locator('.f7-action-reveal')).toHaveCount(0);
      // A reconnect-style repeat of the event history must not replay the card.
      await c.push([event]); await expect(c.page.locator('.f7-action-reveal')).toHaveCount(0);
    }
  } finally { await Promise.all(clients.map(c => c.context.close())); }
});

test('rapid chains queue every card, with frost and a three-card fan, and survive a display mode switch', async ({ browser }) => {
  const c = await client(browser, 'tv');
  try {
    const freeze = draw(1, 'freeze'), three = draw(3, 'flip-three');
    await c.push([freeze, { ...freeze, id: 2, type: 'freeze', actor: 'anna', message: 'Anna is frozen · 8 secured' }, three, { ...three, id: 4, type: 'flip-three', message: 'Ben must flip three' }]);
    await expect(c.page.locator('.f7-action-freeze')).toBeVisible(); await expect(c.page.locator('.f7-action-freeze')).toContainText('Anna is frozen · 8 secured');
    await expect(c.page.locator('.f7-action-icicles')).toBeVisible(); await expect(c.page.locator('.f7-action-crystal')).toBeVisible();
    await screenshot(c.page, 'flip7-freeze-tv');
    await c.page.clock.runFor(5000);
    await expect(c.page.locator('.f7-action-flip-three')).toBeVisible(); await expect(c.page.locator('.f7-action-fan .f7-card')).toHaveCount(3);
    await expect(c.page.locator('.f7-action-flip-three')).toContainText('Ben must flip three'); await screenshot(c.page, 'flip7-flip-three-tv');
    await c.push([freeze, { ...freeze, id: 2, type: 'freeze', actor: 'anna', message: 'Anna is frozen · 8 secured' }, three, { ...three, id: 4, type: 'flip-three', message: 'Ben must flip three' }], { settings: { ...DEFAULT_FLIP_SETTINGS, displayMode: 'tv' } });
    await expect(c.page.locator('.f7-action-flip-three')).toBeVisible();
    await c.page.clock.runFor(5000); await expect(c.page.locator('.f7-action-reveal')).toHaveCount(0);
  } finally { await c.context.close(); }
});

test('a deciding player still sees usable target buttons beneath the compact reveal', async ({ browser }) => {
  const c = await client(browser, 'party', false, 320);
  try {
    const action = { ...draw(1, 'flip-three'), actor: 'anna' };
    await c.push([action], { pending: { owner: 'anna', card: action.card!, eligible: ['anna', 'ben'] } });
    await expect(c.page.locator('.f7-action-reveal.is-deciding')).toBeVisible();
    await expect(c.page.locator('.f7-targets button')).toHaveCount(2);
    // Remove entry transforms only for a stable layout measurement/screenshot.
    await c.page.addStyleTag({ content: '.f7-action-scene { animation: none !important; }' });
    const panel = await c.page.locator('.f7-action-panel').boundingBox();
    const target = await c.page.locator('.f7-targets button').first().boundingBox();
    expect(panel!.y + panel!.height).toBeLessThan(target!.y);
    expect(await c.page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await screenshot(c.page, 'flip7-action-choice-phone');
  } finally { await c.context.close(); }
});

test('protection saves and deferred action cancellations are explained; reduced motion retains the full reading time', async ({ browser }) => {
  const c = await client(browser, 'party', true, 320);
  try {
    const chance = draw(1, 'second-chance'); await c.push([chance]);
    await expect(c.page.locator('.f7-action-reveal')).toBeVisible();
    expect(await c.page.locator('.f7-action-heart').evaluate(el => getComputedStyle(el).animationName)).toBe('none');
    await c.page.clock.runFor(3400); await expect(c.page.locator('.f7-action-reveal')).toBeVisible();
    await c.page.clock.runFor(2000); await expect(c.page.locator('.f7-action-reveal')).toHaveCount(0);
    await c.push([chance, { id: 2, at: now, actor: 'ben', type: 'save', message: 'Ben is saved by Second Chance!', card: { id: 'duplicate9', kind: 'number', value: 9 } }]);
    await expect(c.page.locator('.f7-action-reveal')).toContainText('Ben is saved!'); await expect(c.page.locator('.f7-action-reveal')).toContainText('Duplicate 9 discarded');
    expect(await c.page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await c.page.clock.runFor(5000); await expect(c.page.locator('.f7-action-reveal')).toHaveCount(0);
    const freeze = { ...draw(3, 'freeze'), remaining: 1 };
    await c.push([freeze, { id: 4, at: now, actor: 'ben', type: 'bust', message: 'Ben busts' }]);
    await expect(c.page.locator('.f7-action-reveal')).toContainText('Ben busted. This queued action is discarded.');
    // Returning to the lobby clears presentation from the previous game.
    await c.push([freeze], { phase: 'LOBBY' }); await expect(c.page.locator('.f7-action-reveal')).toHaveCount(0);
  } finally { await c.context.close(); }
});
