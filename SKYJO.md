# Skyjo

Available at `/skyjo`, with invitations at `/g/:code` and a token-protected, read-only TV at `/g/:code/display`.

## Rules research and explicit policies

Checked 2026-11-02 against [Magilano's classic product page](https://magilano.com/en/products/skyjo) and its [English classic instruction sheet, SKYJO_ADCTNO20210331_V9](https://www.philibertnet.com/fr/product/attachment/5943), hosted by Philibert. [Publisher's German PDF](https://www.magilano.com/wp-content/uploads/2021/09/2021.09.27_SKYJO_Spielregeln_de.pdf) is also indexed, although direct retrieval failed during research. No third-party code or artwork was reused.

The implementation follows the classic sheet: twelve cards per player, two opening reveals, highest opening sum starts the first round, previous finisher starts subsequent rounds, clockwise turns, private draws or mandatory discard swaps, equal vertical triplets removed **after** the exchanged card, one final turn for everyone except the finisher, remaining cards revealed and matching columns removed before scoring. An unsuccessful finisher's positive score doubles, including ties. Zero and negative scores never double. Thresholds are checked only after completed rounds; the lowest cumulative score wins.

The sheet does not settle every digital edge case. The following policies are documented in the game:

- Equal opening sums: earliest seat in host-configured order starts.
- Equal winning totals: shared victory, with no extra tie-break round.
- Exhausted draw pile: retain the top discard and shuffle all other discards into a new draw pile.
- Within a removed column, discard top row to bottom row. All three values match; the triplet goes above the exchanged card. Multiple columns clear left to right.
- A final-turn player with no hidden cards must swap a drawn card. An empty grid has no legal move and its final turn completes automatically.
- Join is available in the lobby. Active players retain their seats through refresh/disconnection; new arrivals wait for the host to return to the lobby.
- Selecting the visible discard is provisional: **Return to discard** restores it to the top of the pile before any grid replacement. The same player can then draw privately or select the discard again. This digital interaction policy reveals no new information and preserves the turn, final-turn queue, card order and timer. It cannot undo a private draw, a flip, a publicly discarded draw, or a completed swap.

**Keep & swap** is provisional until placement. **Back to choices** reopens Keep / Discard for the same privately drawn card. It never returns that card to the deck, draws a replacement, reveals it to other players, resets the timer, or undoes a completed placement/discard. This is available on normal phones and TV controllers, including after refresh.

## Architecture

- `shared/skyjo.ts`: public schema, classic rules, built-in profiles and settings validation.
- `backend-do/src/skyjo/engine.ts`: synchronous state machine, cryptographically random production shuffling, deterministic seeded test shuffling, card transfers, timers, scoring, action validation and explicit per-viewer serialization.
- `backend-do/src/skyjo/room.ts`: existing game-room adapter pattern, HTTP/WebSockets, Durable Object persistence, alarms, serialized commands and usage tracking.
- `frontend/src/components/SkyjoGame.tsx`: public phone table, controller, TV, host tools, results and event animations.
- `frontend/src/components/SkyCard.tsx`: original reusable SVG faces and backs. Color bands reinforce readable values; color is never the sole indicator.
- `frontend/src/components/SkySettings.tsx` and `frontend/src/lib/skyProfiles.ts`: lobby configuration and validated browser-local profiles.

Skyjo uses the existing GameDurableObject binding and code namespace. No new migrations, resources, services or runtime dependencies are needed. Rules lock at start. Display changes update presentation without advancing gameplay revision, so an in-flight card choice remains valid. Opening selections from different players commute instead of rejecting each other on unrelated revisions.

Every command authenticates its player token and validates generation, round, revision, role, phase and target. Request IDs make retries idempotent. The adapter clones state and persists successful commands before broadcasting; rejected commands cannot partially mutate the room. Connections use the existing backoff, visibility recovery, heartbeat and polling fallback. Server alarms handle deadlines and automatic rounds; no connected browser is required for progression.

Serialization never sends deck order, shuffle seed, player tokens, hidden card values or hidden physical card identities. A drawn card is sent only as its owner's `yourCard`; even after Keep it stays hidden from everyone else until placed. Public draw events have no card payload. The host has the same hidden-information restrictions as other players. Only the host receives the separate display capability URL; the display token cannot submit actions. Room state persists private pending choices on refresh or Worker eviction.

## Phone navigation and TV

Portrait phones show one large 3×4 grid at a time in a native scroll-snap carousel. The horizontally scrollable player strip shows names, cumulative scores, whose turn it is, and a pulse when another player's table changes. Tap a player, swipe, or use arrow/Home/End keys with the carousel focused. My cards pins your own grid; Follow turn automatically follows turn changes. Manual navigation disables following and stays in place across gameplay updates. A prominent return button appears when it is your turn while browsing someone else. Opening setup defaults to your own grid; the first turn starts in Follow turn mode.

Native touch scrolling cancels taps during swipes; an additional movement guard prevents a gesture from becoming a move. Offscreen slides are inert, avoiding invisible keyboard targets. Moves use simple taps with explicit Keep / Discard decisions and highlighted legal positions. No drag gesture or routine confirmation is required. At desktop widths, the action panel sits alongside the large grid. Public event text and navigation pulses explain updates outside the viewed grid.

Normal is the default and exposes the complete public table and playable controls to each phone. In TV / Party mode, waiting phones show a short status; active phones show private decisions and their own tappable grid. Anyone can temporarily inspect the complete table. The dedicated TV emphasizes the current player and keeps every other grid in an adaptive overview, with piles, public selections, event feedback, score results and fullscreen controls. Private draws show a back. The TV can refresh/disconnect without affecting play. Host mode changes broadcast immediately without touching cards, deck, totals, turn, pending card or deadlines.

Quick vector/CSS/Web Animation effects cover dealing, flips, private draws, swaps, discards, column clear flights, grid transitions, score changes, round results and winning. Effects do not control game progression. Reduced-motion preferences disable decorative motion and use immediate navigation.

## Host settings

Classic (100), Quick (50), Long (150); always the standard 150-card deck. Advanced house rules: score threshold 1–10,000, fixed rounds 0–100 (replaces threshold), starting reveals 1–11, matching columns, doubling penalty, optional turn timer 0–300 seconds and timeout behavior. The game identifies non-classic settings as house rules. Timers are off by default. Automatic next round is enabled by default after 15 seconds; the host can advance sooner or pause the results.

Turn timers cover the whole turn, including all pending choices, rather than resetting after each click. Setup has one shared opening deadline. Default timeout behavior pauses without making a strategic choice; resuming provides a full turn budget. The optional explicit automatic policy draws and discards, then reveals the first hidden position. Already kept/taken cards replace the first hidden position, otherwise the first occupied position. Setup reveals the first hidden positions. Hidden values never influence automatic choices. Host recovery uses the same policy only for an offline decision maker, behind a confirmation. Pause/resume preserves timer remainders and pending cards. Add 30 seconds extends the deadline.

Custom profiles can be saved, updated, renamed, duplicated and deleted, capped at 30 per browser. They are available from the profile dropdown in future lobbies; there is no account requirement. Host tools also reorder/remove lobby players, invite via links/QR, open the TV, pause/resume, restart, return to lobby, and end while retaining completed totals. Restart increments the game generation to reject stale requests. Idle lobbies expire after 30 minutes; active/paused games expire after 24 hours without gameplay activity. Only the most recent 100 round summaries and 60 public events are retained, without truncating cumulative totals.

## Verification

`npm test` includes 44 Skyjo engine/adapter tests and all existing game tests. The Skyjo suite covers deck composition/deals, simultaneous reveals, starting ties, privacy, draws, swaps, discard order, negative columns, invalid positions, final turns/reveals, penalties, co-winners, thresholds/fixed rounds, house rules, reshuffling, replay/stale generations, lobby management and forged seat IDs, mode preservation, deadlines/pause, timeout policies, offline recovery, authoritative next rounds, durable restoration and room isolation. Returning selected discards is tested for exact restoration, final turns, unchanged deadlines, irreversible information boundaries, duplicate/stale requests and durable reloads. Fifteen complete simulated games at 2/6/8 players check conservation of all 150 physical cards after every transition.

`npx playwright test tests/e2e/skyjo.spec.ts` covers homepage/profile/QR flows, independent phone controls, actual touch swipes without accidental reveals, free browsing and follow mode, small/landscape viewports, reduced motion, eight-player TV/phones, private pending draws, display mutation denial, fullscreen, mode changes, refresh, simultaneous duplicate commands, concurrent lobbies and a complete game to the final scoreboard. Discard-return coverage includes Normal mode, a pending selection surviving refresh and live TV switching, small-screen controllers, synchronized TV piles and committed private draws. Screenshots are written to ignored `test-results/`.

Verified on 2026-11-02: all 234 engine/adapter tests pass, including 35 Skyjo tests. All six Skyjo browser scenarios pass, including every supported TV player count at both 720p and 1080p. The 25 existing-game scenarios were also exercised; one Just One screenshot timed out in the combined run and passed in isolation. A subsequent Skyjo run hit a Playwright trace ZIP stream error during browser-context cleanup after its assertions; cleanup is now sequential, and the complete six-scenario run passes with `--trace off`. Frontend TypeScript/Vite and ESLint, backend TypeScript, Worker deployment dry-run and Git whitespace checks pass.

Run the existing frontend build/ESLint, backend TypeScript/Worker dry-run and complete Playwright regression suite before deploying. Cloudflare deployment order remains Worker first, then `wrangler pages deploy frontend/dist --project-name top-ten --branch main --commit-dirty=true`. This preserves the existing hosting, bindings and audience, and does not commit or push unrelated local changes.

## Deployment result — 2026-11-02

Deployed successfully to [Play Skyjo](https://top-ten.pages.dev/skyjo). Worker version: `f39a9981-d3ac-4d1f-914a-5f5d52bbf823`. Final Pages deployment: [de980f89.top-ten.pages.dev](https://de980f89.top-ten.pages.dev), published to the existing `main` production alias. Both the public page and Worker API return HTTP 200. Two live Playwright smoke scenarios passed against production: independent phones playing/reconnecting with private draws and free browsing, plus eight-player TV/controller play, display permissions, fullscreen, private pending cards, refresh, full-table inspection and seamless switching in both directions. Test lobbies were ended automatically. Local development servers were stopped. Changes remain uncommitted; no Git push was performed.

## Discard selection update — 2026-11-08

Normal phones and TV controllers now offer **Return to discard** for a pending discard selection. The server accepts `return-discard` only from the active player before placement, restores the same card to the pile, and leaves the turn deadline unchanged. No stored fields or migrations were added; existing pending discard selections can use the action after refreshing the client.

Verified: all **245 Node tests** (including **40 Skyjo tests**), frontend/backend TypeScript, ESLint, frontend production build, Worker dry run, and all **seven local Skyjo browser scenarios** passed. The new discard-return scenario also passed against the production alias, covering two phones, a read-only TV, refresh, live mode switching, pile synchronization and committed private draws. Its QA lobby was ended automatically.

Published Worker version `f2a51467-cf2d-4841-b915-64ca8c0763f7` before Pages deployment [7046ad63.top-ten.pages.dev](https://7046ad63.top-ten.pages.dev). The production alias [top-ten.pages.dev/skyjo](https://top-ten.pages.dev/skyjo) serves the current build. Source changes remain uncommitted; no Git push was performed.

## Keep choice update and repository checkpoint — 2026-11-08

**Back to choices** now cancels a pending Keep decision while retaining the same private draw. The server's `cancel-keep` action accepts only the active owner's kept deck card, returns to the drawn-card decision, preserves piles/grid/turn/deadline, and emits no private card value in public events. Duplicate and stale requests cannot reopen a later decision. Placement, public discard and flips remain committed.

Verified locally: **249 Node tests**, including **44 Skyjo tests**; all **37 browser scenarios across the platform**, including **eight Skyjo scenarios**; frontend/backend TypeScript, ESLint, frontend production build and Worker dry run. Coverage includes returning to Keep / Discard on phones and TV controllers, refresh, continuing with the same card, choosing Discard afterward, and private views after durable reload.

This update is part of the local multi-game repository checkpoint. It has not been deployed; the production release recorded above contains the earlier discard-return change.

## Limitations

Browser automation uses Chromium; real iOS Safari and physical television testing remain manual. Sessions belong to the browser holding the player token; a different browser cannot reclaim a seat without it. Active late joining and host transfer are not supported. Sound effects and drag-and-drop are intentionally omitted; every action uses accessible taps/buttons. The interface is English; existing games retain their language support.
