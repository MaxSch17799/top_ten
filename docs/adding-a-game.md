# Adding a game

Use an existing game with similar interaction and privacy requirements as a reference. Skyjo and Flip 7 are good references for independent phone play, a dedicated TV, live display-mode switching, local profiles, and optional timers. UNO and Monopoly Deal are references for private hands and multi-step responses. Sounds Fishy and Wavelength demonstrate different verbal/remote and role-specific flows.

## 1. Define the game contract

Write down rules and edge cases first. Record original sources and any explicit house/tie policies in a game guide. Define player limits, setup, legal decisions, round/match ending, timer behavior, disconnection recovery, and what each viewer may see.

Add `shared/<game>.ts` with public action/view/settings types, defaults, built-in profiles, and settings validation. Keep private internal state types in the engine. Prefer explicit fields over passing an internal state object through to React.

## 2. Implement the engine before the UI

Create `backend-do/src/<game>/engine.ts` using the existing patterns:

- Create/restore internal state, apply a validated action, expire deadlines, calculate the next alarm, and serialize for one viewer.
- Validate player role, phase, targets, generation, round and the chosen replay/revision scheme. Request retries must be idempotent.
- Define automatic timeout choices explicitly; default to no timer when strategic decisions should remain manual.
- Make clocks and randomness controllable in tests. Production secret shuffles must remain unpredictable.
- Keep state bounded: cap event/history/replay logs without losing cumulative results.
- Test the actual rule edge cases, private projections, malformed/duplicate commands, and persistence restoration.

Pure public calculations can be shared. Private card values and hidden answers cannot be moved into a browser-imported module for convenience.

## 3. Add the room adapter and Worker integration

Create `backend-do/src/<game>/room.ts`. Reuse the closest existing adapter's contract, not its game-specific behavior. Preserve serialized mutation/persistence and per-viewer broadcasts.

The current integration points are intentionally explicit:

| File | Change |
| --- | --- |
| `shared/games.ts` | Add a stable `GameType` ID. New standalone games automatically bypass Top 10's creation-time question-bank lookup. |
| `backend-do/src/index.ts` | Add settings preflight using the new validator. Add a public content-summary endpoint only if the game needs one. |
| `backend-do/src/game.ts` | Instantiate the adapter and route internal creation, normal requests, and alarms. |
| New adapter's create path | Reject a code already occupied by any existing game, including Top 10's `state` key. |
| Existing dispatch/collision handling | Verify creating either game over the other game's occupied code still returns a collision. Preserve dispatch precedence while adapters still have different collision checks. |

Game IDs alone do not register a room or route. A future complete registration contract is described in the [roadmap](roadmap.md).

Normal additions use the existing `GAME_DO` binding. They do not require a new Durable Object class, namespace, D1 table, account system, or paid service. If a game truly needs a schema/resource change, plan it separately and test old saved rooms first.

## 4. Build the home, game UI, and visual components

Create home/game/settings components and a scoped game stylesheet. Card or board renderers should take public display data and emit user intents; they should not perform authoritative scoring or access backend modules.

| Existing piece | Reuse for |
| --- | --- |
| `api.ts` | Create/join requests, shared fetch/error handling, backend URL |
| `lib/session.ts` | Save/load per-room sessions and maintain legacy compatibility |
| `useGameConnection` | Reconnect, heartbeats, polling fallback, versioned snapshots |
| `AddPlayerPanel` | Share links and QR invites |
| `PasswordPromptDialog` and home patterns | Existing usage-limit override flow |
| Game-specific `*Profiles.ts` patterns | Browser-local custom profiles with validated rules |
| `theme.css` and scoped game CSS | Platform defaults and per-game styling |

Add the home route in `App.tsx`, dispatch in `GameRoute.tsx`, and a listing in `lib/games.ts`. The catalog test checks that every shared ID has exactly one homepage listing and distinct URL. Keep `/host` and `/g/:code` legacy paths working.

Extend `CreateGamePayload.settings` in `frontend/src/api.ts` to include the new public settings type. Its `gameType` fields already use shared `GameType`, but settings are still an explicit union until a later typed registration refactor.

Use an explicit lazy import when appropriate, with a useful loading fallback. Do not import the new engine, secret pack, or room adapter into the frontend to reuse a type; put the public type in `shared/` instead.

## 5. Define the display/controller contract

If the game has a dedicated shared display, use a separate read-only display capability and no player seat. Show only public data. A game with private draws/hands needs projection tests for the owner, other players, the host, and the display.

For games with live Normal/TV switching, presentation changes must preserve pending decisions, deck order, board positions, scores and deadlines. They should not invalidate another player's in-flight legal action. Rules and presentation settings are different concerns: lock gameplay rules after start; allow display changes according to that game's contract.

On phones, prioritize the current decision and comfortable targets. Use public event feedback when changes happen outside the currently viewed board. Respect manual browsing, keyboard navigation and reduced motion. Avoid creating moves from swipe/animation completion callbacks.

## 6. Verify and document the integration

Run `npm run check`, `npm run build`, and relevant browser scenarios. Add engine/adapter tests for the new game and integration tests for create/join/play, authentication, privacy, display permissions, refresh/reconnection, duplicate/stale actions, simultaneous lobbies, and game completion. Include minimum/maximum players and small-phone/TV layouts when relevant.

Add a game guide and link it from `docs/README.md` and the root game table. Record sources, house policies, modes, profile storage, timer behavior, tests and limitations. Keep canonical content instructions beside its schema/source folder.

Use the [deployment guide](deployment.md) for a release. Development checks and Worker builds do not publish anything.
