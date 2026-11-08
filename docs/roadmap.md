# Refactoring roadmap

Reviewed 2026-11-08 against the working checkout. This is a staged proposal; the larger changes below were not implemented. Each stage should be independently reviewable and preserve live-room compatibility.

## Completed in this cleanup

- Shared `GameType` identifiers replace duplicated frontend API unions and Worker ID allowlists. Existing IDs, homepage order, validation order and legacy Top 10 fallback remain intact.
- Platform defaults move to `theme.css` with equal values. This establishes a small styling seam without restyling existing games.
- All four generators skip unchanged output bytes. Existing validation, filenames, formatting, public/private split and generated content remain intact.
- Root scripts provide consistent development, type-check, lint, test and build entry points. Existing commands and package boundaries remain available.
- A documentation index, architecture map, new-game guide, styling guide, development/release instructions and historical notes replace the stale template/Just One-heavy entry documentation.
- A Just One browser scenario waits for the server-confirmed result UI before reading its score. The score expectations remain unchanged; clicking alone does not wait for an asynchronous game action to finish.

## Verification of this cleanup

Checked locally on 2026-11-08:

- `npm run check`: content validation, frontend/backend TypeScript, frontend ESLint and **240 passing Node tests**.
- `npm run build`: frontend production build and Worker deployment dry run passed.
- **31 distinct browser scenarios across all eight games passed**, counting the full run and targeted reruns. The initial full run had 28 passes and three failures: an immediate Just One score read, a Deal reconnection assertion, and a complete Deal match timeout. After adding the result-UI waits, all three passed on targeted rerun; Deal application/test code was unchanged. The complete Deal rerun took about three minutes. Browser timing/reconnection flakiness remains a test-infrastructure follow-up, rather than evidence of a clean single-pass run.
- All **18 generated output files** retained their original bytes and timestamps across repeated generation/build/dev hooks.
- All **65 checked local documentation links** resolved, and `git diff --check` passed.

At completion, this cleanup was local and uncommitted. It included no deployment, dependency upgrade, schema migration, stored-state format change or game-rule change. Later feature releases have their own verification and deployment records in the game guides.

## Target: one platform, independent games

The repository should describe a game-night platform with Top 10 as one game. Keep one website, one Worker and the current lobby namespace; modularity does not require a service or database for every game.

An eventual source layout could be:

```text
frontend/src/
  app/                       routes and frontend game registration
  platform/                  lobby, invites, connection, host tools, profiles, language
  ui/                        themed controls, surfaces, timers, score displays
  games/<game>/              home, table, controller, display, cards and scoped styles
backend-do/src/
  index.ts                   thin public Worker router
  game.ts                    existing Durable Object class, delegating to registered rooms
  platform/                  auth, transport, commits, alarms, content, usage and admin
  games/<game>/              engine, room adapter and game-specific persistence handling
shared/
  platform/                  public IDs, capabilities and common protocol contracts
  games/<game>/              public settings, actions and viewer models
tests/
  platform/                  compatibility, transport and multi-game contracts
  games/<game>/              rule and adapter tests
  e2e/                       real multi-device user flows
docs/                        contributor guides, game guides and release records
```

This is a destination, not a folder-move task to perform immediately. Extract one useful boundary, verify it, then move its files in a separate commit. Backend internal models stay outside browser-importable modules.

### Registration and capabilities

Use a public, data-only descriptor for stable ID, player range and supported features. Keep separate frontend and backend maps: the frontend supplies lazy home/table/controller/display components; the backend supplies validation, room creation, loading and dispatch. Check that both maps cover every supported ID. A single registry must never pull an engine or private bank into the browser.

Capabilities should describe actual differences: dedicated displays, private cards, verbal play, local profiles, live presentation switching and timers. Common UI can show the tools each game supports without a growing list of checks such as `if game === 'skyjo'`. Each engine still decides legal actions and each game's renderer still owns its board and decisions.

The intended new-game workflow is: create the game's public contract, engine/adapter and UI folder; register its frontend/backend entries; add focused tests and a guide. Repeated edits across transport, sessions, invites, global CSS and many route branches should gradually disappear.

### What should be shared

| Platform responsibility | Remains game-specific |
| --- | --- |
| Lobby identity, invites, reconnection and read-only display authentication | Legal decisions, role secrets and per-viewer serialization |
| Serialized command/save/broadcast pipeline and retry plumbing | Decks, scoring, penalties, turn order and round endings |
| Alarm scheduling and pause mechanics | What a timeout means and which choices it may make |
| Host menu structure, notices, buttons, timers and results primitives | Game boards, card graphics, private decision controls and public events |
| Profile persistence with injected validation and limits | House-rule schema, built-in presets and existing profile compatibility |
| Semantic theme tokens and language service | Game palettes, artwork and game-specific translations |

### Branding and compatibility

Rename internal concepts and documentation toward "Game Night" as they are extracted. Root package/workspace names can follow in a build-focused change. Retain `top-ten` Cloudflare resource identities, existing production URLs, legacy routes and browser session keys until there is a separate migration reason and tested transition. Renaming the repository is not a reason to replace the Durable Object namespace or strand saved players.

Before changing persistence, capture old-room fixtures for all games, including pending private draws, responses, paused deadlines and final turns. Keep the current loader as a fallback while introducing a versioned game discriminator. Verify rollback as well as forward loading.

## 1. Split large frontend files along existing seams

**Benefit:** game additions and visual changes become easier to review; lobby/settings/host controls become reusable without mixing rules into presentation. **Scope/risk:** medium, one game at a time.

`MonopolyDealGame.tsx`, `WavelengthGame.tsx`, `JustOneGame.tsx`, `UnoGame.tsx`, `SkyjoGame.tsx`, and `AdminDashboard.tsx` contain substantial presentation and orchestration. Extract pure card/table/results views first, then game-specific hooks for authenticated action submission and display-token recovery. Keep current props, storage keys, request IDs, retry semantics, snapshots and keyboard/touch behavior.

Use Skyjo/Flip 7 as an initial comparison for host controls and TV state, not a requirement that every game's UI look the same. A shared action hook must preserve generation/round/revision or phase differences, retain the same request ID on an uncertain retry, and never infer authoritative success from an animation.

**Completion evidence:** engine tests remain unchanged; multi-phone, refresh, pending-choice, display, reduced-motion and screenshot comparisons pass for the migrated game before another game adopts the extraction.

## 2. Extract shared room transport without generalizing the engines

**Benefit:** future games stop copying hundreds of lines of socket/auth/persistence code; transport fixes reach all adopters. **Scope/risk:** high because private information, serialization and persistence are involved.

Start with the closely related Skyjo and Flip 7 adapters. Extract small utilities or a composed transport layer for response headers, authenticated token lookup, socket lifecycle, serialized commit/save/broadcast and scheduling. Keep rule transitions, recovery, deadlines, viewer projection, expiry policy and state keys supplied by the game.

Do not broadcast one cached snapshot to every player or let a shared base class serialize internal state by default. Keep clone-before-apply and persist-before-broadcast behavior, bounded replay logs and read-only display permissions. Plan how sockets behave during load/eviction and how malformed/duplicate commands are handled.

**Completion evidence:** adapter compatibility tests for old persisted fixtures, token/display permissions, per-viewer secrets, failed-save/failed-command atomicity, concurrent actions, duplicate retry, alarms, disconnections and independent lobbies. Adopt in two games first, then migrate individually.

## 3. Complete registration and isolate legacy Top 10

**Benefit:** a new game gets a predictable registration contract and fewer places to wire by hand; requests avoid sequentially probing every room type. **Scope/risk:** medium to high.

Keep the shared ID contract, but add separate frontend and backend registration maps: frontend lazy home/game components and capabilities; backend validator, room factory and dispatch. Do not put server imports into a browser-readable manifest. Define completeness checks between these maps and the shared IDs.

Move Top 10 behind a `Top10Room` adapter while keeping the existing `GameDurableObject` class, storage key `state`, public URLs, action endpoints and data shape. A later persisted game-type discriminator can speed dispatch, with fallback detection for old rooms that lack it. Preserve code-collision behavior in both directions; simply replacing the existing dispatch chain with a map is insufficient because adapters have asymmetric legacy collision checks.

**Completion evidence:** restore fixtures for all room types, collision tests across different games, legacy `/host` and `/g/:code` flows, display routing, expiry/alarms and rollback-compatible state. Benchmark request/storage overhead before claiming a performance gain.

## 4. Expand semantic themes and visual primitives

**Benefit:** consistent new-game UI and a practical route to a complete reskin. **Scope/risk:** medium, primarily visual and interaction regressions.

Extend the [styling foundation](styling.md) to surfaces, spacing, typography, focus, motion and game palettes. Extract shared buttons, fields, panels, connection notices, timers and score displays only where behavior agrees. Migrate literal styles one game at a time, first with equal values, then with intentional design changes.

Keep SVG card/board components replaceable using public props. Some colors live in code (`unoTheme.ts` and card renderers), so a full theme must address both CSS and generated artwork. Add component examples and visual regression coverage before introducing a runtime theme selector. Scope new styles to avoid changing other games through generic element selectors.

**Completion evidence:** phone/tablet/TV screenshots, focus and accessible labels, touch target sizes, gestures without accidental moves, reduced motion, and private backs verified in every adopted theme.

## 5. Consolidate profiles and language utilities with explicit compatibility

**Benefit:** future games can reuse local persistence and localization instead of copying them. **Scope/risk:** medium.

Profile wrappers are similar but not identical: UNO keeps up to 50 profiles and performs duplicate/trim handling; Deal, Flip 7 and Skyjo use 30, with different descriptions and validation behavior. Extract storage mechanics with injected per-game validation/limits while retaining exact existing keys and migration behavior. Add malformed/storage-unavailable and existing-profile fixtures before consolidation.

`fishyI18n.ts` also supplies platform language, and `waveI18n.ts` shares the `fishy-ui-language` key. Introduce an explicitly named platform language service with a compatibility read/write path before splitting dictionaries. Do not silently rename the key or assume every game's language support matches.

## 6. Standardize the build and release boundary, then optimize loading

**Benefit:** reliable onboarding, repeatable checks, smaller initial frontend work, and fewer deployment surprises. **Scope/risk:** medium; public hosting/build contexts can change.

Choose whether to add the frontend to the root workspace and retire redundant install/lock paths. First inventory Pages' frontend-root build, standalone backend scripts and any external tooling. Test a clean checkout using locked installs. Add CI that runs checks/builds and representative browser games without production credentials; keep live tests and deployments separate.

Consolidate the two Wrangler configs only after validating relative entry paths, local persistence directories, secret access, D1 bindings/migrations and Worker/Pages commands. Preserve resource identities. Version current state fixtures and make migration tests a release prerequisite before changing stored structures.

Measure the Vite output and browser network waterfall, then consider lazy loading currently eager game/admin routes and loading game CSS by route. XLSX and CSV parsing already use asynchronous imports in the admin UI; preserve that. Check loading/error boundaries, invite refreshes, offline/PWA cache behavior and old asset URLs before changing chunk boundaries. A local font strategy can reduce an external dependency, but should preserve licensing, rendering and fallback behavior.

**Completion evidence:** clean installs, all quality checks, tested Pages/Worker build commands, old-room fixtures, chunk/network measurements, PWA navigation and an explicit release/rollback plan. New storage services or dependency upgrades should have their own demonstrated need.

## Repository checkpoint verification — 2026-11-08

The follow-up checkpoint includes eight games and Skyjo's provisional Keep decision. The complete working state passed **249 Node tests**, **37 browser scenarios on the first run**, frontend/backend TypeScript, ESLint, the frontend production build and the Worker dry run. The commit series separates shared support, six new games with their integration, and contributor documentation/type cleanup. The older Top 10 / Just One commits are retained. Production publication is separate from this local checkpoint.

## Suggested sequence

Start with one frontend extraction and a shared transport prototype for two games. Add their compatibility tests, then finish registration/Top 10 isolation. Broader themes, profile/language consolidation and workspace/deployment cleanup can follow as separately reviewed changes. Avoid a simultaneous folder move, state migration, transport rewrite and visual redesign: it makes a regression hard to attribute or roll back.
