# Code reference — `pdfjs-react-reader`

**Read this file when you want to know what the software actually does.**

`PRD.md` says what we *meant* to build. `ROADMAP.md` says what we *planned*, release by release.
`CHANGELOG.md` says what we *shipped* and why. All four of those can be wrong, and have been — several
times, in this project's history, a sentence in a document turned out not to match the code.

This file is different in one way: **every line in it was read out of the source on 2026-09-28**, and
almost every claim carries the file and line number it came from. Where a document says something else,
both are shown and the code wins. Nothing here is a goal, an intention, or a promise.

It was generated against `0.8.0` + the signing work (commit `0fc7273`). Re-run the commands in
[Checking this document](#checking-this-document) any time you want to see whether it has drifted.

---

## 1. What this package is, in plain words

It's a PDF viewer you can drop into a React app.

You give it a PDF — a URL, a file the user picked, raw bytes, base64 text, whatever — and it shows the
pages. You can scroll, zoom, search, fill in a form, draw on it, print it, save it, rearrange the pages,
and sign a signature box. Underneath it uses Mozilla's own PDF engine (`pdfjs-dist`) and nothing else.

Two ways to use it, and the important design decision of the whole project:

1. **Headless** — you import a hook (`usePdfDocument`, `usePdfVirtualizer`, …), the library does the
   hard parts (loading, measuring, deciding which pages to draw), and you write 100% of the HTML and
   CSS yourself.
2. **Shell** — you import `<PdfViewer src={...} />` and get a finished viewer with a toolbar, sidebar,
   thumbnails, search box and all of it, which you can re-skin with CSS variables.

And one rule that everything else follows from: **a feature you don't import must not cost you
anything.** Turning off a toolbar button does not shrink your bundle — only the `import` statement does.
That was measured, not assumed (`ROADMAP.md` §0.4: props were cosmetic; 18.4 kB bundled either way). So
print, download, forms, outline, layers, attachments, annotation and page-editing are each a separate
file you import or don't.

No runtime dependencies at all (`package.json` → `"dependencies": {}`). Everything is peer: React,
React DOM, `pdfjs-dist`, and one optional writer.

---

## 2. The headline numbers, measured today

| Thing | Number | Where it comes from |
| --- | --- | --- |
| Version in `package.json` | `0.9.0` — **not published**; npm only has `0.1.0`, `0.1.1`, and `0.2`–`0.9` go out together as `1.0.0` | `package.json:2` |
| Module system | ESM only (`"type": "module"`, tsup builds no CommonJS) | `package.json:4` |
| Runtime dependencies | **none** | `package.json` `dependencies` |
| Peer dependencies | `pdfjs-dist ^6.2.108`, `react ^18 \|\| ^19`, `react-dom ^18 \|\| ^19`, `@cantoo/pdf-lib ^2.11.1` (optional) | `package.json` `peerDependencies` |
| `engines` field | `node >= 20` — the only engine statement the package makes | `package.json` `engines` |
| Files published | `["dist"]` only — no `src/`, no playground, no docs | `package.json` `files` |
| Importable subpaths | **22** (10 JS entries + 3 languages + 8 stylesheets + `package.json`) | `package.json` `exports` |
| Names on the main entry | **226** | `node scripts/inventory.mjs`, over `dist/index.d.ts` |
| Names on `/headless` | **181** | the same, over `dist/headless.d.ts` |
| Names on `/edit` | **32** | `dist/edit.d.ts` |
| Source files (non-test) | **76**, 14,606 lines | `src/**` |
| Test files / tests | **59 files / 661 tests**, in two projects (`node`, `dom`) | `npm run test` |
| Stylesheets | 8, from 72 to 1,265 lines | `src/styles/` |
| Fixtures | 18 PDFs, produced by 14 generator scripts, **all 18 tracked** as of the `0.9` close — before it, three (`damaged-truncated`, `damaged-xref`, `labelled-sample`) existed only on this machine while their tests read them from disk, which would have failed a fresh clone's `npm test` | `playground/fixtures/`, `scripts/make-*.mjs` |
| CI | 4 jobs in `ci.yml`, 1 deploy workflow in `docs.yml` | `.github/workflows/` |

### Bundle size, gzipped, per what you import

Measured by `scripts/check-size.mjs`, which bundles every path with **both** esbuild and Rollup and
reports the worse of the two. Decimal kB. Reproduced by `npm run size`.

| What you import | Size | Over core |
| --- | --- | --- |
| `core` — `<PdfViewer>` alone: pages, text, search, ink, thumbnails, layout, toolbar, sidebar, virtualisation, worker | **27.76 kB** | — |
| `+ printFeature` | 30.28 | +2.52 |
| `+ downloadFeature` | 28.51 | +0.75 |
| `+ formsFeature` | 29.78 | +2.02 |
| `+ outlineFeature` | 28.71 | +0.94 |
| `+ layersFeature` | 28.95 | +1.19 |
| `+ attachmentsFeature` | 28.84 | +1.07 |
| `+ annotateFeature` | 29.59 | +1.83 |
| `+ editFeature` (pages, flatten, signing) | 33.63 | **+5.87** |
| **all eight** | **42.53** | +14.76 |
| `headless` entry alone (no shell, no shaking) | 4.06 | — |
| shipped `index.js` path (whole entry, no shaking) | 57.90 | — |
| shipped `headless.js` path | 30.85 | — |
| `dist/edit.js` on its own | 8.64 | — |
| one language file (`de` / `es` / `fr`) | 2.38 / 2.37 / 2.39 | — |

**The baseline was re-accepted for `FR-12`, so every number above equals `npm run size` today.** The chain
that got there is in the Unreleased notes: `FR-37`/`FR-03`/`FR-07` measured +0.39 kB on top of the
`FR-38` acceptance without needing one, and `FR-12` then pushed the `shell` path past the ratchet — which is
when the re-accepting happened, after the growth was attributed rather than golfed.

For scale, measured the same way (gzip level 9): `pdf.min.mjs` **131.70 kB**, `pdf.worker.min.mjs`
**375.25 kB**, and `@cantoo/pdf-lib` **251.41 kB** for what our writer imports (256.05 kB for its whole
API). The engine is 507 kB before this package contributes anything, which is the context for every
number above.

### The two size rules that fail a build

1. **The ratchet.** Any measured path growing more than **2 %** above the baseline committed in
   `size-baseline.json` (plus **256 bytes** of slack for minifier jitter) fails. Accepting growth means
   running `npm run size:update`, which is a reviewable line in the same diff.
2. **The per-feature assertion.** No single feature more than **6 kB** over core. This one is a constant
   in `scripts/check-size.mjs` — `size:update` cannot lift it; it has to be argued. It was 4 kB until the
   signing work (2026-09-27), and the reason is in `PRD.md` §6: bytes are negotiable, behaviour under
   load is not.

---

## 3. Every way in — the 22 import paths

`package.json` → `exports`. Every JS path ships a `.js` and a matching `.d.ts`.

| You write | You get |
| --- | --- |
| `pdfjs-react-reader` | Everything: the shell, the toolbar, the hooks, the library layer (203 names) |
| `pdfjs-react-reader/headless` | Hooks + pure logic, no shell (158 names) |
| `pdfjs-react-reader/edit` | The page-editing / flatten / signing tier (32 names) — the only file that imports the writer |
| `pdfjs-react-reader/features/print` | `printFeature`, `createPrintFeature`, `PrintScope`, 2 types |
| `pdfjs-react-reader/features/download` | `downloadFeature`, `createDownloadFeature`, 2 types |
| `pdfjs-react-reader/features/forms` | `formsFeature`, `createFormsFeature`, 2 types |
| `pdfjs-react-reader/features/outline` | `outlineFeature`, 1 type |
| `pdfjs-react-reader/features/layers` | `layersFeature`, 1 type |
| `pdfjs-react-reader/features/annotate` | `annotateFeature`, `createEditorEventBus`, 2 types |
| `pdfjs-react-reader/features/attachments` | `attachmentsFeature`, 1 type |
| `pdfjs-react-reader/locales/de` \| `/es` \| `/fr` | One complete language each; **separate entries so importing the viewer never hands you a language you didn't ask for** |
| `pdfjs-react-reader/styles.css` | The shell theme |
| `…/print.css` `forms.css` `outline.css` `layers.css` `annotate.css` `attachments.css` `edit.css` | A feature's CSS, only needed if you mount that feature |
| `pdfjs-react-reader/package.json` | Read-only access (for tools that want the version) |

`"sideEffects": ["**/*.css"]` — stylesheets survive tree-shaking, JavaScript does not.

---

## 4. Every name you can import, grouped

The full name list from the built `.d.ts` files, grouped by what it is for, and **current through the
`0.9` close**: 226 names on this entry, 181 on `/headless`, 32 on `/edit` (§2 has the same three figures
from a different measurement). `T` below marks a type-only export, and each hook's option/result pair is
written once rather than twenty times. `node scripts/inventory.mjs` prints the flat list per entry, so a
disagreement between this section and the build is a fact about this section.

### Shell components (you can compose these yourself)
`PdfViewer` `ViewerProvider` `useViewer` `ViewerLayout` `ViewerRoot` `ViewerToolbar` `ViewerSidebar`
`ViewerPages` `Toolbar` `T ToolbarProps` `T ToolbarItem` `T ToolbarControls` `SearchBox`
`T SearchBoxProps` `Sidebar` `T SidebarProps` `T SidebarTab` `ThumbnailList` `T ThumbnailListProps`
`PdfThumbnail` `T PdfThumbnailProps` `OutlineView` `T OutlineViewProps` `InkLayer` `T InkLayerProps`
`PdfPage` `T PdfPageProps` `PasswordPrompt` `T PasswordPromptProps` `LabelsContext` `useLabels`
`T PdfViewerHandle` `T PdfViewerProps`

### Controller
`useViewerController` `T ViewerController`

### Feature contract (write your own feature)
`T PdfFeature` `T AnyPdfFeature` `T PdfFeatureControl` `T PdfFeaturePanel` `T PdfFeatureKeyBinding`
`T PdfViewerShell` `T FeaturePageProps` `T FeaturePublication` `T FeatureKeyEvent` `NO_FEATURES`
`findFeatureKey` `mergeFeaturePageProps` `samePublication` — plus the authoring hooks
`usePdfFeatureShell` `usePdfFeaturePublish` `usePdfFeatureState` `usePdfFeatureOptions`
`usePdfFeaturePeer` `T FeatureStore`

### Headless hooks
`usePdfDocument` `usePdfVirtualizer` `usePdfSearch` `usePdfOutline` `usePdfPrint` `usePdfDownload`
`usePdfFormValues` `usePdfInk` `usePdfOptionalContent` `usePdfAttachments` `usePdfPageLabels` — with their
option and result types (`T UsePdfDocumentOptions`, `T UsePdfDocumentResult`, … one pair per hook) and
`T PdfCapabilities` `T PasswordReason` `T PasswordSubmit` `T PdfLoadProgress` `T PdfFindController` and
the `PRD.md` §3.5
state models — `T PdfDocumentStatus` `T PdfPageStatus` `T PdfPasswordRequest` from `src/lib/status.ts`,
a module of types only, so neither entry pays bytes for them

### Engine plumbing
`configureWorker` `ensureWorker` `workerAutoDetectionFailed` `configureTrustedTypes`
`isTrustedTypesConfigured` `readCanvasEnvironment` `T CanvasEnvironment` `normalizeSource`
`classifySource` `base64ToBytes` `isAllowedSource` `resolveSourceUrl` `T NormalizedSource`
`T PdfSource` `T PdfSourceClassification` `T PdfSourceRefusal` `pdfAssetUrls`
`resolveAssetRoot` `CDN_ASSET_ROOT` `T PdfAssetUrls` `T AssetUrl` `createPdfLinkService`
`T PdfLinkService` `T CreatePdfLinkServiceOptions` `ensureWorker`

### Pure logic you are free to reuse
*Layout & zoom:* `computeLayout` `computeSlots` `findVisibleRange` `meanBox` `spreadSample`
`scaledPageSize` `applyRotation` `automaticFitMode` `resolveRenderScale` `T LayoutResult`
`T PageLayout` `T ScaleMode` `T RenderScale` `T RenderScaleOptions` `T PageDims` `T VirtualSlot`
`T VisibleRange` `T PdfViewportRef` `T ViewportPoint` `DEFAULT_PAGE_ESTIMATE` `ZOOM_LEVELS`

*Canvas caps:* `maxRenderPixelsFor` `isMobileCanvasEnvironment` `readCanvasEnvironment`
`MAX_RENDER_PIXELS` `MAX_RENDER_PIXELS_MOBILE` `MAX_RENDER_SIDE` `CAP_AREA_FACTOR` `BYTES_PER_PIXEL`

*Text & search:* `extractPageText` `extractAllText` `buildPageText` `findPageMatches` `convertMatches`
`convertMatchRanges` `countPerPage` `planFind` `findStartIndex` `escapeRegExp` `T PageTextIndex`
`T PageMatch` `T TextItemLike` `T SearchOptions` `T ResolvedSearchOptions` `T SearchStatus` `T FindPlan`

*Forms:* `collectWidgets` `groupWidgets` `describeWidget` `readFormValues` `readInitialValues`
`writeFormValues` `clearFormValues` `formValuesDiffer` `AnnotationValueStore` `T FormField`
`T FormFieldOption` `T FormFieldType` `T FormValue` `T FormWidget`

*Ink:* `drawInkStrokes` `strokePathD` `strokeBounds` `pointsBounds` `simplifyPoints` `createStrokeId`
`INK_COLORS` `INK_WIDTHS` `T InkStroke` `T InkSettings` `T PdfPoint`

*Editing state (what pdf.js has selected):* `readEditingState` `readEditingParams` `HIGHLIGHT_COLORS`
`DEFAULT_HIGHLIGHT_COLOR` `HIGHLIGHT_COLOR_PARAM` `HIGHLIGHT_PALETTE_STRING` `T PdfAnnotationState`

*Outline:* `parseDestination` `resolveDestinationPageIndex` `T OutlineEntry` `T DestinationRef`

*Optional content:* `T OptionalContentConfigHandle`-style helpers via `usePdfOptionalContent`
(`T OptionalContentRow`, `T OptionalContentBundle`, `T OptionalContentGroupState`,
`T OptionalContentOrderEntry`, `T OcStateAction`, and the plain functions `flattenOptionalContent` and
`optionalContentGroupIds`)

*Attachments (`/headless` only):* `normalizeAttachments` `attachmentMimeType` `T AttachmentInfo`

*Print:* `planPrintPages` `planPrintScale` `estimatePrintBytes` `maxPrintablePages` `printCanvasSize`
`isPrintSupported` `printRangeFor` `PRINT_SCALES` `PRINT_MEMORY_BUDGET` `PRINT_CONTAINER_CLASS`
`T PrintOptions` `T PrintScope`

*Download:* `downloadBytes` `pdfFileName` `formatBytes` `T PdfDownloadOptions`

*Load retry (FR-35):* `classifyLoadError` `DEFAULT_RETRY_POLICY` `T RetryPolicy`
`T RetryAttemptInfo` `T RetryVerdict`

*Cancellation (FR-36):* `onAbort` `abortError` `isAbortError` `throwIfAborted`

*Page labels (FR-12):* `pageLabelForIndex` `formatPageLabel` `labelsDifferFromNumbers`
`resolvePageInput` `T PdfPageLabels`

*Keyboard:* `pageNavigationKey` `isEditableTarget` `T PageKey`

*Fullscreen:* `T FullscreenState`-level helpers via `useFullscreen` internals

*Labels:* `DEFAULT_LABELS` `formatLabel` `T PdfViewerLabels` `T PdfViewerLabelsOverride`

### The `/edit` tier's 32 names
Values: `editFeature` `createEditFeature` `arrangePages` `flattenBytes` `findSignatureFields`
`signFields` `initialPlan` `inversePlan` `isPristine` `movePlanned` `plannedPages` `removePlanned`
`rotatePlanned` `boxToPage` `isSignable` `padToBox` `signatureContent`
Types: `T EditFeatureOptions` `T EditFeatureState` `T PageEditNotice` `T PagePlan` `T PdfBytes`
`T PdfArrangeResult` `T PdfFlattenResult` `T PdfPageArrangement` `T PdfSignResult`
`T PdfSignatureField` `T PdfSignatureMark` `T SignatureStyle` `T BoxPoint` `T PageRect` `T PadSize`

---

## 5. `<PdfViewer />` — all 35 props, in plain words

From `src/components/PdfViewer.tsx`. Anything not marked required has a sensible default.

**Getting the document in**

| Prop | What it means |
| --- | --- |
| `src` *(required)* | URL, relative path, `File`/`Blob`, `ArrayBuffer`, `Uint8Array`, a `data:` URL, or raw base64. All six shapes are normalised in `src/lib/source.ts`. |
| `workerSrc` | Where pdf.js's worker script lives. Omit it and the package finds it (see §10). |
| `assetUrl` | Where cMaps and standard fonts live. Defaults to your own origin; a string or `{ cMaps, standardFonts }`. |
| `allowedSources` | A security option: list of path prefixes `src` may be. Anything else is refused **before a request is made**. Does not apply to bytes you pass directly. |
| `enableXfa` | LiveCycle form rendering. **On by default**, and that carries a risk: a document whose template pdf.js can't lay out fails to load instead of showing a blank page. |

**Starting state**

`defaultScale` (`'fit-width'` `'fit-page'` `'automatic'` or a number) · `defaultLayout`
(`'continuous'` `'single'` `'spread'`) · `defaultRotation` · `defaultPageRotations`
(per-page `{ [pageIndex]: degrees }`) · `defaultSidebarOpen` · `gap` (pixels between pages)

**How it draws**

`devicePixelRatio` (unset → the live `window.devicePixelRatio`, re-read when the display changes; the render
ceilings can still clamp it, see §11. Pass `1` on a low-power device, and note that pinning it also stops a
monitor switch repainting these pages) ·
`maxRenderPixels` (override the memory cap, see §11)

**UI and language**

`className` · `style` · `labels` (override any subset of the 144 strings) · `controls` (say which
toolbar items are hidden, reordered, re-prioritised, or added — §12) · `find` (a `PdfFindController` you
provide, so *your* Ctrl-F drives *this* search) · `features` (the tiers you mounted)

**Turning interactions off**

`enableWheelZoom` · `enablePinchZoom` · `enableFullscreen` · `enableKeyboardNavigation` ·
`enableDrop` · `acceptDrop(file)` · `onDropFile(file)`

**Callbacks**

`onPageChange(page)` · `onScaleChange(scale)` · `onLayoutChange(layout)` ·
`onCapabilities({ hasJSActions, isAcroForm, isXfa, … })` — **fire once after load and never again**, so
a warning banner can't flicker · `onFullscreenChange(active)` · `onAnnotationChange(state)` — only fires
if `annotateFeature` or `editFeature` is mounted · `onError(error)` · `onPasswordRequired(submit, reason)`
(replace the built-in prompt; call `submit('pw')` or `submit(new Error())` to abandon)

## 6. The handle — `useRef<PdfViewerHandle>`

`goToPage(page)` · `zoomTo(scale)` · `zoomBy(factor)` · `fitTo('width' | 'page' | 'automatic')` ·
`setLayout(layout)` · `rotate(degrees)` · `rotatePage(page, degrees)` · `openSidebar(open, tab?)` ·
`toggleFullscreen()` · `search(query, options?)`

The viewer is **uncontrolled** — it holds its own state; the handle is how you drive it.

---

## 7. The eight features, and what each one actually adds

Every feature is a plain object (`src/lib/features.ts`): `id`, optional `Runner`, `controls`, `panel`,
`keys`, `pageProps`, `replaces`. The `Runner` is where its hooks live, and it is keyed by `id` — not by
array position, because reordering a list would otherwise silently remount a survivor and lose its state.

| Import | `id` | Toolbar control(s) (priority) | Sidebar panel | Keys | What you can do with it |
| --- | --- | --- | --- | --- | --- |
| `features/print` | `print` | `print` (8), `print-pages` (11) | — | `Ctrl/Cmd+P` when printing is supported | Print all / current / a typed range at print intent, honouring stored form values and ink; memory-budgeted resolution; cancellable with a progress bar |
| `features/download` | `download` | `download` (9) | — | — | Save the original bytes, or an incremental save carrying the edits — field values and annotation marks ride the same storage |
| `features/forms` | `forms` | — | — | — | AcroForm widgets (text, checkbox, radio, choice, button) wired to pdf.js annotation storage; `createFormsFeature({ onChange })`; get/set/reset programmatically |
| `features/outline` | `outline` | — | **Outline** tab | — | Document bookmarks; clicking one navigates |
| `features/layers` | `layers` | — | **Layers** tab | — | Optional-content groups; switching one redraws every page (one shared `OptionalContentConfig`) |
| `features/attachments` | `attachments` | — | **Attachments** tab | — | List embedded files, save any one |
| `features/annotate` | `annotate` | `draw` (6) | — | — | pdf.js's own editor manager behind **three tools only**: highlight, free text, ink. Colour picker from the engine palette, Delete live while a mark is selected, undo/redo on published state |
| `edit` | `edit` | — | **Pages** tab (with a **Sign** section when the file has signature fields) | — | Move / rotate / remove pages as a *plan* you can step back before writing; Apply; Extract planned pages as a new file; Split at any row; Flatten; sign a box |

Two rules inside that table are load-bearing and easy to break:
* `annotate` can't do underline, strikeout or squiggly — the engine has no editors for them — and
  **stamp and signature break the save**, which is why neither is offered.
* `edit` is the only tier that reads the file back, so it is the only tier with a dependency, and it is
  `optional` in `peerDependenciesMeta`. `scripts/check-size.mjs` asserts the writer specifier is
  **absent from core and present only there**.

---

## 8. Toolbar vocabulary

The bar is 17 built-in control ids, in this built-in order
(`src/lib/toolbar.ts`, `src/components/Toolbar.tsx`):

`sidebar` · `prev` · `page` · `count` · `next` · `search` · `draw` · `zoomOut` · `fit` · `zoomIn` ·
`zoomCustom` · `rotateCcw` · `rotateCw` · `rotatePage` · `fullscreen` · `layout` · `meta`

Plus whatever features add. You configure it with `controls`:

* `hide: ['layout', …]` — eviction
* `order: ['search', 'print', …]` — placement; name one id to pull it forward, name them all to dictate
  the bar exactly
* `priorities: { print: 3 }` — who folds into the overflow first when space runs out
* `add: [{ id, label, run, priority }]` — your own control, folded by the same arithmetic

**The overflow is measured against the container, not the viewport** — a 320 px-wide viewer inside a
1600 px window must fold. Two `ResizeObserver`s drive it; folding tiers in CSS are container queries at
640 px and 440 px (`@container pjsr (max-width: 640px)` and the same at `440px`, both in `viewer.css`), with an `@supports`/`:has()` fallback written for
Safari 14 (**never measured on a real Safari — that's open, see §20**). Touch target size keys off
pointer type, not viewport width.

**The `page` control shows a page's name, which is not always its number.** `usePdfPageLabels` reads
`doc.getPageLabels()` once per document and the controller publishes the table as `pageLabels`; when it
differs from the plain numbers the box becomes a text input holding the label ("i", "A-1"), and what the
reader types back is resolved by `src/lib/page-labels.ts` — **label first, number second**, because they are
copying what they can see. `labelled-sample.pdf` makes the difference concrete: its sixth page is labelled
"2", so "2" means the fifth page, while a value that names no label and *is* a whole number clamps into the
document and anything else ("3a" included, which `Number.parseInt` reads as 3) is refused and the box goes
back to the page in view. The control's `type` is not a cosmetic choice: `type="number"` reports an invalid
value as the empty string, so a label box cannot be a number box — and an ordinary document keeps its
spinner, because the table it answers with is `null`.

---

## 9. Every constant a host can read

| Name | Value | Meaning |
| --- | --- | --- |
| `ZOOM_LEVELS` | `0.25 0.33 0.5 0.66 0.75 0.9 1 1.1 1.25 1.5 1.75 2 2.5 3 4 5` | The zoom picker. Any percentage 25–500 also works via `zoomTo`, and `Automatic` fits a landscape page whole / a portrait one by width |
| `INK_COLORS` | `#d92d20 #4f46e5 #067647 #181d27` | Core freehand pen colours |
| `INK_WIDTHS` | `1, 3, 6` px (thin / medium / thick) | Core pen widths |
| `HIGHLIGHT_COLORS` | Yellow `#FFFF00`, Green `#00FF00`, Pink `#FF0093`, Blue `#00FFFF`, Orange `#FFC800`, Red `#FF0000`, Purple `#800080` | The editor's highlight palette, straight from the engine's own list |
| `DEFAULT_HIGHLIGHT_COLOR` | first of the above | |
| `PRINT_SCALES` | `2, 1.5, 1` | Tried in that order against the memory budget |
| `PRINT_MEMORY_BUDGET` | `256 MiB` | A job that would exceed it is refused, with a shorter range suggested |
| `BYTES_PER_PIXEL` | `4` | RGBA, used by the budget maths |
| `MAX_RENDER_PIXELS` | `2^25` = 33,554,432 | Desktop canvas-area cap |
| `MAX_RENDER_PIXELS_MOBILE` | 5,242,880 | Mobile/iPadOS cap |
| `MAX_RENDER_SIDE` | 32,767 px | Hard engine limit on one canvas side |
| `CAP_AREA_FACTOR` | `200` | `devicePixelRatio` is clamped down so area stays under the cap |
| `DEFAULT_PAGE_ESTIMATE` | `{ width: 612, height: 792 }` | US Letter, used before anything is measured |
| `CDN_ASSET_ROOT` | `https://unpkg.com/pdfjs-dist@<installed version>/` | Version-pinned, so cMaps can't mismatch the engine |
| `NO_FEATURES` | frozen `[]` | The default `features` prop — a shared constant, so identity is stable across renders |

**These seven are exported mutable.** A host that sorts one in place changes every viewer on the page.
Freezing them is a contract change deliberately held back for `1.0` (§20). The three language catalogs
*are* frozen, and `src/locales/locales.test.ts` asserts it.

---

## 10. How a document actually gets loaded

1. `normalizeSource(src)` (`src/lib/source.ts`) turns six shapes into either a URL or bytes. For a string
   it is `classifySource(src)` and nothing else — one heuristic, also exported on its own, so a host can
   ask what it holds before loading (FR-38). Unrecognised input throws with a message naming the accepted
   shapes, and that message is the `message` the classification carries; a `;base64` data URL is decoded
   here rather than fetched, so `data:` reaches pdf.js as bytes.
2. `allowedSources`, when provided, is checked **before** any request: a path is resolved through the
   current document URL, and only a prefix match passes. `blob:`/`data:` are refused; `File` objects are
   always allowed because the user handed them over.
3. The worker is resolved **once per page, not per document** (`src/lib/worker.ts`):
   * an explicit `workerSrc` always wins, and it writes pdf.js's **process-global**
     `GlobalWorkerOptions.workerSrc` — so a second viewer passing its own value changes what every
     *later* load resolves to, while already-open documents keep their worker;
   * otherwise two candidate URLs are probed in order — **relative first** (`new URL('../../pdfjs-dist/build/pdf.worker.min.mjs', import.meta.url)`),
     bare second, because a bundler rewrites a bare specifier at build time but *not* while serving
     modules in dev. Getting this wrong is how `0.1.0` shipped a 404 worker;
   * a candidate only counts as answering if `HEAD` returns OK **and** the content type isn't
     `text/html` — a catch-all route answers 200 with the app shell, and pdf.js would try to run markup
     as a module;
   * if nothing answers, `workerSrc` is left **unset** rather than pointed at something known-bad. That is
     not itself a fallback — pdf.js's main-thread parser *is* the worker's code, so the fallback exists only
     where that code is reachable without a URL: Node, where the engine writes its own `./pdf.worker.mjs`
     default, and a host that has assigned `globalThis.pdfjsWorker`. An ordinary page whose candidates all
     404 **fails**, naming `workerSrc`, and a guessed dead URL would both overwrite the Node default and
     replace that sentence with a failed import of a path nobody wrote. `src/lib/worker.fallback.test.ts`,
     `worker.fallback.onpage.test.ts`, `worker.fallback.nocode.test.ts` and
     `worker.fallback.deadurl.test.ts` measure the four states — one per file, because pdf.js memoises its
     worker lookup per module instance; the browser pass measured the pixels.
   * `configureTrustedTypes()` exists for pages with a `require-trusted-types-for` CSP, where pdf.js
     can't build a worker from a string at all. Never called implicitly — only the page owner knows
     which policy name their CSP allows.
4. `usePdfDocument` calls `getDocument` with `cMapPacked`, resolved `cMapUrl`/`standardFontDataUrl`/
   `wasmUrl`, and `enableXfa` on by default. Each load owns its worker and disposes it when replaced.
5. Capabilities (`isAcroForm`, `hasJSActions`, `isXfa`, …) are read **after** the document is on screen,
   because the round trip changes nothing about the first paint.

**One gotcha worth knowing:** pdf.js refuses a `Buffer` on the `getDocument` **call**, not as a rejected
promise — and `normalizeSource` passes a Buffer straight through, because a Buffer *is* a
`Uint8Array`. Left unfixed deliberately (`src/lib/damaged.test.ts` pins the behaviour); no document
promises Buffer input, and copying every byte array to suit the engine is a host-facing decision.

---

## 11. How a page is rendered

Each page is one DOM node with up to five layers stacked by CSS positioning
(`src/components/PdfPage.tsx`):

| Layer | Notes |
| --- | --- |
| canvas | The page picture. Area and side clamped to §9's caps; a canvas too big to allocate **paints nothing rather than crashing**. |
| text layer | Invisible spans for selection, copy and screen readers. Its class list includes pdf.js's own **`textLayer`** — not our naming, and load-bearing: the editors find a selection's layer with `target.closest('.textLayer')`. |
| annotation layer | Form widgets, links, popups. `role="region"` with a label so a screen reader can find it; popups are click-to-open (hover-only tooltips failed 84 px from a viewport edge with no way back). |
| editor layer | Only when a feature that edits is mounted. `isEditing` is passed so an armed editor doesn't paint a duplicate over the canvas copy; the repaint is gated on *this* page having editable annotations. |
| XFA layer | A `position: absolute` child, because pdf.js's own `XfaLayer` CSS is **not** shipped — we restate the rules we depend on. |

Plus our own ink overlay (`InkLayer`) for the core freehand path.

Three behaviours here were measured, and they are the difference between a smooth 1,000-page document
and a stuttering one:

* **A zoom step re-lays the existing text layer out instead of rebuilding it** — `textLayer.update({ viewport })`
  in the layer effect. 39.8 ms → 1.0 ms for a 163-span page. A page *turn* still rebuilds, on purpose:
  pdf.js applies rotation to the layer box, not to spans positioned against the viewport it was built with.
* **Only the pages near the viewport exist.** `usePdfVirtualizer` keeps 2–4 canvases mounted, releases the
  buffer of a row that leaves, and estimates unmeasured rows from the **mean of twelve pages spread
  through the file** (`meanBox`, `spreadSample`) rather than page 1's box.
* **The layers are wired in the order pdf.js expects.** `optionalContentConfig` is copied off the first
  viewport read, because it isn't assigned until after `run()` returns.
* **The canvas density is watched, not sampled.** `useDevicePixelRatio()` returns a live value maintained by
  `src/lib/dpr.ts`: a `(resolution: Xdppx)` query pinned to the current ratio and re-armed whenever it
  stops matching, with a feature-detected `resize` fallback for engines that do not know the `resolution`
  feature — `caniuse-lite`'s `css-media-resolution` has Safari and iOS Safari partial below 16, inside the
  advertised floor, and a query for an unknown feature never matches, which is a watcher that never fires.
  One hub per realm, refcounted per subscription, so a document's mounted pages share it. A monitor switch
  repaints the visible pages at the new density and re-reads the shell's canvas budget; a `resize` at the
  same density repaints nothing — measured in the playground as **0** ops with the
  `CanvasRenderingContext2D` counters the FR-08 measurement used (see `ROADMAP.md`'s task-0 findings),
  and asserted in `src/lib/dpr.test.ts` and `PdfPage.status.test.tsx`.

**Two deliberate `null`s you should know about:** `annotationCanvasMap: null` and `structTreeLayer: null`,
both passed at the layer call sites in `PdfPage`'s render path. The first means an annotation that pdf.js
routes to its own canvas would not be collected — measured, our signature appearances don't take that path,
so it costs nothing today. The second **declines the tagged-PDF structure the PRD's accessibility
requirement asks for**; that is an open decision, not an oversight (§20).

Search marks are `data-pjsr-match` spans inside the text layer. Matching is whole-`Range` replacement
rather than per-span splitting, so a phrase crossing a span boundary is one highlight, not two — and it
is why the layer is rebuilt on a page turn instead of patched.

---

## 12. Search, print, download, forms — as implemented

**Search.** Options: `caseSensitive`, `wholeWord`, `regex` (three modes, and a pattern that doesn't
compile is reported, not swallowed — the expression is compiled *before* any page is read, so a typo
costs nothing). Outside regex mode the query splits on whitespace and a page counts only when **every**
word appears on it, which is the rule pdf.js's own viewer uses. Indexing is **whole-document**: every
page's text is extracted in page order, progress reported as a 0–1 fraction, with a yield to the event
loop every fifth page so the progress bar can paint. Results are a flat list of matches in document
order, navigated match by match: `Enter` steps forward, `Shift+Enter` back, `Escape` closes the bar;
the summary reads "15 of 27" and, once past the first hit, names the page it is on. Per-page counts
(`counts`, zeros included) and `pagesWithMatches` come for free. `PdfViewer`'s `find` prop accepts any
`PdfFindController` — `usePdfSearch` returns exactly that shape, structurally — so a host with its own
matching strategy (server-side index, fuzzy, synonyms) keeps the built-in find bar, marks and counts
instead of forking the shell.

**Print.** No new window: the pages are drawn into a hidden `div.pjsr-print` **inside the current
document**, `<body>` gets the `pjsr-printing` class, and `@media print` hides everything that is not
that container — which is why the print stylesheet must be loaded for printing to look right. Each page
is drawn to an offscreen canvas at whichever of `PRINT_SCALES` (`2, 1.5, 1`) keeps the whole job under
`PRINT_MEMORY_BUDGET` (256 MiB); when even scale 1 does not fit, the job is refused and the message
names how many pages *would* fit. **Stored form values and ink travel with it**, because they live in
one `annotationStorage`. `Ctrl/Cmd+P` prints the same selection as the button, but only while the print
feature is mounted and able — the binding is a feature key with `when: supported === true`.
`isPrintSupported` is false on iOS Safari, where the print call is blocked by design — the control
stays visible and explains itself rather than disappearing.

**Download.** If `annotationStorage` is empty, the **original bytes** — pdf.js's incremental save of an
untouched document writes a damaged subset with no `/Root`. If something was edited, the incremental
save. Never calls `saveDocument()` when the store is empty: pdf.js warns about exactly that, so a clean
session would log a warning per write for something the reader never did.

**Forms.** Widgets are collected once and grouped by field (radio buttons share one name). Values live
in pdf.js annotation storage, which is why printing and saving carry them with no extra plumbing.
`getFormData` / `setFormData` / `reset` for programmatic use; `onChange` for a host building its own
panel. `formsFeature` is **not** implied by the shell: it's one import, so a read-only viewer doesn't
pay for the editor layer.

**Keyboard.** `ArrowDown`/`PageDown` next, `ArrowUp`/`PageUp` previous, `Home`/`End` first/last — and
**deliberately not `ArrowLeft`/`ArrowRight`**, because a wide row at high zoom must stay reachable by
horizontal scroll. `isEditableTarget` keeps keystrokes out of the viewer while the reader is typing in a
form field. `Ctrl/Cmd+F` opens search, `F` toggles fullscreen (when not typing and not already in find),
`Ctrl/Cmd+P` prints. All of it is scoped to the instance's own root, and every interaction is reachable
without a pointer.

---

## 13. The `edit` tier — rearranging, flattening, signing

This is the only part that writes the file back, and the mechanism is specific because the obvious one
is broken.

* **A page move is a permutation of `/Kids`, with `/Count` restated.** The writer's own `removePage()`
  ends by deleting the object it just unlisted, so remove-then-insert leaves a tree naming something
  that no longer exists and the file won't reopen. Confirmed four ways before the mechanism was chosen.
* **Undo is data, not snapshots.** Ten page moves are ten edits to a list of integers and **one** pass
  through the writer at Apply; the inverse permutation restores the order. A *delete* is the one thing a
  permutation can't bring back, which is why the tier holds exactly one snapshot of the document as it
  was when editing began — and the undo button disables once spent, so the offer matches the memory held.
* **Rotations are keyed by the load-time index,** so "the page the reader rotated" needs no translation,
  and they're applied before deletions, which run **descending** so each removal still addresses the page
  it means.
* **Extract leaves the plan pending** — nothing was written to the document, so consuming the plan would
  be wrong. **Split is two arrangements from one `saveDocument()`** and must work with no plan at all
  ("split here at page 10" is the common case). Two files rather than N, because a fourth download in one
  click is a browser permission the viewer can't earn.
* **Flatten** bakes every mark and field value into the page. It also now gives any signature widget
  *without* an appearance an empty one first — because `flatten()` demands each widget's `/N` and threw
  `Unexpected N type: undefined` on any unsigned form, which is what an unsigned form looks like. That
  was a live defect from `0.7`, found by the signing fixture rather than by a reader.

**Signing.** Draw once in the pad, click the box. `signFields` writes the mark into that widget's
appearance: an `/XObject /Form` whose `/BBox` **is the widget's own `/Rect`**, so a path in page space
needs no matrix. The mark is held box-relative (0–1, y up) and scaled **per box**, because one field can
be displayed in two boxes of two sizes. `/V` is never written, and **a field that already carries one is
refused**: on a `/Sig` field, `/V` is somebody's claim over the bytes, and dropping a picture into the
same box leaves the file still claiming what it no longer keeps. The panel says in plain words that this
is a picture of a signature, not a cryptographic one. Listing the boxes parses the whole file, so it is
not done on mount: the panel asks `getMetadata()` first (one round trip) and the parse waits until the
reader has drawn something to place — 150–200 ms of main thread on a thousand-page form-bearing file,
0 ms on one that declares no form.

Two engine facts worth remembering if you touch this code: the writer's output and the fixture's are
**identical to pdf.js** at the annotation level (`hasAppearance: true`, `noHTML: true`, same `/Rect`),
and the mark paints in the viewer whether it came from disk or from the panel — measured, 0 → 856 ink
pixels in the box on a Sign click, surviving a zoom step. The shipped stroke is **black**
(`signatureContent`'s default), not the fixture's navy.

---

## 14. Failure behaviour — measured, not assumed

`src/lib/damaged.test.ts`, `src/lib/encrypted.test.ts`, `src/lib/encrypted.reprompt.test.ts`,
`src/components/ViewerLayout.failure.test.tsx`, `src/components/PasswordPrompt.test.tsx`.

| Situation | What really happens |
| --- | --- |
| File truncated mid-object | Rejects `InvalidPDFException: Invalid PDF structure.` The shell shows a `role="alert"` error naming that message, plus **Try again**, which re-requests |
| `startxref` points past the end, header intact, same length | **Loads all three pages.** pdf.js warns it is re-indexing every object. Not an error — so no fixture should ever be described as "a damaged file fails" without saying which kind |
| Encrypted, no password | Does **not** reject. The load **parks** on a `NEED_PASSWORD` callback; abandoning it by passing an `Error` (what the prompt's Cancel does) rejects with `PasswordException` code 1, `No password given` |
| Encrypted, right password (`secret`) | Opens. One page |
| Encrypted, wrong password | **Re-prompts, in about 1 ms.** `src/lib/encrypted.reprompt.test.ts` asserts two asks (`NEED_PASSWORD`, then `INCORRECT_PASSWORD`), that the second one stays parked, and that answering it correctly opens the document. Read earlier as *silence for 60 s*, which was the harness: the engine re-asks inside the same microtask chain, so a watchdog that has to fire between two asks never gets the chance, and a callback that answers its own question loops at ~27,000 asks a second. Answer it from a decision a person made and none of that happens; retry a stored credential automatically and it does |
| Several encrypted loads in one Node process | The second and third hang: an abandoned load wedges the fake worker. Hence one load per test |
| Worker URL unreachable | `workerSrc` left **unset**. Nothing renders on the main thread unless the worker code is reachable without a URL — pdf.js's own Node default, or a host-assigned `globalThis.pdfjsWorker` — so an ordinary page fails, naming `workerSrc` rather than a fetch of a path we invented |
| Canvas bigger than the cap | Paints nothing rather than throwing |
| A document that will not load | Never renders a spacer or a page of nothing; the error region replaces the viewport |
| Password prompt | Empty password can't be submitted (button disabled *and* the submit handler checks, because a form submits by keyboard without the button); the value is passed **untouched**, since trimming is how a correct password becomes wrong; `Escape` cancels; the field is focused on mount; the rejected state announces itself with `role="alert"` |

---

## 15. Languages

`src/lib/labels.ts` is the source of truth: **one typed catalog of 144 strings**, every one of them
English, every string in the shell coming from it (toolbar labels, `aria-label`s, the "3 of 416 · p12"
counter, error messages). `{page}`-style slots are filled by `formatLabel`.

* A host passes a **partial** object; unnamed keys keep their English default.
* Three complete languages ship: `locales/de`, `/es`, `/fr` — typed as the **complete** catalog, so a new
  key in English makes all three fail to build until it's answered; each frozen; each a separate entry.
* `src/locales/locales.test.ts` asserts what a type can't: the key list matches exactly (the count is
  asserted, and it moved 123 → 131 → 134 → **144** as tiers landed), no value is empty or padded, every
  `{slot}` survives with its name intact, and the catalog *translates* rather than echoing English back
  (four exceptions, each named in the test).
* `labels` overrides are **read when the control renders**, not when the viewer mounts: a partial
  override memoises to a new object each render, and depending on it would loop forever.

---

## 16. Styling

Eight stylesheets, plain CSS, no framework, all custom properties under `--pjsr-*`
(`src/styles/viewer.css` holds the tokens: colour, radii, spacing, control heights, focus ring,
`prefers-reduced-motion`, `prefers-contrast`, and a dark preset). Every class is prefixed `pjsr-`.

| File | Lines | Ships as |
| --- | --- | --- |
| `viewer.css` | 1,265 | `pdfjs-react-reader/styles.css` |
| `annotate.css` | 313 | `…/annotate.css` |
| `edit.css` | 179 | `…/edit.css` |
| `print.css` | 113 | `…/print.css` |
| `forms.css` | 109 | `…/forms.css` |
| `outline.css` | 90 | `…/outline.css` |
| `attachments.css` | 74 | `…/attachments.css` |
| `layers.css` | 72 | `…/layers.css` |

`src/lib/assets.ts` prints the minified sizes at build time (e.g. `styles.css` 34,295 B → 17,490 B,
`annotate.css` 11,622 → 3,891). A feature's CSS is its own entry, so mounting a feature and not
importing its sheet is a visible, fixable mistake rather than a subtle one. Engine CSS is **not** vendored
— pdf.js ships text-layer and annotation-layer sheets under Apache-2.0 and our sheets restate the rules we
depend on; the licensing question is a `1.0` decision (§20).

Accessibility built into the CSS, not bolted on: 4 px focus ring offset, `forced-colors` support,
reduced motion, and spacing normalised to a 4/8 grid.

---

## 17. Tests: 59 files, 661 tests, two projects

`vitest.config.ts` defines projects: **`node`** runs `src/**/*.test.ts` (pure logic, real fixtures read
from disk), **`dom`** runs `src/**/*.test.tsx` (jsdom + Testing Library). Parenthesised counts are the
files this section has ever itemised; the rest are named, not counted, so a stale figure cannot appear here.

* Logic: `assets` `attachments` `canvas` `download` `editing-state` `features` `form` `fullscreen`
  `ink` `keyboard` `labels` `layout` `link-service` `optional-content` `outline` `page-plan`
  `pdf-write` (30) `print` `search` (35) `signature` `source` (17) `toolbar` `worker` `zoom` `locales`
  (16) — plus `abort` (14) `retry` (29) `search.abort` (4) and **`source.classify` (39)**, the rule that
  `classifySource` and `normalizeSource` are the same heuristic, **`ssr` (17)**, which imports every
  entry point in the export map with no DOM (FR-46), **`dpr` (13)** — the ratio hub, driven by a stubbed
  `matchMedia` whose recorded queries are what the assertions read (FR-07), **`page-labels` (12)**,
  both directions of the label table and the clamp-or-refuse line (FR-12), and **`worker.fallback` (1)**,
  **`.onpage` (1)**, **`.nocode` (1)**, **`.deadurl` (1)** — four files because each asserts one state of
  pdf.js's worker configuration and the engine memoises its fake-worker lookup per module instance, so a
  second state in the same process would be measured against the first one's answer (FR-02)
* The load, through React: `headless/usePdfDownload` (7), and five files over the one hook —
  **`usePdfDocument.network` (4)**, **`.retry` (8)**, **`.abort` (5)**, **`.status` (14)**,
  **`.worker` (2)** — because a ref-read option, a retry verdict, a host signal, a state machine and a
  failure message are each a way the load can be wrong,
  plus **`usePdfPageLabels` (8)**: one read per document, `null` as the ordinary answer, and a stopped caller
  getting no round trip at all (FR-12, FR-36)
* Components: `Toolbar` `ViewerContext` `ViewerController` **`PasswordPrompt` (8)**
  **`ViewerLayout.failure` (4)** `FeatureHost`, and **`PdfPage.status` (13)** — the first file that ever
  rendered `PdfPage`, the only one that drives its layers by hand, and the one that proves a display change
  reaches the canvas buffer while a `resize` at the same density does not, plus **`ViewerLabels` (6)** — the
  bar mounted against a stub controller, which is the only place the `controller → ViewerParts → Toolbar`
  link of the label table is asserted
* Engine behaviour, through pdf.js itself: **`damaged`** (6), **`encrypted`** (3),
  **`encrypted.reprompt`** (1) — one load per file, because a load left parked in the Node fake worker
  stops every case after it
* Tiers: `features/download` `edit` (11) `edit.extract` (5) `edit.signatures` (8)

Recipes that took real time to learn, and are worth reusing: a click handler that `void`s an async write
means you **cannot await it** — settle on `waitFor`, not a fixed timer, and clear mocks only after
in-flight work lands, or the next test inherits a call it never made. jsdom has no canvas 2D context
(guarded) and a zero-sized `getBoundingClientRect` (stub it). And a feature panel's state is published in
an **effect**, so its first render sees `{}` — read every feature state through a default.

---

## 18. Toolchain

| Command | What it does |
| --- | --- |
| `npm run dev` | Playground on **:5199** (a fixture is loaded by submitting the URL form; feature toggles are checkboxes) |
| `npm run docs` | Docs site on **:5200**, rendered from `../src` |
| `npm run build` | `tsup` → ESM + `.d.ts`, then `scripts/copy-assets.mjs` minifies the CSS and prints the deltas |
| `npm run build:docs` | Pure `vite build docs` — **never chain a server into a build step** (an earlier version hung a CI job for six hours) |
| `npm run test` / `typecheck` / `size` / `size:update` | vitest / `tsc --noEmit` / the gate / re-accept the gate |
| `npm run verify` | typecheck → test → build → size. Also `prepublishOnly` |

**CI** (`.github/workflows/ci.yml`, read-only token, `concurrency` cancelling superseded runs):
`verify` on Node 20 **and** 22 · `docs` (skipped on `main`, where `docs.yml` publishes instead) ·
`react` installing majors **18 and 19** and running typecheck/test/build · `consumer`, which packs the
tarball, installs it into a throwaway Vite app against `pdfjs-dist ^6.2.108`, type-checks the shipped
`.d.ts`, builds, and asserts the worker was bundled *and* that the relative specifier survived.
`docs.yml` publishes the site to GitHub Pages from `main`.

**What has actually run.** Three of those four jobs have: GitHub Actions reports 22 runs, the last green on
both `main` and `dev` at `5059bc7` on 2026-09-24, covering `verify` (Node 20 and 22), `docs` and `consumer`.
Two limits on that evidence, and they are the ones that matter. First, **every job runs Node on
`ubuntu-latest`; none of them starts a browser**, so no CI run has ever exercised a rendering path, a
Safari, or a touch device — the compatibility matrix in the README is a support claim, not a tested one.
Second, `react` was added locally on 2026-09-29 and **has not run**, and none of the four jobs has seen any
of the local `0.2`–`0.9` commits (`git rev-list --count origin/dev..dev`). So the React-18 evidence is local: re-run on 2026-09-29 with `react`,
`react-dom` and both `@types/*` at 18.3.1, then `npm run verify` end to end — typecheck, the 449 tests in
38 files that made up the suite on that date, both bundles, the size gate — and 19.3.0 was put back
afterwards, with `--no-save` both ways, which
is why `package.json` and `package-lock.json` show no diff.

Note what the consumer job exists for: every other job resolves the package from `src` through tsconfig
paths, so a packaging defect can only surface against the installed tarball. That is how `0.1.0` shipped
a worker URL no bundler could rewrite.

**Repo shape.** `dev` is the integration branch, `main` only takes deliberate merges, and `main` is the
default branch. Nothing in the `0.2`–`0.9` range is pushed; the sequence publishes together with `1.0.0`.
Since 2026-09-29 the sequence does not stop at `0.8`: `PRD.md` became a target specification of **51**
requirements and the owner decided `1.0.0` ships all of them, so `0.9` Reach, `0.10` Access, `0.11` Index
& Assemble and `0.12` Prove are planned in `ROADMAP.md` §Releases and none is started. Consequences
accepted: CI has not run on any of the local commits, and the published docs site still shows `0.1.x`
content. `0.1.2` is committed and deliberately never published.

---

## 19. The engine floor, and why it's where it is

Peer range is **`^6.2.108`, v5 dropped**. Two independent reasons, both measured:

1. **Security.** CVE-2026-16633 (arbitrary code during a malicious PDF's *initialisation*, before any
   page is parsed) affects `>= 5.6.83, < 6.2.108`. **No 5.x release fixes it.** Advertising 5.x would
   mean pointing users at a line with no patch available.
2. **Architecture.** `AnnotationEditorUIManager`'s constructor takes **positional** arguments —
   14 in 5.0.375, 16 from 5.7.284 — so one call cannot serve both, and 5.0.375 would receive
   `viewerAlert` in the `altTextManager` slot: an editor layer configured wrong, **silently**. Determined
   by parsing `build/pdf.mjs` in each version, because the `.d.ts` files didn't settle it and Node can't
   import that module at all.

That floor is where the security and architecture evidence points; `ROADMAP.md` §Policy conflicts holds both measurements.

The 5.x *data shapes* in `src/lib/attachments.ts` are still tolerated, by decision rather than
oversight — deleting them would turn a graceful "nothing to fetch" into a throw inside pdf.js's click
handler — but **no other 5.x surface is supported or tested**, and `PRD.md`'s FR-25 wording now says so.

---

## 20. What is *not* done, according to the code

| Item | State |
| --- | --- |
| **Real-device matrix** (`#141`) | **Never run.** iOS Safari 14/15 and Android Chrome are stated targets; every frame number in every document is Chromium on one Windows machine at ~145 Hz. The `:has()` container-query fallback is written but has never executed on a Safari. Either it gets run or the device claims come out |
| **Accessibility audit** (`#143`) | Open. Its concrete code item is `structTreeLayer: null` (§11) — the tagged-PDF structure the PRD asks for is declined in code, so that's an enable-or-document decision, and assistive-technology testing can't happen here |
| **Core freehand ink retirement** (`#124`) | Your call, still unanswered: the shell's own ink duplicates `annotate`'s, which is the one that saves |
| **Freezing the mutable exports** | Held for `1.0`'s breaking window (§9). Docs tell a host to spread instead, which is correct before and after |
| **A worker holding the writer** | The real fix for the ~1,080 ms main-thread block when applying/extracting/splitting/flattening a 1,000-page document. Not attempted: today the mitigation is that nothing takes that path unless asked |
| **Vendoring engine CSS** | Apache-2.0 licensing question, needs a real answer before anything is copied in |
| **Repo settings** | The `main` ruleset, and whether `1.0.0` publishes with `--provenance`. Settings, not YAML |
| **An XFA packet whose fields bind through `dataId`** | Still needed — `XfaLayer.setAttributes` has `case "dataId": break;`, so the key is consumed for the binding and never written to the DOM, which is why that question can't be answered from a page today |
| **Named slots / `PdfViewer.Root`** | Not built, and `0.5` **declined** them: what shipped is `controls.order`/`hide`/`priorities` plus exported parts you compose by hand. `PRD.md` §5.2 shows the slots form and labels it "not the shipped API" |
| **The shell's page path under jsdom** | No test has mounted the real controller against a document that had finished loading — that combination hangs the harness, twice measured to a 60 s and a 120 s kill. So the shell end to end is verified in a browser and around its parts in unit tests, never under jsdom; the harness fix belongs with the CI work, not with a feature |
| **Nothing published since `0.1.1`** | `0.2`–`0.9` are committed on local `dev` and the whole sequence publishes together as `1.0.0`. CI has never seen any of it, which §19 says plainly and every "verified" claim in these files is dated by |

---

## 21. Where the documents and the code disagree

Recorded because "the code is the truth" is only useful if you know where the documents lag. All of these
were **fixed toward the code** on 2026-09-28; the entries remain as the correction log.

| Claim | Reality | Resolution |
| --- | --- | --- |
| "no single feature above 4 kB over core" (PRD §6, a fixed requirement) | Signing measured 4.73 kB with **no interface at all** | Requirement restated: 6 kB is the assertion, *Behaviour Under Load* is the fixed NFR |
| PRD §3.2 diagram "Dedicated Web Worker Pool" | One worker per document load; one process-global `workerSrc`, first setter wins | Diagram and prose corrected |
| PRD §5.2 "target shape … `0.5` schedules it" | `0.5` shipped and **declined** slots | Corrected; §2/§5 wording no longer sells a compound namespace |
| PRD FR-25 requires attachments on pdf.js 5.x | Floor is `^6.2.108`; no 5.x release fixes CVE-2026-16633 | Restated: 6.x supported, 5.x shape tolerated |
| `attachments.ts` "the peer range allows both" | It hasn't since `0.6` | Comment corrected |
| PRD §5.3 "measured at 20.61 kB" for core | 24.96 kB today | Restated with the `0.4` figure kept as history |
| README "React 18.3.1 tested" | No job installed 18; the last check was manual, at `0.1` | Re-verified locally **and** a `react` CI matrix added |
| README "19.3.0, **in CI**" | The `verify` job that ran on 2026-09-24 installed whatever `package-lock.json` pinned, and no job had ever installed 18; nothing since has run at all | Row rewritten to name the machine the measurement came from; the `react` matrix job is future protection, not present evidence |
| README Status "signing work uncommitted" | Committed as `0fc7273` | Corrected |
| Docs pages quoting 128.6 / 366.5 / 245.5 kB for engine and peer, on the version that names itself | 131.70 / 375.25 / 251.41 kB measured | Restated, **with the method named** — the trap is documented in `ROADMAP.md` |
| `ROADMAP.md` "39 tests across four files" for signing | 35 across three | Corrected |
| Catalog "142 strings" in three places | 144 | Corrected, including a stale number in the test's own comment |
| A signature box "shows nothing in our viewer" because of `/F 16` | Probe sampled a page-1 rectangle for a page-2 annotation; re-measured, it **does** paint | Retracted, and the retraction is the record |
| "In-session signature doesn't repaint" (filed as a defect) | The filter counted the fixture's navy while the writer draws black; colour-agnostic re-measurement: 0 → 856 px | Ticket withdrawn, lesson kept |

A second pass, **2026-09-29**, read `PRD.md` line by line against the source. What it turned up, most of it
in the 2024 prose that later releases had simply not revisited:

| Claim | Reality | Resolution |
| --- | --- | --- |
| PRD §3 diagram offers `usePdf`, `usePdfSearch`, `usePage` | There is no `usePdf` and no `usePage`; the headless surface is ten named hooks | Diagram points at §5.1, and the ten are listed in prose under it |
| PRD §3 diagram "Pre-built UI Shell (Toolbar, Sidebar, **Modal**)" | Nothing in `src/` is a modal — grep for `Modal` returns zero files | Corrected, with where each dialog-shaped thing actually renders |
| PRD §3.1 "three coordinated layers" | `PdfPage` stacks six: canvas, text, annotation, editor, XFA, ink — two of them conditional | Rewritten as the real append order, including why the draw layer's parent is the canvas wrapper |
| FR-11 thumbnails at "scale 0.15–0.25" | `(cardWidth / base.width) * dpr`, from a measured `minmax(96px, 1fr)` grid, 132 px before measurement | Restated as the formula the component uses |
| FR-16 renders "signatures", FR-18 draws "signatures via SVG overlays" | Signing is a `<canvas>` pad whose mark is written into `/AP`; the SVG overlay is the in-memory ink layer, and `/V` is refused | Both rows rewritten to separate the three mechanisms |
| FR-19 "full-resolution … across the entire document" | Scale is whatever fits 256 MiB from `2 / 1.5 / 1`, the range is selectable, iOS is excluded, and there is no second window | Restated |
| FR-20 "download modified forms with state flattened" | `saveEdits` is pdf.js's incremental save — the code comment says "this is 'save', not a true flatten"; the flatten is FR-31 | Restated, and the flatten got its own requirement |
| FR-23's acceptance note lists four hook-name markers | `check-size.mjs` configures **eight**, and two are not hook names (`createEditorEventBus`, `@cantoo/pdf-lib`) | Note rewritten to the configured list, including why a marker missing from its own bundle must fail |
| PRD §4 ends at FR-28 | `0.6`–`0.8` shipped an editor, a page writer, a flatten, signing and XFA display with no requirement each | New §4.9, FR-29–FR-33 |
| A test comment citing "`PRD.md`'s error-handling line" | No such line existed — the behaviour (a `role="alert"` status plus a working retry) was shipped, tested and unrequired | §6 gained an **Error Handling** bullet, including the one exception that stays silent |
| Docs API table: `edit` "9 names" | `scripts/inventory.mjs` reads **32** out of `dist/edit.d.ts` — the row was written before signing, which added 11 of them | Restated, with the command that produces the number printed next to it |
| PRD §7 "the requirements it adds are FR-21–FR-23" | It adds through FR-33 | Corrected, and the three Phase 3/4 lines the finished product changed shape are annotated where they stand |

**And one in this file itself, which is the finding worth keeping.** §12 of an earlier draft of this
document described search as indexing "lazily in viewport order from the current page, stopping at the
first match", navigated with `F3`, and printing through "an about:blank window". None of it was in any
document I was summarising and none of it is in the code: `extractAllText` walks every page in page
order, `SearchBox` binds `Enter` / `Shift+Enter` / `Escape` and no `F3`, and print builds a
`div.pjsr-print` inside the current document. A reference whose whole premise is "derived from the code"
manufactured three details that sounded like the architecture. They are corrected above, and the lesson
is the rule at the end of §22.

A third pass, the same day, reviewed an independently written `PRD_v2.md` and merged it into `PRD.md`.
Its structures were better than ours — scope tiers, a module and entry-point map, state models, an engine
policy, benchmark profiles, maturity tags — and its facts were worse. Every one of these was checked
before the section it belonged to was accepted:

| Draft claim | Reality | Where it landed |
| --- | --- | --- |
| Entry point `pdfjs-react-reader/features/search` | Not in the export map; search stayed core at `0.4` | §3.2's table says so explicitly, since a missing path is the kind of gap a reader assumes is a typo |
| `base64ToPdfSource()` as an external utility, base64 not a primary input | Base64 **is** a primary source string — the classifier takes a ≥128-char pure-base64 string as bytes — and at that date the decoder was internal | FR-01; **partly overtaken 2026-09-30**: `FR-38` exported both halves as `classifySource` and `base64ToBytes`, and the correction stands — a base64 string is still accepted as `src` directly, so the helper is for the step before that, not a required wrapper |
| "Every async operation requires an `AbortSignal`" | Invalidation is effect-scoped `cancelled` flags, `task.cancel()`, and `RenderingCancelledException` swallowed by name. `AbortController` appears twice, both a real fetch | §3.3, with the invariants stated instead of the mechanism invented |
| Two named state unions (document and page) | Neither enum existed; the surface was `doc`/`isReady`/`error`/`capabilities` and `page: PDFPageProxy \| null` | §3.4 specified the observable fields plus the invariants, and said why the enums were declined — **overtaken 2026-09-30**: the target spec asks for them anyway, and `FR-37` published both, derived from one tagged value so the fields and the status still cannot disagree |
| "Both ESM and CJS outputs" | `"type": "module"`, no `.cjs` in `dist`, never has been | §6 React & Runtime |
| "Validated for SSR (Next.js)" | Client-side only; `readCanvasEnvironment` exists because it is | §6 React & Runtime. **Half of it is now the other way, on purpose:** `FR-46`'s test imports all thirteen entry points with no DOM and none throws, so *importing* is server-safe while *rendering* stays client-only — which is what the README and the Installation page said before they were checked, in the stronger and wrong form ("pdf.js needs DOM globals at import time, so this package is client-side only") |
| Page manipulation includes **merge** | No `merge` in `src/edit.tsx` or `dist/edit.d.ts` | §2.4, named as not shipped so nobody files against a promise |
| pdf.js internals "never exposed as the public extension contract" | `dist/index.d.ts` ships `annotationEditorUIManager?: AnnotationEditorUIManager \| null` | Kept as a deliberate trade, and §5.4 names it as why the engine policy pins a major |
| "Incremental page text extraction", lazy indexing | `extractAllText` walks every page, yielding every five — the same invention §12 was corrected for hours earlier | §6 Search Architecture |
| Cold page render "< 55 ms" as a target | 55 ms is the **top of our own measured range** on one machine | Declined; the bar stays sub-100 ms with the range recorded beside it |
| Compatibility matrix, all six browsers "Tested (CI): Yes" | No CI job starts a browser | §6's matrix: one row tested, six not, plus what CI does prove |
| §5's example, once its import specifier was fixed | Still did not compile: `PdfPage`'s `doc` prop is `PDFDocumentProxy`, not `… \| null` | Verified by running `npm run typecheck` on the example inside `docs/src`; §5.1 now carries the guarded form that compiled |

**And the correction that pass found in this file.** §16 said of the workflows: "None of it has run."
Actions reports 22 runs, last green on `main` and `dev` at `5059bc7` on 2026-09-24, over `verify`, `docs`
and `consumer`. The true statement is narrower and more useful: those three ran, the `react` job added on
2026-09-29 has not, none of the four has seen the local `0.2`–`0.9` commits, and **every job is Node on
`ubuntu-latest` with no browser** — which is the whole reason a "Tested (CI)" column cannot be filled in
by pointing at a green run.

**A third pass, 2026-09-30, taken while closing `0.9`'s reopened rows.** Two claims in this file turned out
to describe a code that never existed. §5's *How it draws* said `devicePixelRatio` "defaults to
`Math.min(2, window.devicePixelRatio)`" — there is no 2× clamp anywhere in `src/`, and `git log -S 'Math.min(2'
-- src` finds no commit that had one; the clamp that does exist is §9's area and side ceilings, which cap the
resulting *canvas*, not the ratio. Corrected to what the default is now: the watched live ratio, clamped by
those ceilings, and pinned by a host's prop when it passes one. The second was §14's wrong-password row
("neither a resolution nor a second callback in 60 s"), which the engine contradicts about a millisecond
after the wrong answer — the silence was a watchdog that cannot fire inside the engine's microtask chain.
§14 and §17 now say what was measured; `ROADMAP.md`'s `FR-03` row carries the re-measurement, and its
`FR-07` row the density one.

---

## 22. Checking this document

Nothing here should be taken on trust. Each of these re-derives a number above:

```bash
node -e "const p=require('./package.json');console.log(Object.keys(p.exports).length, p.version)"
grep -rc "" src/**/*.ts src/**/*.tsx            # file inventory (§2)
npm run test                                    # 661 tests in 59 files (§2, §17)
node -e "const u=require('caniuse-lite/dist/unpacker/feature'),f=require('caniuse-lite/dist/unpacker/features').features;const s=u(f['css-media-resolution']).stats;console.log(s.safari['14'],s.safari['16.0'],s.chrome['90'],s.firefox['90'])"   # the §11 `resolution` support flags (caniuse-lite is transitive, via the toolchain, not a declared dependency)
npm run size                                    # every size figure in §2, plus the two failing rules
node -e "console.log(Object.keys(require('./dist/index.js')).length)"   # names on the main entry
node --input-type=module -e "const m = await import('pdfjs-dist/legacy/build/pdf.mjs'); console.log(m.GlobalWorkerOptions.workerSrc)"   # §10: pdf.js's own Node default, which an unset `workerSrc` leaves in place
npx vitest run --project node src/lib/worker.fallback.test.ts src/lib/worker.fallback.onpage.test.ts src/lib/worker.fallback.nocode.test.ts src/lib/worker.fallback.deadurl.test.ts   # §10's four worker states, one process each
npm run build && node scripts/inventory.mjs   # the grouped name lists in §4, straight from dist/*.d.ts
grep -n "MAX_RENDER\|PRINT_MEMORY\|CAP_AREA" src/lib/canvas.ts src/lib/print.ts   # §9
grep -n "structTreeLayer\|annotationCanvasMap" src/components/PdfPage.tsx          # §11
node scripts/make-signature-pdf.mjs && node scripts/make-damaged-pdf.mjs && node scripts/make-labelled-pdf.mjs   # fixtures are generated, never downloaded
node -e "const fs=require('fs');import('pdfjs-dist/legacy/build/pdf.mjs').then(async m=>{const d=await m.getDocument({data:new Uint8Array(fs.readFileSync('playground/fixtures/labelled-sample.pdf'))}).promise;console.log(d.numPages, await d.getPageLabels())})"   # §8's label table is the engine's answer, not this file's guess
npm run serve:auth &  curl -s -o /dev/null -w '%{http_code}\n' http://localhost:5300/outline-sample.pdf; curl -s -o /dev/null -w '%{http_code}\n' -H 'Authorization: Bearer dev-token' http://localhost:5300/outline-sample.pdf   # 401 then 200 — the document `FR-34`'s browser pass loaded through the playground, which is the only way to see the header arrive
# The "every switch off (27.86 kB) vs on (27.81 kB)" pair on the Features page is not a `npm run size`
# path: bundle two consumer files that import `PdfViewer` from `dist/index.js` — one passing every
# `enable*` as false plus a `controls.hide` over the whole bar, one at defaults — through esbuild and
# Rollup exactly as `scripts/check-size.mjs` does, gzip the minified output at level 9, take the larger,
# and divide by 1000 (the gate's `KB` is decimal). The plain `src` fixture measures 27.76 kB by the same
# route, which is the anchor that says the method was reproduced rather than approximated.
git log --oneline -1 && git status --porcelain | wc -l   # what is and isn't committed
```

**If a line in this file and a line in the source disagree, the source is right and this file has a
bug.** Fix the file, and say which one you checked.
