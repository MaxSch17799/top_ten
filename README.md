# Max & Alina's Game Night

Eight multiplayer games in one React/TypeScript website, hosted on Cloudflare Pages with a Worker and persistent Durable Object lobbies.

**[Documentation index](docs/README.md)** | [Architecture](docs/architecture.md) | [Add a game](docs/adding-a-game.md) | [Styling](docs/styling.md) | [Next refactors](docs/roadmap.md)

## Games

| Game | Home route | Implementation guide |
| --- | --- | --- |
| Top 10 | `/top10` | [Original platform notes](docs/reference/legacy-project-notes.md) |
| Just One | `/just-one` | [Rules, language and word-bank notes](docs/reference/legacy-project-notes.md) |
| Sounds Fishy | `/sounds-fishy` | [SOUNDS_FISHY.md](SOUNDS_FISHY.md) |
| Wavelength | `/wavelength` | [WAVELENGTH.md](WAVELENGTH.md) |
| UNO | `/uno` | [UNO.md](UNO.md) |
| Monopoly Deal | `/monopoly-deal` | [MONOPOLY_DEAL.md](MONOPOLY_DEAL.md) |
| Flip 7 | `/flip7` | [FLIP7.md](FLIP7.md) |
| Skyjo | `/skyjo` | [SKYJO.md](SKYJO.md) |

`/` selects a game; `/g/:code` opens an invitation; supported games use `/g/:code/display` for a read-only TV. Original Top 10 `/host` and invitation links remain supported. Admin routes and existing game-specific behavior are retained.

## Get started

Use Node 22.18+ or Node 24+ and npm. PowerShell users can substitute `npm.cmd` / `npx.cmd` if script execution policy blocks the usual shims.

```sh
npm ci
npm --prefix frontend ci
npm run sync:banks
npm run dev:backend
```

In a second terminal, point the frontend at the local Worker:

```powershell
$env:VITE_BACKEND_URL = 'http://127.0.0.1:8787'
npm run dev:frontend
```

POSIX equivalent: `VITE_BACKEND_URL=http://127.0.0.1:8787 npm run dev:frontend`.

The frontend has its own install and lockfile; the root workspace installs the backend. Without `VITE_BACKEND_URL`, the frontend retains its existing production Worker fallback. See [development](docs/development.md) for local D1 setup, environment boundaries and browser-test troubleshooting.

## Verify changes

```sh
npm run check
npm run build
npx playwright install chromium
npm run test:e2e
```

`check` validates content, type-checks both projects, runs frontend ESLint and runs the Node tests. `build` creates frontend assets and performs a Worker deployment dry run. `npm run check:all` runs those checks/builds followed by browser tests. These commands do not deploy. Live tests and release commands are documented separately in [deployment](docs/deployment.md).

## Where to make changes

- `shared/`: game IDs, public types/settings, and content validators. Browser-imported code must not contain server secrets.
- `backend-do/src/<game>/`: independent rules engine and room adapter. Top 10 still lives in `backend-do/src/game.ts` alongside dispatch.
- `frontend/src/components/`: game homes, tables, renderers, settings and shared UI.
- `frontend/src/lib/` and `hooks/`: sessions, API support, profiles, localization and connection logic.
- `frontend/src/theme.css`: platform style defaults; scoped game CSS preserves individual visual identities.
- `question-banks/`, `word-banks/`, `spectrum-packs/`: canonical content; `scripts/sync-*.mjs` validates/generates outputs.
- `tests/`: engine/adapter tests and multi-device browser scenarios.

Keep generated content, persisted room formats, public IDs/URLs, session keys and Cloudflare resource identities stable during refactors. The [new-game guide](docs/adding-a-game.md) lists every current integration point; the [roadmap](docs/roadmap.md) separates safe foundations from larger transport, registration, theme and build changes.

The former detailed README is retained in [historical project notes](docs/reference/legacy-project-notes.md), including Just One language rules, content authoring instructions and earlier verification records.
