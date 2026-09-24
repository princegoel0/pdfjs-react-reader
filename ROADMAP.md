# Roadmap

Version plan from the current `0.1.0` baseline to a `1.0.0` that ships the full feature set. Each
release is scoped to one theme so the version number carries meaning beyond "some things changed".

* Feature requirements are `FR-nn` in `PRD.md` §4; the versioning policy is in `CHANGELOG.md`.
* File and line references below were verified against `src/` on 2026-09-24.
* Engine facts below were verified against the installed `pdfjs-dist@5.7.284` types.

## Where we are

`FR-01`–`FR-19` are implemented, tested and browser-verified. `FR-20` is **not** complete: download
offers the original bytes or a pdf.js incremental save, and `src/headless/usePdfDownload.ts:16-21`
states that this is "not a true flatten (flattening needs a PDF writer, which this library is not)".
That single sentence is what forces the `0.6` writer subpath below.

## What the engine gives us for free

Before planning against the feature list, `node_modules/pdfjs-dist/types` was checked rather than
assumed. `pdfjs-dist@5.7.284` exports:

| Export | Unblocks |
| --- | --- |
| `AnnotationEditorLayer`, `AnnotationEditorUIManager`, `AnnotationEditorType` (`FREETEXT`, `HIGHLIGHT`, `STAMP`, `INK`, `POPUP`, `SIGNATURE`, `COMMENT`) | Annotation authoring without third-party code — `PdfPage.tsx:224` currently passes `annotationEditorUIManager: null` |
| `XfaLayer`, `enableXfa`, `getXfaPageViewport` | XFA **rendering** (persistence remains impossible, see PRD §2) |
| `SignatureExtractor`, `SupportedImageMimeTypes`, `DrawLayer`, `TextLayerImages`, `renderRichText` | Signature and image/stamp annotations, rich-text free-text |
| `TouchManager` (`onPinchStart` / `onPinching` / `onPinchEnd`) | Pinch zoom, instead of hand-written gesture math |
| `OutputScale.capPixels(maxPixels, capAreaFactor)`, `FeatureTest` | Canvas-area capping. Note `FeatureTest` has **no** canvas-size probe, so the cap must be measured by us and fed to `capPixels` |

`saveDocument(): Promise<Uint8Array>` (`types/src/display/api.d.ts:1072`) and the `annotationStorage`
getter (`:860`) exist, but which editor types actually survive into those bytes is unmeasured —
that is Spike A below.

## Feature coverage map

Every item on the target feature list, and the release it lands in.

| Feature | Release | Notes |
| --- | --- | --- |
| Multiple viewing modes | `0.1` done | continuous / single / spread (`lib/layout.ts`) |
| Direct pdf.js API access, TypeScript | `0.1` done | re-exports extended in `0.5` |
| Zoom control, pinch zoom | `0.2` | wheel + pinch + arbitrary entry; `ZOOM_LEVELS` is 0.25–5 today |
| Drag-and-drop loading | `0.2` | `lib/source.ts` already accepts `File`/`Blob`/`Uint8Array` |
| Fullscreen | `0.2` | zero `requestFullscreen` in the repo today |
| Accessibility | `0.2`, `0.5`, `0.7` | keyboard → annotation access → audit |
| Internationalization | `0.2` API, `0.7` locales | ~75 hardcoded strings, 43 in `Toolbar.tsx` |
| Advanced JS API | `0.2`, `0.4`, `0.5` | handle + events → find controller → popups |
| Mobile optimization | `0.2`, `0.7` | gestures, then the real-device matrix |
| High-resolution rendering | `0.3` | capability detection; `PdfViewer` never forwards `devicePixelRatio` today |
| Performance | `0.3` | caps; virtualization and canvas zeroing already done |
| Security / CSP | `0.3` | cMaps + fonts default to unpkg (`usePdfDocument.ts:41-42`) |
| Customizable toolbar and UI | `0.4` | only `enablePrint`/`enableDownload`/`renderForms` exist today |
| Rich sidebar | `0.4` | 2 tabs today; `executeSetOCGState()` is a no-op (`lib/link-service.ts:73`) |
| Advanced search | `0.4` | case + whole-word + highlight-all exist; regex and multi-term do not |
| PDF annotation and editing | `0.5` create, `0.6` persist | |
| Comprehensive form support (AcroForm + XFA) | `0.5` renders XFA | XFA persistence excluded, permanently |
| Page reordering | `0.6` | needs a PDF writer |

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
  is defined in `lib/link-service.ts:28` and never wired by `PdfViewer`.
* Drag-and-drop file loading, plus a `acceptDrop` escape hatch.
* Fullscreen via the Fullscreen API, with the toolbar control and `F` shortcut.
* Keyboard page navigation — arrows, PageUp/PageDown, Home/End. `handleViewerKeyDown` currently maps
  only Ctrl/Cmd+F and Ctrl/Cmd+P.
* Wheel zoom and pinch zoom by wrapping `TouchManager` behind our own thin interface (its published
  parameter types are largely `any`, so an unguarded dependency here can break on a pdf.js minor).
* `labels` prop with a typed English default. This must land **before** `0.4`, or every new toolbar
  and sidebar string gets extracted twice.
* Arbitrary zoom entry, closing the literal FR-06 wording ("arbitrary zoom percentages"), and
  per-page rotation, closing FR-09's ("per-page or globally" — only global exists).

### 0.3.0 — Trust: stop it failing in production
No new dependencies.

* Measure the browser's maximum canvas area and side at boot, feed them through
  `OutputScale.capPixels`, expose `maxRenderPixels`, and adapt dpr at high zoom. Today dpr is read
  per page (`PdfPage.tsx:138`) with no ceiling, and `PdfViewer` never forwards the
  `devicePixelRatio` prop `PdfPage` already accepts.
* `assetUrl: 'cdn' | 'local' | URL` for cMaps and standard fonts, replacing the unpkg defaults, plus
  a CSP section in the docs. This changes a default, so see "policy conflicts" below.
* Document-source allowlist, and a fix for `lib/source.ts:6-29`, which accepts any unrecognized
  string as a URL.
* Optional Trusted Types policy.
* Surface form capability (`doc.isXFA`) so XFA reports itself instead of rendering nothing silently.

### 0.4.0 — Compose: make the shell configurable
No new dependencies.

* Toolbar layout API: exported ordered controls, per-control opt-out, consumer-set priorities and
  named slots. Priorities are hardcoded literals at the call sites today (`Toolbar.tsx:213,318,336,382,491`)
  on a non-exported type, and controls only self-hide when their handler is `undefined` — which
  `PdfViewer` never does.
* Compound components (`PdfViewer.Root` / `.Toolbar` / `.Page` / layers), which PRD §2 already names
  as a goal.
* Sidebar attachments tab (`getAttachments`) and layers/OCG tab, implementing the `setOCGState` no-op.
* Search: regex (the query is escaped to a literal at `lib/search.ts:107` today), multiple terms,
  an all-match count, exposed per-page counts, and a replaceable find controller.

### 0.5.0 — Mark: annotation authoring
No new dependencies. Gated on Spike A.

* Wire `AnnotationEditorLayer` + `AnnotationEditorUIManager` into `PdfPage`, replacing the two `null`s
  at `PdfPage.tsx:224-226`: highlight, underline, strikeout, squiggly, free-text, ink, stamp, image
  stamp and drawn signature.
* Create, select, move, resize and **delete** annotations, including pre-existing ones.
* Interactive popups — `.popupAnnotation` is `pointer-events: none` today (`styles/viewer.css:603-628`).
* `enableXfa: true` and `XfaLayer` so XFA documents display.
* `onAnnotationChange` events, and re-export of the editor classes from `/headless`.
* Annotation keyboard accessibility.

### 0.6.0 — Edit: writing the engine cannot do
The only release that touches the zero-dependency rule.

* New export `pdfjs-react-reader/edit`, with the PDF writer as an **optional peer** so the core stays
  dependency-free and inside the size gate. `scripts/check-size.mjs` gains a measured third path.
* True flattening, which completes FR-20.
* Page reorder, delete, extract and split by dragging thumbnails, with undo.
* Rotation and ink written into the saved document rather than view state only.

### 0.7.0 — Freeze: hardening
* Real-device matrix: iOS Safari 14 and 15 (the `:has()` fallback for container queries is written
  but has never been measured on any Safari), and Android Chrome.
* Shipped locale catalog; text layer `TextLayer.update()` instead of a full rebuild; CSS
  minification in `scripts/copy-assets.mjs` (the 8.74 kB of `styles.css` is mostly comments).
* One docs example per public API, an upgrade guide, and an API-freeze review.

### 1.0.0 — GA
All `FR-01`–`FR-20` genuinely green, every feature-list row either shipped or documented as an
explicit exclusion, and strict semver from then on.

## Spikes and gates

* **Spike A — before `0.5` closes.** For each editor type, create an annotation, call
  `saveDocument()` and diff the bytes. This decides which types `0.5` can honestly ship as
  persistent and which must wait for `0.6`. Expect a partial result: form fields survive today,
  editors are newer machinery.
* **Spike B — before `0.6` closes.** Compare candidate writers on bundle size, ESM quality and
  maintenance status, and confirm one can be an optional peer that the core build never imports.
* `0.2`'s `labels` prop gates `0.4` (avoid double extraction); `0.3` gates `0.5` (an editor layer at
  5x zoom is exactly where an uncapped canvas fails); `0.6` gates any further structure work.

## Fixtures we do not have

`playground/fixtures/` holds form, outline and encrypted PDFs. Testing the later releases additionally
needs: an XFA document, a pre-annotated PDF (to exercise edit/delete of existing annotations), a
document with attachments and optional content groups, a signature-bearing form, and a 20-page PDF for
reorder. These come from generator scripts like the existing `scripts/make-*-pdf.mjs`, not downloads.

## Policy conflicts to resolve

* **Peer floor.** `package.json` requires `pdfjs-dist: ^5.0.0`, but the editor classes live under
  `display/editor/*` and `AnnotationEditorType.SIGNATURE` / `TextLayerImages` are recent additions.
  `0.5` needs the floor raised to whatever version introduced them — a breaking peer change, so the
  CHANGELOG policy says announce it loudly even at `0.x`.
* **Changing the unpkg default in `0.3`** is a behavior change. `CHANGELOG.md`'s policy only calls
  API, CSS-token and supported-major changes breaking, so a default flip is arguably a minor. Worth
  deciding deliberately rather than by accident.
* **PRD §2 non-goal 1** said creation/assembly was out of scope; `0.6`'s reorder and split contradict
  it as written. That bullet has been amended, and signature drawing plus XFA persistence were
  clarified alongside it.
