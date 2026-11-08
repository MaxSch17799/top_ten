# Existing Cloudflare deployment

The production frontend is the Git-connected Pages project `top-ten`, with production branch `main`, at <https://top-ten.pages.dev/>. The Worker is `top-ten` at <https://top-ten.maxschimmel17799.workers.dev>. These names come from the current repository configuration and recorded deployments; this cleanup does not change hosting or publish a release.

## Configuration ownership

| File/setting | Current role |
| --- | --- |
| `backend-do/wrangler.toml` | Config used by the existing `deploy:worker`, backend dev and dry-run commands |
| Root `wrangler.toml` | Same Worker/bindings with a root-relative entry point; retained for existing tooling |
| `backend-do/migrations/` | D1 schema migrations for bank administration |
| Wrangler `[[migrations]]` entries | Durable Object class migration history; separate from D1 SQL migrations |
| Pages project settings | Frontend root `frontend`, build `npm ci && npm run build`, output `dist`, existing environment values |
| `frontend/src/api.ts` | `VITE_BACKEND_URL` override and existing production fallback |

The existing bindings are `GAME_DO`, `USAGE_MONITOR_DO`, and `QUESTION_BANKS_DB`. All games share the lobby namespace. Keep names, namespace/class identity, database ID, compatibility date and migration tags stable during an organizational refactor. A new game following the present adapter pattern does not need a migration.

The root and backend Wrangler files have different path bases. Do not replace one with the other by copying text. Consolidating them is a separate change requiring CLI/build configuration checks.

## Validate a release

Use the [development commands](development.md): `npm run check`, `npm run build`, and relevant browser tests. Confirm that generated data is intentional, player secrets stay server-only, and old stored-room/reconnection behavior remains compatible. Keep existing pack/bank IDs stable; plan content replacement while active games are using those IDs.

## Publish when a release is intended

These commands publish to the existing project. Publish the Worker before a frontend that needs new endpoints or game dispatch.

```sh
npm run deploy:worker
```

For Pages, either push a deliberately reviewed release to the existing production branch, or publish already-built assets manually:

```sh
npx wrangler pages deploy frontend/dist --project-name top-ten --branch main
```

Wrangler can ask for explicit handling of a dirty checkout. The previously used manual workflow adds `--commit-dirty=true` after the complete working-tree build has been reviewed. That option labels the deployment; it does not save source changes in Git. A future Git-triggered build can overwrite a manual deployment if its branch does not contain the same source.

The Pages command may mention that the root Worker config lacks `pages_build_output_dir`; the existing explicit-directory Pages deployment proceeds using project settings. This cleanup deliberately keeps the working configuration rather than mixing Worker and Pages settings.

## Verification and rollback planning

Record the Worker version and Pages deployment URL, verify the production alias, and test only newly created QA lobbies. End those lobbies when finished. The existing `scripts/verify-live.mjs` targets the original platform/Just One flows; game suites have additional display/privacy checks. Read each suite's frontend/backend override variables before pointing it at production.

Keep a known-good Worker and Pages version together. Coordinate rollbacks when a frontend depends on a new API, and preserve stored-state compatibility in both directions. Do not run remote SQL migrations, rename Durable Object classes, reset lobbies, change secret values, or deploy unreviewed local work as part of a documentation cleanup.
