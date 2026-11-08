# Styling and replaceable UI

The platform deliberately allows games to have different visual identities. A visual change should operate on public view data and UI components without rewriting game rules or transport.

## Platform defaults

`frontend/src/theme.css` is imported at the top of `styles.css`. It contains the existing platform values, extracted without changing their appearance.

| Token | Purpose |
| --- | --- |
| `--bg`, `--panel` | Platform backgrounds |
| `--accent`, `--accent-strong`, `--border`, `--muted` | Existing semantic colors; game scopes can override them |
| `--text-primary` | Default body text |
| `--font-display` | Existing pixel display font, currently also used by the platform body |
| `--font-body` | System-font option for new UI; existing games still own their explicit font stacks |
| `--radius-panel`, `--radius-control` | Shared panel and button radii |
| `--content-width` | Shared `.sheet` width |

Start a platform reskin here. Some legacy declarations and per-game styles still contain literal colors, radii and fonts. Changing these tokens is a foundation for a reskin, not a promise that every game or SVG will automatically adopt it. Migrate remaining literals in small visual passes.

## Keep game styles scoped

Existing scopes include `.f7`, `.sky`, `.uno`, and game-specific prefixes in `deal.css`, `fishy.css`, and `wavelength.css`. Add a single wrapper class around a new game and scope its controls, surfaces, focus styles and responsive rules under it. Prefix animation names and decorative classes too.

The global stylesheet contains broad selectors such as `button`, `select`, `.hero` and `.field`. They are part of current behavior. New game overrides should be explicit rather than adding new global selectors. Avoid rewriting these globals during a game-specific visual change.

For a new style, prefer semantic variables for surface/text/accent/focus, spacing and radii. Reuse the platform variables where their meaning matches. Add a scoped token when its meaning differs. Preserve visible focus, readable numbers and contrast, usable phone targets, and a reduced-motion mode.

## Separate models from renderers

The card games already provide useful seams: `UnoCard`, `DealCard`, `FlipCard`, and `SkyCard` render SVG from public card data. `WavelengthDial` is a comparable board control. Their shape, texture, typography, palette and animation can be replaced while keeping the value/identity and interaction contract intact.

For example, a differently styled Skyjo card should still accept a public `value` or a back state. It must not receive a hidden value just to choose a color, compute a target, or reserve a layout. A face-down card's alternate artwork remains independent of its secret value.

Rendering should emit an intent such as a selected grid position; the action layer sends it and the engine validates it. Keep position ordering, accessible names, face/back distinction, valid targets, and keyboard/touch behavior stable when swapping renderers. CSS animation completion is not a gameplay trigger.

## A staged complete reskin

1. Choose semantic platform tokens and create a small reference page/story for controls, panels, cards, targets, errors and results.
2. Replace platform literals using equal-valued tokens first; compare screenshots and computed styles before changing values.
3. Migrate one game's wrapper to those tokens and extract its renderer behind the existing props. Leave game view/action types intact.
4. Check portrait/landscape phones, large player counts, desktop, TV, focus order, private information, and reduced motion.
5. Apply the design to other games after the first migration proves the component boundaries. A runtime theme selector can follow once all affected components have a consistent token contract.

This cleanup does not change current game palettes, card artwork, layouts, or the global font-loading setup. A future font/asset strategy and broader component library are separate tasks in the [roadmap](roadmap.md).
