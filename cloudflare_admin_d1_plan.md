# Cloudflare Admin + D1 Plan

Last updated: April 4, 2026

This document is a handoff-ready implementation plan for adding:

- database-backed question banks on Cloudflare
- a lightweight admin page with password access
- CSV/Excel import and CSV export
- usage monitoring and near-limit gating
- version history for database-backed question banks

This plan is based on the current repo state and the clarified product decisions from the user.

## 1. Goals

- Keep the app usable on Cloudflare free tier for low-volume personal use.
- Keep existing repo-based question banks available exactly as they are now.
- Add database-backed question banks that can be created and edited from an admin UI.
- Make database-backed banks available for new games only.
- Freeze the selected bank into game state at game creation so later edits do not affect active games.
- Add simple admin access using the password `MAX`.
- Support CSV import and, if practical, Excel import in the browser.
- Support CSV export in the browser.
- Add usage monitoring with low overhead.
- When usage is near the free-tier threshold, block new lobby creation unless the admin password is entered again.
- When usage is near the free-tier threshold, block admin write/import actions unless the admin password is entered again for that session.
- Keep the monitoring system cheap enough that it does not become a meaningful source of extra usage itself.
- Keep gameplay feeling responsive and unchanged during rounds.
- Prevent accidentally abandoned games from sitting open on the same round for hours.

## 2. Important Constraints

### Current architecture

- Frontend is a React SPA with routes in `frontend/src/App.tsx`.
- Frontend currently has:
  - `/`
  - `/host`
  - `/g/:gameId`
- Backend is a single Worker entrypoint in `backend-do/src/index.ts`.
- Multiplayer game state lives in a Durable Object in `backend-do/src/game.ts`.
- Question banks currently exist as static JSON files under `question-banks/`, mirrored into:
  - `frontend/public/question-banks/`
  - `backend-do/question-banks/`
- The host bank selector is driven by a manifest loaded from `frontend/src/lib/questionBank.ts`.

### Important existing behavior

- Current gameplay uses normal Durable Object WebSockets, not WebSocket hibernation.
- This matters because staying on the free tier is more threatened by long-lived DO WebSockets than by a small D1 question-bank feature.
- D1 must not sit on the hot path for every round or every player action.

## 3. Confirmed Product Decisions

- Free tier is important, but not absolute.
- Near free-tier limits:
  - block new lobby creation by default
  - allow override by asking for the admin password again
- Estimated usage is low:
  - mostly the owner and a few friends
  - occasional sessions
  - maybe up to 30 players in an extreme case, but more commonly around 5
- Database bank edits should affect new games only, not games already started.
- Admin access should be simple:
  - small button on main page
  - password page
  - password is `MAX`
  - does not need strong security
- CSV and Excel import are desired if browser-side parsing is practical.
- CSV export is desired, preferably browser-side.
- Import mode should default to append.
- Overwrite must be explicit.
- Near-limit admin actions should require password re-entry for that session.
- Version history is desired if the complexity stays moderate.
- Static repo banks should appear in the admin area as read-only.
- Every bank, static or DB, should have a `Make a copy` action that creates a new editable DB bank.
- Duplicate bank names should be blocked.
- Excel import may be limited to the first worksheet in v1, and the UI should say so clearly.
- Export only needs to support the current bank state.
- Near-limit override should last until the browser tab is closed.
- Admin usage display can be rough and approximate as long as it is lightweight and understandable.
- The game should auto-clean up if it sits on one active round for roughly 30 minutes without progress.
- Never-started lobbies should also expire after inactivity.

## 4. Cloudflare Limits That Matter

These were checked against official Cloudflare docs on April 4, 2026.

- Workers Free:
  - `100,000` requests per day
  - resets at midnight UTC
  - static assets do not count the same way as Worker requests
  - Free CPU limit is still small enough that heavy server-side parsing should be avoided
- Durable Objects Free:
  - `100,000` requests per day included
  - `13,000 GB-s` duration included
  - normal WebSockets can consume duration
  - WebSocket hibernation exists specifically to reduce idle WebSocket cost
- D1 Free:
  - `5 million` rows read per day
  - `100,000` rows written per day
  - `5 GB` storage per account
  - `500 MB` max per database

### Practical conclusion

- For this app, D1-backed question bank management is likely cheap enough on free tier.
- The bigger quota risk is still the gameplay transport model if many clients keep WebSockets open for long periods.
- Do not design the admin/data feature in a way that adds per-request D1 writes everywhere.

## 5. Recommended Overall Architecture

Use a hybrid model:

- Static repo banks remain available exactly as they are.
- D1 stores only admin-created and admin-edited banks.
- The host bank selector shows a merged catalog:
  - static banks from the manifest
  - database banks from a new API endpoint
- When a game is created:
  - if the chosen bank is static, resolve it from the static registry
  - if the chosen bank is database-backed, fetch the full bank from D1 once
  - snapshot the full bank into the game state or into the DO-created game metadata
- During gameplay:
  - never re-read that bank from D1
  - all round prompt selection uses the frozen bank already tied to the game

This gives:

- no runtime dependency on D1 during rounds
- safe behavior when a bank is edited while a game is already running
- static repo banks and dynamic D1 banks coexisting cleanly

## 6. Admin Authentication Strategy

Use simple backend-issued session tokens. Do not put the password check only in frontend code.

### Recommended behavior

- Add a small `Admin` button to the landing page.
- Add frontend routes:
  - `/admin/login`
  - `/admin`
- On login:
  - user enters password `MAX`
  - frontend posts to backend
  - backend validates against an environment variable, not a hardcoded frontend constant
  - backend returns a short-lived signed admin session token
- Frontend stores that token in `sessionStorage`
- All admin API requests send the token in `Authorization: Bearer ...`

### Why this approach

- It is simple.
- It matches the current split where frontend and backend may be on different origins.
- It avoids cookie/CORS complexity.
- It is weak by real security standards, but acceptable for this project because:
  - there is no sensitive personal data
  - the user explicitly requested simple access
  - damage is mostly limited to question bank admin operations

### Important note

The password should still live in a Worker secret or environment variable like `ADMIN_PASSWORD`.

Do not hardcode `MAX` in the frontend bundle.

## 7. Database Choice

Use D1.

Reasons:

- natural fit for editable structured content
- easy version history model
- cheap enough for this scale
- better than KV for queryable lists, revisions, and metadata

Do not use D1 for high-frequency gameplay state.

Durable Objects should continue to own live session state.

## 8. Suggested D1 Schema

Use the following logical tables.

### `question_banks`

- `id` TEXT PRIMARY KEY
- `slug` TEXT UNIQUE NOT NULL
- `name` TEXT UNIQUE NOT NULL
- `source` TEXT NOT NULL
  - expected values:
    - `db`
- `status` TEXT NOT NULL
  - expected values:
    - `active`
    - `archived`
- `created_at` INTEGER NOT NULL
- `updated_at` INTEGER NOT NULL
- `created_by` TEXT
- `description` TEXT
- `current_revision` INTEGER NOT NULL

Notes:

- Static repo banks are not stored here.
- They remain in the static manifest.
- Database banks get stable IDs like `db_<shortid>` or slug-based IDs.

### `question_bank_revisions`

- `id` INTEGER PRIMARY KEY AUTOINCREMENT
- `bank_id` TEXT NOT NULL
- `revision` INTEGER NOT NULL
- `name` TEXT NOT NULL
- `description` TEXT
- `import_mode` TEXT NOT NULL
  - expected values:
    - `manual`
    - `append_csv`
    - `append_xlsx`
    - `overwrite_csv`
    - `overwrite_xlsx`
- `change_summary` TEXT
- `created_at` INTEGER NOT NULL
- `created_by` TEXT
- `question_count` INTEGER NOT NULL
- `snapshot_json` TEXT NOT NULL

Notes:

- `snapshot_json` stores the full bank payload for that revision.
- This keeps history simple and recovery easy.
- For this scale, storing the full bank JSON in each revision is acceptable.

### `usage_daily`

- `day_utc` TEXT PRIMARY KEY
- `worker_request_count` INTEGER NOT NULL DEFAULT 0
- `game_create_count` INTEGER NOT NULL DEFAULT 0
- `admin_login_count` INTEGER NOT NULL DEFAULT 0
- `admin_write_count` INTEGER NOT NULL DEFAULT 0
- `d1_rows_read_estimate` INTEGER NOT NULL DEFAULT 0
- `d1_rows_written_estimate` INTEGER NOT NULL DEFAULT 0
- `last_updated_at` INTEGER NOT NULL

Notes:

- This is intentionally coarse and aggregated.
- Do not write one row per request.

### Optional `usage_events`

Skip initially.

If added later, it should only be for occasional audit/admin events, not request logging.

## 9. Data Model for Question Banks

Use one normalized JSON shape for both static and DB banks at the API boundary:

```json
{
  "id": "Tobi_Fragen",
  "name": "Tobi_Fragen",
  "version": 1,
  "questions": [
    { "id": "q001", "prompt": "..." }
  ]
}
```

For DB banks, also expose extra metadata in list/admin endpoints:

```json
{
  "id": "db_party_pack",
  "name": "Party Pack",
  "version": 4,
  "questionCount": 132,
  "source": "db",
  "updatedAt": 1775347200000,
  "archived": false
}
```

## 10. API Plan

Add admin/data routes to the Worker in `backend-do/src/index.ts`.

### Public endpoints

- `GET /api/question-banks/catalog`
  - returns merged catalog:
    - static repo manifest banks
    - D1 banks
  - lightweight metadata only

- `GET /api/question-banks/:bankId`
  - returns full bank payload
  - supports:
    - static repo banks
    - DB banks
  - gameplay should not call this repeatedly after game creation

### Game creation behavior

Update `POST /api/game/create` flow:

- if bank is static:
  - use static registry as before
- if bank is DB:
  - fetch the full bank once from D1
  - validate it
  - pass the resolved bank payload into the DO creation flow
- persist enough bank snapshot data so the game uses that fixed version from then on

### Admin auth endpoints

- `POST /api/admin/login`
  - body: `{ password }`
  - returns: `{ token, expiresAt }`

- `POST /api/admin/reauthorize`
  - body: `{ password }`
  - returns short-lived override token used when the app is in near-limit mode

### Admin bank endpoints

- `GET /api/admin/question-banks`
  - DB banks only
  - include metadata and latest revision info

- `GET /api/admin/question-banks/:bankId`
  - full current DB bank plus revision metadata

- `POST /api/admin/question-banks`
  - create new DB bank from text/manual input

- `PUT /api/admin/question-banks/:bankId`
  - manual edit to current bank
  - creates a new revision

- `POST /api/admin/question-banks/:bankId/import`
  - body contains parsed payload from CSV/XLSX import
  - modes:
    - `append`
    - `overwrite`
  - creates a new revision

- `GET /api/admin/question-banks/:bankId/export.csv`
  - optional server endpoint
  - not required if export is done purely client-side from fetched bank data

- `GET /api/admin/question-banks/:bankId/revisions`
  - list revision history

- `GET /api/admin/question-banks/:bankId/revisions/:revision`
  - fetch snapshot for review

- `POST /api/admin/question-banks/:bankId/revisions/:revision/restore`
  - restore prior revision as a new latest revision

### Usage/status endpoints

- `GET /api/admin/usage-status`
  - returns:
    - current day counters
    - configured thresholds
    - near-limit boolean
    - hard-block boolean
    - warning messages to show in UI

- `POST /api/admin/limit-override`
  - password re-check for current session when near-limit gate is active

## 11. Frontend Plan

### New routes

Add:

- `/admin/login`
- `/admin`

### Landing page

Add a small `Admin` button to the main page in `frontend/src/components/LandingView.tsx`.

### Admin login page

Features:

- password field
- submit button
- stores token in `sessionStorage`
- redirects to `/admin`

### Admin page

Sections:

- usage status banner
- rough usage counters
- create new question bank
- list of DB question banks
- list of static repo banks in read-only mode
- edit selected bank
- import CSV/XLSX
- export CSV
- revision history

### Bank creation/edit UI

Use a simple textarea-first workflow.

Suggested format:

- one prompt per block
- or JSON paste mode
- or a minimal structured form

Recommended first version:

- `name`
- optional `description`
- large textarea for questions
- one line per question in `prompt only` format

Optional enhanced manual format:

- one question per line
- if the line starts with `qNNN|` use that ID
- otherwise auto-generate question IDs

### Read-only static banks and copy flow

Admin UI should show both bank types:

- static repo banks:
  - read-only
  - can be previewed
  - have `Make a copy`
- DB banks:
  - editable
  - import/export enabled
  - have `Make a copy`

`Make a copy` behavior:

- fetch full source bank
- create a new DB bank prefilled with that content
- default copied name should be `Original Name (Copy)`
- if that name already exists, auto-increment, for example:
  - `Original Name (Copy 2)`
  - `Original Name (Copy 3)`
- open the new copy in edit mode
- do not modify the original source bank

### Import UX

Browser-side parsing only.

For CSV:

- use Papa Parse or native parsing if format stays very simple

For Excel:

- use SheetJS (`xlsx`) in the browser
- process the first worksheet only in v1
- show that limitation in the import UI before upload/confirm

Recommended import workflow:

- upload file
- parse in browser
- map columns
- preview parsed questions
- choose mode:
  - append
  - overwrite
- submit normalized question list to backend

### Export UX

Prefer browser-side CSV export.

Flow:

- fetch current full bank JSON
- convert to CSV in browser
- trigger download

Suggested CSV columns:

- `question_id`
- `prompt`

## 12. Merging Static and DB Banks

The current static manifest system is good and should stay.

Recommended merged catalog logic:

- static manifest remains source of truth for repo banks
- new public API returns DB bank metadata
- frontend merges both into one selector list

Catalog item shape:

```ts
type QuestionBankCatalogItem = {
  id: string;
  name: string;
  version: number;
  questionCount: number;
  source: 'static' | 'db';
  updatedAt?: number;
};
```

Recommended display:

- static bank: `Classic`
- DB bank: `Party Pack (DB)`

Or keep display simple and omit `(DB)` if the list is already clear.

## 13. How Gameplay Should Load Banks

This is important and should not be changed later by accident.

### Required behavior

- Player chooses a bank during lobby creation.
- Backend resolves the full bank at game creation time.
- The game stores that fixed bank snapshot.
- All later round logic uses the snapshot, not a fresh DB read.

### Why

- guarantees stable prompts for the entire game
- protects active games from later edits
- reduces D1 reads
- keeps gameplay path cheap

### Implementation note

The current DO state stores only `questionBankId`.

To support DB banks correctly, extend game creation and state to include something like:

- `questionBankSource: 'static' | 'db'`
- `questionBankSnapshot?: QuestionBankDefinition`
- `questionBankRevision?: number`

For static banks, storing only ID is still acceptable if the static copy is immutable enough.

For consistency and future-proofing, storing a compact snapshot for both static and DB banks is cleaner.

## 14. Gameplay Lifecycle Safeguards

These safeguards are intended to keep the game feeling normal while preventing accidental quota drain.

### Round inactivity timeout

Add a new active-round timeout:

- if the game is in `ACTIVE`
- and the round number has not changed for 30 minutes
- and there has been no host round-control action during that window
- then auto-end the game

This specifically protects against the common case where a game is left open on one round with one question master and never advanced.

### Warning-before-timeout behavior

Preferred behavior:

- backend exposes that a game is entering timeout danger shortly before timeout
- frontend shows a warning banner/modal
- frontend may play a warning sound once when the warning state first appears

Recommended first threshold:

- enter warning state at 25 minutes on the same round
- auto-end at 30 minutes on the same round

Implementation rule:

- the warning sound is frontend-only
- if the sound implementation is annoying or unreliable, omit the sound and keep the visual warning

### Recommended state fields

Add fields such as:

- `roundStartedAt`
- `lastRoundProgressAt`
- `lastHostActionAt`

Round-progress actions should include:

- start round 1
- next round
- end game
- optionally host choosing the prompt, if that feature remains part of the flow

### Behavior on timeout

Recommended first version:

- set game phase to `ENDED`
- expose a reason code like `ROUND_TIMEOUT`
- show a clear message in the frontend such as:
  - `Game ended because this round was inactive for 30 minutes.`

This keeps the behavior simple and avoids half-open lobbies.

### Lobby inactivity timeout

Add a similar inactivity timeout for never-started lobbies:

- if the game remains in `LOBBY`
- and there has been no meaningful lobby activity for 30 minutes
- auto-end the game with a reason such as `LOBBY_TIMEOUT`

Meaningful lobby activity can include:

- game creation
- player join
- reorder
- host interaction that updates the game state

Recommended UX:

- lobby warning state at 25 minutes
- auto-end at 30 minutes

### Non-goal

Do not add high-frequency heartbeat tracking just for this timeout.

The timeout should be driven from existing timestamps and normal requests/messages, not from extra chatter.

## 15. Usage Monitoring Strategy

Do not build a detailed per-request logging system.

That would be wasteful and unnecessary.

Use a layered strategy:

### Layer 1: Cloudflare native monitoring

Primary source of truth:

- Workers dashboard analytics
- Durable Objects analytics
- D1 analytics and billing metrics
- billing notifications where available

This has zero app-side write overhead.

### Layer 2: lightweight in-app usage state

Maintain only coarse daily counters in D1 or in a singleton DO.

Track events like:

- game creation
- admin login
- admin write/import action
- optionally sampled worker request estimates

For D1 queries:

- use D1 metadata if available to accumulate approximate rows-read and rows-written counts

Do not increment a D1 counter on every normal gameplay request.

### Recommended implementation

Use a singleton Durable Object or a single daily D1 row updater with batching.

Preferred first version:

- create a `UsageMonitorDO`
- it keeps current-day counters in memory
- it periodically flushes to D1
- game-create and admin-write routes notify it
- gameplay routes do not all report into it

This keeps writes low.

### Rough in-app counters to show

The admin page should show lightweight, approximate counters such as:

- `Workers requests today / 100,000`
- `Durable Object requests today / 100,000`
- `Durable Object duration estimate today / 13,000 GB-s`
- `D1 rows read today / 5,000,000`
- `D1 rows written today / 100,000`
- `active lobbies`
- `active games`
- `connected players now`

Important:

- D1 row counts can be tracked fairly accurately from D1 query metadata.
- Worker and DO counts shown in-app should be treated as rough estimates, not billing-grade truth.
- Cloudflare dashboard metrics remain the exact source of truth.

### Approximate duration strategy

For the in-app counter, use a rough estimate instead of precise metering.

Recommended first version:

- track currently active games
- for each active game, approximate duration as:
  - active elapsed seconds for the game today
  - multiplied by `0.125 GB`
- store/update this only on meaningful lifecycle events, not every second

This is intentionally rough but directionally useful for warning banners.

### Robustness rule

Usage monitoring must never sit on the critical per-message gameplay path.

If the usage monitor fails:

- gameplay should still work
- admin pages can show `usage unavailable`
- hard blocking should fall back only to the last known coarse state

### Near-limit logic

Define config thresholds in Worker env:

- `USAGE_WARN_PERCENT=80`
- `USAGE_BLOCK_PERCENT=95`

Near-limit state:

- show warning banner in host page and admin page
- block new lobby creation unless admin override password is re-entered
- block admin write/import unless admin override password is re-entered

Hard-limit state:

- block new lobby creation completely unless override is explicitly allowed
- still do not interrupt active games

## 16. Admin Override Behavior

Use a short-lived override token separate from the normal admin session token.

### Why

- normal admin session proves access to admin page
- override token proves the user knowingly accepts running near quota

### Recommended behavior

- when usage is near-limit:
  - user attempts `create lobby` or admin write/import
  - app shows modal:
    - "Free-tier usage is near the configured limit."
    - "Enter admin password to continue for this session."
- backend returns an override token bound to the current browser tab session
- frontend stores override token in `sessionStorage`
- protected actions require that token while the system stays in near-limit state

Recommended implementation detail:

- token can still have a backend expiry for safety, but the primary UX rule is:
  - once the tab is closed, the override is gone

## 17. Version History Plan

Keep this intentionally simple.

### Revision model

- every create/edit/import/restore action produces a full new revision
- each revision stores the full snapshot JSON
- current bank points to latest revision

### Supported operations

- view revision list
- inspect a past revision
- restore a past revision

### What not to build initially

- line-by-line diffs
- branching history
- multi-user merge behavior

Those are not worth the complexity here.

## 18. Import Rules

### CSV import

Required in first implementation.

Accepted columns:

- `prompt`
- optionally `question_id`

Optional aliases:

- `id`
- `question`
- `text`

### Excel import

Preferred if browser parsing works cleanly.

Use a browser-side library such as SheetJS.

Expected behavior:

- parse first worksheet by default
- tell the user clearly that only the first worksheet is used in v1
- map columns in preview

### Validation rules

- ignore blank rows
- trim whitespace
- reject rows with empty prompt
- reject duplicate IDs if explicit IDs are provided
- auto-generate IDs where needed

### Append mode

- preserve existing questions
- add new imported questions to end
- auto-generate IDs for imported rows if needed

### Overwrite mode

- replace current question set entirely
- must require explicit selection in UI

## 19. Export Rules

First version should export only current bank version.

CSV columns:

- `question_id`
- `prompt`

Optional future enhancement:

- export a chosen historical revision

## 20. Security Position

This is intentionally light security.

### Acceptable for this project

- single password
- session token in browser storage
- no strong identity system

### Minimum protections still recommended

- password validation only on backend
- admin token signed and time-limited
- rate limit admin login attempts lightly if easy
- never trust frontend-only checks

### Explicitly accepted weakness

The password `MAX` is weak and easy to guess.

This is acceptable only because:

- the user requested it
- the admin area is low-stakes
- the app is for personal/friend use

## 21. Biggest Technical Risk

The biggest cost and scaling risk is still not D1.

It is the current normal Durable Object WebSocket usage.

### Recommended follow-up

After the admin/D1 feature is working, strongly consider migrating gameplay sockets to Durable Object WebSocket hibernation if staying free remains important.

This should be treated as a separate task from the admin/D1 work.

## 22. Recommended Implementation Order

### Phase 1: public data foundation

- Add D1 database and migrations
- Add DB schema
- Add public merged catalog endpoint
- Add full bank fetch endpoint for DB banks
- Update host bank selector to show static + DB banks

### Phase 2: gameplay snapshot behavior

- Update game-create flow to resolve selected bank to a frozen snapshot
- Ensure DB bank edits do not affect active games

### Phase 3: admin auth and shell

- Add admin login route
- Add backend password login endpoint
- Add signed admin session token
- Add landing page admin button
- Add admin page shell
- Show static banks read-only with `Make a copy`

### Phase 4: admin CRUD

- Create DB bank
- Edit current DB bank
- View DB bank list
- View bank details
- Implement `Make a copy` for both static and DB banks

### Phase 5: import/export

- CSV import
- CSV export
- Excel import if browser-side parsing is clean

### Phase 6: revision history

- revision list
- revision detail
- restore revision

### Phase 7: usage monitoring and quota gates

- add lightweight usage monitor
- add near-limit banner
- add override password modal
- gate lobby creation and admin writes
- add rough usage counters in admin
- add active-round 30-minute timeout guard
- add lobby 30-minute timeout guard
- add frontend warning UI before timeout
- add optional warning sound if implementation stays simple and reliable

### Phase 8: optional hardening

- hibernation review for gameplay sockets
- admin audit improvements
- nicer import mapping UI

## 23. File Touch Points

Likely files to change:

- `frontend/src/App.tsx`
- `frontend/src/components/LandingView.tsx`
- `frontend/src/components/HostSetup.tsx`
- `frontend/src/lib/questionBank.ts`
- `frontend/src/lib/types.ts`
- `frontend/src/api.ts`
- `backend-do/src/index.ts`
- `backend-do/src/game.ts`
- `wrangler.toml`

Likely new frontend files:

- `frontend/src/components/AdminLogin.tsx`
- `frontend/src/components/AdminDashboard.tsx`
- `frontend/src/components/AdminBankEditor.tsx`
- `frontend/src/components/AdminImportPanel.tsx`
- `frontend/src/components/AdminUsageBanner.tsx`
- `frontend/src/lib/adminSession.ts`

Likely new backend files:

- `backend-do/src/admin.ts`
- `backend-do/src/questionBanksDb.ts`
- `backend-do/src/usageMonitor.ts`
- `backend-do/src/auth.ts`

Likely new infra files:

- `migrations/0001_question_banks.sql`
- `migrations/0002_usage_monitor.sql`

## 24. Acceptance Criteria

- Existing static banks still appear in host bank selection.
- New DB banks also appear in host bank selection.
- Starting a game with a DB bank works.
- Editing that DB bank afterward does not change the already-running game.
- Admin page is accessible from a small landing-page button.
- Admin login with password `MAX` works through backend auth.
- Static repo banks appear in admin as read-only.
- Any bank can be copied into a new editable DB bank.
- Duplicate bank names are rejected cleanly.
- Admin can create and edit DB banks.
- CSV import works.
- CSV export works.
- Excel import works if included in the first pass.
- Version history works for DB banks.
- Near-limit state shows a warning.
- Admin page shows rough usage counters without adding noticeable lag.
- Near-limit state blocks new lobby creation unless password override is entered.
- Near-limit state blocks admin writes/imports unless password override is entered.
- Active games are not interrupted by near-limit gating.
- Games show a warning before timeout if the implementation stays simple enough.
- Games auto-end if they remain stuck on one round for 30 minutes.
- Never-started lobbies auto-end after 30 minutes of inactivity.

## 25. Recommended Remaining Questions

No blocking product questions remain.

Implementation may still make minor UX decisions as long as it stays within the constraints above, especially around:

- the exact timeout warning presentation
- whether warning sound is included or omitted
- the exact phrasing of duplicate-name validation errors

## 26. Sources Used

- Cloudflare Workers pricing:
  - https://developers.cloudflare.com/workers/platform/pricing/
- Cloudflare Workers limits:
  - https://developers.cloudflare.com/workers/platform/limits/
- Cloudflare Durable Objects pricing:
  - https://developers.cloudflare.com/durable-objects/platform/pricing/
- Cloudflare D1 pricing:
  - https://developers.cloudflare.com/d1/platform/pricing/
- Cloudflare D1 limits:
  - https://developers.cloudflare.com/d1/platform/limits/
- Cloudflare D1 billing and usage observability:
  - https://developers.cloudflare.com/d1/observability/billing/
