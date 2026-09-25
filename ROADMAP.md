# Roadmap

Version plan from the current `0.1.0` baseline to a `1.0.0` that ships the full feature set. Each
release carries one theme so the version number means something beyond "several things changed".

* Feature requirements are `FR-nn` in `PRD.md` §4; the versioning policy is in `CHANGELOG.md`.
* File and line references were verified against `src/` on 2026-09-24, and re-checked against `src/`
  on 2026-09-25 after `0.4` moved code out of the shell.
* Engine facts were verified against the installed `pdfjs-dist@5.7.284` type declarations.
* The measurements in "The tier decision" come from a purpose-built prototype library and from the
  real `dist/`, bundled with both esbuild and Rollup. The "before" figures were taken against `0.3`'s
  `dist/` and the "after" figures against `0.4`'s; the per-path numbers each release accepts are the
  ones in `size-baseline.json` and its git history.

## Where we are

`FR-01`–`FR-19` and `FR-21`–`FR-23` are implemented, tested and browser-verified. `FR-20` is **not**
complete: download offers the original bytes or a pdf.js incremental save, and
`src/headless/usePdfDownload.ts:13-19`
states that this is "not a true flatten (flattening needs a PDF writer, which this library is not)".
That sentence is what forces the writer subpath in `0.7`.

`FR-21`–`FR-23` were added on 2026-09-24 alongside the tier decision below and shipped in `0.4` on
2026-09-25.

## What the engine gives us for free

Before planning against the feature list, `node_modules/pdfjs-dist/types` was checked rather than
assumed. `pdfjs-dist@5.7.284` exports:

| Export | Unblocks |
| --- | --- |
| `AnnotationEditorLayer`, `AnnotationEditorUIManager`, `AnnotationEditorType` (`FREETEXT`, `HIGHLIGHT`, `STAMP`, `INK`, `POPUP`, `SIGNATURE`, `COMMENT`) | Annotation authoring without third-party code — `PdfPage.tsx:246` currently passes `annotationEditorUIManager: null` |
| `XfaLayer`, `enableXfa`, `getXfaPageViewport` | XFA **rendering** (persistence stays impossible, see PRD §2) |
| `SignatureExtractor`, `SupportedImageMimeTypes`, `DrawLayer`, `TextLayerImages`, `renderRichText` | Signature and image/stamp annotations, rich-text free text |
| `TouchManager` (`onPinchStart` / `onPinching` / `onPinchEnd`) | Pinch zoom instead of hand-written gesture math |
| `OutputScale.capPixels(maxPixels, capAreaFactor)`, `FeatureTest` | Canvas-area capping. `FeatureTest` exposes **no** canvas-size probe, so the cap must be measured here and fed to `capPixels` |

`saveDocument(): Promise<Uint8Array>` (`types/src/display/api.d.ts:1072`) and the `annotationStorage`
getter (`:860`) exist, but which editor types actually survive into those bytes is unmeasured — see
Spike A.

**Engine bytes are fixed.** Every class above already sits inside the single `pdf.min.mjs`
(168 kB gz) plus `pdf.worker.min.mjs` (364 kB gz). Enabling annotation editing adds no engine
weight, and no feature gating can reduce it. Our own shell measured 45.45 kB gz against that 532 kB
baseline in `0.3`; after `0.4` the same entry sums to 44.01 kB, and one consumer import of
`PdfViewer` bundles to 20.61 kB. That gap is the point of the release, and it is what the `0.6`
editors and the `0.7` writer will attach to rather than add to.

## The tier decision (measured, not assumed)

The library offers **one package with opt-in features**, not two products. Consumers name the
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

Confirmed against the **real** `dist/` on `0.3`, before any of this existed:

| Consumer (`0.3` `dist/`) | Size gz | Contained the print pipeline |
| --- | --- | --- |
| `PdfViewer` with `enablePrint={false} enableDownload={false} renderForms={false}` | 18.4 kB | **yes** |
| `import { usePdfDocument } from 'pdfjs-react-reader'` | 1.7 kB | no |
| `import { usePdfDocument } from 'pdfjs-react-reader/headless'` | 1.4 kB | no |

Headless imports already tree-shook well; the monolithic shell at `src/components/PdfViewer.tsx` was
the only real offender, and prop values were invisible to the bundler. The same consumer file on
`0.4` measures **20.61 kB containing no print, download, forms or outline code** — against 18.4 kB
that carried all of it. Read the pair honestly: the seam worked (the pipelines left the core's
reachable graph, which the gate now asserts by marker rather than by total), and the core got
*bigger*, 2.2 kB of it, because the feature host, the sidebar's dynamic tabs and the toolbar's
feature grouping arrived with the seam and `0.4` also split `dist` into ten chunks instead of
`0.3`'s fewer. The two were not separated, so no claim is made here about what the plumbing alone
costs. What `0.4` buys is the boundary `0.6` and `0.7` land behind, not a smaller bundle today —
which is what the prototype row above already said, in miniature.

Per tier, on the shipped build:

| Consumer import (`0.4` `dist/`) | Size gz | Over core |
| --- | --- | --- |
| `PdfViewer` | 20.61 kB | — |
| `+ printFeature` | 22.63 kB | +2.02 kB |
| `+ downloadFeature` | 21.47 kB | +0.86 kB |
| `+ formsFeature` | 22.60 kB | +1.99 kB |
| `+ outlineFeature` | 21.54 kB | +0.93 kB |
| `+ all four` | 25.79 kB | +5.18 kB |

Each row is the worse of esbuild and Rollup, and each is also asserted the other way: the hook a
feature wraps (`usePdfPrint`, `usePdfDownload`, `usePdfFormValues`, `usePdfOutline`) is grepped out of
the core bundle and into its own, on unminified output so a rename cannot hide it. Those four names
are the markers, chosen after the spike's broader set proved unreliable — `AnnotationMode` appears in
a core bundle simply because our code imports that name from `pdfjs-dist`, so a marker has to be
something only the feature defines.

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

Both behaviours have a regression test (`src/components/FeatureHost.test.tsx`), because neither failure
announces itself. The index-keyed half is reproduced rather than asserted: two features sharing one
`Runner` component type, `[a, b]` rerendered as `[b, a]`, and the count follows slot 0 instead of `id`
— which is the remount, and the lost state. A twin host with `key={index}` carries that assertion, so
the passing `id`-keyed case above it cannot quietly be a tautology.

## Feature coverage map

Every requested feature, and the release that ships it.

| Feature | Release | Notes |
| --- | --- | --- |
| Multiple viewing modes | `0.1` done | continuous / single / spread (`lib/layout.ts`) |
| Direct pdf.js API access, TypeScript | `0.1` done | re-exports extended in `0.6` |
| Zoom control, pinch zoom | `0.2` done | wheel + engine `TouchManager` pinch; `ZOOM_LEVELS` 0.25–5, any percentage accepted |
| Drag-and-drop loading | `0.2` done | off by default; `acceptDrop` gates it, `onDropFile` always fires |
| Fullscreen | `0.2` done | webkit spellings covered, control hidden where unsupported |
| Accessibility | `0.2`, `0.6`, `0.8` | keyboard done in `0.2` → annotation access → audit |
| Internationalization | `0.2` API done, `0.8` locales | ~90 strings behind one typed catalog |
| Advanced JS API | `0.2`, `0.5`, `0.6` | handle + events done in `0.2` → find controller → popups |
| Mobile optimization | `0.2`, `0.8` | gestures done → real-device matrix |
| **Basic vs full bundle weight** | **`0.4` done** | opt-in features; core shell 20.61 kB gz bundled, each feature 0.86–2.02 kB over it |
| High-resolution rendering | `0.3` done | `devicePixelRatio` forwarded from `PdfViewer`, capped by the canvas ceilings |
| Performance | `0.3` done | canvas area/side ceilings in `lib/canvas.ts`; virtualization and canvas zeroing already done |
| Security / CSP | `0.3` done | `assetUrl` roots cMaps + fonts + wasm; `allowedSources`; opt-in Trusted Types policy |
| Customizable toolbar and UI | `0.5` | falls out of feature-as-data from `0.4` |
| Rich sidebar | `0.5` | one tab by default since `0.4` (thumbnails); outline is a feature tab, and attachments/layers still missing. `executeSetOCGState()` is a no-op (`lib/link-service.ts:73`) |
| Advanced search | `0.5` | case + whole-word + highlight-all exist; regex and multi-term do not |
| PDF annotation and editing | `0.6` create, `0.7` persist | |
| Comprehensive form support (AcroForm + XFA) | `0.6` renders XFA | XFA persistence excluded permanently |
| Page reordering | `0.7` | needs a PDF writer |

## Releases

**How these ship (decided 2026-09-25).** `0.2`–`0.9` are committed on `dev` and kept **local**; nothing
is pushed, merged to `main` or published along the way. When the sequence is done we push `dev`, tag
`1.0.0`, merge to `main`, and publish that one version. `0.1.2` is therefore never published — it is
tagged on GitHub but npm goes `0.1.1` → `1.0.0`. The accepted cost: Actions do not run on `0.2`–`0.9`
work, so `npm run verify` locally is the only gate, and the Pages docs site stays on 0.1.x content
until the final merge.

### 0.1.0 — baseline publish ✅ published 2026-09-24 (`0.1.0`, then `0.1.1` the same day)
Publish what exists. Housekeeping first: `npm login` then `npm publish`, a `main` branch ruleset
requiring the two `Verify` checks, and repository topics. The ruleset and the topics are still open.

### 0.2.0 — Reach: control the viewer from outside ✅ built 2026-09-25 (local `dev`; pushed and published with 1.0.0)
No new dependencies.

* `forwardRef` + imperative handle: `goToPage`, `zoomTo`, `zoomBy`, `fitTo`, `setLayout`, `rotate`,
  `rotatePage`, `openSidebar`, `toggleFullscreen`, `search`. The component was not `forwardRef`
  before this and exposed no handle. `rotatePage` was not in the plan; it came with FR-09's per-page
  half. `toggleFullscreen` rather than `requestFullscreen`, because it exits when already in.
* Events: `onPageChange`, `onScaleChange`, `onLayoutChange`, `onFullscreenChange`. `onExternalLink`
  was defined at `lib/link-service.ts:28` and never wired by `PdfViewer`; it is now, intercepted on
  click rather than at attribute time, which is where the pdf.js callback does not fire.
* Drag-and-drop file loading, plus an `acceptDrop` escape hatch. Needed a shell-side `reload()` on
  source change — see the `src` fix in the changelog.
* Fullscreen via the Fullscreen API, with a toolbar control and an `F` shortcut.
* Keyboard page navigation — arrows, PageUp/PageDown, Home/End. `handleViewerKeyDown` mapped only
  Ctrl/Cmd+F and Ctrl/Cmd+P. Horizontal arrows are excluded on purpose; see the keyboard notes.
* Wheel zoom and pinch zoom wrapping `TouchManager` behind our own interface — its published
  parameter types are bare `Function`, so the call site was read rather than the `.d.ts`, and the
  whole construction sits in a `try` so an incompatible engine loses pinch zoom and nothing else.
* `labels` prop with a typed English default. Precedes `0.5`, so no toolbar or sidebar string gets
  extracted twice.
* Arbitrary zoom entry, and per-page rotation, closing FR-09's ("per-page or globally" — only global
  existed). Against FR-06's wording, 25–500 % arbitrary entry, `Fit-to-Width` and `Fit-to-Page` are
  all in; a fourth `Automatic` mode is not, because fit-width already recomputes against the container
  on every resize, which is what Acrobat's automatic resolves to for a portrait document.
* Not planned, found while verifying per-page rotation: rotated pages left their text and annotation
  layers in unrotated page space. Affects global rotation too, so it is a 0.1.0 defect. Fixed with
  the three `data-main-rotation` rules the engine's own viewer CSS expects.

### 0.3.0 — Trust: stop it failing in production ✅ built 2026-09-25 (local `dev`; pushed and published with 1.0.0)
No new dependencies.

* Canvas ceilings in `lib/canvas.ts`, applied in `PdfPage` and forwarded from `PdfViewer` as the new
  `maxRenderPixels` plus the previously-dead `devicePixelRatio`. This is **not** a boot measurement and
  **not** `OutputScale`: the only way to measure a canvas ceiling is to allocate a canvas at the limit,
  which is the memory the ceiling exists to avoid, and the engine's statics read `window.screen`. So the
  four `AppOptions` numbers (`2^25` device pixels, 5,242,880 on iOS/Android, 32,767 per side, area factor
  200) are restated here, which keeps a pdf.js minor from silently changing what our pages render at.
  An over-large canvas does not throw — the browser allocates nothing and pdf.js paints into a blank
  surface — so this is the whole defence, not a hint.
* `assetUrl` for cMaps, standard fonts **and wasm** (`wasmUrl` was never passed at all, so JPEG 2000 and
  JBIG2 documents had no decoder to find), replacing the unpkg defaults at `usePdfDocument.ts:41-42`,
  plus a CSP section in the docs. `'cdn' | URL`, not the planned
  `'cdn' | 'local' | URL`: `'local'` assumed a bundler can hand back a *directory*. It cannot —
  Vite rewrites both `new URL()` forms to the package's entry file, and emits only individually
  named files, while pdf.js looks these up by name at runtime. Probing for a directory is therefore
  impossible, so a root you serve is the only self-hosting option and is taken verbatim.
* Document-source allowlist, and a fix for `lib/source.ts:6-29`, which treats any unrecognized string
  as a URL. A bare word now throws instead of being fetched against the page's own origin.
* Trusted Types, opt-in and never implicit: `configureTrustedTypes(name)` builds the worker through the
  page's policy, because pdf.js accepts only a *string* `workerSrc` and a `require-trusted-types-for`
  page cannot construct a worker from one. Without this the viewer still works — pdf.js catches the
  failed construction and parses on the main thread — so the name is a parameter, and an unlisted one
  throws, which is why nothing here can pick it for you.
* Capabilities reported once a document is open: `capabilities` on `usePdfDocument`, `onCapabilities` on
  the shell — which form technology the document declares, whether the pages came from an XFA template,
  and whether it carries JavaScript that nothing here executes. `enableXfa` defaults to true, matching
  pdf.js's own viewer, so a dynamic XFA has a chance to compose rather than showing a blank page.
  Detection reads `IsXFAPresent`/`IsAcroFormPresent`, which are true regardless of that flag; whether a
  real XFA actually composes is **not** exercised by any fixture here (pdf.js's parser rejects our
  hand-written packet), so no claim is made that it renders until one is measured.
* **The size gate became a ratchet instead of a ceiling.** These five items cost **+2.57 kB** on the
  shell path — 42.88 → **45.45 kB** — and took headless from 23.35 → **25.60 kB**, which is over the
  45 kB ceiling that stood from `0.1` through `0.2`. Golfing the new code back under 45 was measured
  as worth roughly 0.3 kB and would have cost readability for 1 % of margin, so the budget moved.
  Raising the number to 48 was the first fix; asking how long until `0.4` needed 50 is why the
  ceiling was replaced outright. `scripts/check-size.mjs` now fails on more than 2 % growth above the
  baseline committed in `size-baseline.json`, and accepting growth is `npm run size:update` — a
  reviewed line in the same diff as the code that caused it. Shrinking stays free.
  `PRD.md` §Bundle Budgets carries the same amendment. The debt that entry left — `0.4` measuring each
  tier, and the PRD's 8 kB core / 4 kB feature figures being checked per path — is what `0.4` below
  settles: one of those two numbers held, the other did not.

### 0.4.0 — Tiers: opt-in features (FR-21, FR-22, FR-23) ✅ built 2026-09-25 (local `dev`; pushed and published with 1.0.0)
No new dependencies. This is the architecture seam; see "The tier decision" above for its evidence.

* Core `PdfViewer` stopped importing features. It keeps document loading, virtualization, page layers,
  zoom, navigation, rotation, layout modes, text selection, **search, ink and thumbnails**, and
  bundles to **20.61 kB gz** with a real bundler — against the 5.6 kB this section planned for, because
  that figure came from a prototype shell that had none of those. `PRD.md` §6 now states the
  substitution instead of repeating the old number.
* `PdfFeature` contract in `src/lib/features.ts`: `{ id, Runner?, panel?, controls?, keys?,
  pageProps?, options? }`, plus `AnyPdfFeature` for the list type — a `PdfFeature<FormState>` is not
  assignable to `PdfFeature<FeaturePublication>`, so a heterogeneous `features` array needs a
  deliberately loose element type or every feature has to be cast at the call site.
* Runners keyed by `feature.id`, with both halves tested (see the constraint above). The host is
  `src/components/FeatureHost.tsx`: one store keyed by id, a `samePublication` shallow compare that
  stops a rebuilt object from re-rendering the viewer forever, and a `retire(id)` on unmount so a peer
  stops reading state from a feature that has gone — which is what makes download's "are there edits to
  save?" answer honest after forms are unmounted.
* `features` replaced `enablePrint`, `printScale`, `enableDownload`, `downloadFileName`,
  `renderForms` and `onFormValuesChange` — six props out, one in. **This is the release's breaking
  change**, and it is why the work sits at `0.4` rather than after `1.0`. The defaults are the
  user-visible half of it: `<PdfViewer src />` used to print, save, fill and show bookmarks, and now
  reads.
* Per-feature CSS, and `styles.css` minified in `scripts/copy-assets.mjs`. The single 0.3 sheet was
  **9.29 kB gz**; the four shipped now are 3.49 core + 0.17 print + 0.85 forms + 0.47 outline, so a
  core-only viewer pays 3.49 and even the full set is under the old sheet. Two findings shaped this:
  a feature module **cannot** carry its own `import './x.css'` (tsup strips it and emits a sibling file
  nothing loads, silently unstyled), so each sheet is its own published entry with
  `sideEffects: ["**/*.css"]` keeping it alive; and `download` needs no sheet at all, because its
  control is an ordinary button.
* `scripts/check-size.mjs` now walks the reachable chunk graph per entry *and* bundles seven consumer
  paths with esbuild and Rollup, reporting the worse of each pair; `size-baseline.json` carries nine
  labels, those seven plus the two entry sums. It also asserts the four feature markers in both
  directions — absent from the core bundle, present in the bundle that names the feature — so a marker
  that stopped meaning anything fails as loudly as a feature that came back.
* **The gate was tested by breaking it, both ways.** Re-adding a live `usePdfPrint` reference to
  `PdfViewer` and rebuilding: core went 20.61 → **22.10 kB** and *both* bundlers reported
  `FAIL usePdfPrint is in the core … bundle: the shell imports print again`, exit 1 — and the leak
  also shrank print's apparent marginal cost to 0.55 kB, which is the shape of the regression a
  total-only gate would have missed entirely. Separately, lowering a baseline number by 5 kB in a
  scratch copy fails the ratchet half. The first attempt at the second check was a false green: the
  scratch baseline was written to `/tmp`, which Git Bash and node resolve to different roots, so the
  run that "passed" had actually read no baseline at all — redone inside the repo. The 4 kB
  per-feature gate is enforced and green (print 2.02, download 0.86, forms 1.99, outline 0.93).
* Found while verifying, and fixed: feature controls folded into a *built-in*'s overflow menu row under
  the wrong heading, because menu rows are grouped by the first item's label and features share
  priorities with the built-ins. The toolbar now groups on `(priority, label)`. That was a pre-existing
  wart — two built-ins on one priority could already collide — which features made reachable.
* The entry-path totals moved very little (shell 45.45 → 44.01 kB, headless 25.60 → 21.77) because
  those paths sum every file reachable from the entry, and `index.js` still re-exports every headless
  hook on purpose. The number that changed is the one a consumer's bundler reports, and it is the one
  the gate now leads with.

### 0.5.0 — Compose: make the shell configurable
No new dependencies.

* Toolbar layout API: ordered controls, per-control opt-out, consumer-set priorities, named slots.
  `0.4` already turned controls into data, so this replaces the hardcoded priorities in
  `Toolbar.tsx`'s item list (`211`–`384` as this was written) rather than introducing them.
* Compound components (`PdfViewer.Root` / `.Toolbar` / `.Page` / layers), which PRD §2 already lists
  as a goal.
* Sidebar attachments tab (`getAttachments`) and layers/OCG tab, implementing the `setOCGState` no-op.
* Search depth: regex (the query is escaped to a literal at `lib/search.ts:107` today), multiple
  terms, an all-match count, exposed per-page counts, a replaceable find controller.

### 0.6.0 — Mark: annotation authoring
No new dependencies. Gated on Spike A.

* Wire `AnnotationEditorLayer` + `AnnotationEditorUIManager` into `PdfPage`, replacing the `null` it
  passes today (`PdfPage.tsx:246`): highlight, underline, strikeout, squiggly, free text, ink, stamp,
  image stamp and drawn signature.
* Create, select, move, resize and **delete** annotations, including pre-existing ones.
* Interactive popups — `.popupAnnotation` is `pointer-events: none` today (`styles/viewer.css:568`).
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

## Opened by the 0.4 review

A three-way review of the finished release (CI, docs, API surface) produced these. None is a defect in
what `0.4` shipped; each is recorded so the later releases inherit the list rather than rediscover it.

* **The print control prints the whole document**, as `0.3`'s did — extraction kept the behaviour, and
  changing it is not this release's job. A page-range choice, or `createPrintFeature({ range })`
  defaulting to the visible rows, belongs with `0.5`'s toolbar work, where the control can host it.
* **`findFeatureKey` returns the winning binding but not the feature it came from.** Harmless today;
  `0.6`'s editor layer will want both, to say which feature refused a chord. A return-shape change, so
  it has to happen before the API freeze.
* **`INK_COLORS` and `INK_WIDTHS` are exported mutable arrays**, so a consumer that sorts one in place
  changes every viewer on the page. Freezing them is an API-surface change and belongs with the same
  freeze review.
* **The docs examples cover two of about twenty exports.** `0.8` already lists "one docs example per
  public API"; the count is now known rather than assumed.
* **CI was reviewed against the release, and came back cleaner than expected**: both workflows already
  carry `concurrency`, per-job `timeout-minutes`, `npm ci` (which fails on a lockfile that disagrees
  with `package.json`), and a consumer job that installs the packed tarball and asserts the worker was
  bundled. The one real gap was `ci.yml` running with whatever token the organization defaults to, for
  a workflow that publishes nothing — it now asks for `contents: read` explicitly. Still open, and it is
  repository settings rather than YAML: the `main` ruleset, and whether `1.0.0` publishes with
  `--provenance`.
* **Vendored third-party CSS stays unvendored.** pdf.js ships the text-layer and annotation-layer
  stylesheets inside `node_modules`, and our sheets restate the rules we depend on rather than importing
  them. The licensing question (`Apache-2.0`, not MIT) is a `1.0` decision, and it needs a real answer
  before anything copies engine CSS into this repo.

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
