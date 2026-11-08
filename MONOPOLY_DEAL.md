# Monopoly Deal

Available at `/monopoly-deal`, using the existing `/g/:code` invites, player sessions, QR panel, connection recovery and Cloudflare Durable Object namespace. Supports 2–5 players on individual devices, with the host playing normally. Host controls include seating, lobby removal, host transfer, return to lobby, end match, next game and a read-only shared display. Existing games and deployment bindings are retained.

## Implemented game

The complete 106-card playable deck includes 28 properties, 11 property wildcards, 20 money cards, 13 rents and all 34 other action cards. Four printed reference cards are excluded. The original SVG deck uses data-driven property, wildcard, money, rent, action, building and back templates, with original street names and no copied artwork or logos.

The server shuffles, deals five, draws two (five for an empty starting hand), enforces the play budget and end-of-turn discard limit, reshuffles the entire discard pile on exhaustion, and validates every ownership/target/color/building/payment/response decision. There may be several groups of the same color, but winning groups must have different colors. Every-color wilds have no payment value and cannot make a complete or rent-bearing group by themselves. Dual wilds are valid anchors.

Paired rent charges all opponents, wild rent charges one opponent, and up to two simultaneous Double Rent cards each cost a play. Houses add 3M; Hotels add a further 4M, require a House, and cannot be placed on railroads/utilities. Sly Deal/Forced Deal protect the opponent's completed groups. A player may voluntarily offer their own completed-group property in a Forced Deal. Deal Breaker transfers the entire selected group with buildings.

Debtors choose their own tabled assets; nothing is automatically selected in normal play. Overpayment returns no change. Insufficient assets require every payable card, leaving zero-value wilds. Banked actions stay money after every transfer. Paid buildings enter the recipient's bank. Received properties have an explicit placement step: their new owner chooses the permitted color and destination group. Forced Deal removes both properties before resolving placement and broken-group cleanup, preserving buildings if the replacement leaves the original group complete. Unpaid buildings on groups that become incomplete are discarded.

Attacks are resolved one opponent at a time in seating order. Each affected opponent has an independent Just Say No chain; only the original attacker and that opponent can counter within that chain. One No cancels the entire demand including simultaneous rent multipliers, rather than reducing the multiplier. Other players' obligations remain independent. No unrelated move or turn-ending command can interrupt a pending action.

## Usability update (2026-11-08)

Property choices now show their assigned color in text and a color marker, with explicit dual-wild/rainbow labels. Native select options include color names and symbols so phone menus remain understandable even when the operating system does not render custom swatches. Public property slots show the alternative color along the bottom of dual wildcards, and a rainbow stripe on any-color wildcards. Utility is teal with a water symbol; railroad is lavender with a train symbol.

Property placement defaults to the first open matching group, including when receiving a stolen or paid property. Starting a new group remains an explicit choice. A selector with one legal opponent, group or property defaults to that option; multiple strategic choices remain explicit. Ordinary property cards go directly to placement, with no action/bank mode selector. Five idle seconds after exhausting card plays shows a prominent end-turn reminder; pointer/keyboard activity resets the delay, and free rearrangement remains available.

Payment assets distinguish cash, property transfers and buildings with category labels and color markers. **Classic stays the default**, and permits choosing properties even when bank money remains, per [Hasbro's payment FAQ](https://hasbro-new.custhelp.com/app/answers/detail/a_id/944). Optional **Bank-first payments** in Advanced rules locks property/building payments while the bank contains cards. If bank funds fall short, the player pays the bank first, then chooses assets for the remaining debt; the server persists that outstanding balance and rejects forged property payments. Automatic payment and deadline fallbacks honor the same rule. Older rooms and saved profiles receive `bankFirstPayments: false` without changing existing settings.

Steal/swap attempts pulse the affected table and animate the action toward it; the response panel identifies both properties and their colors. Resolved transfers retain their card animations. Wins add short, nonblocking confetti. Reduced-motion preferences disable these effects and the reminder pulse.

## Official editions and research

[MONOPOLY_DEAL_RESEARCH.md](MONOPOLY_DEAL_RESEARCH.md) records the primary Hasbro instructions/FAQ links, deck inventory, edition differences and all three upstream reviews. The older Hasbro FAQ says all No responses are free; the newer G0351 printed edition charges a play for a No during the active player's turn. The lobby exposes this distinction explicitly. Both editions use G0351's clear building-payment and broken-group instructions. Victory is detected when the resolved action gives any player the required different complete colors, including an off-turn Forced Deal recipient.

No external engine, artwork or tests were copied. Chudopoly was the best JavaScript reference candidate, but its delayed win, property overflow, single-group-per-color model and payment/building house rules would require extensive replacement. Jeffopolydeal's C# engine is incompatible with a direct Workers import; 3ree's client-held authority does not satisfy this site's multiplayer requirements. The project-native core reuses the site's existing UNO room transport design and uses independently written rules/tests; no new third-party license notices or paid dependencies are introduced.

## Profiles and match formats

- **Classic Monopoly Deal:** five-card deal, two-card draw, three plays, seven-card limit, three different complete colors win, all No responses free (Hasbro FAQ).
- **2024 printed edition:** the same game, but the active player's No costs one play. A counter requires a remaining play; opponents' off-turn Nos remain free.
- **Quick Deal:** house rule, two different complete colors win.
- **Party / Chaos Deal:** house rules, four plays and three draws per turn.
- **Custom:** 2–4 winning colors, starting hand 3–7, hand limit 5–10, plays 2–5, normal draw 1–3, optional Deal Breaker/rearrangement restrictions, choice of No edition, automatic payments, and response/turn timers. These optional variations are practical settings for this site, not claims about official rules or universally popular variants.

Advanced settings validate integer bounds and timer minima. Profiles support save, select, edit/update, duplicate, rename and delete. Up to 30 validated profiles persist in browser storage under `game-night-deal-profiles-v1`; other browsers do not share them. Everyone sees the applied profile and differences from Classic. Rules lock once started; returning to the lobby resets hands/scores and permits configuration again.

Single-game, best-of-three/five, and 1–15 fixed games use one point per game won. Best-of ends early at a majority of the selected game count; otherwise it ends at the selected limit. Highest wins takes the match, with shared ties possible for three or more players. Fixed-game ties are also shared. The starting seat rotates every game. The host starts the next game from the scoreboard without recreating the lobby.

Timers default off. When enabled:

- A response timeout accepts an attack or lets the current No decision stand.
- A payment timeout pays ascending bank cards first, then ascending-value tabled properties/buildings, stopping when covered or out of assets. The same documented strategy applies to optional automatic payment. Properties can be surrendered, so both features are explicit opt-ins.
- A received-property timeout uses its first printed color and the first open matching group, or creates a new group.
- The turn timer pauses for the entire attack/response/payment/placement sequence and resumes its remaining duration. Turn expiry discards excess hand cards by descending value (card ID breaks ties), then ends the turn.

## Architecture and security

- `shared/monopolyDeal.ts`: public card/rules/view definitions, rule validation and pure public-table helpers. No secret deck or room data is sent to the frontend.
- `backend-do/src/monopolyDeal/engine.ts`: deterministic, serializable game state and atomic command transitions. A private 128-bit seeded RNG drives reproducible shuffles, initialized from server cryptographic randomness. Commands explicitly accept the clock for deadline tests. Invalid commands cannot partly mutate the state.
- `backend-do/src/monopolyDeal/room.ts`: existing room transport pattern, dedicated `monopoly-deal` storage key, serialized writes, player authentication, bounded replay IDs, persisted deadlines/alarms and private WebSocket/HTTP projections.
- `frontend/src/components/DealCard.tsx`: reusable original SVG templates. `MonopolyDealGame.tsx` contains the responsive public tabletop, horizontally scrollable private hand, keyboard-accessible native card dialogs, property management, payments and responses. `DealSettings.tsx` manages profiles. The game routes are loaded on demand.
- Generation, round and revision checks reject stale competing actions. An actor/request-ID pair deduplicates exact retries. Reconnection uses existing per-lobby local sessions, WebSocket backoff and polling fallback. Pending action state, property placement, hands and deadlines survive room eviction/reconnect.
- Host permissions never imply access to other hands. The capability-protected shared display has no hand or gameplay controls. Public views explicitly exclude the deck, RNG, authentication tokens, replay state and other players' cards. New joins are limited to the lobby.
- State stays bounded: 106 cards, at most 15 results, 35 events and 160 replay IDs. Existing idle expiration is 30 minutes in the lobby / two hours since a gameplay action. No D1 schema or Durable Object migration is needed.

## Validation

Run the project's existing commands:

```sh
npm test
npm --prefix frontend run lint
npm --prefix frontend run build
npm run lint --workspace backend-do
npm run build --workspace backend-do
npm run test:e2e
```

`tests/monopoly-deal.test.ts` covers deck composition/values, deterministic dealing/reshuffling, limits, permissions/replay protection, group completion, wildcard/ordinary rearrangement, all rent/building/steal/swap effects, overpayment and insufficient funds, banked action identity, independent No chains and both editions, immediate victory, matches/house rules, deadlines, JSON recovery, concurrent commands and the actual room adapter. Twelve complete simulations conserve all 106 unique cards at every transition.

`tests/e2e/monopoly-deal.spec.ts` covers profile CRUD/persistence, mobile controls and previews, invites/QR, three live device contexts plus safe display, public/private views, pending-response reconnect, manual payment/placement interfaces, complete multiplayer matches, simultaneous rooms, lobby cap, retries, tablet/desktop sizing and no page/React key errors. It saves local screenshots in ignored `test-results/` for visual review.

`tests/e2e/monopoly-deal-usability.spec.ts` adds 11 deterministic browser scenarios backed by the real rules engine through browser-only HTTP/WebSocket fixtures. These cover phone/desktop color cues and wild stripes, explicit versus default group choices, single legal targets, cash/property distinction, bank-first debt stages, reminder activity/reset/click behavior, confetti and reduced motion. No test-state endpoints are added to the application. Engine regressions cover bank-first validation, overpayment/insolvency, partial-payment replay and reconnect, automatic payments, timers, independent multiplayer debt amounts and migration of older rooms/profiles.

## Deployment and limits

For the 2026-11-08 usability release, `npm run check` passes **256 automated tests** (52 Monopoly Deal tests), both type-checks and frontend ESLint. `npm run build` passes the production frontend build and Worker dry run. All **14 Monopoly Deal browser scenarios** pass locally and against the production frontend: 11 use browser-only rules-engine fixtures, and three exercise the live Worker, including a complete three-device multi-game match. The wider site run passed 47/48 on its first attempt; the existing Flip 7 final-results test hit an HTTP 409 during its cleanup command and passed on an isolated rerun. No Flip 7 code or tests were changed.

Released to the existing Worker (`04ee5ee9-e7b7-4cd3-bb44-8e5ed549c5d1`) and Pages deployment [`186762ac`](https://186762ac.top-ten.pages.dev). Classic remains the default, with bank-first payments opt-in under Advanced rules. Existing bindings and hosting configuration are unchanged.

Deploy the existing Worker first, then the existing Pages project, as in README. No new provider, audience setting, dependency subscription, database or resource migration is introduced. Deployment verification is recorded in the completion report.

Verified on 2026-10-30: **164 engine/adapter tests pass, including 45 Monopoly Deal tests; all 20 site browser scenarios pass; all three Monopoly Deal production browser scenarios pass**, including a complete three-device multi-game match and pending-action reconnect. Frontend ESLint/TypeScript/Vite, backend TypeScript and the Wrangler build dry run pass. Production uses the same existing bindings. Worker version: `a4fef69e-3a04-4bcf-ad95-981b2a33df13`; Pages deployment: `62ae9075`.

Live game: [top-ten.pages.dev/monopoly-deal](https://top-ten.pages.dev/monopoly-deal). The current working tree was deployed directly; changes remain uncommitted. To rerun just the production scenarios in PowerShell:

```powershell
$env:PLAYWRIGHT_BASE_URL = 'https://top-ten.pages.dev'
$env:DEAL_TEST_BACKEND = 'https://top-ten.maxschimmel17799.workers.dev'
npx playwright test tests/e2e/monopoly-deal.spec.ts
```

Tap/click is supported for every strategic choice; drag/swipe gestures are not implemented. Animations are short card-transfer effects, clear No/set cues and a win celebration, disabled for reduced-motion preferences. The interface is English. Sessions require network access. Permanent loss of a browser's session storage cannot recover a private hand by nickname; reconnect on the original browser, or use an already-authorized host to end/restart the lobby. Host transfer is explicit while connected; there is no automatic host replacement.
