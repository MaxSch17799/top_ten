import {
  test,
  expect,
  type Browser,
  type APIRequestContext,
  type Page,
} from '@playwright/test';
import type { JustOneView } from '../../shared/justOne';

const frontend = process.env.PLAYWRIGHT_BASE_URL ?? 'http://127.0.0.1:5173';
const backend = process.env.PLAYWRIGHT_BACKEND_URL ?? 'http://127.0.0.1:8787';
async function room(
  browser: Browser,
  request: APIRequestContext,
  settings = {},
) {
  const created = await request.post(`${backend}/api/game/create`, {
    data: {
      gameType: 'just-one',
      hostNickname: 'Controls check',
      settings: { cluesPerPlayer: 1, ...settings },
    },
  });
  expect(created.ok()).toBeTruthy();
  const hostSession = await created.json();
  const sessions = [hostSession];
  for (const nickname of ['Clue check A', 'Clue check B']) {
    const response = await request.post(
      `${backend}/api/game/${hostSession.gameId}/join`,
      { data: { nickname } },
    );
    expect(response.ok()).toBeTruthy();
    sessions.push({ ...(await response.json()), gameId: hostSession.gameId });
  }
  const contexts = [];
  const pages: Page[] = [];
  for (const [i, session] of sessions.entries()) {
    const context = await browser.newContext({
      viewport: { width: i === 1 ? 390 : 1100, height: 900 },
      serviceWorkers: 'block',
    });
    await context.addInitScript(
      (s) =>
        localStorage.setItem(`party-session-${s.gameId}`, JSON.stringify(s)),
      session,
    );
    const page = await context.newPage();
    await page.goto(`${frontend}/g/${session.gameId}`);
    await expect(
      page.getByRole('heading', { name: 'Gather your team' }),
    ).toBeVisible();
    contexts.push(context);
    pages.push(page);
  }
  const view = async (index = 0): Promise<JustOneView> =>
    (
      await request.get(
        `${backend}/api/game/${hostSession.gameId}/state?token=${sessions[index].playerToken}`,
      )
    ).json();
  const act = async (type: string, payload = {}) => {
    const current = await view();
    return request.post(`${backend}/api/game/${hostSession.gameId}/action`, {
      headers: { Authorization: `Bearer ${hostSession.playerToken}` },
      data: {
        id: crypto.randomUUID(),
        type,
        payload,
        round: current.round,
        phase: current.phase,
        generation: current.generation,
      },
    });
  };
  return {
    host: pages[0],
    p1: pages[1],
    p2: pages[2],
    view,
    act,
    close: async () => {
      try {
        if ((await view()).phase !== 'COMPLETED') await act('end');
      } finally {
        await Promise.all(contexts.map((context) => context.close()));
      }
    },
  };
}
async function panel(page: Page) {
  const controls = page.locator('details.host-controls');
  if (!(await controls.evaluate((node) => (node as HTMLDetailsElement).open)))
    await controls.locator('summary').first().click();
  return controls;
}
async function typeClue(page: Page, clue: string, submit = false) {
  await page.getByLabel('Clue 1', { exact: true }).fill(clue);
  if (submit)
    await page
      .getByRole('button', { name: 'Submit clues', exact: true })
      .click();
  else
    await expect(page.getByText('Draft saved', { exact: false })).toBeVisible();
}

test('deadline submits saved clues and the saved answer even when the guesser disconnects', async ({
  browser,
  request,
}) => {
  const r = await room(browser, request, { clueSeconds: 5, guessSeconds: 5 });
  const { host, p1, p2, view } = r;
  try {
    await host.getByRole('button', { name: 'Start game', exact: true }).click();
    await expect(p1.getByTestId('mystery-word')).toBeVisible();
    const word = await p1.getByTestId('mystery-word').innerText();
    await typeClue(p1, 'quartz');
    await typeClue(p2, 'velvet');
    await p1.reload();
    await expect(p1.getByLabel('Clue 1', { exact: true })).toHaveValue(
      'quartz',
    );
    expect((await view()).ownClueDraft).toBeNull();
    expect((await view()).word).toBeUndefined();
    let controls = await panel(host);
    await controls.getByLabel('Clue timer', { exact: true }).check();
    await expect(host.getByRole('timer')).toBeVisible();
    await expect(
      p1.getByRole('button', { name: 'Finalize & reveal clues' }),
    ).toBeVisible({ timeout: 12_000 });
    expect((await view()).submitted.length).toBe(2);
    await controls.getByLabel('Guess timer', { exact: true }).check();
    await p1.getByRole('button', { name: 'Finalize & reveal clues' }).click();
    await host.getByLabel('Your one answer').fill('unfinished answer');
    await expect(host.getByText('Draft saved', { exact: false })).toBeVisible();
    await expect
      .poll(
        async () => {
          const current = await view();
          return current.deadline! - current.serverNow;
        },
        { timeout: 6000, intervals: [100] },
      )
      .toBeLessThan(1400);
    await host.getByLabel('Your one answer').fill(word);
    await expect(host.getByText('Draft saved', { exact: false })).toBeVisible();
    await host.context().setOffline(true);
    await expect(p2.getByText('You got it! +1 point')).toBeVisible({
      timeout: 12_000,
    });
    expect((await view()).result?.guess).toBe(word);
    expect((await view()).score).toBe(1);
    await host.context().setOffline(false);
    await host.reload();
    await expect(host.getByText('You got it! +1 point')).toBeVisible();
  } finally {
    await r.close();
  }
});

test('timer and party switches update every screen immediately, with large delegated/host result buttons and endless scoring', async ({
  browser,
  request,
}) => {
  const r = await room(browser, request, {
    scoring: 'infinite',
    guessTimer: true,
    guessSeconds: 60,
  });
  const { host, p1, p2, view } = r;
  try {
    await host.getByRole('button', { name: 'Start game', exact: true }).click();
    await typeClue(p1, 'quartz', true);
    await typeClue(p2, 'velvet', true);
    await p1.getByRole('button', { name: 'Finalize & reveal clues' }).click();
    await expect(host.getByLabel('Your one answer')).toBeVisible();
    const controls = await panel(host);
    await controls.getByLabel(/Guessing mode/).selectOption('verbal');
    await expect(
      host.getByRole('heading', { name: 'Say your answer aloud' }),
    ).toBeVisible();
    await expect(host.getByLabel('Your one answer')).toHaveCount(0);
    await expect(
      p1.getByRole('button', { name: 'Correct guess', exact: true }),
    ).toBeVisible();
    await expect(
      p1.getByRole('button', { name: 'Wrong guess', exact: true }),
    ).toBeVisible();
    expect(
      (await p1
        .getByRole('button', { name: 'Correct guess', exact: true })
        .boundingBox())!.height,
    ).toBeGreaterThanOrEqual(70);
    await controls.getByLabel('Guess timer', { exact: true }).uncheck();
    await expect(host.getByRole('timer')).toHaveCount(0);
    await expect(p1.getByRole('timer')).toHaveCount(0);
    expect((await view()).deadline).toBeNull();
    await controls.getByLabel('Guess timer', { exact: true }).check();
    await expect(host.getByRole('timer')).toBeVisible();
    await expect(p1.getByRole('timer')).toBeVisible();
    await controls.getByLabel(/Guessing mode/).selectOption('typed');
    await expect(host.getByLabel('Your one answer')).toBeVisible();
    await host.getByLabel('Your one answer').fill('not committed');
    await expect(host.getByText('Draft saved', { exact: false })).toBeVisible();
    await controls.getByLabel(/Guessing mode/).selectOption('verbal');
    await expect(host.getByLabel('Your one answer')).toHaveCount(0);
    expect((await view()).committedGuess).toBeUndefined();
    await p1
      .getByRole('button', { name: 'Correct guess', exact: true })
      .click();
    expect((await view()).score).toBe(1);
    expect((await view()).remaining).toBeNull();
    await host.getByRole('button', { name: 'Next word →' }).click();
    await typeClue(host, 'quartz', true);
    await typeClue(p2, 'velvet', true);
    await host.getByRole('button', { name: 'Finalize & reveal clues' }).click();
    await expect(
      p1.getByRole('heading', { name: 'Say your answer aloud' }),
    ).toBeVisible();
    await expect(p1.getByLabel('Your one answer')).toHaveCount(0);
    await host
      .getByRole('button', { name: 'Wrong guess', exact: true })
      .click();
    expect((await view()).score).toBe(1);
    expect((await view()).remaining).toBeNull();
    await host.screenshot({
      path: 'test-results/endless-party-host.png',
      fullPage: true,
    });
  } finally {
    await r.close();
  }
});

test('custom round count is honored and deadline submission can be switched off', async ({
  browser,
  request,
}) => {
  const r = await room(browser, request, { guessSeconds: 5 });
  const { host, p1, p2, view } = r;
  try {
    await host.getByLabel('Scoring mode').selectOption('fixed');
    await host.getByLabel('Number of rounds').fill('137');
    await host.getByRole('button', { name: 'Apply settings' }).click();
    await host.getByRole('button', { name: 'Start game', exact: true }).click();
    expect((await view()).remaining).toBe(137);
    await expect(p1.getByTestId('mystery-word')).toBeVisible();
    const word = await p1.getByTestId('mystery-word').innerText();
    await typeClue(p1, 'quartz', true);
    await typeClue(p2, 'velvet', true);
    await p1.getByRole('button', { name: 'Finalize & reveal clues' }).click();
    const controls = await panel(host);
    await controls
      .getByLabel('Submit saved answer when time runs out')
      .uncheck();
    await expect
      .poll(async () => (await view()).settings.autoSubmitGuess)
      .toBe(false);
    await host.getByLabel('Your one answer').fill(word);
    await expect(host.getByText('Draft saved', { exact: false })).toBeVisible();
    await controls.getByLabel('Guess timer', { exact: true }).check();
    await expect(host.getByText('Word passed', { exact: true })).toBeVisible({
      timeout: 12_000,
    });
    expect((await view()).score).toBe(0);
    expect((await view()).remaining).toBe(136);
  } finally {
    await r.close();
  }
});
