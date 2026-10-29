import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { chromium, expect } from '@playwright/test';
import { validateWordBank } from '../shared/wordBank.mjs';

const frontend = (
  process.env.LIVE_FRONTEND_URL ?? 'https://top-ten.pages.dev'
).replace(/\/$/, '');
const backend = (
  process.env.LIVE_BACKEND_URL ?? 'https://top-ten.maxschimmel17799.workers.dev'
).replace(/\/$/, '');
const sessions = [];
const errors = [];
async function json(url, options) {
  const response = await fetch(url, options);
  assert(response.ok, `HTTP ${response.status} for ${new URL(url).pathname}`);
  return response.json();
}
const getSession = (page) =>
  page.evaluate(() => JSON.parse(localStorage.getItem('top10-top10-session')));
const getState = (session) =>
  json(
    `${backend}/api/game/${session.gameId}/state?token=${session.playerToken}`,
  );

for (const language of ['en', 'de']) {
  const bank = await json(
    `${frontend}/banks/just-one/${language}_classic_v1.json`,
  );
  validateWordBank(bank);
  assert.equal(bank.id, `just_one_${language}_classic_v1`);
  assert.equal(bank.cards.length, 110);
  assert.notEqual(bank.development, true);
}
const catalog = await json(`${backend}/api/just-one/banks`);
assert.equal(catalog.banks.length, 2);
assert(
  catalog.banks.every((bank) => bank.cardCount === 110 && !bank.development),
);
const browser = await chromium.launch();
try {
  const hostContext = await browser.newContext({
    viewport: { width: 1365, height: 1000 },
  });
  const host = await hostContext.newPage();
  host.on('pageerror', (error) => errors.push(error.message));
  await host.goto(frontend);
  await expect(host.getByRole('link', { name: /Top 10/ })).toBeVisible();
  await expect(host.getByRole('link', { name: /Just One/ })).toBeVisible();

  for (const language of ['en', 'de']) {
    const guestContexts = await Promise.all(
      [390, 768].map((width) =>
        browser.newContext({ viewport: { width, height: 900 } }),
      ),
    );
    try {
      await host.goto(`${frontend}/just-one`);
      await host
        .getByLabel('Your nickname')
        .fill(`Deploy check ${language.toUpperCase()}`);
      await host.getByLabel('Word language').selectOption(language);
      await host.getByRole('button', { name: 'Create Just One lobby' }).click();
      await expect(
        host.getByRole('heading', { name: 'Gather your team' }),
      ).toBeVisible();
      const session = await getSession(host);
      sessions.push({ ...session, gameType: 'just-one' });
      const guests = [];
      for (const [i, context] of guestContexts.entries()) {
        const page = await context.newPage();
        page.on('pageerror', (error) => errors.push(error.message));
        await page.goto(`${frontend}/g/${session.gameId}`);
        await page.getByLabel('Your nickname').fill(`Deploy clue ${i + 1}`);
        await page
          .getByRole('button', { name: 'Join lobby', exact: true })
          .click();
        await expect(
          page.getByRole('heading', { name: 'Gather your team' }),
        ).toBeVisible();
        guests.push(page);
      }
      await host.getByLabel('Scoring mode').selectOption('fixed');
      await host.getByLabel('Number of rounds').fill('1');
      await host.getByLabel(/Clues per person/).selectOption('1');
      await host.getByRole('button', { name: 'Apply settings' }).click();
      await host
        .getByRole('button', { name: 'Start game', exact: true })
        .click();
      await expect(guests[0].getByTestId('mystery-word')).toBeVisible();
      const word = await guests[0].getByTestId('mystery-word').innerText();
      const hidden = await getState(session);
      assert.equal(hidden.word, undefined);
      assert.equal(hidden.options, undefined);
      assert.equal(hidden.settings.bankId, `just_one_${language}_classic_v1`);
      for (const [i, page] of guests.entries()) {
        await page
          .getByLabel('Clue 1', { exact: true })
          .fill(i === 0 ? 'quartz' : 'velvet');
        await page
          .getByRole('button', { name: 'Submit clues', exact: true })
          .click();
      }
      await guests[0]
        .getByRole('button', { name: 'Finalize & reveal clues' })
        .click();
      await expect(host.getByLabel('Your one answer')).toBeVisible();
      await host.getByLabel('Your one answer').fill(word);
      await host.getByRole('button', { name: 'Commit answer' }).click();
      await expect(host.getByText('You got it! +1 point')).toBeVisible();
      await host.getByRole('button', { name: 'Show final score' }).click();
      await expect(host.getByRole('heading', { name: '1 / 1' })).toBeVisible();
      const final = await getState(session);
      assert.equal(final.phase, 'COMPLETED');
      assert.equal(final.score, 1);
      assert(
        await guests[0].evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      );
      await mkdir('test-results', { recursive: true });
      await guests[0].screenshot({
        path: `test-results/production-just-one-${language}-mobile.png`,
        fullPage: true,
      });
      console.log(
        `PASS: ${language.toUpperCase()} bank, three-player live game, secret filtering, scoring and mobile layout`,
      );
    } finally {
      await Promise.all(guestContexts.map((context) => context.close()));
    }
  }

  await host.goto(`${frontend}/host`);
  await host.getByPlaceholder('Host nickname').fill('Deploy Top10 check');
  await host.getByRole('button', { name: 'Create lobby', exact: true }).click();
  await expect(host.getByRole('heading', { name: 'Seat order' })).toBeVisible();
  const top10 = await getSession(host);
  sessions.push({ ...top10, gameType: 'top10' });
  await host.getByRole('button', { name: 'Start Round 1' }).click();
  await expect(
    host.getByRole('button', { name: 'Next round', exact: true }),
  ).toBeVisible();
  const top10State = await getState(top10);
  assert(top10State.yourSecretNumber >= 1 && top10State.yourSecretNumber <= 10);
  await host.getByRole('button', { name: 'End game', exact: true }).click();
  await expect(host.getByRole('heading', { name: 'Game ended' })).toBeVisible();
  console.log('PASS: live Top 10 lobby, game start, secret number and end');

  await host.goto(frontend);
  await host.waitForFunction(() => !!navigator.serviceWorker.controller);
  const cachedApis = await host.evaluate(async () => {
    const requests = (
      await Promise.all(
        (await caches.keys()).map(async (key) =>
          (await caches.open(key)).keys(),
        ),
      )
    ).flat();
    return requests
      .filter((request) => new URL(request.url).pathname.startsWith('/api/'))
      .map((request) => request.url);
  });
  assert.deepEqual(cachedApis, []);
  assert.deepEqual(errors, []);
  await host.screenshot({
    path: 'test-results/production-game-selection.png',
    fullPage: true,
  });
  console.log(
    `PASS: PWA activation, no cached gameplay API responses, no browser errors\nVerified ${frontend}`,
  );
} finally {
  // Finish any check lobby even when an assertion fails halfway through.
  for (const session of sessions) {
    try {
      const state = await getState(session);
      if (session.gameType === 'just-one' && state.phase !== 'COMPLETED') {
        await json(`${backend}/api/game/${session.gameId}/action`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${session.playerToken}`,
          },
          body: JSON.stringify({
            id: crypto.randomUUID(),
            type: 'end',
            generation: state.generation,
            round: state.round,
            phase: state.phase,
          }),
        });
      } else if (session.gameType === 'top10' && state.phase !== 'ENDED') {
        await json(`${backend}/api/game/${session.gameId}/end`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ hostToken: session.hostToken }),
        });
      }
    } catch {
      /* keep the original verification failure */
    }
  }
  await browser.close();
}
