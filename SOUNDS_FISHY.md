# Sounds Fishy implementation notes

## Existing platform inspected

The clean starting checkout was `main` at `2da4b70`, following `3876303`. Those commits added Just One and then timed drafts/live controls. The repository has a React 19/TypeScript/Vite frontend, a Cloudflare Worker and the existing SQLite-backed `GameDurableObject`. Top 10 also uses D1 for question administration. Root and backend Wrangler configurations describe the same existing resources. No new resource, paid service or migration is required.

Top 10's `/top10`, `/host` and `/g/:code` routes are preserved. Just One's `/just-one` remains unchanged. The homepage registry now includes Sounds Fishy at `/sounds-fishy`, with the shared four-digit invitation namespace dispatching all three game types. Nicknames, per-room session tokens, QR invites, the usage gate and reconnecting WebSocket/polling hook are reused. English/German interface selection is saved separately from question-bank selection.

Cloudflare's existing Pages project is **top-ten**, production branch `main`, at **https://top-ten.pages.dev/**. The old brief's `max-alina.pages.dev` is not the configured project. The existing Worker is `top-ten.maxschimmel17799.workers.dev`. Worker deployment precedes Pages deployment.

## Engine and confidentiality

`backend-do/src/soundsFishy/engine.ts` owns the state machine: `LOBBY → PREPARATION` (party) or `COLLECTION` (written) `→ ELIMINATION → RESULT → next round / COMPLETED`. Pause retains the underlying phase and deadline remainder. Preparation, decision and optional eight-second result progression deadlines are persisted and run through the existing Durable Object alarm. Decision expiry banks current points; missing written answers pause for the host rather than inventing answers. Timers and automatic progression start disabled.

Party mode is the default and requires no answer entry, ready buttons or per-speaker actions. Players privately see the correct answer and only their own role. Speaking order runs clockwise after the Guesser. The Guesser or enabled host facilitator starts guessing, selects a suspected liar and reveals their fish. Selection has a small inline confirmation to prevent mistaken disclosures; there is no modal or pretend undo after a reveal. Banking, catching Blue or catching all Reds resolves and scores the round automatically. Scores follow the [physical rules](https://gameon.mt/wp-content/uploads/2025/11/Sounds_Fishy_Rules.pdf), including surviving Reds, early-caught Blue and the all-Reds bonus. Previously earned scores remain intact. Default games give everyone two Guesser turns at 4–5 players and one at 6–10. Custom rounds warn when turns are unequal. Ties share victory.

Written mode uses the same engine. Blue's answer is read-only and the server ignores any attempted replacement. Reds enter at most 240 Unicode characters. Equivalent official/accepted answers are rejected locally by deterministic normalization on the server; arbitrary bluffs are not fact-checked. Submissions are immutable, recipient-private and persisted. All answers appear together, attributed to their authors, when every fish has submitted. Drafts survive refresh in the same tab; committed submissions survive on the server. Mode/bank/timer changes during a round are queued for the next round, preserving the original question, roles and submissions. Result auto-progression can be switched off immediately or paused.

`room.ts` authenticates tokens, serializes mutations through `blockConcurrencyWhile`, applies commands to a clone and persists before broadcasting. A generation, unique round ID, phase and actor-scoped action ID prevent stale commands and repeated scoring. Hidden-role choice and question draws use rejection sampling over `crypto.getRandomValues`. The pure `scoreRound` function is independently tested. Full question data is snapshotted in private storage for the current round, so a bank deployment does not change an active answer.

`serializeForPlayer` builds explicit projections; it never spreads authoritative state into a client view. Guesser, late spectator and display snapshots get no unrevealed answer, alternatives, explanations, sources or roles. The host gets the same role-based restrictions as any player. Public roles contain only eliminated fish until resolution. The separate `/g/:code/display#token` link uses a random read-only display token, never a host/player token; it is safe in another tab of the host's browser. No game commands are accepted with that token. Secret banks are compiled only into the Worker, and tests scan frontend public and built assets for leaks.

## Recovery and administration

Returning in the same browser restores the saved identity, current role and any committed submission. Guesser disconnects and missing written fish pause the round; roles are never secretly reassigned. The host or Guesser can resume after reconnection. A submitted fish's disconnect does not remove its answer. Hosts can pause, replace an unanswered question, void a disputed round, replay, correct scores with a required reason, transfer hosting, end or restart. Corrections and administrative actions have a bounded public audit log. Voiding the current result subtracts its awarded points before replay. A replay keeps the Guesser and round number and consumes a new question/round ID.

An offline host retains ownership for reconnection. After 60 seconds, a participating player can explicitly recover hosting; the old host immediately loses administrative permissions. A permanent departure can be handled by restarting and sitting out that player in the lobby. Membership and scoring are never silently altered during a round. Late arrivals are spectators until a restart admits them to the next game. Seats can be reordered or disabled in the lobby, including the host's seat. Up to ten saved identities occupy the room; use a fresh room when replacing a full ten-seat group. Leaving/navigation retains the saved token for reconnection.

## Content and checks

Both full user-supplied banks are installed: **150 English and 150 German questions**, replacing the original six-question development samples. Their canonical copies live in `question-banks/sounds-fishy/`; the original root files are retained as ignored import originals. Bank updates and the exact schema are described in [`question-banks/sounds-fishy/README.md`](question-banks/sounds-fishy/README.md).

```sh
npm test
npm --prefix frontend run lint
npm --prefix frontend run build
npm run lint --workspace backend-do
npm run build --workspace backend-do
npm run test:e2e
```

Engine tests cover official totals/rotation, every scoring ending, ties, secrecy, Blue-as-host, locked and simultaneous written answers, stale/duplicate actions, permissions, pause/deadline behavior, mode changes, disconnects, host transfer/recovery, void rollback/replay, replacement, audit corrections, bank schema/duplicates/Unicode/exhaustion/fallback and public asset exclusion. Browser tests cover a full official four-device game, written play, simultaneous requests, reconnects, same-browser display privacy, QR invitations, English/German UI, mobile/tablet widths and the existing Top 10/Just One suites.

## Initial game deployment — 2026-10-29

- All **55 engine/bank/security tests** passed, including the existing 36 Just One tests. A final regression also checks that voiding an already-corrected result restores its prior totals without negative scores or residual correction points.
- All **10 local browser/integration scenarios** passed. The display-rejection request-body warning seen during development was fixed and its scenario rerun successfully.
- Frontend ESLint and TypeScript/Vite production build passed. Backend TypeScript and Wrangler deployment dry run passed. Public/built assets were scanned for secret-bank content.
- Deployed the existing Worker (final version `8e1c363b-f1bc-4c87-b206-e868d01e6744`) and a manual production Pages deployment at `https://750a68d1.top-ten.pages.dev`, served by `https://top-ten.pages.dev`.
- All **three Sounds Fishy production browser scenarios** passed: full official eight-round four-device party game, written play/mode queue/host transfer, and German UI/concurrent submissions/authentication/display privacy.
- `npm run test:live` passed English and German Just One games, Top 10 creation/start/secret/end, PWA activation, API cache exclusion and browser error checks on production.
- A final live four-player API check verified correction + void rollback and replay on the final Worker version; its room was ended automatically.
- No resources or audience settings were changed. Source changes remain in the local checkout; no Git commit or push was made.

To repeat Sounds Fishy's live tests from PowerShell:

```powershell
$env:PLAYWRIGHT_BASE_URL = 'https://top-ten.pages.dev'
$env:FISHY_BACKEND_URL = 'https://top-ten.maxschimmel17799.workers.dev'
npx.cmd playwright test tests/e2e/sounds-fishy.spec.ts
```

Those environment variables belong only to that shell. Remove them before running the local browser suite. Live verification creates and finishes its own rooms.

## Full classic bank import — 2026-10-29

Imported the user-supplied `sounds-fishy-classic-en.json` and `sounds-fishy-classic-de.json` unchanged into the canonical bank directory: **150 questions per language, 300 total**. Both files pass the full schema, unique-ID and normalized-question checks and are now registered as full banks. Sample questions and sample labels were replaced. The original root files remain untouched as ignored import copies.

All **56 automated tests** passed, including complete nonrepeating 150-question cycles for both languages and checks that no private bank data appears in frontend public/built assets. Backend TypeScript and Wrangler dry-run build passed. All **four local Sounds Fishy browser scenarios** passed. After deployment, all **four production browser scenarios** passed, covering a full official party game, written mode, German UI, and full German bank selection/play with no sample warning. A live catalog check confirms both banks expose 150-question metadata only.

Worker version `ea44b168-b89d-4245-b6e6-7afeb7e6d91f` serves the updated content. No frontend redeployment was needed: `https://top-ten.pages.dev/sounds-fishy` loads its bank catalog from the Worker. Existing rounds retain their saved question; subsequent draws use the full banks. Source changes remain local and uncommitted.
