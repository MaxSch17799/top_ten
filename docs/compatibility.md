# Compatibility protection

This guide records the first implementation phase of the [revised cleanup roadmap](roadmap.md). That phase added tests and CI without changing application behavior, game rules, npm dependencies, deployment configuration or stored schemas. The later, explicitly selected unsupported-display routing behavior is recorded separately below.

## Frozen baseline rooms

[`tests/fixtures/rooms/`](../tests/fixtures/rooms/) contains synthetic JSON captured using the actual historical code at these Git commits:

- `a68d476f57ec2ef8ed05ec32d7d5a3011c51ec59`: eight-game checkpoint, including Skyjo's reversible Keep choice.
- `3003ddb433fc420afd54f505005a90d832f78539`: subsequent Deal choices/payment update and the intended rollback target for this cleanup.

Each file records its commit, capture tool and scenario. Credentials beginning `fixture-` are fake, and the timestamp is a fixed test clock. No production room or customer data was accessed. The capture tool uses historical creation/join/engine code, then arranges specified legal decisions by moving existing cards or setting reveal flags. It deliberately removes one legacy Deal setting to exercise the existing loader's upgrade path. These are controlled compatibility examples, not claims that every possible historical state is represented.

| Fixture | Important state |
| --- | --- |
| Top 10 | Active round, assignments, embedded bank snapshot, separate host/player capabilities |
| Just One | Paused clue collection, private draft, nonzero timer remainder |
| Sounds Fishy | Paused preparation, secret roles/answer, nonzero timer remainder |
| Wavelength | Paused dial phase, psychic's private target, nonzero timer remainder |
| UNO | Playable private drawn card awaiting play/pass |
| Deal checkpoint | Unresolved debt response, older settings shape |
| Deal current | Bank-first birthday partially paid; remaining amount 1, original per-target amount 2, second target pending |
| Flip 7 | Paused target decision, timer and automatic-deal continuation |
| Skyjo | Paused Keep & swap retaining private card and decision deadline |
| Skyjo final turns | Finisher plus two outstanding final turns |

The tests compare every viewer's complete snapshot against the frozen baseline. The only explicit normalization is Deal's existing settings upgrade. They then execute a command, save, create a fresh object and compare views, retry the exact request ID where supported, and load the newly saved state using the real rollback implementation. That implementation also executes and saves a fresh host command; current code must read its output again.

The actual `GameDurableObject` is used for all 64 existing/new game combinations, active and completed owners, cold and warm collisions, legacy precedence in an inconsistent multi-key store, omitted Top 10 creation, warm-read caching and independent lobby/retry behavior.

## Running and maintaining the tests

Normal `npm test` includes these tests. Focused commands:

```sh
npx tsx --test tests/room-compatibility.test.ts
npx tsx --test tests/browser-storage-compatibility.test.ts tests/platform-boundaries.test.ts
```

Install the root/backend and frontend dependencies as described in [development](development.md). Tests need the pinned Git objects: use a full checkout or fetch history before running them. Missing history fails explicitly; it is not silently skipped. Git exports only the baseline's backend/shared source to a temporary directory; no checkout/reset, dependency install or network access occurs. The directory is removed at process exit after checking its resolved location. No old source tree is committed alongside the application.

Tests **never regenerate fixtures**. The explicit maintainer command is:

```sh
npx tsx scripts/capture-compatibility-fixtures.ts --write
```

It replaces the capture set and uses random synthetic IDs/deals. Review every diff. Do not regenerate baselines simply to make a refactor pass: investigate mismatches first, retain older fixtures when adding a new schema, and pin a new rollback target only as part of an intentional compatibility decision.

The browser fixture/tests preserve existing session precedence and all four profile formats, including differing limits, trimming, duplicate/description policies, malformed data, truncation-before-validation and storage failures. They document present behavior, including `clearSession()` retaining per-room sessions; changing that behavior requires a separate decision. The import check parses static imports/exports and literal dynamic imports/requires; it is a source boundary guard, not a complete bundle security audit. The Wrangler drift check compares current small config structures while permitting relative entry paths and formatting differences; it does not consolidate configurations.

## CI and limits

[`.github/workflows/verify.yml`](../.github/workflows/verify.yml) performs locked installs at the two existing package boundaries, checks, both builds and the complete local Playwright suite on Node 24/Linux. It fetches history for rollback tests, pins browser/backend URLs to localhost and uploads failure artifacts. There are no deployment steps, production credentials or live-test commands. The workflow itself is only remotely verified after GitHub runs it.

The storage double clones reads/writes and serializes the adapters' `blockConcurrencyWhile` callbacks. It can fail writes and alarm operations independently. It **does not emulate Cloudflare's transaction, output-gate, eviction or alarm-retry guarantees**. Phase 2 must reproduce failure behavior in the local Cloudflare runtime before choosing a shared commit design.

The later [persistence repair](persistence.md) addresses the audit's memory/durable-state divergence findings and adds actual local SQLite runtime tests alongside this double. Browser scenarios exercise local Wrangler/Vite, but service workers remain blocked. PWA upgrades, chunk failures and visual screenshot comparisons need dedicated coverage before related refactors.

The Flip 7 presentation harness controls browser time and acknowledges routed snapshot delivery before advancing animation frames. Reading-time, queue, mode-switch, dismissal and reduced-motion assertions remain in place. Screenshot capture and sequential device updates no longer consume the time interval being tested; screenshots remain diagnostic artifacts, not visual baseline comparisons. This test repair did not change game timers or application code.

## Local verification of the compatibility foundation

- `npm run check`: both TypeScript projects, ESLint, content generation and 285 Node tests passed, including 29 new compatibility/boundary/storage tests.
- `npm run build`: frontend production build and Worker deployment dry run passed.
- All 48 distinct browser scenarios passed across the full run and focused reruns. The initial full run passed 46/48; two Flip 7 presentation checks failed because wall-clock time elapsed during screenshots/device updates. Both reproduced in isolation. After the controlled-clock/delivery repair, all four presentation scenarios passed twice consecutively (8/8 runs). This is not a claim of a clean single-pass full run after the repair.
- The full browser run used local Wrangler/Vite and disabled tracing on Windows. It included complete matches, private WebSocket views, TV/controller switching, reconnection, eight-player Skyjo navigation, reduced motion, profiles and legacy Top 10 links.
- No deployment, application-code change, npm dependency upgrade, resource rename or stored-state migration was performed. The GitHub workflow has been added but has not run remotely yet.

## Confirmed product choices — 2026-11-09

The user selected developer-led redesigns, one shared interface-language preference with independently selected game content languages, and an explanatory page for unsupported dedicated-display links. The [roadmap](roadmap.md) and [styling guide](styling.md) reflect these choices; the preference service, game presentation modules and frontend Deal palette have since been extracted without changing content-language keys. Full translations and a visual redesign remain separate work.

The small display-routing follow-up now shows that explanation for Top 10 and Just One instead of mounting player controls. It includes a regular-room link that drops the display-token fragment. It uses existing presentation styles and changes no backend, stored state, rules or display behavior for the six supported games. Browser coverage checks authenticated sessions, refresh, phone-width layout, absence of player connections and explicit navigation to a working normal room.

Follow-up verification passed: frontend/backend TypeScript, frontend ESLint, the frontend production build, and four focused browser scenarios across targeted runs (both unsupported-display cases, legacy Top 10 gameplay and Skyjo's live TV/controller flow). The new Top 10 test fixture was corrected to supply the same required question-bank ID as the existing host form. This follow-up remains local and undeployed.

## Modularization delivery (2026-11-09)

The later implementation adds atomic state/alarm commits and uncertain-action recovery, isolates Top 10, registers frontend/backend games explicitly, serializes code ownership before creation, and composes modern transport helpers. All seven modern UIs share a command sender with exact-ID retries. Profiles retain their frozen formats; Fishy/Wavelength share a synchronized interface preference without merging content choices. Deal, UNO, Wavelength and Just One have focused presentation modules; Deal's equal-valued palette is frontend-only.

Verification on the final application code:

- `npm run check`: content validation, both TypeScript projects, frontend ESLint and **335 Node tests passed**.
- The Node suite includes **40 local Cloudflare SQLite runtime scenarios**, frozen-room save/reload and actual rollback execution, per-viewer secrets, browser storage compatibility, config/import boundaries, all 64 existing-game creation collision pairs and all 64 concurrent incoming creation pairs.
- The final full Playwright run passed **56/56 scenarios in one run** against local Wrangler/Vite with tracing disabled on Windows. This includes the original 50 scenarios plus five exact-ID retry cases and cross-tab interface-language synchronization. Targeted mocked views support presentation/retry checks; multiplayer flows exercise the real local Worker. All earlier test-wait failures were corrected before this clean run.
- `npm run build`: frontend production assets and the Worker deployment dry run passed. The entry JS is 500.13 kB raw / 155.23 kB gzip and triggers Vite's chunk-size advisory. `npm run analyze:build` reports all emitted JS/CSS assets without changing chunk boundaries.

No lockfiles, Cloudflare resource identities, stored room schemas, browser keys, game rules or cache/chunk configuration were migrated. GitHub CI still needs its remote run after pushing. No push or deployment was performed. Screenshots remain diagnostic captures; service-worker upgrade and old-chunk failure coverage are still prerequisites for the deferred loading changes in the [roadmap](roadmap.md).
