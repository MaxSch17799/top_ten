import {
  test,
  expect,
  type Page,
  type APIRequestContext,
} from '@playwright/test';
import type { JustOneView } from '../../shared/justOne';

const backend = 'http://127.0.0.1:8787';
async function session(page: Page) {
  return page.evaluate(() =>
    JSON.parse(localStorage.getItem('top10-top10-session')!),
  );
}
async function state(page: Page, api: APIRequestContext): Promise<JustOneView> {
  const s = await session(page);
  return (
    await api.get(
      `${backend}/api/game/${s.gameId}/state?token=${s.playerToken}`,
    )
  ).json();
}
async function command(
  page: Page,
  api: APIRequestContext,
  type: string,
  payload = {},
) {
  const s = await session(page),
    v = await state(page, api);
  return api.post(`${backend}/api/game/${s.gameId}/action`, {
    headers: { Authorization: `Bearer ${s.playerToken}` },
    data: {
      id: crypto.randomUUID(),
      type,
      generation: v.generation,
      round: v.round,
      phase: v.phase,
      payload,
    },
  });
}
async function join(page: Page, gameId: string, nickname: string) {
  await page.goto(`/g/${gameId}`);
  await page.getByLabel('Your nickname').fill(nickname);
  await page.getByRole('button', { name: 'Join lobby', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: 'Gather your team' }),
  ).toBeVisible();
}
async function clues(page: Page, words: string[]) {
  for (let i = 0; i < words.length; i++)
    await page.getByLabel(`Clue ${i + 1}`, { exact: true }).fill(words[i]);
  await page.getByRole('button', { name: 'Submit clues', exact: true }).click();
}
async function settings(page: Page) {
  const panel = page.locator('details.host-controls');
  if (!(await panel.evaluate((node) => (node as HTMLDetailsElement).open)))
    await panel.locator('summary').first().click();
  return panel;
}

test('three devices play complete Just One, protect secrets, switch modes and reconnect', async ({
  browser,
  page: host,
  request,
}) => {
  const errors: string[] = [];
  host.on('pageerror', (e) => errors.push(e.message));
  const frames: JustOneView[] = [];
  host.on('websocket', (ws) =>
    ws.on('framereceived', (event) => {
      try {
        const d = JSON.parse(String(event.payload));
        if (d.type === 'STATE') frames.push(d.payload);
      } catch {
        /* PONG or non-JSON */
      }
    }),
  );
  const c1 = await browser.newContext({
    viewport: { width: 390, height: 844 },
    serviceWorkers: 'block',
  });
  const c2 = await browser.newContext({
    viewport: { width: 768, height: 1024 },
    serviceWorkers: 'block',
  });
  const p1 = await c1.newPage(),
    p2 = await c2.newPage();
  try {
    await host.goto('/');
    await host.getByRole('link', { name: /Just One/ }).click();
    await host.getByLabel('Your nickname').fill('Host');
    await host.getByRole('button', { name: 'Create Just One lobby' }).click();
    await expect(
      host.getByRole('heading', { name: 'Gather your team' }),
    ).toBeVisible();
    const { gameId } = await session(host);
    await host.getByRole('button', { name: 'Invite players' }).click();
    await expect(
      host.getByRole('img', { name: 'Join link QR code' }),
    ).toBeVisible();
    await expect(host.locator('.invite-card input')).toHaveValue(
      `http://127.0.0.1:5173/g/${gameId}`,
    );
    await host.getByRole('button', { name: 'Close invite panel' }).click();
    await join(p1, gameId, 'Alice');
    await join(p2, gameId, 'Bob');
    await host.getByLabel('Scoring mode').selectOption('fixed');
    await host.getByLabel('Number of rounds').fill('2');
    await host.getByRole('button', { name: 'Apply settings' }).click();
    await host.getByRole('button', { name: 'Start game', exact: true }).click();
    await expect(p1.getByLabel('Clue 2', { exact: true })).toBeVisible();
    await expect(host.getByTestId('mystery-word')).toHaveCount(0);
    host.once('dialog', (dialog) => dialog.dismiss());
    await host.getByRole('button', { name: '← All games' }).click();
    await expect(host).toHaveURL(new RegExp(`/g/${gameId}$`));
    await clues(p1, ['Horse', 'Horses']);
    expect((await state(p2, request)).ownClues).toBeNull();
    await p1.reload();
    await expect(p1.getByText('Clues locked in')).toBeVisible();
    await clues(p2, ['ocean', 'morning']);
    await expect(
      p1.getByRole('button', { name: 'Finalize & reveal clues' }),
    ).toBeVisible();
    expect(await p1.locator('.review-clue.eliminated').count()).toBe(2);
    expect((await command(host, request, 'reveal')).status()).toBe(403);
    await p1.getByRole('button', { name: 'Finalize & reveal clues' }).click();
    await expect(host.getByLabel('Your one answer')).toBeVisible();
    await expect(host.locator('.surviving-clues')).toHaveText('oceanmorning');
    expect(
      frames
        .filter((v) => v.round === 1)
        .every(
          (v) =>
            v.word === undefined &&
            v.options === undefined &&
            v.reviewClues === undefined,
        ),
    ).toBeTruthy();
    const before = await state(host, request);
    const panel = await settings(host);
    await panel.getByLabel('Guessing mode · immediate').selectOption('verbal');
    await panel.getByRole('button', { name: 'Apply settings' }).click();
    await expect(
      host.getByRole('heading', { name: 'Say your answer aloud' }),
    ).toBeVisible();
    expect((await state(host, request)).remaining).toBe(before.remaining);
    const adjudication = p1.waitForRequest(
      (r) =>
        r.url().endsWith('/action') && r.postDataJSON()?.type === 'adjudicate',
    );
    await p1.getByRole('button', { name: 'Correct guess', exact: true }).click();
    const committed = await adjudication;
    await expect(host.getByText('You got it! +1 point')).toBeVisible();
    const p1Session = await session(p1);
    const replay = await request.post(committed.url(), {
      headers: { Authorization: `Bearer ${p1Session.playerToken}` },
      data: committed.postDataJSON(),
    });
    expect(replay.ok()).toBeTruthy();
    expect((await state(host, request)).score).toBe(1);
    await panel.getByLabel('Guessing mode · immediate').selectOption('typed');
    await panel.getByLabel('Word selection · next round').selectOption('five');
    await panel.getByRole('button', { name: 'Apply settings' }).click();
    await host.getByRole('button', { name: 'Next word →' }).click();
    await expect(
      p1.getByRole('button', { name: '2', exact: true }),
    ).toBeVisible();
    await expect(host.locator('.word-options p')).toHaveCount(5);
    expect((await state(p1, request)).options).toBeUndefined();
    await p1.getByRole('button', { name: '2', exact: true }).click();
    await expect(host.getByTestId('mystery-word')).toBeVisible();
    const word = await host.getByTestId('mystery-word').innerText();
    await clues(host, ['cloud', 'plastic']);
    await clues(p2, ['window', 'engine']);
    await expect(
      host.getByRole('button', { name: 'Finalize & reveal clues' }),
    ).toBeVisible();
    await host.getByRole('button', { name: 'Finalize & reveal clues' }).click();
    await p1.getByLabel('Your one answer').fill(word.toUpperCase());
    await c1.setOffline(true);
    await c1.setOffline(false);
    await p1.reload();
    await expect(p1.getByLabel('Your one answer')).toBeVisible();
    await p1.getByLabel('Your one answer').fill(word.toUpperCase());
    await p1.getByRole('button', { name: 'Commit answer' }).click();
    await expect(host.getByText('You got it! +1 point')).toBeVisible();
    await host.getByRole('button', { name: 'Show final score' }).click();
    await expect(host.getByRole('heading', { name: '2 / 2' })).toBeVisible();
    await expect(
      p2.getByRole('heading', { name: 'That’s a team effort' }),
    ).toBeVisible();
    expect(errors).toEqual([]);
    expect(
      await p1.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBeTruthy();
    await host.screenshot({
      path: 'test-results/just-one-final-desktop.png',
      fullPage: true,
    });
    await p1.screenshot({
      path: 'test-results/just-one-final-mobile.png',
      fullPage: true,
    });
    await host.getByRole('link', { name: 'Choose another game' }).click();
    await expect(host.getByRole('link', { name: /Top 10/ })).toBeVisible();
  } finally {
    await c1.close();
    await c2.close();
  }
});

test('Top 10 still creates, joins, reorders, deals, advances and ends using legacy links', async ({
  page,
  request,
}) => {
  await page.goto('/host');
  await page.getByPlaceholder('Host nickname').fill('Top Host');
  await page.getByRole('button', { name: 'Create lobby', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Seat order' })).toBeVisible();
  const s = await session(page);
  const join = await request.post(`${backend}/api/game/${s.gameId}/join`, {
    data: { nickname: 'Top Guest' },
  });
  expect(join.ok()).toBeTruthy();
  const guest = await join.json();
  expect(
    (
      await request.post(`${backend}/api/game/${s.gameId}/reorder`, {
        data: { hostToken: s.hostToken, order: [guest.playerId, s.playerId] },
      })
    ).ok(),
  ).toBeTruthy();
  await page.getByRole('button', { name: 'Start Round 1' }).click();
  await expect
    .poll(async () => (await state(page, request)).phase)
    .toBe('ACTIVE');
  const active = (await state(page, request)) as unknown as {
    round: number;
    yourSecretNumber: number;
    roundHostPlayerId: string;
  };
  expect(active.round).toBe(1);
  expect(active.yourSecretNumber).toBeGreaterThanOrEqual(1);
  expect(active.roundHostPlayerId).toBe(guest.playerId);
  await page.reload();
  await expect(
    page.getByRole('button', { name: 'Next round', exact: true }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Next round', exact: true }).click();
  await expect.poll(async () => (await state(page, request)).round).toBe(2);
  await page.getByRole('button', { name: 'End game', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Game ended' })).toBeVisible();
});

test('multiple isolated lobbies, active timers, missing submissions and forged roles', async ({
  request,
}) => {
  async function make() {
    const r = await request.post(`${backend}/api/game/create`, {
      data: { gameType: 'just-one', hostNickname: 'Host' },
    });
    expect(r.ok()).toBeTruthy();
    return r.json();
  }
  const a = await make(),
    b = await make();
  expect(a.gameId).not.toBe(b.gameId);
  const guests = [];
  for (const nickname of ['Alice', 'Bob'])
    guests.push(
      await (
        await request.post(`${backend}/api/game/${a.gameId}/join`, {
          data: { nickname },
        })
      ).json(),
    );
  const view = async (game = a) =>
    (
      await request.get(
        `${backend}/api/game/${game.gameId}/state?token=${game.playerToken}`,
      )
    ).json();
  const act = async (type: string, payload = {}, token = a.playerToken) => {
    const v = await view();
    return request.post(`${backend}/api/game/${a.gameId}/action`, {
      headers: { Authorization: `Bearer ${token}` },
      data: {
        type,
        payload,
        id: crypto.randomUUID(),
        generation: v.generation,
        phase: v.phase,
        round: v.round,
      },
    });
  };
  expect(
    (
      await act('settings', {
        clueTimer: true,
        clueSeconds: 5,
        guessTimer: true,
        guessSeconds: 5,
      })
    ).ok(),
  ).toBeTruthy();
  expect((await act('start')).ok()).toBeTruthy();
  expect((await view(b)).phase).toBe('LOBBY');
  expect((await act('end', {}, guests[0].playerToken)).status()).toBe(403);
  const privateView = await view();
  expect(privateView.word).toBeUndefined();
  expect(privateView.deadline).toBeGreaterThan(privateView.serverNow);
  expect((await act('pause')).ok()).toBeTruthy();
  expect((await view()).deadline).toBeNull();
  expect((await act('timer', { operation: 'add' })).ok()).toBeTruthy();
  expect((await view()).pausedRemaining).toBeGreaterThan(30_000);
  expect((await act('settings', { clueSeconds: 5 })).ok()).toBeTruthy();
  expect((await act('timer', { operation: 'reset' })).ok()).toBeTruthy();
  expect((await act('pause')).ok()).toBeTruthy();
  await expect
    .poll(async () => (await view()).phase, { timeout: 12_000 })
    .toBe('REVIEW');
  expect((await act('reveal', {}, guests[0].playerToken)).ok()).toBeTruthy();
  expect((await view()).result.outcome).toBe('no-clues');
  expect((await view()).remaining).toBe(12);
  expect((await act('settings', { clueTimer: false })).ok()).toBeTruthy();
  expect((await act('next')).ok()).toBeTruthy();
  expect(
    (await act('clues', { clues: ['cloud', 'plastic'] })).ok(),
  ).toBeTruthy();
  expect(
    (
      await act('clues', { clues: ['window', 'engine'] }, guests[1].playerToken)
    ).ok(),
  ).toBeTruthy();
  expect((await act('reveal')).ok()).toBeTruthy();
  await expect
    .poll(async () => (await view()).phase, { timeout: 12_000 })
    .toBe('RESULT');
  expect((await view()).result.outcome).toBe('pass');
  expect((await view()).remaining).toBe(11);
  expect(
    (await act('correct-result', { outcome: 'correct' })).ok(),
  ).toBeTruthy();
  expect((await view()).score).toBe(1);
  expect((await act('end')).ok()).toBeTruthy();
  expect(
    (
      await request.get(
        `${backend}/api/game/${a.gameId}/state?token=${b.playerToken}`,
      )
    ).status(),
  ).toBe(401);
  expect((await act('restart')).ok()).toBeTruthy();
  expect((await view()).phase).toBe('LOBBY');
  expect((await view()).players.length).toBe(3);
  expect((await view()).generation).toBe(2);
});

test('game selection is usable on mobile and tablet with no horizontal overflow', async ({
  page,
}) => {
  for (const width of [360, 768]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto('/');
    await expect(page.getByRole('link', { name: /Just One/ })).toBeVisible();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBeTruthy();
  }
  await page.screenshot({
    path: 'test-results/game-selection-tablet.png',
    fullPage: true,
  });
});
