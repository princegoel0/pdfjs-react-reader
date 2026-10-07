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
Rows touched since carry their own date: the core freehand ink withdrawal (FR-18, 2026-10-04) rewrote the
name lists, the toolbar control list, the constant table and the forced-colour inventory against the source
as it stands, and the layer lists it changed are the ones `src/lib/core-ink.withdrawal.test.ts` now reads.

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
| Version in `package.json` | `0.11.0` — **not published**. The registry has three versions, `0.1.0`, `0.1.1` and **`0.1.2`** (2026-09-25), and everything from `0.2` to `0.11` goes out together as `1.0.0` | `package.json:2`, and read from the registry on 2026-10-04 with `npm view pdfjs-react-reader versions time` |
| Module system | **Both formats** (FR-41): `format: ['esm', 'cjs']` under `"type": "module"`, so every published path is `x.js` + `x.cjs` with `x.d.ts` + `x.d.cts`, and the export map answers `import` and `require` separately | `tsup.config.ts`, `package.json` `exports` |
| Runtime dependencies | **none** | `package.json` `dependencies` |
| Peer dependencies | `pdfjs-dist ^6.2.108`, `react ^18 \|\| ^19`, `react-dom ^18 \|\| ^19`, `@cantoo/pdf-lib ^2.11.1` (optional) | `package.json` `peerDependencies` |
| `engines` field | `node >= 22.13.0`, and it is no longer the only engine statement the package makes: `npm run check:packaging` parses §8's two Node rows out of `PRD.md`, requires them to agree with each other and with this field, and refuses a CI pin below them | `package.json` `engines`, `scripts/check-packaging.mjs` |
| Files published | `["dist"]` only — no `src/`, no playground, no docs | `package.json` `files` |
| Importable subpaths | **25** (12 JS entries + 3 languages + 9 stylesheets + `package.json`) | `package.json` `exports` |
| Names on the main entry | **240** | `node scripts/inventory.mjs`, over `dist/index.d.ts` — re-run against today's `dist` on 2026-10-06 (239 / 197 / 32 / 9 held from 2026-10-04 until #249 put the feature contract's `T PdfEngineRequirement` on the barrel) |
| Names on `/headless` | **197** | the same, over `dist/headless.d.ts` |
| Names on `/edit` | **36**, on `/merge` **13** | `dist/edit.d.ts`, `dist/merge.d.ts` |
| Distinct public names, by maturity | **323** — 263 stable, 60 experimental, 0 deprecated, plus **15** in the `removed` ledger (FR-18). The split is measured, not asserted: `npm run check:maturity` prints it, and whether 60 experimental names is the right number to carry into `1.0.0` is the owner's open decision **#207** | `api-maturity.json`, audited by `npm run check:maturity` |
| Source files (non-test) | **88**, 18,672 lines | `src/**`, counted by `node scripts/check-docs.mjs` (`wc -l` semantics, test files excluded). 80 / 17,169 was the figure when §2 was last re-run by hand; the touch-fallback module, its engine stand-ins, this script, the handle member and walk guard of #231, the form hook’s refusal to claim a change it did not make, #238’s three cancellation guards (an already-aborted token performs no work on the print, attachment and thumbnail paths), #243’s measuring context, #241’s panel bound, #229’s signature box rule, #175’s ready-document shell mount, #247’s shared ready-shell harness (the jsdom answers, the page proxy, and the fold fake that lets the ⋯ panel mount) and #249’s engine-version helper — the comparison a feature uses to declare that one of its own behaviours needs an engine newer than the package floor, and #242’s measurement of which exception names the installed engine actually stamps have moved it since; the seven lines since the last sync are #257’s editor container, which decides what the annotation manager is allowed to hear |
| Test files / tests | **149 files / 1,299 tests**, in five projects (`node`, `dom`, `writers`, `node-serial`, `a11y`) | `npm run test` |
| Stylesheets | 9, from 24 to 1,348 lines | `src/styles/`, same command (`structure.css` is the small one, `viewer.css` the large) |
| Fixtures | 22 PDFs, produced by 18 generator scripts, **all of them tracked** — the `0.10` close found `tagged-sample.pdf` missing from the index while its own test read it from disk, which is the fourth time that trap fired, and is why §22 runs `git ls-files` over every file the docs cite. `tagged-sample.pdf` is the only fixture that declares a structure tree; `scan-sample.pdf` is the only one with no text at all — twelve pages of 2550×3300 RGB scan, 0.82 MB on disk and 8.4 MP per page once decoded; `vector-sample.pdf` is the only one whose cost is operators — four A1 sheets, 336 clipped cells each, 12,922 engine-reported operators a page and 0.51 MB on disk; `oversize-sample.pdf` is the only one with a page no renderer may paint — 612×792, 12,000×9,000 and 200,000×600 pt, which is the edge-case suite's sixth shape and the 0.25-minimum refusal in 1,023 bytes | `playground/fixtures/`, `scripts/make-*.mjs` |
| Benchmark | `npm run bench` measures §6's four profiles and separates **bars** (structural, they fail the run) from **measures** (timings, printed with the machine and never failed on). All four have committed fixtures: C is `vector-sample.pdf`, whose split between this package and the engine is read from the `pjsr:` paint marks the viewer puts in its own render path (the engine-only harness through `playground/raw.html` runs beside it as a cross-check, and the two disagree by design — see §17's `PdfPage.timing` row), and D is `scan-sample.pdf` on the committed low-memory harness — 412×915 at dpr 3 with an Android user agent and 6× CDP CPU throttling, zoomed through the toolbar's overflow menu. The report is **`benchmarks/latest.json`, tracked**: §6's environment fields, each fixture's sha256, and p50/p95/max per sampled number with p99 only where there are 100+ samples. `src/lib/benchmark-record.test.ts` is what keeps that file an evidence rather than an artifact of the last run | `scripts/benchmark.mjs`, `benchmarks/latest.json`, `ROADMAP.md` §1 `FR-49` |
| CI | 6 jobs in `ci.yml` (`verify`, `docs`, `react`, `consumer`, `packaging` for FR-41 on a Node matrix, and `browser` for FR-48 across three engines; the axe audit is a step inside `verify`), 1 deploy workflow in `docs.yml` | `.github/workflows/` |
| Browser evidence | **Three engines, six cells, 2026-10-04: 67 ok, 5 skipped, 0 failed, 0 not runnable.** Chromium 153 desktop 12 ok / mobile 11 ok + 1 skip; Firefox 155 and WebKit 26 desktop 12 ok / mobile 10 ok + 2 skips. Every skip is the emulation's — no wheel events on the 375 px profile, and no `Touch` constructor to synthesise a pinch from on Firefox and WebKit. Each cell also prints its engine against §8's floor (153 vs 125, 155 vs 124, 26 vs 18), and §8's own policy keeps those rows `unverified`: a current build passing does not certify an older floor. Two rows in this file used to claim Firefox and WebKit would not start on this host at all; both were measured out of it, the second by a run whose failures came from two matrix processes sharing one dev-server port | `scripts/browser-matrix.mjs`, `ROADMAP.md` §1 `FR-48` |

### Bundle size, gzipped, per what you import

Measured by `scripts/check-size.mjs`, which bundles every path with **both** esbuild and Rollup and
reports the worse of the two. Decimal kB. Reproduced by `npm run size`.

| What you import | Size | Over core |
| --- | --- | --- |
| `core` — `<PdfViewer>` alone: pages, text, search, thumbnails, layout, toolbar, sidebar, virtualisation, worker | **29.09 kB** | — |
| `+ printFeature` | 31.63 | +2.54 |
| `+ downloadFeature` | 29.88 | +0.79 |
| `+ formsFeature` | 31.10 | +2.00 |
| `+ outlineFeature` | 30.08 | +0.98 |
| `+ layersFeature` | 30.30 | +1.21 |
| `+ attachmentsFeature` | 30.19 | +1.10 |
| `+ annotateFeature` | 30.95 | +1.86 |
| `+ structureFeature` | 29.47 | **+0.38** |
| `+ editFeature` (pages, flatten, signing) | 34.98 | **+5.89** |
| **all nine** | **44.06** | +14.97 |
| `headless` entry alone (no shell, no shaking) | 4.06 | — |
| `merge` alone (writer and hook, no shell) | **0.78** | — |
| the CommonJS build of the two shipped paths | 54.79 / 28.44 | — |
| shipped `index.js` path (whole entry, no shaking) | 60.75 | — |
| shipped `headless.js` path | 32.53 | — |
| `dist/edit.js` on its own | 6.16 | — |
| `dist/merge.js` on its own | 1.60 | — |
| one language file (`de` / `es` / `fr`) | 2.40 / 2.39 / 2.42 | — |

**The baseline was re-accepted at the `0.11` close, so every number above equals `npm run size` today.**
Core moved **+1.08 kB** since `0.10` (28.01 → 29.09) and the root `index.js` path **+1.61** (59.14 → 60.75),
which is more than a release whose shell changes are two search labels and a partial-answer counter should
cost. The column that explains it is *Over core*: every feature's cost is within a few tens of bytes of what
`0.10` recorded (`print` 2.55 → 2.54, `forms` 2.06 → 2.00, `all nine` +15.04 → +14.97), which is only possible
if the base itself moved for a reason that has nothing to do with the features. It does: `src/merge.ts` is a
twelfth tsup entry, and a new entry reshuffles the shared chunks every consumer path is built from — the same
attribution `0.10` had to make for its eleventh. **So read *Over core* as what a consumer pays and the `core`
row as what this repository's chunking currently costs**, and note that the one path with nothing to share,
`merge` alone, is 0.78 kB. `headless` gained the incremental and index-building search (`usePdfSearch.ts`,
`buildTextIndex`, `validateTextIndex`) and the merge hook; `index.js` gained the same search plus two labels
in each catalog and the counter's partial wording. **What this table cannot see is still the point of the
design**: the ≈50 kB of `pdfjs-dist/web/pdf_viewer.mjs` that `structureFeature` fetches at runtime is a
peer's bytes, external to every path measured here, so the tier looks nearly free and is only free *to the
bundle*. §20 carries that as a documentation duty, not a measurement.

### 2.1 What the CommonJS half costs

tsup splits the ESM output into `chunk-*.js` shared between entries and writes the CJS output as one
self-contained file per entry. Both consequences were measured on the build that introduced them (**#189**,
2026-10-01): the shell entry was **50.83 kB** of CJS against **56.79 kB** of ESM graph — one gzip stream beats
fifteen small ones — while the shell *plus* headless together was **75.31 kB** of CJS against **60.19 kB** of
ESM, because nine chunk files are shared by the ESM pair and none is shared by the CJS one. Those four numbers
are that build's, quoted here as the history of the decision; the pair the gate re-measures on every build is
the per-entry one, and it is in `docs/src/size-figures.json` since #240: **60.50 kB** `shell (cjs)` against
**68.01 kB** `shell`, **32.10 kB** `headless (cjs)` against **37.35 kB** `headless`. A CJS host naming one path
pays less than the ESM graph for it, and naming two pays for each in full, because nothing is shared between
CJS entries — the reason the together figure has no ESM counterpart worth quoting today.

`check-size.mjs` ratchets both shipped CJS paths (`shell (cjs)`, `headless (cjs)`) for that reason: a
format nobody measures is a format that can grow.

For scale, measured the same way (gzip level 9, decimal kB): `pdf.min.mjs` **131.70 kB**, `pdf.worker.min.mjs`
**375.25 kB**, and `@cantoo/pdf-lib` **251.53 kB** for what our writer imports (256.05 kB for its whole
API) — the three figures on the versions this tree installs, `6.3.289` and `2.11.1`, and since #240 `npm run size`
writes them into `docs/src/size-figures.json` with those versions attached, which is what the docs pages render.
The engine is 507 kB before this package contributes anything, which is the context for every
number above. Divide by 1024 instead of 1000 and the same files read 128.61 / 366.46 / 245.63 — which is how one
re-measurement in this pass first "disproved" them and then found its own probe wrong.

### The two size rules, and what each one is allowed to do

1. **The ratchet reports; it blocks only at 200 %.** Any measured path growing more than **2 %** above the
   baseline committed in `size-baseline.json` (plus **256 bytes** of slack for minifier jitter) is printed as
   `GREW`, and the build carries on. It fails when a path reaches **twice** its accepted size — the owner's
   ruling on #208, that bytes must not gate feature work, paired with the one growth that is never a feature:
   a dependency arriving, a tier imported statically, or a second copy of something. Accepting growth means
   running `npm run size:update`, which is a reviewable line in the same diff. Because the *failing* half got
   smaller, the decision rule is now tested by the script itself: `pathVerdict()` / `tierVerdict()` are driven
   with twelve synthetic sizes plus two assertions about the thresholds' shape on every run, before any
   bundling (`--no-selftest` opts out, and nothing in `package.json` or CI does).
2. **The per-feature target.** A tier is expected to cost no more than **6 kB** over core; past that it is
   reported (`GREW`, with the multiple and the stop printed), and only **12 kB** fails. It was 4 kB until the
   signing work (2026-09-27), and the reason is in `PRD.md` §6: bytes are negotiable, behaviour under load is
   not — and neither, now, is a size number.

---

## 3. Every way in — the 25 import paths

`package.json` → `exports`. Every JS path ships four files: `.js` and `.cjs`, `.d.ts` and `.d.cts`
(FR-41). `scripts/check-packaging.mjs` fails the build if a published path is missing one of them, or
if `require()` and `import()` expose different names.

| You write | You get |
| --- | --- |
| `pdfjs-react-reader` | Everything: the shell, the toolbar, the hooks, the library layer (239 names) |
| `pdfjs-react-reader/headless` | Hooks + pure logic, no shell (197 names) |
| `pdfjs-react-reader/edit` | The page-editing / flatten / signing tier (36 names) |
| `pdfjs-react-reader/merge` | The multi-document tier (13 names): `mergeDocuments`, `describeMergeSources`, `usePdfMerge` and the plan types — **a separate entry because a viewer that only displays PDFs has no reason to carry a page-copying writer. `edit` and `merge` are the only two modules that import `@cantoo/pdf-lib`, and neither the root entry nor `/headless` re-exports either of them.** |
| `pdfjs-react-reader/features/print` | `printFeature`, `createPrintFeature`, `PrintScope`, 2 types |
| `pdfjs-react-reader/features/download` | `downloadFeature`, `createDownloadFeature`, 2 types |
| `pdfjs-react-reader/features/forms` | `formsFeature`, `createFormsFeature`, 2 types |
| `pdfjs-react-reader/features/outline` | `outlineFeature`, 1 type |
| `pdfjs-react-reader/features/layers` | `layersFeature`, 1 type |
| `pdfjs-react-reader/features/annotate` | `annotateFeature`, `createEditorEventBus`, 2 types |
| `pdfjs-react-reader/features/attachments` | `attachmentsFeature`, 1 type |
| `pdfjs-react-reader/features/structure` | `structureFeature`, 1 type, plus `STRUCTURE_LINK_OWNERSHIP_MINIMUM` and `structureLinkOwnershipAvailable` (#249) — no control, no panel, no factory: its surface is page props and the two names that say which engine half of the promise the installed engine keeps |
| `pdfjs-react-reader/locales/de` \| `/es` \| `/fr` | One complete language each; **separate entries so importing the viewer never hands you a language you didn't ask for** |
| `pdfjs-react-reader/styles.css` | The shell theme |
| `…/print.css` `forms.css` `outline.css` `layers.css` `annotate.css` `attachments.css` `structure.css` `edit.css` | A feature's CSS, only needed if you mount that feature. `structure.css` is the one of them that is not cosmetic: its rule is what keeps an accessibility layer out of the page's layout |
| `pdfjs-react-reader/package.json` | Read-only access (for tools that want the version) |

`"sideEffects": ["**/*.css"]` — stylesheets survive tree-shaking, JavaScript does not.

---

## 4. Every name you can import, grouped

The full name list from the built `.d.ts` files, grouped by what it is for, and **current through the
`0.12`'s first packages**: 239 names on this entry, 197 on `/headless`, 36 on `/edit`, 13 on `/merge`
(§2 has the same figures, and `node scripts/inventory.mjs` prints all of them from `dist`). The four added to
each writer tier are the error contract FR-54 re-exported there; the names `FR-40` and `FR-42` added are the
index pair
(`ExternalTextIndex`, `ExternalPageText`, `TextItemLike`, `buildTextIndex`, `validateTextIndex`,
`outwardPageOrder`) and the merge plan quartet (`MergeSource`, `MergePageRef`, `MergePlan`, `MergeResult`);
`T` below marks a type-only export, and each hook's option/result pair is
written once rather than twenty times. `node scripts/inventory.mjs` prints the flat list per entry, so a
disagreement between this section and the build is a fact about this section.

Across all twelve entries the surface is **323 distinct names** (510 name-slots; 181 names are reachable
from more than one entry, which is what the barrels are for) — measured 2026-10-04 by `node
scripts/inventory.mjs`, the tool §22 tells a reader to run before believing this section. Each of the 323
carries a maturity state in `api-maturity.json`, and the split belongs in that file and in the command's own
output rather than here: a tag or a count copied into prose is a tag or a count that can drift from the thing
that is checked, and this paragraph's own previous figures — 315 / 272 / 43, from before FR-18 took fifteen
names out — are the demonstration. The
exceptions, each with its reason, are on the docs site's *Stability* table and in the manifest; the rule
that keeps them in step is `npm run check:maturity`.

### Shell components (you can compose these yourself)
`PdfViewer` `ViewerProvider` `useViewer` `ViewerLayout` `ViewerRoot` `ViewerToolbar` `ViewerSidebar`
`ViewerPages` `Toolbar` `T ToolbarProps` `T ToolbarItem` `T ToolbarControls` `SearchBox`
`T SearchBoxProps` `Sidebar` `T SidebarProps` `T SidebarTab` `ThumbnailList`
`PdfThumbnail` `T PdfThumbnailProps` `OutlineView`
`PdfPage` `T PdfPageProps` `PasswordPrompt` `T PasswordPromptProps` `LabelsContext` `useLabels`
`T PdfViewerHandle` `T PdfViewerProps`

`ThumbnailList` and `OutlineView` take no props but one layout measurement each: FR-28's composed shape is
that a part reads the controller through `useViewer()`, and the bookmark tree comes from the outline tier's
publication in the same controller's store. `ViewerRoot` takes `className`/`style` beside `children`, which
are the host's own layout; `ViewerSidebar` takes `children` to replace the shell's tabbed panel.

### Controller
`useViewerController` `T ViewerController`

### Feature contract (write your own feature)
`T PdfFeature` `T PdfEngineRequirement` `T AnyPdfFeature` `T PdfFeatureControl` `T PdfFeaturePanel` `T PdfFeatureKeyBinding`
`T PdfViewerShell` `T FeaturePageProps` `T FeaturePublication` `T FeatureKeyEvent` `NO_FEATURES`
`findFeatureKey` `mergeFeaturePageProps` `orderFeatures` `samePublication` — plus the authoring hooks
`usePdfFeatureShell` `usePdfFeaturePublish` `usePdfFeatureState` `usePdfFeatureOptions`
`usePdfFeaturePeer` `T FeatureStore`

`orderFeatures` is §3.7's registration contract in one call: it refuses a duplicate id, a missing
dependency and a dependency cycle with `CONFIGURATION_ERROR` before anything mounts, and returns the
list with every dependency ahead of its dependents. `T PdfFeature` carries the three fields the contract
added with it — `dependsOn`, `stylesheets` and `cleanup` — and the shell validates the list itself, so a
host only calls it to build their own bar in the order the Runners were mounted. `engineRequirements`, the
fourth, arrived with #249 and is a different kind of field: it says nothing about other features, only that
one named behaviour of this one needs an engine newer than the package floor, and what a reader gets below it.

### Headless hooks
`usePdfDocument` `usePdfVirtualizer` `usePdfSearch` `usePdfOutline` `usePdfPrint` `usePdfDownload`
`usePdfFormValues` `usePdfOptionalContent` `usePdfAttachments` `usePdfPageLabels` — with their
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
`T VirtualSlotPage` `T VisibleRange` `T PdfViewportRef` `T ViewportPoint` `DEFAULT_PAGE_ESTIMATE` `ZOOM_LEVELS`

*Canvas caps:* `maxRenderPixelsFor` `isMobileCanvasEnvironment` `readCanvasEnvironment`
`resolveCanvasBudget` `ensureCanvasCeiling` `probedCanvasCeiling`
`MAX_RENDER_PIXELS` `MAX_RENDER_PIXELS_MOBILE` `MAX_RENDER_SIDE` `CAP_AREA_FACTOR` `MIN_RENDER_SCALE`
`BYTES_PER_PIXEL` `T CanvasBudget` `T CanvasCeilingSource` `T CanvasProbeOptions`

§6.1's four ceilings now combine in one published call: `resolveCanvasBudget` returns the minimum of
the package default, the viewport working set, the probed platform ceiling and the host's own number,
together with which of them won. Two of those four are host-settable — `maxRenderPixels` and
`capAreaFactor`, the second being §6.1's "200 %, host-configurable" working-set row — and both are
constraints: the factor is clamped to the package's own 200 before it multiplies (an above-200 request
would raise the ceiling by deleting the working-set term, and a `NaN` one would delete it silently),
and `CanvasBudget.capAreaFactor` reports the number that was used. The same clamp bounds the probe's
search, since the limit handed to `ensureCanvasCeiling` is `maxRenderPixelsFor(env, capAreaFactor)`.
The platform term is measured by `ensureCanvasCeiling`, which allocates
upward until a painted pixel stops coming back and caches the answer for the realm — one surface per
frame, from the second onward; the shell starts it two frames after mount and redraws the pages if the
answer is lower than the ceiling they were painted under. `npm run probe:canvas`
(`scripts/canvas-probe.mjs`) re-measures all of that in Chromium and fails if two surfaces share a frame,
if a surface is allocated before the page paints, or if a rung exceeds the ceiling in force; the numbers
it printed on 2026-10-03 were 3,072,000 px on a 1280×800 @1× page (its own working set, which is *below*
the desktop default, so the probe confirmed the ceiling rather than raising it), 5,242,880 under an iPad
user agent on a 390×844 @3× screen, and ~80 ms spread over six frames for the shell's whole search.
`renderPixels` is a *constraint* on the result, never a replacement for it.
Below `MIN_RENDER_SCALE` a page is refused with `RESOURCE_LIMIT` rather than painted unreadable. The
worker side of the same contract is not a published name: pdf.js holds one worker URL per realm, and a
second viewer configured with a different one fails its load with `CONFIGURATION_ERROR` naming both
origins — origins only, because a signed worker URL carries its credential in its query.

*Text & search:* `extractPageText` `extractAllText` `buildPageText` `findPageMatches` `convertMatches`
`convertMatchRanges` `countPerPage` `planFind` `findStartIndex` `escapeRegExp` `invalidatePageText`
`outwardPageOrder` **`buildTextIndex`** **`validateTextIndex`** `T PageTextIndex`
`T PageMatch` `T TextItemLike` `T SearchOptions` `T ResolvedSearchOptions` `T SearchStatus` `T FindPlan`
**`T ExternalTextIndex`** **`T ExternalPageText`** — the last four additions are `FR-40`: the published shape,
the builder a host uses to make one, the validator that decides whether to trust it, and `outwardPageOrder`,
which is `FR-39`'s reading order as a pure function so it can be tested without a document

*Forms:* `collectWidgets` `groupWidgets` `describeWidget` `readFormValues` `readInitialValues`
`writeFormValues` `clearFormValues` `formValuesDiffer` `AnnotationValueStore` `T FormField`
`T FormFieldOption` `T FormFieldType` `T FormValue` `T FormWidget`

*Page geometry:* `T PdfPoint` `T ViewportPoint` — the two types the ink helpers used to share with the
signature and page-edit paths. They outlived them: FR-18 withdrew the fifteen ink names (`usePdfInk`,
`InkLayer`, the stroke helpers, the pen option lists) and these two moved to `lib/layout` instead, so the
import a host already writes is unchanged.

*Editing state (what pdf.js has selected):* `readEditingState` `readEditingParams` `HIGHLIGHT_COLORS`
`DEFAULT_HIGHLIGHT_COLOR` `HIGHLIGHT_COLOR_PARAM` `HIGHLIGHT_PALETTE_STRING` `T PdfAnnotationState`

*Outline:* `parseDestination` `parseDestinationPosition` `resolveDestination`
`resolveDestinationPageIndex` `T OutlineEntry` `T DestinationRef` `T DestinationKind`
`T PdfDestinationPosition`

*Optional content:* `T OptionalContentConfigHandle`-style helpers via `usePdfOptionalContent`
(`T OptionalContentRow`, `T OptionalContentBundle`, `T OptionalContentGroupState`,
`T OptionalContentOrderEntry`, `T OcStateAction`, and the plain functions `flattenOptionalContent` and
`optionalContentGroupIds`)

*Attachments (`/headless` only):* `normalizeAttachments` `attachmentMimeType` `T AttachmentInfo`

*Print:* `planPrintPages` `planPrintScale` `estimatePrintBytes` `maxPrintablePages` `printCanvasSize`
`isPrintSupported` `printRangeFor` `PRINT_SCALES` `PRINT_MEMORY_BUDGET` `PRINT_CONTAINER_CLASS`
`T PrintOptions` `T PrintScope`

*Download:* `downloadBytes` `pdfFileName` `formatBytes` `T PdfDownloadOptions` `T PdfDownloadOutcome`
`T PdfSaveRefusal`

*Load retry (FR-35):* `classifyLoadError` `DEFAULT_RETRY_POLICY` `T RetryPolicy`
`T RetryAttemptInfo` `T RetryVerdict`

*Cancellation (FR-36):* `onAbort` `abortError` `isAbortError` `throwIfAborted`

*Page labels (FR-12):* `pageLabelForIndex` `formatPageLabel` `labelsDifferFromNumbers`
`resolvePageInput` `T PdfPageLabels`

*Keyboard:* `pageNavigationKey` `isEditableTarget` `T PageKey`

*Fullscreen:* `T FullscreenState`-level helpers via `useFullscreen` internals

*Labels:* `DEFAULT_LABELS` `formatLabel` `T PdfViewerLabels` `T PdfViewerLabelsOverride`

### The `/merge` tier's 13 names
Values: `mergeDocuments` `describeMergeSources` `usePdfMerge`
Types: `T MergeSource` `T MergePageRef` `T MergePlan` `T MergeResult` `T UsePdfMergeOptions`
`T UsePdfMergeResult`
Error contract, re-exported so a tier's caller can classify a failure without importing the root entry
(FR-54): `PdfError` `T PdfErrorCode` `isPdfError` `isCancellationCode`

Nothing here is re-exported from the root entry or from `/headless`, and that is the point: the root entry
must not reach `@cantoo/pdf-lib`, so a host that never imports `/merge` cannot pull the writer in by naming
the wrong symbol.

### The `/edit` tier's 36 names
Values: `editFeature` `createEditFeature` `arrangePages` `flattenBytes` `findSignatureFields`
`signFields` `initialPlan` `inversePlan` `isPristine` `movePlanned` `plannedPages` `removePlanned`
`rotatePlanned` `boxToPage` `isSignable` `padToBox` `signatureContent`
Types: `T EditFeatureOptions` `T EditFeatureState` `T PageEditNotice` `T PagePlan` `T PdfBytes`
`T PdfArrangeResult` `T PdfFlattenResult` `T PdfPageArrangement` `T PdfSignResult`
`T PdfSignatureField` `T PdfSignatureMark` `T SignatureStyle` `T BoxPoint` `T PageRect` `T PadSize`
Error contract, re-exported for the same reason as `/merge`'s (FR-54): `PdfError` `T PdfErrorCode` `isPdfError` `isCancellationCode`

---

## 5. `<PdfViewer />` — all 44 props, in plain words

From `src/components/PdfViewer.tsx`. Anything not marked required has a sensible default.

**Getting the document in**

| Prop | What it means |
| --- | --- |
| `src` *(required)* | URL, relative path, `File`/`Blob`, `ArrayBuffer`, `Uint8Array`, a `data:` URL, or raw base64. All six shapes are normalised in `src/lib/source.ts`. |
| `workerSrc` | Where pdf.js's worker script lives. Omit it and the package finds it (see §10). |
| `assetUrl` | Where cMaps and standard fonts live. Defaults to your own origin; a string or `{ cMaps, standardFonts }`. |
| `allowedSources` | A security option: list of path prefixes `src` may be. Anything else is refused **before a request is made**. Does not apply to bytes you pass directly. |
| `enableXfa` | LiveCycle form rendering. **On by default**, and that carries a risk: a document whose template pdf.js can't lay out fails to load instead of showing a blank page. |

**Loading over a network you do not control** — the eight the `0.9` release added, absent from this section
for the same reason every other drift in §21's log happened: the section was written against the props that
existed at `0.8`.

| Prop | What it means |
| --- | --- |
| `httpHeaders` | Request headers for a URL `src` — an `Authorization` bearer, a signed-URL token, a tenant id. Forwarded to the engine verbatim, **never logged and never echoed into an error**. Read when a load starts and never re-read, so an inline literal does not restart the load on every render; re-open the URL to apply new ones (FR-34). |
| `withCredentials` | Send cookies and HTTP auth for a cross-origin `src` (FR-34). |
| `rangeChunkSize` | Bytes per range request; the engine's own default applies when omitted (FR-34). |
| `disableRange` | Fetch the whole file in one request instead of by byte range (FR-34). |
| `disableStream` | Turn off progressive streaming as the file arrives (FR-34). |
| `retry` | Bounded retries for a load failure that can heal — three attempts with full-jitter backoff by default, `false` to fail on the first error. A 401, a 403, a 404, a corrupt file and an encrypted document are **never** retried (FR-35). |
| `signal` | Stop the load from outside. Aborting is an unmount's exact equivalent and reports no error, because §3.6 says a cancellation is not a failure (FR-36). |

**Starting state**

`defaultScale` (`'fit-width'` `'fit-page'` `'automatic'` or a number) · `defaultLayout`
(`'continuous'` `'single'` `'spread'`) · `defaultRotation` · `defaultPageRotations`
(per-page `{ [pageIndex]: degrees }`) · `defaultSidebarOpen` · `gap` (pixels between pages)

**How it draws**

`devicePixelRatio` (unset → the live `window.devicePixelRatio`, re-read when the display changes; the render
ceilings can still clamp it, see §11. Pass `1` on a low-power device, and note that pinning it also stops a
monitor switch repainting these pages) ·
`maxRenderPixels` (constrains the memory cap, see §11 — it never raises it) ·
`capAreaFactor` (§6.1's viewport working-set factor, accepted below 200 and clamped at it, see §11)

**UI and language**

`className` · `style` · `labels` (override any subset of the 137 strings) · `controls` (say which
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
(replace the built-in prompt; call `submit('pw')` or `submit(new Error())` to abandon) ·
`onExternalLink(url)` — when provided, the browser's own navigation is prevented and the URL arrives here;
the viewer never decides on its own whether a link is safe to follow ·
`onRetryAttempt(info)` — after every retryable failure, **the last one included**, so a host can write
"retrying (2 of 3)" and then "gave up" instead of spinning (FR-35) ·
`onProgress(progress)` — bytes as they arrive, on the channel `usePdfDocument` publishes; the shell
forwards it and draws no bar of its own, because `percent` is `number | null` and a host that binds it to a
width gets an empty bar rather than a NaN one (FR-37)

## 6. The handle — `useRef<PdfViewerHandle>`

`goToPage(page)` · `zoomTo(scale)` · `zoomBy(factor)` · `fitTo('width' | 'page' | 'automatic')` ·
`setLayout(layout)` · `rotate(degrees)` · `rotatePage(page, degrees)` · `retryPage(page)` ·
`openSidebar(open, tab?)` · `toggleFullscreen()` · `search(query, options?)` ·
`invalidatePages(pages)`

Twelve members, which is what `scripts/inventory.mjs` reads out of `dist/index.d.ts`; `retryPage(page)` is
FR-37's, added with the page-state union because §3.5 names a page `error` state and a reader who is shown one
needs a way back into it without remounting the page — one counter per page, so a second retry of the same
page is still a change and a retry of another page is not. `invalidatePages(pages)` is FR-39's: the hook had
the call from `0.11` and the handle did not, which made the clause's "offered to the host" true only for a
host that imports `usePdfSearch` itself. Its pages are **1-based**, like every other page this handle names,
and converted to the index's 0-based slots at the handle — the one place a host can be expected to get it right.

The viewer is **uncontrolled** — it holds its own state; the handle is how you drive it.

---

## 7. The nine features, and what each one actually adds

Every feature is a plain object (`src/lib/features.ts`): `id`, optional `Runner`, `controls`, `panel`,
`keys`, `pageProps`, `replaces`. The `Runner` is where its hooks live, and it is keyed by `id` — not by
array position, because reordering a list would otherwise silently remount a survivor and lose its state.

| Import | `id` | Toolbar control(s) (priority) | Sidebar panel | Keys | What you can do with it |
| --- | --- | --- | --- | --- | --- |
| `features/print` | `print` | `print` (8), `print-pages` (11) | — | `Ctrl/Cmd+P` when printing is supported | Print all / current / a typed range at print intent, honouring stored form values and persisted annotation marks; memory-budgeted resolution; cancellable with a progress bar |
| `features/download` | `download` | `download` (9) | — | — | Save the original bytes, or an incremental save carrying the edits — field values and annotation marks ride the same storage |
| `features/forms` | `forms` | — | — | — | AcroForm widgets (text, checkbox, radio, choice, button) wired to pdf.js annotation storage; `createFormsFeature({ onChange })`; get/set/reset programmatically |
| `features/outline` | `outline` | — | **Outline** tab | — | Document bookmarks; clicking one navigates |
| `features/layers` | `layers` | — | **Layers** tab | — | Optional-content groups; switching one redraws every page (one shared `OptionalContentConfig`) |
| `features/attachments` | `attachments` | — | **Attachments** tab | — | List embedded files, save any one |
| `features/annotate` | `annotate` | - | — | — | pdf.js's own editor manager behind **three tools only**: highlight, free text, ink. Colour picker from the engine palette, Delete live while a mark is selected, undo/redo on published state |
| `features/structure` | `structure` | — | — | — | The document's own structure tree, as accessibility structure. `pageProps` and nothing else: `structureLayer` (extract marked content) and, once `MarkInfo` says tagged and the lazy chunk has arrived, `structTreeLayerBuilder` |
| `edit` | `edit` | — | **Pages** tab (with a **Sign** section when the file has signature fields) | — | Move / rotate / remove pages as a *plan* you can step back before writing; Apply; Extract planned pages as a new file; Split at any row; Flatten; sign a box |

`structure` is the only feature with no user interface, which makes it the contract's cleanest test case:
a `Runner`, a `pageProps`, and no control to fold, no panel to open, no key to bind — a feature is allowed
to be only a decision about what the pages extract and mount.

Two rules inside that table are load-bearing and easy to break:
* `annotate` can't do underline, strikeout or squiggly — the engine has no editors for them — and
  **stamp and signature break the save**, which is why neither is offered.
* `edit` is the only tier that reads the file back, so it is the only tier with a dependency, and it is
  `optional` in `peerDependenciesMeta`. `scripts/check-size.mjs` asserts the writer specifier is
  **absent from core and present only there**.

---

## 8. Toolbar vocabulary

The bar is 16 built-in control ids, in this built-in order
(`src/lib/toolbar.ts`, `src/components/Toolbar.tsx`):

`sidebar` · `prev` · `page` · `count` · `next` · `search` · `zoomOut` · `fit` · `zoomIn` ·
`zoomCustom` · `rotateCcw` · `rotateCw` · `rotatePage` · `fullscreen` · `layout` · `meta`

Plus whatever features add. You configure it with `controls`:

* `hide: ['layout', …]` — eviction
* `order: ['search', 'print', …]` — placement; name one id to pull it forward, name them all to dictate
  the bar exactly
* `priorities: { print: 3 }` — who folds into the overflow first when space runs out
* `add: [{ id, label, run, priority }]` — your own control, folded by the same arithmetic

**The overflow is measured against the container, not the viewport** — a 320 px-wide viewer inside a
1600 px window must fold. Two `ResizeObserver`s drive it; folding tiers in CSS are container queries at
640 px and 440 px (`@container pjsr (max-width: 640px)` and the same at `440px`, both in `viewer.css`), with an `@supports`/`:has()` fallback written when
the target was Safari 14. §8's floor is now 18, and `:has()` (15.4) and container queries (16) are both older
than that, so the fallback is margin rather than requirement — never executed on a real Safari either way,
which is still open and in §20. Touch target size keys off
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
| `HIGHLIGHT_COLORS` | Yellow `#FFFF00`, Green `#00FF00`, Pink `#FF0093`, Blue `#00FFFF`, Orange `#FFC800`, Red `#FF0000`, Purple `#800080` | The editor's highlight palette, straight from the engine's own list |
| `DEFAULT_HIGHLIGHT_COLOR` | first of the above | |
| `PRINT_SCALES` | `2, 1.5, 1` | Tried in that order against the memory budget |
| `PRINT_MEMORY_BUDGET` | `256 MiB` | A job that would exceed it is refused, with a shorter range suggested |
| `BYTES_PER_PIXEL` | `4` | RGBA, used by the budget maths |
| `MAX_RENDER_PIXELS` | `2^25` = 33,554,432 | Desktop canvas-area cap |
| `MAX_RENDER_PIXELS_MOBILE` | 5,242,880 | Mobile/iPadOS cap |
| `MAX_RENDER_SIDE` | 32,767 px | Hard engine limit on one canvas side |
| `CAP_AREA_FACTOR` | `200` | `devicePixelRatio` is clamped down so area stays under the cap. Host-settable through `capAreaFactor` — downward only, and `CanvasBudget.capAreaFactor` reports what was used |
| `MIN_RENDER_SCALE` | `0.25` | The renderer lowers toward this and stops; a page that cannot be painted at or above it is refused with `RESOURCE_LIMIT` |
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
   * `ensureWorker` probes only when `GlobalWorkerOptions.workerSrc` is **empty**, and which realms start
     that way is measured rather than assumed: every browser does, and no Node one does (`npm run
     probe:worker`, `src/lib/worker.default.test.tsx`), because pdf.js assigns the field from its own
     `isNodeJS`. So a browser load runs on the probe below and a Node load runs on the engine's own
     `'./pdf.worker.mjs'`, untouched;
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
(`src/components/PdfPage.tsx`), plus a structure tree that is a *sibling* of the canvas rather than another
overlay:

| Layer | Notes |
| --- | --- |
| canvas | The page picture. Area and side clamped to §9's caps; a canvas too big to allocate **paints nothing rather than crashing**. |
| text layer | Invisible spans for selection, copy and screen readers. Its class list includes pdf.js's own **`textLayer`** — not our naming, and load-bearing: the editors find a selection's layer with `target.closest('.textLayer')`. |
| annotation layer | Form widgets, links, popups. `role="region"` with a label so a screen reader can find it; popups are click-to-open (hover-only tooltips failed 84 px from a viewport edge with no way back). |
| editor layer | Only when a feature that edits is mounted. `isEditing` is passed so an armed editor doesn't paint a duplicate over the canvas copy; the repaint is gated on *this* page having editable annotations. |
| XFA layer | A `position: absolute` child, because pdf.js's own `XfaLayer` CSS is **not** shipped — we restate the rules we depend on. |
| structure tree | Only when `structureFeature` is mounted, the document declares itself tagged, and the page's text layer has finished. `role`d elements that `aria-owns` the text spans, appended to the canvas wrapper — **not inside the canvas**, which is where pdf.js puts its own. Measured in Chromium: our canvas is `role="img"`, and `img` makes its descendants presentational, so a tree inside it is in the DOM and nowhere in the accessibility tree. pdf.js gets away with it because its canvas is `role="presentation"`, and taking that role instead would cost the page its name. The same instance also goes to the **annotation** and **editor** layers at construction, which is how a link gets the `aria-owns` of the words it is drawn over. |


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
* **The structure tree is keyed on the page and its text layer, never on the viewport.** The geometry pdf.js
  writes into the tree is `calc(var(--total-scale-factor) * …)`, so a zoom is already answered by the style
  on the layer and rebuilding would throw away a mounted tree for nothing — verified in the browser as the
  same DOM node surviving `zoomTo(2)`. A rotation *does* rebuild, because the text layer it binds to is
  rebuilt with it, and the marks resolve afterwards (measured: 14 role nodes, every `aria-owns` target
  present in the document).
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

**One deliberate `null` you should know about:** `annotationCanvasMap: null` at the annotation call site means an annotation that pdf.js routes to its own canvas would not be collected — measured, our signature appearances don't take that path, so it costs nothing today. `structTreeLayer` is no longer one of them. The page builds the structure layer as soon as the feature's class and its own text layer exist, keeps it in state, and passes it into the annotation and editor layers' constructors. **The cost is one extra annotation-layer render per tagged page** — the instance cannot exist before the text layer has rendered, and those layers read it at construction — which `PdfPage.structure.test.tsx` pins as a count (2 with the feature, 1 without) rather than leaving as an apology. Untagged documents, the overwhelming majority, pay nothing.

Search marks are `<mark class="pjsr-mark">` elements that `src/lib/highlight.ts` writes into the text
layer's own divs. A match's character range is mapped onto every div it touches, so a phrase crossing a
span boundary is **two** marks — one per span, each carrying the part of the phrase that span holds — and
the match the reader is on adds `pjsr-mark--active` and `aria-current="true"` in the same statement that
sets its class. Clearing a query collapses each touched div back to a single text node (`unwrapMarks`), so
a search never rebuilds the layer. `src/lib/highlight.test.tsx` pins those three behaviours.

**Gesture arbitration (`FR-47`).** Everything the reader does with a wheel or a finger is registered on one
element — the virtualizer's scroll container, `.pjsr-viewport` — and never on `window` or `document`, which
is what "the host application's own listeners are not starved" means in practice: a gesture starting outside
the viewer is not ours to see. Inside it, the four claims are:

| Gesture | Who gets it | How it is settled |
| --- | --- | --- |
| Plain wheel | the browser, scrolling the document | the `wheel` listener returns without `preventDefault` |
| Ctrl/Cmd + wheel | the viewer, zooming | `passive: false` is required — React attaches its own `wheel` listener passively, and `preventDefault` from `onWheel` is a no-op that logs |
| Two-finger pinch | the viewer, zooming | pdf.js's `TouchManager`, which claims the `touchmove` before it knows the gesture |
| Two-finger pan | the viewer, scrolling | the same claim, answered by `onPanning` — without it the gesture dies, because the manager already prevented it |
| One finger on a drawing surface | the surface | `touch-action: none` in the sheet the annotate feature ships; the core has had no drawing surface since FR-18, and no `isPinchingDisabled` predicate to hand it |

A consumed gesture is prevented but **not** stopped from bubbling: `event.defaultPrevented` is how a host
learns the viewer took it, which is the DOM's own protocol and the difference between arbitrating and
starving. The declarative half is on the container — `touch-action: pan-x pan-y` (the browser may pan, and
may never pinch-zoom its own page underneath our zoom) and `overscroll-behavior: contain` (the end of the
document does not chain into the host page) — because `touch-action` is the only way to state a policy
before a listener runs, and a `preventDefault` that arrives after the browser began a pan moves the page
twice. `ViewerController.gestures.test.tsx` drives all of this under jsdom: the engine reads only
`touches`/`changedTouches` and `clientX`/`screenX`, and jsdom has no `Touch` constructor, so the events are
plain `Event`s carrying arrays. Whether the first `touchmove` of a real trackpad gesture arrives before or
after Chrome commits to its own pan is a device question, and stays with `#141`.

---

## 12. Search, print, download, forms — as implemented

**Search.** Options: `caseSensitive`, `wholeWord`, `regex` (three modes, and a pattern that doesn't
compile is reported, not swallowed — the expression is compiled *before* any page is read, so a typo
costs nothing). Outside regex mode the query splits on whitespace and a page counts only when **every**
word appears on it, which is the rule pdf.js's own viewer uses. Indexing is **incremental and
viewport-first** (`FR-39`): `outwardPageOrder(numPages, focus)` reads the page the reader is on, then
+1, −1, +2, −2 — forward before backward at an equal distance — and results go out on the first page, then
at whichever of 25 pages or 120 ms comes first, with `progress`, `pagesIndexed` and `pagesTotal` on the way.
Matches are re-sorted into document order when each batch is published, and the active match is carried by
**identity** across a publish rather than by index, so the reader does not lose their place as the index
grows. A partial answer says so: the counter switches to *"3 of 17 so far"* while `complete` is false, which
is the requirement's honesty clause and two labels in every catalog. Measured cold in Chromium on
`long-sample.pdf` from page 900: first answer 56 ms after the query, complete at 1,176 ms.
`PdfFindController` is the published shape (`FR-26`), now with the five incremental members optional so a
host standing in for the engine's find need not implement progress it does not have.

**An index somebody else built (`FR-40`).** `usePdfSearch({ index })` takes
`{version: 1, pages: [{text, itemEnds}]}` and searches that instead of extracting; `buildTextIndex(items)`
makes one from `getTextContent()` items, and it is the same `buildPageText` walk the viewer runs, so the two
sides cannot drift. `validateTextIndex` refuses a wrong version, a non-array page list, a page count that is
not the document's, and boundaries that do not walk their own text — the page count being the one check a
stale index cannot paper over. A refusal is reported in `indexError` and the document is then searched
anyway; a page the index leaves as `null` is read from the document, and only that page. What the format
*is* sufficient for is measured rather than asserted: `src/lib/search.parity.test.ts` builds an index from a
fixture, sends it through JSON, and gets match-for-match identical `PageMatch` arrays against the viewer's own
extraction. Same file, same measurement, the limit: **text extraction is the content stream**, so a form
field's typed value and an annotation's text are not in the index and cannot be put there by calling
`invalidatePages`.

**Print.** No new window: the pages are drawn into a hidden `div.pjsr-print` **inside the current
document**, `<body>` gets the `pjsr-printing` class, and `@media print` hides everything that is not
that container — which is why the print stylesheet must be loaded for printing to look right. Each page
is drawn to an offscreen canvas at whichever of `PRINT_SCALES` (`2, 1.5, 1`) keeps the whole job under
`PRINT_MEMORY_BUDGET` (256 MiB); when even scale 1 does not fit, the job is refused and the message
names how many pages *would* fit. **Stored form values and the annotation marks a feature persisted travel with it**, because they live in
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

### Merging documents — `pdfjs-react-reader/merge`

A second writer tier, in its own entry (`src/lib/pdf-merge.ts`, `src/headless/usePdfMerge.ts`,
`src/merge.ts`) because a viewer that only displays PDFs has no reason to carry a page-copying writer: the
merge-only consumer path measures **0.78 kB**.

* **The output is always a third file, and that is the requirement.** Every source is loaded from a copy of
  the caller's buffer, and `pdf-merge.test.ts` asserts the property by hashing both sources before and after
  the merge — a reader experimenting with a merge must not be able to lose a document by trying it.
* **Across a document boundary a page is copied, not permuted, and that is why the same page may be asked for
  twice.** `arrangePages` refuses a repeated index; here it is how a cover ends up at the back. Each page is
  one `copyPages` call into a document that started empty.
* **The whole plan is validated before anything is copied.** A plan that runs out at page nine of ten fails
  before it has built a document, not part-way through one the caller then has to throw away.
* **What a merge does not carry is the interactive form.** `copyPages` brings a page's widget annotations
  across but not the `AcroForm` that binds them — the same rule `flattenBytes` documents from the other
  direction — so on a merged file the values are visible and the fields are not live. Stated in the module
  header because a reader who merges two tax forms would otherwise discover it by typing into one.
* **`usePdfMerge` is a hook with no component, and the playground is the test of that choice.** It owns the
  parts a host should not have to get right — page counts as they arrive, the plan as data, a merge that
  cannot touch a source, `null` rather than a throw on its own cancel — and `playground/src/MergeDemo.tsx` is
  the picker a host writes. Its page-count effect keys on a `${name}:${byteLength}` signature per source, not
  on the array: a host passing `sources: [a, b]` inline mints a new array every render, and an effect that
  restarts on that counts the pages forever (the `0.9` `httpHeaders` trap, arriving through a different door;
  the counterfactual was run and hung the harness in React's 50-update guard).
* **Verified in Chromium**, not only in jsdom: 20 and 2 pages read from two fixtures, pages added, one moved
  to the front, one repeated, `wrote 4 pages: 3 + 1`, and the resulting 5,134-byte file reopened in the reader
  with its pages in plan order — a portrait sheet and a landscape one, each keeping its own box at the same
  zoom, because copying a page carries its `/MediaBox`.

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

`src/lib/labels.ts` is the source of truth: **one typed catalog of 137 strings** — the number `src/locales/locales.test.ts` asserts, every one of them
English, every string in the shell coming from it (toolbar labels, `aria-label`s, the "3 of 416 · p12"
counter, error messages). `{page}`-style slots are filled by `formatLabel`.

* A host passes a **partial** object; unnamed keys keep their English default.
* Three complete languages ship: `locales/de`, `/es`, `/fr` — typed as the **complete** catalog, so a new
  key in English makes all three fail to build until it's answered; each frozen; each a separate entry.
* `src/locales/locales.test.ts` asserts what a type can't: the key list matches exactly (the count is
  asserted, and it moved 123 → 131 → 134 → 144 → 147 → 136 → **137** as tiers landed, FR-18 took the ink
  strings back out and FR-47 gave the pen its disclosure), no value is empty or padded, every
  `{slot}` survives with its name intact, and the catalog *translates* rather than echoing English back
  (four exceptions, each named in the test).
* `labels` overrides are **read when the control renders**, not when the viewer mounts: a partial
  override memoises to a new object each render, and depending on it would loop forever.

---

## 16. Styling

Nine stylesheets, plain CSS, no framework, all custom properties under `--pjsr-*`
(`src/styles/viewer.css` holds the tokens: colour, radii, spacing, control heights and the focus ring,
plus a `prefers-reduced-motion` block and the `forced-colors` block below). Every class is prefixed
`pjsr-`. There is no `prefers-contrast` rule and there will not be one while Safari at the advertised
floor does not implement it: a style no browser here can reach is a claim, not a style.

| File | Lines | Ships as |
| --- | --- | --- |
| `viewer.css` | 1,372 | `pdfjs-react-reader/styles.css` |
| `annotate.css` | 325 | `…/annotate.css` |
| `edit.css` | 192 | `…/edit.css` |
| `forms.css` | 137 | `…/forms.css` |
| `print.css` | 113 | `…/print.css` |
| `outline.css` | 90 | `…/outline.css` |
| `attachments.css` | 74 | `…/attachments.css` |
| `layers.css` | 72 | `…/layers.css` |
| `structure.css` | 24 | `…/structure.css` |

`src/lib/assets.ts` prints the minified sizes at build time (e.g. `styles.css` 38,687 B → 18,465 B,
`annotate.css` 12,186 → 3,968). A feature's CSS is its own entry, so mounting a feature and not
importing its sheet is a visible, fixable mistake rather than a subtle one. Engine CSS is **not** vendored
— pdf.js ships text-layer and annotation-layer sheets under Apache-2.0 and our sheets restate the rules we
depend on; the licensing question is a `1.0` decision (§20).

**Forced colours (`FR-44`).** In `forced-colors: active` the user agent replaces the used value of every
`<color>` a rule resolves to — `color`, `background-color`, `border-color`, `outline-color`, `fill`,
`stroke`, `accent-color` and the rest — with a system colour, keeping the alpha and leaving transparent
alone. Authoring against that leaves three jobs, and each is done in one place:

* The tokens are re-pointed at `Canvas` / `CanvasText` / `GrayText` / `ButtonFace` / `Highlight` in
  `viewer.css`, which is why no feature sheet needs a block to follow the theme — they read the tokens.
* Separation that a shadow carried becomes an `outline`: the overflow menu, an annotation popup, the page
  sheet against its backdrop, the thumbnail frame. A `border` would change a box the engine sizes.
* Three declarations opt out with `forced-color-adjust: none`, each with its reason beside it: the text
  layer, adapted from pdf.js with the reason upstream (`viewer.css`), the annotation colour plate
  (`annotate.css`), the signature pad (`edit.css`). There the colour is the reader's own choice, not chrome. `forms.css` does the
  opposite job — its unfocused-field tint is an SVG inside a data URL, which the override cannot reach, so
  under forced colours the image is dropped, the tint is re-declared as a system colour, and the box gets
  the `CanvasText` edge it never had (its authored border is `transparent`).

`src/styles/forced-colors.test.ts` holds the sheets to that: a file that declares a *literal* colour must
carry a `forced-colors` block, no block may author a literal, and the second channels below exist as
declarations.

**Meaning never rides on colour alone.** A search match carries a `border-bottom`; the active match an
`outline` and `aria-current="true"` (both set by the one statement in `lib/highlight.ts` that sets its
class); an annotation highlight an inset edge on both of its paths — `outline` on the
`.highlightAnnotation` the annotation layer paints from the file, and an inset `box-shadow` on the
`.internal` of the editor making one now, chosen so the ring can stay while focus and selection take the
`outline` for their own meanings; an armed toolbar button switches its `transparent` border on; the selected
sidebar tab thickens its underline from 2 px to 3. Each is drawn from `--pjsr-fg`, so a dark palette gets a
light edge without a second rule. The channels are declared outside any media query, because 1.4.1 does not
wait for a high-contrast theme.

**…and one of them does not survive one, which is what measuring rather than describing is for.** A width and
a shape are not colours, so an outline or a rule comes through a forced palette re-pointed; a shadow does
not, because the palette *removes* shadows rather than re-tinting them. Measured on a highlight drawn through
the editor with `forced-colors: active` emulated, the element reported `box-shadow: none`, `outline: none`,
`border: 0px none` and a transparent background — so `annotate.css` declares that path's edge twice: the
shadow for the ordinary theme, a `border: 1px solid` inside its forced block for the reader who asked for the
palette, with `box-sizing` spelled out because this sheet sets it per rule and the element is placed with
`inset: 0`. `forced-colors.test.ts` now refuses the shape in general — a colour-only signal whose resting
channel is a `box-shadow` owes an edge inside the forced block — and it also pins `.pjsr-button:focus-visible`'s
own `outline`, because a browser paints a focus ring whether the package declares one or not. The browser
matrix reads the computed result while the palette is forced: the page slot's outline and its shadow gone, the
file-borne highlight's edge, the search mark's rule, the active match's ring, an editor mark's border, and
focus **twice** — palette on, then off — so the ring seen is the sheet's re-pointed, not the UA's.

---

## 17. Tests: 149 files, 1,306 tests, five projects

`vitest.config.ts` defines projects: **`node`** runs `src/**/*.test.ts` (pure logic, real fixtures read from
disk) except `ssr.test.ts`, **`dom`** runs `src/**/*.test.tsx` (jsdom + Testing Library) except the audits and
the edit tier, **`writers`** runs `src/edit*.test.tsx` and **`node-serial`** runs `src/lib/ssr.test.ts` — both in
one fork, started after the parallel groups, because each does real work whose idle cost is far under the
ceiling (a writer pass over the twenty-page fixture; importing the whole public surface with no DOM, 417 ms
alone) and whose contended cost crosses it, which shows up as `Test timed out in 5000ms` on a file that passes
in isolation (#261; the answer is the one #224 set — serialise, leave the ceiling alone). **`a11y`** is
`src/**/a11y.*.test.tsx` in one fork, started with the other serialised groups, because axe-core holds one run
lock and an audit that loses its CPU turns the ones behind it into failures that name nothing (#216;
`src/lib/a11y-serial.test.ts` keeps that arrangement from decaying). Parenthesised counts are the files this
section has ever itemised; the rest are named, not counted, so a stale figure cannot appear here.

* Logic: `assets` `attachments` `canvas` `download` `editing-state` **`engine-version` (4)** `features` `form` `fullscreen`
  `keyboard` `labels` `layout` `link-service` `optional-content` `outline` `page-plan`
  `pdf-write` (30) `print` `search` (35) `signature` `source` (17) `toolbar` `worker` `zoom` `locales`
  (16) — plus `abort` (13) `retry` (29) `search.abort` (4) and **`source.classify` (39)**, the rule that
  `classifySource` and `normalizeSource` are the same heuristic, **`entry-parity` (5)**, which reads
  `package.json#exports`, `tsconfig.json#paths` and both Vite configs and refuses an entry that is documented
  but unreachable from the source layout (FR-52; it exists because CI's first run died seven typecheck cells
  and six browser cells on exactly that, all three resolutions having been satisfied locally by a `dist/`
  the runner did not have), **`page-announcement` (11)** — the policy behind the page-change sentence (FR-45),
  where the burst that must speak once and the scroll-out-and-back that must not speak at all are sequences rather
  than fixtures —, **`ssr` (19)**, which imports every
  entry point in the export map with no DOM (FR-46; the eighteenth case is `features/structure`, which the
  loop picked up by reading the map rather than by anyone adding it), **`dpr` (13)** — the ratio hub,
  driven by a stubbed
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
  **`ViewerLayout.failure` (4)** **`ViewerLayout.ready` (3)** — the composed shell mounted under jsdom against a
  document that has finished loading, the leg that had never been (FR-28) — **`ViewerAnnouncement` (9)** `FeatureHost`, **`PdfPage.structure` (10)** — the order the tree mounts in,
  its placement *beside* the canvas rather than inside it, no rebuild across a zoom, the annotation layer
  receiving the instance at the cost of one measured re-render, and a failed tree reaching `onError` without
  calling the page broken — **`PdfPage.overlay` (6)** — the same clause over the two layers that used to be
  destroyed and rebuilt on every scale step: one construction and one annotation read across three zooms, each
  new box handed to `update()`, the element the first build stamped still connected, the focus still inside the
  widget, the page's own `change` listener still firing, and the rebuild still happening for a rotation and for
  a programmatic form write (FR-06) — and **`PdfPage.status` (13)** — the first file that ever
  rendered `PdfPage`, the only one that drives its layers by hand, and the one that proves a display change
  reaches the canvas buffer while a `resize` at the same density does not, plus **`ViewerLabels` (6)** — the
  bar mounted against a stub controller, which is the only place the `controller → ViewerParts → Toolbar`
  link of the label table is asserted
* The paint seam, which is what lets §6 profile C be measured rather than inferred (FR-49):
  **`PdfPage.timing` (5)** — the four passes `usePageProgress` already keeps for its own `rendered` join are named
  on the page that ran them (`canvas` is the awaited `page.render()`, the other three are the engine's layer classes
  run from this package's effects), every span is discarded the moment it is measured because a viewer that kept one
  record per pass per repaint would hand a long scroll a timeline that only grows, a reused name is cleared before it
  is opened again, and a UserTiming that refuses cannot reach the reader as a page failure. The fake `performance`
  here refuses a measure whose marks are not open, the way Chromium does — the first version accepted anything, and
  while it was green the seam shared one mark between two spans so the second measured from a name the first had
  cleared, which threw inside the render promise. jsdom has no UserTiming at all, so it could not see any of that
* Engine behaviour, through pdf.js itself: **`damaged`** (6), **`encrypted`** (3),
  **`encrypted.reprompt`** (1) — one load per file, because a load left parked in the Node fake worker
  stops every case after it — **`edge-cases`** (7), which is `FR-51`'s matrix in one named place: the six
  ways a document can be wrong, each row classified `recovers` / `refuses` / `parks`, four re-established
  against the engine here and two cited to the file that can hold them, with guards that the six keys are
  the requirement's six, that every citation still anchors on an `it(`, and that the four in-process rows
  ran (so an `it.skip` cannot retire a case quietly). It also establishes something no earlier test did:
  that `/Rotate` reaches `page.rotate` from the file and `getViewport` swaps the box — page 5 rotated,
  page 8 wide with no rotation, so the swap cannot be read as a reporting quirk — **`scan`** (4), which is
  `FR-49`'s premise checked through the engine rather than trusted from its generator: twelve pages, exactly
  one image drawn on each, a letter box, and **no text items at all**, because a fixture that quietly grew a
  text layer would answer a pixels question with a text-run measurement — and **`tagged`** (7), the structure tree read back from the engine: the roles, the marks the content
  stream actually opens, the two agreeing, `getMarkInfo()`'s real shape, the link annotation's id matching
  the one the tree claims (compared against `getAnnotations()`, so the generator's object numbering stays out
  of the test), and *two* counterfactuals — rename `/Pg` and the marks vanish while the roles stay; blank a
  `BDC`'s property list and the tree is untouched while the text layer loses every element it could have
  owned
* The stylesheet itself, read as source: **`styles/forced-colors` (4)** — every sheet that declares a
  literal colour must say what `forced-colors` does with it, no `forced-colors` block may author a literal,
  and the colour-only signals must each carry a non-colour channel as a declaration (§16). A rule that
  deleted the mark's `border-bottom` passes every DOM test in the repository and fails this one
* The audit (`FR-45`): **`a11y.audit` (11)** runs axe-core's WCAG 2.0/2.1/2.2 A-and-AA tags over the
  loading, failed and password states, the sidebar on each of its four tabs, the open search bar, an
  outline tree and the password prompt — and asserts its own blind spots as a list
  (`color-contrast` and `aria-hidden-focus` come back `incomplete`, because jsdom has no layout), so the
  day axe can resolve geometry the assertion fails and someone re-reads the claim. **`a11y.page` (2)**
  audits the real `PdfPage` with the engine's own text layer and our marks inside it. **`a11y.ready` (4)**
  (#247) audits the shell with a document on screen — 19 rules over 244 nodes: two mounted pages with their
  canvas, text and annotation layers, 4 thumbnails, the toolbar's 10 controls plus the sizer copy, one
  `aria-live` region — then audits it again after a keyboard page change, and a third time with the bar folded
  and the ⋯ panel open, which no axe run had ever seen because the fold planner reads `offsetWidth` and jsdom
  answers 0 (`readyFold.itemWidth` in `ready-shell-harness.tsx` is the opt-in fake that lets the panel mount).
  It names its own reach: 2 ids in the whole mount, both the sidebar's, so this is a states audit rather than
  the cross-part id audit it was first written to be, and its fourth case plants a `role="listitem"` in the
  `tablist` to prove the run can speak
* The accessibility record (`FR-58`): **`a11y-record` (6)** reads `a11y/latest.json`, the file
  `npm run a11y:record` writes out of the audits above — one entry per audit, with the machine, the OS, the
  Node/axe/jsdom/vitest/react versions, the commit and the date. It refuses the record when its toolchain no
  longer matches what `node_modules` holds, when an entry reports zero passing rules (an audit that reached
  nothing is not a clean run), when the ruleset it claims and the harness’s own tag list disagree, when
  `totals` are not derived from `audits`, and when nothing in it is a tree that was made dirty on purpose.
  §9 asks for accessibility evidence a reader can re-read rather than a console log that ends with the job
* Tiers: `features/download` `edit` (11) `edit.extract` (5) `edit.signatures` (8), and
  **`features/structure` (10)** — the gate counted by reads of the peer class (zero for an untagged file,
  one for a tagged one), both `MarkInfo` shapes, the document changing under it, and the merged page props
  carrying the class rather than only the switch;
  **`features/structure.engine-floor` (4)** (#249) — the same tier read at each side of the boundary it declares
  for itself: the requirement is *on* the feature (its behaviour, its minimum, what a reader gets below it), the
  published state is `false` at `6.2.108` and `true` at `6.3.289`, and the fourth case refuses the arrangement
  where `scripts/browser-matrix.mjs` asserts a different release than the contract names. Only the engine's
  reported version is stubbed, so the comparison and the publication run for real;
  **`features/annotate.lifecycle` (5)** — the manager's whole lifetime as FR-29 states it: built with the
  document whose `annotationStorage` an incremental save commits, once per document, rebuilt *and disposed* on a
  swap, untouched by a page coming and going while that page's own layer is rebuilt against the same instance,
  its alert region removed with it so a second document cannot stack two live regions, and no engine mode armed
  that the package does not offer — STAMP, SIGNATURE, COMMENT, POPUP and DISABLE are refused by enumeration
  over the engine's own value list, so a fourth tool appearing in the bar fails the case rather than widening it;
  **`components/PdfThumbnail.xfa` (6)** — the sidebar card for a page composed from a template, which is the
  one page type whose miniature is not a bitmap (a pure-XFA page paints zero operators, so a canvas-only card
  is a blank box: the 0.8 defect). What is asserted is the arithmetic and the reachability the engine is handed:
  `getXfa()` asked for only of a page that declares itself composed from one, the layer laid out at the card's
  CSS scale while the buffer is sized at `scale × devicePixelRatio`, the document's own `annotationStorage` at
  `display` intent, `inert` plus `aria-hidden` plus a tab-order walk over the fields, one tree per card and none
  after an abort. Its pair in a real engine is `scripts/browser-matrix.mjs`'s `sidebar-thumbs-outline` row, which
  loads the fixture and reads the laid-out tree's measured box, its inert state and its tab order — three of the
  four mutations of these two files went red there too, and the fourth (appending instead of replacing) went red
  in neither, because every input that re-runs the composition also unmounts the host it would compose into (§16)
* The shell's own clauses, six files: **`headless/usePdfOutline.tree` (8)** — the recursion `buildTree` had never
  been driven through, at depth, with named destinations resolved *before* the destination is read, an
  unresolvable name published without its children being lost, and an object reference translated by page rather
  than taken as one; **`headless/usePdfVirtualizer.dims` (7)** — `reportPageDims` with a measured page behind it:
  one row sized from what its own page reported, the fit basis moving only for page 1, the first measurement
  winning, the unreached rows sized from a sample mean (asserted as a distance to the final height, which is what
  the 0.8 defect made 15 % and 36 % wrong), and the scroll position moving by exactly the growth of a row above
  the fold so `currentPage` is unchanged; **`PdfPage.status`'s three added cases** — the other end of that wire,
  a page reporting its scale-1 box once and 0-based, mounted at 2× so the number cannot be the painted one;
  **`ViewerPages.paint`'s five added cases** — the fit-mode leg jsdom was said to be unable to walk (fake the
  two measurements at the prototype level and `resolvedScale` moves after all: spread repaints, single does not,
  a narrower viewport does), and the twelve pages each rendering with the shell's *one* optional-content object;
  **`headless/usePdfOptionalContent.shared` (6)** — an injected config means the document is never asked for one,
  the instance comes back by identity, rows re-read only on a revision bump, an action's array is copied, and a
  throwing config reports through `onError` *without* asking every page to repaint;
  **`components/ViewerController.layers` (3)** — the `SetOCGState` relay driven through the options handed to
  `createPdfLinkService`: the published instance moved, `contentVersion` grew, no second config was fetched, and
  a layer-less document drops the action in silence (no repaint *and* no error, which is what makes the guard in
  front of the relay load-bearing); **`components/ViewerController.find` (5)** — a host-supplied
  `PdfFindController` published by identity, its results driving the per-page marks, and the document never
  read for a search the shell was told not to run (with the no-host pair that makes the claim mean it);
  **`components/ViewerController.affordances` (9)** — each of `enableWheelZoom`, `enablePinchZoom`,
  `enableKeyboardNavigation`, `enableFullscreen` and `enableDrop` refused against the composed shell, and the
  refusal read off the chrome rather than only off the behaviour: an unclaimed `defaultPrevented`, an absent
  fullscreen control (counted on `.pjsr-toolbar` and not on `.pjsr-toolbar-sizer`), no `pjsr-viewer--dragover`
* The three contract rows (#238), seven files: **`lib/dependency-boundary` (5)** — FR-53's optional peer as a walk
  over the module graph: the holders of `@cantoo/pdf-lib` discovered by scanning `src/` rather than listed, the
  root and `/headless` reaching none, `/edit` and `/merge` each reaching one (the case that makes the ban's own
  pass meaningful, and the one that caught a Windows path-separator bug making it vacuous), the advertised entries
  that compile the peer in being exactly those two of thirteen, and every bare specifier a *shipped* module —
  derived as reachable from an advertised door — importing from the manifest; **`lib/error-codes.coverage` (4)** —
  §3.6's published list as a gate, so a code added without a test naming it fails, and the naming spread over
  more than one suite; and since #242 the two directions a vocabulary rots in, both derived off files rather than
  asserted — every key of the engine-name table must be a name the *installed* engine stamps (scanned out of
  `build/pdf.mjs` and `build/pdf.worker.mjs`, so the check moves with the peer range) or one this package stamps
  itself, and every published code must have a throw site, a classifier assertion, or a backed table row; **`lib/errors.engine-classes` (5)** — the mapping table applied to the engine's *real*
  classes from `pdfjs-dist/legacy/build/pdf.mjs`, where `PasswordException#code`, `ResponseException#status` and
  `#missing` either are or are not what the map reads; **`lib/pdf-write.codes` (6)** — `WRITER_ERROR` at the one
  producer a caller reaches, the classifier's own verdict surviving the wrapper, an already-coded `PdfError`
  passing through (including the `UNKNOWN_ERROR` that is the only input distinguishing the two idempotence
  guards), and every caller-side arrangement refused as a `CONFIGURATION_ERROR` carrying its numbers;
  **`headless/usePdfDocument.codes` (4)** — `WORKER_ERROR` at the site that diagnoses it, the pinned-worker
  control, the not-about-a-worker control a counterfactual asked for, and `PASSWORD_REQUIRED` on a dismissed
  prompt; **`headless/abort.host-signal` (7)** — the print render stopped mid-paint, an already-aborted token
  performing no work, the host signal and `cancel()` reaching the same engine call, and the attachment walk
  publishing a partial list as nothing; **`components/PdfThumbnail.abort` (4)** — the card cancelling its running
  render, releasing the buffer, doing nothing for a token born aborted, and ending where a scroll-out ends
* Search's three new files, and the merge tier: **`usePdfSearch.incremental` (7)** — the outward order, the
  first page publishing before the batching window, the active match surviving a publish *by identity*, a
  stopped caller landing on `idle` with no error, and `invalidatePages` re-scanning one page and no other;
  **`usePdfSearch.index` (8)** — a host index answering without `getPage` being called at all (not "called
  less": never), a stale index reported in `indexError` **and the document searched anyway**, and the pages the
  index left out being the only ones read; **`search.parity` (6)** — an index built from a real fixture,
  round-tripped through JSON, returning match-for-match identical `PageMatch` arrays, the marked-content
  variant collapsing to the same coordinates with the naive-flatten counterfactual beside it, and a second
  block that measures what the index *cannot* see (a typed form value, an annotation's text);
  **`pdf-merge` (7)** — sources byte-identical after a merge, asserted by hash, plus the repeated page, the
  plan refused before anything is copied, and no bytes for a caller that stopped; **`usePdfMerge` (6)** — the
  counts arriving, the plan as data, and the signature key that stops an inline `sources` array from counting
  the pages forever; **`ViewerController.search` (2)** — `currentPage - 1` handed to the index at the moment a
  search starts, and following the reader down the document instead of latching at mount;
  **`SearchBox.counter` (4)** — both partial-answer wordings, and the case a growing count must never be shown
  as final
* Interaction, driven by hand: **`ViewerController.gestures` (8)** — the table in §11 asserted one row at a
  time, including the pan that has to move the scroll container and the drawing layer that has to keep the
  finger, plus the two declarations the browser reads first; **`touch-pan` (14)** and
  **`ViewerController.pan` (6)** — the two-finger pan across the advertised engine range, the first on the
  probe and the arithmetic, the second on the shell mounted against an engine that reports panning, one that
  does not, and one that cannot be constructed at all (`src/lib/touch-engine-stand-ins.ts` holds the first two
  shapes, transcribed from the real classes, and is not a test file);
  **`annotate.pointer-duty` (5)** and **`edit.pointer-duty` (2)** — FR-47's disclosure duty, the pen's
  `aria-describedby` resolving in both armed states and the signing pad's sentence living in a paragraph
  rather than a `title`, one of each pair read off the sheet the build ships because jsdom resolves no CSS

Recipes that took real time to learn, and are worth reusing: a click handler that `void`s an async write
means you **cannot await it** — settle on `waitFor`, not a fixed timer, and clear mocks only after
in-flight work lands, or the next test inherits a call it never made. jsdom has no canvas 2D context
(guarded) and a zero-sized `getBoundingClientRect` (stub it). And a feature panel's state is published in
an **effect**, so its first render sees `{}` — read every feature state through a default.

Two more, both bought while trying to audit a page rather than a mock of one: jsdom's
`HTMLCanvasElement.prototype.getContext('2d')` returns `null`, and pdf.js's text layer feeds that straight
into a `WeakMap`, so the page dies with `TypeError: Invalid value used as weak map key` before it builds a
single span — a stub returning `{ canvas, font, measureText }` is the whole fix. And `streamTextContent`
is a `ReadableStream` of `{ items, styles }`: hand the layer a promise of a list and the constructor wraps
the promise as if it were a chunk, which fails later as `items is not iterable` rather than at the call
that was wrong.

---

## 18. Toolchain

| Command | What it does |
| --- | --- |
| `npm run dev` | Playground on **:5199** (a fixture is loaded by submitting the URL form; feature toggles are checkboxes) |
| `npm run docs` | Docs site on **:5200**, rendered from `../src` |
| `npm run build` | `tsup` → ESM + `.d.ts`, then `scripts/copy-assets.mjs` minifies the CSS and prints the deltas |
| `npm run build:docs` | Pure `vite build docs` — **never chain a server into a build step** (an earlier version hung a CI job for six hours) |
| `npm run test` / `typecheck` / `size` / `size:update` | vitest / `tsc --noEmit` / the gate / re-accept the gate |
| `npm run check:packaging` | FR-41 against `dist/`: both formats and both declaration files per path, then `require()` and `import()` of every entry must expose the same names. Also FR-52's map shape: every key classified, no wildcard, no `./types`, no target outside `dist/` |
| `npm run check:examples` | FR-52 / §5.6: packs, extracts the tarball into a throwaway project and type-checks every fenced example in `PRD.md` and `README.md` plus the docs site's live examples against **the artifact**, with no `paths` mapping — the only check here that resolves the package the way a host does. Prints each skip with the requirement it waits on; runs in `verify` and in CI |
| `npm run check:maturity` | FR-50 against `dist/`: reads the published names through `scripts/api-names.mjs` and fails if one has no maturity state in `api-maturity.json`, if a state has no name behind it, if a non-stable name has no reason, or if the file invents a fifth state. Runs itself against nine synthetic violations first. Last step of `npm run verify`, and since 2026-10-04 a named step in the CI `verify` job |
| `npm run check:deps` | §6.2's automated scan of transitive dependencies, over **both** surfaces: `npm audit --omit=dev` (what a consumer resolves) and `npm audit` (what a laptop and a runner execute). Every advisory the registry reports must be decided in `security/dependency-triage.json`, and the four facts a decision was made about — `severity`, `affectedRange`, the `packages` it reaches, the `surface` it was seen on — must still match the registry today, so an escalation or a widened range reopens the entry instead of riding along under an old signature. An entry whose review date has passed is red, a finding that has gone away takes its entry with it, `accepted-dev-only` on something that ships is red, and an audit that cannot execute exits 2 rather than skipping. `--selftest` grades 12 synthetic trees first. The triage path itself is [`SECURITY.md`](./SECURITY.md); **the obligation carries no FR row**, so `check:fr-evidence` cannot see it and this is the only place it is tracked |
| `npm run check:fr-evidence` | FR-52/FR-58: the register gate. Reads the requirement ids and titles out of `PRD.md`, so a row cannot invent or drop a requirement; fails a citation that points at a file that does not exist and a `#anchor` the browser harness does not define; demands that a `met` row show implementation, tests, a guard naming its own `FR-` id, docs, and acceptance or a waiver of at least 40 characters; refuses a `partial` with no gap; and compares `ROADMAP.md`'s generated status block against the register, ignoring line endings (#215) so the check does not depend on whose checkout it is. `--emit` rewrites that block; `--selftest` grades itself against 22 cases first — 19 injected violations and
three that must stay quiet |
| `npm run check:tarball` | FR-41 against the **artifact**: `npm pack`, install the tarball beside its real peers into a CommonJS project, resolve every path both ways, and typecheck one identical source file as `.mts` and as `.cts` under `NodeNext`. Needs the network, so it is not in `verify` |
| `npm run test:browsers` | FR-48: §8's browser rows in Chromium, Firefox and WebKit at 1280×900 and 375×812/dpr-2. Needs the Playwright engines installed; exits non-zero if a check fails **or** if an engine never started, because a row with no job behind it is not a tested row |
| `npm run a11y:record` | FR-58: runs the `a11y` project with the recorder switched on and writes `a11y/latest.json` — axe’s findings as a committed record with its environment, not a console log. Writes nothing when the audit run is red, and `npm test` / `npm run a11y` write nothing at all, so the tree stays clean between deliberate runs. `src/lib/a11y-record.test.ts` is what keeps it honest |
| `npm run bench` | FR-49: §6's four profiles against their committed fixtures. Prints **bars** (structural — bounded
| | canvas count, canvases released, the caps binding, the two §6 profile C bars) and
  **measures** (timings with the machine named, never failed on). Profile C's attribution of the cold page between
  this package and the engine comes from `pjsr:` UserTiming marks the viewer puts in its own paint path, read in
  the load under test; the engine-only harness through `playground/raw.html` is printed beside it as a cross-check,
  not as the subtraction the number used to be |
| `npm run probe:canvas` | FR-57's "detection, not labels" in Chromium: imports `src/lib/canvas.ts` through the dev server and fails unless the platform probe answers with the ceiling in force, the shell probes without being asked, one surface lands per frame, no rung allocates above the limit, and the first surface comes after the page painted. Prints the numbers, not just the verdict |
| `npm run probe:worker` | FR-02's browser premise: reads `GlobalWorkerOptions.workerSrc` in Chromium with the playground's own worker wiring blocked, and fails if a browser entry stops starting on the empty string — the state that is why the candidate probe runs in a browser and not in Node |
| `npm run verify` | typecheck → test → build → size → packaging → examples → maturity → **deps** → docs → fr-evidence. Also `prepublishOnly` |

**CI** (`.github/workflows/ci.yml`, read-only token, `concurrency` cancelling superseded runs), six jobs:
`verify` on Node **22.13.0, 22 and 24** (the contract floor, the LTS, the next major) running typecheck,
tests, the axe audit, build, **the maturity, dependency-triage and register gates**, size, `npm pack --dry-run` and
`check:examples` · `docs` (skipped on `main`,
where `docs.yml` publishes instead) · `react`, which swaps in majors **18 and 19** at both their
**minimum-advertised and latest patches** — four runs, with the two `react`/`react-dom` majors asserted to
match — and runs typecheck/test/build · `consumer`, which packs the tarball, installs it into a throwaway
Vite app against **`pdfjs-dist@6.2.108` and `@6.4.299`** (the advertised floor and the current 6.x, so the
range is proved at both ends), type-checks the shipped `.d.ts`, builds, and asserts the worker was bundled
*and* that the relative specifier survived · `packaging` on the same Node matrix, running `check:packaging`
and `check:tarball` · and `browser`, the only job that starts one: `playwright install --with-deps chromium
firefox webkit`, then `npm run test:browsers` and `npm run bench`.

**What has actually run.** As of 2026-10-04, everything except the two gates added an hour ago. The workflow
had been dormant since `5059bc7` on 2026-09-24 — a run of a `verify` matrix that no longer exists, on YAML
twenty-four commits behind — and the pushes since then have produced three runs of the current file:
`37190478169` at `713f4b4`, `37193161535` at `15d0888` and `37197025936` at `dfe8358`. The first is the one
that found the source-layout defect #214 closed: every `typecheck` cell red and all six browser cells
`not runnable`, because a clean checkout has no `dist/` for the package's own self-reference to resolve
against. The two after it are green on `packaging` (Node 22.13.0, 22 and 24, `check:packaging` **and**
`check:tarball` in each), `consumer` (both engine ends), `react` (all four cells), `docs` and `browser` — the
last starting real engines on a runner for the first time and returning **67 ok / 5 skipped / 0 failed / 0 not
runnable**, the same tally the local run reports. `verify` is red in all three, at one step: `Bundle size
budget`, which is the owner's open decision #208. What that still does not buy is stated where it matters:
**no CI run has ever executed `check:maturity` or `check:fr-evidence`** — they were added to the job after the
third run, and they sit deliberately *before* the size gate so the next run reaches them whatever #208 decides
— and the browser matrix ran on the one engine version `node_modules` holds, not at §8's pinned floors — that
half changed on 2026-10-07 (#194): the job declares `engine: ['6.2.108', '6.4.299']`, the same pair `consumer`
builds, swaps the engine inside the one install that pins the rest of the tree at their lockfile versions
(`scripts/pin-tree.mjs`, which both peer jobs now call), and refuses a cell whose disk disagrees — while no
runner has read the floor cell yet, so the axis is built rather than certified. Still with
no Edge and no hardware anywhere in the picture. The React evidence is now both: local (re-run on 2026-09-29
with `react`, `react-dom` and both `@types/*` at 18.3.1 through `npm run verify` end to end, then 19.3.0 put
back with `--no-save` both ways, which is why `package.json` and `package-lock.json` show no diff) and a
runner's, four cells wide.

Note what the consumer job exists for: every other job resolves the package from `src` through tsconfig
paths, so a packaging defect can only surface against the installed tarball. That is how `0.1.0` shipped
a worker URL no bundler could rewrite.

**Repo shape.** `dev` is the integration branch, `main` only takes deliberate merges, and `main` is the
default branch. `git rev-list --count origin/dev..dev` is the authority on how far ahead local `dev` is, and
`npm view pdfjs-react-reader versions` (read 2026-10-04) returns `0.1.0`, `0.1.1` and **`0.1.2`** — so
nothing since `0.1.2` has been pushed or published, and the live docs site still shows `0.1.x` content.
`0.1.2` *was* published, on 2026-09-25; the frozen-don't-publish-a-broken-0.2 discipline above is why
nothing after it has been, and `1.0.0` is the next release the registry will see. `PRD.md` has been a target
specification of **58** requirements since the 2026-10-02 lock, and `1.0.0` ships all of them: `0.9` Reach,
`0.10` Access and `0.11` Index & Assemble are closed and committed on local `dev`, `0.12` Prove is built —
its first commit `f2e9448` and the rest of the pass uncommitted as this is written — and `ROADMAP.md` §1 is
the dated record of each. CI has run on none of it.

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

**A third fact about that floor, measured on 2026-10-04 while building FR-48's engine axis: `6.2.108` is a
browser-only release.** `await import('pdfjs-dist')` at that version throws `ReferenceError: DOMMatrix is not
defined` from the engine's own module scope and prints "Please use the `legacy` build in Node.js environments";
`6.3.289` and `6.4.299` — the only other releases that exist in `^6.2.108` — import 62 names cleanly on Node
24.21.0, which has no `DOMMatrix` global of its own. In a browser `6.2.108` loads and 22 of the matrix's 23
Chromium checks pass, but `pinch-vs-pan` fails because that release's `TouchManager` has no `onPanning` (zero
occurrences in its `build/pdf.mjs` and in its `.d.ts`), so the second finger's `touchmove` is preventDefaulted
and nothing is handed back. Two requirements carry that as a named gap — FR-46's Node-side import and FR-47's
pan half — and the peer-range question itself is open (task #211: move the floor to `^6.3.289`, or scope those
two promises and say where).

The 5.x *data shapes* in `src/lib/attachments.ts` are still tolerated, by decision rather than
oversight — deleting them would turn a graceful "nothing to fetch" into a throw inside pdf.js's click
handler — but **no other 5.x surface is supported or tested**, and `PRD.md`'s FR-25 wording now says so.

---

## 20. What is *not* done, according to the code

| Item | State |
| --- | --- |
| **Real-device matrix** (`#141`) | **Never run.** §8 puts iOS Safari 18 and Android Chrome 125 in the contract; every frame number in every document is Chromium on one Windows machine at ~145 Hz. The `:has()` container-query fallback is written but has never executed on a Safari. Either it gets run or the device claims come out |
| **Accessibility audit** (`#143`) | **Built in `0.10`, and it earned its keep**: axe-core over the shell's three document states, the sidebar on each tab, the search bar, four primitives and the real `PdfPage`, in the suite and as a named CI step (§17). Its first run reported `aria-required-children` on the sidebar's tablist — a close button among the tabs — which eleven earlier accessibility test files had walked past. What is left is what no audit under jsdom can see: contrast and target size need a layout, and an assistive technology has to be the reader |
| **Whether a screen reader sees the tree** | **Not established.** The DOM is verified in Chromium (14 role nodes across the fixture's two pages, every `aria-owns` resolving to a real element, the figure's `/Alt` as its name), but the accessibility snapshot available here *filters unnamed nodes*, and pdf.js's heading and list elements carry no name of their own — they own their text by reference. So "a screen reader announces these as headings" is a claim for the `0.12` device matrix with a real AT, not something this pass proved |
| **Core freehand ink retirement** (`#124`, executed as `#200`) | **Done at FR-18.** The shell's own ink duplicated `annotate`'s and only `annotate`'s survives a save, so the core surface is withdrawn: fifteen published names, the toolbar's `draw` control, the transient print composite and the core sheet's drawing chrome. Recorded in `api-maturity.json` under `removed`, listed in `CHANGELOG.md`, guarded by `src/lib/core-ink.withdrawal.test.ts` |
| **Freezing the mutable exports** | Held for `1.0`'s breaking window (§9). Docs tell a host to spread instead, which is correct before and after |
| **A worker holding the writer** | The real fix for the ~1,080 ms main-thread block when applying/extracting/splitting/flattening a 1,000-page document. Not attempted: today the mitigation is that nothing takes that path unless asked |
| **Vendoring engine CSS** | Apache-2.0 licensing question, needs a real answer before anything is copied in |
| **Repo settings** | The `main` ruleset, and whether `1.0.0` publishes with `--provenance`. Settings, not YAML |
| **An XFA packet whose fields bind through `dataId`** | Still needed — `XfaLayer.setAttributes` has `case "dataId": break;`, so the key is consumed for the binding and never written to the DOM, which is why that question can't be answered from a page today |
| **Named slots / `PdfViewer.Root`** | Not built, and `0.5` **declined** them: what shipped is `controls.order`/`hide`/`priorities` plus exported parts you compose by hand. The 2026-10-02 lock rewrite removed the slots example from `PRD.md` §5 entirely — §5.2 is now the plain `<PdfViewer>` shell and §5.3 is the composed-parts shape, which compiles and runs in `npm run check:examples`. So nothing in the specification sells slots any more, and the decline is no longer a documented disagreement but simply the design |
| **The shell's page path under jsdom** | `ViewerLayout.ready.test.tsx` (3) now mounts the composed shell against a document that has finished loading and drives it: the bar reads `of 4` and the page field follows the reader, PageDown writes a scroll position the virtualizer reads back, and a refused keyboard leaves the page where it was. What that harness needs is four answers jsdom does not give — a `ResizeObserver` that reports an entry (`ThumbnailList.tsx:30` reads `entries[0].contentRect.width`, and calling back with nothing throws outside the test's own frames), an `IntersectionObserver` for the thumbnail rows, `clientWidth`/`clientHeight`, and the `scrollTo`/`scrollTop` pair the virtualizer's loop runs on — plus the `getContext('2d')` stub the page files already install. Since #247 those answers live in `src/components/ready-shell-harness.tsx` and the page proxy in `src/components/ready-fake-document.ts`, split because a `vi.mock` factory that imports a module which imports the mocked hook stops the run at collection with no error and no output — measured on the first version of the refactor, both ready files dead. The claim this row used to carry — that the combination **hangs**, measured to a 60 s and a 120 s kill — was re-measured on 2026-10-06 and is gone; what replaces it is an engine ceiling, not a harness one: loading real bytes under Node fails fast because pdf.js calls `Uint8Array.prototype.toHex` (catalog fingerprints) and `Map.prototype.getOrInsertComputed`, and Node v24.21.0 has neither. So the shell is mounted in jsdom over a page proxy and the **paint** stays the browser matrix's |
| **Nothing published since `0.1.2`** | The `0.2`-onward sequence lives on local `dev` only — `git log --oneline dev` is the authority on which releases are committed — and the whole of it publishes together as `1.0.0`. CI has never seen any of it, which §19 says plainly and every "verified" claim in these files is dated by |

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
| `PRD.md` §7 used to carry the retry intervals as **250 ms / 5 s** | The 2026-10-02 lock put them in FR-35 as **three attempts, 1 s initial, 30 s ceiling**, and `DEFAULT_RETRY_POLICY` (`src/lib/retry.ts:25`) is that pair — checked by `retry.test.ts`, which still injects 250 ms / 5 s *as a host policy* to prove a configured ceiling is honoured. Recorded so the surviving 250/5000 in a test file is not read as a disagreement with the locked default | Closed at W4 (#199); §7 no longer states numbers, by rule |
| README "React 18.3.1 tested" | No job installed 18; the last check was manual, at `0.1` | Re-verified locally **and** a `react` CI matrix added |
| README "19.3.0, **in CI**" | The `verify` job that ran on 2026-09-24 installed whatever `package-lock.json` pinned, and no job had ever installed 18; nothing since has run at all | Row rewritten to name the machine the measurement came from; the `react` matrix job is future protection, not present evidence |
| README Status "signing work uncommitted" | Committed as `0fc7273` | Corrected |
| Docs pages quoting 128.6 / 366.5 / 245.5 kB for engine and peer, on the version that names itself | 131.70 / 375.25 / 251.53 kB measured | Restated, **with the method named** — the trap is documented in `ROADMAP.md`. #240 re-ran the probe and reproduced the *first* triple exactly, because it divided by 1024 where the gate divides by 1000: the two sets are the same bytes in kB and KiB. The figures now ship from `npm run size` inside `docs/src/size-figures.json` with their versions, so neither unit nor version is a hand-copy any more |
| `ROADMAP.md` "39 tests across four files" for signing | 35 across three | Corrected |
| Catalog "142 strings" in three places | 144 | Corrected, including a stale number in the test's own comment |
| A tagged fixture whose tree read back correctly | Its `BDC` operators had one operand instead of two, so pdf.js skipped every marked section with a console warning. The tree is built from `/StructParents`, `/ParentTree` and `/Pg` and never reads the content stream, so all six assertions above it passed on a file that bound nothing | Fixed in `scripts/make-tagged-pdf.mjs`, which now refuses to write a `BDC` without its property list, and pinned twice in `tagged.test.ts`: the content/tree pairing, and the same-length counterfactual that blanks the list. Found by the browser pass, not by the test |
| `getMarkInfo()` resolves with a "MarkInfo object" (its own declaration) | It resolves with a **`Map`** keyed `Marked`/`UserProperties`/`Suspects`, and with `null` — not `{}` — when the file declares nothing. Reading `.Marked` off a `Map` is `undefined`, which is indistinguishable from "untagged" and fails silently for every tagged PDF in existence | Both shapes read; the `Map` pinned against the real engine in `tagged.test.ts` so a change upstream is noticed at the boundary rather than in a browser |
| A feature that published a builder and handed it to no one | `structureFeature`'s Runner published `structTreeLayerBuilder` while `pageProps` returned only the static switch — marked text layers, a fetched 50 kB chunk, no tree. The test that should have caught it asserted the property was *absent* for an untagged document, which is the one case where the bug is invisible | `pageProps` forwards both halves; the test now asserts the merged props *carry* the class for a tagged document, and the constant-only version was re-run to watch it fail twice |
| "the annotation layer receives the structure instance" — declined on cost | The redraw is real (the layer reads it at construction) but the gain was unshowable, because the only tagged fixture had no annotations. Adding a `/Link` to the fixture settled it in an hour | Built, with the render count asserted; see §11 and `ROADMAP.md` |
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
| "Both ESM and CJS outputs" | `"type": "module"`, no `.cjs` in `dist`, never has been | §6 React & Runtime — **overtaken 2026-10-01**: FR-41 shipped both formats with declarations for each, and `npm run check:packaging` is what stops the claim drifting from the build again |
| "Validated for SSR (Next.js)" | Client-side only; `readCanvasEnvironment` exists because it is | §6 React & Runtime. **Half of it is now the other way, on purpose:** `FR-46`'s test imports **every JS target in the export map** with no DOM and none throws — the list is read from `package.json` rather than written out, so it was fifteen files at the `0.11` close and grew by `features/structure` and `/merge` without anyone editing the test — and importing is server-safe while *rendering* stays client-only, which is what the README and the Installation page said before they were checked, in the stronger and wrong form ("pdf.js needs DOM globals at import time, so this package is client-side only") |
| Page manipulation includes **merge** | No `merge` in `src/edit.tsx` or `dist/edit.d.ts` | §2.4, named as not shipped so nobody files against a promise — **overtaken 2026-10-01**: `FR-42` shipped, on its own `/merge` entry rather than inside `edit`, and §13 now says what a merge carries and what it leaves behind |
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
node scripts/check-docs.mjs                     # §2's counts are now a gate, not a courtesy (#213): importable subpaths, the maturity split, source files and lines, test files, stylesheet count and range, fixtures and generators (including "all of them tracked"), CI job count, PRD §8's browser-check count, and the version the docs site prints. Since #240 it also holds the docs site's size tables to `docs/src/size-figures.json` — every published tier must have a figure, no page may index a key the gate never measured, no size cell may be typed by hand — and it refuses a CI run tally or a browser cell's ok/skip reading in `ROADMAP.md` or in any docs page, because those are the two figures no checkout can re-derive. Since #194 it reads the workflow's engine axes too: the two peer jobs must name the same pair, that pair must contain `package.json`'s advertised floor and nothing else, and the benchmark step must name a version one of the cells actually runs. It also compares `package-lock.json`'s mirrored root entry (`engines`, `peerDependencies`, `version`) with `package.json`: that copy had been saying `node >=20` since before the floor moved to 22.13.0, and no job noticed because `npm ci` installs from the lock instead of reconciling it. `--selftest` perturbs every figure it reads, one capture at a time, writes each banned figure back in, moves the axis six ways and the lock mirror four; it requires every one to be caught
npm run check:docs                              # the same, as the step `verify` and CI's Verify job run
grep -rc "" src/**/*.ts src/**/*.tsx            # file inventory (§2)
npm run test                                    # 1,275 tests in 144 files (§2, §17)
npm run a11y                                    # the axe audit on its own (FR-45); it also runs inside the line above
npm run a11y:record                           # the same audits, and writes a11y/latest.json (FR-58)
npm run test:browsers                           # FR-48: the §8 browser rows in Chromium, Firefox and WebKit at 1280×900 and 375×812/dpr-2. Needs the Playwright engines installed; it exits non-zero if a check fails *or* if an engine never started, because a row with no job behind it is not a tested row
npm run probe:canvas                            # FR-57: the §6.1 probe against real Chromium — the ceiling it answers with, the ceiling a mobile UA lowers it to, and the frame every surface landed on
npm run probe:worker                            # FR-02: what `workerSrc` holds in a browser before anything configures it (empty) and so why the candidate probe runs there
npx vitest run src/styles/forced-colors.test.ts # §16's stylesheet rules, read from src/styles rather than from a list
node -e "const u=require('caniuse-lite/dist/unpacker/feature'),f=require('caniuse-lite/dist/unpacker/features').features;const s=u(f['css-media-resolution']).stats;console.log(s.safari['14'],s.safari['16.0'],s.chrome['90'],s.firefox['90'])"   # the §11 `resolution` support flags (caniuse-lite is transitive, via the toolchain, not a declared dependency)
npm run size                                    # every size figure in §2, plus the two failing rules — and the write of `docs/src/size-figures.json`, which the docs site's tables render (#240)
node -e "console.log(Object.keys(require('./dist/index.js')).length)"   # names on the main entry
node --input-type=module -e "const m = await import('pdfjs-dist/legacy/build/pdf.mjs'); console.log(m.GlobalWorkerOptions.workerSrc)"   # §10: pdf.js's own Node default, which an unset `workerSrc` leaves in place
npx vitest run --project node src/lib/worker.fallback.test.ts src/lib/worker.fallback.onpage.test.ts src/lib/worker.fallback.nocode.test.ts src/lib/worker.fallback.deadurl.test.ts   # §10's four worker states, one process each
npm run build && node scripts/inventory.mjs   # the grouped name lists in §4, straight from dist/*.d.ts
node scripts/check-maturity.mjs               # §4's union and §2's maturity row: the distinct names it finds in dist, their states, and the reasons behind every non-stable one
ls playground/fixtures/*.pdf | wc -l && ls scripts/make-*.mjs | wc -l && git ls-files playground/fixtures | wc -l   # §2's fixture row: on disk, generated, and tracked — the third number is the one that catches an uncommitted fixture. 22 on disk and 22 tracked since W8's `vector-sample.pdf` and `oversize-sample.pdf` were committed with the rest of that pass; `check-docs.mjs` fails if the two ever differ.
npm run bench                                 # §2's benchmark row and README's "Behaviour under load" figures, measured rather than quoted
grep -n "MAX_RENDER\|PRINT_MEMORY\|CAP_AREA" src/lib/canvas.ts src/lib/print.ts   # §9
grep -n "structTreeLayer\|annotationCanvasMap" src/components/PdfPage.tsx          # §11
node scripts/make-signature-pdf.mjs && node scripts/make-damaged-pdf.mjs && node scripts/make-labelled-pdf.mjs && node scripts/make-tagged-pdf.mjs   # fixtures are generated, never downloaded
node -e "const fs=require('fs');import('pdfjs-dist/legacy/build/pdf.mjs').then(async m=>{const d=await m.getDocument({data:new Uint8Array(fs.readFileSync('playground/fixtures/tagged-sample.pdf')),verbosity:0}).promise;const i=await d.getMarkInfo();console.log(i instanceof Map?[...i]:i);const p=await d.getPage(1);for await(const c of p.streamTextContent({includeMarkedContent:true}))console.log(c.items.map(x=>x.str??x.type+(x.id?':'+x.id:'')).join(' '))})"   # §11: the two shapes `FR-43` depends on, from the engine rather than from this file
node -e "const fs=require('fs');import('pdfjs-dist/legacy/build/pdf.mjs').then(async m=>{const d=await m.getDocument({data:new Uint8Array(fs.readFileSync('playground/fixtures/labelled-sample.pdf'))}).promise;console.log(d.numPages, await d.getPageLabels())})"   # §8's label table is the engine's answer, not this file's guess
npm run serve:auth &  curl -s -o /dev/null -w '%{http_code}\n' http://localhost:5300/outline-sample.pdf; curl -s -o /dev/null -w '%{http_code}\n' -H 'Authorization: Bearer dev-token' http://localhost:5300/outline-sample.pdf   # 401 then 200 — the document `FR-34`'s browser pass loaded through the playground, which is the only way to see the header arrive
# The "every switch off (28.10 kB) vs defaults (28.01 kB)" pair on the Features page is not a `npm run size`
# path: bundle two consumer files that import `PdfViewer` from `dist/index.js` — one passing every
# `enable*` as false plus a `controls.hide` over the whole bar, one at defaults — through esbuild and
# Rollup exactly as `scripts/check-size.mjs` does, gzip the minified output at level 9, take the larger,
# and divide by 1000 (the gate's `KB` is decimal). The plain `src` fixture measured 28.01 kB by the same
# route, which is the anchor that says the method was reproduced rather than approximated — and it is also
# the "defaults" number, because a `PdfViewer` at its defaults *is* the plain import, byte for byte.
git ls-files playground/fixtures | wc -l   # must equal `ls playground/fixtures/*.pdf | wc -l`: a generated
#                                           # fixture that is not tracked fails a fresh clone's `npm test`,
#                                           # which has happened four times. 22 on disk since W8 added
#                                           # `vector-sample.pdf` and `oversize-sample.pdf`; 20 tracked today,
#                                           # those two uncommitted with the rest of the pass, so the counts
#                                           # match again at the commit that lands them.
git log --oneline -1 && git status --porcelain | wc -l   # what is and isn't committed
```

**If a line in this file and a line in the source disagree, the source is right and this file has a
bug.** Fix the file, and say which one you checked.
