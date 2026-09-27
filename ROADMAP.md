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
| `FR-20` | Document download | `0.1` incremental, `0.7` flatten | **done in two tiers** — the default download is `doc.saveDocument()`, an incremental save that carries form values *and* `0.6`'s marks but leaves them interactive; a true flatten (appearance streams moved into page content, fields gone) lives behind the opt-in `edit` tier, which is the only path allowed a PDF writer. Measured on `form-sample.pdf`: 5,582 B / 11 widgets interactive against 6,202 B / 0 widgets with the value read back as page text |
| `FR-21` | Opt-in feature registration | `0.4` | done |
| `FR-22` | Per-feature stylesheets | `0.4`, two more in `0.5` | done |
| `FR-23` | Enforced size boundary | `0.4` | done — a ratchet, and the per-feature 4 kB gate |
| `FR-24` | Optional-content layers | `0.5` | done |
| `FR-25` | Embedded file list | `0.5` | done — both engine shapes, and annotation-held files save from the annotation |
| `FR-26` | Replaceable find strategy | `0.5` | done |
| `FR-27` | Search depth | `0.5` | done |
| `FR-28` | Composed shell | `0.5` | done |

**`FR-20` in full**, because it is the item whose answer is now split across two tiers. The default
download offers the original bytes or pdf.js's incremental save, and `usePdfDownload`'s options say so:
that branch is "save", not a true flatten, because flattening "needs a PDF writer" — and they now point at
`pdfjs-react-reader/edit` for it. That tier is what `0.7` adds, with the writer as an **optional peer**, so
the sentence stays true of the core — a host who imports only the viewer never bundles a 245.5 kB gzip
parser — and the limit becomes a choice. See *0.7.0 — Edit* for the measured difference between the two
files.

**One bar, now measured.** `PRD.md:22` promises "60 FPS scrolling on 1,000+ page documents with
sub-100ms viewport render times". Until `0.7` closed, every frame-timing measurement in this project's
history had been made on documents of 3–14 pages. `scripts/make-long-pdf.mjs` now writes a 1,000-page
fixture with a nested page tree and three cycling page boxes, and against it in Chromium the bar is
met: **38–55 ms** to reach and paint a cold page anywhere in the document, and **no frame over 16.7 ms**
across a reader-speed scroll of 400 frames with two to four canvases mounted throughout. What that does
*not* buy is a device claim — the harness ran at ~140 Hz, and no Safari or Android measurement exists,
which is the part `0.8` still owes. See *0.7.0 — closed* for the whole table.

`FR-21`–`FR-23` were added on 2026-09-24 alongside the tier decision below; `FR-24`–`FR-28` were
added with `0.5` on 2026-09-26.

## What the engine gives us for free

Before planning against the feature list, `node_modules/pdfjs-dist/types` was checked rather than
assumed. `pdfjs-dist@5.7.284` exports:

| Export | Unblocks |
| --- | --- |
| `AnnotationEditorLayer`, `AnnotationEditorUIManager`, `AnnotationEditorType` (`FREETEXT`, `HIGHLIGHT`, `STAMP`, `INK`, `POPUP`, `SIGNATURE`, `COMMENT`) | Annotation authoring without third-party code — `PdfPage` took `annotationEditorUIManager: null` until `0.6` mounted `annotateFeature`, which publishes the manager and `annotationEditorEditing` through `pageProps` |
| `XfaLayer`, `enableXfa`, `page.getXfa()` | XFA **rendering**, wired in `0.6`. Saving an edited XFA document is measured in `0.7` and cannot be trusted (`#127`, see *0.7.0 — Edit*); a packet pdf.js cannot lay out rejects the load — see *0.6.0 — Mark* |
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
| PDF annotation and editing | `0.6` create and save | marks go into the file through `saveDocument()`; `0.7` added the flatten that makes them permanent (`edit`) |
| Comprehensive form support (AcroForm + XFA) | `0.6` renders XFA | XFA cannot be saved: measured against every `/XFA` container shape we can generate (`0.7`), and its fields do not bind to `annotationStorage` at all. Whether a real-world packet's edits survive is untested, and the docs say so |
| Page reordering | `0.7` done | the tier's Pages tab moves, turns and removes pages through a plan, and applies, extracts or splits it through the writer; a split makes two files, and a row's angle badge means "changed here" |

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
  sidebar thumbnail is an empty 132×185 buffer. Both were answered in `0.7`: the persistence question
  turned out to be about the container *and* about `dataId`, and the search half of `#128` shipped while
  the thumbnail half did not — see *0.7.0 — Edit*.
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
measurement, and the docs say so rather than implying the surface is complete. Both were closed in
`0.7` — the repaint to zero renders on a page with nothing editable, the save to "measured, and not
to be trusted" — and the sentence that belonged in `Features` is written there rather than here.

### 0.7.0 — Edit: writing the engine cannot do ✅ built 2026-09-27 (local `dev`; pushed and published with 1.0.0)
The only release that touches the zero-dependency rule.

* New export `pdfjs-react-reader/edit`, with the PDF writer as an **optional peer** so the core stays
  dependency-free; `check-size.mjs` gains a measured path for it. **Done** — see *Flatten shipped*.
* True flattening, which completes FR-20. **Done.**
* Page reorder, delete, extract and split by dragging thumbnails, with undo. **Done**, in the tier's
  own sidebar tab rather than on the core thumbnails — the one place the writer's peer can be required
  without putting inert handles in the default shell. The two limits worth restating are that a split
  makes two files rather than N, and that a row shows the angle the plan sets rather than the one the
  file already carries.
* Rotation written into the saved document instead of living in view state — done by the panel, which folds the viewer's own per-page turns into the file it applies.
* Extract and split, still open: the plan already holds the bytes, but extracting must hand over a file rather than replace what is on screen, and splitting needs a decision about how many files a reader is asking for.

**Spike B — taken (2026-09-26): the writer is `@cantoo/pdf-lib`, and flatten has to happen first.**
Six candidates were examined on npm metadata, then the survivors were installed in a scratch tree and
measured with our own esbuild path and our own fixtures, and finally read back through pdf.js in a
browser, because a byte count says what is in a file and only the engine says what a reader gets.

* **Who is out, and why.** `mupdf` 1.28.1 is AGPL-3.0-or-later, which an MIT library cannot take as a
  peer no matter how capable it is. `pdf-writer` 1.1.3 and `pdfmake` 0.3.11 build documents from
  scratch — neither can edit the one that is open, so neither can reorder a reader's pages. `pdfts` is
  unpublished. That leaves `pdf-lib` 1.17.1 (MIT, last published **2022-05-12**) and its maintained fork
  `@cantoo/pdf-lib` 2.11.1 (MIT, published **2026-09-15**).
* **What they cost, bundled as a host would.** A consumer that loads, creates, copies, rotates, draws
  and saves — so nothing reachable can be shaken away — bundles to **raw 431.1 kB / gzip 178.4 kB /
  brotli 163.6 kB** for pdf-lib, against **raw 597.0 kB / gzip 251.6 kB / brotli 213.0 kB** for the
  fork. Neither produced a single esbuild warning on `platform: browser`, so both are genuinely
  browser-clean. The fork's extra weight is not the PDF code: its tree pulls `culori` (171 kB of
  input), `html-entities` (69) and `node-html-better-parser` (36) for rich-text field appearances,
  while its inflation dependency went from `pako` (219 kB) to `fflate` (91). For scale, the *entire*
  viewer today is 23.66 kB core and 32.75 kB with all seven features, so the writer is 5.4× to 7.7×
  everything else — the optional peer is what makes that acceptable, and the docs' size story has to
  grow a tier to say so honestly.
* **Capability is a tie on every job `0.7` planned.** Reordering `[2, 0, 1]` came back with the page
  labels in that order; deleting the middle page left two; extracting page 2 produced a one-page file
  holding page 2; rotating wrote `/Rotate` and reopened as 90° with the sibling untouched at 0°; and a
  copy into a brand-new document kept every markup annotation — Highlight, Underline, StrikeOut,
  Squiggly, Text and Popup, all ten, rendered in the DOM.
* **Flattening is real, and it does not eat the reader's marks.** After `form.flatten()`, pdf.js reports
  the filled value as **page text** (`Grace Hopper` in `getTextContent`, text spans 13 → 19) with **zero
  Widget annotations** on that page — the appearance moved into the content stream, which is exactly
  what FR-20 has been missing since `0.1`. And the page carrying a highlight and a link kept both,
  which the API doc's phrase "all form fields and annotations associated are then removed" does not
  make obvious.
* **The trap that decides the design: `copyPages` carries widgets but not the AcroForm.** In a document
  assembled by copying — the obvious way to reorder — `getForm().getFields()` returns **0 fields**, so
  `flatten()` silently does nothing: pdf-lib left all nine orphaned widgets in place, the fork removed
  one. A `flatten` built on a copied document would therefore appear to succeed while shipping an
  interactive form, and `0.7`'s reorder would quietly strip a form's fields of their definitions. The
  ordering is now fixed by measurement: **flatten the loaded document first, then move its pages**, and
  page moves within one `PDFDocument` rather than a copy-out if a form must survive the edit.
* One encoding note that cost a false finding: a filled field is written as UTF-16BE hex
  (`/V <FEFF00470072…>`), so searching the bytes for the typed string reports "absent" for a value that
  is correctly there. Same lesson as `#123`: prove the oracle can see the thing before trusting its
  silence.
* **Recommendation: the fork.** Capability is a tie, so the choice is maintenance against 73 kB of
  gzip on an opt-in tier. This code parses and rewrites files from untrusted sources, and a parser that
  has not shipped a release since 2022 is the worse risk; `@cantoo` also ships a real `exports` map and
  is the branch that at least attempts the orphan-widget case. **Approved by the user on 2026-09-26**,
  with the 251.6 kB figure in front of them, and it is why the writer is a peer rather than a dependency.


**Flatten shipped (2026-09-26), as the `edit` tier — `pdfjs-react-reader/edit`, 0.82 kB of our own over
core.** `@cantoo/pdf-lib` is an **optional peer** (`peerDependenciesMeta`), external in tsup and in the
size gate, so the writer's own 245.5 kB gzipped (251.6 kB as Spike B measured it, 245.5 kB bundled
minified at the close) is a number a host sees only if they import the tier. The
gate's marker for it is deliberately not one of our symbols: it is the peer's own specifier,
`@cantoo/pdf-lib`, which must be **absent from core and present only in that tier** — the failure worth
catching is the writer arriving in a bundle that never asked for it, and the check passes.

* Measured through the real control on `form-sample.pdf`, after typing a value the document does not
  hold: the download control's file is 5,582 B with **11 widgets** (still interactive — the 0.6 gate
  change is untouched), and the flatten control's is 6,202 B with **0 widgets, `/Fields [ ]`, 0 `/FT`**,
  the value present as page text. Console clean both ways. The flattened file is *larger*, because an
  appearance stream moved into page content rather than being dropped.
* What `pdf-write.ts` promises and what the tests hold it to: a document with no form is reported as
  `hadNoForm`, not as a successful flatten, and the reader's markup annotations survive — `/Highlight`,
  `/Ink` and `/FreeText` counts identical in and out, which is the guard that keeps `0.7` from undoing
  `0.6`.
* **The peer leaves its `/AcroForm` dictionary in place, emptied.** The first version of that assertion
  demanded the key be gone and failed on a real file: `Fields` becomes `[]` and no `/FT` remains, which
  is what pdf.js keys `formType` off, so the observable claim is the one now tested. Assert what the
  reader can see, not what the spec sketch implied.
* **A new entry has to be registered in two vite configs.** The playground and the docs each alias
  `pdfjs-react-reader/*` to source by explicit pattern, and neither had one for `/edit` — so the import
  failed to resolve and the playground rendered nothing at all, which first looked like a broken probe
  rather than a broken app. The symptom to remember: **`.app-url` missing from the DOM means the app
  never mounted**, and checking that before debugging the probe would have saved the detour.

**The two fixtures `0.7`'s remaining work is built on (2026-09-26).**

* **`page-order-sample.pdf`** (`scripts/make-page-order-pdf.mjs`) is twenty pages whose display order is
  a permutation of their object numbers (`200 + 7·i mod 20`), each printing its own slot *and* its object
  number, with four landscape pages, one `/Rotate 90`, three outline entries by reference plus a fourth by
  name, and two `/Link` annotations. Measured: for all twenty pages the printed slot, the printed object and
  `doc.getPageIndex({num, gen})` agree, so the file cannot be read correctly by accident — which is the
  whole point of a reorder fixture. Two engine behaviours fell out of it that the reorder design has to
  respect: a rotated page's `getViewport({scale: 1})` is **792x612 while its MediaBox stays 612x792**, so the
  layout box follows rotation and each slot must be re-measured rather than assumed; and `getAnnotations()`
  hands back a Link's `/Dest` as an **unresolved `{num, gen}` reference**, so destinations travel with the
  page object and survive a rebuild of `/Kids`.
* **A named outline destination reaches the reader, and only because our code resolves it.**
  `getOutline()` returns the bare string `"middle"` for `/Dest /middle`, and `resolveDestinationPageIndex`
  returns `null` for it — `usePdfOutline.ts:26-33` is what turns the name into an array through
  `doc.getDestination()` first. Clicking that row in the shell moved the reader 1 → 10 → 20 → 10, so FR-10
  holds; but a host using the headless resolver directly gets `null`, which the docs should say. Note also
  that `doc.resolveDestination` **does not exist** in 6.3 — a probe that reached for it threw, and the
  method is `getDestination`.
* **Array-form XFA renders exactly as well as the single stream.** Three fixtures
  (`xfa-array-sample.pdf`, `xfa-array-packet-sample.pdf`, `xfa-hybrid-sample.pdf`) share one packet with
  `xfa-sample.pdf` through `scripts/xfa-packet.mjs`, so the container is the only variable. The reason a
  choice of shape was needed is in `_xfaStreams`: it keys the **first** pair `xdp:xdp` whatever its string
  says, keys the **last** pair `/xdp:xdp`, takes middle pairs by name, and `XFAFactory._createDocument`
  concatenates *every* stream in the map's seeded order only when both of those exist. So an array either
  carries the whole packet in its first stream or must be cut so the pieces rejoin — and the generator
  asserts that the join is byte-identical to the working packet before it writes a byte. Measured: both
  array shapes return the identical node tree (`name: "div"`, one child, 2,850 characters serialised) and
  the same 500x700 box the template asks for, and through the shell both XFA fields carry the bound datasets
  values, `Ada Lovelace` and `United Kingdom`.
* **The hybrid is the predicted no-show, and one probe oracle was wrong.** With `/Fields` present as well,
  `isPureXfa` is false, the box is the MediaBox's 612x792, the canvas marker sentence paints, and the AcroForm
  widget answers with its own `/V` ("Canvas value, not the XFA one") — the datasets island is never consulted.
  Our shell then leaves an empty `.pjsr-xfa-layer` host, which is the designed behaviour
  (`PdfPage.tsx:411-414` clears it rather than rendering into it). The mistake worth keeping: **XFA field
  values do not appear in `getTextContent()`** — the bound name was absent from the text tree for the control
  fixture too, so "did the packet bind?" is only answerable from the rendered inputs. A text-layer probe
  reports "not bound" for a document that bound perfectly, and the same absence is why search cannot find a
  value typed into an XFA field (`#128`).

**Both fixtures `0.7` still needed, built and measured (2026-09-26).**

* **`page-order-sample.pdf`** (`scripts/make-page-order-pdf.mjs`) — twenty pages whose `/Kids` order is a
  permutation of their object numbers (`200 + 7·i mod 20`), each printing its own slot *and* the object
  number it lives in, four of them landscape, one carrying `/Rotate 90`, with three outline entries by
  reference, a fourth by name, and two `/Link` annotations. Measured engine-side: for all twenty pages the
  printed slot, the printed object and `doc.getPageIndex({num, gen})` agree, so a tool that confuses an
  index with a reference cannot read this file correctly by accident. Two facts came out of it that the
  reorder design has to honour: **`getViewport({scale: 1})` on the rotated page is 792x612 while its
  MediaBox stays 612x792** — the layout box follows rotation, so each slot must be re-measured after a move,
  not re-used — and `getAnnotations()` hands a Link's `/Dest` back as an **unresolved `{num, gen}`
  reference**, so a page's destinations travel with its object and survive a rebuilt `/Kids`.
* **A named outline destination resolves, and not in the place you would look.** `getOutline()` returns the
  bare string `"middle"` for `/Dest /middle`, and `resolveDestinationPageIndex` answers `null` for it; what
  makes the row followable is `usePdfOutline.ts:26-33`, which resolves the name through
  `doc.getDestination(name)` first. Measured by clicking: page 1 → the name row → 10, and the reference rows
  → 20. Two names that are not what they seem: **`doc.resolveDestination` does not exist** in 6.3 (the
  method is `getDestination`), and neither does `doc.destroy()` (the loading task owns the worker). A host
  wiring the headless resolver by itself gets `null` for a named destination, which the docs should state.
* **`xfa-array-sample.pdf`, `xfa-array-packet-sample.pdf` and `xfa-hybrid-sample.pdf`**
  (`scripts/make-xfa-array-pdf.mjs`, sharing `scripts/xfa-packet.mjs` with `xfa-sample.pdf`, whose
  regenerated bytes are md5-identical to the verified `0.6` fixture) exist because `_xfaStreams` does not
  simply parse an array: it keys the **first** pair `xdp:xdp` whatever its string says, the **last** pair
  `/xdp:xdp`, middle pairs by name, and `XFAFactory._createDocument` concatenates **every** stream — in the
  map's seeded key order — only when both of those exist. So an array either carries the whole packet in its
  first stream or must be cut so its pieces rejoin, and the generator asserts that its three fragments join
  byte-identically to the working packet before writing. Measured: both array shapes give the identical node
  tree (`name: "div"`, one child, 2,850 characters serialised), the same **500x700** box the template asks
  for rather than the 612x792 MediaBox, and through the shell two `.pjsr-xfa-layer` inputs carrying the bound
  datasets values, `Ada Lovelace` and `United Kingdom`. The array container is not second-class.
* **The hybrid is the predicted no-show, and it corrected an oracle.** With `/Fields` present alongside the
  array, `isPureXfa` is false, the box is the MediaBox's 612x792, the canvas marker sentence paints, and the
  AcroForm widget answers from its own `/V` — the datasets island is never consulted. Our shell leaves an
  empty `.pjsr-xfa-layer` host in that case by design (`PdfPage.tsx:411-414` clears it), and it also skips the
  text layer for pure-XFA pages (`PdfPage.tsx:285`), which is the shape of `#128`. The mistake worth
  keeping: **XFA field values do not appear in `getTextContent()`** — absent for the known-good control as
  well as for the arrays — so "did the packet bind?" is answerable only from the rendered inputs, and a
  text-layer probe reports "not bound" for a document that bound perfectly. The same absence is why search
  cannot match a value typed into an XFA field.

**Spike C — taken (2026-09-26): a reorder is a permutation of `/Kids`, and the obvious API is
the broken one.** Four passes in Node against our own fixtures, then a read-back through the
engine in a browser.

* **`removePage()` deletes the object, so `removePage` + `insertPage` does not move a page — it
  loses it.** The library's source is plain about it: `removePage` ends with
  `this.context.delete(page.ref)`, while `insertPage(index, page)` re-inserts
  `page.ref` — the reference of an object the context no longer holds. Measured on
  `page-order-sample.pdf`: the saved `/Kids` names object 215 first, and **`215 0 obj` is not in
  the file**. The tree, `/Count`, `getPageCount()` and the distinct-kid count all say twenty pages.
  A reorder built this way ships a document whose first page is a dangling reference and reports
  no problem anywhere.
* **Rewriting the page tree instead is clean, and the library's own API follows it.** The primitive
  is: look up the `/Pages` dictionary, `set(/Kids, refsInNewOrder)` and restate `/Count`. Measured:
  every kid the tree names is written, the permutation is exactly what was asked for, two composed
  moves read the *current* tree so a second drag lands correctly, and afterwards `getPage(i)` /
  `getPages()` agree with the tree object-for-object (with `pageCache.invalidate()`), so the feature
  can keep using the API rather than reloading the bytes after every interaction.
* **Undo is the inverse permutation, and it is free.** Applying the inverse restored both the
  original `/Kids` order and the original byte length. An undo stack is therefore an array of index
  arrays, not a stack of document snapshots — which matters because a snapshot of a real document is
  megabytes, and a permutation of a thousand pages is a few kilobytes.
* **Everything that references a page by object rides along, and the engine confirms it.** After
  moving page 5 to the front, the reader's read-back showed: the order was exactly as requested, the
  page that carries `/Rotate 90` kept it **in its new slot** with a 792x612 viewport, the outline entry
  "1. Opening (page 01)" resolved to **slot 2** (it followed the page, not the index it was written
  against), and a `/Link` on that page still named its original target object. A form moved this way
  keeps all 8 fields, and `flatten()` after the move logs nothing and produces 0 widgets — so the
  "flatten before you reorder" constraint from Spike B is about `copyPages` throwing the AcroForm
  away, not about moving pages inside one document. Markup annotations are unchanged across a move
  (Highlight 1→1, Ink 2→2, FreeText 1→1, Popup 14→14).
* **A delete is safe but silent, and that is a UI obligation.** `removePage()` is the right call for
  deletion — the page is gone, `/Count` is restated, the file opens (19 pages, the remaining order
  intact, every page still identifying itself). But the outline entry and the name-tree destination
  that named the deleted page keep naming it: two references left dangling, **no console warning at
  all**, and our resolver answers `null`, so the row simply does nothing. A delete that leaves a dead
  outline row is a feature bug even though the file is valid, so the UI has to prune or disable those
  rows — measured, not assumed.
* **Two small API notes.** `page.setRotation()` needs the branded `degrees(90)`; a plain `90` throws
  `Invalid rotation: 90` from `toDegrees`. And `save()` in this fork returns a **Promise**, unlike
  pdf-lib 1.17's synchronous `save()` — `pdf-write.ts` already awaits it, and the first spike pass that
  did not got a `Buffer` type error rather than a silent wrong answer, which is the right way to fail.
* **Confirmed in a browser through the shipped tier export, not just in Node.** `arrangePages` was
  imported from `pdfjs-react-reader/edit`, run on `page-order-sample.pdf`, and the output opened by
  pdf.js: asking for page 5 at the front with page 2 rotated gave read-back
  `5,1,2,3,4,6…20`, with the rotated page reporting **792x612 in its new slot 3** while the fixture's
  own rotated page carried 792x612 to slot 1. The outline row "1. Opening (page 01)" resolved to
  **slot 2** and the named destination to slot 10, both following their page object; the `/Link` on
  page 1 still named object 200. Applying the inverse arrangement restored the order 1…20 (the bytes
  are not identical to the generator's — the writer's save is ~10 kB smaller on this file — which is
  why the claim is about order, not about bytes). Deleting page 10 left a document that opens as
  19 pages with the remaining order intact, and the two destinations that named it resolved to `null`
  rather than throwing. Extract and split needed no new mechanism: two arrangements over the same
  source produced a 5-page and a 15-page file, the smaller one carrying only its own five page objects.

**The seam a page editor needs, shipped and tested (2026-09-26).** Reordering pages produces a
new file, so the tier has to be able to put bytes on screen. `useViewerController` now keeps a
third source — `editedFile ?? droppedFile ?? src` — and publishes `replaceDocument(bytes, name?)`
on the controller and on `PdfViewerShell`, alongside `pageRotations`, which a writer must fold into
the file it produces. Two behaviours are tested rather than assumed, and both are the ones that fail
quietly: a `Uint8Array` has no filename, so the document's label is carried across (otherwise the
download control starts saving `document.pdf` over the file the reader was working on), and the host's
`src` wins back as soon as it changes (the same rule drag-and-drop already follows — without it an app
that navigates elsewhere is stranded on an edited copy of the previous document). The swap also clears
per-page rotations, because they have just become `/Rotate` entries in the new file and would otherwise
turn the page twice. Cost: +0.14 kB gz on every consumer path, which the ratchet accepts without a
re-accept.

**The open question is where the panel lives, and it is a product decision.** PRD asks for page
editing "by dragging thumbnails", but thumbnails are core while the writer is an opt-in tier, so the
choices are a new `Pages` sidebar tab owned by the tier, drag handles added to the core thumbnail strip
that only do something when the tier is mounted, or a host-facing surface — the tier publishes `move`,
`rotate`, `delete` and `undo` and the application draws the panel. The first keeps the writer's weight
out of core and gives the feature its own accessible UI; the second is what PRD literally describes but
puts inert affordances into the default shell; the third is cheapest and pushes work onto every host.
Decide before building, because the undo model behind all three is the same: keep one base snapshot of
the document as it was when the reader started editing, hold the plan (order, rotations, deletions) as
data, and re-apply the plan to the snapshot — which is what makes a delete undoable, since a permutation
alone cannot bring a page back.

**The Pages tab shipped (2026-09-26), and the browser pass is what settled its semantics.** The
tier contributes a sidebar panel rather than touching the core thumbnail strip, so the writer's peer
stays opt-in and the affordance is never inert. What the model gives the UI, and what was measured
through the real controls on `page-order-sample.pdf`:

* Moving page 1 later re-titles the row **"Page 1 moved to position 2"** in the live region, and
  applying it changed **the document on screen** — the first page's own printed text went from
  "Page 01" to "Page 02", and the plan reset to a clean list of twenty. Applying is the only write;
  every move, turn and removal before it is an array edit, so a batch is undone by stepping the
  stack with no bytes touched at all (measured: two moves, one Undo, no call to the writer).
* Rotating a page then moving it writes `/Rotate 90` onto **the page object**, and the viewer's first
  page box changed from portrait to 744x574 after the apply — the rotation is in the file, not in
  view state, which is the FR the release was meant to close.
* Removing a page and applying left 19 pages both in the panel and in the toolbar's count.
  **"Undo the last apply"** restored 20 — that is the one byte snapshot the tier holds, and its
  undo button disables behind it, so the offer and the memory match rather than pretending depth.
* Dragging row 1 onto row 4 moves it, and the row's own buttons do the same job for a keyboard.
  The dispatch test covered `dragstart`/`dragover`/`drop`/`dragend` on the real handlers; a physical
  pointer gesture through an automation tool was **not** exercised, which is the one claim here that
  rests on the code being the same code rather than on a measured gesture.
* Two consequences worth stating, because both surprised the author. **A row's label is the page's
  number in the file being edited, not a permanent name**, so after an apply the list renumbers —
  the page that was "Page 2 of 20" is "Page 1 of 20" in the new document, which is correct and is
  also what makes a second apply compose cleanly. And the angle badge disappears once applied,
  because the plan no longer holds a change; the panel does not currently read the file's own
  `/Rotate`, so a page rotated before it was opened shows no badge. That is a real gap, not a
  simplification, and it is filed below.
* Cost: the tier went from 0.82 kB to **3.04 kB gz over core**, inside its 4 kB per-feature budget
  but close enough that the next thing added to this panel needs its own measured reason. `core`
  itself moved +0.31 kB for the seam, which the ratchet accepted.

**Extract and split shipped next (2026-09-26), and the console caught a defect in the write path.**
Both reuse the plan, so no new mechanism was needed; what they needed was a different *sink*.

* Extract is `applyPageEdits`' bytes handed to the save dialog instead of to the viewer: same writer
  pass, and the document on screen does not move. Measured through the real controls — after moving
  page 1 later, the extracted file led with object 214 while the viewer still printed "Page 01 of 20",
  and the plan stayed pending rather than being consumed, because nothing was written to the document.
* Split is two arrangements from **one** save: the row's control cuts the planned list at that slot
  and writes `-part-1.pdf` and `-part-2.pdf`, measured at 4 + 16 pages with the pending order
  respected, and 10 + 10 in the file's own order with nothing pending. It does not need an edit
  first — that was the design flaw the first test run caught, since "split this in two at page 10"
  is the common request and the plan was being required to exist.
* **Two files, not five.** A reader asking for equal parts can split twice, while a fourth or fifth
  download in one click is where a browser puts a permission prompt the viewer cannot earn honestly.
  That is the reason the row says "Split the list here" rather than offering a count, and it is a
  scope limit rather than an oversight.
* **The defect: `saveDocument()` on a document with nothing in `annotationStorage`.** pdf.js logs
  "saveDocument called while `annotationStorage` is empty, please use the getData-method instead" —
  one warning per write, on a path where the reader never touched a field or a mark, so a clean
  reordering session printed three warnings the reader did not cause. The tier now asks the engine
  the question directly (`annotationStorage.size`) and takes `getData()` when there is nothing to
  commit, which is also the cheaper call. Both branches are pinned by a test. Asking the engine
  rather than the features is deliberate: the download control reaches the same decision through
  `forms.isDirty` and `annotate.editing`, which needs those peers mounted, while the storage size is
  the fact those two only report on. Console clean afterwards, measured.
* **A page's existing `/Rotate` is deliberately not shown.** 6.3 offers no all-pages overview call, so
  the only sources are `getPage(i)` for every page — a thousand worker round trips for a badge on a
  thousand rows — or parsing the file again with the writer. The badge therefore means *changed here*,
  and the docs must say so rather than let the absence read as a bug.

Cost after all of this: the tier is **3.49 kB gz over core against its 4 kB budget**, so roughly
0.5 kB of room is left and the next thing added to this panel needs a measured reason or a deliberate
raise of the gate.

**The three things 0.7 was going to leave open, closed (2026-09-27).** Each came with a number, and
two of the three changed the shape of the fix on the way.

* **`#126` — arming a tool must not repaint a page that has nothing to take over.** The first fix
  read `isEditable` off the fetch the annotation layer already makes and passed
  `annotationEditorEditing && hasEditableRef.current` as the render parameter. Measured, it bought
  nothing: `annotationEditorEditing` is itself an effect dependency, so the page repainted anyway and
  only the flag changed — 2 renders on a document with no annotations, both now `isEditing=false`,
  which is a wasted render rather than a lost mark. Making the *derived* value the dependency is what
  works, and holding `hasEditable` in state rather than a ref is what closes the race the ref version
  left open (arm before `getAnnotations` resolves, and the answer arrives to nobody). After that:
  `outline-sample.pdf` (3 pages, 0 annotations, 2 mounted) costs **0 render calls** to arm, against
  the 2 recorded before; `annotated-sample.pdf` (editable markups on both pages) still costs exactly
  2, both `isEditing=true`, and `#123`'s safety property re-measured clean on the same build — every
  editable annotation held by an editor, attached with a box, its own layer element hidden while
  armed and `hidden=false` again after disarming. The earlier attempt at this measurement had
  `armClicked: false` and proved nothing: it reached for the core "Draw on document" control, which
  `annotateFeature` *replaces*, so the button was gone.
* **`#127` — "XFA persistence excluded permanently" was a claim about one container.** The sentence
  came from a fixture whose packet is a single `/XFA` stream, and the worker's rewriter wants an
  array. Both shapes now exist, plus a whole-packet array and an AcroForm hybrid, and the save was
  walked twice: once writing a storage key by hand, once by typing into the field the layer built.
  Typing is the finding. `XfaLayer.setAttributes` binds a field to storage only
  `if (storage && attributes.dataId)` (`pdf.mjs:1113`), and these packets give their inputs a
  `fieldid` and no `dataId` — so `setupStorage` never attaches, the keystroke stays in the DOM
  (`value` reads back what was typed) and `annotationStorage.size` stays **0**. There is no save to
  test until a packet binds, which is a fact about what `scripts/make-xfa-pdf.mjs` emits, not about
  LiveCycle forms. With an entry forced in, the single stream rejects (`reading 'toString'`), the
  split array answers with bytes that keep `/XFA` but drop the value, and the whole-packet array
  answers with bytes that **will not reopen** (`reading 'length'`); with storage empty all three
  reject (`reading 'get'`). So: the *save* path is measured and cannot be trusted for a pure-XFA
  document; the *edit* path is **not** measured, and the docs must say which is which. The guard
  stays, and its comment now says what was observed instead of the inference that was written there.
* **`#128` — search marks on an XFA page needed two fixes, and only one was in the TypeScript.**
  Wrapping the layer's text nodes in spans gave the highlighter something to split, and the count
  went from `1 of 1 · p1` with `marks: 0` to `marks: 1`, scrolled to it, with the layer's 23 elements
  intact and the mark inline in a 365 px line at 69x27. It was still **invisible**: the mark rules are
  scoped to `.pjsr-text-layer`, and `.pjsr-xfa-layer .xfaLayer *` sets `background-color: transparent`
  on everything on the page. A DOM-only measurement would have called that done. The XFA rule tints
  *behind* the glyphs instead of hiding them, because here the layer is the page — over a canvas the
  mark's text is transparent, and `color: transparent` on XFA text would delete a word. Re-measured:
  `background-color: color(srgb .31 .27 .90 / .55)`, `color: rgb(24, 29, 39)`, and the text-layer
  path unchanged on a normal document (7 marks, still transparent text). Thumbnails stay blank —
  132x185 with **0 non-white pixels** — which is the half of `#128` that is real work, not a selector,
  and is filed separately.

**The panel's own announcement took four attempts to be true, and every one was caught by measuring
rather than by reading the code.** Applying is the action a reader most needs told about — the document
under them has just changed — and the live region said nothing.

* **The first cause was the reset that keeps a plan honest.** A new document voids the plan, so the
  effect on `[shell.doc]` clears plan, history and notice — and `applyPageEdits` sets its notice
  *before* the new document arrives, so the reset unsaid it one pass later. Fixed with a flag: a swap
  this tier caused keeps its own announcement, while a document change from anywhere else still clears
  it. Pinned both ways, with the counterfactual run to show the test fails without the fix.
* **The second was that a swap is not one change.** The old document goes away while the new one loads,
  so `shell.doc` moves twice, and a flag spent on the first pass was gone before the panel came back.
  The grace now ends only when a non-null document arrives.
* **The third was invisible to the tests.** `PagesPanel` returns `null` with no document, which
  unmounts its markup but **not** its component instance — so the state holding the announced text
  survived and the region remounted already full. A live region that mounts holding its words has not
  changed, so there is nothing to announce. It now empties for the duration of the swap and writes
  itself after the new document commits; the assertion that pins it is that the text is absent on the
  render right after the remount and present one settle later.
* **And the primitive was wrong twice over.** That write was a `requestAnimationFrame` until the
  browser said no: this tab runs hidden, a hidden tab never paints, the callback never fired, and the
  announcement was empty again in the measurement meant to confirm it. `setTimeout(0)` does the same
  job and runs whether anyone is looking. Harness rule worth keeping: **a rAF in something that must
  work in a background tab cannot be verified from one.**
* Measured on the docs example with the tier mounted, on a fresh page: rotate announces
  `Page 1 turned to 90 degrees`, remove announces `Page 3 removed`, apply announces
  `Page changes applied` and survives the swap, and **Undo the last apply** now says
  `Back to the document as it was before the apply`. The last of those is a wording fix, not a
  mechanism one: the same notice kind had been serving both discard and undo-apply, and after an
  undo-apply "Page changes discarded" described an action nobody had taken. Console clean across the
  run — the one React *deps changed size between renders* warning seen mid-session was HMR replacing a
  hook whose dependency list had just grown, and it did not recur on a fresh mount.

### 0.7.0 — closed 2026-09-27

Cumulative measured cost, gzipped, worst of esbuild and Rollup: core **23.66 → 24.26 kB** (+0.60 for the
replacement seam and the XFA span wrapper every page now carries), shell **50.87 → 51.91**, headless
**26.78 → 26.82**. Over core: print 2.52, download 0.77, forms 1.94, outline 0.94, layers 1.19,
attachments 1.10, annotate 1.85, **edit 3.60**; all eight **36.53 kB** (+12.26). `edit.js` ships at
5.39 kB gz and is the only shipped file that names the writer. `edit.css` is the eighth sheet,
2,469 B source → 1,266 B minified. The catalog is **134** strings (115 before this release).
**365 tests in 31 files**, up from 313 in 25. The baseline was re-accepted at the close, so every figure
in README, the docs pages and this file is the committed number.

**The peer numbers moved too, and one of them had been wrong since `0.1`.** `pdfjs-dist` 6.3.289 gzips to
128.6 kB on the main thread and 366.5 kB in its worker; `@cantoo/pdf-lib` to 245.5 kB minified. The
"~532 kB" quoted in README and in `check-size.mjs`'s header was a 5.x measurement that survived two peer
bumps because nothing recomputed it — the reminder being that a *for scale* number is still a claim, and
a claim nobody re-measures quietly becomes the thing the docs defend rather than the thing the engine
does.

**What the close pass found: one real defect, and it was in the surface that already worked.** The Pages
panel announced every edit while the reader made it and said nothing on Apply — three causes deep, each
caught only by sampling the live region over time, and each invisible to a test that asserted the notice
rather than the announcement (`#126`, `#127`, `#128` all measured clean; the arming and XFA-mark
probes had to be re-run non-vacuously after a first attempt that clicked a button which the feature had
replaced). The pass also caught the apply's own undo saying "Page changes discarded", which describes an
action nobody took. Both new assertions were run once more with the fix removed, to show they fail
without it; the counterfactual for the *wording* is the sentence above, not a test.

**Three things this release does not claim.** That a physical pointer drag was ever driven through
automation — the gesture path is dispatch-tested. That XFA can be saved, or that its edit path was
tested: the save is measured across every container we can generate and the edit is not, because our
packets bind no `dataId` (`#137`). And that an XFA page has a thumbnail — it paints zero operators, so
the sidebar shows an empty 132×185 buffer (`#136`).

**`#114`'s other half, closed the same day: the 1,000-page fixture exists, and the `PRD.md:22` bar
it was built for is now measured.** `scripts/make-long-pdf.mjs` writes 1,000 pages into a **nested page
tree** — 100 leaves of ten pages, ten groups, one root, four levels from catalog to page — because that
is what a real producer writes at this size and a flat `/Kids` would let the engine off the hook for
`/Parent` chains, intermediate `/Count`s and tree descent altogether. Three page boxes cycle by
`page % 3`, so no single measured height can stand in for a thousand slots; one marker line per page, so
a whole-document index has to read every stream. 375 kB, 2,113 objects, and the generator refuses to
write unless every node's `/Count` equals what its children report and every page names its own node back
— which it earned on the first run, catching a `/Kids` of bare numbers where `N 0 R` references belong,
and a 22 MB xref built by sparse object numbering.

Chromium, Windows, the playground's shell, the surface visible:

| What | Number |
| --- | --- |
| Open the document (`numPages` known, page 1000 resolvable) | **67 ms** |
| All 1,000 page viewports (the virtualizer's layout pass) | **55 ms**, 3 distinct boxes |
| Twenty pages painted at scale 1.5, spread through the file | **142 ms** total, ~7 ms each, no cold-page penalty |
| Every page's text (what a whole-document search must read) | **173 ms**, 3,000 items, 48,893 chars |
| First paint through the shell | **220 ms** |
| Reader-speed scroll — 100 px/frame, 14,259 px/s, 65 pages, 400 frames | p50 **7 ms**, p99 13.8, max **14.0**, **zero frames over 16.7 ms** |
| Whole-document scroll — 1,100 px/frame, 135,000 px/s, all 1,000 pages | 4.9 s, p99 14 ms, max **20.9 ms**, zero over 24 ms |
| Cold jump to page 250 / 500 / 750 / 1000, timed to ink | **55 / 55 / 38 / 46 ms** |
| Canvases mounted at any moment across all of it | **2 to 4** |

So `PRD.md:22`'s two claims hold on the only machine this project can measure: sub-100 ms viewport
render is met at 38–55 ms, and 60 FPS scrolling is met with every frame of a reader-speed pass inside
the 16.7 ms budget. **Three things the numbers do not say.** rAF here ran at about 140 Hz (p50 7 ms), so
the budget was met on a machine that is not the target — no real device has been measured, and the
README's Safari and Firefox note is untouched by any of this. The whole-document pass moved at twenty
times a human scroll. And the heap figure (48 MB) is Chromium's own coarse `performance.memory`, not a
measurement of containment: what actually evidences containment is that between two and four canvases
were mounted for the entire traversal.

Two defects fell out of the numbers, and neither is cosmetic. The laid-out height of this document grew
from **615,186 px to 954,482 px** as pages were measured, because the virtualizer's estimate comes from
page 1 — the shortest of the three boxes. A fast scroll therefore shows a page counter that lags
(it read 692 at the bottom mid-flight, and 1,000 once settled), and a scrollbar is ~35 % of its eventual
length on arrival (`#138`). And the console was **not** clean on this document: eleven
`Maximum update depth exceeded` errors in one run, React's 50-update guard breaking a cycle whose last
stack frame is a `setState` in `PdfPage`. The A/B is tight — the identical sequence with the zoom pinned
at 100 % is clean, and the identical sequence on `page-order-sample.pdf` (20 pages, four of them
landscape, fit-width resolving to 162 %) is clean too, so it takes a fit mode *and* a document this
long. `reportPageDims` and the release's own `hasEditable` state are both ruled out in the task, which
leaves `setTextLayer` under a `resolvedScale`-derived viewport (`#139`). So the frame numbers above were
taken from a session that also produced a React abort, and they stand as timings, not as a clean bill of
health.

## 0.8 so far

**`#138` closed: rows the sweep has not reached are sized by the document's mean box, not
page 1's.** `usePdfVirtualizer` now fetches twelve pages spread evenly from the second page to the
last alongside page 1, and the mean of them (`meanBox` in `src/lib/layout.ts`, chosen because mean ×
count *is* the sum the layout needs) stands in for any row without its own measurement. Re-measured
on the 1,000-page fixture with the viewer at 1040×820, fit width at 125 %, every feature off:

| | before | after |
| --- | --- | --- |
| height once page 1 is known | 809,005 px — **15.2 % short** | 954,010 px — **0.04 % short** |
| what the document turns out to be | 954,482 px | 954,482 px |
| commits more than 5 % off | all of them | **one in 42** |
| height-changing commits | 42 | 42 |

The one sample still far off is the frame before any page has been fetched, where the only thing
known is `numPages`; no estimate can help it, and holding the first paint to wait for one would trade
a wrong scrollbar for a blank viewer. What did *not* change is the commit count, and that is the
finding worth keeping: a chunk's twenty-odd `reportPageDims` calls already land as one render, because
React batches the updates one synchronous tick makes, so the batching pass this task was written to
ask for would have bought nothing. Same probe on `page-order-sample.pdf` (20 pages, four landscape):
0.5 % off after the seed, three commits. Frames during the sweep held at p50 6.9 / p99 13.8 / max
20.9 ms, so the twelve extra `getPage` calls cost nothing measurable.

**`#139` is not a defect, except for one line of it that is.** The eleven
`Maximum update depth exceeded` errors were still eleven after the estimate fix above — that A/B was
measured before the text-layer change landed, and with both in the count is now **zero or two** per the
same pair of passes, re-run four times: never on the reader-speed pass, occasionally one or two on the
1,100 px/frame one, which is 135,000 px/s through 615 px pages, about two hundred pages a second. The
reader-speed pass re-measured the same way came out p50 7 ms, max 14.0–14.1 ms, **zero** frames over
16.7 — and the whole-document pass, which had been max 20.9 ms at `0.7`, is now max 14.0 with the same
zero. Whatever the guard was breaking on, it was the work the two fixes removed rather than anything the
guard was protecting against. And the guard itself is React's own development instrumentation: the string
exists twice in the installed `react-dom`, in `react-dom-client.development.js` and
`react-dom-profiling.development.js`, and nowhere else in the package, so no production consumer can be
shown it. What it aborts is work React would otherwise keep doing at a scroll rate no hand can hold. One
fix was built and measured against this before the conclusion was accepted — deriving the cleared page
from state instead of `setPage(null)`, on the theory that every mount was scheduling an update from
inside the effect flush. Eleven errors before it, eleven after it. The theory was wrong twice over: the
slots are keyed by page index (`ViewerParts.tsx:249`, `:258`), so a fast scroll remounts a page rather
than handing it a new number, and on a mount `page` is already null, which React bails out on. The change
is not kept; the patch is at `.spike/out/pdfpage-derived-page.patch`.

The line of `#139` that *was* a defect: typing a page the document does not have left the typed number
in the box, because the scroll clamps on its own and `currentPage` therefore never moves to trigger the
effect that mirrors it. `Toolbar`'s `commitPage` now clamps and writes back what it went to — measured
in the browser: 5000 typed on the 1,000-page fixture leaves `1000` at scrollTop 953,710 of a scrollable
953,711, and 0 leaves `1` at the top — with three cases in `Toolbar.test.tsx`.

**`#140` closed: a zoom step re-lays the text layer out instead of rebuilding it.**
`PdfPage` built its `TextLayer` on `viewport`, which is a new object for a new scale exactly as it is
for a new page, so every step of a pinch or a zoom select threw the spans away and asked the worker to
extract the page again. It now builds on `page` and `rotation` and calls `TextLayer.update({viewport})`
for the scale. At the engine level that is **39.8 ms against 1.0 ms** for the tracemonkey title page's
163 spans, and 9 ms against 0.2 ms for a two-span page of the thousand-page fixture — which says the
cost was the round trip, not the text. Through the shell, on a page holding 56 search marks: the fourth
span tagged before the step is the same node after it, and after a step back to fit width its box is
byte-identical to where it started; 356 spans and 56 marks before, 356 and 56 after; the mark is still
inside the layer; the span's width moved 0.90 where the scales say 0.926. What the step no longer does
is the thing the rebuild did to the reader: clear the layer, re-render it, and let the highlight effect
wrap the matches a second time, which flashed every highlight off and back on at each step. A *turn*
still rebuilds, on purpose — pdf.js's `update` re-applies rotation to the layer box, not to spans whose
positions were computed against the viewport the layer was built with — and the marks re-apply there as
they always did. `.spike/out/textlayer.json` has both probes, including the one long frame (33.3 ms)
the canvas repaint still costs, which this change neither touches nor claims to.

**One number measured here that has never been measured before, and is not explained.** Re-running the
reader-speed pass on the *default* playground document — tracemonkey, 14 pages of dense two-column
academic text, dpr 1.25, fit width — gives p50 7 ms but **p99 35–49 ms and about 18 frames over 16.7 in
every 200**, four runs in a row. The same fixture has ~1,100 text spans mounted where the thousand-page
fixture has two per page, so the likeliest reading is rasterisation of a dense page rather than anything
the two changes above touched, and every frame figure this project has ever published for a scroll was
taken on the thin fixture. It is recorded rather than chased: this session did not A/B it against `0.7`,
so it cannot be called a regression or a non-issue, only unmeasured until now.

**`#137` is answered, and it did not need the fixture it asked for.** The task was written on the
reading that our XFA packets never bind — the DOM shows a `fieldId` and no `data-id`, so
`XfaLayer.setupStorage` was taken never to attach, and no edit could reach the storage a save would
write. `setAttributes` says otherwise: `case "dataId": break;` — the key is read from the layout
object, used for the binding, and deliberately never written as an attribute. The absence that
motivated the task is the design working. Asked directly instead, on `xfa-sample.pdf` with the forms
feature on: **`annotationStorage.size` goes 0 → 1 on a keystroke.** The edit is recorded. It is
recorded under a key the DOM does not expose — `getRawValue('field46')` is null while `size` says one
thing is in there — because that key is `dataId`, the worker's own uid for the datasets node the field
resolved to. And `saveDocument()` then throws `Cannot read properties of null (reading 'toString')`
from inside pdf.js. The hybrid fixture answers nothing: with `/AcroForm/Fields` present `isPureXfa` is
false, the AcroForm paints and the XFA layer is cleared, so no XFA widget is even on screen. So: a
reader's keystroke in a LiveCycle form **can** be recorded and **cannot** be written back — which is
what makes `usePdfDownload`'s `isPureXfa` guard right, and its comment now says that rather than the
binding story that was never true. The remaining XFA gap belongs to the writer, and no fixture can
close it. `.spike/out/xfabind.json`.

**`0.8`'s shipped locale catalogs: `pdfjs-react-reader/locales/{de,es,fr}`.** 134 strings each, every
one typed as the *complete* `PdfViewerLabels` rather than the partial a host may send, so a key added
to the English source stops the build in three files until it is answered. `src/locales/locales.test.ts`
adds what a type cannot: that every catalog has exactly the English key list and no extras, that every
value is a non-empty trimmed string, that every `{page}`-style slot survives with its name intact —
the one mistake a catalog can make that nothing else would ever report, since `formatLabel` leaves an
unfilled slot visible rather than blanking a control's accessible name — and that the catalog
translates, with four exceptions named in the test because French genuinely writes "Page" and
"Document". They are separate entry points, not exports of the index: German is **2.17 kB gzipped** and
importing the viewer must not hand you a language. `core` is unchanged at 24.77 kB; the three files are
ratcheted as their own shipped paths (`catalog:de/es/fr`). Verified in the browser through the
playground's "Shipped German catalog" toggle — toolbar names, the page counter and the zoom select all
read German, and the select is still findable by its German `aria-label` (`Zoomstufe`) — and the docs
example resolves the same specifier against `dist` as well as `src`, which is what CI builds. The
wording has not been through a native speaker, and the docs page says so.

**`#136` closed: a card of an XFA page now shows the form.** `PdfThumbnail` painted only the
canvas, and a page composed from a template has no painted page — measured again here, the
thumbnail's canvas holds **zero** non-white pixels — so every card of such a document was a blank
white rectangle with a number under it. The thumbnail now fetches the page's XFA tree and composes it
with `XfaLayer.render`, the same call and the same `dontFlip` viewport `PdfPage` makes, against the
document's own annotation storage, into an overlay sized by `--total-scale-factor` set to the card's
scale. On `xfa-sample.pdf`, sidebar open: the overlay holds 21 elements and the 59 characters the page
holds (`Painted by the XFA layer, not the canvas … End of the template`), the sheet's transform is
`matrix(0.196, …)` against a card 100 px wide on a 500 pt page, and the box it draws into — 98×137 at
29,286 — sits inside the card's own 100×139 at 28,285.

That is a second live copy of a form inside a `<button>`, which is why three things come with it: the
overlay is `aria-hidden`, it is `inert`, and every field inside it is walked to `tabIndex = -1` for the
engines that do not honour `inert` — iOS 14 and 15 among them, the versions `0.8` is meant to measure.
Measured: `inert: true`, both fields unfocusable, and **zero** tabbable controls anywhere inside the
cards, where the DOM still holds two inputs. A reader who never opens the sidebar hears nothing; a
reader who tabs through it moves card to card as before. The pointer is kept off the sheet by the
page's own rule, so a click still turns to the page.

**The 0.8 API-freeze review: what 1.0 would be promising.** Counted, not remembered —
`.spike/docs-coverage.mjs` reads the three barrels and checks every name against the docs pages and
examples. `src/index.ts` exports **203** (117 values, 86 types), `src/headless.ts` **158** (89 values,
69 types), `src/edit.tsx` **9**. Before this review the index barrel had **60 of its 115 values named
nowhere in the docs** — 13 of them outside `lib/`, among them whole components a host is meant to
compose (`ViewerLayout`, `ThumbnailList`, `PdfThumbnail`, `OutlineView`, `InkLayer`, `PasswordPrompt`)
and the seam the shell’s own parts read their words through (`LabelsContext`, `useLabels`). It now has
**zero**, in both barrels: `docs/src/pages/Api.tsx` names every value export, groups the `lib/` layer by
module with its names listed verbatim, and says what each part is for. 61 types remain unnamed — the
per-hook `*Options` and `*Result` shapes, which the page states it describes at the hook rather than
field by field. That is the residual, recorded rather than papered over.

Five decisions, written down rather than left to the next refactor.

1. **The `lib/` re-exports stay public.** `0.1`'s promise was that the headless layer is enough to
   build your own viewer, and it is only enough if `computeLayout`, `planPrintPages`, `buildPageText`
   and the rest can actually be imported — a private-but-reachable module would be a path that breaks
   on any rename. Freezing them costs nothing that is not already paid.
2. **Eight of them are plumbing, and the page now says so rather than implying it.**
   `readEditingParams`, `workerAutoDetectionFailed`, `HIGHLIGHT_COLOR_PARAM`, `strokePathD`,
   `mergeFeaturePageProps`, `samePublication`, `NO_FEATURES`, `LabelsContext` exist because a shell part
   needs them, not because a host should. Cutting them would be a breaking change made in the one
   release whose whole job is to stop making them, so they are named in the table with the reason.
3. **The exported collections are mutable, and one of them has already bitten.** `INK_COLORS`,
   `INK_WIDTHS`, `HIGHLIGHT_COLORS`, `ZOOM_LEVELS`, `PRINT_SCALES`, `DEFAULT_PAGE_ESTIMATE` and
   `DEFAULT_LABELS` are exported as plain arrays and objects, so a host that sorts one or assigns into
   one changes every viewer on the page — the failure the `0.4` review recorded and left for this one.
   The fix is `Object.freeze` plus `readonly` types, which is a contract change for anyone currently
   doing exactly that, so it waits for `1.0`'s breaking window rather than landing mid-freeze; the docs
   page tells a host to spread instead, which is correct today and after. The three shipped catalogs are
   frozen *now*, in the same change that adds them, because nothing can be relying on writing to them
   yet — and `locales.test.ts` asserts it, so the next catalog that forgets fails.
4. **Two names were added by this release and are already in the table:** `meanBox` and `spreadSample`,
   the estimator `#138` introduced. A host writing its own windowing needs the same arithmetic the
   built-in virtualizer now uses, which is the criterion the rest of the library layer is judged by.
5. **`findFeatureKey` returns `{ feature, binding } | null`.** The `0.4` review asked for the feature
   alongside the binding; `src/lib/features.ts:200` already does, and the bullet that asked for it was
   older than the change that satisfied it.

Nothing else in the surface is knowingly wrong. `PdfViewerHandle`, the `controls` shape, the feature
contract and the authoring hooks were each added against a host that needed them, in the release that
added them, with an example. What `1.0` is now promising is 203 names, 117 of them reachable values, and
that number is written here so a later widening is a decision and not a drift.

### 0.8.0 — Freeze: hardening

* Real-device matrix: iOS Safari 14 and 15, where the `:has()` fallback for container queries is
  written but has never been measured on any Safari, plus Android Chrome.
* The performance bar `PRD.md:22` states: **the fixture and the desktop numbers are done** (see the
  block above — 1,000 pages, sub-100 ms cold render, no dropped frame at reader speed). What is left is
  measuring the same scroll on the devices in the bullet above, which is the only part of the claim still
  unverified.
* Shipped locale catalog — open. **`#138`, `#139` and `#140` are closed**, each in the block above:
  the mean box the unmeasured rows are sized from, the update-depth guard read as the development
  artefact it is (with the page box's clamp, which was a real defect), and the text layer re-laid out
  by `TextLayer.update()` instead of rebuilt.
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
* **Spike B — taken, 2026-09-26.** Six candidates examined, two viable, one recommended; the full
  measurement (sizes, the capability matrix, and the ordering trap that changes `0.7`'s design) is in
  *Spike B — taken* under `0.7.0 — Edit`. The optional-peer mechanics — a core build that never imports
  the writer — are **not** proven by the spike and are `0.7`'s first build task.
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

Built since, for `0.7`: `page-order-sample.pdf` (`scripts/make-page-order-pdf.mjs`), 20 pages each printing
its own number with page 5 carrying `/Rotate 90`, so a move, a turn and a delete are all readable back out
of the file rather than only off the screen; and three array-form `/XFA` containers
(`scripts/make-xfa-array-pdf.mjs`) — the packet split across three pairs, the whole packet in one pair, and
a hybrid that also carries `/Fields`. What none of them produce is a field that *binds*: the layout hands
the input a `fieldid` and no `dataId`, so `XfaLayer.setupStorage` never attaches and `#127`'s edit half is
still open.

Still needed: a signature-bearing form (a `/Sig` field — the reason `FR-16` stays *partial* above), and an
XFA packet whose fields reach the datasets with a `dataId`, which is the only way to answer whether a
reader's keystroke in a LiveCycle form can be saved. Built at the `0.7` close: `long-sample.pdf`
(`scripts/make-long-pdf.mjs`), 1,000 pages in a nested tree with three cycling page boxes, which is what
the `PRD.md:22` bar has now been measured against. These should come from generator scripts like the
existing `scripts/make-*-pdf.mjs`, not downloads.

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
