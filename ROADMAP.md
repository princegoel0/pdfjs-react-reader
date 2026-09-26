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

Every requirement, its release, and whether it is actually met. This table replaces the range
sentence this section used to carry (`FR-01`–`FR-19` and `FR-21`–`FR-23` are implemented), which was
wrong in both directions: it silently omitted `FR-24`–`FR-28`, which `0.5` shipped, and it claimed
`FR-16` and `FR-18` whole when each has a half scheduled for `0.6`. A range is not a status.

| FR | Requirement | Release | Status |
| --- | --- | --- | --- |
| `FR-01` | Input flexibility (URL, bytes, base64, `File`/`Blob`) | `0.1` | done |
| `FR-02` | Worker configuration | `0.1`, fixed in `0.1.1` | done |
| `FR-03` | Password protection | `0.1` hook, `0.7` prompt | done — wrong *and* right passwords exercised |
| `FR-04` | Cancellation safety | `0.1` | done |
| `FR-05` | Viewport virtualization | `0.1`, ceilings `0.3` | done — see the unmeasured bar below |
| `FR-06` | Responsive zoom modes | `0.2` percentages, `0.5` `automatic` | done — 25–500 %, width, page, automatic |
| `FR-07` | High-DPI adaptation | `0.3` | done |
| `FR-08` | Page layouts | `0.1` | done |
| `FR-09` | Rotation, per page and global | `0.1`, `0.2` | done |
| `FR-10` | Outline | `0.1` | done |
| `FR-11` | Thumbnails sidebar | `0.1`, fluid grid in phase 6b | done — `PRD` states "scale 0.15–0.25"; the code sizes from the column width and `devicePixelRatio` (`PdfThumbnail.tsx:64`), so that figure is not the rule |
| `FR-12` | Jump-to-page with clamping | `0.1` | done |
| `FR-13` | In-memory indexing | `0.1` | done in substance — `page.getTextContent()` parses in the pdf.js worker; the index is assembled on the main thread, yielding every five pages (`search.ts:272`) |
| `FR-14` | Match highlighting | `0.1`, counts `0.5` | done |
| `FR-15` | Search controls | `0.1`, `0.5` | done — case, whole-word, next/previous, `Indexing {percent}%` |
| `FR-16` | AcroForm support | `0.1`; XFA renders `0.6` | **partial** — every widget type except a signature is browser-verified; `form.ts:120` classifies `/Sig`, but no fixture carries one, so its rendering is unproven. XFA now renders through `XfaLayer` (`xfa-sample.pdf`, see *0.6.0 — Mark*), and a document whose template pdf.js cannot lay out **fails to load** rather than showing a blank page, so `enableXfa` on by default carries that risk |
| `FR-17` | Form data sync | `0.1` | done |
| `FR-18` | Annotations view and draw | `0.1` view, ink `0.5`; authoring `0.6` | **partial** — links and markup render, freehand ink draws and prints; authoring shipped in `0.6` as `annotateFeature` and, as measured, that means highlight, free text and ink — the engine cannot create or edit underline/strikeout/squiggly, and stamp and signature break the save (see *0.6.0 — Mark*) |
| `FR-19` | High-fidelity printing | `0.1`, ranges `0.5` | done — iOS Safari is excluded by design, which `PRD` does not mention |
| `FR-20` | Document download | `0.7` | **not complete** — `doc.saveDocument()` is an incremental save, not a flatten; flattening needs a PDF writer, which is what `0.7` adds |
| `FR-21` | Opt-in feature registration | `0.4` | done |
| `FR-22` | Per-feature stylesheets | `0.4`, two more in `0.5` | done |
| `FR-23` | Enforced size boundary | `0.4` | done — a ratchet, and the per-feature 4 kB gate |
| `FR-24` | Optional-content layers | `0.5` | done |
| `FR-25` | Embedded file list | `0.5` | done — both engine shapes, and annotation-held files save from the annotation |
| `FR-26` | Replaceable find strategy | `0.5` | done |
| `FR-27` | Search depth | `0.5` | done |
| `FR-28` | Composed shell | `0.5` | done |

**`FR-20` in full**, because it is the one open item that changes the API: download offers the
original bytes or an incremental save carrying the edits, and
`usePdfDownload`’s options state "not a true flatten (flattening needs a PDF writer, which this
library is not)". That sentence is what forces the writer subpath in `0.7`.

**One bar nothing has measured.** `PRD.md:22` promises "60 FPS scrolling on 1,000+ page documents
with sub-100ms viewport render times". Every frame-timing measurement taken in this project’s
history was made on documents of 3–14 pages, and no 1,000-page fixture has ever been opened here.
`README` is careful about this — it cites a 400-page document only as the reason canvases are
released on mobile Safari — but the requirement itself is unverified, so it is `0.8`’s work, not
done. `0.8` needs a large fixture and a real number.

`FR-21`–`FR-23` were added on 2026-09-24 alongside the tier decision below; `FR-24`–`FR-28` were
added with `0.5` on 2026-09-26.

## What the engine gives us for free

Before planning against the feature list, `node_modules/pdfjs-dist/types` was checked rather than
assumed. `pdfjs-dist@5.7.284` exports:

| Export | Unblocks |
| --- | --- |
| `AnnotationEditorLayer`, `AnnotationEditorUIManager`, `AnnotationEditorType` (`FREETEXT`, `HIGHLIGHT`, `STAMP`, `INK`, `POPUP`, `SIGNATURE`, `COMMENT`) | Annotation authoring without third-party code — `PdfPage` took `annotationEditorUIManager: null` until `0.6` mounted `annotateFeature`, which publishes the manager and `annotationEditorEditing` through `pageProps` |
| `XfaLayer`, `enableXfa`, `page.getXfa()` | XFA **rendering**, wired in `0.6`. Saving an edited XFA document is unmeasured (`#127`) and a packet pdf.js cannot lay out rejects the load — see *0.6.0 — Mark* |
| `SignatureExtractor`, `SupportedImageMimeTypes`, `DrawLayer`, `TextLayerImages`, `renderRichText` | Signature and image/stamp annotations, rich-text free text |
| `TouchManager` (`onPinchStart` / `onPinching` / `onPinchEnd`) | Pinch zoom instead of hand-written gesture math |
| `OutputScale.capPixels(maxPixels, capAreaFactor)`, `FeatureTest` | Canvas-area capping. `FeatureTest` exposes **no** canvas-size probe, so the cap must be measured here and fed to `capPixels` |

`saveDocument(): Promise<Uint8Array>` on `PDFDocumentProxy` and the `annotationStorage`
getter (`:860`) exist, and `0.6`'s Spike A measured what actually reaches those bytes: new
`/Highlight`, `/Ink` and `/FreeText` annotations do, a stamp and a signature do not — they throw during
the save — and an existing `/Underline`, `/StrikeOut`, `/Squiggly`, `/Text` or `/Popup` is not editable at
all. See *Spike A, second pass*.

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
feature wraps (`usePdfPrint`, `usePdfDownload`, `usePdfFormValues`, `usePdfOutline`, and since `0.5`
`usePdfOptionalContent` and `usePdfAttachments`) is grepped out of
the core bundle and into its own, on unminified output so a rename cannot hide it. Those names
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
| Zoom control, pinch zoom | `0.2` done, `0.5` automatic | wheel + engine `TouchManager` pinch; `ZOOM_LEVELS` 0.25–5, any percentage 25–500 %, and `automatic` (width-fit portrait, whole-page landscape) |
| Drag-and-drop loading | `0.2` done | off by default; `acceptDrop` gates it, `onDropFile` always fires |
| Fullscreen | `0.2` done | webkit spellings covered, control hidden where unsupported |
| Accessibility | `0.2`, `0.6`, `0.8` | keyboard done in `0.2` → annotation access → audit |
| Internationalization | `0.2` API done, `0.8` locales | 106 strings behind one typed catalog |
| Advanced JS API | `0.2`, `0.5`, `0.6` | handle + events done in `0.2` → find controller → popups |
| Mobile optimization | `0.2`, `0.8` | gestures done → real-device matrix |
| **Basic vs full bundle weight** | **`0.4` done** | opt-in features; core shell 22.97 kB gz bundled (the `0.5` line, post-close), each feature 0.71–2.49 kB over it |
| High-resolution rendering | `0.3` done | `devicePixelRatio` forwarded from `PdfViewer`, capped by the canvas ceilings |
| Performance | `0.3` done | canvas area/side ceilings in `lib/canvas.ts`; virtualization and canvas zeroing already done |
| Security / CSP | `0.3` done | `assetUrl` roots cMaps + fonts + wasm; `allowedSources`; opt-in Trusted Types policy |
| Customizable toolbar and UI | `0.5` done | the parts are exported and read one controller; `controls` hides, re-ranks, re-orders and adds controls by id |
| Rich sidebar | `0.5` done | thumbnails are core; outline, layers and attachments are feature tabs. `executeSetOCGState` is implemented — a document's own layer link and the layers panel drive one shared config, and a paperclip annotation saves the file it carries |
| Advanced search | `0.5` done | case, whole-word, every match marked at once (not a toggle — it is unconditional), multi-word AND, regex, invalid-pattern reporting, per-page counts, and `find` to swap the strategy |
| PDF annotation and editing | `0.6` create and save | marks go into the file through `saveDocument()`; `0.7` is about flattening, not persistence |
| Comprehensive form support (AcroForm + XFA) | `0.6` renders XFA | XFA persistence excluded permanently |
| Page reordering | `0.7` | needs a PDF writer |

## Releases

**How these ship (decided 2026-09-25).** `0.2`–`0.8` — the planned sequence, which has no `0.9` — are
committed on `dev` and kept **local**; nothing
is pushed, merged to `main` or published along the way. When the sequence is done we push `dev`, tag
`1.0.0`, merge to `main`, and publish that one version. `0.1.2` is therefore never published — it is
tagged on GitHub but npm goes `0.1.1` → `1.0.0`. The accepted cost: Actions do not run on `0.2`–`0.8`
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
  was defined on `CreatePdfLinkServiceOptions` in `lib/link-service.ts` and never wired by `PdfViewer`; it is now, intercepted on
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
  JBIG2 documents had no decoder to find), replacing the unpkg defaults in `pdfAssetUrls`/`CDN_ASSET_ROOT` (`lib/assets.ts`),
  plus a CSP section in the docs. `'cdn' | URL`, not the planned
  `'cdn' | 'local' | URL`: `'local'` assumed a bundler can hand back a *directory*. It cannot —
  Vite rewrites both `new URL()` forms to the package's entry file, and emits only individually
  named files, while pdf.js looks these up by name at runtime. Probing for a directory is therefore
  impossible, so a root you serve is the only self-hosting option and is taken verbatim.
* Document-source allowlist, and a fix for `classifyString` in `lib/source.ts`, which treats any unrecognized string
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
  _Superseded by `0.6`: the packet was the problem, not the parser — `xfa-sample.pdf` composes, and what
  the rejection really looked like is written up under `0.6` (`#114`, `#119`)._
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
  that stopped meaning anything fails as loudly as a feature that came back. (`0.5` mounted two more
  features, so today it bundles nine paths, `size-baseline.json` holds eleven labels, and there are six
  markers; the four-above list is what `0.4` shipped.)
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

### 0.5.0 — Compose: make the shell configurable ✅ built 2026-09-26 (local `dev`; pushed and published with 1.0.0)
No new dependencies.

**Measured first (2026-09-25, playground, 14-page document at fit-width, ~590 px viewer, 2 rows
mounted; render counters instrumented in `PdfPage`, `PDFPageProxy.prototype.render` spied through the
React fiber):**

| Interaction | renders/page before | renders/page now | canvas repaints |
| --- | --- | --- | --- |
| Open the ⋯ menu (control: `Toolbar`-local state) | 0 | 0 | 0 |
| Open the search bar | 6 | **0** | 0 |
| Close it again | 4 | **0** | 0 |
| Toggle draw mode | — | 2 | 0 (legitimate: `inkDrawing` is a page prop) |
| Toggle the sidebar | 10 | 6 | yes (legitimate: fit-width re-resolves) |
| Load the document | 16 | 8 | once per page (legitimate) |

* **Landed, before any restructuring:** `PdfPage` is memoised and the shell hands each page a stable
  ink-commit handler instead of a fresh inline arrow. Two changes, **+0.08 kB** on the core path
  (20.61 → 20.69 kB gz), and a chrome-only interaction went from re-rendering every visible page to
  re-rendering none. The inline arrow was load-bearing: memoising `PdfPage` alone changed *nothing*
  (still 6/4/10), because the shell was passing a new callback identity to every page on every render
  — which is the same rule the library's own docs give hosts about layer deps, now with the shell
  obeying it first.
* **Landed: the controller split.** `useViewerController` owns every piece of state, effect and
  handler the shell had; `ViewerLayout` places the parts and reads nothing else; `PdfViewer` is now
  those two plus a ref. It is a pure move — no behaviour change, and the browser pass over the
  extracted shell found nothing new (zoom to 150 % → 918 px canvas, rotate → 1188 px with 356 text
  spans still aligned, search "trace" → 416 matches and 56 marks, sidebar with 14 thumbnails and the
  Outline tab, form widget typed → `getFormData`, ink stroke committed → 3 paths, console clean).
  **The cost is +0.51 kB** (20.69 → 21.20 kB core), and it is not subtle code: it is the ~60-field
  object literal the controller returns, which is the API. `size-baseline.json` was updated in the
  same change, as the ratchet requires. If a later release finds the seam is not worth half a
  kilobyte, that is the number to argue about.
* **One claim from the first pass is retracted.** A close-search did appear to repaint both canvases
  at an unchanged size, which would have meant an unstable effect dep. It did not reproduce: with the
  spy in place the same interaction produced 0 renders and 0 repaints, and the geometry never moved.
  The earlier hit was a transient resize in a different window state, not a defect. Recorded so it is
  not chased twice.
* **What that bought:** a host can now arrange the viewer without forking it — `playground/src/CustomLayout.tsx`
  is 97 lines and owns no state. (The "70 lines" this line claimed when it was written was wrong: the
  file has measured 97 at every commit since the one that created it. A number typed rather than
  measured, which is what the rest of this file tries not to do.) What remains of the theme is the *contents* of the bar: the parts
  compose, but their controls are still a fixed list with hardcoded priorities, which is the next
  bullet.

* **Landed: the controller is published, and the parts read it.** `ViewerProvider` + `useViewer()`,
  and the default layout is now four composed parts — `ViewerRoot` (the frame: tokens, keyboard, drop,
  the feature Runners), `ViewerToolbar`, `ViewerSidebar`, `ViewerPages` — all exported, along with
  `useViewerController` and `ViewerLayout`. The existing parts keep their explicit props, so nothing
  from `0.1`–`0.4` breaks: a host either reads the controller or wires the props, per component.
  Cost **+0.15 kB** (21.20 → 21.35), and `playground/src/CustomLayout.tsx` is the worked example —
  host page controls on top, pages in the middle, the stock toolbar along the bottom, driven by the
  same props object as `<PdfViewer>` and taking the same ref.
  Verified in the browser with that toggle: DOM order `[host-bar, pjsr-body, pjsr-toolbar]` against
  stock's `[pjsr-toolbar, pjsr-body]`, zoom 104 % → 129 % through a host button, sidebar with 14
  thumbnails and the Outline tab, search "trace" → 416 matches and 56 marks, the print feature control
  present in the host's toolbar, and the side panel's `zoomTo(2)` reaching the same canvas (1224 px).
  `useViewer` outside a provider throws, and both halves have a test.
* **A verification limit, learned the hard way here: page tracking cannot be checked in this
  automation tab at all.** `usePdfVirtualizer` throttles its scroll handler through
  `requestAnimationFrame`, and a hidden document produces no frames — measured
  `visibilityState: 'hidden'` with a rAF callback that never ran. So scrolling updates `scrollTop`
  and fires the listener, but `currentPage` never moves, in *either* layout. Two "regressions"
  chased during this step were that artifact; the toolbar page field is not observable here, and
  anything that needs it has to be checked in a visible window.
* **Landed: the bar is configurable.** `controls={{ hide, priorities, order, add }}` on
  `PdfViewer` (and on `Toolbar` directly), keyed on each control's `id` — the seventeen built-ins plus
  whatever a mounted feature declares. `hide` removes from bar and menu, `priorities` changes what
  folds first, `order` changes where controls sit while they are in it, `add` contributes host controls
  and *replaces by id in place* so swapping a button does not move it. `ToolbarItem` and
  `ToolbarControls` are now exported — `ToolbarItem` was already the type of `featureItems`, which no
  consumer could name. Cost **+0.32 kB** (21.35 → 21.67), 12 new tests over the two pure helpers
  (`applyControlConfig`, `mergeToolbarItems`), including the two orders that matter: removal runs
  before priorities and order, so a hidden id cannot be coaxed back, and an unknown id is ignored
  rather than rejected, because fullscreen is genuinely absent on some browsers.
* **Not built: named slots.** The plan asked for slots; what shipped instead is `order`, which covers
  placement without inventing a second vocabulary for the same list. A slot system would only earn
  its keep if a host needed to inject markup *between* controls rather than order them — and at that
  point they are writing their own `Toolbar`, which `0.5` now supports. Recorded so the gap is a
  decision rather than an oversight.
* Compound components (`PdfViewer.Root` / `.Toolbar` / `.Page` / layers), which PRD §2 already lists
  as a goal — reading the controller, not receiving 25 props.
* **Landed: print takes a page range.** `printFeature` now contributes **two** controls — `print` at
  priority 8 (the action, so it stays in the bar) and `print-pages` at 11 (an All / Current / From–to
  selector that gives its place up first) — and the print button's hover text says what it will send
  (`Print pages 2–3`). `createPrintFeature({ scope, range })` sets where the selector starts; from
  then on the reader owns it, which was the point. `Ctrl/Cmd + P` prints the same selection, because
  a binding that ignored it would be a second, quieter print dialog.
  The scope resolves in one pure function, `printRangeFor`, whose two interesting decisions are
  tested: a backwards range is swapped rather than refused (someone who types “5 to 2” means the pages
  between them), and bounds are *not* clamped to the document there — `planPrintPages` does that
  against the real page count, which is the only place the count is known, since a range can be set
  while a slow document is still loading.
  Browser-proved against the engine, not assumed: a 2–3 selection produced **exactly two** print
  canvases at 1224×1584 (Letter at scale 2) with progress at 100 %, and `current` produced one.
  Cost **+0.47 kB** on print (2.02 → 2.49, still under the 4 kB gate) and +0.09 on core, where
  `printRangeFor` lives beside the other print planners.
* **Landed: the layers and attachments tabs.** `layersFeature` and `attachmentsFeature`
  (`features/layers`, `features/attachments`, one stylesheet each) over
  `usePdfOptionalContent` / `usePdfAttachments`, at **1.16 kB** and **1.29 kB** over core — panel only,
  no toolbar control, because both describe the document rather than an action on it. The fixture the
  bullet asked for is `scripts/make-attachments-ocg-pdf.mjs`.
  **The bug this found is the reason the seam exists.** pdf.js rebuilds `OptionalContentConfig` on every
  `getOptionalContentConfig()` call, and a `render()` that is not handed one fetches its own — so
  toggling a layer on any object a caller holds repaints the page from *fresh defaults* and nothing
  changes. Hence the shell owning one instance, `repaint()`/`contentVersion` in core, and
  `executeSetOCGState` (was a no-op) mutating the same object. Verified in the browser in both
  directions: a checkbox repaints the mounted canvases and moves the document's own link state, and
  clicking the fixture's `SetOCGState` link moves the checkbox. `--stamp-on` emits a twin whose only
  difference is the group default, which is what proves the flag drives visibility.
  **The inert paperclip, closed after the release.** An annotation that *opens* an embedded file stayed
  dead, because pdf.js reaches for `linkService.getAttachmentContent` and a `downloadManager` and we
  supplied neither: the first was a `TypeError` inside pdf.js's own handler, and the second it reads off
  the **render params**, not the `AnnotationLayer` constructor — a manager placed there is ignored
  without a word. Both now exist, the save going through the same `downloadBytes` as the attachments tab.
  Trigger is `dblclick` on the icon or `Ctrl + Enter` on the focused annotation, never `click`. Measured
  in the browser on `attachments-ocg-sample.pdf`: either path produced one 65-byte `text/plain` blob and
  one anchor click with `download="note-from-page-2.txt"`, console clean. It cost **+0.29 kB** on core,
  which is where the save now lives — and bought attachments a cheaper over-core figure (1.29 → 1.08).
  **The review after that found a worse one, in the packaging.** `layers.css` and `attachments.css` were in
  the export map and the docs and never in `dist/` — the asset step still listed only the four sheets from
  `0.4`. Nothing in-repo could see it: `tsconfig.json` resolves `pdfjs-react-reader/*.css` onto `src/`, so
  typecheck, the playground and both docs builds all read the real file, and `check-size.mjs` sums files per
  *entry*, so an absent sibling sheet is invisible. Fixed by emitting both, generating the `declare module`
  list from the same array, adding an assertion that every `exports` target exists (failure proved against a
  made-up path), and importing all six sheets in `scripts/consumer-smoke`, which had checked only
  `styles.css` since `0.1.2`. **The lesson is about the gate, not the typo**: an in-repo green run proves
  nothing about the artifact, which is why the consumer build exists at all.
* **Landed: search depth.** Multi-word queries require **all** words on a page (pdf.js's own rule),
  `regex: true` compiles the query as an expression, an uncompilable pattern says `Invalid pattern`
  instead of "no results", and `counts` / `pagesWithMatches` give per-page totals. Measured on the
  14-page test document: `trace` → 416 matches, `trace monkey` → 401 (pages with one word and not the
  other drop out), `^Trace-based` in regex mode → exactly 1 on page 1.
  **One planned item was already true.** "An all-match count" existed: `search()` extracts every page
  before publishing results, so `total` was always document-wide. The premise was wrong, not the code.
* **Landed: the find controller is replaceable.** `PdfFindController` is `usePdfSearch`'s result type,
  and `PdfViewer`'s `find` prop accepts anything that satisfies it; the bar, the marks and Enter
  navigation read the host's answers. Demonstrated in the playground (`HostFind.tsx`, "host find
  results"), which reports 3 where the engine reports 416 — the only version of that proof that
  cannot pass by accident. Cost of all of the above: **core 22.14 → 22.59 kB**.

* **Landed after the close: `Automatic` zoom, which completes `FR-06`.** `ScaleMode` gained
  `'automatic'`, a zoom-select option, and `handle.fitTo('automatic')`. The rule is
  `automaticFitMode` in `src/lib/layout.ts`: a page wider than tall fits as a whole, a page tall as it is
  long fits by width, and orientation is read *after* the user's rotation, because a turned page is the
  shape the reader sees. Width-fit wins the square case. Pure and unit-tested, because the interesting
  part is the tie-break and the rotation interaction, not the arithmetic. The reason it is orientation
  rather than "the smaller of the two fits" is that min(width, height) fit *is* page-fit, so it would
  have been a third name for an existing option — a wide page fitted by width pushes its foot off screen
  and turns one page into three scrolls, which is what this mode exists to avoid.
  **This was found by a document review, not by a user.** `PRD` had asked for it since §4.1 and every
  release plan since `0.1` claimed the requirement range was met.

### 0.5.0 — closed 2026-09-26

Cumulative measured cost of the release and the work that closed after it, gzipped, worst of esbuild
and Rollup: core **20.61 → 22.97 kB** (+2.36 — memo 0.08, controller 0.51, context and parts 0.15,
controls 0.32, shared layer config and repaint 0.45, search depth 0.45, attachment save 0.29,
`Automatic` zoom 0.09, two catalog strings 0.01 — which sum to 2.30, and the gap is exactly what
measuring the whole rather than adding up the parts is for). Over core: print 2.49,
download 0.71, forms 1.96, outline 0.90, layers 1.16, attachments 1.07; all six 7.35. Entry sums:
shell 48.29, headless 25.78. 288 tests. The baseline was re-accepted once, at the end, for the
attachment save, the catalog strings and `Automatic` together. Download and attachments each got
*cheaper* over core while core grew, because `downloadBytes` and the MIME guess they both need are now
core code — the paperclip annotation shares them with the attachments tab.

**Compound components shipped in a different spelling.** This section asked for `PdfViewer.Root` /
`.Toolbar` / `.Page`; what shipped is `ViewerRoot` / `ViewerToolbar` / `ViewerSidebar` / `ViewerPages`
plus `ViewerProvider` and `useViewer`, all exported from `src/index.ts`. Same composition, no namespace to keep in
sync with the flat exports, and a host importing `PdfViewer.Root` would be reaching for the component
they could have imported. Recorded as a decision, not an oversight.

**Verification limit for this release, stated rather than glossed.** The layers work is verified
structurally — DOM state, the operator list, and canvas attribute mutations proving a repaint was
requested — because the automation browser used for the pass has `visibilityState: 'hidden'`: no
animation frames, no compositor surface for screenshots, and canvas readback that returns stale buffers
(a claim that "the stamp band stays blank" was measured, found unsound, and withdrawn). The visual
half needs someone to open a window.


### 0.6.0 — Mark: annotation authoring ✅ built 2026-09-26 (local `dev`; pushed and published with 1.0.0)
No new dependencies. Gated on Spike A.

**Spike A, first pass (2026-09-26) — what is settled and what is not.** Driven from a scratch harness
(`playground/spike-editors.html` + `src/spikeEditors.tsx`, temporary) against `form-sample.pdf` on
6.3.289:

* `getDocument`, `getPage`, `AnnotationEditorLayer.render()` and `AnnotationEditorUIManager.updateMode()`
  all succeed with our own worker resolution, so the plumbing we already have is sufficient to reach the
  editor stack. `STAMP` reached the created-editor step with null collaborators.
* `AnnotationEditorLayer` registers itself with the manager in its constructor (`uiManager.addLayer`) —
  a harness or feature that also calls `addLayer` would double-register. The layer's `#editorTypes` map
  holds five classes — FreeText, Ink, Stamp, Highlight, Signature. **The inference drawn from that, that
  underline, strikeout and squiggly must therefore be HighlightEditor subtypes, was wrong** — see the
  second pass.
* **`textLayer` is not the container node.** `AnnotationEditorLayer.disable()` reaches for
  `this.#textLayer.div.addEventListener`, so the option is a layer-shaped object — passing the div throws
  in the constructor's `uiManager.addLayer` → `layer.disable()` path before any editor exists. `DrawLayer`
  wants the opposite (`#textLayer.isConnected`), i.e. the node. Passing `{ div: textDiv }` got the whole
  stack constructing and rendering.
* With the stack constructed, each type then failed on a collaborator the official viewer owns: highlight,
  ink and signature all die on `null.updateProperties` — the `DrawingOptions` live on the **draw layer**,
  so no tool that paints can work without one — and free text dies on a separate `undefined.toggle`.
  **STAMP alone got as far as a real editor**: `storage keys = 1`, then `saveDocument()` threw
  `Cannot destructure property 'imageRef' of 'n.image'`, because a stamp created with no image has nothing
  to serialize. That is a rule for the feature, not a bug to route around: a stamp tool must not offer an
  empty stamp.
* **Consequence for the plan:** the standalone harness cannot reach the persistence verdict, because the
  verdict depends on wiring that only the shell has. So the order flips — build the real `PdfPage` wiring
  first (draw layer with its filter factory, the text layer as a layer object, the accessibility manager)
  and measure `saveDocument()` through it. That measurement remains the gate: **nothing in `0.6` may
  claim a type persists until it is taken.**
* The package root exports **no `EventBus`**, so a host cannot construct one the way the viewer does;
  the manager was handed a recording stub and dispatches `annotationeditorparamschanged`,
  `editingstateschanged`, `editorsrendered` and `reporttelemetry`. That is the event surface
  `onAnnotationChange` should be built on rather than invented.

**Spike A, second pass (2026-09-26) — the gate, taken.** Driven through the mounted viewer
(`playground/src/spikePersist.ts` + `spikeSetup.ts`, temporary) against `annotated-sample.pdf`, with the
manager read off the `.pjsr-editor-layer` fiber rather than from a copy, so what is measured is the wiring
the shell actually builds. The fixture had to be fixed first: its generator wrote each popup to `num + 50`
while the page referenced `num + 100`, which both dangled four references and overwrote objects 60–61 —
the page content streams. The document loaded, rendered a text layer and reported *zero* annotations, and
the only reason that was noticed is that the spike asked for a count. The generator now resolves every
reference and points at every xref offset before it writes (`.spike`-verified: with the old `num + 50` it
exits 1 naming the two dangling refs).

Verdict per editor type, `saveDocument()` followed by reopening the returned bytes and counting subtypes
(baseline 1 each of Highlight, Underline, StrikeOut, Squiggly, Text, Ink, FreeText and 7 Popups):

| Type | Created | In storage | Survives the save |
| --- | --- | --- | --- |
| Highlight (from a real text selection) | yes | yes | **yes** — 1 → 2 |
| Ink (cloned from a real `/Ink` via `serialize(true)` → `deserialize`) | yes | yes | **yes** — 1 → 2 |
| Free text (same clone route) | yes | yes | **yes** — 2 saved bytes: 6,058 → 8,585 |
| Stamp (`pasteEditor` with a generated PNG) | yes | yes | **no** — the save throws on `imageRef` |
| Signature | yes | yes | **no** — the save throws in `serializeDraw` |
| Underline / strikeout / squiggly | **cannot be created** | — | — |

* **There is no subtype.** `AnnotationEditorType` in 6.3.289 is FREETEXT, HIGHLIGHT, STAMP, INK, POPUP,
  SIGNATURE and COMMENT; `AnnotationEditorParamsType` has no `HIGHLIGHT_TYPE_*`; the editor sources contain
  no `subtype` token at all. So the first pass's five-classes inference was wrong in both directions: a
  reader cannot draw an underline, and cannot edit one either — the worker reports
  `isEditable: false` for `/Underline`, `/StrikeOut`, `/Squiggly`, `/Text` and `/Popup`, and `true` only
  for `/Highlight`, `/Ink` and `/FreeText`. Those three are exactly the editors `layer.enable()` produced
  from the fixture's nine rendered annotation elements, so our wiring is complete as far as the engine goes.
* **An untouched annotation stays untouched.** Each converted editor reported `serialize(false) === null`
  while unmodified, so it never entered `doc.annotationStorage` and the saved bytes still held one
  annotation of that subtype, not two. Editing an existing annotation therefore replaces it rather than
  stacking a copy on it — which is what the `annotationElementId` link is for.
* **Four collaborators the shell has to supply, each found by a throw rather than by reading:**
  `AnnotationLayer` must be given the manager (it registers `#editableAnnotations` and calls
  `renderAnnotationElement` only when it has one); the editor layer must be given the *annotation layer*
  (`enable()` converts `getEditableAnnotations()`, and null means nothing to convert); `DrawLayer` needs
  `page.filterFactory` **and** a `setParent()` call, which pdf.js never makes for itself — the first
  editor otherwise dies on `null.append` inside `#createSVG`; and the manager's highlight-colours argument
  must be a non-empty `NAME=RRGGBB` string, because it memoises to `null` when absent and the first
  `layer.add()` then dies in `getNonHCMColorName` while building telemetry.
* **`.textLayer` is load-bearing, measured both ways.** pdf.js finds the layer a selection belongs to with
  `target.closest('.textLayer')`, six times over. On the same span with the class: one editor added. With
  the class removed and everything else identical: zero. The viewer's own sheet therefore carries the
  engine's class alongside ours on the text layer container.
* `data-main-rotation` needed no host work: pdf.js's own `setLayerDimensions` writes it, measured as `"0"`
  on our text layer and feeding `getSelectionBoxes`' rotation math.
* **The engine's selection toolbar is hidden by our sheet, and the reason is measurable.** Every one of its
  buttons carries a `data-l10n-id` and nothing else — the viewer passes `l10n: null` to the layer, so the
  only button on a selected highlight (`pdfjs-editor-colorpicker-button`) reports an accessible name of
  `null` — and its glyphs come from `url(images/…svg)` in the engine's own folder, which this package does
  not ship. Its position depends on a CSS custom property the engine writes into an inline `calc()`: with
  `--editor-toolbar-vert-offset` absent the whole `top` declaration is invalid, and measured the toolbar sat
  inside the mark. Move, resize and keyboard delete need none of it, so it is hidden and named as a gap
  rather than shipped nameless. Colour and a labelled delete belong in the viewer's own bar, where both can
  be translated: that work is `#118`.
* **What `0.6`'s editor layer costs.** `annotateFeature` bundles to **1.85 kB gz over core** against the
  4 kB per-feature gate — the 0.87 kB first recorded here was the three tools alone, before `#120`'s
  colour select and Delete — and is now one of the seven measured paths in `check-size.mjs` with the marker
  `createEditorEventBus` — absent from core, present in its own, in both bundlers. Before this the feature
  was in the export map but not in the marker list, so a static import of it by the shell would have passed
  CI. `annotate.css` is the seventh sheet (11,648 B source → 3,891 B minified) and, like the others, is
  asserted to exist by the asset step and imported by the consumer smoke app.
* Of the manager's sixteen arguments, the ones this feature leaves null are read through optional chaining,
  except `editorUndoBar`, which pdf.js assigns and never reads. `viewerAlert` being null is a real gap, not
  a cosmetic one: `a11yAlert` returns early, so no edit is announced to a screen reader. Tracked under the
  accessibility work below.
* The signature verdict is not "needs more UI": `SignatureManager` is not among the 62 names
  `pdfjs-dist` exports from its root, so a host cannot build one. Signing stays out of `0.6`, and the
  measured reason is in the tool type's comment.
* **Harness note for anyone repeating this:** the automation tab reports `innerWidth: 0`, so the run needs
  a forced layout box (the spike styles `.app-viewer`/`.pjsr-viewer` to 1040×820) *and* must avoid
  centre-based creation — `#getCenterPoint` clamps against `window.innerWidth` and hands back negative
  page coordinates there. Explicit `{offsetX, offsetY}` is what a real pointer event would have carried.

So `0.6` is:

* Wire `AnnotationEditorLayer` + `AnnotationEditorUIManager` into `PdfPage`, replacing the `null` it
  passes today: **highlight, free text and ink** — the three the engine can create and the three now
  measured to survive a save.
* Create, select, move, resize and **delete** annotations, including the pre-existing `/Highlight`,
  `/Ink` and `/FreeText` ones.
* Interactive popups — `.popupAnnotation` is `pointer-events: none` today in `src/styles/viewer.css`, which
  is the rule that keeps the layer from swallowing page interaction.
* `enableXfa: true` and `XfaLayer` so XFA documents display at all.
* `onAnnotationChange` events, plus re-export of the editor classes from `/headless`.
* Annotation keyboard accessibility, including the live region the manager needs for its announcements.
* Ships as a **feature from `0.4`**, not shell code, so apps that never annotate don't pay for it.

**Architecture, decided 2026-09-26.** One constraint sets the shape: `feature.pageProps()` is merged
once and handed to *every* page, so it can only ever carry document-wide things. The editor stack splits
along exactly that line.

* **The feature's `Runner` owns the document-wide pieces** — one `AnnotationEditorUIManager`, the active
  tool, and the event emitter — mounted once per viewer, destroyed when the document changes. This is the
  same authority `formsFeature` holds over annotation storage, and it is why controls can render three
  times without tripping over state.
* **`PdfPage` owns the per-page pieces** — the canvas's wrapper `div`, this page's `DrawLayer`, and its
  `AnnotationEditorLayer` — because those are per page by nature and the page already builds the text and
  annotation layers they attach to. The merged page props carry exactly one thing, the manager
  (`annotationEditorUIManager`), and its presence is what makes a page build an editor layer at all: the
  active tool is React state in the Runner, which forwards it to the manager through `updateMode`, and the
  storage is the document's own, so neither belongs in a page prop.
* **The event bus is ours.** `pdfjs-dist`'s root exports no `EventBus`, so the feature hands the manager a
  small emitter it writes itself — which is also what makes `onAnnotationChange` possible: the manager's
  own `editingstateschanged` / `editorsrendered` / `annotationeditorparamschanged` come back through it,
  and the feature narrows those to one documented viewer event rather than leaking four engine names.
* **The manager is given the viewer root and a `classList`, not a page-view registry.** It was planned
  around `getPagesVisible()` / `getPageView()` / `scrollPageIntoView()`; measured, the only thing it takes
  from the viewer argument is `classList.toggle('noUserSelect', …)`, so the stub is
  `{ classList: root.classList }` and the container is the same root, handed to the feature as
  `shell.rootRef` rather than as a node so that reading the shell costs nothing before mount.
* **`textLayer` is passed as `{ div }`** — the layer's own `disable()` reaches `textLayer.div` — while
  `DrawLayer` takes the node itself. Getting these two the wrong way round produces a constructor-time
  throw with no hint of the cause, which is what cost the spike its detour.
* **Storage is shared, not duplicated**: editors write into `doc.annotationStorage`, the same store
  `formsFeature` reads, so an edit and a form value cannot disagree, and print and download already carry
  both.
* **Stamp and signature are out, on measurement rather than on taste.** Both reach `annotationStorage` and
  then break the save for the whole document — `imageRef` for an empty stamp, `serializeDraw` for a
  signature with no `SignatureManager` behind it — so the rule is not "refuse an empty stamp at the tool"
  but "do not offer a tool whose half-finished state corrupts a download". `SignatureManager` is not
  exported by the package root, so signing cannot be finished here at all.

**One ink tool, decided 2026-09-26, and what had to be measured first.** The feature's ink and the shell's
`draw` control do the same gesture with different consequences: the overlay prints but never reaches a
download, the annotation does both. Offering both is how a reader loses work, so `PdfFeature` gained
`replaces`, the shell folds those ids into the same `hide` list the application writes
(`withReplacedControls`), and `annotateFeature` declares `replaces: ['draw']`. Verified in the browser from
one known state: annotate off → `Draw on document`; on → `Highlight / Add text / Ink` and no draw; off again
→ draw back. Nothing was deleted, so no host that does not mount `annotate` lost a byte or a control; the
retirement question for the now-duplicated overlay machinery is `#124` at the freeze.

The fold had one risk that had to be settled before hiding anything: that an editor's ink, having no
replay in the print pipeline, would print blank. Measured on the operator list rather than on pixels
(this tab's canvas readback is not trustworthy) — page 2 print-intent fetch: **41 ops with an empty
`annotationStorage`, 48 with one `/Ink` authored by the editor**, with the cache control in place (a second
fetch through a fresh `doc.annotationStorage.print` instance returned the same key and the same 41, so the
key is content-derived and the two fetches are the same request shape). `separateAnnots` stayed
`{form: false, canvas: false}` either way, which is the same answer the print pipeline already relies on.
So pdf.js draws stored ink itself at print intent, and the fold is safe.

The same fetches found a defect, filed rather than fixed here: the display-intent list is **48 ops plain,
16 with `isEditing: true`**, keys differing — pdf.js leaves annotation drawing out of the canvas when told
an editor is on screen, and `PdfPage` never says. `#123`.

**#122 — do editors survive the shell? (2026-09-26.)** One authored editor of each kind, then zoom
100 %→110 %→fit-width, a 90° turn, and `single`→`spread`→`continuous` (the layout switch is the unmount
lever, because scroll-driven mounting cannot be reached in this tab: the handler defers its state update
into a frame that never arrives). Every stage re-read the manager, the annotation storage and each editor's
box relative to its own page. **Zoom and unmount pass cleanly**: three editors stayed in the manager and in
storage the whole way, detached exactly when their page unmounted (`layout-single` → one layer, one page,
page 2's editors `attached: false` but still in storage), and came back with identical page-relative
geometry. The same DOM node came back, not a rebuilt one — each `div` was stamped with its editor id before
the churn and the stamp survived all eight stages, which is the re-adoption `render({viewport})` is for. A
final `saveDocument()` after everything: **8,606 bytes, Highlight 2 / Ink 2 / FreeText 2, every other
subtype at its baseline** — nothing lost and nothing duplicated by the rebuilds.

**Rotation failed, twice, in two different places.** First the layer: pdf.js writes `data-main-rotation` on
`.pjsr-editor-layer` just as it does on the text and annotation layers — measured `"90"` with
`transform: none` — so the page turned (792×612) and its marks stayed in unrotated space. `annotate.css`
now mirrors the core sheet's three swap rules for that layer, and the fix is measured rather than assumed:
a mark authored upright still covers its words after the turn (span `747,72,16×268`, editor
`746,71,19×269`), with the same probe reporting `71,27,269×19` — misaligned — once the rule is disabled at
runtime. Second the authoring path: a highlight **made while the page is turned** displayed across its own
text — editor `926,89,330×19` over a span at `909,90,15×329`.

**The second failure was not the stylesheet, and not the data.** Marking the same sentence upright and then
at 90° produced page-space data that agrees to 0.2 pt (`rect [71.3,723.7,334.8,738.6]` against
`[71.3,723.9,334.8,738.9]`), so a reader's download was never at risk — this was placement only. Disabling
the per-editor rule at runtime put the turned-authored mark exactly on its words (`908,89,19×330` against a
span at `909,90,15×329`), which names the cause: pdf.js tags such an editor `data-editor-rotation="270"`
for a viewer that leaves the **layer** unrotated and turns each box instead, and we turn the layer, so the
mark was transformed twice. `annotate.css` therefore carries no `[data-editor-rotation]` rules — the
deliberate omission is commented where the rules would have been — and the shell now drives scale and
rotation through the bus (`scalechanging`/`rotationchanging`, the events the manager registers in its
constructor and does real work in) rather than assigning `viewParameters`, which had also been setting
`realScale` 1.3333× low. Measured after: all four states — upright, turned, authored-while-turned, back
upright — report their mark covering the text, and `realScale` is the engine's own `scale × PDF_TO_CSS_UNITS`
(1.6225 → 2.1634). The one number it left unmeasured — whether an ink stroke's on-screen width tracks zoom — is
taken in `#123`'s section below, and it does.

**#118 — popups, keyboard access, announcements (2026-09-26.)** Three fixes, one retraction.
* **A note could be seen but not used.** The engine's own sheet pairs `pointer-events: none` on the popup's
  container with `pointer-events: auto` and `user-select: text` on the note itself; our port had the first
  half and then `user-select: none`. Measured after the fix: `pointerEvents: auto`, `userSelect: text`,
  `cursor: text`. The hit-test I also wrote for this came back `null` — a 0×0 window has no point to hit —
  so the computed styles carry the claim, not that probe.
* **Announcements needed our own words.** The manager's alert argument was null, which silenced
  `a11yAlert`; but handing it a plain element would not have helped either — it writes only
  `data-l10n-id`, which conveys nothing while `l10n` is null. The Runner now creates a clipped
  `role="status"` region, observes that attribute, and writes the mapped catalog string into it
  (`highlightAdded` / `freeTextAdded` / `inkAdded`), then clears the attribute so a second highlight of the
  same kind is a mutation and not a no-op. Measured: `"Highlight added"` after one mark, again after the
  second, no leftover attribute.
* **Focus and selection are now visible on the mark**, which they must be because this viewer hides the
  engine's toolbar: rules in the CSSOM, and a focused editor reports `outline-style: solid`, a selected one
  `1.6px` (reported value; `dpr` rounding) in `--pjsr-accent`.
* **Retracted: "annotations are unreachable by keyboard".** I read the popup's `click`/`pointerenter`
  bindings, found no `Enter` among them, wrote a keydown bridge — and the measurement then showed Enter no
  longer toggling. `PopupElement.#keyDown` already binds `Enter` (and `Escape` when pinned) on the
  annotation container, so my handler was toggling it twice. Removed; re-measured without it: three Enters,
  three `hidden` flips, focus retained, and Enter on a non-popup annotation does nothing and throws nothing.
  The bridge was ~20 lines of new behaviour in `PdfPage` that the engine already provided — the usual cost
  of inferring a gap from a source read instead of testing the baseline first.
* Delete-by-keyboard was confirmed working while I was there: with an editor active
  (`uiManager.setActiveEditor`, which is what registers a selection — `editor.select()` alone does not), a
  `Delete` keydown took the count from 2 to 1. A labelled delete button in the bar is now cheap, since
  `hasSelection` is available from `editingstateschanged`; it belongs with the colour control in `#120`.

**#123 — who paints the mark.** `page.render` now receives `isEditing`, and a spy on `PDFPageProxy.prototype.render`
says so rather than the code implying it: arming produced `p1 isEditing=true` and `p2 isEditing=true` in one commit,
disarming `isEditing=false` for both — exactly one call per mounted page per toggle. What the flag takes out of the
canvas is the worker's `isEditable` set and nothing else: page 1 goes from 80 operators to 71 (its one highlight
leaves, its underline, strikeout, squiggle, note and five popups stay), page 2 from 41 to 16 (ink and free text
leave, both popups stay). The other half of the claim is that what left is still painted, measured with a tool
armed: each editable annotation is held by an editor whose `annotationElementId` names it
(`Highlight/10R` → `_HighlightEditor`, `Ink/15R` → `_InkEditor`, `FreeText/16R` → `_FreeTextEditor`), each attached
to its page with a box (489×29, 165×64, 191×42), and each annotation's own layer element reporting `hidden: true`.
After disarming, the editors are gone — the engine `remove()`s a converted editor that has not been modified, in
`AnnotationEditorLayer.disable()` — and all three elements read `present hidden=false`, so the canvas paints them
again. Nothing is ever painted by nobody: the pairing is the engine's own, because `updateMode` reaches
`#enableAll()`/`#disableAll()` for the same predicate `annotationEditorEditing` reports (`mode !== NONE`), and the
reference viewer computes it identically at `web/pdf_viewer.mjs:9732`.

* **Retracted: "arming costs 4 repaints per page pair."** It costs two renders for two mounted pages, and the four
  came from my oracle: a `MutationObserver` reads `target.width` at *callback* time, so all four records reported
  the value the canvas had already settled on. Shadowing the `width` accessor on each canvas logged the real
  sequence — `c0 → 0, c1 → 0, c0 → 1241, c1 → 1241`, every write from `PdfPage` itself (the cleanup releases the
  pixel buffer, the next run sizes it) and none from pdf.js in this path, which takes the canvas dimensions it is
  given. Re-running the original counter with `attributeOldValue: true` reproduces it: two `1241→…` and two
  `0→1241`. The fix was to the measurement, not to the component; there was no doubled render to find.
* **The arm race, timed rather than assumed:** the render call goes out at 17 ms, both pages' editors exist by
  18 ms, the repaints settle at 26 ms. So the transient is ~8 ms of the mark painted twice, not a window where
  nobody paints it — the benign direction, and why the reference viewer's `pagerendered` barrier
  (`web/pdf_viewer.mjs:9741`) is not worth porting yet.
* **Filed as `#126`: the repaint is document-wide.** `annotationEditorEditing` knows nothing about pages, so arming
  re-renders every mounted canvas. On `outline-sample.pdf` — three pages, two mounted, **no annotations at all** —
  that is still two renders with `isEditing=true` and zero editors produced, pure cost. The viewer guards it with
  `hasEditableAnnotations()`; we could too, off the annotation list `PdfPage` already fetches, but the pressure
  case is a long document and the fixture that shows it is `#114`.
* **Closed on the side: the ink width `#125` left unmeasured.** It tracks zoom, to four decimals: the draw layer's
  svg carries `stroke-width = thickness × realScale`, its path carries `vector-effect: non-scaling-stroke` so the
  value lands in screen pixels, and the three zooms measured 4.3268 → 4.66667 → 5.33333 px against `realScale`
  2.1634 → 2.3333 → 2.6667 — ratios 1.0785 and 1.2326, identical to the scale's own. The same page carries a
  suggestive neighbour: the shell's own freehand layer reads `stroke-width="3.2451"` at that moment, which is
  `thickness × scale` without the `96/72` — the same 1.3333 factor `#125`'s `realScale` bug carried, arriving
  instead from a unit convention (that tool's width is a screen-pixel choice, this one a PDF point). Not a defect
  in either, and one more reason `#124` has to pick one of the two inks rather than keep both.

**#114 and #119 — XFA composes, and the fixture records why it took three tries.** `0.3` wrote that pdf.js's
parser rejects a hand-written packet. That was true of *that* packet and it is not true in general:
`playground/fixtures/xfa-sample.pdf`, built by `scripts/make-xfa-pdf.mjs`, renders. Four conditions gate the path
at all (`get xfaFactory`, `pdf.worker.mjs:60003`): `enableXfa`, `/NeedsRendering true` on the **catalog**, an
`/XFA` entry in the AcroForm, and **no `/Fields`** — a document with both is an AcroForm wearing an XFA hat and
never reaches the parser. The two capability flags `0.3` reports are computed from that same pair, and the
fixture reads `IsXFAPresent: true`, `IsAcroFormPresent: false`, which is the whole point of surfacing them.

* **Three shapes, each found by a failed run rather than by reading the spec.** The datasets island needs the
  `<data>` wrapper (`Binder` reads `root.datasets.data`, and `DatasetsNamespace` knows only `datasets` and
  `data`). The page box comes from `<medium short="500pt" long="700pt"/>` and from nowhere else —
  `PageArea[$toHTML]()` checks `this.medium`, warns *"XFA - No medium specified in pageArea: please file a bug"*
  without it, and the page div then has no size, so `XFAFactory.dims` are `NaN`. And a data element named
  `name`, `length` or `prototype` kills the parse with `DatasetsNamespace[e] is not a function`: the factory is
  a **class**, so `Object.hasOwn(DatasetsNamespace, 'name')` is true and the "element factory" it finds is
  `Function.name`. `<name>` is an ordinary field name in real forms, so that one is a pdf.js bug; the fixture's
  fields are `applicantName`/`applicantCountry` and the generator's self-check fails if a datasets element ever
  collides again.
* **The failure mode is the finding, not the shapes.** None of the three shows up as a degraded render. Layout
  throwing is caught inside `_createPages()`, which leaves `dims` undefined, and the *next* line —
  `getNumPages()` reading `this.dims.length` — rejects the **load**. Both bad attempts surfaced as
  `UnknownErrorException: Cannot read properties of undefined (reading 'length')` with no document, no
  capabilities, and no hint about the template. So with `enableXfa` on by default (ours, and the viewer's), a
  document whose template pdf.js cannot lay out is one the shell cannot open at all. `Compatibility` has to say
  that, because "we render XFA" would otherwise imply a graceful path that does not exist.
* **What the shell did before, measured rather than remembered.** An XFA document in `0.5`'s viewer showed
  **zero text spans and zero canvas operators** — a blank sheet. `0.3`'s "renders nothing" was right about the
  outcome and wrong about the mechanism: `page.getTextContent()` *does* return the XFA strings (it
  short-circuits to `XfaText.textContent`), which is why search can index such a document, while the text
  layer's `page.streamTextContent()` has no XFA branch at all, which is why nothing was painted.
* **The wiring.** `PdfPage` renders the tree into a child div of `.pjsr-xfa-layer` and keeps that div in a ref,
  because `XfaLayer.render` **appends** — rendering the same div twice gives 40 elements where one gives 20,
  measured — and re-uses it through `XfaLayer.update`, which only re-applies the transform, exactly as
  `XfaLayerBuilder` does. The text layer is skipped for these pages, as the reference viewer skips it
  (`!pdfPage.isPureXfa`, `web/pdf_viewer.mjs:7165`): the layer holds the form's own words and a second copy
  would be selectable twice. Two stylesheet facts: the geometry of every node arrives inline from the template,
  so the ported rules only position the layer and style the widgets; and `.xfaLayer` must be given
  `position: absolute; top: 0; left: 0; transform-origin: 0 0` over a `position: relative` `.xfaPage`, without
  which the form flows *below* the canvas — measured at 806 px down the page before the rule was written.
* **Measured after.** The fixture's MediaBox is 612×792 and its template box is 500×700; the mounted page is
  500×700 (`pageInfoView [0, 0, 500, 700]`), so the **template drives the geometry and the shell's layout math
  follows it unchanged** — no `getXfaPageViewport` equivalent needed. The layer's box is the canvas's box
  (`0,0,993×1390` at scale 1.986), two `<input>`s carry the bound datasets values (`Ada Lovelace`, `United
  Kingdom`), and 21 elements is the count at every stage: after a zoom step to scale 2 the same div still holds
  21, the field keeps the typed value and the caret, a 90° rotation moves the field inside the turned page
  (`146,173,26×346`, transform `matrix(0, 1.44, -1.44, 0, 1008, 0)`), and rotating back reproduces the upright
  boxes exactly. Selection works on layer text, and with the annotate feature enabled the toolbar shows **no**
  annotate control while the page still composes — the `isPureXfa` gate from `0.3` doing the job the reference
  viewer does with a console warning. Cost: core 23.39 → **23.60 kB**, shell 49.46 → **49.96 kB**.
* **Two gaps, both filed rather than smoothed over.** `#127`: saving an edited XFA document throws
  (`Cannot read properties of null (reading 'toString')`), which may be the engine's XFA-packet rewriter
  needing an array-form `/XFA` entry that this single-stream fixture does not have — so the sentence "XFA
  persistence is excluded" is still unmeasured, and the docs must not claim either way. `#128`: search marks
  and thumbnails both read the canvas, so on an XFA page a match is found but nothing is highlighted and the
  sidebar thumbnail is an empty 132×185 buffer.
* **One harness fact that cost a detour.** There is no warning channel to read: 6.3's
  `PDFDocumentLoadingTask` has `onProgress` and `onPassword` and **no `onWarning`**, and the worker's `warn()`
  is a `console.warn` inside the worker, so `XFA - No medium specified in pageArea` and
  `DatasetsNamespace[e] is not a function` were visible only in the tab's console log. Two consequences for
  how diagnostics are built here: the page must be asked for its own `getXfa()`/`getTextContent()` when the
  goal is to see what the XFA path produced (`page.htmlForXfa` is not a thing in this version — it is
  `getXfa()`, and the document-level one is `allXfaHtml`), and a spike that loads a document through the app
  must prove the *new* document mounted, because polling for "a canvas exists" answers immediately from the
  one already on screen. The `xfa` probes measured a stale thesis paper that way before the poll was fixed.
* **Cost.** Core 23.39 → **23.60 kB gz**, shell 49.46 → **49.96 kB**, `all` 31.78 → 31.98; the XFA rules
  ride in the core stylesheet, because a page's rendering cannot be an opt-in the way a toolbar control can.

**#120 — the host's event, two controls, and a save gate that was never looking at annotations.** What
shipped: `onAnnotationChange` on the shell, derived from the manager's own `editingstateschanged`; a
highlight-colour select and a Delete in the annotate group; `readEditingState`, `readEditingParams` and the
palette out of `lib/editing-state` and through both barrels; the label catalog 106 → **115** keys across
`0.6`, two of them this task's (`deleteAnnotation`, `highlightColour`). The
event needs no plumbing of its own because the manager merges every dispatch into its previous state and
fires only on a difference, so the viewer hears about a keyboard delete exactly when the engine considers
one to have happened.

* **The colour bug was silent, and the first explanation of it was wrong.** A palette value written
  `FFFF00` is valid input to pdf.js's parser and invalid as a paint, and an invalid `fill` resolves
  *through inheritance* rather than failing — so a reader's highlight was a black bar over their text. My
  first report said the mark was invisible; measured against the fix it was `rgb(0, 0, 0)` where
  `#FFFF00` gives `rgb(255, 255, 0)`. The palette now carries its `#`s and
  `editing-state.test.ts` asserts the built string's shape, because the failure mode is a page that looks
  vandalised rather than an error.
* **One dispatch covers both cases a colour control can mean.** `switchannotationeditorparams` reaches
  `updateParams`, which recolours the *selected* editors and, with nothing selected, sets the default for
  the next mark — so the viewer needs no mode logic to make "recolour this" and "paint the next one this
  colour" the same control. The swatch reads back through `annotationeditorparamschanged`, which is why it
  can show the colour of a mark this viewer did not make.
* **`setActiveEditor` does not select, and a probe that assumed it did produced a false reading for a
  while.** It sets the private `#activeEditor` and pushes `propertiesToUpdate` at the UI; `#selectedEditors`
  — what `hasSelectedEditor`, and so `canDelete`, reports on — is filled by `selectAll`/`#selectEditors`.
  Re-measured through the real path: Delete is `disabled` in **both** DOM copies of the group at rest, live
  the moment a mark exists (creating one selects it), live under `selectAll`, and after the click editors
  `2 → 0`, svg marks `2 → 0`, storage `4 → 3`, disabled again, and the host log reads
  `delete=true → delete=false`.
* **Deleting a mark the file already had is not the same as deleting one the reader made.** Two editors went
  away and only one storage entry did, because `removeEditor` drops a new editor's entry and keeps the one
  carrying an `annotationElementId` — a pre-existing annotation has to be *recorded as deleted* or the save
  puts it back. Unmeasured before this; it is the reason a deletion survives a round trip.
* **`isEmpty` is not "unchanged", and the sentence in the prop's docs is now measured.**
  `HighlightEditor.isEmpty()` is `!lines.length`, and `#isEmpty()` asks the whole document: zero editors is
  empty, one editor defers to it. So a mark made over a whitespace text span — which is what
  `spans[0]` of a pdf.js text layer often is — is an **empty** editor, and the state says empty with a mark
  visibly on the page. After every mark is deleted, `isEmpty` is true while `canUndo` is still true. A host
  that gated Save on `isEmpty` would therefore lose work on close, which is the reason the event publishes
  both rather than one merged flag.
* **The defect that mattered: the download control never saved annotations.**
  `download({ withFormValues })` chose its branch on `forms.isDirty`, and `isDirty` compares *field values*.
  Measured on `annotated-sample.pdf` with one highlight on the page and nothing else changed:
  `getData()` returned 6,058 B with the pristine file's own hash and one `/Highlight`; `saveDocument()`
  returned 7,067 B with two. So a document marked up in a viewer without `formsFeature` — or with it, and no
  field touched — downloaded clean, silently. The gate is now `forms.isDirty || annotate.editing.canUndo`,
  and the fix is asserted at the byte level through the control: untouched → 6,058 B, identical; one mark →
  7,067 B with the second `/Highlight` and an incremental update. `withFormValues` was renamed
  **`saveEdits`** in the same change, because the name is what hid the bug: `saveDocument()` writes the whole
  `annotationStorage`, and field values and marks are the same kind of entry in it.
* **`annotationStorage.size` is the tempting gate and the wrong one.** Arming the highlight tool converts the
  file's own annotations into editors, which puts **three** entries in storage with the reader having
  changed nothing; disarming takes it back to zero. `canUndo` is false in that state, true after one mark,
  false after undoing it and true after a mark-then-delete — which is the right answer in all four cases,
  with the last one saving a file that did not need it. That is the benign direction, and the reason the
  undo stack is the gate.
* **A type that flattered its call sites, caught by the first feature-level DOM test.** `usePdfFeaturePeer`
  was declared to return `S` while the store's `get()` hands back a frozen `{}` until the peer's effect
  publishes — so `annotate.editing.canUndo` threw on the first render of every viewer that mounted both
  features. The hook now returns `Partial<S>`; the crash became four tests in `features/download.test.tsx`,
  one per peer combination.
* **Dead surface, measured before deleting.** `parseHighlightPalette` had no user in `src` — every consumer
  builds the palette string rather than parsing it — and dropping it plus its two re-exports took shell
  51.02 → **50.88 kB** and headless 26.93 → **26.78 kB**, leaving `core+annotate` unchanged at 25.51: the
  bundler had already shaken it out of the feature, so it was only ever costing the entry points that
  published it. Those two shell/headless figures are the readings at that moment; the 50.87 and 26.78
  below are after the download gate, which moved them again.
* **Cost, accepted in the same change.** Shell 49.07 → **50.87 kB**, headless 25.79 → **26.78**,
  `core+annotate` +1.37 and `all` +1.39 over the 0.6 re-baseline, through `npm run size:update`; the
  annotate feature itself is 1.85 kB of its 4 kB gate, and download moved 0.75 → 0.77 for the two-peer ask.
* **Two readings that were wrong before they were right, recorded because both looked fine.** The
  playground log prepends, so a `slice(-3)` of it reported the three *oldest* events of the session and
  appeared to show the delete's effect on state several steps early; and the probe that "proved" a selection
  had made one with `setActiveEditor`. Both were fixed by measuring the engine's own numbers instead of the
  harness's, which is the same lesson `#123` recorded in a different dress.

### 0.6.0 — closed 2026-09-26

Cumulative measured cost, gzipped, worst of esbuild and Rollup: core **22.97 → 23.66 kB** (+0.69 for
the editor wiring every page carries), shell **48.29 → 50.87**, headless **25.78 → 26.78**. Over core:
print 2.53, download 0.77, forms 1.96, outline 0.95, layers 1.19, attachments 1.08, **annotate 1.85**;
all seven **32.75 kB** (+9.09). `annotate.css` is the seventh sheet, 11,648 B source → 3,891 B minified.
The catalog is **115** strings (106 before this release). **313 tests in 25 files**, up from 288. The
baseline was re-accepted twice — once for the feature and its controls, once at the close so the
committed numbers are exact and every quoted figure in README, docs and this file matches them.

**The release's real defect was in the feature that already existed.** Download chose
`saveDocument()` on `forms.isDirty`, which reads field values only, so annotation marks were written to
storage and then left out of the file: 6,058 B identical to the original with one `/Highlight`, against
7,067 B with two. `0.6` shipped the authoring tools; without the gate fix the reader's marks would have
evaporated on save, which is the whole point of the release. It is measured on both sides — the annotate
round trip and a form-field edit that actually differs from the document's own value (5,582 B from the
control, byte-identical to `saveDocument()`, against 5,073 B from `getData()`).

**What the close pass found: nothing broken, and three bugs in its own harness.** All eight fixtures
mount with the right page counts, the editor layer present, and **zero console errors**; the XFA fixture
still reports 21 layer elements, 0 text spans and 0 canvas ink, exactly as `#119` measured. Three
apparent failures were mine, and each was killed by a number rather than by reasoning: a
`.pjsr-password-actions button` selector clicked **Cancel** (the submit is `button[type=submit]`), which
produced `error: "No password given"` and `numPages: 0` — the "encrypted document never mounts" report;
typing `Ada Lovelace` into `fullName` set nothing dirty because that is what the fixture already holds,
which is why that download was byte-identical; and searching for `the` in `outline-sample.pdf` returned
nothing because the fixture's text is "Page 1: Introduction … Phase 4 fixture" — `Page` returns 1 of 3
with two marks on the page, with the editor layer mounted. **The rule this is the third instance of: a
close pass that reports a defect must first show the same oracle passing on an input known to be good.**

**Two things this release does not claim.** Saving an edited XFA document (`#127`) and the cost of
arming a tool on a long document (`#126`, the document-wide repaint). Both are filed with their
measurement, and the docs say so rather than implying the surface is complete.

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
* The performance bar `PRD.md:22` states: a 1,000-page fixture from a generator script, frame timings
  over a scripted scroll, and viewport render time. Nothing here has ever opened a document that large,
  so the sentence is currently a claim and not a measurement.
* Shipped locale catalog; text layer `TextLayer.update()` instead of a full rebuild.
* One docs example per public API, including each tier combination; an upgrade guide; an
  API-freeze review.

### 1.0.0 — GA
Every row of the §Where we are table — all `FR-01`–`FR-28`, where that claim used to stop at `FR-23` —
genuinely green or documented as an explicit exclusion, the `PRD.md:22` performance bar measured on a
document large enough to mean it, and strict semver from then on.

## Opened by the 0.4 review

A three-way review of the finished release (CI, docs, API surface) produced these. None is a defect in
what `0.4` shipped; each is recorded so the later releases inherit the list rather than rediscover it.

* **Closed in `0.5`: the print control printed the whole document.** A scope control now sits beside it
  — All / Current / From–to — with the range resolved by `printRangeFor` and the button's title naming
  what it will send.
* **`findFeatureKey` returns the winning binding but not the feature it came from.** Harmless today;
  `0.6`'s editor layer will want both, to say which feature refused a chord. A return-shape change, so
  it has to happen before the API freeze. **Already satisfied** — checked while designing `0.6`: the
  signature in `src/lib/features.ts:200` is `{ feature, binding } | null` and the loop returns both. This
  bullet outlived the change that fixed it, which is what a review of the review is for.
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

* **Spike A — taken, 2026-09-26.** Each editor type created, `saveDocument()` called, the returned bytes
  reopened and their annotations counted: highlight, ink and free text persist; stamp and signature break
  the save instead of persisting; underline, strikeout and squiggly cannot be created or edited by this
  engine at all. The full result, including the four collaborators the shell has to supply, is in
  *Spike A, second pass* under `0.6.0 — Mark`.
* **Spike B — before `0.7` closes.** Compare candidate writers on size, ESM quality and maintenance,
  and confirm one works as an optional peer the core build never imports.
* Sequencing: `0.2`'s `labels` gates `0.5` (no double string extraction); `0.3` gates `0.6` (an
  editor layer at high zoom is exactly where an uncapped canvas fails); **`0.4` gates `0.5` and
  `0.6`** (toolbar controls become data, and heavy features need a seam to attach to); `0.7` gates
  any further structure work.

## Fixtures we do not have

`playground/fixtures/` holds generated PDFs for forms, outlines, RC4 encryption, CID cMaps,
document-level JavaScript, embedded files plus three optional-content groups
(`attachments-ocg-sample.pdf`, one group off by default), and — added for `0.6` —
`annotated-sample.pdf` (`scripts/make-annotated-pdf.mjs`): page 1 carries a highlight, underline,
strikeout and squiggly over known text plus a sticky note, page 2 an ink stroke and a free-text box,
each with a `/Popup`. Verified in the browser: both annotation layers render, all seven markup classes
appear, console clean.

Also added for `0.6`: `xfa-sample.pdf` (`scripts/make-xfa-pdf.mjs`), a **pure XFA** document — a catalog
with `/NeedsRendering true`, an AcroForm whose `/XFA` is one embedded XDP packet and which has no
`/Fields`, a template with a `<medium>`-sized page area and four marked objects, and a datasets island
that binds two values into fields. Its MediaBox (612×792) deliberately disagrees with the template box
(500×700) so a measurement can tell which one the shell laid the page out from; it composes, and
`#119` renders it. The generator asserts the four container conditions and the packet's shape before
writing a byte, because every one of them was violated in an earlier attempt that then failed as an
opaque load error.

Still needed: a signature-bearing form (a `/Sig` field — the reason `FR-16` stays *partial* above), the
1,000-page document for the `PRD.md:22` performance bar, and a 20-page PDF for reorder. An XFA packet in
the **array** form (`/XFA [ '' <xdp> '/template' … '/datasets' … ]`), which is what real producers write
and what `#127` needs to settle persistence, is also still missing. These should come from generator
scripts like the existing `scripts/make-*-pdf.mjs`, not downloads.

## Policy conflicts to resolve

* **Peer floor — resolved for `0.6`, measured 2026-09-26.** The range had been `^5.0.0 || ^6.2.108`,
  where the 6.x floor came from CVE-2026-16633 (`>= 5.6.83, < 6.2.108`, **no 5.x release fixes it**) and
  the 5.x half was permitted by our own API usage, not endorsed by it. `0.6`'s editor layer is what forced
  the question, and the answer came from parsing `build/pdf.mjs` in each version rather than from the
  type declarations, because Node cannot import that module at all:

  | Version | `AnnotationEditorUIManager` constructor | Editor layer options |
  | --- | --- | --- |
  | 5.0.375 | **14 positional args** — no `viewerAlert`, no `commentManager`, so every later slot shifts | identical ten keys |
  | 5.7.284 | 16 — `(container, viewer, viewerAlert, altTextManager, commentManager, signatureManager, eventBus, pdfDocument, pageColors, highlightColors, enableHighlightFloatingButton, enableUpdatedAddImage, enableNewAltTextWhenAddingImage, mlManager, editorUndoBar, supportsPinchToZoom)` | identical ten keys |
  | 6.2.108 / 6.3.289 | the same 16, same order | identical ten keys |

  Positional parameters mean this is not a detail: one call cannot serve both 5.0.x and 5.7+, because
  5.0.375 would receive `viewerAlert` in the `altTextManager` slot and `altTextManager` in
  `signatureManager`'s — an editor layer configured wrong, silently. `TextLayerImages` is also absent
  from 5.0.375 while everything else in the set exists throughout. So the security floor and the feature
  floor did end up demanding different things, exactly as this bullet predicted, and the clean answer is
  the one it named: **`^6.2.108` only, v5 dropped.** Keeping `^5.7.0` alongside would work signature-wise
  but means advertising a line with no patch for a high-severity engine CVE — supporting it would be
  promising to test a configuration we advise against. Consequences: the CI `consumer` matrix collapses to
  one engine, and the 5.x compatibility branches already in the tree (`normalizeAttachments`' inline
  `content`, the `getAttachmentContent` feature test, the legacy `order`/`groups` fallbacks) become dead
  code to remove as part of `0.6`'s seam work, announced as the breaking peer change the CHANGELOG policy
  requires.
* **v6 runtime coverage.** `0.1.2` verified 6.3.289 by hand in a browser and the CI `consumer` job now
  builds the packed tarball against `^5` and `^6.2.108`. That coverage must be kept: every later
  release should pass on both, and `0.7`'s writer work should be measured on 6.x, not 5.7.284.
* **Breaking `0.4` props.** `enablePrint` / `enableDownload` / `renderForms` change meaning when they
  become features. Permitted pre-1.0, but it must be one deliberate release with a changelog entry,
  not an incidental fallout of a refactor.
* **Changing the unpkg default in `0.3`** is a behavior change. `CHANGELOG.md` counts only API, CSS
  token and supported-major changes as breaking, so a default flip is arguably a minor — decide it
  deliberately rather than by accident.
* **FR-18 asks for "freehand drawing/signatures"; the engine cannot sign.** `PRD.md:122` names signatures
  alongside freehand drawing, and Spike A measured that pdf.js 6.3 will not do it: a signature editor needs
  a `SignatureManager`, which is not among the 62 names the package root exports, and while an editor with
  no signature data sits in the annotation storage `saveDocument()` throws — so offering the tool would put
  a reader's download at risk for a mark they cannot complete. The resolution `0.6` takes is that the
  requirement's drawn mark is served by ink (already shipped: freehand strokes that print and save), a
  cryptographic `/Signature` widget is not in any release, and the PRD row stays as the customer wrote it
  rather than being edited to match what turned out to be possible. If signatures are genuinely required,
  they are a separate feature to price, not a toggle to flip.
