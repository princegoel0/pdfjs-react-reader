# Changelog

All notable changes to `pdfjs-react-reader` are documented in this file.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project adheres
to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.1] — unreleased

### Fixed

- **The worker could not be found in a Vite dev server.** `configureWorker` built
  `new URL('pdfjs-dist/build/pdf.worker.min.mjs', import.meta.url)` with a bare specifier. Vite
  rewrites that at build time but not while serving modules, so consumers got
  `…/pdfjs-react-reader/dist/pdfjs-dist/build/pdf.worker.min.mjs` and a 404, and pdf.js's own
  fallback then fetched the same dead URL because we had assigned it. The lookup now probes a
  bundler-relative specifier first, then the bare one (still needed where the package source is
  bundled directly, as the docs site does), and assigns whichever answers. Nothing is assigned when
  neither does, so pdf.js can fall back, and the load error names `workerSrc` as the remedy.
  Verified against the installed tarball in Vite dev and in a production build.
- **`import 'pdfjs-react-reader/styles.css'` failed to typecheck** under TypeScript 5.6+ (TS2882)
  for any consumer without a `*.css` module declaration of its own. The `./styles.css` export now
  carries a shipped declaration.

### Added

- `ensureWorker` and `workerAutoDetectionFailed`, exported from both entry points.
- A `consumer` CI job that installs the packed tarball into a throwaway Vite app and typechecks and
  builds it. Every other job resolves `pdfjs-react-reader` to this repository's own source through
  `tsconfig.json` `paths` and the docs alias, which is exactly why a broken published artifact passed
  CI: the guard had never once looked at the tarball.

## [0.1.0] — 2026-09-23

Initial release. Feature-complete against the project brief and browser-verified; published to npm on
2026-09-24 as `0.1.0`, tagged at `35261ce`.

Two things in this release were later corrected: it needs `workerSrc` to be passed explicitly in a
Vite dev server (fixed in `0.1.1`), and it ships no CSS type declaration (also `0.1.1`). Nothing else
about the artifact is affected — an installed `0.1.0` builds and renders correctly in production.

### Added

**Rendering engine**

- `usePdfDocument` — document loading with worker auto-resolution, encrypted-document callback,
  CMap/standard-font overrides, and `reload()`.
- `usePdfVirtualizer` — a custom virtualizer (no `react-window`) that groups pages into rows, keeps
  only the rows crossing the viewport mounted, and clears off-screen canvas buffers so long
  documents survive mobile Safari.
- `PdfPage` — the layer stack for one page: HiDPI canvas, selectable `TextLayer`, `AnnotationLayer`,
  and the ink overlay, each with correct cancellation and cleanup on scale/rotation change.
- Layout modes: continuous, single page, and two-page spread. Fit-width and fit-page zoom, with
  fit-width accounting for the inter-page gap.
- Rotation, zoom stepping through 16 levels, and page navigation by number.

**Text and search**

- Whole-document search (`usePdfSearch`) with a per-document text cache, a 200 ms debounce, an
  Enter-to-flush, cancellation of stale runs, and case / whole-word options.
- In-place `<mark>` highlighting that does not rebuild the text layer, so a selection survives a
  search.
- A distinct error state, so a failed search is never reported as "No results".

**Navigation**

- `usePdfOutline` with correct destination resolution for numeric, object-reference and named
  destinations.
- Lazy thumbnails (`PdfThumbnail`, `ThumbnailList`) that render on approach and clear off-screen, in
  a fluid 1- or 2-up grid.
- `Sidebar` with Thumbnails/Outline tabs, roving tabindex, arrow-key tab switching, and an
  overlaying layout on narrow screens.

**Forms and annotations**

- AcroForm widget support (`src/lib/form.ts`, `usePdfFormValues`): text, checkbox, radio, choice and
  push buttons, with per-widget commit events, `getFormData`/`setFormData`/`reset`, and dirty
  tracking.
- Freehand ink (`usePdfInk`, `InkLayer`) stored in PDF user space so zoom and rotation both map
  correctly; the in-flight stroke is painted imperatively to keep React out of the pointer loop.
- Link annotations and widget-triggered navigation through a minimal `PDFLinkService`
  implementation.

**Document actions**

- Full-document printing (`usePdfPrint`): render at print intent with stored form values and ink,
  resolution chosen from a canvas memory budget, cancellable with progress, and torn down after the
  dialog closes. Disabled on iOS Safari, which prints the top document instead.
- Download (`usePdfDownload`) of the original bytes, or an incremental `saveDocument()` carrying
  form edits.
- A built-in password prompt for encrypted documents, replaced automatically if the host supplies
  `onPasswordRequired`.

**Shell and theming**

- `PdfViewer` — the drop-in component wiring all of the above, plus `Toolbar`, `SearchBox`,
  `Sidebar`, `ThumbnailList`, `OutlineView`, `InkLayer` and `PasswordPrompt` exported individually
  for custom composition.
- A plain-CSS theme driven by `--pjsr-*` custom properties, with no CSS-in-JS and no build-time
  theme step.
- A measured, priority-ordered responsive toolbar: each control carries a priority, natural widths
  are measured, and the least useful control folds into the overflow menu as space runs out.
  Control *size* follows the input device — 44 px under `(pointer: coarse)`, 32 px with a mouse.
- Keyboard shortcuts scoped to the viewer instance, a focusable page region, `aria-live` match
  count, `role="alert"` failures, a retry affordance, and `prefers-reduced-motion` support.

**Tooling**

- Two entry points (`.` and `/headless`) plus `/styles.css`, ESM-only, tree-shakeable, with
  generated TypeScript declarations.
- A playground app, a documentation site with live examples, generated fixture PDFs (AcroForm,
  outline with named destinations, RC4-encrypted), a bundle-size budget gate, and GitHub Actions CI.

### Decisions

- **`pdfjs-dist` is pinned to `^5.0.0`.** An earlier range of `^4.2.67 || ^5.0.0` was never
  achievable: 4.2.67 does not export `TextLayer`, and no v4 release reads a `canvas` render
  parameter — v4's `render()` derives the target from `canvasContext.canvas`, so passing `canvas`
  would render a blank page rather than fail loudly. Supporting v4 needs an engine-detection shim,
  and printing additionally depends on v5-only `printAnnotationStorage` behaviour.
- **React `^18 || ^19`.** Verified on 18.3.1 and 19.3.0. `usePdfVirtualizer`'s `containerRef` is
  typed structurally (`PdfViewportRef`) because `@types/react` 18 and 19 disagree on the shape a
  `ref` prop accepts; naming either version's `RefObject` would force consumers to cast.
- **No `@page` CSS rule** in the print styles, so the library cannot interfere with the host
  application's own printing.

### Known limitations

- Printing is unavailable on iOS Safari by design; `usePdfPrint().supported` reports `false` there.
- `saveDocument()` produces an editable form (an incremental update), not a flattened PDF.
- The text layer is rebuilt rather than patched when scale or rotation changes; `TextLayer.update()`
  is unused.
- Freehand ink lives in React state and is rasterised into print output, but it is not written back
  into the PDF file, so a downloaded document does not carry the strokes.

## Development log

The phases below were built in one unreleased cycle, so they are a build history rather than a list
of published versions.

| Date | Milestone |
| --- | --- |
| 2026-09-22 | Project brief agreed; nine-phase plan set. Scaffolding, tsup ESM build, subpath exports. |
| 2026-09-22 | Engine MVP: document loading, worker resolution, custom virtualizer, canvas pages, zoom, navigation. |
| 2026-09-22 | Theme moved to a soft modern light palette with `--pjsr-*` tokens; first overflow menu. |
| 2026-09-22 | Text layer and selection, pixel-aligned at fit-width and 150%. |
| 2026-09-22 | Whole-document search: text index, debounced hook, in-place highlighting. |
| 2026-09-23 | Outline, thumbnails, sidebar, rotation controls and layout modes. |
| 2026-09-23 | AcroForm widgets, annotation layer, link service, freehand ink. |
| 2026-09-23 | UI/UX audit and remediation: 14 findings, icon family unified, event scoping, `useId`. |
| 2026-09-23 | Density and responsive audit: container queries, fluid thumbnail grid, five folding tiers. |
| 2026-09-23 | Printing pipeline, download, and the built-in password prompt. |
| 2026-09-23 | Toolbar rebuilt on measured priority overflow; control sizing keyed to pointer type. |
| 2026-09-23 | Documentation site, CI with a size budget, licence and README. |
| 2026-09-23 | Compatibility verified against React 18 and 19; `pdfjs-dist` range corrected to `^5`. |

## Versioning policy

- **MAJOR** — a breaking change to the public API, the CSS class names or tokens, or the removal of
  a supported `pdfjs-dist` or React major.
- **MINOR** — new components, hooks, props or tokens, backwards compatible.
- **PATCH** — bug fixes and compatibility work with no API change.
- A new `pdfjs-dist` major is supported in a minor release when it needs no API change here, and is
  announced in this file. Dropping a major that is still under the React/pdfjs-dist support window
  is a breaking change and takes a major.
- During `0.x` a **MINOR may break** the public API, and does so only as a deliberate, single-release
  change announced at the top of its entry here. `0.4.0` is reserved for exactly that: `enablePrint`,
  `enableDownload` and `renderForms` become opt-in features (`PRD.md` FR-21), because a prop cannot
  remove code from a bundle while an import can.
- Size budgets are **per tier**, not one global ceiling: core viewer ≤ 8 kB gzipped, any single
  feature ≤ 4 kB, full viewer ≤ 45 kB, all excluding `pdfjs-dist`. CI also asserts the built core
  artifact contains no feature code, so a regression in the tier boundary fails the build rather than
  quietly shipping (`PRD.md` FR-23).
- The `docs/` site documents the latest release; older API shapes are described by the matching git
  tag rather than maintained as separate sites.

## How to pick a version

1. Install the same major of `pdfjs-dist` you already use — this package requires `^5.0.0`.
2. React 18 or 19 both work; nothing else is required at runtime.
3. Pin an exact version in an application (`pdfjs-react-reader` `0.1.0`, not `^0.1.0`) until 1.0.0,
   because 0.x minor releases may include breaking changes.
