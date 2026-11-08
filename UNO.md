# UNO

UNO lives at `/uno`, with the existing `/g/:code` lobby/invite routes. It supports 2–10 people using one device each, locally or remotely. The host also plays and has no access to other hands. A read-only shared display is available under Host controls.

## Rules and research

Classic uses the 108-card deck and [Mattel W2085 instructions](https://service.mattel.com/instruction_sheets/W2085-Eng.pdf). The [Mattel two-player instructions](https://service.mattel.com/instruction_sheets/42797-4L.pdf) establish Reverse as Skip and returning play to the same player after a draw penalty. The themed cards in that reference are not included. [Ubisoft's UNO overview](https://news.ubisoft.com/en-us/article/76vBnwpX36cUvQ6ADjCgkl/uno-now-available-on-xbox-series-xs-and-ps5) confirms the popular stacking, Jump-In and 7–0 variants; these remain explicitly separate house rules here.

Open-source research included [danguilherme/uno](https://github.com/danguilherme/uno), whose [MIT license](https://github.com/danguilherme/uno/blob/main/LICENSE) and package/README were inspected, and [GameHelix/uno](https://github.com/GameHelix/uno). The first is an event-based engine that would require adapting its objects, persistence, projections, challenge windows and house-rule interactions. The second advertised MIT in its README, but its repository root did not contain a verifiable LICENSE file at inspection. No code, art, frontend or networking was copied from either project. The new engine and SVG artwork are original, and no additional runtime dependencies or third-party notices are required by this change.

Classic behavior includes seven-card dealing, uniformly shuffled server decks, all opening-card effects (including returning an opening +4), drawing voluntarily, only playing the drawn card afterward, Wild color choice, +4 restrictions and challenges, UNO catches, two-player action rules, reshuffling while keeping the top discard, and scoring after the final penalty. A random dealer is selected for the first round; the dealer rotates afterward. Dealer-selection ceremony is automated.

The normal Play controls enforce legal +4 play. To retain the actual challenge mechanic, a player may explicitly select **Deliberate +4 bluff**, then choose a color. This is the only intentional exception, with the normal challenge penalty. The engine records the prior color and hand at play time. A challenge succeeds if that hand had a card of the prior color. Only the challenger receives the historical hand evidence, as the printed rules require. The host receives no special inspection privilege.

Call UNO by arming **UNO with play**, or immediately after playing down to one card. A missed call can be caught for two cards until the next accepted play/draw/challenge. Automatic skips and +2 draws do not close the window. Server command ordering resolves races. There are no arbitrary reaction timers.

## Profiles and interactions

- **Classic UNO:** no house rules.
- **Stacking UNO:** +2-on-+2 and +4-on-+4, without mixed stacking.
- **Party / Chaos UNO:** same-type stacking, Jump-In and 7–0.
- **Custom profiles:** choose all eight switches in Advanced rules, then Save as Profile. Save as Profile also duplicates. Update / rename edits the selected custom profile. Delete removes the saved profile but keeps current lobby rules. Up to 50 profiles are stored at `game-night-uno-profiles-v1` in this browser's local storage. They are validated when read and persist across future lobbies. They do not sync between devices.

All participants can open the active profile explanation. The selected rules are validated and persisted on the server. Rules and game length lock after Start; restart returns to a lobby with the same identities and selected settings, clears scores, and increments the generation so previous actions cannot replay.

Interaction policies are displayed next to the controls:

- A +2 of any color can stack on a pending +2. A +4 can stack on +4 only if +4 stacking is enabled.
- Mixed stacking requires both stacking switches: +4 may follow +2; +2 may follow +4 only in the chosen color.
- A stacked +4 accepts the preceding +4. Only the most recent offender remains challengeable. If that offender is guilty they draw four and the challenger retains their turn with any older debt still pending, of its original type. An unsuccessful challenger draws the entire total plus two and is skipped. Earlier accepted +4s cannot be challenged retrospectively.
- Going out stops the stack: the total is paid before scoring, with no further stacking. A final +4 still has to be accepted or challenged before the round ends.
- Jump-In requires the exact color and number/action, excluding Wilds. It is unavailable while a penalty, opening color choice, or drawn-card decision is pending. Effects run from the jumping player's seat; the first accepted command wins.
- Multiple-card play permits up to two identical **number** cards in one normal turn, with one 7–0 effect. Actions, Wilds, Jump-In and drawn-card play remain single-card actions.
- A 7 swaps the remaining hand with a chosen opponent. A 0 passes hands in the current direction. Transfers resolve before testing for an empty hand, so a final 7/0 may give another person the win. Transferred one-card hands are announced automatically.
- Draw-until stops at the first legal card, which may be played or kept. It never expands fixed penalties. Forced play prevents voluntary draw, keeping a playable drawn card, and evading an available legal penalty stack. A bluff is never a required move.
- If every player passes because no cards are available and nobody can play, the round is drawn, with no awarded points. It counts toward a fixed round limit. Tied final scores share the win.

Game length supports a single round, 1–100 fixed rounds, or a 50–10,000 point target (default 500). Points always go to the round winner from opponents' remaining cards. Single-round play is the quick default. Subsequent rounds start automatically after a persisted 12-second results interval; any player can continue earlier. The same interface is used locally and remotely because the server can adjudicate every move.

## Architecture

- `shared/uno.ts`: public types, profiles, descriptions and configuration validation. No private deck state.
- `backend-do/src/uno/engine.ts`: synchronous authoritative state transitions, cryptographic shuffling, turn validation, challenges, penalties, scoring and explicit private projections.
- `backend-do/src/uno/room.ts`: existing Durable Object namespace, `uno` storage key, authenticated HTTP actions, per-identity WebSocket snapshots, alarms, persistence, reconnect and presence.
- `frontend/src/components/UnoGame.tsx`: table, hand, controls, events, results, lobby and role controls.
- `UnoCard.tsx` and `lib/unoTheme.ts`: one SVG card system with reusable palette, original geometrical designs, text/symbols and accessible labels.
- `UnoSettings.tsx` and `lib/unoProfiles.ts`: lobby configuration, rule explanations and persistent profile management.
- `frontend/src/uno.css`: responsive table and large touch controls; reduced-motion support.

Mutations are serialized through the room's concurrency gate, applied to a clone, persisted, then broadcast. A move carries the generation, round, action revision and a request ID. Stale commands fail; retrying the same ID cannot execute twice. Presence uses a separate version and does not invalidate moves. The client retains uncertain network requests for an idempotent retry. Socket reconnection, polling fallback and session persistence reuse the existing platform hook. Each token's snapshot contains only that player's hand; display snapshots contain none. Tokens, deck order, challenge guilt and other hands never enter public snapshots. Hands are not optimistically mutated in the browser.

The host can order/remove players before starting, start, end, reset, transfer hosting, and open a safe display. Rules are never manually adjudicated. New players join before starting; refreshing with the original browser identity restores a seat during play. A returning player needs the original browser storage. No accounts or cross-device seat recovery are introduced.

## Verification and deployment

```sh
npm test
npx playwright test
npm --prefix frontend run lint
npm --prefix frontend run build
npm run lint --workspace backend-do
npm run build --workspace backend-do
```

Run build commands sequentially because their existing prebuild scripts regenerate the same question-bank assets. The Playwright Worker uses `.wrangler/e2e` storage, separate from ordinary development rooms, so old dev rooms do not trigger the existing usage guard during tests.

UNO tests cover 33 engine/adapter scenarios, including simulated complete games for all 160 valid switch combinations with card conservation on every move. Browser scenarios cover complete classic/two-player and chaos/fixed-round games, three identities, QR links, profile creation/edit/duplicate/delete/refresh, private WebSocket views, forged moves, shared displays, reconnect, automatic next rounds, ten-player mobile layouts, touch target sizes, reduced motion and settings updates under added network latency. Existing games retain their tests.

Deployment uses the original Worker and Pages project, Worker first:

```sh
npm run deploy:worker
npx wrangler pages deploy frontend/dist --project-name top-ten --branch main --commit-dirty=true
```

No new bindings, migrations, databases, paid APIs or hosting providers. The production URLs remain `https://top-ten.pages.dev/uno` and `https://top-ten.maxschimmel17799.workers.dev`. Deployment does not commit or push the user's pre-existing uncommitted work.

Production verification also found that the existing usage monitor counted 29 abandoned lobbies indefinitely, blocking new games. Its active-session estimate now excludes entries after the existing 30-minute lobby / two-hour gameplay inactivity windows. Configured thresholds and recorded D1 usage are retained. Three regression tests cover expired sessions, live sessions and guard enforcement.

Verified on 2026-10-30: all 119 engine/schema/adapter/regression tests and all 17 local browser scenarios passed. Frontend ESLint and TypeScript/Vite production build passed; backend TypeScript and Wrangler dry run passed. All three UNO browser scenarios also passed against the deployed production site, including full multiplayer rounds. The existing `npm run test:live` passed for English/German Just One, Top 10, PWA activation and private API caching checks. Sounds Fishy and Wavelength production catalogs were checked. Final Worker version: `7339eb74-cf6d-4a95-9f4d-380f5ec9afb3`; Pages deployment: `https://8d48b559.top-ten.pages.dev` (production alias `https://top-ten.pages.dev`).

Multiplayer requires internet. The interface is currently English. Rules profiles remain browser-local. A disconnected player's turn is retained for their return; there is no bot or automatic turn timeout. The lobby expires after 30 minutes of inactivity; gameplay expires after two hours without an action. Saved profiles survive room expiry.
