# Refactoring roadmap

Revised after the independent architecture audit against `3003ddb` (the Deal choices/payment update). The earlier multi-game checkpoint is `a68d476`, tagged `checkpoint/multigame-2026-11-08`. Treat these as different compatibility baselines: current Deal decisions must survive rollback to `3003ddb`; an older engine need not understand a feature added after it.

The direction remains one game-night platform with independent games, one website, one Worker and the existing lobby namespace. The correction is **compatibility protection before extraction**, with small composed utilities instead of a universal game framework. Each phase is a separately reviewable change.

## Already established

Shared game identifiers, equal-value theme tokens, generators that skip unchanged bytes, root quality commands and contributor guides are in place. The eight-game checkpoint passed 249 Node tests and 37 browser scenarios; the subsequent audit reported 256 passing Node tests and 48 discovered browser scenarios. These are historical results, not verification of every later checkout. Deployment is separate from repository cleanup.

## 1. Compatibility fixtures and CI — first delivery

The foundation is implemented in this cleanup; see [coverage and maintenance](compatibility.md). The runtime extractions below remain planned.

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

The audit reproduced these failures with injected storage errors; they are not reported production incidents:

- Just One assigns candidate state to memory before saving. A failed write can leave memory ahead of durable state.
- Skyjo (and a similar Flip 7 path) writes before scheduling its alarm and updates memory afterward. A failed alarm operation can leave durable state ahead of memory.
- Top 10 prompt choice broadcasts while a background save can fail silently.

First reproduce write/alarm failures in the local Cloudflare runtime. Define when a command is committed, how memory and alarms recover, and how clients distinguish rejection from uncertain outcomes. Preserve the same request ID and replay metadata on uncertain retries; infrastructure failures must not masquerade as illegal moves. Verify recovery across eviction and the next alarm before sharing this mechanism.

Keep this separate from Top 10 extraction. Do not freeze known inconsistencies as desired contracts or introduce a state-schema migration to solve transport problems.

## 3. Isolate Top 10, then register games narrowly

Move Top 10 mechanically into a room adapter in its own change. Preserve the exported Durable Object class, storage key `state`, public/legacy URLs, tokens, WebSockets, question-bank enrichment, alarms and viewer projections.

Registration follows separately:

- Frontend map: ID → home path/component and room component. Small wrappers accommodate Top 10/Just One props.
- Backend map: settings preflight, room factory and storage-key ownership. Top 10 database enrichment stays server-side.
- Resolve ownership **before creation**, preserving newest-first precedence: Skyjo, Flip 7, Deal, UNO, Wavelength, Fishy, Just One, then Top 10. `GAME_TYPES` order differs. Direct adapter collision checks are asymmetric.
- Every occupied key, including completed rooms, reserves its code. Room recycling needs a separate decision.
- Start with one consumed capability: dedicated-display support. Capabilities do not authorize actions; defer speculative private-card, verbal-play, profile and timer flags.
- Check map completeness and actual routing/creation/dispatch. Eventually correlate settings types with game IDs.

Cache the resolved adapter in memory if measurement justifies it. Existing `exists()` calls already cache reads after cold load. **Defer a persisted discriminator** until measured cold-load costs justify its migration and rollback burden.

## 4. Compose shared transport mechanics

Start with Skyjo and Flip 7 after phase 2. Share response construction, socket membership, serialized execution and the verified commit mechanism. Game-owned callbacks load/upgrade state, apply commands, project viewers, expire state and choose alarms.

No universal room base class. Replay ordering/limits, revision semantics, pause representations and timeout decisions remain game-owned. Preserve concurrent Skyjo setup, presentation revisions, Flip 7's `nextAt`, and Just One's generation-before-dedup versus Skyjo's dedup-before-staleness behavior. Never reuse one player's projection for another identity.

Migrate other adapters individually after permission, concurrency, replay, failure, alarm, reconnection and multi-lobby tests pass.

## 5. UI, profiles, language and presentation

These can follow phase 1 independently of backend extraction, in separate changes.

### Smaller game components

Start with Deal's large composer/response/table/hand sections, then Wavelength, UNO and Just One. Skyjo/Flip 7 already have named subcomponents; file length alone does not justify extraction. Extract pure presentation before orchestration.

All eight games already use `useGameConnection`; extend it instead of adding another connection manager. A small sender helper accepts a fully formed game action and retains its exact ID/replay metadata for uncertain retries. Awaiting `requestState()` is not authoritative readback: it swallows errors and returns no snapshot. Preserve explicit readback where needed. Do not impose Top 10's pending-join workflow on every lobby.

### Presentation seams

Extend semantic tokens with equal values first. Keep palettes/artwork separately replaceable using imported components and public props. Deal's semantic groups/rent rules stay shared; visual palettes move frontend when extracted. Hidden values must never affect backs, accessible labels, colors or animations.

The confirmed goal is developer-led redesigns: replaceable CSS and renderer imports, without a player-facing theme selector. Runtime theme/renderer registries are outside this plan. Add actual screenshot comparisons before claiming visual equivalence.

### Profiles and language

Share small persistence utilities with injected validation. Retain UNO's 50-profile limit versus 30 elsewhere, slicing before validation, per-game trim/deduplication/description policies, malformed data behavior and write failures. No account system or key migration is needed.

The confirmed language model is one shared interface-language preference, with each game's content language selected independently. Extract a named preference service retaining `fishy-ui-language`, also used by Wavelength. Keep Just One's content key `just-one-language`, Fishy banks, Wavelength packs and dictionaries separate. Shared preference does not mean complete translations.

The confirmed unsupported-display behavior is an explanatory page for Top 10 and Just One, with an explicit link to the regular room. This small routing follow-up is implemented independently of registration: opening `/display` no longer mounts player controls or starts a player connection. Display-token fragments are not carried to the normal room. The shared-language extraction and broader styling work remain future phases; no product questions block them.

## 6. Measure build, loading and deployment boundaries

CI comes now; workspace, lockfile and Wrangler consolidation come later. Inventory Pages' frontend-root build, standalone backend installs, relative paths, D1 bindings/migrations, persistence directories and tooling first. Retain production resource identities, namespace IDs, URLs and browser keys even if internal branding becomes Game Night.

Measure bundle/network output and cold room reads before optimizing. Admin XLSX/CSV parsers already import asynchronously. Before changing chunks, add genuine service-worker upgrade, old-asset/chunk failure and invite-refresh tests. Local fonts need separate licensing/rendering checks.

An eventual layout may group `app`, `platform`, `ui` and `games/<id>` in each package. Extract useful boundaries first; move files later in mechanical commits. Bulk directory moves are deferred.

## First reviewable changes

1. Fixtures, compatibility tests, CI and corrected documentation. No application behavior, dependency, state-schema or directory changes.
2. Local-runtime failure reproduction and command commit/recovery repair. No framework, rules or visual changes.
3. Mechanical Top 10 extraction with compatibility and rollback evidence.

Registration, shared transport and UI improvements follow using the evidence from these changes. Each step should be deployable and reversible independently.
