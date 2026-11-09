import { readFileSync } from 'node:fs';
import { test, expect } from '@playwright/test';

for (const game of ['skyjo', 'flip7', 'just-one', 'sounds-fishy', 'wavelength']) {
  test(`${game}: uncertain commands expose an exact-ID retry`, async ({ page }) => {
    const fixture = JSON.parse(readFileSync(`tests/fixtures/rooms/${game}.json`, 'utf8'));
    const view = Object.values(fixture.views).find((v: any) => v.yourRole === 'HOST') as any;
    const player = fixture.state.players[view.yourPlayerId];
    const room = view.gameId;
    await page.addInitScript(({ room, player }) => {
      localStorage.setItem(`party-session-${room}`, JSON.stringify({ gameId: room, playerId: player.playerId, playerToken: player.token, role: 'HOST' }));
      localStorage.setItem('fishy-ui-language', 'en');
    }, { room, player });
    await page.route(`**/api/game/${room}/info`, r => r.fulfill({ json: { gameType: game } }));
    await page.route(`**/api/game/${room}/state**`, r => r.fulfill({ json: view }));
    await page.routeWebSocket(`**/api/game/${room}/ws?**`, ws => ws.send(JSON.stringify({ type: 'STATE', payload: view })));
    const actions: unknown[] = [];
    await page.route(`**/api/game/${room}/action`, async route => {
      actions.push(route.request().postDataJSON());
      await route.fulfill(actions.length === 1
        ? { status: 503, json: { error: 'ROOM_COMMIT_UNCERTAIN', message: 'Reconnect or retry the same action.', retryable: true } }
        : { json: { success: true } });
    });
    await page.goto(`/g/${room}`);
    const summary = page.locator('summary').filter({ hasText: /^Host controls$/ });
    if (await summary.count()) await summary.click();
    await page.getByRole('button', { name: /^Resume(?: game)?$/ }).click();
    const retry = page.getByRole('button', { name: 'Retry same action safely' });
    await expect(retry).toBeVisible();
    await retry.click();
    await expect(retry).toHaveCount(0);
    expect(actions).toHaveLength(2);
    expect(actions[1]).toEqual(actions[0]);
  });
}
