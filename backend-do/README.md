# Game Night Worker

Cloudflare Worker routing, persistent multiplayer rooms, game engines, question-bank administration and usage monitoring. Start with the [architecture map](../docs/architecture.md).

## Commands

The root workspace installs this package. From the repository root:

```sh
npm ci
npm run sync:banks
npm run dev:backend
npm run typecheck --workspace backend-do
npm run build --workspace backend-do
```

The build is a Wrangler deployment **dry run**, not a production release. `npm run deploy:worker` at the root is the existing publishing workflow; use it only for an intended release. See [development](../docs/development.md) and [deployment](../docs/deployment.md).

## Boundaries

- `src/index.ts`: HTTP routing, creation preflight, bank catalogs, admin endpoints.
- `src/game.ts`: `GameDurableObject` dispatch and original Top 10 behavior.
- `src/<game>/engine.ts`: state transitions, validation, scoring, deadlines and per-viewer serialization.
- `src/<game>/room.ts`: tokens, sockets, serialized persistence, alarms and usage events.
- `src/generated/`: generated server content; edit canonical banks/packs at the root.
- `src/questionBanksDb.ts`, `migrations/`: Top 10 D1 content administration and revisions.
- `src/auth.ts`, `src/usageMonitor.ts`: admin/override authentication and usage guard.

All games use the existing `GAME_DO` binding. The adapter is responsible for sending each player only their permitted view. Keep server-only state and content out of modules imported by the frontend. Do not rename stored keys, class/binding identities or migration tags during file organization. Adding an ordinary game does not require a new Durable Object class or database.

See [adding a game](../docs/adding-a-game.md) for registration steps and the [roadmap](../docs/roadmap.md) for extracting common transport and isolating Top 10 incrementally.
