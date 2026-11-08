# Wavelength spectrum packs

Edit the canonical `wavelength_en_classic_v1.json` and `wavelength_de_classic_v1.json` files here. Both supplied **full classic packs are installed, with 200 pairs per language**. For future development packs, set `development: true`; omit it for full content.

Run `npm run sync:wavelength-packs` from the repository root. This validates packs, including duplicate/reversed endpoint pairs, and generates the server bundle and catalog. Never edit `backend-do/src/generated/wavelengthPacks.ts` directly. Rebuild and redeploy both applications after changing content.

The exact runtime contract is `shared/wavePack.mjs`; a structural JSON Schema is included here for editors. Unordered normalized endpoint-pair uniqueness is additionally enforced by the runtime validator. Full instructions and allowed metadata values are in [WAVELENGTH.md](../../WAVELENGTH.md#content-packs).
