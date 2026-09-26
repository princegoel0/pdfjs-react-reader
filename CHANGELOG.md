# Changelog

All notable changes to `pdfjs-react-reader` are documented in this file.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project adheres
to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.6.0] — 2026-09-26

Marking. The viewer can now write into the document as well as read it: highlights, free text and ink,
authored through pdf.js's own editor stack, held in the document's annotation storage, and carried back
out into the file by Download. XFA forms, which used to render as a blank sheet, now render.

The measurement that scoped the release: of the five editor types the layer registers, **three survive
`saveDocument()`**. A stamp created with no image has nothing to serialize and the save dies inside
pdf.js with `Cannot destructure property 'imageRef'`, and `SignatureManager` is not among the 62 names
the package exports, so a host cannot build one either. So `0.6` ships the three that persist and says so,
rather than offering two tools that lose the reader's work on save.

### Added

- **`annotateFeature`** (`pdfjs-react-reader/features/annotate`, **+1.85 kB** over core) — pdf.js's
  `AnnotationEditorUIManager` owned by the feature's `Runner`, one per document, with each page's
  `AnnotationEditorLayer` registered to it. Three tools in one control — Highlight, Add text, Ink — mutually
  exclusive, each pressed-again-to-stop, plus a highlight colour and a Delete. `annotate.css` is the seventh
  sheet (11,648 B source, 3,891 B minified). Marks are real PDF annotations: measured to survive a zoom step,
  a 90° turn, and their own page being unmounted and remounted, and a `saveDocument()` after eight such
  stages produced each authored subtype exactly once.
- **The highlight colour control**, a labelled `select` over the engine's own seven-colour palette with a
  swatch beside it. It dispatches `switchannotationeditorparams`, which is one call that covers both cases:
  with a mark selected it recolours that mark, with nothing selected it sets the colour the next mark gets.
  A `ColorPicker` was not used because it renders the toolbar it expects to live in, whose buttons have no
  accessible name outside Fluent.
- **`onAnnotationChange`** on `PdfViewer`, reporting `{ isEditing, isEmpty, canUndo, canRedo, canDelete,
  hasSelectedText }` from the manager's own `editingstateschanged` — so a host hears about a change made with
  the keyboard as readily as one made through our controls. Gate a Save on `canUndo`, not `isEmpty`: after
  every mark is deleted the state reads `empty=true, canUndo=true`, which is a host hiding unsaved work.
- **`lib/editing-state`**, re-exported from both entries: `readEditingState`, `readEditingParams`,
  `HIGHLIGHT_COLORS`, `HIGHLIGHT_COLOR_PARAM`, `HIGHLIGHT_PALETTE_STRING`, `DEFAULT_HIGHLIGHT_COLOR`,
  `type PdfAnnotationState` — the same derivation the shell uses, for a host writing their own editor UI.
- **`isEditing` now reaches `page.render`** (`#123`). With a tool armed the canvas stops painting the
  annotations the editors are painting, which is the pairing pdf.js's own viewer computes the same way:
  fixture page 1 goes 80 → 71 operators (its highlight leaves, its underline, squiggly and note stay), page 2
  41 → 16.
- **XFA forms render** (`#119`). A pure-XFA page is painted from its own template by `XfaLayer` into
  `.pjsr-xfa-layer`, the text layer steps aside as the reference viewer's does, and the template's
  `<medium>` rather than the MediaBox decides the page box — `xfa-sample.pdf` asks for 500×700 in a 612×792
  file and mounts at 500×700, with the layout math following unchanged. 21 elements, stable across a zoom and
  a rotation, edits and caret surviving both.
- **Annotation popups and keyboard access** (`#118`) — a popup opens on click and pins, the container pair
  that made hit-testing fail is fixed in `viewer.css`, and the manager's alert region announces additions in
  the reader's own language. pdf.js only writes `data-l10n-id` and expects Fluent to render it, so the
  feature observes the attribute, substitutes the catalog string, and removes it (otherwise a repeated
  announcement is not a mutation and never fires).
- **Two fixtures with self-checking generators**: `annotated-sample.pdf` (every annotation subtype, plus a
  paperclip) and `xfa-sample.pdf`. Both generators resolve every reference and validate the xref offsets
  before writing — the first version of `annotated-sample.pdf` had been silently unusable, dangling four
  references over the page content streams while the viewer painted a text layer and nothing looked wrong.
- `core+annotate` is an eighth measured path in `npm run size`, with the marker `createEditorEventBus`:
  absent from core, present in its own tier. The feature was previously in the export map but not in the
  marker list, so the shell statically importing it would have passed CI.
- Nine labels (`106 → 115`), including `deleteAnnotation` and `highlightColour`; `TrashIcon` in the shared
  icon family.

### Changed

- **The `pdfjs-dist` peer is now `^6.2.108`: v5 is dropped.** `AnnotationEditorUIManager` takes its 16
  arguments **positionally** and 5.0.x has two fewer, so every later slot shifts — the same construction
  silently misconfigures a v5 editor layer rather than failing. 5.7 has the matching signature and no
  release that fixes CVE-2026-16633, so supporting it would mean advising a line we tell you to leave.
  **Breaking** for a v5 install; the CI consumer matrix is one entry now.
- **`usePdfDownload`'s `withFormValues` is `saveEdits`. Breaking** for anyone who passed it. The rename is
  not cosmetic: `saveDocument()` writes the whole `annotationStorage`, in which a field value and a highlight
  are the same kind of entry, and the old name said only the first.
- **`usePdfFeaturePeer` returns `Partial<S>`.** A peer publishes from an effect, so on the first render
  there is nothing there; the hook's type claimed otherwise and the call site obeyed it.
- **`annotateFeature` takes the shell's freehand toggle out of the bar** while it is mounted, through
  `PdfFeature.replaces` — folded into the same `hide` list the `controls` prop writes, so `hide` keeps its
  meaning and a host that already hid it is not contradicted. Nothing was deleted: without the feature the
  viewer still draws, prints and replays ink. Which of the two inks is the one that saves is a 1.0 decision.
- Scale and rotation reach the manager as `scalechanging` / `rotationchanging` **dispatches** instead of an
  assignment to `viewParameters`. The handlers do work invisible from outside — `realScale = scale × 96/72`,
  the walk over editors waiting to be rescaled, and committing the one in flight — and the assignment was
  leaving `realScale` 1.3333× low (1.6225 where the engine computes 2.1634).

### Fixed

- **Download dropped the reader's marks.** The control chose its branch on `forms.isDirty`, which compares
  field values, and `getData()` is the file as it was loaded. Measured with one highlight on the page and
  nothing else changed: 6,058 B identical to the original and one `/Highlight` in it, against 7,067 B and two
  from `saveDocument()`. The gate is now either editing peer, and it is proven through the control's own
  bytes: untouched downloads byte-identical, one mark downloads the mark. `canUndo` is the flag because
  arming a tool is not an edit — conversion alone puts three entries in storage.
- **A highlight painted black over the reader's text.** The palette was handing the manager values without
  their `#`, which parse fine and are invalid as a paint, and an invalid `fill` resolves through inheritance
  rather than failing. Now `#FFFF00`, measured `rgb(255, 255, 0)` where it had computed to `rgb(0, 0, 0)`.
- **A crash on the first render of a viewer mounting both editing features** — the nested peer read
  described above, thrown before any effect had published.
- **Two rotation defects in the editor layer.** `.pjsr-editor-layer` carries `data-main-rotation` too, so it
  now mirrors the core sheet's three swap rules (without them a mark sat on blank paper after any turn); and
  a mark *authored* at 90° no longer displays across its own text — pdf.js sets
  `data-editor-rotation` for a viewer that leaves the layer unrotated and rotates each box, and we rotate the
  layer, so applying both transformed it twice. The mark's page-space data was correct the whole time:
  the same sentence measured upright and sideways agrees to 0.2 pt.

### Notes on verification

`npm run verify` green — typecheck, **313 tests in 25 files**, build, size gate — plus a browser pass over
the playground and the docs site, whose drop-in example now demos the feature (it is a second host app, and
it is where `replaces: ['draw']` was confirmed). Baseline re-accepted with `npm run size:update` and every
quoted figure in the README, the docs pages and the ROADMAP re-derived from it: core 23.66 kB, annotate
+1.85, download +0.77, all seven 32.75, shell 50.87, headless 26.78. Two things this release deliberately
does not claim: that XFA documents can be saved back (unmeasured, `#127`), and that arming a tool is free
(document-wide repaint, filed with its measurement as `#126`).

## [0.5.0] — 2026-09-26

Composition. The viewer's state moved behind one object, the parts became importable, and the toolbar's
contents became something the application decides. Two sidebar panels and a deeper find came with it.
Nothing in here breaks an existing call site: every prop is additive, and the parts keep the explicit
props the built-in layout passes today.

The measurement that started it: opening the search bar re-rendered **six** page components and closing it
four, because the shell handed every page a fresh inline arrow each render, which also made
`React.memo(PdfPage)` inert. Both fixed, a chrome interaction now re-renders none.

### Added

- **`useViewerController(props)`** owns every piece of state, effect and handler the shell had;
  `ViewerLayout` places the parts; `PdfViewer` is those two plus a ref and went from 933 lines to about
  165. Cost **+0.51 kB** on the core path, and it is not subtle code — it is the ~60-field object the
  controller returns, which is the API.
- **`ViewerProvider` and `useViewer()`**, and the four parts the default layout is built from:
  `ViewerRoot` (the frame: tokens, keyboard, drop, the feature Runners), `ViewerToolbar`, `ViewerSidebar`,
  `ViewerPages`. A host writes its own arrangement instead of forking the shell —
  `playground/src/CustomLayout.tsx` is the worked example, sharing one props object and one ref with
  `<PdfViewer>`. `useViewer` outside a provider throws, deliberately: the alternative is an empty toolbar
  with no explanation. Cost **+0.15 kB**.
- **The `controls` prop** — `{ hide, priorities, order, add }`, keyed on each control's `id`, the seventeen
  built-ins plus whatever a mounted feature declares. `hide` removes from bar and menu, `priorities`
  changes what folds first, `order` changes where controls sit while they are in the bar, `add` contributes
  host controls and replaces by id in place so swapping a button does not move it. `ToolbarItem` and
  `ToolbarControls` are exported — `ToolbarItem` was already the type of `featureItems`, which no consumer
  could name. Cost **+0.32 kB**. Named slots were planned and not built: `order` covers
  placement without a second vocabulary for the same list, and injecting markup *between* controls is the
  point where a host should write their own `Toolbar`, which this release supports.
- **Print page ranges.** `printFeature` now contributes two controls — `print` at priority 8 (the action,
  so it stays in the bar) and `print-pages` at 11 (All / Current / From–to, so it gives its place up first)
  — and the print button says what it will send (`Print pages 2–3`). `Ctrl/Cmd + P` prints the same
  selection. Scope state lives in the Runner, because a control can be rendered three times.
  **+0.47 kB** on print (2.02 → 2.49 of its 4 kB gate).
- **`layersFeature`** (`pdfjs-react-reader/features/layers`) lists a document's optional-content groups as
  a sidebar tab and switches them; **`attachmentsFeature`** lists embedded files and saves them. Each ships
  its own stylesheet, and neither is in the core bundle: measured over core, **layers +1.16 kB**,
  **attachments +1.07 kB**.
- **`usePdfOptionalContent`** and **`usePdfAttachments`** as headless hooks, and the pure halves beside
  them (`planFind`, `findPageMatches`, `countPerPage`, `flattenOptionalContent`, `normalizeAttachments`).
- **Search depth.** A query's words must **all appear on the page** (the rule pdf.js's own viewer uses),
  `regex: true` treats the query as a JavaScript expression, an uncompilable pattern is reported as
  `Invalid pattern` rather than as "no results", and `counts` / `pagesWithMatches` give per-page totals a
  results list can group by.
- **The `find` prop**: supply any object shaped like `usePdfSearch`'s result — the `PdfFindController`
  contract — and the find bar, the marks and the navigation run on your answers. That is the seam for a
  server-side index or a stemmed matcher without rebuilding the chrome.
- **`attachments-ocg-sample.pdf`** and `scripts/make-attachments-ocg-pdf.mjs`: three pages carrying embedded
  files and three optional-content groups, one off by default, plus a `SetOCGState` link and a
  `FileAttachment` annotation whose file reaches the save dialog. `--stamp-on` and
  `--out` emit a twin document differing only in that flag, which is how the default was shown to be what
  drives it.
- **`Automatic` zoom completes `FR-06`.** The zoom select gains an `Automatic` option,
  `defaultScale` and `ScaleMode` gain `'automatic'`, and `handle.fitTo` takes `'automatic'` beside
  `'width'` and `'page'`. The rule is orientation: a landscape page is fitted whole, a portrait one by
  width, rotation included — a page turned sideways is treated as the shape you are looking at.
- **`planFind`, `findPageMatches`, `countPerPage`, `convertMatchRanges` and `FindPlan` are now
  exported from the root entry too**, not only `/headless`. A host replacing the shell's find strategy
  through the `find` prop builds it from the same planner the built-in one uses, without a second import
  from a different entry point.
  name, so a string the shell takes from a literal instead of the catalog shows up as untranslated English
  where a test can see it. Deliberately blunt: the point is the residual, not any one label.

### Changed

- **`PdfPage` is memoised** and the shell hands each page a stable ink-commit handler instead of a fresh
  inline arrow. A chrome interaction (open search, toggle the sidebar, fold the bar) re-renders no pages;
  toggling draw mode still re-renders two, legitimately, because `inkDrawing` is a page prop.
- **A multi-word query means something different.** Before, `"trace license"` searched for that exact
  string; it now finds pages holding both words, which is what every other PDF viewer's search box does
  and what readers read the space as. Measure of the difference: on the 14-page test document `trace`
  finds 416 matches and `trace monkey` finds 401, because pages with one word and not the other drop out.
- `downloadBytes` takes a MIME type, so a saved attachment is not labelled `application/pdf`.
- **`INK_WIDTHS` names a label rather than carrying one.** The exported array was
  `{ label: 'Thin', value: 1.5 }`, so a host that built its own pen-width select from it got English no
  matter what catalog it passed; it is `{ value: 1.5, labelKey: 'penThin' }` now and the shell's select
  reads `labels[option.labelKey]`. **Breaking** for a host that imported it and read `.label` — which is
  published in `0.1.x`, so it is recorded rather than waved through as unpublished.
- `PdfViewerHandle.search` now takes the same options the find bar exposes, including `regex`.
- The core viewer resolves the document's `OptionalContentConfig` once per load and passes it to every
  render, which is what `contentVersion`/`repaint` exist for: **+0.45 kB** on core.

### Fixed

- **A paperclip annotation now saves the file it carries.** Double-clicking one, or pressing
  `Ctrl/Cmd + Enter` while it has focus, asked pdf.js for `linkService.getAttachmentContent` — a method our
  link service never declared — and then for a `downloadManager`, which it reads off the **render params**
  rather than the `AnnotationLayer` constructor, so a manager placed there is ignored without a word. Both
  are supplied now, and the save runs through `downloadBytes` with the same MIME guess the attachments tab
  uses, so a `.txt` arrives as `text/plain` instead of `application/pdf`. Browser-measured: one 65-byte
  blob and one anchor click naming `note-from-page-2.txt`. **+0.29 kB** on core, which is where the save
  now lives — the reason `attachmentsFeature`'s cost over core fell from 1.29 kB to 1.07 kB.
- **`pdfjs-react-reader/layers.css` and `/attachments.css` were promised and never built.** `package.json`
  exported both and the docs told readers to import them, but the asset step minified four sheets, so a
  consumer's bundler failed to resolve a file the manifest named — while every check inside the repo
  passed, because `tsconfig.json` resolves `pdfjs-react-reader/*.css` onto `src/styles/*.css` and the
  playground therefore wore the styles happily. Both sheets are emitted now; the `declare module` list is
  generated from the same array so the two cannot drift again; the asset step exits 1 if any `exports`
  target is missing (proved by pointing the map at a file nothing writes); and the consumer smoke app
  imports all six sheets, so repeating this needs a manifest lie *and* a working bundler to hide it.
- **The layers panel had no keyboard focus ring.** `.pjsr-layers-row:focus-visible` matched the `<label>`,
  which is not focusable, so the rule could never fire and the checkbox fell back to the user-agent
  default; the ring is on the checkbox now. An unnamed layer also stopped announcing its object id as its
  name — it reads `(untitled)`, the way an unnamed outline entry does, with the id still in the tooltip.
- **Two strings bypassed the label catalog.** The ink bar's `Clear` and the page counter's `of {n}` were
  literals in `Toolbar.tsx`; they are `clearLabel` and `pageCountOf` now, which makes the catalog the
  complete set it claimed to be for the bar.
- **Rotating a page's layer state now reaches the page.** pdf.js builds a *new*
  `OptionalContentConfig` on every `getOptionalContentConfig()` call, and a `render()` that is not handed
  one fetches its own — so switching a layer on any instance the caller holds changes nothing on screen.
  Both the panel and the `SetOCGState` annotation handler now mutate the single instance the pages render
  with, and the pages redraw. Proved in the browser in both directions: clicking a layer's checkbox and
  clicking a document's own layer link each repaint the mounted pages and move the other's state.
- **`executeSetOCGState` is implemented** instead of a no-op, so a link or bookmark that switches layers
  does what it says rather than highlighting and changing nothing.
- The new fixture initially emitted `q /MC0 BDC`, but `BDC` takes **two** operands and pdf.js resolves a
  layer only when the tag is literally `/OC` (`q /OC /MC0 BDC`). One operand is skipped outright —
  `Skipping command BDC: expected 2 args` — which leaves the content painted while belonging to no group:
  the document looks fine and a layers tab has nothing to toggle. Zero such warnings is now the first
  assertion made about it.

### Notes on verification

Page tracking, canvas ink and printing to a real dialog cannot be checked in the automated browser used for
this release (its tab is `visibilityState: 'hidden'`: no animation frames, no compositor surface, and canvas
readback returns stale buffers). The layer work is therefore verified structurally — the operator list shows
which groups own which content, `getGroup(id).visible` shows what the document says, and canvas attribute
mutations show that a redraw was asked for — and the visual half needs a window to look at.

## [0.4.0] — 2026-09-25




Tiers. Four of the viewer's capabilities — printing, saving, filling forms, the outline panel — are now
values you import rather than props you switch off, which is the only arrangement that survives a
bundler. **This release contains a breaking change to `PdfViewer`'s props**; the upgrade is three lines
and is spelled out under "Changed" below.

The reason it was worth breaking anything: measured against `0.3`'s build, `PdfViewer` with all three
feature props switched off cost **24.09 kB** gzipped against **24.07 kB** with them all on — the same
bytes, and the same print, download, form and search code in the bundle either way. A prop can turn a
feature off in the UI. It cannot turn it off in your bundle.

### Added

- **The `features` prop** (`src/lib/features.ts`): `features={[printFeature, downloadFeature,
  formsFeature, outlineFeature]}`, each a plain value imported from its own entry. The core shell
  imports none of them — `dist/index.js` contains no reference to `features/print`, `features/forms`,
  `features/download` or `features/outline` — and a consumer who names none gets pages, the text layer,
  search, ink, thumbnails, rotation and layout modes and nothing else.
- **The `PdfFeature` contract**: `{ id, Runner?, controls?, panel?, keys?, pageProps?, options? }`. A
  feature's hooks live inside its `Runner`, which is mounted once per viewer and keyed by `feature.id`;
  its toolbar controls, sidebar panel and key bindings are data the shell places, and whatever its
  Runner publishes flows back to the pages (`pageProps`) and to its own controls. The authoring hooks —
  `usePdfFeatureShell`, `usePdfFeatureState`, `usePdfFeaturePeer`, `usePdfFeatureOptions`,
  `usePdfFeaturePublish` — are exported from the root entry, so an application can ship its own feature
  (annotation editing in `0.6` will be one) through the same door.
- **Four built-in features** at `pdfjs-react-reader/features/{print,download,forms,outline}`, each with
  a `create*Feature(options)` form for its own knobs: `createPrintFeature({ scale })`,
  `createDownloadFeature({ fileName })`, `createFormsFeature({ onChange })`. `download` asks `forms`
  whether the document has unsaved edits through `usePdfFeaturePeer(FORMS_FEATURE_ID)` and falls back to
  the pristine bytes when that feature is not mounted, so the peer edge is a lookup, not an import.
- **One stylesheet per tier** (FR-22): `styles.css` keeps the core chrome and `print.css`, `forms.css`
  and `outline.css` carry the rules for the features that need them, so the core sheet no longer ships
  form-widget or print rules to an app that mounted neither. All four are minified at build time, which
  matters because the source sheets are heavily commented: the core sheet went 28,645 B → 15,820 B.
- **A second half to the size gate** (FR-23): `scripts/size-consumers/` holds one file per import an
  application can make, `npm run size` bundles every one of them with both esbuild and Rollup, reports
  the larger result per path, and asserts that each feature's marker string is **absent from the core
  bundle and present in its own** — the second direction so a marker that matches nothing cannot pass
  vacuously. The markers are the hook names (`usePdfPrint`, `usePdfDownload`, `usePdfFormValues`,
  `usePdfOutline`), grepped on unminified output, because an earlier attempt used engine symbols too:
  `AnnotationMode` shows up in a clean core bundle merely because our code imports that name from
  `pdfjs-dist`, so it reported the print pipeline as present when the hook itself was gone.
- **The gate was tested by breaking it.** Re-adding a live `usePdfPrint` reference to the shell and
  rebuilding: core went 20.61 → 22.10 kB and both bundlers reported `FAIL usePdfPrint is in the core …
  bundle: the shell imports print again`, exit 1. The leak also made print's *marginal* cost read as
  0.55 kB instead of 2.02, which is the shape of the regression a totals-only gate cannot see. The
  ratchet half was checked the same way, by lowering a baseline number 5 kB in a scratch copy — the
  first attempt at that produced a false green, because the scratch file was written to `/tmp`, which
  Git Bash and node resolve to different roots, so the run that "failed correctly" had failed to find a
  baseline at all. Redone inside the repo.
- **The PRD's 8 kB core target did not survive contact with the build**, and the honest record is that
  it was written against a prototype shell with none of the things the real core carries. The measured
  core is 20.61 kB, so `PRD.md` §6 now reports that number and keeps the per-feature 4 kB gate, which
  is the half that can stay fixed and still say something. No absolute core ceiling was reinstated.
- **A DOM test project** (`vitest.config.ts`), because the two rules that fail silently — a Runner
  remounting and losing its state, a publication outliving its feature — cannot be reproduced without
  one. `jsdom` and `@testing-library/react` are devDependencies; the package still ships zero runtime
  dependencies of its own.

### Changed

**Breaking, on `PdfViewer` — the one breaking change `0.4` was reserved for:**

| Removed in `0.4` | Replaced by |
| --- | --- |
| `enablePrint`, `printScale` | `features={[printFeature]}`, or `createPrintFeature({ scale })` |
| `enableDownload`, `downloadFileName` | `features={[downloadFeature]}`, or `createDownloadFeature({ fileName })` |
| `renderForms`, `onFormValuesChange` | `features={[formsFeature]}`, or `createFormsFeature({ onChange })` |
| — (the outline tab was always there) | `features={[outlineFeature]}` |

So `<PdfViewer src="/a.pdf" />` in `0.4` is a viewer that reads: no print button, no save, no fillable
widgets, no outline tab. `<PdfViewer src="/a.pdf" features={[printFeature, downloadFeature, formsFeature,
outlineFeature]} />` is the `0.3` default, and the import paths are `pdfjs-react-reader/features/*`. The
reason `0.4` is where this lands instead of after `1.0` is in the paragraph above: leaving the props in
place would mean leaving the code unshakable, and every later tier (`0.6` annotations, `0.7` editing)
has to sit on the seam this creates.

- **`PdfPage`'s `renderForms` now defaults to `false`.** The annotation layer still draws links and
  markups — those are core — but widgets are rendered only when something hands the page the storage to
  write into. Consumers using `PdfPage` directly were getting widgets they had not asked for.
- **`SidebarTab` widened from `'thumbnails' | 'outline'` to `string`.** A closed union cannot name a tab
  contributed by a feature, including one an application writes for itself. `'thumbnails'` and
  `'outline'` are unchanged in behaviour; the sidebar now renders exactly the tabs its mounted features
  contribute, with the roving-tabindex arrow keys wrapping over that list.
- **Toolbar overflow rows group on priority *and* label**, not priority alone. Feature controls declare a
  priority on the built-in scale, and print asking for 8 — where the built-in print button had always
  sat — put it in the menu row labelled "Rotate current page". That mislabel predates this release; with
  features being named by the application it becomes visible, so it is fixed here.
- **`size-baseline.json` was rewritten** and its labels changed meaning. It now holds the two shipped-file
  paths (`shell`, `headless`, computed over the files reachable from each entry rather than over every
  chunk in `dist/`, which six entries made meaningless) plus seven bundled consumer paths.

Measured, gzipped, worst of esbuild and Rollup, on this release's build:

| Consumer import | `0.3` | `0.4` |
| --- | --- | --- |
| `PdfViewer`, features off / on | 24.09 / 24.07 kB | — |
| `PdfViewer` alone | — | **20.61 kB** |
| + one feature | — | print +2.02, forms +1.99, outline +0.93, download +0.86 kB |
| `PdfViewer` + all four | — | 25.79 kB |
| `usePdfDocument` from `/headless` | 2.69 kB | 2.59 kB |

Verified in a browser, on the docs site and the playground:

- **Core, with all four features unmounted**: no print or download control anywhere in the toolbar, zero
  form widgets (against 9 on the same document with `formsFeature`), the sidebar reduced to the single
  `Thumbnails` tab, and a `Ctrl/Cmd+P` keydown neither consumed nor printing
  (`defaultPrevented: false, printCalls: 0`) — while the same page still rendered 2 canvases, 13 text
  spans, and 5 annotation sections including both link annotations. With all four re-mounted, every
  control came back without a reload, and the playground's 14-page document still painted 356 text
  spans with nothing mounted at all.
- **Print through the feature**: in flight, `body.pjsr-printing` set, one `.pjsr-print` container holding
  3 canvases at 1224×1584, the control swapped to `Cancel printing`; afterwards `window.print` had been
  called once and the container was detached with the body class removed. `Ctrl/Cmd+P` fired the same
  path (`defaultPrevented: true, printCalls: 1`).
- **Print still carries freehand ink**, which is the behaviour the shell→feature→`usePdfPrint` hop could
  silently have lost: after one stroke on page 1, the print render sampled 2,455 red pixels on page 1
  against 161 on each of pages 2 and 3 (that fixture's own red text).
- **Download through the peer link**: 5,073 bytes pristine, 5,600 after typing `typed by verification`
  into a text widget, both named `form-sample.pdf` from `shell.documentLabel` — i.e. the save switched
  from `getData()` to `saveDocument()` because `forms` said the document was dirty.
- **Outline as a panel feature**: tabs `["Thumbnails", "Outline"]`, 4 tree entries including the nested
  `2.1 Deep dive`, and clicking `3. Conclusion` moved the page input to `3`.
- **Folding with feature controls present**: at 380 px the bar kept navigation, search and zoom, and the
  menu rows read `Rotate current page`, `Print document`, `Custom zoom percentage`, `Download`,
  `Page layout`, `Enter fullscreen` — each feature control in its own labelled row, and the print button
  in the menu drove the full pipeline.
- Console clean on both dev servers apart from Vite's own HMR chatter; no React warnings, no pdf.js
  worker failures.

## [0.3.0] — 2026-09-25

Production robustness: the ways a viewer that works on a laptop fails in the field — a canvas too
large to allocate, a document that needs an asset nobody fetched, a source that should not have been
loaded, a page whose Content-Security-Policy quietly moved the engine onto the main thread, and a
form that will never fill in, which nothing said before the user tried.

### Added

- **Canvas ceilings** in `src/lib/canvas.ts`, wired through `PdfPage` and exposed on `PdfViewer` as
  `maxRenderPixels` and `devicePixelRatio` (the latter previously accepted and ignored). pdf.js caps
  the render area at 2^25 device pixels, 5,242,880 on iOS/Android, and 32,767 per side, with an area
  factor of 200; those four numbers are restated here rather than imported, because reading them from
  the engine's `AppOptions` would let a pdf.js minor change what our pages render at. The default
  comes from `maxRenderPixelsFor(readCanvasEnvironment())`, so a phone gets the mobile cap without
  anyone configuring it. This is the entire defence, not a hint: an over-large canvas does not throw,
  the browser allocates nothing, and pdf.js paints a blank page.
- **`assetUrl`** — `'cdn'` (the default) or a directory you serve — resolving to `cMapUrl`,
  `standardFontUrl` **and** `wasmUrl`, which was never passed before, so JBIG2 and JPEG 2000
  documents had no decoder to find. The default root is `CDN_ASSET_ROOT`, an unpkg URL interpolated
  with the installed `pdfjs-dist` version, replacing the two unpkg string literals from `0.1`. The
  planned `'local'` mode was dropped after measurement: pdf.js concatenates a *directory* with a
  filename at runtime, and no bundler can hand one back — Vite rewrites both `new URL()` forms to the
  package's entry file in dev and emits only individually named hashed files in build.
- **`allowedSources`** on `PdfViewer` and `usePdfDocument`: URL prefixes, bare origins, or
  same-origin paths, with `'*'` to opt out explicitly. Path entries are bound to the page's origin,
  and an origin entry is matched at its slash boundary, so `https://cdn.example.com` cannot admit
  `https://cdn.example.com.evil/`. Byte sources are always accepted — the app handed them over.
- **`configureTrustedTypes(name)`** and `isTrustedTypesConfigured()`, exported from both entries.
  Under `require-trusted-types-for 'script'` pdf.js cannot start its worker — `workerSrc` accepts only
  a string, and `new Worker(string)` throws there — and it swallows the failure, parsing on the main
  thread while the viewer appears to work. This builds the worker through your own policy and passes
  pdf.js the *instance*. It is opt-in because a policy name absent from your directive throws at page
  level, so nothing here can pick one for you. Loads under this mode own their worker and dispose of
  it: `PDFWorker.destroy()` does not terminate a port it was handed, which would otherwise leak one
  per reload (measured: 7 workers constructed, 6 terminated across 3 document switches).
- **`capabilities`** on `usePdfDocument` and `onCapabilities` on the shell: `{ form:
  'none' | 'acroform' | 'xfa' | 'mixed', renderedFromXfa, hasJSActions }`, read from the document's
  own `getMetadata()` flags and `hasJSActions()`. Detection is unaffected by `enableXfa`. A host can
  now say "this one needs Acrobat" instead of showing a page that refuses to fill in.
- **Fixtures and playground coverage** for all of the above: `scripts/make-cjk-pdf.mjs` →
  `cjk-sample.pdf` (CID-encoded, so the cMap path is exercised) and `scripts/make-scripted-pdf.mjs` →
  `scripted-sample.pdf` (document-level JavaScript). The playground gained an asset-mode switch, an
  allowlist toggle and a capabilities readout, and a dev-only middleware that serves `cmaps/`,
  `standard_fonts/` and `wasm/` out of `node_modules` so self-hosting is testable without a deploy.

### Changed

- **A string that is not recognizably a URL now throws `TypeError`** instead of being fetched.
  `classifyString` treated anything it could not classify as a relative URL, so `src="report"` sent a
  request to `/report` on your own origin and handed whatever answered — usually `index.html` — to a
  PDF parser. Bare words and backslash paths are now refused; paths with a slash or a `.pdf`
  extension still resolve as before. **This is a behaviour change for consumers**, and the case it
  closes is the reason it ships anyway.
- **`enableXfa` is now passed, defaulting to true** (pdf.js's own viewer default). A dynamic XFA has
  no page content of its own, so `false` means a blank document rather than a plain form. Note the
  limit honestly: no fixture here is a genuine XFA — pdf.js's parser rejects the hand-written packet
  `scripts/make-scripted-pdf.mjs` could embed — so composition is enabled and detected, **not**
  verified to render.
- **The size gate is a ratchet, not a ceiling.** `npm run size` now compares each path against the
  baseline committed in `size-baseline.json` and fails on growth beyond 2 % (+256 B of slack for
  minifier jitter); `npm run size:update` accepts new numbers, which puts the growth in the same diff
  as the code that caused it. The 45 kB ceiling from `0.1`–`0.2` was crossed by this release, and
  raising it to 48 was the smaller fix — the ceiling was replaced because a number every feature
  release has to renegotiate is not a requirement. The per-tier targets (core ≤ 8 kB, feature ≤ 4 kB)
  stay, and `0.4` is what makes them measurable.

Measured: shell 42.88 → **45.45 kB** gz, headless 23.35 → **25.60 kB** gz, both now baselines.
**199 unit tests** (37 new: `canvas.test.ts` 15, `assets.test.ts` 8, plus the source-classification,
allowlist and worker-ownership cases). Verified in a browser, each with its counterfactual:

- **Canvas capping** at 400 % zoom on a 1536×816 / dpr 1.25 display: the uncapped request was
  12,117,600 device px against a 5,875,200 budget, the buffer came out 2130×2757 for a 2448×3168 CSS
  page — the predicted 0.8704 factor exactly — and the ink-density oracle under 20 text spans read
  0.221 mean with none blank, so a capped page paints and its overlays stay aligned. At 104 % the
  buffer equals CSS × dpr, so the uncapped path is untouched.
- **`assetUrl`** on a new CID fixture (`cjk-sample.pdf`, a Type0/UniGB-UCS2-H font with no embedded
  glyphs, so nothing decodes until `cmaps/UniGB-UCS2-H.bcmap` is fetched): the CDN default and a
  self-hosted root served by a dev-only middleware both produced the same two text spans
  (`你好世界`, `阅读器`), with the cMap answering as 43,366 bytes of `application/octet-stream`. Pointing
  `assetUrl` at a root that is not there produced zero spans and
  `loadFont - translateFont failed: FormatError: unexpected EOF in bcmap` — which is also how the
  probe design died: a catch-all dev server answers a missing file with 200 + `index.html`, so a
  wrong root surfaces as a decode error, not a 404. The middleware's traversal probes
  (`%2e%2e`, `..`, `cmaps/..`) all fell through to the SPA fallback rather than leaking a file.
- **`allowedSources`**: a foreign URL refused with *"Refused to load …: it is not listed in
  allowedSources"* and zero page slots, while a `/fixtures/` URL loaded under the same policy.
  Separately, `src="nonsense"` now throws `Unrecognized PDF source` with **no network request at
  all**, where `0.2` fetched `/nonsense` against the page origin.
- **Trusted Types**, on a harness page carrying `require-trusted-types-for 'script'` and a recorder
  wrapped around the `Worker` constructor. Without a policy: one construction, `ctor: 'String'`,
  rejected with *"This document requires 'TrustedScriptURL' assignment"* — and the viewer still
  rendered 356 text spans on the main thread, which is the silent failure this feature exists to
  remove. With `configureTrustedTypes('pdfjs-react-reader')` before the first load: every
  construction was a `TrustedScriptURL`, zero string attempts, same 356 spans, so the worker
  survives. An unlisted policy name throws (`Policy "probe" disallowed`), confirming why nothing here
  can pick one. Three document switches under the policy left 7 workers constructed / 6 terminated,
  so the per-load dispose reclaims each one.
- **`capabilities`** across four fixtures: `form=mixed, hasJSActions=true` for the new scripted one
  (AcroForm + document/page/field JavaScript), `form=acroform, hasJSActions=false` for the form
  fixture, `form=none` for the CJK and outline ones. `renderedFromXfa` read `false` everywhere,
  including the fixture carrying an XFA packet — pdf.js's parser wants a real template — so this
  release proves *detection* and makes composition possible, not that a dynamic XFA renders.


## [0.2.0] — 2026-09-25

The shell's control surface: strings you can translate, a ref you can drive it with, events that
report what the user did, and the gestures a reader expects from a PDF viewer.

### Added

- **`labels` prop.** Every user-visible string in the shell — roughly ninety across the toolbar,
  search box, sidebar, outline, thumbnails, page canvases, drop overlay and password prompt — now
  resolves through a typed catalog (`PdfViewerLabels`, `DEFAULT_LABELS`, `formatLabel`, all
  exported). Overrides are partial and merged per key, so a catalog that translates eleven strings
  leaves the other seventy-nine at their English default. Strings with values use `{name}` slots
  rather than functions, so a locale catalog shipped in `0.8` can be plain JSON with nothing executed
  to read it. An unfilled slot stays visible as `{page}` rather than collapsing to an empty label,
  which makes a mistranslated catalog obvious instead of silently blanking a control. Subcomponents
  read the catalog from context, so `Toolbar`, `SearchBox`, `Sidebar`, `OutlineView`, `PdfPage`,
  `PdfThumbnail` and `PasswordPrompt` each stay usable standalone.
- **`PdfViewerHandle`, via `ref`.** `PdfViewer` is now a `forwardRef` component exposing `goToPage`,
  `zoomTo`, `zoomBy`, `fitTo`, `setLayout`, `rotate`, `rotatePage`, `openSidebar`, `toggleFullscreen`
  and `search`. Every member reads through a ref, so a handle captured on mount never closes over a
  stale page number or zoom.
- **Change events.** `onPageChange`, `onScaleChange`, `onLayoutChange`, `onFullscreenChange` and
  `onExternalLink`. They describe user actions: none of them fires during load, so a fit mode
  resolving to 87 % on first paint does not announce itself as a change. With `onExternalLink` set,
  the viewer prevents the navigation and hands the URL over rather than deciding for the host.
- **Gestures.** Ctrl/Cmd + wheel zoom — which is also how a browser reports a trackpad pinch — and
  two-finger pinch through the engine's `TouchManager`. Keyboard paging on `↓ ↑ PageUp PageDown
  Home End`, `F` for fullscreen, `Ctrl/Cmd+F` for search; `←`/`→` are deliberately left alone so a
  zoomed-wide row stays scrollable, and every one of them steps aside for a focused field, including
  the real `<input>` elements an AcroForm text box renders as.
- **Fullscreen** on the viewer root, with the webkit spellings covered and the control hidden where
  the platform has no element fullscreen (iPhone, iPad Safari). State follows
  `fullscreenchange`, not our own request, so Escape leaves the toolbar honest.
- **Any zoom percentage**, not just the sixteen presets: a percentage box beside the zoom select
  accepts `150`, `150%` or ` 150 % `, clamps to 25–500 %, and returns the box to the value on screen
  when the edit is unparseable rather than snapping the zoom somewhere.
- **Per-page rotation.** `rotatePage(page, degrees)` and `defaultPageRotations`, keyed by 0-based
  index, alongside the existing document rotation. The virtualizer, thumbnails and each page's
  viewport compose the two, so a single landscape scan in a portrait document no longer forces the
  whole document to turn.
- **Drag and drop**, off by default: `enableDrop` opens the dropped file in place of `src`,
  `acceptDrop` gates it, `onDropFile` fires either way, and a later change to `src` wins back.

### Fixed

- **Rotating a page left its text layer and annotation layer behind.** Present since rotation first
  shipped in 0.1.0 and visible with any rotation, global or per page: pdf.js renders the canvas
  through a rotated viewport but lays both overlay layers out in *unrotated* page space, recording
  the angle only in a `data-main-rotation` attribute that its own viewer CSS consumes. We ship no
  such rule, so after a 90° turn the layer kept its portrait box inside a landscape page and every
  selectable span, form widget and link sat on blank paper. Measured by sampling canvas ink density
  under each span's rect: 0 % on a rotated page before, 18–22 % after — the same range as an
  unrotated page. The layers now carry the three rotation rules their engine expects.
- **Changing `src` did nothing.** `usePdfDocument` tracks the source through a ref and reloads only
  on `reload()`, which keeps an inline `{ data }` object from restarting the load on every parent
  render — but it also meant the shell ignored a new document, so the drop-to-open feature could not
  work. The shell now asks for the reload itself when the source identity changes.
- **Every change event fired once on mount under React StrictMode**, which runs effects twice and
  left a "primed" flag set on the first pass. The suppression now compares against the value seen at
  first render, which survives the double invocation.
- **A successful webkit fullscreen rejected its own promise.** `webkitRequestFullscreen` returns
  nothing, and the old code read that as "unsupported" after already firing the request. Existence of
  the method is now the test. `clampScale(Infinity)` also returns 500 % rather than 25 %.
- **The search counter's colour depended on an English string.** `SearchBox` chose its
  empty-versus-error styling by comparing the rendered text against `'No results'`, so translating
  that string would have quietly mis-styled the empty state. It now derives a state name once.

Measured: shell 38.63 → 42.88 kB gz against the 45 kB budget, headless 22.75 → 23.35 kB gz — the
labels catalog, the new controls and the gesture code are all shell-side, and the headless entry pays
for none of them. 162 unit tests (48 new, over `zoom`, `keyboard` and `fullscreen`). Verified in a
browser: the ten handle methods, each change event with no mount-time noise, a partial German catalog
with no raw placeholder or `undefined` reaching the DOM, text-layer alignment at 90/180/270 global
and per page, Ctrl+wheel zoom with plain wheel left scrolling, a two-finger pinch, `End`/`Home`/
arrows with modified chords and AcroForm fields ignored, drop-to-open with a non-PDF rejected, and
external-link interception. Fullscreen requests the right element from a trusted gesture but does not
complete in the automated browser, so its visual state is unverified here.


## [0.1.2] — 2026-09-24

### Changed

- **The `pdfjs-dist` peer range is now `^5.0.0 || ^6.2.108`.** This is a security-driven widening,
  not a routine major bump. CVE-2026-16633 (`GHSA-hq66-cqwq-w95j`, high — arbitrary JavaScript
  execution when opening a malicious PDF) covers `>= 5.6.83, < 6.2.108`, and **no 5.x release fixes
  it**. The previous `^5.0.0` therefore did more than permit a vulnerable engine: it *excluded* every
  patched one, so a consumer following our own docs could not install a fixed `pdfjs-dist` without a
  peer-resolution error. The floor is deliberately `6.2.108` rather than `6.0.0`, because 6.0.x and
  6.1.x are inside the vulnerable band too. `pdfjs-dist` v5 remains supported and nothing existing
  breaks.

### Fixed

- **A cancelled document load threw on pdfjs-dist 6.x.** `usePdfDocument` released a load that had
  been superseded by calling `PDFDocumentProxy.destroy()`, which 6.x removed. It now destroys the
  loading task instead — present in both majors, and the more correct call for an aborted load
  because it also abandons the in-flight request rather than only the resolved document.

Tested against `pdfjs-dist` 6.3.289 in a browser: page and text-layer rendering, all nine AcroForm
widget types, form editing through `annotationStorage`, search with match marking, thumbnail and
outline sidebar including destination navigation, ink strokes through `convertToPdfPoint`, and the
encrypted-document password prompt for both wrong and correct passwords. Console clean throughout.

## [0.1.1] — 2026-09-24

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
  change announced at the top of its entry here. `0.4.0` spent that allowance: `enablePrint`,
  `enableDownload` and `renderForms` became opt-in features (`PRD.md` FR-21), because a prop cannot
  remove code from a bundle while an import can. No further breaking release is planned before `1.0.0`.
- Size is governed by a **ratchet, not a ceiling**: `scripts/check-size.mjs` measures every consumer
  path gzipped and fails the build on more than 2 % growth above the baseline committed in
  `size-baseline.json`; accepting a growth is `npm run size:update`, which puts the new number in the
  same diff as the code that caused it. What is asserted *besides* the ratchet is the tier boundary:
  each built-in feature must cost **≤ 4 kB** gzipped over the core bundle, and each feature's marker
  string must be absent from the core bundle and present in its own, measured through both esbuild and
  Rollup, so a shell that re-imports a feature fails the build rather than quietly shipping
  (`PRD.md` FR-23). There is **no absolute core ceiling**: the 8 kB figure carried in the PRD since
  drafting described a prototype shell, and the real one measured 20.61 kB at `0.4.0`, which is a
  number to ratchet against, not to renegotiate every release.
- The `docs/` site documents the latest release; older API shapes are described by the matching git
  tag rather than maintained as separate sites.

## How to pick a version

1. Install `pdfjs-dist` 6.2.108 or later — that is the whole peer range as of `0.6`. Older majors are
   not an option: 6.0.x, 6.1.x and every 5.x release carry CVE-2026-16633 (arbitrary JavaScript
   execution on opening a malicious PDF) with no fix inside the line, and `0.6`'s editor layer cannot be
   configured on 5.0.x at all because pdf.js passes the manager's arguments positionally.
2. React 18 or 19 both work; nothing else is required at runtime.
3. Pin an exact version in an application (`pdfjs-react-reader` `0.5.0`, not `^0.5.0`) until 1.0.0,
   because 0.x minor releases may include breaking changes.
