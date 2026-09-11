# Repository Guidelines

## Project Overview

ANTIKYTHERA is a static, instrument-shaped portfolio and Markdown archive. There is no framework, package manifest, build step, server application, or generated output. Browser code derives the dial, ledger, reader metadata, sigils, filters, and cross-links from `content/manifest.json` and frontmatter in `content/*.md`.

Treat repository Markdown as trusted authored content: entry bodies are rendered with `marked` and inserted as HTML without sanitization. Do not extend that trust to user-supplied input.

## Architecture & Data Flow

`index.html` is the permanent shell and loads classic deferred scripts in dependency order: CDN-hosted `marked@12.0.2`, `sigil.js`, `ambient.js`, then `app.js`.

1. `app.js` waits for `window.marked` and `window.Sigil`.
2. `loadAll()` fetches `content/manifest.json`, then all listed Markdown files concurrently with `Promise.all`.
3. `parseFrontmatter()` parses the repository's intentionally limited YAML-like format. Entries are enriched with sphere radius, date-derived angle, and relationship indexes.
4. The hash router replaces `#view` and wires route-specific behavior:
   - `#/` → dial
   - `#/index` → searchable/filterable ledger
   - `#/e/<slug>` → Markdown reader
   - `#/operator` → operator page
5. `sigil.js` exposes deterministic glyph generation as `window.Sigil`. `ambient.js` independently manages dust, reticle, clock, and theme behavior through optional `window.Ambient`.

Mutable application state is intentionally local: the `state` object in `app.js` owns loaded content, indexes, dial selection/rotation, routing, and animation handles; `ledger` owns index controls. There is no backend, persistence layer, event bus, or dependency-injection container. Dependencies are browser globals and stable DOM IDs.

Ordering has distinct meanings: `manifest.entries` controls loading and angular placement, `loadAll()` sorts entries newest-first for reader navigation, and dial stepping sorts by angular position. Do not assume one canonical order.

## Key Directories

- `content/` — production Markdown records plus the authoritative `manifest.json`; this live corpus is also validator input.
- `assets/` — reader plate images referenced by frontmatter paths.
- `tools/` — dependency-free Node maintenance tools; currently the content validator.
- `.github/workflows/` — CI configuration; currently content validation only.

## Development Commands

```bash
# Serve the static site at http://localhost:3000
npx serve . -l 3000 --single

# Required content/build gate
node tools/validate-content.mjs

# Optional manual production deployment
vercel deploy --prod
```

There is no install, build, lint, format, type-check, or automated test command. Reload the browser after source or content changes; no rebuild is needed.

## Code Conventions & Common Patterns

- Browser JavaScript (`app.js`, `sigil.js`, `ambient.js`): strict-mode IIFEs, two-space indentation, single quotes, `var`, lower-camel-case named functions, and uppercase constants. Preserve classic-script compatibility; do not introduce imports, classes, TypeScript, or a bundler without a repository-wide architectural change.
- Node tooling (`tools/*.mjs`): ESM, Node built-ins, `const`/`let`, and dependency-free execution.
- Naming communicates lifecycle: `viewX` replaces a route, `paintX`/`renderX` updates part of a view, and `wireX` installs interactions. CSS uses kebab-case semantic classes and existing component prefixes such as `d-`, `ro-`, `res-`, and `op-`.
- Reuse tokens in `style.css` (`--text-*`, `--space-*`, `--color-*`, `--radius-*`, and motion variables) rather than adding isolated values. Preserve both `[data-theme="umbra"]` and `[data-theme="vellum"]` behavior.
- Views build HTML strings, assign `innerHTML`, then query within the rendered subtree to attach handlers. Escape interpolated metadata with `esc()` and normalize scalar/list fields with `list()`.
- Preserve accessibility behavior: semantic labels and roles, keyboard equivalents, `aria-current`/`aria-pressed`/`aria-sort`, focus-visible styles, and reduced-motion handling.
- Async browser work uses native Promise chains. Check `Response.ok`, throw contextual errors, and route startup failures to `fatal()`. Route changes must cancel active animation frames and detach route-specific listeners.
- Optional broken relationships are filtered out rather than rendered. Missing routes use `view404()`; manifest/content load failures use the global fatal view and retain `console.error` diagnostics.
- Keep shared globals narrow. Helper scripts should expose one explicit object, following `window.Sigil` and `window.Ambient`, rather than adding scattered global functions.

### Content Pattern

Adding an entry requires both `content/<slug>.md` and `"<slug>.md"` in `content/manifest.json`. The slug must match the filename; choose a unique integer `sigil` because equal seeds generate equal glyphs.

Frontmatter is not general YAML. It must be bounded by `---` and contain only single-line `key: value` records. Arrays use inline syntax such as `[local-first, javascript]`; multiline values and indentation are discarded by the runtime parser. Required fields and accepted enums are enforced by `tools/validate-content.mjs`; update that validator and `app.js` together if parser behavior changes because their parsers are duplicated by design.

Use `MEC-000`, `EPH-000`, or `MNE-000` designation patterns for `mechane`, `ephemeris`, or `mnemosyne`; use ISO dates and lowercase hyphenated tags. `content/manifest.json` remains authoritative for sphere IDs/radii and entry membership.

## Important Files

- `index.html` — browser entry point, stable DOM shell, stylesheet order, and external runtime dependencies.
- `app.js` — composition root, frontmatter parser, content loader, central state, all views, and hash router.
- `sigil.js` — seeded procedural SVG API.
- `ambient.js` — theme and atmospheric interaction state.
- `base.css` — reset, baseline accessibility, and reduced-motion rules.
- `style.css` — design tokens, themes, components, animations, and responsive behavior.
- `content/manifest.json` — operator metadata, sphere definitions/radii, and ordered entry inventory.
- `tools/validate-content.mjs` — executable authority for accepted content and CI exit behavior.
- `.github/workflows/validate.yml` — actual CI runtime, triggers, and command.
- `README.md` — human-facing authority for routes, content schema, local use, and deployment.

## Runtime/Tooling Preferences

The deployed application requires only a modern browser and a static host. CI runs the validator on Node.js 20. No local Node version or package manager is formally pinned; `npx` is used only for the documented development server. Avoid adding local dependencies when browser APIs or Node built-ins fit the existing design.

The page has external runtime dependencies despite having no installed project dependencies: `marked@12.0.2` from jsDelivr and fonts from Fontshare/Google Fonts. Keep script load order intact. Vercel integration is configured outside the repository; no `vercel.json` or deployment workflow exists here.

## Testing & QA

`node tools/validate-content.mjs` is the sole automated QA gate and the effective compile step. It validates the live `content/*.md` corpus, cross-entry relationships, unique designations/sigil seeds, referenced assets, and bidirectional manifest membership. It emits errors and warnings; only errors produce exit code 1. CI runs it on pushes to `main`, pull requests, and manual dispatch.

No unit, DOM, end-to-end, accessibility, or visual test suite exists, and no coverage threshold is configured. For UI or routing changes, also serve the actual site and smoke-test the affected hash routes, keyboard/pointer interaction, both themes, and reduced-motion behavior as applicable. For content changes, open the new or changed entry after validation; validation cannot prove rendered Markdown or layout quality.

When changing frontmatter parsing or validation, preserve runtime/validator parity and exercise malformed as well as valid input. The README's phrase “fails the build” is broader than actual behavior: unknown fields, duplicate tags/resonance targets, and some orphaned optional fields are warnings only. Treat `tools/validate-content.mjs` exit semantics as authoritative.
