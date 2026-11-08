import {
  test,
  expect,
  type APIRequestContext,
  type Page,
} from "@playwright/test";
import {
  CLASSIC_RULES,
  DEFAULT_UNO_SETTINGS,
  type UnoView,
} from "../../shared/uno";

const backend = process.env.UNO_TEST_BACKEND ?? "http://127.0.0.1:8787";
type Session = {
  gameId: string;
  playerId: string;
  playerToken: string;
  hostToken?: string;
  role: "HOST" | "PLAYER";
};
async function session(page: Page): Promise<Session> {
  return page.evaluate(() =>
    JSON.parse(localStorage.getItem("top10-top10-session")!),
  );
}
async function view(api: APIRequestContext, s: Session): Promise<UnoView> {
  const r = await api.get(
    `${backend}/api/game/${s.gameId}/state?token=${s.playerToken}`,
  );
  expect(r.status()).toBe(200);
  return r.json();
}
async function act(
  api: APIRequestContext,
  session: Session,
  v: UnoView,
  type: string,
  payload = {},
) {
  return api.post(`${backend}/api/game/${session.gameId}/action`, {
    headers: { Authorization: `Bearer ${session.playerToken}` },
    data: {
      id: crypto.randomUUID(),
      type,
      payload,
      generation: v.generation,
      revision: v.revision,
      round: v.round,
    },
  });
}
async function setSession(page: Page, s: Session) {
  await page.goto("/");
  await page.evaluate((s) => {
    localStorage.setItem("top10-top10-session", JSON.stringify(s));
    localStorage.setItem(`party-session-${s.gameId}`, JSON.stringify(s));
  }, s);
  await page.goto(`/g/${s.gameId}`);
}
async function end(api: APIRequestContext, s: Session) {
  const v = await view(api, s);
  if (v.phase !== "COMPLETED") await act(api, s, v, "end");
}
async function autoplay(
  api: APIRequestContext,
  sessions: Session[],
  round: number,
) {
  const host = sessions[0];
  for (let i = 0; i < 1200; i++) {
    let v = await view(api, host);
    if (v.round > round || v.phase === "ROUND_OVER" || v.phase === "COMPLETED")
      return v;
    const active = sessions.find((p) => p.playerId === v.turn)!;
    expect(active).toBeTruthy();
    v = await view(api, active);
    let type = "draw",
      payload: Record<string, unknown> = {};
    if (v.phase === "COLOR") {
      type = "color";
      payload = { color: "red" };
    } else if (v.legalCardIds.length) {
      type = "play";
      const card = v.hand.find((c) => c.id === v.legalCardIds[0])!;
      const colors = ["red", "yellow", "green", "blue"];
      const color = colors.sort(
        (a, b) =>
          v.hand.filter((c) => c.color === b).length -
          v.hand.filter((c) => c.color === a).length,
      )[0];
      payload = {
        cardIds: [card.id],
        color,
        sayUno: true,
        target: sessions.find((p) => p.playerId !== active.playerId)!.playerId,
      };
    } else if (!v.canDraw && v.canPass) type = "pass";
    const r = await act(api, active, v, type, payload);
    expect(r.status(), await r.text()).toBe(200);
  }
  throw new Error("UNO round did not finish within 1200 actions");
}

test("UNO profiles, QR invites, three devices, private views, reconnect and full rounds", async ({
  page: host,
  browser,
  request,
}) => {
  test.setTimeout(180_000);
  const errors: string[] = [],
    frames: UnoView[] = [];
  host.on("pageerror", (e) => errors.push(e.message));
  host.on("websocket", (ws) =>
    ws.on("framereceived", (e) => {
      try {
        const p = JSON.parse(String(e.payload));
        if (p.type === "STATE") frames.push(p.payload);
      } catch {
        /* pong */
      }
    }),
  );
  const c1 = await browser.newContext({
      viewport: { width: 390, height: 844 },
      hasTouch: true,
    }),
    c2 = await browser.newContext({ viewport: { width: 768, height: 1024 } });
  const alice = await c1.newPage(),
    bob = await c2.newPage();
  let hs: Session | undefined;
  try {
    await host.goto("/");
    await host.getByRole("link", { name: /UNO/ }).click();
    await host.getByLabel("Your nickname").fill("Host");
    await host.getByRole("button", { name: "Create UNO lobby" }).click();
    await expect(
      host.getByRole("heading", { name: "Your table is waiting." }),
    ).toBeVisible();
    hs = await session(host);
    await host.getByRole("button", { name: "Invite players" }).click();
    await expect(
      host.getByRole("img", { name: "Join link QR code" }),
    ).toBeVisible();
    await host.getByRole("button", { name: "Close invite panel" }).click();
    for (const [page, nickname] of [
      [alice, "Alice"],
      [bob, "Bob"],
    ] as const) {
      await page.goto(`/g/${hs.gameId}`);
      await page.getByLabel("Your nickname").fill(nickname);
      await page
        .getByRole("button", { name: "Join lobby", exact: true })
        .click();
      await expect(
        page.getByRole("heading", { name: "Your table is waiting." }),
      ).toBeVisible();
    }
    await host.getByLabel("Rules profile").selectOption("chaos");
    await expect
      .poll(async () => (await view(request, hs!)).settings.profileId)
      .toBe("chaos");
    await host
      .getByText("Advanced rules & saved profiles", { exact: true })
      .click();
    await host.route("**/api/game/*/action", async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 400));
      await route.continue();
    });
    await host.getByLabel("Draw until playable", { exact: false }).check();
    await expect
      .poll(async () => (await view(request, hs!)).settings.rules.drawUntil)
      .toBe(true);
    await host.unroute("**/api/game/*/action");
    await host.getByLabel("Profile name", { exact: true }).fill("Friday chaos");
    await host
      .getByRole("button", { name: "Save as Profile", exact: true })
      .click();
    await expect(host.getByLabel("Rules profile")).toHaveValue(/custom-/);
    await host.reload();
    await expect(host.getByLabel("Rules profile")).toHaveValue(/custom-/);
    await host
      .getByText("Advanced rules & saved profiles", { exact: true })
      .click();
    await host
      .getByLabel("Profile name", { exact: true })
      .fill("Friends night");
    await host.getByRole("button", { name: "Update / rename" }).click();
    await expect
      .poll(async () => (await view(request, hs!)).settings.profileName)
      .toBe("Friends night");
    await host
      .getByLabel("Profile name", { exact: true })
      .fill("Duplicate rules");
    await host
      .getByRole("button", { name: "Save as Profile", exact: true })
      .click();
    await expect(host.getByLabel("Rules profile")).toHaveValue(/custom-/);
    await host.getByRole("button", { name: "Delete profile" }).click();
    await expect(
      host
        .getByLabel("Rules profile")
        .locator("option", { hasText: "Duplicate rules" }),
    ).toHaveCount(0);
    await host
      .getByLabel("Rules profile")
      .selectOption({ label: "Friends night" });
    await expect
      .poll(async () => (await view(request, hs!)).settings.profileName)
      .toBe("Friends night");
    await host.getByLabel("Game length").selectOption("rounds");
    await expect(host.getByLabel("Number of rounds")).toBeVisible();
    await host.getByLabel("Number of rounds").fill("2");
    await host.getByLabel("Number of rounds").blur();
    await expect
      .poll(async () => (await view(request, hs!)).settings.rounds)
      .toBe(2);
    await host.getByRole("button", { name: "Start game", exact: true }).click();
    await expect(alice.locator(".uno-hand-card")).toHaveCount(7);
    await expect(host.getByLabel("Rules profile")).toHaveCount(0);
    const sessions = [hs, await session(alice), await session(bob)];
    const state = await view(request, hs),
      own = await view(request, sessions[1]);
    expect(state.hand.every((c) => own.hand.every((o) => o.id !== c.id))).toBe(
      true,
    );
    await host.getByText("Host controls", { exact: true }).click();
    const displayHref = await host
      .getByRole("link", { name: "Open shared display" })
      .getAttribute("href");
    const display = await browser.newPage();
    await display.goto(displayHref!);
    await expect(display.locator(".uno-table")).toBeVisible();
    await expect(display.locator(".uno-hand-card")).toHaveCount(0);
    await display.close();
    expect(
      (
        await act(request, sessions[1], own, "settings", { mode: "single" })
      ).status(),
    ).toBe(403);
    expect(
      (await act(request, hs, state, "play", { cardIds: ["forged"] })).status(),
    ).toBe(400);
    await alice.screenshot({
      path: "test-results/uno-mobile-three.png",
      fullPage: true,
    });
    expect(
      await alice.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    const originalIds = own.hand.map((c) => c.id);
    await c1.setOffline(true);
    await c1.setOffline(false);
    await alice.reload();
    await expect(alice.locator(".uno-hand-card")).toHaveCount(7);
    expect((await view(request, sessions[1])).hand.map((c) => c.id)).toEqual(
      originalIds,
    );
    const result = await autoplay(request, sessions, 1);
    expect(result.phase).toBe("ROUND_OVER");
    expect(result.result?.winner).toBeTruthy();
    await expect
      .poll(async () => (await view(request, hs!)).round, { timeout: 20_000 })
      .toBe(2);
    const final = await autoplay(request, sessions, 2);
    expect(final.phase).toBe("COMPLETED");
    expect(final.history).toHaveLength(2);
    await expect(
      host.getByText("Final standings", { exact: true }),
    ).toBeVisible();
    expect(errors).toEqual([]);
    expect(
      frames.every(
        (v) =>
          !("deck" in v) && !("hands" in v) && v.yourPlayerId === hs!.playerId,
      ),
    ).toBe(true);
    await host
      .getByRole("button", { name: "Return to lobby / restart" })
      .click();
    await expect(host.getByLabel("Rules profile")).toHaveValue(/custom-/);
    expect(
      await host
        .getByLabel("Rules profile")
        .locator("option", { hasText: "Friends night" })
        .count(),
    ).toBe(1);
  } finally {
    if (hs) await end(request, hs);
    await c1.close();
    await c2.close();
  }
});

test("ten-player mobile table, selection, color controls, reduced motion and shared display privacy", async ({
  page,
  browser,
  request,
}) => {
  const created = await request.post(`${backend}/api/game/create`, {
    data: {
      gameType: "uno",
      hostNickname: "Host",
      settings: DEFAULT_UNO_SETTINGS,
    },
  });
  expect(created.status()).toBe(200);
  const host = { ...(await created.json()), role: "HOST" } as Session,
    sessions = [host];
  try {
    for (let i = 1; i < 10; i++) {
      const joined = await request.post(
        `${backend}/api/game/${host.gameId}/join`,
        { data: { nickname: `Player ${i}` } },
      );
      expect(joined.status()).toBe(200);
      sessions.push({
        ...(await joined.json()),
        gameId: host.gameId,
        role: "PLAYER",
      });
    }
    let v = await view(request, host);
    expect((await act(request, host, v, "start")).status()).toBe(200);
    v = await view(request, host);
    const active = sessions.find((s) => s.playerId === v.turn)!;
    await page.setViewportSize({ width: 390, height: 844 });
    await page.emulateMedia({ reducedMotion: "reduce" });
    await setSession(page, active);
    await expect(page.locator(".uno-table")).toBeVisible();
    await expect(page.locator(".uno-opponents .uno-player")).toHaveCount(9);
    if (v.phase === "COLOR") {
      await page.getByRole("button", { name: "red", exact: true }).click();
    }
    v = await view(request, active);
    if (v.legalCardIds.length) {
      const c = v.hand.find((c) => c.id === v.legalCardIds[0])!;
      await page.locator(`[data-card-id="${c.id}"]`).click();
      await expect(page.locator(`[data-card-id="${c.id}"]`)).toHaveAttribute(
        "aria-pressed",
        "true",
      );
      if (c.color === null)
        await page
          .getByRole("button", {
            name: "Play Wild and choose green",
            exact: true,
          })
          .click();
      else await page.getByRole("button", { name: "Play card" }).click();
      await expect
        .poll(async () => (await view(request, active)).top?.id)
        .toBe(c.id);
    } else {
      await page
        .getByRole("button", { name: "Draw a card", exact: true })
        .click();
    }
    await page.screenshot({
      path: "test-results/uno-mobile-ten.png",
      fullPage: true,
    });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    const positions = await page.evaluate(() => ({
      opponents: Array.from(document.querySelectorAll(".uno-player")).map(
        (n) => n.getBoundingClientRect().bottom,
      ),
      banner: document
        .querySelector(".uno-turn-banner")!
        .getBoundingClientRect().top,
    }));
    expect(Math.max(...positions.opponents)).toBeLessThan(positions.banner);
    const cards = await page.locator(".uno-hand-card").evaluateAll((nodes) =>
      nodes.map((n) => ({
        width: n.getBoundingClientRect().width,
        height: n.getBoundingClientRect().height,
      })),
    );
    expect(cards.every((c) => c.width >= 44 && c.height >= 44)).toBe(true);
    await page.setViewportSize({ width: 844, height: 390 });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    const outsider = await browser.newPage();
    await outsider.goto(`/g/${host.gameId}`);
    await outsider.getByLabel("Your nickname").fill("Late");
    await outsider
      .getByRole("button", { name: "Join lobby", exact: true })
      .click();
    await expect(outsider.getByRole("alert")).toContainText(
      "This game has started",
    );
    await outsider.close();
  } finally {
    await end(request, host);
  }
});

test("classic two-player game completes through authenticated multiplayer API", async ({
  request,
}) => {
  const r = await request.post(`${backend}/api/game/create`, {
    data: {
      gameType: "uno",
      hostNickname: "A",
      settings: { ...DEFAULT_UNO_SETTINGS, rules: CLASSIC_RULES },
    },
  });
  expect(r.status()).toBe(200);
  const host = { ...(await r.json()), role: "HOST" } as Session;
  try {
    const joined = await request.post(
        `${backend}/api/game/${host.gameId}/join`,
        { data: { nickname: "B" } },
      ),
      guest = {
        ...(await joined.json()),
        gameId: host.gameId,
        role: "PLAYER",
      } as Session;
    expect(
      (await act(request, host, await view(request, host), "start")).status(),
    ).toBe(200);
    const final = await autoplay(request, [host, guest], 1);
    expect(final.phase).toBe("COMPLETED");
    expect(final.result?.winner).toBeTruthy();
    expect(final.players.reduce((n, p) => n + p.wins, 0)).toBe(1);
  } finally {
    await end(request, host);
  }
});
