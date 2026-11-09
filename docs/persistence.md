# Room persistence and recovery

All eight adapters use `backend-do/src/platform/persistence.ts` to commit their existing room value and next alarm in one storage transaction. Keys and data shapes are unchanged. Each game still chooses its deadlines, terminal phase, pause representation and legal timeout behavior.

The helper uses the documented [Cloudflare storage transaction API](https://developers.cloudflare.com/durable-objects/api/sqlite-storage-api/#transaction); alarm operations participate in storage ordering as described in the [alarm API](https://developers.cloudflare.com/durable-objects/api/alarms/). The callback writes a detached snapshot and changes the alarm. It performs no network operations, rule transitions or broadcasts.

A successful save precedes broadcasting. Top 10's prompt-choice WebSocket handler now awaits this save instead of suppressing a background write failure. HTTP requests and Top 10 socket mutations are serialized; an identical already-selected prompt is a no-op.

If a commit cannot be confirmed, the adapter discards its cached state and closes its sockets for reconnection. The next request loads durable truth. HTTP returns `503`, `ROOM_COMMIT_UNCERTAIN` and `retryable: true`. `ApiError` preserves status/retryability so existing same-action retry controls do not misclassify this as an illegal move. A valid rejected command remains a game-specific 4xx error.

Never invent a new ID to retry an unconfirmed action. Preserve its generation, round, phase and revision as supplied by that game. A transaction may have committed before its acknowledgement was lost; the engine's processed-action log makes an exact retry safe. Top 10's legacy HTTP commands do not have IDs and are not automatically replayed. A refresh establishes their current result.

## Verification

`tests/runtime-recovery.test.ts` bundles a test-only Worker and runs it in the same local Cloudflare runtime supplied by the locked Wrangler installation. It uses SQLite-backed Durable Objects, isolated names for each scenario and fake historical room data. No test-control endpoint is imported into the production Worker.

Coverage includes:

- Write, set-alarm and delete-alarm failures for every game, with no partial persisted transition.
- Cache readback and successful retry after a real Durable Object eviction.
- A lost acknowledgement after a successful commit, followed by eviction and exact-ID retry in all seven action-ID protocols.
- A decision alarm firing without clients after eviction, retaining Skyjo's pending private card.
- Top 10 refusing to broadcast an unpersisted prompt and accepting the selection after reconnection.

These are injected I/O exceptions in the real local storage runtime, not claims to reproduce physical disk failure or every production outage. The existing frozen-fixture suite separately checks rollback to the pinned historical implementation. `tests/support/durable-harness.ts` provides a fast transaction-aware double for other adapter tests.

The runtime tests use the Miniflare/esbuild versions already installed through Wrangler; no new package or service is introduced. Their API compatibility is part of any future Wrangler upgrade review. Run them with `npx tsx --test tests/runtime-recovery.test.ts` or normal `npm test`.
