import { test, expect, type APIRequestContext, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { CLASSIC_FLIP_RULES, DEFAULT_FLIP_SETTINGS, type FlipView, type FlipRules } from '../../shared/flip7';

const backend = process.env.FLIP7_TEST_BACKEND ?? 'http://127.0.0.1:8787';
type Session = { gameId: string; playerId: string; playerToken: string; role: 'HOST' | 'PLAYER'; hostToken?: string };
const tokenFrom = (url: string) => new URLSearchParams(url.split('#')[1]).get('token')!;
async function view(api: APIRequestContext, s: Session): Promise<FlipView> {
  const r = await api.get(`${backend}/api/game/${s.gameId}/state?token=${s.playerToken}`); expect(r.status()).toBe(200); return r.json();
}
async function act(api: APIRequestContext, session: Session, type: string, payload: Record<string, unknown> = {}) {
  const s = await view(api, session);
  const r = await api.post(`${backend}/api/game/${s.gameId}/action`, { headers: { Authorization: `Bearer ${session.playerToken}` }, data: { id: crypto.randomUUID(), type, payload, generation: s.generation, revision: s.revision, round: s.round } });
  expect(r.status(), await r.text()).toBe(200);
}
async function create(api: APIRequestContext, n = 3, rules: Partial<FlipRules> = {}) {
  const r = await api.post(`${backend}/api/game/create`, { data: { gameType: 'flip7', hostNickname: 'Anna', settings: { ...DEFAULT_FLIP_SETTINGS, autoNext: false, rules: { ...CLASSIC_FLIP_RULES, freeze: 0, flipThree: 0, secondChance: 0, ...rules } } } });
  expect(r.status(), await r.text()).toBe(200); const host = { ...await r.json(), role: 'HOST' } as Session;
  const sessions = [host];
  for (let i = 1; i < n; i++) { const j = await api.post(`${backend}/api/game/${host.gameId}/join`, { data: { nickname: ['Anna', 'Ben', 'Clara', 'Diego', 'Eva', 'Finn', 'Grace', 'Hugo', 'Iris', 'Jack', 'Kai', 'Lena'][i] } }); expect(j.status()).toBe(200); sessions.push({ ...await j.json(), gameId: host.gameId, role: 'PLAYER' }); }
  return sessions;
}
async function openPlayer(browser: Browser, s: Session, width = 390): Promise<{ context: BrowserContext; page: Page }> {
  const context = await browser.newContext({ viewport: { width, height: 844 } }), page = await context.newPage();
  await page.goto('/'); await page.evaluate(s => { localStorage.setItem('top10-top10-session', JSON.stringify(s)); localStorage.setItem(`party-session-${s.gameId}`, JSON.stringify(s)); }, s);
  await page.goto(`/g/${s.gameId}`); await expect(page.getByRole('heading', { name: 'Good friends.' })).toBeVisible(); return { context, page };
}
async function waitDecision(api: APIRequestContext, s: Session) {
  await expect.poll(async () => { const v = await view(api, s); return v.phase === 'PLAY' && !v.dealing && !v.forced && !!(v.turn || v.pending); }, { timeout: 20000 }).toBe(true);
  return view(api, s);
}
function gameplay(s: FlipView) { return { phase: s.phase, revision: s.revision, round: s.round, turn: s.turn, dealer: s.dealer, pending: s.pending, forced: s.forced, players: s.players.map(p => ({ ...p, connected: undefined })), deadline: s.deadline, deckCount: s.deckCount, discardCount: s.discardCount }; }
async function mode(page: Page, value: string) {
  const menu = page.locator('.f7-host-menu'); if ((await menu.getAttribute('open')) === null) await menu.locator('summary').click();
  await page.getByLabel('Display Mode', { exact: true }).selectOption(value);
}
async function noOverflow(page: Page) { expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true); }

test('create through homepage, invite, join, and save/edit/duplicate/delete a house profile', async ({ page, browser, request }) => {
  await page.goto('/'); await page.getByRole('link', { name: /Flip 7/ }).click(); await page.getByLabel('Your nickname').fill('Anna'); await page.getByRole('button', { name: 'Create Flip 7 lobby' }).click();
  await expect(page.getByRole('button', { name: 'Start Flip 7' })).toBeVisible();
  const host = await page.evaluate(() => JSON.parse(localStorage.getItem('top10-top10-session')!)) as Session;
  const guest = await browser.newContext();
  try {
    await page.getByRole('button', { name: 'Invite players / QR' }).click(); await expect(page.getByAltText('Join link QR code')).toBeVisible(); await page.getByRole('button', { name: 'Close invite panel' }).click();
    const p = await guest.newPage(); await p.goto(`/g/${host.gameId}`); await p.getByLabel('Your nickname').fill('Ben'); await p.getByRole('button', { name: 'Join lobby' }).click(); await expect(page.locator('.f7-lobby-players')).toContainText('Ben');
    await page.getByText('Advanced settings · unofficial options', { exact: true }).click(); await page.getByLabel('Winning score', { exact: true }).fill('150'); await page.getByLabel('Flip bonus', { exact: true }).fill('20');
    await page.getByText('Saved profiles', { exact: true }).click(); await page.getByLabel('Profile name', { exact: true }).fill('Friday night'); await page.getByRole('button', { name: 'Save / update profile' }).click();
    await page.getByRole('button', { name: 'Apply rules', exact: true }).click(); await expect.poll(async () => (await view(request, host)).settings.rules.target).toBe(150);
    await page.reload(); await page.getByText('Saved profiles', { exact: true }).click(); await page.getByLabel('Profile name', { exact: true }).fill('Friday remix'); await page.getByRole('button', { name: 'Duplicate profile', exact: true }).click();
    await expect(page.getByRole('option', { name: 'Friday remix' })).toHaveCount(1); await page.getByLabel('Profile name', { exact: true }).fill('Saturday night'); await page.getByRole('button', { name: 'Save / update profile' }).click();
    await expect(page.getByRole('option', { name: 'Saturday night' })).toHaveCount(1); await page.getByRole('button', { name: 'Delete profile', exact: true }).click(); await expect(page.getByRole('option', { name: 'Saturday night' })).toHaveCount(0);
    await noOverflow(page);
  } finally { await act(request, host, 'end'); await guest.close(); }
});

test('three phones show the table, TV connects without a seat, controllers drive TV, live modes and reconnect preserve progress', async ({ browser, request }) => {
  const sessions = await create(request), clients = await Promise.all(sessions.map(s => openPlayer(browser, s)));
  const tvContext = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
  const host = sessions[0], page = clients[0].page;
  try {
    const errors: string[] = []; clients.forEach(c => c.page.on('pageerror', e => errors.push(e.message)));
    await page.getByRole('button', { name: 'Start Flip 7' }).click(); await waitDecision(request, host);
    for (const c of clients) { await expect(c.page.locator('.f7-seat')).toHaveCount(3); await expect(c.page.getByRole('region', { name: 'Complete game table' })).toBeVisible(); await noOverflow(c.page); }
    const normal = await view(request, host);
    await page.screenshot({ path: 'test-results/flip7-normal-phone.png', fullPage: true });
    await mode(page, 'tv'); await expect.poll(async () => (await view(request, host)).settings.displayMode).toBe('tv');
    const switched = await view(request, host); expect(gameplay(switched)).toEqual(gameplay(normal));
    for (const c of clients) { await expect(c.page.locator('.f7-controller-party')).toBeVisible(); await expect(c.page.locator('.f7-table')).toHaveCount(0); }
    await clients[sessions.findIndex(p => p.playerId === normal.turn)].page.screenshot({ path: 'test-results/flip7-party-phone.png', fullPage: true });
    const tv = await tvContext.newPage(); await tv.goto(switched.displayUrl!); await expect(tv.locator('.f7-seat')).toHaveCount(3); await expect(tv.getByText('Host controls', { exact: true })).toHaveCount(0); await expect(tv.getByRole('button', { name: /HIT/ })).toHaveCount(0);
    const before = await view(request, host), current = sessions.findIndex(p => p.playerId === before.turn);
    await clients[current].page.getByRole('button', { name: /STAY/ }).click(); await expect.poll(async () => (await view(request, host)).players[current].hand.status).toBe('stayed');
    await expect(tv.locator(`[data-flip-player="${before.turn}"]`)).toHaveClass(/is-stayed/);
    const next = await view(request, host), nextIndex = sessions.findIndex(p => p.playerId === next.turn), count = next.deckCount;
    await clients[nextIndex].page.getByRole('button', { name: /HIT/ }).click(); await expect.poll(async () => (await view(request, host)).deckCount).toBe(count - 1);
    const beforeRefresh = await view(request, host); await tv.reload(); await expect(tv.locator('.f7-seat')).toHaveCount(3); expect(gameplay(await view(request, host))).toEqual(gameplay(beforeRefresh));
    await clients[0].page.getByRole('button', { name: 'Peek at the full table' }).click(); await expect(page.locator('.f7-seat')).toHaveCount(3); await page.getByRole('button', { name: 'Back to controller' }).click();
    const displayToken = tokenFrom(switched.displayUrl!); const denied = await request.post(`${backend}/api/game/${host.gameId}/action`, { headers: { Authorization: `Bearer ${displayToken}` }, data: { id: crypto.randomUUID(), type: 'end', generation: switched.generation, revision: switched.revision, round: switched.round } }); expect(denied.status()).toBe(403);
    await tv.close(); const disconnected = await view(request, host); await mode(page, 'normal'); await expect(page.locator('.f7-seat')).toHaveCount(3); expect(gameplay(await view(request, host))).toEqual(gameplay(disconnected));
    await clients[1].page.reload(); await expect(clients[1].page.locator('.f7-seat')).toHaveCount(3); expect((await view(request, sessions[1])).yourPlayerId).toBe(sessions[1].playerId);
    await noOverflow(page); expect(errors).toEqual([]);
  } finally { await act(request, host, 'end'); await Promise.all(clients.map(c => c.context.close())); await tvContext.close(); }
});

test('pending action target survives both display switches and is playable on a phone controller', async ({ browser, request }) => {
  const sessions = await create(request, 4, { freeze: 9, flipThree: 9, secondChance: 9, target: 10000 });
  const clients = await Promise.all(sessions.map(s => openPlayer(browser, s))); const host = sessions[0];
  try {
    await act(request, host, 'start'); let pending: FlipView | undefined;
    for (let i = 0; i < 250; i++) {
      const s = await view(request, host);
      if (s.pending) { pending = s; break; }
      if (s.phase === 'RESULTS') await act(request, host, 'next-round');
      else if (s.turn && !s.dealing && !s.forced) await act(request, sessions.find(p => p.playerId === s.turn)!, 'hit');
      else await new Promise(resolve => setTimeout(resolve, 150));
    }
    expect(pending?.pending).toBeTruthy(); const before = gameplay(pending!);
    await mode(clients[0].page, 'tv'); await expect.poll(async () => (await view(request, host)).settings.displayMode).toBe('tv'); expect(gameplay(await view(request, host))).toEqual(before);
    await mode(clients[0].page, 'normal'); await expect.poll(async () => (await view(request, host)).settings.displayMode).toBe('normal'); expect(gameplay(await view(request, host))).toEqual(before);
    await mode(clients[0].page, 'tv'); const actor = sessions.findIndex(p => p.playerId === pending!.pending!.owner); const chooser = clients[actor].page;
    await expect(chooser.locator('.f7-targets')).toBeVisible(); await chooser.locator('.f7-targets button').first().click();
    await expect.poll(async () => (await view(request, host)).pending?.card.id).not.toBe(pending!.pending!.card.id);
  } finally { await act(request, host, 'end'); await Promise.all(clients.map(c => c.context.close())); }
});

test('1080p, 720p and twelve-player TV fit the screen; small phones and reduced motion remain usable', async ({ browser, request }) => {
  const sessions = await create(request, 12), host = sessions[0], c = await openPlayer(browser, host, 320);
  const context = await browser.newContext({ viewport: { width: 1920, height: 1080 }, reducedMotion: 'reduce' });
  try {
    await act(request, host, 'start'); await waitDecision(request, host); await noOverflow(c.page);
    const tv = await context.newPage(); await tv.goto((await view(request, host)).displayUrl!); await expect(tv.locator('.f7-seat')).toHaveCount(12);
    for (const size of [{ width: 1920, height: 1080 }, { width: 1280, height: 720 }]) {
      await tv.setViewportSize(size); const bounds = await tv.locator('.f7-seats').boundingBox(); expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(size.height); await noOverflow(tv);
      for (const seat of await tv.locator('.f7-seat').all()) { const b = await seat.boundingBox(); expect(b!.height).toBeGreaterThan(100); }
      await tv.screenshot({ path: `test-results/flip7-tv-${size.height}.png` });
    }
    await mode(c.page, 'tv'); await expect(c.page.locator('.f7-controller-party')).toBeVisible(); await noOverflow(c.page);
    await act(request, host, 'pause'); await expect(c.page.getByRole('heading', { name: 'Game paused', exact: true })).toBeVisible(); await act(request, host, 'resume');
    const display = await request.get(`${backend}/api/game/${host.gameId}/state?token=${tokenFrom((await view(request, host)).displayUrl!)}`); expect((await display.json()).players).toHaveLength(12);
  } finally { await act(request, host, 'end'); await c.context.close(); await context.close(); }
});

test('host can open a TV window, play as a controller, finish rounds and show final results', async ({ browser, request }) => {
  const sessions = await create(request, 2, { target: 1 }), clients = await Promise.all(sessions.map(s => openPlayer(browser, s)));
  const host = sessions[0], page = clients[0].page;
  try {
    await mode(page, 'tv'); const popup = page.waitForEvent('popup'); await page.getByRole('link', { name: /Open TV Display/ }).click(); const tv = await popup; await expect(tv.locator('.f7-lobby-players > div')).toHaveCount(2);
    await page.getByRole('button', { name: 'Start Flip 7' }).click(); await waitDecision(request, host);
    for (let i = 0; i < 50; i++) {
      const s = await view(request, host); if (s.phase === 'COMPLETED') break;
      if (s.phase === 'RESULTS') { await act(request, host, 'next-round'); await waitDecision(request, host); continue; }
      const index = sessions.findIndex(p => p.playerId === s.turn); expect(index).toBeGreaterThanOrEqual(0);
      const own = s.players[index]; await clients[index].page.getByRole('button', { name: own.hand.cards.length ? /STAY/ : /HIT/ }).click();
      await expect.poll(async () => (await view(request, host)).revision).toBeGreaterThan(s.revision);
    }
    await expect(tv.getByRole('region', { name: 'Final scoreboard' })).toBeVisible(); expect((await view(request, host)).winner).toBeTruthy();
    const menu = page.locator('.f7-host-menu'); if ((await menu.getAttribute('open')) === null) await menu.locator('summary').click();
    await page.getByRole('button', { name: 'Restart game', exact: true }).click(); await page.getByRole('button', { name: 'Confirm restart', exact: true }).click(); await expect.poll(async () => (await view(request, host)).round).toBe(1);
    await tv.close();
  } finally { await act(request, host, 'end'); await Promise.all(clients.map(c => c.context.close())); }
});
