# yf — spec

yf is Yoan Faure's design system for webapps on `*.yoanfaure.com`, Claude-built artifacts, and later yoanfaure.com itself. It is the visual language of yoanfaure.com, extended for tools.

This file is the contract. If code and spec disagree, fix one of them on purpose.

## 1. Decisions

| Area | Decision |
|---|---|
| Name and namespace | `yf`. Classes `.yf-*`, custom properties `--yf-*`, JS `window.yf`, data attributes `data-yf-*`. |
| Colour | Monochrome ink on paper (light `#f4efe4`/`#262523`, dark `#1e1d1b`/`#ece6d9`). Muted red, amber and green are used **only** for status (pills, errors, toasts, thresholds), never for decoration or brand. The primary action is solid ink. |
| Shape | The layout is square (radius 0, 1px rules). Controls (buttons, inputs, pills, menus, toasts) get `--yf-radius: 3px`. |
| Type | Inter (variable, plus italic) for everything, JetBrains Mono 400 for code, ids, hashes and numbers in tables. Self-hosted. |
| Density | Comfortable by default (`--yf-control-h: 2.25rem`). One compact size, `.yf-button--sm` (`--yf-control-h-sm: 1.75rem`), for filter chips and dense toolbars. |
| Knobs | Layout knobs (`--yf-container`, `--yf-split-side`, `--yf-table-max-h`, `--yf-cell-min`) also come as modifier classes (`.yf-container--narrow/--wide`, `.yf-split--wide-side`, `.yf-table-wrap--tall`, `.yf-wide`, plus `.yf-page`), because a strict CSP forbids a `style` attribute. Any other value is the custom property in a stylesheet. |
| Icons | Phosphor Regular (MIT), shipped as a curated SVG sprite `icons/yf-icons.svg`. Markup is `<svg class="yf-icon"><use href="#name"/></svg>`. Browsers refuse a cross-origin `<use>`, so `yf.icons` (16-icons.js) fetches the sprite next to `yf.js` (CORS) and inlines its symbols once, sanitized. Apps add ds.yoanfaure.com to `connect-src`; artifacts set `data-yf-icons="off"` and inline the symbols they use. |
| Charts | Series are ink shades (100, 78, 62 and 52%: `--yf-series-1..4`, all at least 3:1 against paper in both themes), each paired with a dash pattern (`--yf-dash-1..4`), so charts read in grey, in print and for colour-blind readers. Status colours mark thresholds only. A meter's healthy range is ink; only warning and danger ranges take colour. `yf.chart` (24-chart.js) draws line and bar charts from a spec at the width they are shown (round ticks, direct labels that do not overlap, an `aria-label` built from the data), from script or from `<figure data-yf-chart>` with a JSON block. |
| Topo field | The ASCII topographic field from yoanfaure.com appears in apps only in empty states, loading states and error/404 pages. Host class `.yf-topo` (`.yf-field` is the form field), mounted from `[data-yf-field]` by `yf.field`. |
| Motion | Calm and functional. 120/200/400ms with `--yf-ease-out`/`--yf-ease-in`. Everything respects `prefers-reduced-motion`. |
| Themes | Light and dark. The system decides unless `html[data-theme="light"|"dark"]` forces one. |
| Delivery | Plain CSS and tiny vanilla JS. No framework, no build dependencies. CSS sits in cascade layers (`yf.reset, yf.tokens, yf.base, yf.layout, yf.components, yf.utilities`), so unlayered app CSS always wins. |
| JS | Progressive enhancement. Every component works and reads correctly without JS. JS adds behaviour via `data-yf-*` attributes, auto-initialised on `DOMContentLoaded` and exposed as `window.yf.*`. No `innerHTML` with untrusted data, no inline styles needed, and CSP-friendly (works under `script-src 'self'`, `style-src 'self'`). |
| Accessibility | WCAG 2.2 AA contrast for text and UI in both themes. Visible focus everywhere (2px ink outline, 2px offset). Native elements first (`<button>`, `<dialog>`, `<details>`, `popover`). |
| Repo | `y0anfa/yf`, public, MIT. |
| Hosting | `https://ds.yoanfaure.com/v0.1.0/yf.css` (plus `yf.js`, `fonts/`, `icons/`). **Pinned versions only**: a released version never changes, and there is no moving alias. The docs page is at `https://ds.yoanfaure.com/`. |
| Build | Plain source files plus a tiny POSIX shell script. `scripts/build` concatenates `src/css/*.css` (in file-name order) into `yf.css` and `src/js/*.js` into `yf.js`. `scripts/release X.Y.Z` freezes a copy into `releases/vX.Y.Z/` and refuses to overwrite. The deployed site is every frozen release plus the docs page. |
| Artifacts | Claude artifacts cannot load external CSS (their CSP allows stylesheets from Google Fonts only), so artifacts inline `yf.css` and load Inter and JetBrains Mono from Google Fonts. The Claude reference artifact explains this. |

## 2. Source layout

```
src/css/00-layers.css     layer order (do not reorder)
src/css/01-tokens.css     every raw value; light, dark (system and forced)
src/css/02-reset.css      minimal modern reset
src/css/03-base.css       html/body, links, focus, selection, headings, code
src/css/04-type.css       type utilities: .yf-text-*, .yf-mono, .yf-muted, .yf-num (tabular)
src/css/05-layout.css     .yf-container, .yf-column, .yf-stack, .yf-cluster, .yf-grid, .yf-split, .yf-divider
src/css/10-actions.css    .yf-button (primary, secondary, ghost, danger, icon-only), .yf-link
src/css/11-inputs.css     .yf-field (label, help, error), .yf-input, .yf-textarea, .yf-select, .yf-checkbox, .yf-radio, .yf-switch
src/css/12-feedback.css   .yf-toast, .yf-banner, .yf-tooltip
src/css/13-overlays.css   .yf-dialog, .yf-menu, .yf-tabs
src/css/20-data.css       .yf-table, .yf-status, .yf-stat, .yf-kv, .yf-progress, .yf-meter, .yf-code, .yf-sparkline, chart helpers
src/css/21-content.css    .yf-prose, .yf-log, .yf-meta, .yf-stats-callout, .yf-footnotes, .yf-quote, .yf-figure
src/css/22-states.css     .yf-topo (field host), .yf-empty, .yf-loading, .yf-error-page, .yf-terminal (404)
src/js/*.js               one IIFE per behaviour, each registers on window.yf
src/fonts/                Inter (variable, plus italic), JetBrains Mono, with their OFL licences
src/icons/                yf-icons.svg (Phosphor Regular subset) and its licence
docs/index.html           live docs, built with yf itself
scripts/build, scripts/release
releases/vX.Y.Z/          frozen, never edited
```

## 3. Component rules

- **Tokens only:** components read tokens and never hard-code colours, sizes or durations.
- **States:** every interactive component has hover, focus-visible, active and disabled states, plus `aria-invalid` and `aria-busy` where they apply.
- **Hover:** on controls, hover changes the fill (`--yf-hover`). The primary button eases a step toward paper (85% ink) and never flips. Links underline and invert on hover, as on yoanfaure.com.
- **Focus:** a 2px ink outline with a 2px offset everywhere, except text fields, where focus thickens their own border to 2px ink.
- **Status:** status is always text plus form (label, icon or glyph), never colour alone.
- **One primary:** at most one primary button per view.
- **Shadows:** none, except overlays (`--yf-shadow-overlay`).
- **Copy:** sentence case, plain and precise, verb-first actions, no exclamation marks.
