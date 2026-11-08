# Wavelength

Wavelength is integrated at `/wavelength` and `/g/:code`, using the existing React/Vite frontend, Worker room registry, `GameDurableObject`, authenticated player sessions, WebSockets with polling/reconnect, QR invitations, and usage controls. Top 10, Just One and the existing Sounds Fishy work retain their engines. No new bindings, migrations, paid services or runtime dependencies are required.

## Playing

- **Party (default):** verbal clue, one shared dial, one lock, one opposing left/right choice. The Psychic does not have to click “finished speaking.” Reveal and scoring happen automatically. Next round is an active-team/host action unless an auto-next delay is configured.
- **Minimal verbal preset:** available in Game settings / Host controls. Selects Party, compact layout, timers off, auto-next off, and host-confirmed scoring. The revealed dial suggests the score; the host can accept or adjust it with one confirmation. Switching is safe during play: mode and scoring confirmation apply to the next round, timers immediately.
- **Remote:** a committed written clue (1–160 characters) and public discussion chat (1–300 characters). The Psychic cannot chat after their clue, even if they are host. No voice service is required. Clue drafts survive refresh locally; only submitted clues are shared.
- **Competitive:** two teams, minimum two people each. **Cooperative:** at least two people total. Up to 24 connected players, with spectators and uneven teams supported. Everyone acting as Psychic needs a private device/session.
- **Shared display:** host link and QR open `/g/:code/display#<display-token>`. The display ignores the browser's saved player identity, is read-only and has a fullscreen control. Keep the ordinary player screen private when acting as Psychic.

Interface language uses the platform's English/German preference; spectrum pack language is independent. Late joins spectate until the host assigns them a team between rounds. The host can rename/randomize teams, change seat/Psychic order between rounds, transfer hosting, replace a Psychic with a fresh secret, assign dial control, and skip a missing prediction with an audited reason and no bonus. After 60 seconds offline, a participating player may recover hosting. A controller who disconnects releases the dial; another guessing teammate can take over immediately.

## Rules and geometry

Reference: [physical Wavelength rulebook](https://gamers-hq.de/media/pdf/87/83/b1/Wavelength_rules.pdf), especially pages 8–18 and 21. The [publisher](https://www.cmyk.games/products/wavelength) and [official website](https://www.wavelength.zone/) distinguish the board game from the mobile app. This implementation uses the physical rules.

Competitive defaults: first team 0, second team 1; center 4, adjacent 3, outer 2, miss 0. On a boundary the higher score wins. Correct opposing prediction gives 1, suppressed on a center hit. Reach 10; equal totals trigger complete two-turn sudden-death pairs, including prediction points. A pair never finishes halfway through. Repeat tied pairs. Center hits while still behind earn another turn with a different Psychic, except within sudden death, which guarantees exactly one active turn per team in each pair. Psychic rotation independently tracks eligible players already served in each team's cycle.

Cooperative defaults: 7 available turns, no prediction; center 3 plus an extra turn, adjacent 3 without an extra turn, outer 2, miss 0. Each completed turn consumes one allowance. All nine original result bands are presented in English/German.

`shared/wavelength.ts` owns the geometry and scoring constants. Coordinates are angles from the left (0°) through the top (90°) to the right (180°). A **visually estimated approximation**, not a verified factory measurement, uses a center half-width of 4°, adjacent outer distance 12°, and outer distance 20°. Each of the five wedges is therefore 8° wide. Both SVG and server scoring use these exact constants.

The server samples uniformly from the open interval (-4°,184°), mathematically equivalent to random wheel orientation conditioned on a visible part of the central wedge. Centers can fall beyond the endpoints. Rendering clips every zone to [0°,180°]; scoring uses linear angular distance, never circular wrapping. Exact manufacturing dimensions were unavailable. Uniformity, symmetry, endpoint clipping and all boundaries have tests.

Digital conveniences: automatic single-spectrum selection (default), optional private choice of two (no target until selected), a designated shared dial controller with quick takeover, automatic reveal/scoring and optional timers. House rules are grouped explicitly: target score, even fixed total turn count, 0/0 starts, catch-up/prediction disabled, custom cooperative allowance/bonus, and host scoring confirmation. Fundamental scoring settings are locked outside the lobby.

## Code and state

- `shared/wavelength.ts`: network types, defaults, geometry and pure scoring.
- `backend-do/src/wavelength/engine.ts`: validated synchronous state machine, role projections, scoring, progression, shuffle bags, timers and audit history.
- `backend-do/src/wavelength/room.ts`: existing Durable Object transport/persistence pattern; serialized clone/apply/save, HTTP actions and role-specific WebSocket broadcasts.
- `frontend/src/components/Wavelength{Home,Game,Settings,Dial}.tsx`: creation, play, recovery/settings and accessible SVG dial.
- `frontend/src/lib/waveI18n.ts`, `frontend/src/wavelength.css`: localization, result bands and responsive presentation.
- `frontend/src/components/GameRoute.tsx`: room and display dispatch based on public game metadata.

Phases: `LOBBY → [SELECTION] → [CLUE in written mode] → DIAL → [PREDICTION in competitive mode] → [REVIEW when host confirmation is selected] → REVEAL → next round / COMPLETED`. Party combines clue/discussion in DIAL. All scoring commits once. The server stores totals, recent history, pre-result snapshots, rotation, pack usage, tokens, deduplicated action IDs, deadlines and pause remainders under the `wavelength` storage key. Browser refresh and isolate restart preserve gameplay.

Timers are disabled by default. Clue, discussion, prediction and auto-next durations are independent. Pause/resume, reset, +30 seconds and live duration changes are authoritative server operations. Durable Object alarms work without a browser. Normal expiry warns; optional auto-expiry locks the latest shared dial or skips a missing prediction with zero bonus. It never fabricates a clue. Auto-next is at least 5 seconds, and defaults to manual progression.

Before reveal, reopening the dial is safe. Once exposed, a target is never made secret again. Void/replay restores the pre-result score/allowance/tiebreak and creates a new round ID, spectrum and target. Correcting the latest score recomputes catch-up, victory and sudden death from the pre-result snapshot, with a required audit reason. Older turns cannot be rewritten after advancing. Host-led scoring keeps the actual geometric center-hit fact for cooperative bonus determination, even when the host adjusts points.

## Security

Player tokens are authenticated by the server; payload role/player IDs cannot impersonate someone. Every command checks generation, round ID, phase, revision, role and inputs. Request IDs deduplicate retries per authenticated identity. Movement also requires the current controller epoch and an increasing sequence. Lock carries the final pointer value; late drag events cannot change a locked dial. Chat/movement have independent validation and do not invalidate unrelated decisions. Clients coalesce movements to roughly 7 updates per second; final position remains server-authoritative.

Serialization is an explicit allowlist. Only the current Psychic receives `target` before reveal; only they receive candidate spectra in selection. Host status grants no secret access. Display sessions use a separate token, receive the public projection and cannot mutate state. Other players/spectators receive no current target, candidates, wheel state, seed or derived scoring zones. Completed history contains only already-public targets. API state uses `Cache-Control: no-store`, untrusted text is rendered as React text, and no private pack/target data is placed in public static files. No external chat dependency is used.

## Content packs

**Full English and German classic packs are installed: 200 pairs per language, 400 total.** Both supplied root JSON files were validated and copied into the canonical pack directory. They omit `development` and are presented as full packs.

Canonical files:

- `spectrum-packs/wavelength/wavelength_en_classic_v1.json`
- `spectrum-packs/wavelength/wavelength_de_classic_v1.json`
- Validator: `shared/wavePack.mjs` (plain Node, no additional install).

Each pack is a standalone JSON object:

```json
{
  "schemaVersion": 1,
  "game": "wavelength",
  "packId": "wavelength-en-classic-v1",
  "language": "en",
  "title": "English Classic",
  "spectrums": [
    {
      "id": "en-001",
      "left": "Forgettable birthday gift",
      "right": "Unforgettable birthday gift",
      "category": "relationships",
      "tone": "light",
      "difficulty": "easy"
    }
  ]
}
```

German: `packId: wavelength-de-classic-v1`, `language: de`, `title: Deutsch Klassisch`, IDs like `de-001`. `development` is optional boolean; omit it or set false for full packs. Unknown fields are rejected. Pack/spectrum IDs and titles are nonempty, trimmed strings up to 100 characters; pack IDs match `[a-z0-9-]+`. Endpoints are distinct trimmed plain text up to 120 characters. No HTML/control characters. IDs and normalized endpoint pairs, including reversed pairs, must be unique within a pack. 1–10,000 spectrums per pack.

Controlled metadata:

- Categories: `everyday`, `social`, `culture`, `emotions`, `relationships`, `practical`, `philosophical`, `absurd`.
- Tones: `light`, `thoughtful`, `silly`.
- Difficulties: `easy`, `medium`, `challenging`.

Replace the canonical JSON files and run `npm run sync:wavelength-packs`. Additional JSON files are discovered automatically, with globally unique pack IDs. This validates and generates `backend-do/src/generated/wavelengthPacks.ts`; `/api/wavelength/packs` exposes metadata. Both frontend and Worker prebuild/predev hooks run synchronization. Do not edit generated code. Draws avoid repeats until a pack is exhausted, then avoid an immediate cycle-boundary repeat. Each language/pack retains independent usage, and selected spectrums are snapshotted for the round/history. Update pack IDs for incompatible versions; retain old IDs while active rooms use them. Large future packs should use chunked persistence if usage/history would exceed the Durable Object per-value limit.

## Checks and deployment

```sh
npm run sync:banks
npm test
npm --prefix frontend run lint
npm --prefix frontend run build
npm run lint --workspace backend-do
npm run build --workspace backend-do
npx playwright test
```

`tests/wavelength.test.ts` covers geometry/edges, target distribution, scoring, catch-up, uneven rotation, sudden death, cooperative bonus, privacy projections, permissions, stale/duplicate commands, host confirmation/correction, void/replay, modes/languages, timers, persistence and pack validation. `tests/e2e/wavelength.spec.ts` covers real HTTP/WebSocket sessions, mobile touch/keyboard dial control, shared-display secrecy in the host's browser, reconnection, written clues/chat, complete cooperative play, German mode and host recovery controls.

Use the existing Cloudflare project, Worker config and OAuth login. Deploy Worker first: `npm run deploy:worker`. Build frontend, then `npx wrangler pages deploy frontend/dist --project-name top-ten --branch main --commit-dirty=true`. Existing Pages URL: `https://top-ten.pages.dev/`; the older `max-alina.pages.dev` is obsolete according to the existing project notes. Manual deployment permits verification of the current workspace without committing unrelated pre-existing changes. Keep the existing backend URL and bindings. No D1 migration is needed.

Recent history, chat, audits and retry IDs are bounded. Before persistence, the room also measures UTF-8 state size and trims the oldest retained entries to stay below 120 KB, leaving room under the Durable Object 128 KiB value limit. Totals, the current round/secret, used deck and correction snapshot are preserved. A Unicode stress test verifies this behavior.

## Verified deployment

- **Live game:** https://top-ten.pages.dev/wavelength
- **Cloudflare Pages deployment:** https://9540aaac.top-ten.pages.dev
- **Worker version:** `b213533d-abc6-44c0-b0c3-86be2fa5e962` at `https://top-ten.maxschimmel17799.workers.dev`.
- **Content:** both production catalog entries have 200 spectrums and `development: false`.
- **Checks:** 83 passing unit/integration tests; all 14 local browser regression scenarios passed across the four games. Frontend ESLint/TypeScript/Vite build, backend TypeScript and Wrangler dry run passed. The final persistence safeguard also passed the room adapter and Unicode stress tests.
- **Production:** all three Wavelength browser scenarios passed against the deployed frontend/Worker: competitive touch/keyboard dial, actual HTTP/WebSocket privacy, host-account shared display, reconnect, complete seven-turn written cooperative game/chat, minimal verbal confirmation, corrections/voids, German pack and UI. Existing live verification passed English/German Just One, Top 10, PWA activation and uncached gameplay APIs. Error-filtered Worker tail captured no runtime errors during these checks.
- **Usage guard:** the existing site was at its configured warning threshold during verification. Tests used its existing authenticated admin-override flow; thresholds/counters were not changed. Live verification accepts `LIVE_ADMIN_PASSWORD`, and Wavelength browser QA accepts `WAVELENGTH_QA_ADMIN_PASSWORD`, through the process environment only. No password/token is stored in source.

The full regression suite is `npx playwright test`. For Wavelength production QA, set `PLAYWRIGHT_BASE_URL=https://top-ten.pages.dev` and `WAVELENGTH_BACKEND_URL=https://top-ten.maxschimmel17799.workers.dev`, then run `npx playwright test tests/e2e/wavelength.spec.ts`. Supply the optional password environment variable only if the existing guard requires it. Test rooms are ended automatically.

Changes remain in the workspace without a Git commit, preserving the pre-existing Sounds Fishy work. This was a direct Cloudflare deployment. The physical rules intentionally rely on social clue judgement; no semantic language validator or voice stack is added. Scoring wedge widths remain the documented visual approximation; exact manufacturing dimensions are unavailable.
