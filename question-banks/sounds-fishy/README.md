# Sounds Fishy private banks

Both full classic banks are installed: **150 English questions and 150 German questions**. They were imported from the user-supplied root JSON files on 2026-10-29, replacing the six-question development samples. Their `development` flag is omitted, so the catalog lists them as full banks and the interface does not show sample warnings.

Edit these canonical files for future content changes:

- `sounds-fishy-classic-en.json` — `bankId: sounds-fishy-classic-en`, language `en`, title `Classic English`.
- `sounds-fishy-classic-de.json` — `bankId: sounds-fishy-classic-de`, language `de`, title `Classic German`.

The root JSON files are retained as ignored import originals; the files in this directory are the canonical copies used for builds and deployment.

Use the standalone contract in `question-bank.schema.json`. Include every required question field; use only equivalent alternatives in `acceptedAnswers`. Omit `development`, or set it to `false`, for a complete bank. IDs must be unique across all installed banks. Duplicate normalized question text is rejected within each language.

From the repo root run:

```sh
npm run sync:sounds-fishy-banks
npm test
npm run deploy:worker
```

The script discovers every `*.json` here except `*.schema.json`. Additional languages/themes need no engine changes. It validates the complete input and emits only `backend-do/src/generated/soundsFishyBanks.ts`. The Worker validates banks again when loading its module. The catalog endpoint `/api/sounds-fishy/banks` returns titles, languages, IDs, counts and the sample flag. **No question text, answers or source metadata are published by the catalog. Never copy this directory to `frontend/public`.** Frontend and Worker builds run synchronization automatically.

Deploy the Worker first. Redeploy the frontend if needed to update interface changes; bank-only changes need only the Worker deployment. Existing rounds retain a private snapshot of their chosen question, answer, alternatives and sources. Keep question IDs stable when correcting existing content. A missing selected bank falls back to an installed bank at the next draw and reports the change. If no valid banks are installed, the build fails clearly rather than publishing an unplayable game.

Each bank has a separate session draw history. Questions, including replaced/voided questions, do not repeat until all 150 questions in that bank have been used. Exhaustion starts an announced new random cycle, avoiding the immediately previous question when possible. A restart intentionally begins a new game with fresh histories.

Sources are shown only after the round is resolved. Verification notes and accepted alternatives always stay on the server. Source research does not remove the need for human dispute handling: the host can void a question, roll back that round's awarded points and replay with the same Guesser, a new question, fresh roles and a fresh round ID.

Voiding an already-scored result restores the totals from before that result, including undoing score corrections made since it was scored. Earlier rounds are preserved. Any intended correction to older totals can be reapplied with a reason after voiding.
