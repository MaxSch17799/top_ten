# Project documentation

Start with [architecture](architecture.md) to understand the application, then use the guide for your task.

| Task | Guide |
| --- | --- |
| Install, run locally, test, or build | [Development](development.md) |
| Understand rooms, secrets, persistence, content, and hosting | [Architecture](architecture.md) |
| Add a game using the existing patterns | [Adding a game](adding-a-game.md) |
| Change the platform appearance or introduce a new visual style | [Styling and UI boundaries](styling.md) |
| Deploy or check the existing Cloudflare setup | [Deployment](deployment.md) |
| Choose the next larger cleanup | [Refactoring roadmap](roadmap.md) |
| Protect stored rooms, rollback, browser keys and platform boundaries | [Compatibility tests and CI](compatibility.md) |

## Game guides

Existing guide locations stay stable so links from earlier work continue to work.

| Game | Rules, architecture, and implementation notes |
| --- | --- |
| Top 10 | [Original platform and question-bank notes](reference/legacy-project-notes.md) |
| Just One | [Original engine, scoring, language, and word-bank notes](reference/legacy-project-notes.md) |
| Sounds Fishy | [SOUNDS_FISHY.md](../SOUNDS_FISHY.md) |
| Wavelength | [WAVELENGTH.md](../WAVELENGTH.md) |
| UNO | [UNO.md](../UNO.md) |
| Monopoly Deal | [MONOPOLY_DEAL.md](../MONOPOLY_DEAL.md) and [rules research](../MONOPOLY_DEAL_RESEARCH.md) |
| Flip 7 | [FLIP7.md](../FLIP7.md) |
| Skyjo | [SKYJO.md](../SKYJO.md) |

## Content authoring

- Top 10: canonical JSON in `question-banks/`; runtime admin changes live separately in D1.
- Just One: canonical JSON/schema in `word-banks/just-one/`; translations in `word-banks/just-one/language/en-de.tsv`. Detailed authoring notes are retained in the [historical README](reference/legacy-project-notes.md#word-bank-handoff-for-the-english-and-german-generation-tasks).
- Sounds Fishy: [bank format and instructions](../question-banks/sounds-fishy/README.md).
- Wavelength: [spectrum pack format and instructions](../spectrum-packs/wavelength/README.md).

Generated files and copied public banks are outputs. Edit their canonical source and run `npm run sync:banks`.

## Historical planning material

[Original project summary](../top10_project_summary_and_codex_prompt.md), [admin/D1 plan](../cloudflare_admin_d1_plan.md), dated verification sections in game guides, and the [previous README](reference/legacy-project-notes.md) retain useful context. They are historical records, not instructions to redo a migration or evidence that today's checkout was verified.
