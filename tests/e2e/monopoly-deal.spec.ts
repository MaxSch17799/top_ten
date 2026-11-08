import {
  test,
  expect,
  type APIRequestContext,
  type Page,
} from "@playwright/test";
import {
  CLASSIC_DEAL_RULES,
  DEAL_GROUPS,
  DEFAULT_DEAL_SETTINGS,
  buildableDealColor,
  completeDealSet,
  dealAssets,
  dealRent,
  type DealCard,
  type DealColor,
  type DealView,
} from "../../shared/monopolyDeal";

const backend = process.env.DEAL_TEST_BACKEND ?? "http://127.0.0.1:8787";
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
async function view(api: APIRequestContext, s: Session): Promise<DealView> {
  const r = await api.get(
    `${backend}/api/game/${s.gameId}/state?token=${s.playerToken}`,
  );
  expect(r.status()).toBe(200);
  return r.json();
}
async function act(
  api: APIRequestContext,
  s: Session,
  v: DealView,
  type: string,
  payload: Record<string, unknown> = {},
  id = crypto.randomUUID(),
) {
  return api.post(`${backend}/api/game/${s.gameId}/action`, {
    headers: { Authorization: `Bearer ${s.playerToken}` },
    data: {
      id,
      type,
      payload,
      generation: v.generation,
      revision: v.revision,
      round: v.round,
    },
  });
}
async function mustAct(
  api: APIRequestContext,
  s: Session,
  v: DealView,
  type: string,
  payload: Record<string, unknown> = {},
) {
  const r = await act(api, s, v, type, payload);
  expect(r.status(), await r.text()).toBe(200);
}
async function end(api: APIRequestContext, s: Session) {
  const v = await view(api, s);
  if (v.phase !== "COMPLETED") await mustAct(api, s, v, "end");
}
async function setSession(page: Page, s: Session) {
  await page.goto("/");
  await page.evaluate((s) => {
    localStorage.setItem("top10-top10-session", JSON.stringify(s));
    localStorage.setItem(`party-session-${s.gameId}`, JSON.stringify(s));
  }, s);
  await page.goto(`/g/${s.gameId}`);
}
function place(
  v: DealView,
  owner: string,
  c: DealCard,
): { color: DealColor; setId: string } {
  const sets = v.players.find((p) => p.playerId === owner)!.table.sets;
  const options = c.colors.flatMap((color) =>
    sets
      .filter(
        (s) => s.color === color && s.cards.length < DEAL_GROUPS[color].size,
      )
      .map((set) => ({
        color,
        setId: set.id,
        priority: set.cards.length / DEAL_GROUPS[color].size,
      })),
  );
  options.sort((a, b) => b.priority - a.priority);
  return (
    options[0] ?? {
      color:
        c.colors.find((color) => !sets.some((s) => s.color === color)) ??
        c.colors[0],
      setId: "",
    }
  );
}
function bot(v: DealView) {
  const id = v.yourPlayerId,
    own = v.players.find((p) => p.playerId === id)!;
  if (v.pending) {
    const p = v.pending;
    if (p.stage === "response") {
      const no = v.hand.find((c) => c.effect === "justSayNo");
      return {
        type: "respond",
        payload:
          no && p.depth < 3 ? { no: true, cardId: no.id } : { no: false },
      };
    }
    if (p.stage === "placement")
      return {
        type: "place-received",
        payload: place(v, id, p.placements[0].card),
      };
    const assets = dealAssets(own.table),
      selected: string[] = [];
    let amount = 0;
    for (const c of assets) {
      if (amount >= p.amount) break;
      selected.push(c.id);
      amount += c.value;
    }
    return { type: "pay", payload: { cardIds: selected } };
  }
  if (v.phase === "DISCARD")
    return {
      type: "discard",
      payload: {
        cardIds: v.hand
          .slice(0, v.hand.length - v.settings.rules.handLimit)
          .map((c) => c.id),
      },
    };
  if (v.playsLeft === 0 || !v.hand.length)
    return { type: "end-turn", payload: {} };
  const opponents = v.players.filter((p) => p.playerId !== id);
  for (const c of v.hand) {
    if (c.effect === "dealBreaker") {
      const target = opponents.find((p) => p.table.sets.some(completeDealSet));
      if (target)
        return {
          type: "play",
          payload: {
            cardId: c.id,
            mode: "action",
            target: target.playerId,
            targetSetId: target.table.sets.find(completeDealSet)!.id,
          },
        };
    }
    if (c.effect === "slyDeal" || c.effect === "forcedDeal") {
      const target = opponents.find((p) =>
          p.table.sets.some((s) => !completeDealSet(s)),
        ),
        give = own.table.sets.flatMap((s) => s.cards)[0];
      if (target && (c.effect === "slyDeal" || give))
        return {
          type: "play",
          payload: {
            cardId: c.id,
            mode: "action",
            target: target.playerId,
            targetCardId: target.table.sets.find((s) => !completeDealSet(s))!
              .cards[0].id,
            giveCardId: give?.id,
          },
        };
    }
  }
  const property = v.hand.find(
    (c) => c.kind === "property" || c.kind === "wild",
  );
  if (property)
    return {
      type: "play",
      payload: {
        cardId: property.id,
        mode: "property",
        ...place(v, id, property),
      },
    };
  for (const c of v.hand) {
    if (["passGo", "birthday", "debtCollector"].includes(c.effect ?? ""))
      return {
        type: "play",
        payload: {
          cardId: c.id,
          mode: "action",
          target: opponents[0].playerId,
        },
      };
    if (c.effect === "rent" || c.effect === "wildRent") {
      const set = own.table.sets.find(
        (s) =>
          dealRent(s) > 0 &&
          (c.effect === "wildRent" || c.colors.includes(s.color)),
      );
      if (set)
        return {
          type: "play",
          payload: {
            cardId: c.id,
            mode: "action",
            setId: set.id,
            target: opponents[0].playerId,
            doubleIds: v.hand
              .filter((c) => c.effect === "doubleRent")
              .slice(0, v.playsLeft - 1)
              .map((c) => c.id),
          },
        };
    }
    if (c.effect === "house" || c.effect === "hotel") {
      const set = own.table.sets.find(
        (s) =>
          completeDealSet(s) &&
          buildableDealColor(s.color) &&
          (c.effect === "house" ? !s.house : s.house && !s.hotel),
      );
      if (set)
        return {
          type: "play",
          payload: { cardId: c.id, mode: "action", setId: set.id },
        };
    }
  }
  return { type: "play", payload: { cardId: v.hand[0].id, mode: "bank" } };
}

test("Monopoly Deal lobby, persistent profile CRUD and rules locking", async ({
  page,
  request,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await page.getByRole("link", { name: /Monopoly Deal/ }).click();
  await expect(
    page.getByText("2–5 players · together or online"),
  ).toBeVisible();
  await page.getByLabel("Your nickname").fill("Profile host");
  await page
    .getByRole("button", { name: "Create Monopoly Deal lobby" })
    .click();
  await expect(
    page.getByRole("heading", { name: "Waiting for the first deal" }),
  ).toBeVisible();
  const host = await session(page);
  try {
    await page.getByText("Advanced rules & saved profiles").click();
    await page.getByLabel("Colors to win").fill("2");
    await page.getByLabel("Saved profile name").fill("Friday Deal");
    await page
      .getByRole("button", { name: "Save profile", exact: true })
      .click();
    await page
      .getByRole("combobox", { name: "Rules profile", exact: true })
      .selectOption({ label: "Friday Deal" });
    await page.getByLabel("Starting hand", { exact: true }).fill("6");
    await page
      .getByRole("button", { name: "Save profile", exact: true })
      .click();
    await page.getByLabel("Saved profile name").fill("Friends Deal");
    await page.getByRole("button", { name: "Rename", exact: true }).click();
    await page.getByRole("button", { name: "Duplicate", exact: true }).click();
    await expect(
      page.getByRole("option", { name: "Friends Deal copy", exact: true }),
    ).toBeAttached();
    await page.getByRole("button", { name: "Delete", exact: true }).click();
    await page
      .getByRole("combobox", { name: "Rules profile", exact: true })
      .selectOption({ label: "Friends Deal" });
    await page.getByRole("button", { name: "Apply settings" }).click();
    await expect
      .poll(async () => (await view(request, host)).settings.rules.startingHand)
      .toBe(6);
    await page.reload();
    await expect(
      page.getByRole("combobox", { name: "Rules profile", exact: true }),
    ).toHaveValue(/custom-/);
    const profiles = await page.evaluate(() =>
      JSON.parse(localStorage.getItem("game-night-deal-profiles-v1")!),
    );
    expect(profiles).toHaveLength(1);
    expect(profiles[0].name).toBe("Friends Deal");
    expect(profiles[0].rules.setsToWin).toBe(2);
    expect(profiles[0].rules.startingHand).toBe(6);
    const joined = await request.post(
      `${backend}/api/game/${host.gameId}/join`,
      { data: { nickname: "Friend" } },
    );
    expect(joined.status()).toBe(200);
    await page.getByRole("button", { name: "Shuffle & deal" }).click();
    await expect(
      page.getByRole("heading", { name: "Your hand" }),
    ).toBeVisible();
    const v = await view(request, host);
    const locked = await act(request, host, v, "settings", {
      settings: DEFAULT_DEAL_SETTINGS,
    });
    expect(locked.status()).toBe(400);
    expect((await locked.json()).message).toMatch(/locked/);
    await expect(
      page.getByRole("button", { name: "Apply settings" }),
    ).toHaveCount(0);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await page.screenshot({
      path: "test-results/deal-mobile-table.png",
      fullPage: true,
    });
  } finally {
    await end(request, host);
  }
});

test("three live devices, private WebSockets, QR, desktop/mobile, responses, reconnect, complete match", async ({
  page: hostPage,
  browser,
  request,
}) => {
  test.setTimeout(240_000);
  const secondContext = await browser.newContext({
      viewport: { width: 375, height: 812 },
    }),
    thirdContext = await browser.newContext({
      viewport: { width: 1365, height: 900 },
    }),
    displayContext = await browser.newContext({
      viewport: { width: 1280, height: 800 },
    });
  const second = await secondContext.newPage(),
    third = await thirdContext.newPage(),
    display = await displayContext.newPage(),
    errors: string[] = [],
    frames: DealView[] = [];
  for (const p of [hostPage, second, third, display]) {
    p.on("pageerror", (e) => errors.push(e.message));
    p.on("console", (e) => {
      if (e.type() === "error" && /same key|unique.*key/i.test(e.text()))
        errors.push(e.text());
    });
  }
  hostPage.on("websocket", (ws) =>
    ws.on("framereceived", (e) => {
      try {
        const f = JSON.parse(String(e.payload));
        if (f.type === "STATE") frames.push(f.payload);
      } catch {
        /* heartbeat */
      }
    }),
  );
  await hostPage.setViewportSize({ width: 390, height: 844 });
  await hostPage.goto("/monopoly-deal");
  await hostPage.getByLabel("Your nickname").fill("Anna");
  await hostPage
    .getByRole("button", { name: "Create Monopoly Deal lobby" })
    .click();
  await expect(
    hostPage.getByRole("button", { name: "Shuffle & deal" }),
  ).toBeVisible();
  const host = await session(hostPage);
  try {
    await hostPage.getByRole("button", { name: "Invite", exact: true }).click();
    await expect(hostPage.locator("canvas, img").first()).toBeVisible();
    await hostPage
      .getByRole("button", { name: /Close invite|Close add|Close/i })
      .click();
    for (const [p, nickname] of [
      [second, "Ben"],
      [third, "Clara"],
    ] as const) {
      await p.goto(`/g/${host.gameId}`);
      await p.getByLabel("Your nickname").fill(nickname);
      await p.getByRole("button", { name: "Join lobby" }).click();
      await expect(
        p.getByRole("heading", { name: "Waiting for the first deal" }),
      ).toBeVisible();
    }
    const sessions = [host, await session(second), await session(third)],
      pages = [hostPage, second, third];
    await hostPage
      .getByRole("combobox", { name: "Rules profile", exact: true })
      .selectOption("classic");
    await hostPage.getByLabel("Match length").selectOption("bestOf");
    await hostPage.getByRole("button", { name: "Apply settings" }).click();
    await expect
      .poll(async () => (await view(request, host)).settings.mode)
      .toBe("bestOf");
    const lobby = await view(request, host);
    await display.goto(`/g/${host.gameId}/display?token=${lobby.displayToken}`);
    await expect(display.getByText("Waiting for the first deal")).toBeVisible();
    await hostPage.getByRole("button", { name: "Shuffle & deal" }).click();
    await expect(
      hostPage.getByRole("heading", { name: "Your hand" }),
    ).toBeVisible();
    let v = await view(request, host);
    const first =
      v.hand.find((c) => c.kind === "property") ??
      v.hand.find((c) => c.kind === "money") ??
      v.hand[0];
    await hostPage
      .getByRole("button", { name: `Select ${first.title}`, exact: true })
      .first()
      .click();
    await expect(hostPage.getByRole("dialog")).toBeVisible();
    if (first.kind === "property" || first.kind === "wild")
      await hostPage
        .getByRole("button", { name: "Place property", exact: true })
        .click();
    else {
      if (first.kind === "action")
        await hostPage
          .getByRole("button", { name: `Bank ${first.value}M`, exact: true })
          .click();
      await hostPage
        .getByRole("button", { name: "Add to bank · one play", exact: true })
        .click();
    }
    await expect(hostPage.getByRole("dialog")).toHaveCount(0);
    await expect
      .poll(async () => (await view(request, host)).playsLeft)
      .toBe(2);
    const outsider = await request.get(
      `${backend}/api/game/${host.gameId}/state`,
    );
    expect(outsider.status()).toBe(401);
    v = await view(request, host);
    const wrong = await act(request, sessions[1], v, "end-turn");
    expect(wrong.status()).toBe(400);
    const displayView = await request.get(
      `${backend}/api/game/${host.gameId}/state?token=${lobby.displayToken}`,
    );
    const safe = await displayView.json();
    expect(safe.hand).toHaveLength(0);
    expect(safe.displayToken).toBeUndefined();
    await expect(
      display.getByRole("heading", { name: "Your hand" }),
    ).toHaveCount(0);
    let reconnected = false,
      paymentSeen = false,
      placementSeen = false;
    const seen = new Set<string>();
    for (let step = 0; step < 1800; step++) {
      v = await view(request, host);
      if (v.phase === "COMPLETED") break;
      if (v.phase === "ROUND_OVER") {
        await mustAct(request, host, v, "next");
        continue;
      }
      const responder = v.pending?.responder ?? v.turn!,
        index = sessions.findIndex((s) => s.playerId === responder),
        current = sessions[index],
        p = pages[index];
      const own = await view(request, current);
      if (own.pending && !reconnected) {
        await p.reload();
        await expect(p.locator(".deal-response")).toBeVisible();
        const after = await view(request, current);
        expect(after.pending).toEqual(own.pending);
        reconnected = true;
      }
      if (own.pending?.stage === "payment" && !paymentSeen) {
        await expect(
          p.getByRole("button", { name: /Confirm payment/ }),
        ).toBeVisible();
        await expect(p.locator(".deal-payment-assets")).toBeVisible();
        paymentSeen = true;
      }
      if (own.pending?.stage === "placement" && !placementSeen) {
        await expect(
          p.getByRole("heading", { name: "Place your received property" }),
        ).toBeVisible();
        placementSeen = true;
      }
      const b = bot(own);
      if (b.type === "play") {
        const c = own.hand.find((c) => c.id === b.payload.cardId);
        if (c?.effect && b.payload.mode === "action") seen.add(c.effect);
      }
      await mustAct(request, current, own, b.type, b.payload);
    }
    v = await view(request, host);
    expect(v.phase).toBe("COMPLETED");
    expect(v.history.length).toBeGreaterThanOrEqual(2);
    expect(v.winners.length).toBeGreaterThan(0);
    expect(reconnected).toBe(true);
    expect(paymentSeen).toBe(true);
    expect(placementSeen).toBe(true);
    await expect(hostPage.locator(".deal-results")).toBeVisible();
    await expect(third.locator(".deal-results")).toBeVisible();
    await expect(third.locator(".deal-announcement")).toHaveCount(1);
    for (const p of pages)
      expect(
        await p.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
    expect(frames.length).toBeGreaterThan(10);
    for (const f of frames) {
      expect(f.yourPlayerId).toBe(host.playerId);
      expect("hands" in f).toBe(false);
      expect("rng" in f).toBe(false);
      expect("deck" in f).toBe(false);
      expect(f.players.every((p) => !("token" in p))).toBe(true);
    }
    expect(
      seen.has("debtCollector") || seen.has("rent") || seen.has("birthday"),
    ).toBe(true);
    expect(errors).toEqual([]);
    await third.screenshot({
      path: "test-results/deal-desktop-results.png",
      fullPage: true,
    });
    // Replayed exact request is harmless even after state changes.
    await mustAct(request, host, v, "restart");
    const fresh = await view(request, host);
    expect(fresh.phase).toBe("LOBBY");
    expect(fresh.settings.rules).toEqual(CLASSIC_DEAL_RULES);
    const other = await request.post(`${backend}/api/game/create`, {
      data: {
        gameType: "monopoly-deal",
        hostNickname: "Other host",
        settings: DEFAULT_DEAL_SETTINGS,
      },
    });
    expect(other.status()).toBe(200);
    const os: Session = { ...(await other.json()), role: "HOST" };
    try {
      expect((await view(request, os)).players.length).toBe(1);
      expect((await view(request, host)).players.length).toBe(3);
    } finally {
      await end(request, os);
    }
  } finally {
    await end(request, host);
    await secondContext.close();
    await thirdContext.close();
    await displayContext.close();
  }
});

test("server rejects invalid settings and five-player lobby cap, persists no card leaks", async ({
  request,
  page,
}) => {
  const invalid = await request.post(`${backend}/api/game/create`, {
    data: {
      gameType: "monopoly-deal",
      hostNickname: "Invalid",
      settings: { rules: { setsToWin: 99 } },
    },
  });
  expect(invalid.status()).toBe(400);
  const created = await request.post(`${backend}/api/game/create`, {
    data: {
      gameType: "monopoly-deal",
      hostNickname: "Cap host",
      settings: DEFAULT_DEAL_SETTINGS,
    },
  });
  expect(created.status()).toBe(200);
  const host: Session = { ...(await created.json()), role: "HOST" };
  try {
    const initial = await view(request, host);
    for (const playerId of ["__proto__", "constructor", "toString"]) {
      for (const command of ["transfer-host", "kick"]) {
        const rejected = await act(request, host, initial, command, {
          playerId,
        });
        expect(rejected.status()).toBe(400);
      }
    }
    const preserved = await view(request, host);
    expect(preserved.revision).toBe(initial.revision);
    expect(preserved.yourRole).toBe("HOST");
    for (let i = 0; i < 4; i++) {
      const r = await request.post(`${backend}/api/game/${host.gameId}/join`, {
        data: { nickname: `Guest ${i}` },
      });
      expect(r.status()).toBe(200);
    }
    const full = await request.post(`${backend}/api/game/${host.gameId}/join`, {
      data: { nickname: "Sixth" },
    });
    expect(full.status()).toBe(409);
    await setSession(page, host);
    await page.setViewportSize({ width: 768, height: 1024 });
    await page.getByRole("button", { name: "Shuffle & deal" }).click();
    await expect(page.locator(".deal-player-table")).toHaveCount(5);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    const v = await view(request, host),
      c =
        v.hand.find((c) => c.kind === "property" || c.kind === "money") ??
        v.hand[0],
      payload =
        c.kind === "property" || c.kind === "wild"
          ? { mode: "property", color: c.colors[0] }
          : { mode: "bank" };
    const id = crypto.randomUUID();
    const first = await act(
      request,
      host,
      v,
      "play",
      { cardId: c.id, ...payload },
      id,
    );
    expect(first.status()).toBe(200);
    const before = await view(request, host);
    const again = await act(
      request,
      host,
      v,
      "play",
      { cardId: c.id, ...payload },
      id,
    );
    expect(again.status()).toBe(200);
    const after = await view(request, host);
    expect(after.revision).toBe(before.revision);
    expect(after.hand).toEqual(before.hand);
  } finally {
    await end(request, host);
  }
});
