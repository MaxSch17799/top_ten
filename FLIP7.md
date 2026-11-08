# Flip 7

Available at `/flip7` and on the game selection homepage. Supports 2–12 players with the host in a normal seat. No new service, database, binding, migration, or third-party game code is required.

## Play and display controls

Create a lobby, invite friends with the existing link/code/QR panel, select rules, and start. The dealer rotates clockwise. Dealing, forced draws, bust checks, protection, scoring, reshuffling, and winning run automatically. Stay requires a retained card, including a zero, modifier, or Second Chance.

**Normal** is the default. Each device shows the complete face-up table with all numbers, modifiers, protection, potential/total scores, statuses, dealer, current decision, deck/discard counts, recent flips, and round history.

Choose **Host controls → Display Mode → TV / Party** to make phones minimal controllers. **Open TV Display** opens `/g/:code/display#token=…`; open that URL on the television/shared computer and use Fullscreen. Phones show the player name, score, large HIT/STAY buttons when legal, target choices when needed, and a waiting/inactive state otherwise. **Peek at the full table** is optional. Administration stays inside Host controls.

Switch back to **Normal** at any time. Both modes share a single room and engine. Display changes preserve the game revision, cards, scores, deck order, pending effects/targeting, turn continuation, and timers. An in-flight decision remains valid. The dedicated TV always shows the full table independently of the phones’ display preference.

The TV connects with a distinct read-only credential, never consumes a seat, and receives no player token, host display URL, or administration privileges. Mutations return HTTP 403. Its token is in the URL fragment to avoid the page request/referrer and is retained in that tab’s session storage for refreshes. Closing/reopening the TV has no effect on player connectivity or gameplay.

## Verified rules

Consulted on 2026-11-02:

- [Publisher product page](https://theop.games/products/flip-7) and [publisher FAQ](https://theop.games/pages/flip-7-faqs).
- [Publisher-maintained Dized rules](https://rules.dized.com/game/dPDRM857TU-BFRF7LzGE0g/flip-7).
- [Dized FAQ](https://rules.dized.com/game/dPDRM857TU-BFRF7LzGE0g/faq): immediate initial actions, undealt Freeze targets, protection during forced draws, deferred actions discarded on bust/Flip 7, original turn order, and everyone participating in tie-breaks.
- [How to Play](https://rules.dized.com/game/dPDRM857TU-BFRF7LzGE0g/wGXhPMBFQ2i1ymgjH16VkA/how-to-play): Stay requires a retained card.
- [Scoring](https://rules.dized.com/game/dPDRM857TU-BFRF7LzGE0g/-UTTEBFOTuyjbeZOlRQPUA/calculate-scores) and [deck handling](https://rules.dized.com/game/dPDRM857TU-BFRF7LzGE0g/wzjlmw8LSdeycfWo_EvxOg/starting-the-next-round).

The standard recipe is 79 number cards (one zero, one one, two twos through twelve twelves), six score modifiers, and three of each action: 94 cards. ×2 doubles only the number sum, before modifiers and the Flip 7 bonus. Round cards go to discards before the next round; unused draw cards retain order. Mid-round reshuffles never collect held cards, including busted/stayed players’ cards.

All engine code and card SVGs are original. No third-party implementation or proprietary artwork was copied. This is an unaffiliated private implementation of the game by Eric Olsen / The Op Games.

## Settings and recovery

- Classic: target 200, seven unique numbers, +15 bonus, standard deck. Quick: 100 points. Long: 300.
- Advanced house rules: custom target, bonus, unique count (3–13), fixed rounds (ties extend play for everyone), turn/target timers, automatic Hit or Stay on timeout, and 0–9 copies of each action.
- Stay timeouts draw instead if no card is held. Target timeouts choose self if eligible, otherwise the first eligible seat. These automation choices are explicit house behavior.
- Automatic next rounds after 10 seconds, or host-controlled Next round. Automatic progression uses persisted alarms.
- Browser-local named profiles: save/update, rename through the profile name, duplicate, select, delete. **Apply rules** commits a draft to the lobby.
- Rules lock after starting. Display mode remains editable. Pause/resume shifts pending deadlines exactly by paused duration. Add 30 seconds extends the current decision. Restart retains seats but resets the match; Return to lobby resets progress for rule/order editing. End game retains completed-round totals without scoring an unfinished round.
- Offline players keep their state. The same browser reconnects to the same seat. Without timers, required decisions wait. The host can pause or explicitly resolve an offline decision: Stay with a card, Hit otherwise; self/first eligible for targeting. Recovery cannot act for connected players. There is no automatic host transfer.

## Architecture

- `shared/flip7.ts`: types, validated settings, presets, labels, scoring.
- `backend-do/src/flip7/engine.ts`: transport-free authoritative state machine, recipe-driven deck, cryptographic Fisher–Yates shuffle, task queue, pending selections, timers and scoring. Each forced sequence holds its deferred actions, releases them after three draws, and discards them if its owner busts or the round ends. A frozen owner can still assign earned effects to other active players. Original-turn continuation survives nested actions. Physical cards have stable unique IDs.
- `backend-do/src/flip7/room.ts`: existing Durable Object adapter pattern, persisted `flip7` snapshot, serialized operations, WebSocket broadcasts, authentication, replay IDs and alarms. Mutations apply to clones and commit only after validation. Generation/round/revision guards reject obsolete moves. Display changes do not increment the gameplay revision.
- `frontend/src/components/Flip7Game.tsx`: one table projection for Normal/TV, separate minimal controller, lobby, host controls, results and event animations. Existing `useGameConnection` handles reconnect backoff, fallback polling and stale-state rejection.
- `FlipCard.tsx`: one original SVG template for the entire deck and back. Cream cards, mint table and the existing title font. Card flights, reveals, bust/protection/freeze highlights, Flip 7, scores and winners consume server event IDs. Reduced motion disables animations. The server paces automatic draws at 650 ms independently of animation completion.
- `FlipActionReveal.tsx`: shared 4.8-second action announcements on every Normal phone, Party controller, and TV. Second Chance has floating hearts and a heartbeat; Freeze has icicles, snowfall, and a crystal; Flip Three unfolds a three-card fan with sparks. Public draw/effect events supply the player's name and outcome. Fast chains queue rather than replacing an unread reveal, repeated snapshots never replay an event, and mode changes preserve the current announcement. A deciding phone uses a compact layout above its controls. Reduced motion retains the same reading time with a static card and caption. This presentation never submits an action or changes authoritative rules/timers.

The TV grid supports twelve seats in four columns/three rows at 1080p and 720p. Phone tables use compact responsive grids. Round/final scoreboards overlay the TV table.

## Validation

```text
npm test
npx playwright test tests/e2e/flip7.spec.ts
npx playwright test tests/e2e/flip7-animations.spec.ts
npm run test:e2e
npm --prefix frontend run lint
npm --prefix frontend run build
npm run lint --workspace backend-do
npm run build --workspace backend-do
```

Use `npm.cmd`/`npx.cmd` if PowerShell blocks the npm script shim. The engine/adapter suite covers deck composition, initial dealing, all special interactions, nested chains, turn order, scoring/ties, reshuffles/rotation, custom rules, pause/timers/recovery, presentation switches, retries, permissions, durable restoration and independent rooms. Twenty randomized six-player matches verify card conservation through completion. Browser tests use real local Worker rooms and isolated player/display contexts for profiles, Normal/TV, targeting, mode switching, reconnects, permissions, small phones, reduced motion, twelve seats, 16:9 layouts and final results. Existing game suites remain enabled.

## Deployment and limits

Deploy the existing Worker before Pages; no new resources or migrations:

```text
npm run deploy:worker
npx wrangler pages deploy frontend/dist --project-name top-ten --branch main --commit-dirty=true
```

Uses the existing account, `top-ten` project and audience. Pre-existing uncommitted work for other games is preserved.

Deployed on 2026-11-02 to [the existing production website](https://top-ten.pages.dev/flip7). Worker version: `c17ce845-508a-4f44-ab85-e10781874ace`; Pages deployment: `74fe6c58`. All 199 engine/integration tests (35 Flip 7 tests), all 25 local browser scenarios, frontend lint/build, backend type-check, and Worker build passed. All five Flip 7 browser scenarios also passed against the deployed production Worker and Pages site, including real phone controllers, TV reconnection, targeting through mode changes, twelve-player layouts, and completed-game scoring. Screenshot review covered Normal and Party phone views plus 1080p/720p twelve-seat TV views.

Limits: 12 players; profiles stay on the saving browser; reconnection requires the saved browser credential; network required for the TV; no host transfer. Lobbies expire after 30 minutes idle; games after 24 hours without a gameplay/admin action. Display activity never extends the room lifetime. If no drawable cards or eligible discards remain, the server banks the round without inventing cards.

### Action reveal update · 2026-11-08

The 4.8-second action presentation was deployed to the existing Pages project (`aa4f3356`). This frontend update uses the existing public event stream and needs no Worker deployment or game-state migration. Frontend lint/type-check/build, all 245 unit/integration tests, the five gameplay browser scenarios, and four new animation browser scenarios passed. The animation checks cover all three device views, minimum reading time through unrelated state updates, queued actions, mode changes, target controls on a 320px phone, protection saves, cancelled deferred effects, event deduplication and reduced motion. Screenshot review covers heart, frost, three-card fan and compact targeting views.
