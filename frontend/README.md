# Game Night frontend

React, TypeScript and Vite client for the multiplayer platform. Start with the [project README](../README.md) or [documentation index](../docs/README.md).

## Commands from this directory

```sh
npm ci
npm run dev
npm run typecheck
npm run lint
npm run build
```

Install the root workspace as well before using commands with content-generation hooks. Set `VITE_BACKEND_URL=http://127.0.0.1:8787` in the frontend process for local play; otherwise the existing production Worker fallback is used. See [development](../docs/development.md) for PowerShell/POSIX examples and the two-process workflow.

## Structure

| Location | Purpose |
| --- | --- |
| `src/App.tsx` | Home, invite, display, admin and legacy routes |
| `src/components/GameRoute.tsx` | Resolve a room's game and render it |
| `src/lib/games.ts` | Homepage listings, using the shared `GameType` contract |
| `src/components/` | Shared UI and game-specific home/game/settings/card components |
| `src/hooks/useGameConnection.ts` | Realtime states, reconnect, polling fallback and identity isolation |
| `src/lib/session.ts` | Browser sessions scoped to each lobby |
| `src/lib/*Profiles.ts` | Local custom rule profiles |
| `src/theme.css` | Platform colors, font options, radii and width defaults |
| `src/styles.css`, `party.css`, per-game CSS | Current shared and scoped styling |
| `public/` | PWA assets and explicitly public generated banks |

Game rules and private state belong in `backend-do/`; public contracts live in `shared/`. Reuse SVG/card renderers through public props. Follow [adding a game](../docs/adding-a-game.md) for API/route integration and [styling](../docs/styling.md) for changing appearance without changing rules.

Build output is `dist/` for the existing Pages project. `predev` and `prebuild` validate canonical content; edit its source folders rather than generated public copies. Frontend bundling must not import secret generated backend banks or room/engine modules.
