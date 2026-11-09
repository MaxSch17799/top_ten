# Refactoring roadmap

Revised after the independent architecture audit against `3003ddb` (the Deal choices/payment update). The earlier multi-game checkpoint is `a68d476`, tagged `checkpoint/multigame-2026-11-08`. Treat these as different compatibility baselines: current Deal decisions must survive rollback to `3003ddb`; an older engine need not understand a feature added after it.

The direction remains one game-night platform with independent games, one website, one Worker and the existing lobby namespace. The correction is **compatibility protection before extraction**, with small composed utilities instead of a universal game framework. Each phase is a separately reviewable change.

## Already established

Shared game identifiers, equal-value theme tokens, generators that skip unchanged bytes, root quality commands and contributor guides are in place. The eight-game checkpoint passed 249 Node tests and 37 browser scenarios; the subsequent audit reported 256 passing Node tests and 48 discovered browser scenarios. These are historical results, not verification of every later checkout. Deployment is separate from repository cleanup.

## 1. Compatibility fixtures and CI — first delivery

The compatibility foundation and runtime extractions below are implemented; see [coverage and maintenance](compatibility.md).

Freeze synthetic persisted rooms with source commits, scenario descriptions and fake credentials. Cover all eight games, checkpoint and current Deal state, private pending decisions, paused deadlines, Skyjo final turns and processed request IDs. Keep fixtures frozen: generating every test room with today's engine cannot establish historical compatibility.

Exercise the actual `GameDurableObject`, not just direct adapter factories:

- Cold and warm routing; omitted `gameType` still means Top 10.
- All 64 existing-game/new-game creation pairs, including ownership by completed rooms. Creating a different game must not add a second room key.
- Load → authenticated command → serialized save → fresh object → readback. Retry identical request IDs after reload where supported.
- Load newly saved state with the intended rollback code, including current Deal staged payments. Verify private projections separately for each viewer.
- Freeze browser session/profile formats before extracting utilities. Preserve keys, limits, validation order, trimming, duplicates and storage-error behavior.
- Check frontend/shared import boundaries and drift between the two Wrangler configs.

Add CI with the **existing** root/backend workspace and separate frontend install. Run checks, builds and local browser scenarios without production credentials; retain failure artifacts. No lockfile consolidation, deployment-path changes, folder moves or dependency upgrades in this phase.

Node storage doubles establish serialization, routing and replay behavior, not Cloudflare transaction/output-gate guarantees. Current Playwright tests block service workers and mostly save screenshots without baseline comparisons. They do not establish PWA upgrade safety or visual equivalence.

## 2. Define and repair command failure recovery

The audit reproduced these failures with injected storage errors; they were not reported production incidents:

- Just One assigns candidate state to memory before saving. A failed write can leave memory ahead of durable state.
- Skyjo (and a similar Flip 7 path) writes before scheduling its alarm and updates memory afterward. A failed alarm operation can leave durable state ahead of memory.
- Top 10 prompt choice broadcasts while a background save can fail silently.

Implemented: room state and its next alarm now commit in one storage transaction. Unconfirmed writes invalidate cached state and reconnect sockets, and HTTP clients receive a retryable 503 rather than an illegal-move error. The existing card-game retry controls retain their original action IDs for these errors. Top 10 prompt choice now awaits persistence before broadcasting; its HTTP commands are not automatically replayed because their legacy protocol has no request IDs.

The local Cloudflare SQLite runtime suite covers write/set-alarm/delete-alarm failures in all eight games, uncertain acknowledgements, physical eviction, an alarm firing without clients and Top 10 WebSocket prompt persistence. It uses the installed Wrangler runtime without production bindings. See [persistence and recovery](persistence.md).

Keep this separate from Top 10 extraction. Do not freeze known inconsistencies as desired contracts or introduce a state-schema migration to solve transport problems.

## 3. Isolate Top 10, then register games narrowly

Implemented as a mechanical extraction into `backend-do/src/top10/room.ts`, with Worker binding types in `env.ts`. The exported Durable Object class, storage key `state`, public/legacy URLs, tokens, WebSockets, question-bank enrichment, alarms and viewer projections are preserved. Backend TypeScript and all 50 frozen-room/runtime recovery scenarios passed after extraction.

Registration is implemented in a separate change:

- Frontend map: ID → home path/component and room component. Small wrappers accommodate Top 10/Just One props.
- Backend map: settings preflight, room factory and storage-key ownership. Top 10 database enrichment stays server-side.
- Resolve ownership **before creation**, preserving newest-first precedence: Skyjo, Flip 7, Deal, UNO, Wavelength, Fishy, Just One, then Top 10. `GAME_TYPES` order differs. Direct adapter collision checks are asymmetric.
- Every occupied key, including completed rooms, reserves its code. Room recycling needs a separate decision.
- Start with one consumed capability: dedicated-display support. Capabilities do not authorize actions; defer speculative private-card, verbal-play, profile and timer flags.
- Check map completeness and actual routing/creation/dispatch. Eventually correlate settings types with game IDs.

The dispatcher caches the resolved adapter in memory; warm requests do not scan storage keys again. Concurrent creation is serialized and tested across all 64 game pairs. Creation settings are correlated with game IDs in the frontend payload type. **Defer a persisted discriminator** until measured cold-load costs justify its migration and rollback burden.

## 4. Compose shared transport mechanics

Implemented: all seven modern adapters compose shared JSON responses, per-identity broadcasts and guarded socket presence writes. Skyjo, Flip 7, UNO and Deal also share bounded socket membership. Serialized dispatcher execution and atomic commits are separate utilities. Top 10 retains its legacy socket/HTTP protocol. Game-owned callbacks load/upgrade state, apply commands, project viewers, expire state and choose alarms.

No universal room base class. Replay ordering/limits, revision semantics, pause representations and timeout decisions remain game-owned. Preserve concurrent Skyjo setup, presentation revisions, Flip 7's `nextAt`, and Just One's generation-before-dedup versus Skyjo's dedup-before-staleness behavior. Never reuse one player's projection for another identity.

Frozen compatibility tests and the local SQLite runtime suite passed after extraction, including presence-write failures and reconnects for all seven modern adapters. Game-specific presence callbacks and the older verbal games' socket membership remain local; they do not need identical behavior to share the verified transport pieces.

## 5. UI, profiles, language and presentation

Implemented in separate browser-utility and presentation-extraction commits.

### Smaller game components

Implemented: Deal's composer, response panel, table, hand, animation/deadline and rules sections are focused modules in `frontend/src/games/monopoly-deal/`. Wavelength, UNO and Just One also have focused forms/table/status/admin modules. Existing entry components retain session/connection/action orchestration. Function-body comparison against the preceding commit found 29 identical bodies and two palette-only changes; no gameplay logic was moved into rendering. Skyjo/Flip 7 retain their already named subcomponents.

All eight games retain `useGameConnection`. Implemented: `useRoomCommand` composes a tested command sender for all seven modern games, accepting a fully formed action and retaining its exact ID/replay metadata for uncertain retries. It guards duplicate submissions and does not offer to replay an acknowledged write when only readback failed. Top 10 keeps its non-replayable legacy protocol; Wavelength keeps its separately ordered/coalesced dial movement. Awaiting `requestState()` is not authoritative readback: it swallows errors and returns no snapshot. Preserve explicit readback where needed. Do not impose Top 10's pending-join workflow on every lobby.

### Presentation seams

Extend semantic tokens with equal values first. Keep palettes/artwork separately replaceable using imported components and public props. Deal's semantic groups/rent rules stay shared; its equal-valued visual palette is now frontend-only in `lib/dealTheme.ts`. Hidden values must never affect backs, accessible labels, colors or animations.

The confirmed goal is developer-led redesigns: replaceable CSS and renderer imports, without a player-facing theme selector. Runtime theme/renderer registries are outside this plan. Add actual screenshot comparisons before claiming visual equivalence.

### Profiles and language

Implemented: `profileStorage.ts` shares browser-local read/write mechanics with injected game-owned validation. Retain UNO's 50-profile limit versus 30 elsewhere, slicing before validation, per-game trim/deduplication/description policies, malformed data behavior and write failures. No account system or key migration is needed.

The confirmed language model is one shared interface-language preference, with each game's content language selected independently. Implemented: a named preference service retains `fishy-ui-language`, also used by Wavelength, and synchronizes mounted views and other tabs. Keep Just One's content key `just-one-language`, Fishy banks, Wavelength packs and dictionaries separate. Shared preference does not mean complete translations.

The confirmed unsupported-display behavior is an explanatory page for Top 10 and Just One, with an explicit link to the regular room. This small routing follow-up is implemented independently of registration: opening `/display` no longer mounts player controls or starts a player connection. Display-token fragments are not carried to the normal room. The language preference extraction is implemented; translation dictionaries and independent content choices remain game-owned.

## 6. Measured build and deployment boundaries

Implemented: `npm run analyze:build` reports the existing Vite assets without rebuilding or changing chunk configuration. On the 2026-11-09 checkout, the entry JS is 500.13 kB raw / 155.23 kB gzip, CSS is 121.83 / 26.38 kB, and the separately loaded Deal/Skyjo/Flip 7 room chunks are 39.83 / 31.60 / 29.09 kB raw. Admin XLSX/CSV parsers remain asynchronous. These are artifact sizes, not measured browser network transfer. Vite reports its 500 kB chunk advisory for the entry; the warning is retained rather than hidden by raising its limit.

Cold ownership resolution reads one through eight room keys depending on historical precedence. Warm routing adds no repeated ownership reads, as verified against the actual dispatcher. A persisted game discriminator would require a storage migration and rollback policy for little demonstrated benefit at this scale; defer it.

The current root/backend workspace and separate frontend installation are intentional retained deployment boundaries. Pages builds from `frontend/`; both Wrangler entry points describe the same existing Worker with directory-relative paths. The config drift test protects their bindings, D1 database, namespace and migration identities. No resource or URL was renamed to rebrand the platform.

## Deliberately deferred migrations

The safe modularization deliveries above are implemented and locally verified: 335 Node tests, 56 browser scenarios, TypeScript, lint and both builds passed. See [verification details](compatibility.md#modularization-delivery-2026-11-09). These larger changes need their own concrete benefit and migration evidence:

- **Further route/chunk splitting and PWA loading changes:** the entry bundle merits later work, but add real service-worker upgrade, old-asset/chunk failure and invite-refresh coverage first. Current browser tests block service workers. No chunk boundaries or cache versions changed here.
- **Workspace/lockfile or Wrangler consolidation:** test both Pages' frontend-root install/build and standalone backend workflows before replacing either. Existing lockfiles/configs remain valid; consolidating them is not necessary to add another game.
- **A complete visual redesign or component library:** choose a reference design, establish screenshot comparisons, then change semantic tokens and one game at a time. Imported renderers and frontend palettes provide the seams now. Keep local font licensing/rendering work separate.
- **Full translations:** the interface preference is shared, while English-only screens and game-specific dictionaries remain. Content selection stays independent.
- **Bulk directory moves or a universal room framework:** useful code boundaries are extracted now. Moving every file, renaming stored IDs, or forcing different replay/timer rules into a common superclass would add compatibility risk without a demonstrated requirement.

Each delivered stage is separately committed and can be reviewed or reverted independently. See [the integration guide](adding-a-game.md) for the current new-game checklist, rather than adding fresh routing branches or copying an entire room implementation.
