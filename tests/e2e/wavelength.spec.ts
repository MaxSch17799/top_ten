import {
  test,
  expect,
  type APIRequestContext,
  type Browser,
  type BrowserContext,
  type Page,
} from "@playwright/test";
import { waveScore, type WaveView } from "../../shared/wavelength";

const backend = process.env.WAVELENGTH_BACKEND_URL ?? "http://127.0.0.1:8787";
type Seat = {
  page: Page;
  gameId: string;
  playerId: string;
  playerToken: string;
};
async function view(api: APIRequestContext, seat: Seat): Promise<WaveView> {
  const response = await api.get(`${backend}/api/game/${seat.gameId}/state`, {
    headers: { Authorization: `Bearer ${seat.playerToken}` },
  });
  expect(response.ok()).toBeTruthy();
  return response.json();
}
async function action(
  api: APIRequestContext,
  seat: Seat,
  type: string,
  payload = {},
) {
  const s = await view(api, seat);
  return api.post(`${backend}/api/game/${seat.gameId}/action`, {
    headers: { Authorization: `Bearer ${seat.playerToken}` },
    data: {
      id: crypto.randomUUID(),
      type,
      generation: s.generation,
      roundId: s.roundId,
      phase: s.phase,
      revision: s.revision,
      payload,
    },
  });
}
async function session(page: Page): Promise<Seat> {
  return {
    page,
    ...(await page.evaluate(() =>
      JSON.parse(localStorage.getItem("top10-top10-session")!),
    )),
  };
}
async function group(browser: Browser, host: Page, count = 4) {
  const contexts: BrowserContext[] = [],
    seats: Seat[] = [];
  await host.goto("/");
  // Optional production QA authentication uses the existing override flow; no limit changes.
  if (process.env.WAVELENGTH_QA_ADMIN_PASSWORD) {
    const response = await host.request.post(
      `${backend}/api/admin/reauthorize`,
      {
        data: { password: process.env.WAVELENGTH_QA_ADMIN_PASSWORD },
      },
    );
    expect(response.ok()).toBeTruthy();
    const auth = (await response.json()) as { token: string };
    await host.evaluate(
      (token) => sessionStorage.setItem("top10-admin-override-token", token),
      auth.token,
    );
  }
  await host.getByRole("link", { name: /Wavelength/ }).click();
  await host.getByLabel("Your nickname").fill("Host");
  await host
    .getByRole("button", { name: "Create Wavelength lobby", exact: true })
    .click();
  await expect(
    host.getByRole("heading", { name: "Gather your minds" }),
  ).toBeVisible();
  seats.push(await session(host));
  for (let i = 1; i < count; i++) {
    const context = await browser.newContext({
      viewport: { width: 390, height: 844 },
      hasTouch: true,
      serviceWorkers: "block",
    });
    contexts.push(context);
    const page = await context.newPage();
    await page.goto(`/g/${seats[0].gameId}`);
    await page.getByLabel("Your nickname").fill(`Player ${i}`);
    await page.getByRole("button", { name: "Join lobby", exact: true }).click();
    await expect(
      page.getByRole("heading", { name: "Gather your minds" }),
    ).toBeVisible();
    seats.push(await session(page));
  }
  return { seats, contexts };
}
async function finish(api: APIRequestContext, host: Seat) {
  const v = await view(api, host);
  if (v.phase !== "COMPLETED")
    expect((await action(api, host, "end")).ok()).toBeTruthy();
}

test("competitive party: mobile dial, role-filtered HTTP/WebSockets, public display, reconnect and automatic reveal", async ({
  browser,
  page: host,
  request,
}, info) => {
  const { seats, contexts } = await group(browser, host),
    owner = seats[0],
    frames: WaveView[] = [];
  try {
    await host
      .getByRole("button", { name: "Invite players", exact: true })
      .click();
    await expect(
      host.getByRole("img", { name: "Join link QR code" }),
    ).toBeVisible();
    await host.getByRole("button", { name: "Close invite panel" }).click();
    const displayUrl = await host
      .getByRole("link", { name: /Shared display/ })
      .getAttribute("href");
    const display = await host.context().newPage();
    display.on("websocket", (ws) =>
      ws.on("framereceived", (frame) => {
        try {
          const data = JSON.parse(String(frame.payload));
          if (data.type === "STATE") frames.push(data.payload);
        } catch {
          /* heartbeat */
        }
      }),
    );
    await display.goto(displayUrl!);
    await expect(
      display.getByRole("heading", { name: "Gather your minds" }),
    ).toBeVisible();
    await host.getByRole("button", { name: "Start game", exact: true }).click();
    await expect(host.getByTestId("wave-private")).toBeVisible();
    const s = await view(request, owner);
    expect(s.phase).toBe("DIAL");
    expect(s.psychicId).toBe(owner.playerId);
    expect(s.scores).toEqual([0, 1]);
    expect(s.packs).toHaveLength(2);
    expect(
      s.packs.every((p) => p.count === 200 && !p.development),
    ).toBeTruthy();
    await expect(host.getByText(/Starter content/)).toHaveCount(0);
    const driver = seats.find((p) => p.playerId === s.controllerId)!,
      enemy = seats.find(
        (p) =>
          p.playerId !== s.psychicId &&
          s.players.find((x) => x.playerId === p.playerId)?.team === 1,
      )!;
    for (const seat of seats.slice(1)) {
      const publicView = await view(request, seat);
      expect(publicView).not.toHaveProperty("target");
      expect(publicView).not.toHaveProperty("candidates");
      expect(JSON.stringify(publicView)).not.toContain("playerToken");
    }
    const displayToken = displayUrl!.split("#")[1];
    const displayResponse = await request.get(
      `${backend}/api/game/${owner.gameId}/state`,
      { headers: { Authorization: `Bearer ${displayToken}` } },
    );
    expect(await displayResponse.json()).not.toHaveProperty("target");
    const forbidden = await request.post(
      `${backend}/api/game/${owner.gameId}/action`,
      {
        headers: { Authorization: `Bearer ${displayToken}` },
        data: { type: "claim" },
      },
    );
    expect(forbidden.status()).toBe(403);
    const forged = await request.get(
      `${backend}/api/game/${owner.gameId}/state?playerId=${owner.playerId}&role=HOST`,
      { headers: { Authorization: "Bearer fake-token" } },
    );
    expect(forged.status()).toBe(401);
    expect(
      (
        await action(request, owner, "lock", {
          value: 90,
          epoch: s.controlEpoch,
        })
      ).status(),
    ).toBe(403);
    await expect(display.getByTestId("wave-private")).toHaveCount(0);
    await expect(display.getByTestId("wave-target")).toHaveCount(0);
    await expect(
      display.getByRole("button", { name: "Lock dial" }),
    ).toHaveCount(0);
    await host.getByRole("button", { name: "Peek at target" }).click();
    await expect(host.getByTestId("wave-target")).toBeVisible();
    await host.reload();
    await expect(
      host.getByRole("button", { name: "Peek at target" }),
    ).toBeVisible();
    expect((await view(request, owner)).target).toBe(s.target);
    await expect(driver.page.getByRole("slider")).toBeVisible();
    const slider = driver.page.getByRole("slider"),
      box = (await slider.boundingBox())!;
    const angle = Math.max(0, Math.min(180, s.target!)),
      radians = (angle * Math.PI) / 180;
    await driver.page.touchscreen.tap(
      box.x + ((240 - Math.cos(radians) * 180) / 480) * box.width,
      box.y + ((240 - Math.sin(radians) * 180) / 270) * box.height,
    );
    await expect
      .poll(async () => Math.abs((await view(request, driver)).dial - angle))
      .toBeLessThan(0.1);
    // Keep the keyboard step toward the target, including centers beyond an endpoint.
    await slider.press(s.target! >= 90 ? "ArrowRight" : "ArrowLeft");
    await driver.page
      .getByRole("button", { name: "Lock dial", exact: true })
      .click();
    await expect(
      enemy.page.getByRole("button", { name: "← LEFT", exact: true }),
    ).toBeVisible();
    const frozen = await view(request, owner),
      side = s.target! < frozen.dial ? "left" : "right";
    await enemy.page
      .getByRole("button", {
        name: side === "left" ? "← LEFT" : "RIGHT →",
        exact: true,
      })
      .click();
    await expect(driver.page.getByTestId("wave-result")).toBeVisible();
    await expect(display.getByTestId("wave-target")).toBeVisible();
    const result = await view(request, owner);
    expect(result.result?.points).toBe(
      waveScore(s.target!, frozen.dial).points,
    );
    expect(result.result?.points).toBe(4);
    expect(result.result?.opponentPoints).toBe(0);
    expect(
      frames
        .filter((v) =>
          ["DIAL", "PREDICTION", "CLUE", "SELECTION"].includes(v.phase),
        )
        .every(
          (v) => !Object.hasOwn(v, "target") && !Object.hasOwn(v, "candidates"),
        ),
    ).toBeTruthy();
    await expect
      .poll(() =>
        driver.page
          .getByTestId("wave-target")
          .evaluate((el) => getComputedStyle(el).opacity),
      )
      .toBe("1");
    await driver.page.screenshot({
      path: info.outputPath("wavelength-mobile-reveal.png"),
      fullPage: true,
    });
    expect(
      await driver.page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBeTruthy();
    await host.getByRole("button", { name: "Next round", exact: true }).click();
    await expect.poll(async () => (await view(request, owner)).round).toBe(2);
    await display.close();
  } finally {
    await finish(request, owner);
    await Promise.all(contexts.map((c) => c.close()));
  }
});

test("cooperative remote: two players, private selection, written clue, chat and official seven-round completion", async ({
  browser,
  page: host,
  request,
}, info) => {
  const { seats, contexts } = await group(browser, host, 2),
    owner = seats[0];
  try {
    await host
      .getByLabel("Game format", { exact: true })
      .selectOption("cooperative");
    await host
      .getByLabel("Interaction mode", { exact: true })
      .selectOption("written");
    await host
      .getByLabel("Spectrum selection", { exact: true })
      .selectOption("two");
    await host
      .locator(".wave-lobby-settings")
      .getByRole("button", { name: "Apply settings", exact: true })
      .click();
    await host.getByRole("button", { name: "Start game", exact: true }).click();
    for (let round = 1; round <= 7; round++) {
      await expect
        .poll(async () => {
          const v = await view(request, owner);
          return `${v.round}:${v.phase}`;
        })
        .toBe(`${round}:SELECTION`);
      const s = await view(request, owner),
        psychic = seats.find((p) => p.playerId === s.psychicId)!,
        driver = seats.find((p) => p.playerId !== s.psychicId)!;
      expect(s.phase).toBe("SELECTION");
      expect(await view(request, driver)).not.toHaveProperty("candidates");
      expect(await view(request, psychic)).not.toHaveProperty("target");
      await psychic.page.locator(".wave-choices button").first().click();
      await expect(
        psychic.page.getByLabel("Your clue", { exact: true }),
      ).toBeVisible();
      await psychic.page
        .getByLabel("Your clue", { exact: true })
        .fill("A midnight picnic");
      await psychic.page
        .getByRole("button", { name: "Give clue", exact: true })
        .click();
      await expect(driver.page.getByTestId("wave-clue")).toHaveText(
        "“A midnight picnic”",
      );
      if (round === 1) {
        expect(
          (
            await action(request, psychic, "chat", {
              text: "Secret extra hint",
            })
          ).status(),
        ).toBe(403);
        await driver.page
          .getByLabel("Message", { exact: true })
          .fill("Let us try this together");
        await driver.page
          .getByRole("button", { name: "Send", exact: true })
          .click();
        await expect(psychic.page.getByRole("log")).toContainText(
          "Let us try this together",
        );
      }
      // Aim deliberately outside all scoring wedges so no bonus rounds prolong this test.
      const privateView = await view(request, psychic),
        value = privateView.target! < 90 ? 180 : 0;
      expect(
        (
          await action(request, driver, "lock", {
            value,
            epoch: privateView.controlEpoch,
          })
        ).ok(),
      ).toBeTruthy();
      await expect(host.getByTestId("wave-result")).toBeVisible();
      const result = await view(request, owner);
      expect(result.remaining).toBe(7 - round);
      expect(result.result?.opponentPoints).toBe(0);
      expect(result.result?.points).toBe(0);
      await host
        .getByRole("button", {
          name: round === 7 ? "Show final result" : "Next round",
          exact: true,
        })
        .click();
    }
    await expect
      .poll(async () => (await view(request, owner)).phase)
      .toBe("COMPLETED");
    await host.screenshot({
      path: info.outputPath("wavelength-cooperative.png"),
      fullPage: true,
    });
  } finally {
    await finish(request, owner);
    await Promise.all(contexts.map((c) => c.close()));
  }
});

test("minimal verbal preset, host confirmation, queued German content, corrections and safe round void", async ({
  browser,
  page: host,
  request,
}) => {
  const { seats, contexts } = await group(browser, host),
    owner = seats[0];
  try {
    await host.getByRole("button", { name: "Minimal verbal preset" }).click();
    await host.getByRole("button", { name: "Start game", exact: true }).click();
    const initial = await view(request, owner);
    expect(initial.settings.compact).toBeTruthy();
    expect(initial.roundSettings?.automaticScoring).toBe(false);
    const driver = seats.find((p) => p.playerId === initial.controllerId)!,
      enemy = seats.find(
        (p) =>
          initial.players.find((x) => x.playerId === p.playerId)?.team === 1,
      )!;
    expect(
      (
        await action(request, owner, "settings", {
          mode: "written",
          packId: "wavelength-de-classic-v1",
        })
      ).ok(),
    ).toBeTruthy();
    expect(
      (
        await action(request, driver, "lock", {
          value: 90,
          epoch: initial.controlEpoch,
        })
      ).ok(),
    ).toBeTruthy();
    expect(
      (await action(request, enemy, "predict", { side: "left" })).ok(),
    ).toBeTruthy();
    await expect(
      host.getByRole("button", { name: "Confirm score", exact: true }),
    ).toBeVisible();
    expect((await view(request, owner)).scores).toEqual([0, 1]);
    await host
      .getByRole("combobox", { name: "Points", exact: true })
      .selectOption("3");
    await host
      .getByRole("combobox", { name: "Opponent points", exact: true })
      .selectOption("0");
    await host
      .getByRole("button", { name: "Confirm score", exact: true })
      .click();
    await expect(host.getByTestId("wave-result")).toBeVisible();
    expect((await view(request, owner)).scores).toEqual([3, 1]);
    expect(
      (
        await action(request, owner, "correct", {
          points: 2,
          opponentPoints: 0,
          reason: "Agreed at the table",
        })
      ).ok(),
    ).toBeTruthy();
    expect((await view(request, owner)).scores).toEqual([2, 1]);
    expect(
      (
        await action(request, owner, "void", { reason: "Accidental clue" })
      ).ok(),
    ).toBeTruthy();
    const replay = await view(request, owner);
    expect(replay.scores).toEqual([0, 1]);
    expect(replay.roundId).not.toBe(initial.roundId);
    expect(replay.phase).toBe("CLUE");
    expect(replay.spectrum?.id).toMatch(/^de-/);
    expect(replay.roundSettings?.mode).toBe("written");
    await host.getByLabel("Interface language").selectOption("de");
    await expect(
      host.getByRole("heading", { name: "Ein Gedanke. Ein Hinweis." }),
    ).toBeVisible();
  } finally {
    await finish(request, owner);
    await Promise.all(contexts.map((c) => c.close()));
  }
});
