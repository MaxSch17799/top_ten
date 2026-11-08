import { test, expect, type APIRequestContext, type Browser, type BrowserContext, type Page } from '@playwright/test';
import type { FishyView } from '../../shared/soundsFishy';
import { readFileSync } from 'node:fs';

const classicQuestions = Object.fromEntries(['en', 'de'].map(language => [language, new Set<string>(JSON.parse(readFileSync(new URL(`../../question-banks/sounds-fishy/sounds-fishy-classic-${language}.json`, import.meta.url), 'utf8')).questions.map((q: { question: string }) => q.question))]));

const backend = process.env.FISHY_BACKEND_URL ?? 'http://127.0.0.1:8787';
type Seat = { page: Page; playerId: string; playerToken: string; gameId: string };
async function getSession(page: Page) { return page.evaluate(() => JSON.parse(localStorage.getItem('top10-top10-session')!)); }
async function view(api: APIRequestContext, seat: Seat): Promise<FishyView> {
  const response = await api.get(`${backend}/api/game/${seat.gameId}/state`, { headers: { Authorization: `Bearer ${seat.playerToken}` } });
  expect(response.ok()).toBeTruthy(); return response.json();
}
async function action(api: APIRequestContext, seat: Seat, type: string, payload = {}) {
  const v = await view(api, seat);
  return api.post(`${backend}/api/game/${seat.gameId}/action`, { headers: { Authorization: `Bearer ${seat.playerToken}` }, data: { id: crypto.randomUUID(), type, generation: v.generation, roundId: v.roundId, phase: v.phase, payload } });
}
async function group(browser: Browser, host: Page) {
  const contexts: BrowserContext[] = [], seats: Seat[] = [];
  await host.goto('/'); await host.getByRole('link', { name: /Sounds Fishy/ }).click();
  await host.getByLabel('Your nickname').fill('Host'); await host.getByRole('button', { name: 'Create Sounds Fishy lobby' }).click();
  await expect(host.getByRole('heading', { name: 'Gather your shoal' })).toBeVisible();
  seats.push({ page: host, ...await getSession(host) });
  for (const nickname of ['Alina', 'Mäx', 'Tobi']) {
    const context = await browser.newContext({ viewport: { width: nickname === 'Mäx' ? 768 : 390, height: 844 }, serviceWorkers: 'block' }); contexts.push(context);
    const page = await context.newPage(); await page.goto(`/g/${seats[0].gameId}`);
    await page.getByLabel('Your nickname').fill(nickname); await page.getByRole('button', { name: 'Join lobby', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Gather your shoal' })).toBeVisible();
    seats.push({ page, ...await getSession(page) });
  }
  return { seats, contexts };
}
async function catchFish(page: Page, nickname: string) {
  await page.getByRole('button', { name: `Eliminate ${nickname}`, exact: true }).click();
  await page.getByRole('button', { name: `Reveal fish ${nickname}`, exact: true }).click();
}
async function admin(page: Page) {
  const panel = page.locator('.sf-admin'); if (!await panel.evaluate(el => (el as HTMLDetailsElement).open)) await panel.locator('summary').first().click(); return panel;
}

test('four devices finish an official eight-round party game, share a safe display, reconnect and score every ending', async ({ browser, page: host, request }, testInfo) => {
  test.setTimeout(150_000);
  const frames: FishyView[] = [], errors: string[] = [];
  host.on('pageerror', e => errors.push(e.message));
  host.on('websocket', ws => ws.on('framereceived', e => { try { const data = JSON.parse(String(e.payload)); if (data.type === 'STATE') frames.push(data.payload); } catch { /* heartbeat */ } }));
  const { seats, contexts } = await group(browser, host), owner = seats[0];
  try {
    await host.getByRole('button', { name: 'Invite players', exact: true }).click();
    await expect(host.getByRole('img', { name: 'Join link QR code' })).toBeVisible(); await host.getByRole('button', { name: 'Close invite panel' }).click();
    await host.screenshot({ path: testInfo.outputPath('lobby.png'), fullPage: true });
    const displayLink = await host.getByRole('link', { name: /Shared display/ }).getAttribute('href');
    const display = await host.context().newPage(); await display.goto(displayLink!);
    await expect(display.getByRole('heading', { name: 'Gather your shoal' })).toBeVisible();
    await host.getByRole('button', { name: 'Start game', exact: true }).click();
    for (let round = 1; round <= 8; round++) {
      await expect.poll(async () => (await view(request, owner)).round).toBe(round);
      const v = await view(request, owner), guesser = seats.find(p => p.playerId === v.guesserId)!;
      await expect(guesser.page.getByRole('button', { name: 'Start guessing', exact: true })).toBeVisible();
      expect(v.totalRounds).toBe(8); expect(v.guesserId).toBe(seats[(round - 1) % 4].playerId);
      const privateViews = await Promise.all(seats.map(seat => view(request, seat)));
      const b = privateViews.find(p => p.ownRole === 'blue')!, reds = privateViews.filter(p => p.ownRole === 'red');
      expect(b).toBeTruthy(); expect(reds).toHaveLength(2);
      await expect(guesser.page.getByTestId('fishy-private')).toHaveCount(0);
      await expect(display.getByTestId('fishy-private')).toHaveCount(0); await expect(display.getByTestId('fishy-revealed-answer')).toHaveCount(0);
      if (round === 1) {
        const red = seats.find(p => p.playerId === reds[0].yourPlayerId)!; await red.page.reload();
        await expect(red.page.getByTestId('fishy-private')).toContainText(reds[0].answer!);
        if ((await view(request, owner)).paused) { const p = await admin(host); await p.getByRole('button', { name: 'Resume', exact: true }).click(); }
      }
      await guesser.page.getByRole('button', { name: 'Start guessing', exact: true }).click();
      if (round === 1 || round === 3) {
        await catchFish(guesser.page, reds[0].players.find(p => p.playerId === reds[0].yourPlayerId)!.nickname);
        await expect(guesser.page.getByRole('button', { name: 'Bank points · 1' })).toBeVisible();
      }
      if (round === 2 || round === 3) await catchFish(guesser.page, b.players.find(p => p.playerId === b.yourPlayerId)!.nickname);
      else if (round === 4) for (const r of reds) await catchFish(guesser.page, r.players.find(p => p.playerId === r.yourPlayerId)!.nickname);
      else await guesser.page.getByRole('button', { name: /^Bank points/ }).click();
      await expect(host.getByTestId('fishy-revealed-answer')).toBeVisible();
      const result = (await view(request, owner)).result!;
      expect(result.outcome).toBe(round === 2 || round === 3 ? 'blue' : round === 4 ? 'all-reds' : 'banked');
      expect(result.points[v.guesserId!]).toBe(round === 1 ? 1 : round === 4 ? 3 : 0);
      if (round === 2) { expect(result.points[b.yourPlayerId]).toBe(2); for (const r of reds) expect(result.points[r.yourPlayerId]).toBe(1); }
      if (round === 3) { expect(result.points[b.yourPlayerId]).toBe(1); expect(result.points[reds[1].yourPlayerId]).toBe(2); }
      if (round === 1) await host.screenshot({ path: testInfo.outputPath('round-result.png'), fullPage: true });
      await host.getByRole('button', { name: round === 8 ? 'Show final ranking' : 'Next round', exact: true }).click();
    }
    await expect(host.getByRole('heading', { name: 'The final catch' })).toBeVisible();
    expect((await view(request, owner)).winners.length).toBeGreaterThan(0);
    for (const page of seats.map(p => p.page)) expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBeTruthy();
    expect(errors).toEqual([]);
    for (const frame of frames.filter(f => f.guesserId === owner.playerId && !f.result)) { expect(frame.answer).toBeUndefined(); expect(frame.ownRole).toBeUndefined(); expect(frame.sources).toBeUndefined(); }
    await display.close();
  } finally { for (const context of contexts) await context.close(); await action(request, owner, 'end'); }
});

test('written mode reveals together, validates bluffs, keeps submissions on reconnect and queues verbal mode', async ({ browser, page: host, request }) => {
  const { seats, contexts } = await group(browser, host), owner = seats[0];
  try {
    await host.getByRole('combobox', { name: 'Play mode', exact: true }).selectOption('written');
    await host.getByRole('button', { name: 'Start game', exact: true }).click();
    await expect(host.getByRole('heading', { name: 'Write your answer' })).toBeVisible();
    const views = await Promise.all(seats.map(seat => view(request, seat)));
    const b = views.find(v => v.ownRole === 'blue')!, r = views.filter(v => v.ownRole === 'red');
    const blue = seats.find(p => p.playerId === b.yourPlayerId)!, red = seats.find(p => p.playerId === r[0].yourPlayerId)!;
    await expect(blue.page.getByLabel('Your answer', { exact: true })).toHaveValue(b.answer!);
    await expect(blue.page.getByLabel('Your answer', { exact: true })).toHaveAttribute('readonly', '');
    await blue.page.getByRole('button', { name: 'Submit answer', exact: true }).click();
    await blue.page.reload(); await expect(blue.page.getByText('Your answer is locked in')).toBeVisible();
    expect((await view(request, blue)).ownSubmission).toBe(b.answer);
    await red.page.getByLabel('Your answer', { exact: true }).fill(r[0].answer!);
    await red.page.getByRole('button', { name: 'Submit answer', exact: true }).click();
    await expect(red.page.getByRole('alert')).toContainText('matches the real answer');
    await red.page.getByLabel('Your answer', { exact: true }).fill('Ein ganz anderer Bluff');
    await red.page.getByRole('button', { name: 'Submit answer', exact: true }).click();
    const panel = await admin(host); await panel.getByRole('combobox', { name: 'Play mode', exact: true }).selectOption('party');
    await expect(host.getByText('Party mode will start next round.')).toBeVisible();
    expect((await view(request, owner)).answers).toBeUndefined();
    await expect(host.locator('.sf-written-answer')).toHaveCount(0);
    const other = seats.find(p => p.playerId === r[1].yourPlayerId)!;
    await other.page.getByLabel('Your answer', { exact: true }).fill('Noch eine erfundene Antwort');
    await other.page.getByRole('button', { name: 'Submit answer', exact: true }).click();
    await expect(host.locator('.sf-written-answer')).toHaveCount(3);
    await host.reload(); await expect(host.locator('.sf-written-answer')).toHaveCount(3);
    expect((await view(request, owner)).answer).toBeUndefined();
    if ((await view(request, owner)).paused) { const p = await admin(host); await p.getByRole('button', { name: 'Resume', exact: true }).click(); }
    await catchFish(host, r[0].players.find(p => p.playerId === r[0].yourPlayerId)!.nickname);
    await host.getByRole('button', { name: /^Bank points/ }).click();
    await host.getByRole('button', { name: 'Next round', exact: true }).click();
    await expect(host.getByRole('heading', { name: 'Think of a believable answer' })).toBeVisible();
    await expect(host.getByLabel('Your answer', { exact: true })).toHaveCount(0);
    const p = await admin(host); await p.getByRole('combobox', { name: 'Transfer host', exact: true }).selectOption(seats[1].playerId);
    await expect(seats[1].page.locator('.sf-admin')).toBeVisible();
    expect((await view(request, seats[1])).yourRole).toBe('HOST');
    expect((await action(request, owner, 'score', { playerId: owner.playerId, delta: 10, reason: 'unauthorized' })).status()).toBe(403);
    expect((await action(request, seats[1], 'end')).ok()).toBeTruthy();
  } finally { await action(request, owner, 'end'); for (const context of contexts) await context.close(); }
});

test('German UI works independently of question language; authentication, concurrent submissions and display permissions hold', async ({ browser, page: host, request }) => {
  const { seats, contexts } = await group(browser, host), owner = seats[0];
  try {
    await host.getByLabel('Interface language').selectOption('de');
    await expect(host.getByRole('heading', { name: 'Versammelt euren Schwarm' })).toBeVisible();
    await host.getByRole('combobox', { name: 'Spielmodus', exact: true }).selectOption('written');
    const initial = await view(request, owner), displayToken = initial.displayToken!;
    expect((await request.get(`${backend}/api/game/${owner.gameId}/state`)).status()).toBe(401);
    await host.getByRole('button', { name: 'Spiel starten', exact: true }).click();
    await expect(host.getByRole('heading', { name: 'Schreibe deine Antwort' })).toBeVisible();
    const v = await view(request, owner); expect(classicQuestions.en.has(v.question ?? '')).toBeTruthy();
    const fish = seats.filter(p => p.playerId !== v.guesserId);
    const responses = await Promise.all(fish.map(p => action(request, p, 'submit', { answer: `Bluff von ${p.playerId}` })));
    expect(responses.every(r => r.ok())).toBeTruthy();
    await expect(host.getByRole('heading', { name: 'Weiterfischen?' })).toBeVisible();
    const publicView: FishyView = await (await request.get(`${backend}/api/game/${owner.gameId}/state`, { headers: { Authorization: `Bearer ${displayToken}` } })).json();
    expect(publicView.answer).toBeUndefined(); expect(publicView.ownRole).toBeUndefined(); expect(publicView.displayToken).toBeUndefined(); expect(publicView.roles).toEqual({});
    expect((await request.post(`${backend}/api/game/${owner.gameId}/action`, { headers: { Authorization: `Bearer ${displayToken}` }, data: { id: crypto.randomUUID(), type: 'bank', generation: v.generation, roundId: v.roundId, phase: 'ELIMINATION' } })).status()).toBe(403);
    await host.getByRole('button', { name: /^Punkte sichern/ }).click();
    await expect(host.getByRole('heading', { name: 'Punkte gesichert', exact: true })).toBeVisible();
    const p = await admin(host); await p.getByRole('button', { name: 'Pause', exact: true }).click();
    await expect.poll(async () => (await view(request, owner)).paused).toBeTruthy();
  } finally { await action(request, owner, 'end'); for (const context of contexts) await context.close(); }
});

test('full German bank is selectable and playable in written mode without sample warnings', async ({ browser, page: host, request }) => {
  const { seats, contexts } = await group(browser, host), owner = seats[0];
  try {
    const catalog = await (await request.get(`${backend}/api/sounds-fishy/banks`)).json();
    for (const language of ['en', 'de']) {
      const bank = catalog.banks.find((b: { bankId: string }) => b.bankId === `sounds-fishy-classic-${language}`);
      expect(bank.questionCount).toBe(150); expect(bank.development).toBe(false);
      expect(bank.questions).toBeUndefined();
    }
    await host.getByRole('combobox', { name: 'Question bank', exact: true }).selectOption('sounds-fishy-classic-de');
    await host.getByRole('combobox', { name: 'Play mode', exact: true }).selectOption('written');
    await expect(host.locator('.warning-banner')).toHaveCount(0);
    await host.getByRole('button', { name: 'Start game', exact: true }).click();
    await expect(host.getByRole('heading', { name: 'Write your answer' })).toBeVisible();
    const v = await view(request, owner);
    expect(classicQuestions.de.has(v.question ?? '')).toBeTruthy(); expect(v.answer).toBeUndefined();
    const privateViews = await Promise.all(seats.map(seat => view(request, seat)));
    const answer = privateViews.find(p => p.ownRole === 'blue')!.answer!;
    for (const seat of seats.filter(p => p.playerId !== v.guesserId)) {
      const p = seat.page, field = p.getByLabel('Your answer', { exact: true });
      if ((await field.getAttribute('readonly')) === null) await field.fill(`Ein erfundener Bluff von ${seat.playerId}`);
      await p.getByRole('button', { name: 'Submit answer', exact: true }).click();
    }
    await expect(host.locator('.sf-written-answer')).toHaveCount(3);
    expect((await view(request, owner)).answer).toBeUndefined();
    await host.getByRole('button', { name: /^Bank points/ }).click();
    await expect(host.getByTestId('fishy-revealed-answer')).toHaveText(answer);
    await expect(host.locator('.warning-banner')).toHaveCount(0);
  } finally { await action(request, owner, 'end'); for (const context of contexts) await context.close(); }
});
