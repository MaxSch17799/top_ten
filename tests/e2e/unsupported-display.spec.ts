import { test, expect } from '@playwright/test';

const backend = process.env.PLAYWRIGHT_BACKEND_URL ?? 'http://127.0.0.1:8787';

for (const game of [
  { type: 'top10', name: 'Top 10', roomHeading: 'Seat order' },
  { type: 'just-one', name: 'Just One', roomHeading: 'Gather your team' },
]) {
  test(`${game.name}: unsupported display explains the limitation without connecting as a player`, async ({ page, request }) => {
    const created = await request.post(`${backend}/api/game/create`, {
      data: { gameType: game.type, hostNickname: 'Display test host', ...(game.type === 'top10' ? { questionBankId: 'classic_v1' } : {}) },
    });
    expect(created.ok(), `${created.status()}: ${await created.text()}`).toBeTruthy();
    const session = await created.json();
    // Even a browser with a player session must not mount its player controls here.
    await page.addInitScript(data => {
      localStorage.setItem('top10-top10-session', JSON.stringify(data));
      localStorage.setItem(`party-session-${data.gameId}`, JSON.stringify(data));
    }, session);
    const playerRequests: string[] = [];
    page.on('request', req => {
      if (new RegExp(`/api/game/${session.gameId}/(?:state|join|action|ws)(?:[?]|$)`).test(req.url())) playerRequests.push(req.url());
    });
    page.on('websocket', socket => {
      if (socket.url().includes(`/api/game/${session.gameId}/ws`)) playerRequests.push(socket.url());
    });
    await page.setViewportSize({ width: 320, height: 700 });
    await page.goto(`/g/${session.gameId}/display#token=fixture-display-only`);
    await expect(page.getByRole('heading', { name: 'TV display unavailable' })).toBeVisible();
    await expect(page.getByText(game.name, { exact: true })).toBeVisible();
    await expect(page.getByText('This game does not have a dedicated TV display.', { exact: false })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Open game room' })).toHaveAttribute('href', `/g/${session.gameId}`);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.reload();
    await expect(page.getByRole('heading', { name: 'TV display unavailable' })).toBeVisible();
    expect(playerRequests).toEqual([]);
    expect(await page.evaluate(id => JSON.parse(localStorage.getItem(`party-session-${id}`)!), session.gameId)).toEqual(session);

    await page.getByRole('link', { name: 'Open game room' }).click();
    await expect(page).toHaveURL(new RegExp(`/g/${session.gameId}$`));
    await expect(page.getByRole('heading', { name: game.roomHeading })).toBeVisible();
    await expect.poll(() => playerRequests.length).toBeGreaterThan(0);
  });
}
