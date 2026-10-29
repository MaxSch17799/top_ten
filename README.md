# Max & Alina’s Game Night

React/TypeScript/Vite on Cloudflare Pages, backed by a Cloudflare Worker and the existing `GameDurableObject` namespace. Top 10 remains available at `/top10`; its original `/host` and `/g/:code` links continue to work. `/` is the game selector and `/just-one` creates or joins Just One. Admin routes and Top 10 question banks are retained.

## Development and checks

Use Node 22.18+ (or Node 24+) and npm. On Windows with restricted PowerShell scripts, use `npm.cmd` / `npx.cmd`.

```sh
npm install
npm --prefix frontend install
npm run sync:banks
npm run dev --workspace backend-do
# In another terminal; PowerShell: $env:VITE_BACKEND_URL='http://127.0.0.1:8787'
VITE_BACKEND_URL=http://127.0.0.1:8787 npm --prefix frontend run dev
```

```sh
npm test
npm --prefix frontend run lint
npm --prefix frontend run build
npm run lint --workspace backend-do
npm run build --workspace backend-do
npx playwright install chromium
npm run test:e2e
```

The Worker build is a Wrangler deployment dry run. Browser tests start local Worker/Vite servers, or reuse matching servers on ports 8787/5173. Browser contexts are isolated to model multiple devices. Local D1 migrations for the existing admin features can be applied with `npx wrangler d1 migrations apply QUESTION_BANKS_DB --local`.

## Verification (2026-10-29)

- 36 engine/language/schema tests cover original/custom/endless scoring, bank reshuffles, permissions, draft secrecy and deadline submission, live controls, bilingual validation, replay protection, migration of existing rooms and both production banks. Translation coverage is checked for all 1,100 mystery words.
- 7 browser/integration scenarios cover three-device games, timer submission while offline, optional submission, immediate mode/timer switching, large party controls, custom round counts, legacy Top 10, QR invites, reconnection, result correction and mobile/tablet layouts.
- Frontend TypeScript/Vite production build and ESLint passed. Backend TypeScript check and Wrangler deployment dry run passed. `npm run test:live` verifies both production banks, completes an English and a German three-device game, checks Top 10 and confirms PWA activation on the deployed website. It finishes its test lobbies automatically.

## Architecture and behavior

- The game registry is `frontend/src/lib/games.ts`. Existing invite codes use the same namespace; a public `/api/game/:code/info` response identifies the game without disclosing gameplay data.
- Top 10 keeps its existing engine, question bank snapshots, admin tools, host controls, round handling and APIs. The shared connection hook now retries WebSockets with backoff, recovers on visibility/network changes, polls only when realtime is unavailable, ignores stale versions and isolates snapshots by player identity. Sessions are saved per lobby, with migration from the legacy storage key.
- Just One lives in `backend-do/src/justOne/`: a deterministic synchronous engine for commands/scoring/privacy, local language comparison, and a Durable Object transport/persistence adapter. No new Durable Object bindings, migrations, D1 tables or paid services are needed. Each lobby persists separately under its existing Durable Object ID.
- All commands authenticate the player token; the server checks role, phase, round and game generation. Request IDs deduplicate retries. State is cloned before applying a command, and command/persistence operations are serialized. Late/replayed submissions cannot score twice. A restart increments the generation to reject old commands even when round numbers repeat.
- Serialization explicitly projects each role’s view. The guesser gets no mystery word, five-word card, seed, bank snapshot, eliminated clues or private submissions before reveal. Late joiners/spectators also get no current secrets. A guessing host delegates review/adjudication to a clue-giver; a disconnected reviewer delegates to an online clue-giver.
- Server deadlines and pause remainders are persisted. One Durable Object alarm handles both the next phase deadline and session expiry; alarm retries are safe. Clue expiry omits missing submissions, and guessing expiry passes the card. Timers start disabled (60/30 seconds configured). The browser countdown adjusts to server time.
- Original scoring uses 13 cards; wrong answers consume an extra available card or remove one won point on the last card. Custom mode accepts 1–1,000 turns, consuming one turn per result. Endless mode has no turn limit, with a score that keeps increasing until the host ends the game. Custom/endless games reshuffle after exhausting the bank, avoiding an immediate repeat at the cycle boundary where possible. The most recent 100 results are retained to keep persisted state bounded. Host corrections recalculate the last result from its saved pre-result totals.
- A reviewer confirms the clue board each round. Obvious duplicates/invalid forms and known English/German translations are removed automatically; possible word parts (e.g. `sis` for `sister`) and uncertain relationships are flagged. Every elimination remains reversible by the reviewer. All-eliminated boards lose the card on finalization. Typed borderline answers are one committed attempt, resolved by a non-guesser reviewer/host.
- Guessing-mode, timer and deadline-submission switches save immediately, without an extra Apply click. Other settings use Apply settings. Changes to the active timer reset its countdown; changing an inactive timer does not disturb the current countdown. Mode changes preserve the current word and committed result. Verbal mode removes the answer field and shows large Correct guess/Wrong guess/Pass controls to the non-guesser host or delegated reviewer. Pause, reset and +30 seconds are explicit host actions. Bank/selection/clue-count changes apply next round; scoring/length stay locked after start.
- 3–4 participants automatically give two clues; larger groups give one, with a host override. Support is 3–10 participants (8–10 is a house rule). Seat order is editable before starting, host included. Late arrivals participate next round. Clue and answer drafts are privately saved to the server after a short typing pause and retained locally for refresh recovery; the form reports sync status. At timer expiry, the server submits the latest synced nonblank text by default, including partial clue boards. Clue and answer auto-submission each have an independent host switch. Empty answers pass; a verbal timer always passes without judging an old typed draft. Manual submissions lock immediately. Unsynced text entered without connectivity cannot reach the server deadline.
- The PWA uses the platform name/icon. Navigation/JSON use network-first caching; gameplay APIs are never cached, and old caches are removed on activation. Multiplayer still requires internet access.

## Word-bank handoff for the English and German generation tasks

**Edit the canonical source files, not generated files:**

- English: `word-banks/just-one/en_classic_v1.json`
- German: `word-banks/just-one/de_classic_v1.json`
- Exact JSON Schema: `word-banks/just-one/word-bank.schema.json`
- Runtime/build validation: `shared/wordBank.mjs` (plain Node; no build dependency required)

Both production banks are installed: **110 cards / 550 words per language**. The English bank was imported from `just_one_en_classic_v1_package.zip`; the German bank was imported from `just_one_de_classic_v1.json`. The source files below are now the canonical copies. Their bank IDs remain unchanged, and `development` is omitted so both are listed as full banks.

```json
{
  "id": "just_one_en_classic_v1",
  "name": "Classic English",
  "language": "en",
  "version": 1,
  "development": false,
  "cards": [
    {
      "id": "en_0001",
      "words": ["Elephant", "Piano", "Volcano", "Bicycle", "Castle"]
    }
  ]
}
```

For German use `id: "just_one_de_classic_v1"`, `name: "Classic German"`, `language: "de"`, and card IDs such as `de_0001`. Required bank fields: `id`, `name`, `language`, positive integer `version`, and nonempty `cards`. Each card requires a unique nonempty `id` and **exactly five distinct nonempty trimmed words**, each at most 60 characters. Words must also be unique throughout a bank after NFKC/case normalization. Optional metadata: `development` (boolean), `description`, `theme`, `difficulty` (strings). Language accepts BCP 47 tags; English/German have extra rules, other languages use normalization and conservative fuzzy review.

Run `npm run sync:just-one-banks`. It validates all source JSON files except `*.schema.json`, discovers new banks automatically, and generates:

- Public bank copies: `frontend/public/banks/just-one/en_classic_v1.json` and `de_classic_v1.json`
- Public metadata: `frontend/public/banks/just-one/manifest.json`
- Server bundle: `backend-do/src/generated/justOneBanks.ts`

New themed/language banks need another source JSON file and the sync/build step. The server catalog `/api/just-one/banks` exposes only metadata. Both frontend builds and Worker deployment sync automatically. Missing/unknown banks produce a readable error. Every drawn card is randomized and its five words reserved, preventing unwanted repetition within a cycle. Custom/endless modes start a new cycle when the bank is exhausted.

English/German clue translations live in `word-banks/just-one/language/en-de.tsv`: each non-comment line has English aliases, one tab, and German aliases. Separate aliases with semicolons. This is a local, curated list; no D1 migration or runtime translation API is needed. Sync generates `backend-do/src/generated/justOneTranslations.ts` for server validation. Every classic mystery word must have a translation entry, so add/update this list when editing those banks. Translations are used to validate clues, not to merge synonymous clues. Ambiguous forms and missing rare translations can still need review.

## Deployment

This work does not publish to a new hosting provider or alter the existing audience. Deploy the Worker **before** the frontend so new invitation dispatch and endpoints are available:

1. `npm run deploy:worker` (uses the existing `backend-do/wrangler.toml`, bindings, D1 and account login).
2. Cloudflare Pages: frontend root `frontend`, build command `npm run build`, output `dist`. Word-bank synchronization uses plain Node, so the existing frontend dependency installation remains sufficient. Keep the existing `VITE_BACKEND_URL` / optional `VITE_FRONTEND_URL` values.
3. The existing Git-connected Pages project is `top-ten`, production branch `main`, at `https://top-ten.pages.dev/`. Push the reviewed changes to `origin/main` to trigger its build (`npm ci && npm run build`, frontend root, output `dist`). For a manual deployment use `npx wrangler pages deploy frontend/dist --project-name top-ten`. The older `max-alina.pages.dev` address does not resolve. No new resource migration is required.

## Limits and useful next improvements

- Local language rules cover normalization, common inflections, curated equivalences, known English/German translations, conservative typo matching and word-part/family suggestions. They are not an exhaustive semantic dictionary: rare senses, translations outside the curated aliases, homophones and invented compounds can still need human review. Synonymous clues are never merged by meaning.
- A clue-board confirmation remains intentional each round so people can catch invalid clues that deterministic processing cannot detect. There is no paid AI dependency.
- Only the last result can be corrected; consumed history cannot be rewritten after advancing. Changing the scoring mode or game length requires a fresh game.
- Word banks are build-time assets. Already-running games should finish before replacing bank IDs/card contents in a deployment. Future live bank editing would benefit from storing a versioned bank snapshot per game, as Top 10 already does for questions.
- Sessions expire after 30 minutes idle in the lobby or two hours without a game action in play. A disconnected host retains the host role; the host can reconnect on the same browser. Review delegation is automatic, but permanent host transfer is not implemented.
- Next improvements: add curated language equivalences from real play feedback; add optional host transfer and a bank administration UI. Game/night identity and routing can be extended through the registry and another server adapter.
