import { test, expect, type APIRequestContext, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { CLASSIC_SKY_RULES, DEFAULT_SKY_SETTINGS, type SkyRules, type SkyView } from '../../shared/skyjo';

const backend = process.env.SKYJO_TEST_BACKEND ?? 'http://127.0.0.1:8787';
type Session = { gameId: string; playerId: string; playerToken: string; role: 'HOST' | 'PLAYER'; hostToken?: string };
const names = ['Anna', 'Ben', 'Clara', 'Diego', 'Eva', 'Finn', 'Grace', 'Hugo'];
async function view(api: APIRequestContext, s: Session): Promise<SkyView> {
  const r = await api.get(`${backend}/api/game/${s.gameId}/state?token=${s.playerToken}`); expect(r.status()).toBe(200); return r.json();
}
async function act(api: APIRequestContext, session: Session, type: string, payload: Record<string, unknown> = {}) {
  const s = await view(api, session);
  const r = await api.post(`${backend}/api/game/${s.gameId}/action`, { headers: { Authorization: `Bearer ${session.playerToken}` }, data: { id: crypto.randomUUID(), type, payload, generation: s.generation, revision: s.revision, round: s.round } });
  expect(r.status(), await r.text()).toBe(200);
}
async function create(api: APIRequestContext, n = 2, rules: Partial<SkyRules> = {}) {
  const r = await api.post(`${backend}/api/game/create`, { data: { gameType: 'skyjo', hostNickname: names[0], settings: { ...DEFAULT_SKY_SETTINGS, autoNext: false, rules: { ...CLASSIC_SKY_RULES, ...rules } } } });
  expect(r.status(), await r.text()).toBe(200); const host = { ...await r.json(), role: 'HOST' } as Session, sessions = [host];
  for (let i = 1; i < n; i++) { const j = await api.post(`${backend}/api/game/${host.gameId}/join`, { data: { nickname: names[i] } }); expect(j.status()).toBe(200); sessions.push({ ...await j.json(), gameId: host.gameId, role: 'PLAYER' }); }
  return sessions;
}
async function openPlayer(browser: Browser, s: Session, width = 390, height = 844) {
  const context = await browser.newContext({ viewport: { width, height }, hasTouch: true, isMobile: true }), page = await context.newPage();
  await page.goto('/'); await page.evaluate(s => localStorage.setItem(`party-session-${s.gameId}`, JSON.stringify(s)), s); await page.goto(`/g/${s.gameId}`);
  await expect(page.getByRole('heading', { name: 'A little mystery.' })).toBeVisible(); return { context, page };
}
async function start(api: APIRequestContext, sessions: Session[]) {
  await act(api, sessions[0], 'start'); for (const s of sessions) for (const index of [0, 1]) await act(api, s, 'setup', { index });
}
async function turn(api: APIRequestContext, sessions: Session[]) {
  const v = await view(api, sessions[0]), s = sessions.find(p => p.playerId === v.turn)!;
  await act(api, s, 'draw'); const own = (await view(api, s)).players.find(p => p.playerId === s.playerId)!;
  if (own.hidden) { await act(api, s, 'discard'); await act(api, s, 'reveal', { index: own.grid.findIndex(c => c?.value === null) }); }
  else { await act(api, s, 'keep'); await act(api, s, 'replace', { index: own.grid.findIndex(Boolean) }); }
}
async function noOverflow(page: Page) { expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true); }
const focus = (page: Page) => page.locator('.sky-player-chip[aria-pressed="true"]');
function gameplay(s: SkyView) { return { phase: s.phase, step: s.step, revision: s.revision, round: s.round, turn: s.turn, pending: s.pending, yourCard: s.yourCard, players: s.players.map(p => ({ ...p, connected: undefined })), deckCount: s.deckCount, discardTop: s.discardTop, deadline: s.deadline }; }
async function mode(page: Page, value: string) {
  const menu = page.locator('.sky-host-menu'); if (await menu.getAttribute('open') === null) await menu.locator('summary').click(); await page.getByLabel('Display Mode', { exact: true }).selectOption(value);
}
async function swipe(context: BrowserContext, page: Page, startX: number, endX: number, y: number) {
  const cdp = await context.newCDPSession(page);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: startX, y }] });
  for (let i = 1; i <= 8; i++) await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: startX + (endX - startX) * i / 8, y }] });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }); await cdp.detach();
}

test('Skyjo homepage, QR invitations, joining, and persistent profile create/edit/duplicate/delete', async ({ page, browser, request }) => {
  await page.goto('/'); await page.getByRole('link', { name: /Skyjo/ }).click(); await page.getByLabel('Your nickname').fill('Anna'); await page.getByRole('button', { name: 'Create Skyjo lobby' }).click();
  await expect(page.getByRole('button', { name: 'Start Skyjo' })).toBeVisible(); const host = await page.evaluate(() => JSON.parse(localStorage.getItem('top10-top10-session')!)) as Session;
  const guest = await browser.newContext();
  try {
    await page.getByRole('button', { name: 'Invite players / QR' }).click(); await expect(page.getByAltText('Join link QR code')).toBeVisible(); await page.getByRole('button', { name: 'Close invite panel' }).click();
    const p = await guest.newPage(); await p.goto(`/g/${host.gameId}`); await p.getByLabel('Your nickname').fill('Ben'); await p.getByRole('button', { name: 'Join lobby' }).click(); await expect(page.locator('.sky-lobby-players')).toContainText('Ben');
    await page.getByText('Advanced settings · house rules', { exact: true }).click(); await page.getByLabel('Game-end score', { exact: true }).fill('75');
    await page.getByText('Saved profiles', { exact: true }).click(); await page.getByLabel('Profile name', { exact: true }).fill('Friday night'); await page.getByRole('button', { name: 'Save / update profile' }).click(); await page.getByRole('button', { name: 'Apply rules', exact: true }).click();
    await expect.poll(async () => (await view(request, host)).settings.rules.target).toBe(75); await page.reload();
    await page.getByText('Saved profiles', { exact: true }).click(); await expect(page.getByLabel('Profile name', { exact: true })).toHaveValue('Friday night'); await page.getByLabel('Profile name', { exact: true }).fill('Saturday night'); await page.getByRole('button', { name: 'Save / update profile' }).click(); await expect(page.getByRole('option', { name: 'Saturday night' })).toHaveCount(1);
    await page.getByLabel('Profile name', { exact: true }).fill('Sunday remix'); await page.getByRole('button', { name: 'Duplicate profile' }).click(); await expect(page.getByRole('option', { name: 'Sunday remix' })).toHaveCount(1); await page.getByRole('button', { name: 'Delete profile' }).click(); await expect(page.getByRole('option', { name: 'Sunday remix' })).toHaveCount(0); await noOverflow(page);
  } finally { await act(request, host, 'end'); await guest.close(); }
});

test('two independent phones play with private draws, easy grid targets, turn following and stable manual browsing', async ({ browser, request }) => {
  const sessions = await create(request), clients = await Promise.all(sessions.map(s => openPlayer(browser, s))), errors: string[] = [];
  clients.forEach(c => c.page.on('pageerror', e => errors.push(e.message)));
  try {
    await clients[0].page.getByRole('button', { name: 'Start Skyjo' }).click();
    for (const c of clients) {
      const grid = c.page.locator('.sky-slide:not([inert])'); await expect(grid.locator('.is-target')).toHaveCount(12);
      await grid.getByRole('button', { name: /Reveal Row 1, column 1/ }).click(); await grid.getByRole('button', { name: /Reveal Row 1, column 2/ }).click();
    }
    await expect.poll(async () => (await view(request, sessions[0])).phase).toBe('PLAY');
    const v = await view(request, sessions[0]), i = sessions.findIndex(s => s.playerId === v.turn), current = clients[i].page, other = clients[1 - i].page;
    await expect(focus(current)).toContainText(names[i]); await current.getByRole('button', { name: 'Draw a hidden card' }).click(); await expect(current.locator('.sky-held')).toBeVisible(); await expect(other.locator('.sky-held')).toHaveCount(0);
    await current.getByRole('button', { name: 'Keep & swap' }).click(); await expect(current.locator('.sky-slide:not([inert]) .is-target')).toHaveCount(12); await current.locator('.sky-slide:not([inert])').getByRole('button', { name: /Replace Row 2, column 3/ }).click();
    await expect.poll(async () => (await view(request, sessions[0])).turn).not.toBe(v.turn);
    await other.getByRole('button', { name: '⌂ My cards' }).click(); await expect(focus(other)).toContainText(names[1 - i]); await other.getByRole('button', { name: /Take discard/ }).click(); await other.locator('.sky-slide:not([inert])').getByRole('button', { name: /Replace Row 2, column 1/ }).click();
    await expect.poll(async () => (await view(request, sessions[0])).turn).toBe(v.turn);
    await current.locator('.sky-player-chip').nth(1 - i).click(); await expect(focus(current)).toContainText(names[1 - i]); await turn(request, sessions);
    await expect(focus(current)).toContainText(names[1 - i]); await expect(current.getByRole('button', { name: '↗ Follow turn' })).toHaveAttribute('aria-pressed', 'false');
    await current.getByRole('button', { name: '↗ Follow turn' }).click(); await expect(current.getByRole('button', { name: '↗ Follow turn' })).toHaveAttribute('aria-pressed', 'true');
    await current.reload(); await expect(current.locator('.sky-slide')).toHaveCount(2); expect((await view(request, sessions[i])).yourPlayerId).toBe(sessions[i].playerId);
    for (const c of clients) await noOverflow(c.page); expect(errors).toEqual([]); await current.screenshot({ path: 'test-results/skyjo-normal-phone.png', fullPage: true });
  } finally { await act(request, sessions[0], 'end'); for (const c of clients) await c.context.close(); }
});

test('selected discards can be returned after refresh and live TV switching, while private draws remain committed', async ({ browser, request }) => {
  const sessions = await create(request), clients = await Promise.all(sessions.map(s => openPlayer(browser, s)));
  const tvContext = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  try {
    await start(request, sessions);
    const initial = await view(request, sessions[0]), i = sessions.findIndex(s => s.playerId === initial.turn), current = clients[i].page, other = clients[1 - i].page;
    const position = (v: SkyView) => ({ phase: v.phase, step: v.step, round: v.round, turn: v.turn, pending: v.pending, yourCard: v.yourCard, deckCount: v.deckCount, discardCount: v.discardCount, discardTop: v.discardTop, deadline: v.deadline, finisher: v.finisher, finalTurns: v.finalTurns, players: v.players.map(p => ({ grid: p.grid, total: p.total, hidden: p.hidden })) });
    const before = position(await view(request, sessions[i])), tv = await tvContext.newPage();
    await tv.goto(initial.displayUrl!); await expect(tv.locator('[data-sky-player]')).toHaveCount(2);
    await current.getByRole('button', { name: /Take discard/ }).click();
    await expect(current.getByRole('button', { name: 'Return to discard', exact: true })).toBeVisible();
    await expect(other.getByRole('button', { name: 'Return to discard', exact: true })).toHaveCount(0);
    await expect(tv.locator('.sky-tv-pending')).toContainText('Selected discard');
    await expect(tv.getByRole('button', { name: 'Return to discard', exact: true })).toHaveCount(0);
    await current.reload();
    await current.getByRole('button', { name: 'Return to discard', exact: true }).click();
    await expect(current.getByRole('button', { name: 'Draw a hidden card' })).toBeEnabled();
    expect(position(await view(request, sessions[i]))).toEqual(before);
    await expect(tv.locator('.sky-tv-pending')).toHaveCount(0);
    await expect(tv.locator('.sky-discard').getByRole('img', { name: `Card ${initial.discardTop!.value}`, exact: true })).toBeVisible();

    await current.getByRole('button', { name: /Take discard/ }).click();
    await expect(current.getByRole('button', { name: 'Return to discard', exact: true })).toBeVisible();
    await mode(clients[0].page, 'tv');
    await expect(current.locator('.sky-controller-party')).toBeVisible();
    await current.setViewportSize({ width: 320, height: 640 }); await noOverflow(current);
    await current.getByRole('button', { name: 'Return to discard', exact: true }).click();
    await expect(current.getByRole('button', { name: 'Draw a hidden card' })).toBeEnabled();
    expect(position(await view(request, sessions[i]))).toEqual(before);
    await expect(tv.locator('.sky-tv-pending')).toHaveCount(0);
    await expect(tv.locator('.sky-discard').getByRole('img', { name: `Card ${initial.discardTop!.value}`, exact: true })).toBeVisible();

    await current.getByRole('button', { name: 'Draw a hidden card' }).click();
    await expect(current.locator('.sky-held')).toBeVisible();
    await expect(current.getByRole('button', { name: 'Return to discard', exact: true })).toHaveCount(0);
    await expect(other.locator('.sky-held')).toHaveCount(0);
    await current.getByRole('button', { name: 'Keep & swap' }).click();
    await expect(current.getByRole('button', { name: 'Return to discard', exact: true })).toHaveCount(0);
    await current.locator('.sky-controller-party').getByRole('button', { name: /Replace Row 2, column 3/ }).click();
    await expect.poll(async () => (await view(request, sessions[0])).turn).not.toBe(initial.turn);
    await noOverflow(current);
  } finally { await act(request, sessions[0], 'end'); for (const c of clients) await c.context.close(); await tvContext.close(); }
});

test('Keep can be reconsidered on phones and TV controllers after refresh without redrawing or revealing its private card', async ({ browser, request }) => {
  const sessions = await create(request), clients = await Promise.all(sessions.map(s => openPlayer(browser, s)));
  try {
    await start(request, sessions); const initial = await view(request, sessions[0]), i = sessions.findIndex(s => s.playerId === initial.turn);
    const current = clients[i].page, other = clients[1 - i].page;
    await current.getByRole('button', { name: 'Draw a hidden card' }).click();
    await expect(current.locator('.sky-held')).toBeVisible();
    const drawn = await view(request, sessions[i]);
    const snapshot = (v: SkyView) => ({ pending: v.pending, yourCard: v.yourCard, deckCount: v.deckCount, discardCount: v.discardCount, discardTop: v.discardTop, turn: v.turn, deadline: v.deadline, players: v.players.map(p => ({ grid: p.grid, total: p.total })) });
    await current.getByRole('button', { name: 'Keep & swap' }).click();
    await current.getByRole('button', { name: 'Back to choices', exact: true }).click();
    await expect(current.getByRole('button', { name: 'Discard & flip' })).toBeVisible();
    expect(snapshot(await view(request, sessions[i]))).toEqual(snapshot(drawn));
    await current.getByRole('button', { name: 'Keep & swap' }).click(); await current.reload();
    await expect(current.getByRole('button', { name: 'Back to choices', exact: true })).toBeVisible();
    await mode(clients[0].page, 'tv'); await expect(current.locator('.sky-controller-party')).toBeVisible();
    await current.getByRole('button', { name: 'Back to choices', exact: true }).click();
    await expect(current.getByRole('button', { name: 'Keep & swap' })).toBeVisible();
    expect(snapshot(await view(request, sessions[i]))).toEqual(snapshot(drawn));
    await expect(current.getByRole('button', { name: 'Draw a hidden card' })).toHaveCount(0);
    await expect(other.getByRole('button', { name: 'Back to choices', exact: true })).toHaveCount(0);
    await expect(other.locator('.sky-held')).toHaveCount(0);
    const hidden = drawn.players.find(p => p.playerId === sessions[i].playerId)!.grid.findIndex(c => c?.value === null);
    await current.getByRole('button', { name: 'Discard & flip' }).click();
    await expect(current.getByRole('button', { name: 'Back to choices', exact: true })).toHaveCount(0);
    await current.locator('.sky-controller-party [data-sky-index]').nth(hidden).getByRole('button').click();
    await expect.poll(async () => (await view(request, sessions[0])).turn).not.toBe(initial.turn); await noOverflow(current);
  } finally { await act(request, sessions[0], 'end'); for (const c of clients) await c.context.close(); }
});

test('eight-player mobile navigation supports real touch swipes, keyboard, small screens, landscape and reduced motion', async ({ browser, request }) => {
  const sessions = await create(request, 8), client = await openPlayer(browser, sessions[0], 320, 640), { page, context } = client;
  try {
    await act(request, sessions[0], 'start'); await expect(page.locator('.sky-slide')).toHaveCount(8);
    const before = await view(request, sessions[0]), box = await page.locator('.sky-carousel').boundingBox(); expect(box).toBeTruthy();
    await swipe(context, page, 275, 30, box!.y + 120); await expect(focus(page)).not.toContainText('Anna'); expect((await view(request, sessions[0])).revision).toBe(before.revision); expect((await view(request, sessions[0])).players[0].startingRevealed).toBe(0);
    await page.getByRole('button', { name: '⌂ My cards' }).click(); await expect(focus(page)).toContainText('Anna');
    await page.locator('.sky-carousel').focus(); await page.keyboard.press('End'); await expect(focus(page)).toContainText('Hugo'); await page.keyboard.press('Home'); await expect(focus(page)).toContainText('Anna');
    await noOverflow(page); await page.screenshot({ path: 'test-results/skyjo-320-phone.png', fullPage: true });
    await page.setViewportSize({ width: 844, height: 390 }); await noOverflow(page); await page.screenshot({ path: 'test-results/skyjo-landscape.png', fullPage: true });
    await page.emulateMedia({ reducedMotion: 'reduce' }); await page.setViewportSize({ width: 390, height: 844 }); await page.locator('.sky-player-chip').nth(6).click(); await expect(focus(page)).toContainText('Grace');
    expect(await page.locator('.sky-card').first().evaluate(el => getComputedStyle(el).animationName)).toBe('none');
    // Simultaneous opening reveals through HTTP, then rapid real turn changes must not steal manual browsing.
    for (const s of sessions) for (const index of [0, 1]) await act(request, s, 'setup', { index });
    await expect.poll(async () => (await view(request, sessions[0])).phase).toBe('PLAY');
    await page.locator('.sky-player-chip').nth(6).click(); await expect(focus(page)).toContainText('Grace');
    for (let i = 0; i < 4; i++) await turn(request, sessions);
    await expect(focus(page)).toContainText('Grace'); await expect(page.locator('.sky-live-event')).not.toBeEmpty(); await page.getByRole('button', { name: '↗ Follow turn' }).click();
    const currentTurn = (await view(request, sessions[0])).turn; await expect(focus(page)).toContainText(names[sessions.findIndex(s => s.playerId === currentTurn)]);
    await page.screenshot({ path: 'test-results/skyjo-eight-phone.png', fullPage: true });
  } finally { await act(request, sessions[0], 'end'); await context.close(); }
});

test('TV is read-only, eight grids stay readable, party controllers keep draws private, and live switching/reconnect preserve pending choices', async ({ browser, request }) => {
  const sessions = await create(request, 8), host = sessions[0], client = await openPlayer(browser, host), tvContext = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
  let activeContext: BrowserContext | undefined;
  try {
    await start(request, sessions); const initial = await view(request, host), current = sessions.find(s => s.playerId === initial.turn)!;
    const activeClient = current.playerId === host.playerId ? client : await openActive();
    async function openActive() { const c = await openPlayerAfterStart(browser, current); activeContext = c.context; return c; }
    await activeClient.page.getByRole('button', { name: 'Draw a hidden card' }).click(); await expect(activeClient.page.locator('.sky-held')).toBeVisible();
    const pending = await view(request, host); await mode(client.page, 'tv'); await expect(client.page.locator('.sky-controller-party')).toBeVisible(); expect(gameplay(await view(request, host))).toEqual(gameplay(pending));
    await expect(client.page.locator('.sky-phone-table')).toHaveCount(0); const tv = await tvContext.newPage(); await tv.goto(initial.displayUrl!); await expect(tv.locator('[data-sky-player]')).toHaveCount(8);
    const t = new URLSearchParams(initial.displayUrl!.split('#')[1]).get('token')!, tvSession = { ...host, playerToken: t }; const publicView = await view(request, tvSession);
    expect(publicView.yourCard).toBeNull(); expect(publicView.pending?.card).toBeNull(); expect(publicView.yourRole).toBe('DISPLAY'); expect(publicView.players).toHaveLength(8);
    await expect(tv.locator('.sky-tv-pending')).toContainText('Private draw'); await expect(tv.locator('.sky-held')).toHaveCount(0); await expect(tv.getByText('Host controls', { exact: true })).toHaveCount(0);
    const denied = await request.post(`${backend}/api/game/${host.gameId}/action`, { headers: { Authorization: `Bearer ${t}` }, data: { id: crypto.randomUUID(), type: 'end', round: publicView.round, generation: publicView.generation, revision: publicView.revision } }); expect(denied.status()).toBe(403);
    await noOverflow(tv); expect(await tv.locator('.sky-tv-layout').evaluate(el => el.getBoundingClientRect().bottom <= innerHeight)).toBe(true); await tv.screenshot({ path: 'test-results/skyjo-tv-eight.png', fullPage: true });
    await tv.getByRole('button', { name: 'Fullscreen' }).click(); await expect.poll(() => tv.evaluate(() => !!document.fullscreenElement)).toBe(true);
    await activeClient.page.getByRole('button', { name: 'Keep & swap' }).click(); await expect(activeClient.page.locator('.sky-controller-party .sky-grid')).toBeVisible(); await activeClient.page.screenshot({ path: 'test-results/skyjo-party-controller.png', fullPage: true });
    const before = await view(request, host); await tv.reload(); await expect(tv.locator('[data-sky-player]')).toHaveCount(8); expect(gameplay(await view(request, host))).toEqual(gameplay(before));
    await activeClient.page.locator('.sky-controller-party').getByRole('button', { name: /Replace Row 2, column 1/ }).click(); await expect.poll(async () => (await view(request, host)).turn).not.toBe(current.playerId);
    await client.page.getByRole('button', { name: 'Peek at the full table' }).click(); await expect(client.page.locator('.sky-slide')).toHaveCount(8); await client.page.getByRole('button', { name: 'Back to controller' }).click();
    const after = await view(request, host); await mode(client.page, 'normal'); await expect(client.page.locator('.sky-slide')).toHaveCount(8); expect(gameplay(await view(request, host))).toEqual(gameplay(after));
    await tv.setViewportSize({ width: 1280, height: 720 }); await noOverflow(tv); await tv.screenshot({ path: 'test-results/skyjo-tv-720.png', fullPage: true }); expect(await tv.locator('.sky-tv-layout').evaluate(el => el.getBoundingClientRect().bottom)).toBeLessThanOrEqual(720);
  } finally { await act(request, host, 'end'); await client.context.close(); await activeContext?.close(); await tvContext.close(); }
});

async function openPlayerAfterStart(browser: Browser, s: Session) {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } }), page = await context.newPage(); await page.goto('/'); await page.evaluate(s => localStorage.setItem(`party-session-${s.gameId}`, JSON.stringify(s)), s); await page.goto(`/g/${s.gameId}`); await expect(page.locator('.sky-controls')).toBeVisible(); return { context, page };
}

test('TV overview fits every supported player count at 720p and 1080p', async ({ browser, request }) => {
  test.setTimeout(120_000);
  const context = await browser.newContext(), page = await context.newPage();
  try {
    for (let n = 2; n <= 8; n++) {
      const sessions = await create(request, n);
      try {
        await start(request, sessions); const v = await view(request, sessions[0]);
        await page.goto(v.displayUrl!); await expect(page.locator('[data-sky-player]')).toHaveCount(n);
        for (const viewport of [{ width: 1920, height: 1080 }, { width: 1280, height: 720 }]) {
          await page.setViewportSize(viewport); await noOverflow(page);
          const bottom = await page.locator('.sky-tv-layout').evaluate(el => el.getBoundingClientRect().bottom);
          expect(bottom, `${n} players at ${viewport.width}×${viewport.height}`).toBeLessThanOrEqual(viewport.height);
          expect(await page.locator('.sky-tv-spotlight .sky-position').first().evaluate(el => el.getBoundingClientRect().width)).toBeGreaterThanOrEqual(45);
        }
      } finally { await act(request, sessions[0], 'end'); }
    }
  } finally { await context.close(); }
});

test('a complete network game reaches final scoring while concurrent lobbies and duplicate submissions remain isolated', async ({ browser, request }) => {
  const sessions = await create(request, 2, { fixedRounds: 1 }), other = await create(request, 2), client = await openPlayer(browser, sessions[0]);
  try {
    await start(request, sessions); const before = await view(request, other[0]);
    let v = await view(request, sessions[0]), current = sessions.find(s => s.playerId === v.turn)!;
    const a = { id: crypto.randomUUID(), type: 'draw', generation: v.generation, revision: v.revision, round: v.round };
    const responses = await Promise.all([0, 1].map(() => request.post(`${backend}/api/game/${current.gameId}/action`, { headers: { Authorization: `Bearer ${current.playerToken}` }, data: a }))); responses.forEach(r => expect(r.status()).toBe(200));
    expect((await view(request, sessions[0])).deckCount).toBe(v.deckCount - 1); await act(request, current, 'discard'); await act(request, current, 'reveal', { index: 2 });
    for (let i = 0; i < 40; i++) { v = await view(request, sessions[0]); if (v.phase === 'COMPLETED') break; await turn(request, sessions); }
    v = await view(request, sessions[0]); expect(v.phase).toBe('COMPLETED'); expect(v.winners.length).toBeGreaterThan(0); expect(v.result).toBeTruthy();
    await expect(client.page.getByRole('region', { name: 'Final scoreboard' })).toBeVisible(); await expect(client.page.locator('.sky-scoreboard li')).toHaveCount(2); expect(gameplay(await view(request, other[0]))).toEqual(gameplay(before)); await client.page.screenshot({ path: 'test-results/skyjo-final-results.png', fullPage: true });
  } finally { await act(request, sessions[0], 'end'); await act(request, other[0], 'end'); await client.context.close(); }
});
