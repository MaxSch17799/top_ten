import { test, expect, type Page, type WebSocketRoute } from "@playwright/test";
import {
  createState,
  startRound,
  makeDeck,
  applyAction,
  serializeForPlayer,
  type DealState,
} from "../../backend-do/src/monopolyDeal/engine";
import {
  CLASSIC_DEAL_RULES,
  DEFAULT_DEAL_SETTINGS,
  DEAL_GROUPS,
  type DealCard,
  type DealColor,
  type DealEffect,
  type DealSet,
  type DealAction,
} from "../../shared/monopolyDeal";

let sequence = 0;
const card = (filter: (c: DealCard) => boolean) => ({
  ...makeDeck().find(filter)!,
  id: `ui-card-${++sequence}`,
});
const property = (color: DealColor) =>
  card((c) => c.kind === "property" && c.colors[0] === color);
const action = (effect: DealEffect) => card((c) => c.effect === effect);
const money = (value: number) =>
  card((c) => c.kind === "money" && c.value === value);
function room(players = 2, bankFirst = false) {
  const host = {
    playerId: "p0",
    nickname: "Anna",
    role: "HOST" as const,
    connected: true,
    token: "fixture-token",
    disconnectedAt: null,
  };
  const s = createState(
    "7777",
    host,
    "fixture-display",
    {
      ...DEFAULT_DEAL_SETTINGS,
      ...(bankFirst
        ? { profileId: "custom-fixture", profileName: "Bank-first house rules" }
        : {}),
      rules: { ...CLASSIC_DEAL_RULES, bankFirstPayments: bankFirst },
    },
    Date.now(),
    [1, 2, 3, 4],
  );
  for (let i = 1; i < players; i++) {
    const playerId = `p${i}`;
    s.players[playerId] = {
      ...host,
      playerId,
      nickname: i === 1 ? "Ben" : "Clara",
      role: "PLAYER",
      token: `fixture-${i}`,
    };
    s.order.push(playerId);
  }
  startRound(s);
  for (const id of s.order) s.hands[id] = [];
  return s;
}
function group(
  s: DealState,
  owner: string,
  color: DealColor,
  count: number,
): DealSet {
  const g: DealSet = {
    id: `ui-group-${++sequence}`,
    color,
    cards: Array.from({ length: count }, () => property(color)),
    house: null,
    hotel: null,
  };
  s.tables[owner].sets.push(g);
  return g;
}
function command(
  s: DealState,
  who: string,
  type: string,
  payload: Record<string, unknown> = {},
) {
  const a: DealAction = {
    id: `ui-request-${++sequence}`,
    type,
    payload,
    generation: s.generation,
    round: s.round,
    revision: s.revision,
  };
  applyAction(s, who, a);
  return a;
}
/** Browser-only HTTP/WebSocket fixture backed by the real rules engine. No fixture endpoints or privileged state injection ship to the app. */
async function table(page: Page, s: DealState) {
  const sockets = new Set<WebSocketRoute>(),
    requests: DealAction[] = [];
  const broadcast = () => {
    for (const ws of sockets) {
      try {
        ws.send(
          JSON.stringify({
            type: "STATE",
            payload: serializeForPlayer(s, "p0"),
          }),
        );
      } catch {
        sockets.delete(ws);
      }
    }
  };
  await page.routeWebSocket(/\/api\/game\/7777\/ws/, (ws) => {
    sockets.add(ws);
    ws.onClose(() => sockets.delete(ws));
    ws.onMessage((message) => {
      if (String(message).includes("PING")) ws.send('{"type":"PONG"}');
    });
    ws.send(
      JSON.stringify({ type: "STATE", payload: serializeForPlayer(s, "p0") }),
    );
  });
  await page.route(
    /\/api\/game\/7777\/(info|state|action)(\?|$)/,
    async (route) => {
      const url = new URL(route.request().url());
      if (url.pathname.endsWith("/info"))
        return route.fulfill({
          json: { gameType: "monopoly-deal", phase: s.phase },
        });
      if (url.pathname.endsWith("/state"))
        return Number(url.searchParams.get("sinceVersion")) >= s.version
          ? route.fulfill({ status: 204 })
          : route.fulfill({ json: serializeForPlayer(s, "p0") });
      const a = route.request().postDataJSON() as DealAction;
      requests.push(a);
      try {
        applyAction(s, "p0", a);
        broadcast();
        await route.fulfill({ json: { success: true, version: s.version } });
      } catch (error) {
        await route.fulfill({
          status: 400,
          json: { message: (error as Error).message },
        });
      }
    },
  );
  await page.addInitScript(() => {
    const session = {
      gameId: "7777",
      playerId: "p0",
      playerToken: "fixture-token",
      role: "HOST",
    };
    localStorage.setItem("party-session-7777", JSON.stringify(session));
  });
  await page.goto("/g/7777");
  await expect(page.getByRole("heading", { name: "Your hand" })).toBeVisible();
  return { requests, broadcast };
}

for (const width of [390, 1280])
  test(`color cues, visible wild stripes and matching-group defaults at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 900 });
    const s = room(),
      own = group(s, "p0", "green", 1),
      other = group(s, "p1", "green", 2);
    const dual = card(
      (c) =>
        c.kind === "wild" &&
        c.colors.includes("green") &&
        c.colors.includes("darkBlue"),
    );
    other.cards.push(dual);
    const rainbow = group(s, "p1", "brown", 1);
    rainbow.cards.push(card((c) => c.kind === "wild" && c.value === 0));
    group(s, "p1", "railroad", 1);
    group(s, "p1", "utility", 1);
    const c = property("green");
    s.hands.p0 = [c];
    const fixture = await table(page, s);
    const opponent = page.locator('[data-player="p1"]');
    await expect(opponent.locator(".deal-property-slots .is-wild")).toHaveCount(
      2,
    );
    const stripe = opponent.locator(
      ".deal-property-slots .is-wild:not(.is-rainbow)",
    );
    expect(
      await stripe.evaluate(
        (el) => getComputedStyle(el, "::after").backgroundColor,
      ),
    ).toBe("rgb(129, 140, 248)");
    expect(
      await opponent
        .locator(".is-rainbow")
        .evaluate((el) => getComputedStyle(el, "::after").backgroundImage),
    ).toContain("linear-gradient");
    await expect(stripe).toHaveAttribute(
      "aria-label",
      /Green.*wild.*Green \/ Deep blue/,
    );
    const rail = opponent.getByRole("button", { name: /^Railroad group/ }),
      utility = opponent.getByRole("button", { name: /^Utility group/ });
    expect(await rail.getAttribute("style")).not.toBe(
      await utility.getAttribute("style"),
    );
    await page
      .getByRole("button", { name: `Select ${c.title}`, exact: true })
      .click();
    await expect(page.getByLabel("Property color")).toHaveValue("green");
    await expect(page.getByLabel("Destination group")).toHaveValue(own.id);
    await expect(
      page.getByRole("button", { name: "As property", exact: true }),
    ).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: /Bank .*M/, exact: true }),
    ).toHaveCount(0);
    await page.screenshot({
      path: `test-results/deal-property-colors-${width}.png`,
      fullPage: true,
    });
    await page
      .getByRole("button", { name: "Place property", exact: true })
      .click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    expect(fixture.requests.at(-1)?.payload?.setId).toBe(own.id);
    expect(s.tables.p0.sets).toHaveLength(1);
    expect(s.tables.p0.sets[0].cards).toHaveLength(2);
  });

test("placement keeps the explicit new-group choice and defaults to the first matching group when several exist", async ({
  page,
}) => {
  const s = room(),
    first = group(s, "p0", "green", 1);
  group(s, "p0", "green", 1);
  const c = property("green");
  s.hands.p0 = [c];
  await table(page, s);
  await page
    .getByRole("button", { name: `Select ${c.title}`, exact: true })
    .click();
  await expect(page.getByLabel("Destination group")).toHaveValue(first.id);
  await page.getByLabel("Destination group").selectOption("");
  await page
    .getByRole("button", { name: "Place property", exact: true })
    .click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  expect(s.tables.p0.sets).toHaveLength(3);
});

for (const players of [2, 3])
  test(`Forced Deal defaults the only eligible opponent and properties (${players} players), with color labels and steal animation`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    const s = room(players),
      own = group(s, "p0", "brown", 1),
      target = group(s, "p1", "green", 1);
    if (players === 3) group(s, "p2", "brown", 2);
    const c = action("forcedDeal");
    s.hands.p0 = [c];
    const fixture = await table(page, s);
    await page
      .getByRole("button", { name: `Select ${c.title}`, exact: true })
      .click();
    await expect(page.getByLabel("Target opponent")).toHaveValue("p1");
    await expect(page.getByLabel("Give one of your properties")).toHaveValue(
      own.cards[0].id,
    );
    await expect(
      page.getByLabel("Give one of your properties").locator("option:checked"),
    ).toHaveText(/Brown.*Ember Lane/);
    const take = page.locator(".deal-targets .deal-chip");
    await expect(take).toHaveAttribute("aria-pressed", "true");
    await expect(take).toContainText("Green");
    await expect(
      page.getByRole("button", {
        name: "Play Forced Deal · 1 play",
        exact: true,
      }),
    ).toBeEnabled();
    await page
      .getByRole("button", { name: "Play Forced Deal · 1 play", exact: true })
      .click();
    await expect(page.locator('[data-player="p1"]')).toHaveClass(
      /under-attack/,
    );
    await expect(page.locator(".deal-attack-badge")).toContainText(
      "Swap proposed",
    );
    await expect(page.locator(".deal-effect-notice")).toBeVisible();
    expect(fixture.requests.at(-1)?.payload).toMatchObject({
      target: "p1",
      giveCardId: own.cards[0].id,
      targetCardId: target.cards[0].id,
    });
  });

test("Rent defaults its only legal property group and opponent", async ({
  page,
}) => {
  const s = room(),
    own = group(s, "p0", "brown", 1),
    c = action("wildRent");
  s.hands.p0 = [c];
  await table(page, s);
  await page
    .getByRole("button", { name: `Select ${c.title}`, exact: true })
    .click();
  await expect(page.getByLabel("Charge rent for")).toHaveValue(own.id);
  await expect(page.getByLabel("Target opponent")).toHaveValue("p1");
  await expect(
    page.getByRole("button", { name: "Play Wild Rent · 1 play", exact: true }),
  ).toBeEnabled();
});

for (const bankFirst of [false, true])
  test(`${bankFirst ? "House-rule bank-first" : "Official Classic"} payment choices visibly distinguish properties and cash`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    const s = room(2, bankFirst),
      prop = group(s, "p0", "green", 1),
      cash = money(2),
      debt = action(bankFirst ? "debtCollector" : "birthday");
    s.tables.p0.bank.push(cash);
    s.turn = "p1";
    s.hands.p1 = [debt];
    command(s, "p1", "play", { cardId: debt.id, mode: "action", target: "p0" });
    await table(page, s);
    await page
      .getByRole("button", { name: "Accept action", exact: true })
      .click();
    const property = page.locator('[data-asset-kind="property"]'),
      bank = page.locator('[data-asset-kind="bank"]');
    await expect(property).toContainText("PROPERTY TRANSFER");
    await expect(property).toContainText("Green");
    await expect(property).toContainText(
      "Transfers to their property collection",
    );
    await expect(bank).toContainText("Pays as cash");
    if (bankFirst) {
      await expect(property).toBeDisabled();
      await bank.click();
      await page.getByRole("button", { name: /Confirm payment · 2M/ }).click();
      await expect(
        page.getByRole("heading", { name: "Pay 3M to Ben" }),
      ).toBeVisible();
      await expect(property).toBeEnabled();
      await expect(bank).toHaveCount(0);
    } else await expect(property).toBeEnabled();
    await property.click();
    await page.screenshot({
      path: `test-results/deal-payment-${bankFirst ? "bank-first" : "classic"}.png`,
      fullPage: true,
    });
    await page.getByRole("button", { name: /Confirm payment · 4M/ }).click();
    await expect(page.locator(".deal-response")).toContainText(
      "Ben is placing received properties",
    );
    expect(s.pending?.placements[0].card.id).toBe(prop.cards[0].id);
    expect(s.tables.p0.bank.length).toBe(bankFirst ? 0 : 1);
  });

test("five idle seconds with no plays left shows a usable end-turn reminder; activity resets it", async ({
  page,
}) => {
  await page.clock.install();
  const s = room();
  s.playsLeft = 0;
  const c = money(1);
  s.hands.p0 = [c];
  await table(page, s);
  await page.getByRole("heading", { name: "Your hand" }).click();
  await page.clock.fastForward(4000);
  await expect(page.locator(".deal-turn-nudge")).toHaveCount(0);
  await page.clock.fastForward(1100);
  await expect(
    page.getByRole("button", { name: "End your turn →", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: `Select ${c.title}`, exact: true })
    .click();
  await expect(page.locator(".deal-turn-nudge")).toHaveCount(0);
  await page
    .getByRole("button", { name: "Close card details", exact: true })
    .click();
  await page.clock.fastForward(5100);
  await page
    .getByRole("button", { name: "End your turn →", exact: true })
    .click();
  await expect(page.locator(".deal-turn-nudge")).toHaveCount(0);
  await expect.poll(() => s.turn).toBe("p1");
});

for (const reduced of [false, true])
  test(`winning celebration ${reduced ? "respects reduced motion" : "shows nonblocking confetti"}`, async ({
    page,
  }) => {
    await page.emulateMedia({
      reducedMotion: reduced ? "reduce" : "no-preference",
    });
    const s = room();
    group(s, "p0", "brown", DEAL_GROUPS.brown.size);
    group(s, "p0", "darkBlue", DEAL_GROUPS.darkBlue.size);
    group(s, "p0", "red", 2);
    const c = property("red");
    s.hands.p0 = [c];
    await table(page, s);
    await page
      .getByRole("button", { name: `Select ${c.title}`, exact: true })
      .click();
    await page
      .getByRole("button", { name: "Place property", exact: true })
      .click();
    await expect(page.locator(".deal-results")).toBeVisible();
    if (reduced) {
      await expect(page.locator(".deal-confetti")).toHaveCount(0);
      await expect(page.locator(".deal-flight")).toHaveCount(0);
    } else {
      await expect(page.locator(".deal-confetti > i")).toHaveCount(48);
      expect(
        await page
          .locator(".deal-confetti")
          .evaluate((el) => getComputedStyle(el).pointerEvents),
      ).toBe("none");
    }
    expect(s.phase).toBe("COMPLETED");
  });
