# Roadmap

Version plan from the current `0.1.0` baseline to a `1.0.0` that ships the full feature set. Each
release carries one theme so the version number means something beyond "several things changed".

* Feature requirements are `FR-nn` in `PRD.md` §4; the versioning policy is in `CHANGELOG.md`.
* File and line references were verified against `src/` on 2026-09-24.
* Engine facts were verified against the installed `pdfjs-dist@5.7.284` type declarations.
* The measurements in "The tier decision" come from a purpose-built prototype library and from the
  real `dist/`, bundled with both esbuild and Rollup.

## Where we are

`FR-01`–`FR-19` are implemented, tested and browser-verified. `FR-20` is **not** complete: download
offers the original bytes or a pdf.js incremental save, and `src/headless/usePdfDownload.ts:16-21`
states that this is "not a true flatten (flattening needs a PDF writer, which this library is not)".
That sentence is what forces the writer subpath in `0.7`.

`FR-21`–`FR-23` were added on 2026-09-24 alongside the tier decision below.

## What the engine gives us for free

Before planning against the feature list, `node_modules/pdfjs-dist/types` was checked rather than
assumed. `pdfjs-dist@5.7.284` exports:

| Export | Unblocks |
| --- | --- |
| `AnnotationEditorLayer`, `AnnotationEditorUIManager`, `AnnotationEditorType` (`FREETEXT`, `HIGHLIGHT`, `STAMP`, `INK`, `POPUP`, `SIGNATURE`, `COMMENT`) | Annotation authoring without third-party code — `PdfPage.tsx:224` currently passes `annotationEditorUIManager: null` |
| `XfaLayer`, `enableXfa`, `getXfaPageViewport` | XFA **rendering** (persistence stays impossible, see PRD §2) |
| `SignatureExtractor`, `SupportedImageMimeTypes`, `DrawLayer`, `TextLayerImages`, `renderRichText` | Signature and image/stamp annotations, rich-text free text |
| `TouchManager` (`onPinchStart` / `onPinching` / `onPinchEnd`) | Pinch zoom instead of hand-written gesture math |
| `OutputScale.capPixels(maxPixels, capAreaFactor)`, `FeatureTest` | Canvas-area capping. `FeatureTest` exposes **no** canvas-size probe, so the cap must be measured here and fed to `capPixels` |

`saveDocument(): Promise<Uint8Array>` (`types/src/display/api.d.ts:1072`) and the `annotationStorage`
getter (`:860`) exist, but which editor types actually survive into those bytes is unmeasured — see
Spike A.

**Engine bytes are fixed.** Every class above already sits inside the single `pdf.min.mjs`
(168 kB gz) plus `pdf.worker.min.mjs` (364 kB gz). Enabling annotation editing adds no engine
weight, and no feature gating can reduce it. Our own shell is 37 kB gz against that 532 kB
baseline, so tiering is about the seam for what arrives in `0.6` and `0.7`, not about a dramatic
saving today.

## The tier decision (measured, not assumed)

The library will offer **one package with opt-in features**, not two products. Consumers name the
features they want in their import list, so unused features never enter the module graph.

A prototype library with the same `tsup` config, `sideEffects: ["**/*.css"]` flag and `exports` map
was built and measured in two bundlers. A unique string literal inside each feature's rendered
output marked whether that feature survived bundling.

| Consumer import style | esbuild | Rollup | print code | search code |
| --- | --- | --- | --- | --- |
| core only | 0.25 kB | 0.25 kB | absent | absent |
| core + print, subpath | 0.70 kB | 0.78 kB | present | absent |
| core + print, same entry (named export) | 0.70 kB | 0.78 kB | present | absent |
| **prop-based, both features disabled** | **1.07 kB** | **1.17 kB** | **present** | **present** |
| core + print + search | 1.08 kB | 1.17 kB | present | present |

Disabling features by prop saved nothing (1.07 kB vs 1.08 kB full); opting in gave a 4.3× smaller
bundle. Named exports tree-shake as well as subpaths do, so subpaths are a discoverability choice
rather than a requirement. tsup hoisted shared code into three chunks and both bundlers still dropped
the unused feature, so code splitting does not defeat this.

Measured against the **real** `dist/` today:

| Consumer | Size gz | Contains the print pipeline |
| --- | --- | --- |
| `PdfViewer` with `enablePrint={false} enableDownload={false} renderForms={false}` | 18.4 kB | **yes** |
| `import { usePdfDocument } from 'pdfjs-react-reader'` | 1.7 kB | no |
| `import { usePdfDocument } from 'pdfjs-react-reader/headless'` | 1.4 kB | no |

Headless imports already tree-shake well; the monolithic shell at `src/components/PdfViewer.tsx:1-22`
is the only real offender.

### Two hard constraints, both discovered the hard way

1. **A feature must contribute a component, never a hook called by the shell.** A prototype shell
   that ran `useState` once per feature threw, on the first change to the feature list:
   `Rendered fewer hooks than expected.` Each feature therefore supplies a `Runner` component that
   owns its hooks, and the shell mounts one per feature.
2. **Those Runners must be keyed by `feature.id`, not by array index.** Toggling off an unrelated
   sibling feature, identical code except the key:

   | | keyed by `id` | keyed by `index` |
   | --- | --- | --- |
   | after 2 interactions | mount 1, count 2 | mount 1, count 2 |
   | sibling dropped | mount 1, **count 2** | **mount 2, count 0** |
   | sibling restored | mount 1, count 2 | mount 3, count 0 |

   The index-keyed version fails silently — no error, just a lost search query. `id` keying also
   survived a freshly created `features` array on every render, which is the ordinary case.

Both behaviours need a regression test, because neither failure announces itself.

## Feature coverage map

Every requested feature, and the release that ships it.

| Feature | Release | Notes |
| --- | --- | --- |
| Multiple viewing modes | `0.1` done | continuous / single / spread (`lib/layout.ts`) |
| Direct pdf.js API access, TypeScript | `0.1` done | re-exports extended in `0.6` |
| Zoom control, pinch zoom | `0.2` | wraps engine `TouchManager`; `ZOOM_LEVELS` is 0.25–5 today |
| Drag-and-drop loading | `0.2` | `lib/source.ts` already accepts `File`/`Blob`/`Uint8Array` |
| Fullscreen | `0.2` | zero `requestFullscreen` in the repo today |
| Accessibility | `0.2`, `0.6`, `0.8` | keyboard → annotation access → audit |
| Internationalization | `0.2` API, `0.8` locales | ~75 hardcoded strings, 43 in `Toolbar.tsx` |
| Advanced JS API | `0.2`, `0.5`, `0.6` | handle + events → find controller → popups |
| Mobile optimization | `0.2`, `0.8` | gestures, then the real-device matrix |
| **Basic vs full bundle weight** | **`0.4`** | opt-in features; core shell 5.6 kB gz measured |
| High-resolution rendering | `0.3` | capability detection; `PdfViewer` never forwards `devicePixelRatio` today |
| Performance | `0.3` | canvas caps; virtualization and canvas zeroing already done |
| Security / CSP | `0.3` | cMaps + fonts default to unpkg (`usePdfDocument.ts:41-42`) |
| Customizable toolbar and UI | `0.5` | falls out of feature-as-data from `0.4` |
| Rich sidebar | `0.5` | 2 tabs today; `executeSetOCGState()` is a no-op (`lib/link-service.ts:73`) |
| Advanced search | `0.5` | case + whole-word + highlight-all exist; regex and multi-term do not |
| PDF annotation and editing | `0.6` create, `0.7` persist | |
| Comprehensive form support (AcroForm + XFA) | `0.6` renders XFA | XFA persistence excluded permanently |
| Page reordering | `0.7` | needs a PDF writer |

## Releases

### 0.1.0 — baseline publish
Publish what exists. Housekeeping first: `npm login` then `npm publish`, a `main` branch ruleset
requiring the two `Verify` checks, and repository topics.

### 0.2.0 — Reach: control the viewer from outside
No new dependencies.

* `forwardRef` + imperative handle: `goToPage`, `zoomTo`, `zoomBy`, `fitTo`, `setLayout`, `rotate`,
  `openSidebar`, `requestFullscreen`, `search`. The component is not `forwardRef` today and exposes
  no handle.
* Events: `onPageChange`, `onScaleChange`, `onLayoutChange`, `onFullscreenChange`. `onExternalLink`
  is defined at `lib/link-service.ts:28` and never wired by `PdfViewer`.
* Drag-and-drop file loading, plus an `acceptDrop` escape hatch.
* Fullscreen via the Fullscreen API, with a toolbar control and an `F` shortcut.
* Keyboard page navigation — arrows, PageUp/PageDown, Home/End. `handleViewerKeyDown` currently
  maps only Ctrl/Cmd+F and Ctrl/Cmd+P.
* Wheel zoom and pinch zoom wrapping `TouchManager` behind our own interface — its published
  parameter types are largely `any`, so an unguarded dependency breaks on a pdf.js minor.
* `labels` prop with a typed English default. Must precede `0.5`, or every new toolbar and sidebar
  string gets extracted twice.
* Arbitrary zoom entry, closing the literal FR-06 wording, and per-page rotation, closing FR-09's
  ("per-page or globally" — only global exists).

### 0.3.0 — Trust: stop it failing in production
No new dependencies.

* Measure maximum canvas area and side at boot, feed them through `OutputScale.capPixels`, expose
  `maxRenderPixels`, adapt dpr at high zoom, and forward `devicePixelRatio` from `PdfViewer` — today
  read per page (`PdfPage.tsx:138`) with no ceiling, and `PdfPage`'s existing `devicePixelRatio` prop
  is never passed by the shell.
* `assetUrl: 'cdn' | 'local' | URL` for cMaps and standard fonts, replacing the unpkg defaults at
  `usePdfDocument.ts:41-42`, plus a CSP section in the docs.
* Document-source allowlist, and a fix for `lib/source.ts:6-29`, which treats any unrecognized string
  as a URL.
* Optional Trusted Types policy.
* Surface form capability (`doc.isXFA`) so XFA reports itself instead of rendering nothing silently.

### 0.4.0 — Tiers: opt-in features (FR-21, FR-22, FR-23)
No new dependencies. This is the architecture seam; see "The tier decision" above for its evidence.

* Core `PdfViewer` stops importing features. It keeps document loading, virtualization, page layers,
  zoom, navigation, rotation, layout modes and text selection — measured at 5.6 kB gz assembled.
* `PdfFeature` contract: `{ id, Runner?, panel?, controls?, keys? }`. A feature's hooks live inside
  its `Runner` component, never in the shell body.
* Runners keyed by `feature.id`. Add the regression test that drops a sibling feature and asserts the
  surviving feature's state persists — the index-keyed failure is silent.
* `features` prop replaces `enablePrint`, `enableDownload` and `renderForms`, which become features.
  **This is the release's one breaking change**, and it is why the work sits at `0.4` rather than
  after `1.0`.
* Per-feature CSS so `styles.css` (8.8 kB gz, largely comments) is no longer all-or-nothing, and
  minify it in `scripts/copy-assets.mjs`.
* `scripts/check-size.mjs` measures per tier — core ≤ 8 kB gz, any single feature ≤ 4 kB — and
  **asserts the built core output contains no feature marker string**, so a reintroduced static
  import fails CI instead of quietly making "basic" heavy again.

### 0.5.0 — Compose: make the shell configurable
No new dependencies.

* Toolbar layout API: ordered controls, per-control opt-out, consumer-set priorities, named slots.
  `0.4` already turned controls into data, so this replaces the hardcoded priorities at
  `Toolbar.tsx:213,318,336,382,491` rather than introducing them.
* Compound components (`PdfViewer.Root` / `.Toolbar` / `.Page` / layers), which PRD §2 already lists
  as a goal.
* Sidebar attachments tab (`getAttachments`) and layers/OCG tab, implementing the `setOCGState` no-op.
* Search depth: regex (the query is escaped to a literal at `lib/search.ts:107` today), multiple
  terms, an all-match count, exposed per-page counts, a replaceable find controller.

### 0.6.0 — Mark: annotation authoring
No new dependencies. Gated on Spike A.

* Wire `AnnotationEditorLayer` + `AnnotationEditorUIManager` into `PdfPage`, replacing the two `null`s
  at `PdfPage.tsx:224-226`: highlight, underline, strikeout, squiggly, free text, ink, stamp, image
  stamp and drawn signature.
* Create, select, move, resize and **delete** annotations, including pre-existing ones.
* Interactive popups — `.popupAnnotation` is `pointer-events: none` today (`styles/viewer.css:603-628`).
* `enableXfa: true` and `XfaLayer` so XFA documents display at all.
* `onAnnotationChange` events, plus re-export of the editor classes from `/headless`.
* Annotation keyboard accessibility.
* Ships as a **feature from `0.4`**, not shell code, so apps that never annotate don't pay for it.

### 0.7.0 — Edit: writing the engine cannot do
The only release that touches the zero-dependency rule.

* New export `pdfjs-react-reader/edit`, with the PDF writer as an **optional peer** so the core stays
  dependency-free; `check-size.mjs` gains a measured path for it (Spike B decides the candidate).
* True flattening, which completes FR-20.
* Page reorder, delete, extract and split by dragging thumbnails, with undo.
* Rotation and ink written into the saved document instead of living in view state.

### 0.8.0 — Freeze: hardening
* Real-device matrix: iOS Safari 14 and 15, where the `:has()` fallback for container queries is
  written but has never been measured on any Safari, plus Android Chrome.
* Shipped locale catalog; text layer `TextLayer.update()` instead of a full rebuild.
* One docs example per public API, including each tier combination; an upgrade guide; an
  API-freeze review.

### 1.0.0 — GA
All `FR-01`–`FR-23` genuinely green, every feature-list row either shipped or documented as an
explicit exclusion, and strict semver from then on.

## Spikes and gates

* **Spike A — before `0.6` closes.** For each editor type: create an annotation, call
  `saveDocument()`, diff the bytes. Decides which types `0.6` may honestly ship as persistent and
  which must wait for `0.7`. Form fields already survive; editors are newer machinery, so expect a
  partial result.
* **Spike B — before `0.7` closes.** Compare candidate writers on size, ESM quality and maintenance,
  and confirm one works as an optional peer the core build never imports.
* Sequencing: `0.2`'s `labels` gates `0.5` (no double string extraction); `0.3` gates `0.6` (an
  editor layer at high zoom is exactly where an uncapped canvas fails); **`0.4` gates `0.5` and
  `0.6`** (toolbar controls become data, and heavy features need a seam to attach to); `0.7` gates
  any further structure work.

## Fixtures we do not have

`playground/fixtures/` holds form, outline and encrypted PDFs. Later releases additionally need: an
XFA document, a pre-annotated PDF (to exercise editing and deleting existing annotations), a document
with attachments and optional content groups, a signature-bearing form, and a 20-page PDF for
reorder. These should come from generator scripts like the existing `scripts/make-*-pdf.mjs`, not
downloads.

## Policy conflicts to resolve

* **Peer floor.** Resolved for the engine major in `0.1.2`: the range is now `^5.0.0 || ^6.2.108`,
  the floor being set by CVE-2026-16633 (`>= 5.6.83, < 6.2.108`, no 5.x patched) rather than by our
  own API usage. **Still open for `0.6`:** the editor classes live under `display/editor/*` and
  `AnnotationEditorType.SIGNATURE` / `TextLayerImages` are recent additions, so `0.6` needs the floor
  raised to whatever version introduced them — a breaking peer change, which the CHANGELOG policy
  says to announce loudly even at `0.x`. Note the security floor and the feature floor may end up
  demanding different things, in which case dropping v5 entirely becomes the cleaner answer.
* **v6 runtime coverage.** `0.1.2` verified 6.3.289 by hand in a browser and the CI `consumer` job now
  builds the packed tarball against `^5` and `^6.2.108`. That coverage must be kept: every later
  release should pass on both, and `0.7`'s writer work should be measured on 6.x, not 5.7.284.
* **Breaking `0.4` props.** `enablePrint` / `enableDownload` / `renderForms` change meaning when they
  become features. Permitted pre-1.0, but it must be one deliberate release with a changelog entry,
  not an incidental fallout of a refactor.
* **Changing the unpkg default in `0.3`** is a behavior change. `CHANGELOG.md` counts only API, CSS
  token and supported-major changes as breaking, so a default flip is arguably a minor — decide it
  deliberately rather than by accident.
