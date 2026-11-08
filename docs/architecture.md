# Architecture

This is one React/TypeScript/Vite frontend on Cloudflare Pages and one Cloudflare Worker. Every lobby uses an instance of the existing `GameDurableObject` class, addressed by its four-digit room code. There is no separate backend service or database per game.

```mermaid
flowchart LR
  Phone[Phone / browser / TV] --> Frontend[React routes and game UI]
  Frontend -->|HTTP and WebSockets| Worker[Worker router]
  Worker --> Lobby[GameDurableObject for room code]
  Lobby --> Adapter[Game room adapter]
  Adapter --> Engine[Game rules engine]
  Adapter --> State[Durable Object storage and alarms]
  Worker --> Banks[Top 10 question-bank D1 database]
  Worker --> Usage[UsageMonitorDurableObject]
```

## Repository map

| Location | Responsibility |
| --- | --- |
| `shared/games.ts` | Stable game identifiers and type guards used by frontend and Worker |
| `shared/<game>.ts` | Public view/action models, rule settings, and reusable public calculations |
| `shared/*.mjs` and matching `.d.mts` files | Plain-Node content validation shared with build scripts |
| `backend-do/src/index.ts` | Public routing, creation/settings preflight, content catalogs, admin endpoints |
| `backend-do/src/game.ts` | Durable Object dispatch and the original Top 10 implementation |
| `backend-do/src/<game>/engine.ts` | Rules, state transitions, scoring, action validation, role-specific views |
| `backend-do/src/<game>/room.ts` | Authentication, transport, serialized persistence, broadcasts, alarms, usage tracking |
| `backend-do/src/auth.ts` | Admin and usage-override authentication |
| `backend-do/src/questionBanksDb.ts`, `migrations/` | Top 10 bank administration and revision history in D1 |
| `backend-do/src/usageMonitor.ts` | Usage counters, estimates, warning thresholds, creation guard |
| `frontend/src/App.tsx` | Homepage, game home routes, invite/display routes, legacy and admin routes |
| `frontend/src/components/GameRoute.tsx` | Fetch `/info` and open the matching game UI |
| `frontend/src/lib/games.ts` | Homepage copy/order, checked against the shared `GameType` |
| `frontend/src/hooks/` | Shared connection and draft synchronization hooks |
| `frontend/src/lib/session.ts` | Per-room browser sessions with legacy-key compatibility |
| `frontend/src/lib/*Profiles.ts` | Per-game browser-local custom rules profiles |
| `frontend/src/theme.css`, `styles.css`, `party.css` | Platform tokens, legacy shared styles, and platform UI |
| `frontend/src/*game*.css`, game components | Game-specific presentation and controls |
| `scripts/` | Canonical content validation/generation and explicit live verification |
| `tests/*.test.ts`, `tests/e2e/` | Node engine/adapter tests and multi-device browser tests |
| `docs/` | Current contributor documentation and staged refactoring proposals |

Backend folders use `justOne`, `soundsFishy`, and `monopolyDeal`; public IDs use `just-one`, `sounds-fishy`, and `monopoly-deal`. Keep that distinction when wiring a new game.

## A lobby's lifecycle

1. A home component submits `createGame` to the Worker. Omitted `gameType` continues to mean Top 10 for old clients.
2. The Worker validates game/settings and the usage guard, generates a code, and asks the Durable Object for that code to create a room. Collisions are retried.
3. `GameDurableObject` routes to the correct room adapter. Existing room detection also protects the shared code namespace when a different game tries to create the same code. Top 10 currently falls back to its implementation inside `game.ts`.
4. The adapter authenticates a player token or dedicated display capability. It restores persisted state and supplies a viewer-specific snapshot.
5. `useGameConnection` receives WebSocket states, retries with backoff, falls back to polling, and refreshes on visibility/network changes. It isolates snapshots by room/token and ignores older versions.
6. Commands pass through the adapter to the engine. Newer adapters clone state, validate a command, persist successful transitions, and broadcast separately serialized views. Rejected commands leave committed state intact.
7. Durable Object alarms advance timers/automatic rounds and handle expiry. A connected TV or host browser is not the timer authority.

## Boundaries to preserve

- An engine owns rules and calculations. React owns presentation; the adapter owns I/O. Keep deck values, role secrets, and authoritative scores out of client decisions.
- A public `View` is an allowlist projection of internal state. The host does not automatically get another player's secrets. Display credentials are read-only capabilities, not player seats.
- Existing games use different replay checks: generation/round/phase and/or revision, plus request IDs. Connection-only snapshot versions are not always gameplay revisions. These differences are deliberate compatibility constraints when extracting common code.
- Different viewers can receive different snapshots at the same version. Never reuse a serialized player snapshot for a different identity.
- Room storage keys, tokens, session keys, URLs, action fields, timer remainders, and migration tags are compatibility surfaces. A file reorganization must not rename them implicitly.
- `shared/` is imported by the browser. Secret decks, answers, seeds, banks, and server-only imports belong in the backend.
- Rendering and animation do not commit moves or advance scores. Reduced-motion mode must leave the same legal controls available.

## Current extension points and remaining duplication

The codebase has eight games and a useful engine/adapter/UI separation for seven of them. Game IDs are now shared, while settings validators, home routes, game renderers, and room dispatch remain explicit. This does **not** claim that adding one registry entry fully installs a game; follow the [integration guide](adding-a-game.md).

The closest repeated room adapters are UNO, Monopoly Deal, Flip 7, and Skyjo. Repeated concerns include token lookup, socket membership, persistence, alarms, errors, and usage tracking. Their rules, recovery behavior, settings, and view projection differ. Extract transport incrementally with compatibility tests rather than replacing every adapter with a generic engine.

Top 10's game implementation still shares a file with dispatch. The root and backend each have a Wrangler config describing the same Worker with paths relative to different directories. The frontend is not an npm workspace; it keeps its own install/lockfile. These boundaries remain unchanged in this cleanup.

## Content and browser caching

Canonical banks/packs are validated by four `sync:*` scripts. Outputs go to `backend-do/src/generated/` and, where intended, public bank folders. Sounds Fishy answers remain server-only. Just One translations stay server-side even though its word-bank assets are public by design. Top 10 also has D1-backed admin content; generated static banks are its fallback/source set.

`scripts/lib/write-if-changed.mjs` compares encoded bytes before writing output, preserving unchanged mtimes. Repeated development/build hooks still validate content, but no longer rewrite identical banks and cause unnecessary watcher invalidations. Output formatting and distribution paths stay the same.

`frontend/public/service-worker.js` supplies the PWA shell. Navigation/JSON are network-first; gameplay APIs and development source modules bypass caching. Do not introduce shared caching of authenticated game states. The usage monitor's estimates describe this application's recorded activity, not a replacement for Cloudflare billing data.
