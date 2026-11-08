# Development and verification

Use Node 22.18+ or Node 24+ and npm, as required by the existing tooling. PowerShell installations that block npm's script shim can use `npm.cmd` and `npx.cmd` instead of `npm` and `npx` in the commands below.

## Install

Run from the repository root:

```sh
npm ci
npm --prefix frontend ci
npm run sync:banks
```

The root npm workspace installs the backend. The frontend remains a separate npm project with a separate lockfile; one root install does not install frontend dependencies. The backend also retains its existing standalone lockfile for compatibility with workflows that install from that folder. Do not delete or consolidate lockfiles as incidental cleanup.

## Run two local processes

Backend terminal:

```sh
npm run dev:backend
```

Frontend terminal, PowerShell:

```powershell
$env:VITE_BACKEND_URL = 'http://127.0.0.1:8787'
npm run dev:frontend
```

Frontend terminal, POSIX shell:

```sh
VITE_BACKEND_URL=http://127.0.0.1:8787 npm run dev:frontend
```

Use the local backend URL during local play. If `VITE_BACKEND_URL` is omitted, `frontend/src/api.ts` retains the existing production Worker fallback. Changing frontend environment values requires restarting Vite or rebuilding its assets.

The backend's `predev` and frontend's `predev` validate/generate content automatically. Repeated generation does not rewrite byte-identical outputs. Use one generator process per output set when editing content; builds are not intended to race an in-progress source edit.

For local D1 admin features, run from `backend-do/` when needed:

```sh
npx wrangler d1 migrations apply QUESTION_BANKS_DB --local
```

The production admin configuration uses `ADMIN_PASSWORD` and `ADMIN_SESSION_SECRET`. Keep actual values in local process/Worker secret configuration, outside source and public `VITE_*` variables. No account or secret changes are required by this cleanup.

## Quality commands

| Command from root | What it does |
| --- | --- |
| `npm run sync:banks` | Validate all four canonical content sources and generate outputs |
| `npm run typecheck` | Type-check frontend and backend without deploying |
| `npm run lint` | Run frontend ESLint; backend checking is in `typecheck` |
| `npm test` | Run Node engine, adapter, language, schema, catalog and generator tests |
| `npm run check` | Sync content, check both TypeScript projects, lint, and run Node tests |
| `npm run build` | Build the frontend and perform a Worker deployment **dry run** |
| `npm run test:e2e` | Run multi-device Playwright browser tests against local servers |
| `npm run check:all` | Run `check`, both builds, then browser tests |

Existing per-project commands remain available. `npm run lint --workspace backend-do` is still the original backend TypeScript check with its sync hook; `npm run typecheck --workspace backend-do` is the same check without an implicit content sync. Use `sync:banks` first on a clean checkout.

Install the browser once when needed:

```sh
npx playwright install chromium
```

Run a focused game suite while developing, then the shared regression suite when touching routing, styles or transport:

```sh
npx tsx --test tests/skyjo.test.ts
npm run test:e2e -- tests/e2e/skyjo.spec.ts
```

Playwright normally starts the Worker on 8787 and Vite on 5173, or reuses matching local servers. It uses local Worker storage under `backend-do/.wrangler/e2e`. Tests create separate lobbies and isolate browser contexts to model phones and displays. Avoid running builds or modifying canonical content during a browser run.

If Windows tracing fails while saving/closing an artifact, retry the affected suite without tracing:

```sh
npm run test:e2e -- --trace off
```

Do not increase a test timeout to hide a failed gameplay assertion. Check the error context first; multi-device games and screenshot/trace cleanup have different failure modes. Screenshots/traces and local diagnostic snapshots belong in ignored `test-results/`, not in application source.

`PLAYWRIGHT_BASE_URL` disables local web-server startup. Individual suites use different backend override variables, and some older tests assume localhost. See the suite before targeting a remote deployment. `npm run test:live` intentionally exercises production and is **not** part of normal `check`/`build`; see [deployment](deployment.md).
