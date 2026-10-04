# Changelog

All notable changes to `pdfjs-react-reader` are documented in this file.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project adheres
to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

`0.12` Prove (FR-41, FR-48–FR-51) is in progress. All five are built, and the evidence a clean runner gives
has now been produced by several of them. The last run of the current workflow — 37202564139, `dev` at
`e3efb87`, 2026-10-04 — is green on `packaging` (Node 22.13.0, 22 and 24, `check:packaging` and
`check:tarball` in each cell), `consumer` (both engine ends), `react` (18 and 19, minimum and latest patch),
`docs`, and on `browser`, which started real engines on a runner for the first time and returned **67 ok / 5
skipped / 0 failed / 0 not runnable** — the same tally the local run reports, from the same thirteen checks.
`verify` is red in all three cells at exactly one step, `Bundle size budget`, which is owner decision **#208**;
the two gates added beside it (#215's follow-on) run green ahead of that step, and #218 moved `Pack` and
`check:examples` in front of it too, so a still-undecided byte budget cannot hide a contract check — that
reorder has not run on a runner yet, which is why FR-52's examples clause keeps its gap. What is left open is
not reachable from this machine: §8's pinned browser floors, the engine axis inside a browser at both range
ends, Edge, hardware, and the assistive-technology pairings. The register stands at **27 met, 30 partial, 1
absent** of 58, on a suite of **1,030 tests in 109 files** — eighteen rows moved when a clause-by-clause read of
`PRD.md` against the tests found guards asserting less than the sentences they were cited for, which is *Changed*
below and is the honest number rather than the comfortable one. One of the eighteen, `FR-06`, has since been
closed in the code rather than in the register (#219), and it went back to `met` on a guard that counts layer
constructions and holds the reader's focus across the step.

### Added

- **The export map now has to be reachable from the source layout, not just from a build.** CI's first real
  run failed all seven `typecheck` cells (three `verify`, four `react`) and all six browser cells at once, on
  one cause: `tsconfig.json#paths` mapped the root, `/headless`, `/features/*` and the stylesheets but not
  `/edit`, `/merge` or `/locales/*`, and `playground/vite.config.ts` aliased every entry except `/merge`.
  Locally those specifiers resolved anyway — TypeScript and Vite both honour a package's self-reference
  through its own `name` and `exports`, and a `dist/` from an earlier build was sitting there to be found — so
  the local gate had been measuring the artifact while the runner measured the source. `src/lib/entry-parity.test.ts`
  is the rule now: every key of `package.json#exports` must match a `paths` entry whose target file exists, and
  each of the two apps must alias every documented entry its own sources import, with the playground's aliases
  followed through to a real file. Four counterfactuals, each restoring its file by checksum: a deleted `paths`
  entry (and the same tree then failing `tsc` with the CI error, `dist/` removed), a deleted playground alias,
  an alias pointed at a renamed file, and the docs site losing `/edit`. (FR-52; #214)
- **The Node floor stopped being a sentence and became a checked value.** `engines.node` is `>=22.13.0`, which
  is what `PRD.md` §8's two Node rows have said since the lock: the peer's own `engines` begins at `22.13.0`
  (`6.2.108`, `6.3.289` and `6.4.299` all declare `>=22.13.0 || >=24` — read from the registry, not recalled),
  and `require(esm)` — without which a CommonJS host cannot load an ESM-only peer at all — became unflagged at
  `22.12.0`. What made this a requirement rather than a number was that three places used to state it
  independently and two of them were wrong: `package.json` said `>=20`, the `verify` and `packaging` matrices
  tested Node 20, and `scripts/tarball-check.mjs` recorded `ERR_REQUIRE_ESM` as a *tolerable* outcome, which is
  "we promise `require()`" spelled as "we hope the runner is new enough". Now the floor is read out of §8 by
  `npm run check:packaging`, which requires both Node rows to agree with each other, requires `engines.node` to
  equal them, requires the installed engine's own floor not to sit above ours, and walks every `node-version`
  pin and matrix entry in both workflow files for anything below it. The matrices are `22.13.0 / 22 / 24` — the
  floor, the LTS, the next major — the old patch that predates `require(esm)` is gone because the contract
  excludes it, and `ERR_REQUIRE_ESM` fails the run. Each of those four rules was fed its own counterfactual (a
  manifest floor of `99.0.0`, a CI pin at `20.9.0`, a table edited to `22.14.0`, a published subpath pointing at
  a file that does not exist), each fired with a message naming the place and the number, and each file came
  back by md5.
- **The two remaining peer axes are matrices rather than prose, and they were measured.** `react` runs
  majors **18 and 19 at both their minimum advertised patch and their latest** — `>=18.0.0 <20.0.0` promises the
  first page of every major, and a matrix of floating majors measures only the newest patch and leaves `18.0.0`,
  the version an old lockfile actually installs, unmeasured — and asserts that the `react` and `react-dom`
  majors it ended up with match, because an install that quietly resolves them apart leaves the job proving two
  trees at once. `consumer` runs **`6.2.108` and `6.4.299`**, the two ends of `^6.2.108` rather than a caret. All
  four React cells were then run locally: `typecheck`, `test` (985 tests) and `build` pass on 18.0.0, 19.0.0,
  18.3.1 and 19.3.0 — and the first attempt at that measurement failed in every cell for a reason that was not
  React, which is its own finding and is in *Verified* below.
- **`PRD.md` §8's browser floors are now part of the harness's output.** `scripts/browser-matrix.mjs` parses the
  Chromium / Firefox / Safari minimums out of the table, compares each one against the version the launched
  engine reports, prints it as its own line in every engine×profile cell, counts it in a tally of its own, and
  **exits 2 if the table and the script disagree** — so a floor edited in the document without moving the harness
  stops the run instead of becoming a quiet sentence in a table. Setting Chromium's floor to 126 proved it
  (`FLOORS.chromium is 126 while §8's "Chrome / Chromium" row claims 125`), and the file came back by md5.
  Unknown flags, an unknown engine and an empty selection also exit 2 now, because `--engines=Cromium` running
  zero cells and exiting 0 is indistinguishable from a pass.

- **A removal now has a record, and the record is enforced.** `api-maturity.json` gained a `removed` ledger,
  because §5.5's promise that a public name leaves only in a major version is worth nothing if a deleted
  export simply disappears — a reader of the artifact cannot tell a withdrawn name from one that was never
  published, and neither could the build. Each of the fifteen names records the maturity tag it held, the
  version that drops it, the changelog section that announces it and what supersedes it, and
  `npm run check:maturity` fails if such a name is published again, if its tag is outside the four states, if
  the version it left in is not a major, or if the section it cites does not name it. The check's synthetic
  half grew from nine violations to thirteen to carry them, and one of the new rules met a real artifact
  before any fixture did: run against the stale pre-removal `dist/`, the check reported thirty problems,
  fifteen of them "recorded as removed and is still published". Two more assertions came out of the same row:
  `check:packaging` now
  requires `sideEffects` to exempt CSS and forbid JavaScript (FR-22's asymmetry, stated in the manifest but
  never tested, in either direction), and `check:size` computes core-sheet purity — every `.pjsr-*` class that
  only a feature's own source renders must be absent from the built `styles.css`, which is 29 classes today and
  was proved by feeding the gate a `.pjsr-annotate-swatch` rule it then refused. The published surface goes
  from 335 names to 320 and the label catalog from 147 keys to 136, both counts pinned by tests that name the
  requirement.

- **`npm run check:examples`, which is §5.6 and was the last part of FR-52 with no mechanism at all.**
  It runs `npm pack`, extracts the tarball into a throwaway project's `node_modules`, and type-checks
  every fenced `tsx`/`ts` block in `PRD.md` and `README.md`, plus the docs site's five live examples, with
  **no `paths` mapping** — because `tsconfig.json` maps `pdfjs-react-reader` onto `src/` here, which means
  every other check in the repository resolves the package the way no consumer does. Two things fall out of
  that construction rather than being asserted separately: a name that is not exported cannot resolve, and
  neither can a subpath the export map does not publish. The archive is read in-process, not with shell
  `tar`, because the `tar` a spawned shell finds on Windows is GNU tar and it reads `C:/…` as a remote
  filename. **16 examples compile.** Six of them did not on the first run, and the reasons were all real:
  one README block imported `PdfPage` from `/headless`, which exports no components, and five were a line of
  JSX with no imports — now components rather than exemptions, because §5.6 allows exactly one kind of
  exemption and this check prints it, with the file, the line and the requirement each skip waits on.
  A second printed skip is the React 18 type contract: one `@types/react` is installed per checkout, so the
  pass runs against the one it has and says which major it could not reach; the CI `react` job has both.
  The check runs inside `npm run verify` and as its own CI step, and its two failure modes were verified by
  perturbing an example — an unpublished name and an unpublished subpath, each restored by hash afterwards.
  It also classifies the export map: 25 keys into the eight groups §4.10 lists, with a wildcard key, a
  `./types` entry, an unclassifiable key and any target outside `dist/` all failing `check:packaging`.

- **§6.1's budget engine, which is what FR-57 was still asking for**: the effective canvas ceiling is
  now the minimum of four things — the package default for the detected class, the viewport working
  set, the platform ceiling the runtime can actually allocate, and the host's own number — computed by
  `resolveCanvasBudget`, which also says which of them won. The platform term is measured rather than
  assumed: `ensureCanvasCeiling` allocates upward until a painted pixel stops coming back, and caches
  the answer for the realm. That signal is the whole design, because an over-limit canvas in Chromium
  keeps the width it was given and hands back a live-looking 2D context — a null context would have
  been easy to detect and would have caught nothing. The search stops at the ceiling already in force
  (a bigger answer cannot change a minimum), it starts two frames after mount and allocates **one surface
  per frame** after that — measured in Chromium, a synchronous ladder of rungs pushed the page's first
  paint from ~270 ms to ~2 s, which is exactly the cost §6.1's "runs off the render path and never delays
  a first paint" is about — and when the answer is lower than what pages were painted under, the shell
  redraws them. `npm run probe:canvas` is the harness for all of it: it imports the module under test
  through the dev server, reads the frame every surface landed on, and fails the run if two share one, if
  the search starts before the page paints, or if a rung allocates above the ceiling in force. It printed
  3,072,000 px on a 1280×800 @1× page (that page's own working set, which is below the desktop default —
  so the probe confirmed the ceiling rather than raising it), 5,242,880 under an iPad user agent on a
  390×844 @3× screen, and ~80 ms for the shell's whole search.
  `MIN_RENDER_SCALE` is now published and enforced: the renderer lowers toward 0.25 and stops, and a
  page that cannot be represented at or above it is refused with `RESOURCE_LIMIT` carrying the page,
  its box and the budget — because a canvas that size paints blank while the text layer sits over it
  as though it had content, which is a worse page than no page.

- **§3.7's registration contract, which is what FR-21 and FR-56 were still asking for**: `PdfFeature`
  gained `dependsOn`, `stylesheets` and `cleanup`, and `orderFeatures` is the call that makes them rules.
  A duplicate feature id, a dependency that is not in the list and a dependency cycle each throw a
  `PdfError` coded `CONFIGURATION_ERROR` naming the feature and the problem, with the kind of problem in
  `details.problem`, and they throw *before any Runner mounts* — a duplicated feature is one whose
  published state belongs to neither copy, and that is discovered by losing annotations rather than by an
  error. The same call puts every dependency ahead of its dependents and leaves everything else in the
  order the host wrote, and the shell applies that one order wherever it breaks a tie: Runner
  initialisation, which feature has the last word on a page contribution, which equal-priority control
  survives the fold, which feature claims a chord. A list with no dependencies comes back as the same
  array, so no host that wrote none pays a re-render. Stylesheets are now read off the feature value,
  which is what §3.7 asks for and what lets an application see what registering a tier will pull into the
  page, and the built-ins' declarations are cross-checked against the package's export map, so a sheet
  that is named but not published, or needed but not named, fails the build. The layering rule the
  feature boundary has always relied on is now asserted in the test project rather than only measured in
  the bundle: no core, hook or shell module imports a tier, no tier imports the shell parts, and no tier
  imports another tier — a peer is named by its id and read through `usePdfFeaturePeer`.

- **`VirtualSlot.pages`, and the `VirtualSlotPage` type that describes it**: where each page of a row sits —
  `index`, `pageNumber`, `left`, `top`, `width`, `height`, in content pixels. The row keeps `indices`, `width`,
  `height` and `offsetTop` exactly as they were, so a host reading rows is unaffected; the new field is what a
  host needs to place pages as *siblings* of the row rather than as its children, which is the shape `FR-08`
  requires and the shell now uses. The measurement of 2026-09-29 settled the repaint half of that clause in a
  browser; the geometry needed to settle the identity half was not published until now.

- **`FR-41`: the package can be `require()`d.** `tsup` now emits `esm` **and** `cjs`, so every published
  path is four files — `x.js`, `x.cjs`, `x.d.ts`, `x.d.cts` — and the export map answers `import` and
  `require` separately with its own `types` in each, which is the part that silently rots: a map with one
  `types` and two formats resolves declarations for one of them and gives TypeScript `any` for the other,
  with no error anywhere. `main` moved to the CommonJS file, `module` stayed ESM, and `sideEffects` still
  exempts only CSS. Fifteen JS paths, all four files each, verified from a packed tarball.
- **Two checks, because an export map is easy to write wrong quietly.** `npm run check:packaging` is the
  last step of `npm run verify`: it reads the map, requires and imports every entry, and compares the
  **name lists**, so a format whose surface has drifted is caught as the second package it would have
  become. `npm run check:tarball` is the half no in-repo check can do — it packs, installs the tarball
  beside its real peers into a `type: "commonjs"` project, resolves every path both ways, and typechecks
  **one identical source file as `.mts` and as `.cts`** under `NodeNext`, where the extension alone decides
  which condition TypeScript asks for. Needs the network, so it is its own command and a CI step rather
  than a `verify` step. Measured here on node 24: 15/15 paths, names identical, both declaration modes
  resolve.
- **What the second format costs, which is not what you would guess.** The ESM output is a chunk graph
  shared between entries; the CommonJS output is one self-contained file per entry. The shell alone is
  therefore *cheaper* as CJS — **50.83 kB** against **56.79 kB**, because one gzip stream beats fifteen
  small ones — and the shell plus headless together is *dearer*: **75.31 kB** against **60.19 kB**, since
  nine chunk files are shared by the ESM pair and none by the CJS one. Both shipped CJS paths are now
  ratcheted by `npm run size`, because a format nobody measures is a format that can grow.
- **A `packaging` CI job on a Node matrix (`20.9`, `20`, `22`), because one boundary is Node's and not
  ours.** `pdfjs-dist` is an ESM-only peer with no `exports` map of its own, so a `require()` that reaches
  it loads only on a Node new enough to require ESM — a fact about Node's release history that this
  repository would rather measure than quote. The check prints
  `require-esm-support=yes|partial (n/15 on node X)` and passes either way on that boundary; the matrix is
  what turns it into a sentence the docs can carry. **That sentence is not written yet**, because the job
  has never run: `0.12`'s whole theme is CI, and per the shipping rule nothing is pushed until `1.0.0`.
- **`FR-48`: `npm run test:browsers` puts the compatibility table in a browser.** Every other check here
  asks a DOM question of jsdom, and jsdom is one engine that rasterises no canvas, knows no
  `devicePixelRatio`, dispatches no touch, ignores `forced-colors` and arbitrates no wheel — which is
  everything `PRD.md` §8 actually claims. The script serves the playground from source, points it at the
  fixtures and the engine's own support files rather than a CDN, and drives thirteen claims through Chromium,
  Firefox and WebKit at 1280×900 and a 375×812 dpr-2 mobile profile. A page is *painted* when the non-white
  pixel fraction over the whole canvas says so — **1.07 %** on a text page at desktop, **1.29 %** at 375 —
  and its backing store follows the device: **1214×1571** device px for 1214 css at dpr 1, **670×867** for
  335 at dpr 2. Double-click selects a word from the text layer. Search counts (`"1 of 20 · p1"` →
  `"2 of 20 · p2"`), paints marks, leaves one active, and says `"No results"` rather than nothing when a
  query misses. The 1,000-page fixture holds **2 mounted page slots** before the jump and 2 after it, over a
  1,162,682 px scroll height, and paints the last page. The bar folds into **12 rows** at 375 px and not at
  1280. Keyboard paging works from a focused control — and `ArrowRight` does **not** page, which is the
  documented exemption that keeps a wide row scrollable, so the refusal is measured beside the acceptance.
  A plain wheel scrolls and holds the scale at 1.98 where a ctrl+wheel takes it to 2.84. Forced colours
  turns the page slot's outline `solid 1px` and removes the shadow. Zero requests left the machine, and no
  uncaught error appeared in any cell.

- **`FR-54`: the error contract is a published interface, and `FR-37`'s two missing states are produced.**
  `PdfError` with §3.6's eighteen codes, plus `PdfErrorCode`, `PDF_ERROR_CODES`, `isPdfError`,
  `isCancellationCode` — reachable from the root entry and from `/headless`, five new names, all tagged
  experimental because 0.12 has never been published. Every failure path a host can see now runs through it:
  the load, a page render and each overlay layer it builds, text indexing, print, download, merge, the writer,
  source refusals, the feature and viewer context guards, and Trusted Types configuration. Three things worth
  saying plainly. (1) `isPdfError` tests the *shape* — a code from the list, beside a message — and not
  `instanceof` or the class name, because `abortError()` returns a `PdfError` that keeps `name: "AbortError"`:
  every cancellation filter in this package and in hosts reads that name, so renaming it would move cancelled
  renders into error handlers, and a guard keyed on the class name would call an abort a non-error. (2) The
  vocabulary is asserted against `PRD.md` itself, so a code added in the module and not the specification, or
  reworded in either, fails the test that names both sides. (3) `RENDER_CANCELLED` and `UNSUPPORTED_FEATURE`
  are produced by mapping the engine's own exceptions through `toPdfError`; a render *this* package cancels
  never becomes an error object at all, which is FR-04 working rather than a missing throw site. On the state
  side, `cancelled` is now what a host that aborts a load observes — the suite previously asserted that a
  stopped load landed on `destroyed`, a departure from §3.5 — and the page model gained the re-queue it names:
  `retryPage(page)` on the handle and `retryToken` on `PdfPage`, one counter per page, so a second retry of
  the same page is still a change.
- **§6's four benchmark profiles are four, and its report is a tracked file.** `scripts/make-vector-pdf.mjs`
  generates `vector-sample.pdf` for profile C — four A1 sheets, each a 24×14 grid of cells where every cell is
  a `q … re W n … Q` clip around 26 hatch lines, a decagon and four curves: 36,031 path tokens the generator
  wrote and **12,922 operators the engine reports** reading them back, in 0.51 MB of Flate. Profile D runs on a
  committed harness — 412×915 at dpr 3 with an Android user agent, so `isMobileCanvasEnvironment` binds the
  5.24 MP package default by itself, and 6× CPU throttling over CDP — and it reaches that ceiling by zooming to
  300 % through the toolbar's overflow menu, because on a phone that is the only place the zoom control is. The
  canvas came back at 2012×2604, which is the mobile ceiling to two decimal places, painted at **1.10× instead
  of 3×** and still showing 27.7 % ink: degraded, not dead. `playground/raw.html` is the engine-only half
  profile C asks for — the same page at the same box with none of the viewer in the way — and the pair is
  reported as a pair. The record itself is now `benchmarks/latest.json`, tracked: machine model, OS release,
  memory, Node, the Chromium version read from the live browser, engine version, the git revision, the run date,
  each fixture's byte count and sha256, and for every sampled number its sample count, p50, p95 and max, with
  p99 reported for the two sweeps that have 100+ samples and `null` for the five-sample cold pages.
  `src/lib/benchmark-record.test.ts` (6 tests, FR-49) fails on a missing field, a `"chromium"` with no version,
  a hash that no longer matches the bytes on disk, a p99 handed to five samples, a maximum below its own p95, a
  committed record containing a broken bar, or a profile that measured nothing and says nothing about it — and
  all nine of those perturbations were fed to it and fired. Two of the harness's own instruments were wrong
  before this: frame-gap percentiles were taken over the array in **time order** rather than sorted, which
  printed `p50 16.7 ms … max 16.6 ms` (a maximum below the median is the arithmetic announcing itself), and
  "cold page" waited for ink on *the first canvas in the DOM*, which during a jump is a page other than the one
  being waited for — so the wait returned at once and the timing measured the jump. Page-scoped, the number
  moved from a reported 100 ms to a measured **147 ms median in the committed run** (124–199 ms over five
  samples) — and 224 ms in an earlier run of the identical build on the identical machine an hour before it.
  Both are above §6's 100 ms bar, and the gap between the two is its own finding: a cold page on one laptop
  moves by half again between runs, which is precisely the thing §6 refuses to let a baseline promise.
- **A file carried by an annotation is listed and saved like one the catalog names** (FR-25).
  `collectAnnotationAttachments` walks the pages for `FileAttachment` annotations and `mergeAttachments` folds
  the two lists into one, deduped on filename with the name-tree entry winning and a missing description filled
  in from the other copy. This was found by measuring rather than by reading: on
  `attachments-ocg-sample.pdf` — a fixture this repository has had since `0.5` and wired into nothing —
  `getAttachments()` returns the three files the catalog names and not the note hanging off page 2, while the
  annotation's own `fileId` (`attachmentRef:23R`) reads back byte-exact through `getAttachmentContent()`. The
  list clause was therefore passing by accident on documents where the engine folds both kinds into one map.
  Four tests now run the product's real path against that file — listed, described, saved the same way, and
  **zero contents read to show four names** — and pin the premise at the byte level, asserting that
  `/EmbeddedFiles` does *not* name the carried file, because a future edit moving it into the tree would let all
  four keep passing while measuring one list twice. Because the walk is now per page rather than one call, the
  hook takes the `signal` FR-36 asks for and the walk stops with it. Cost: 0.06 kB of core.
- **Five requirements gained the assertion their rows described, and one gained the mechanism.**
  `PdfThumbnail.test.tsx` (8 tests, FR-11) covers the measured-width-times-dpr buffer, the 132 px card in the
  list's column arithmetic, the visible-range observers, the scroll that follows the current page, the
  cancellation that hands the buffer back and the accessible name. `PdfPage.textlayer.test.tsx` (4, FR-06)
  counts `build()` and `update()` on a recording layer and proves a zoom step re-lays-out rather than
  re-builds — one build, two updates, one text extraction, zero cancels, and the same `<span>` still in the
  DOM — after a measurement corrected the premise: the extra update straight after the build is pdf.js's own
  no-op, so the assertion counts from there rather than from zero. `PdfPage.rotation.test.tsx` (5) and
  `ViewerController.rotation.test.tsx` (3) hold FR-09's second half, which nothing had asserted: the text,
  annotation, editor, draw and XFA layers each re-render into the *same* element for the *same* page index with
  the same layer object handed to the editor, no layer appears twice, and the destroyed ones are the ones that
  were replaced. `usePdfSearch.yield.test.tsx` (4, FR-13) is the "one gained the mechanism": the bounded yield
  lived in `extractAllText`, which nothing in `src/` calls, so the path the shell indexes through had no timed
  yield at all. It now has one on the supplied-index branch — a worker read already yields by round-tripping, a
  supplied read is a microtask, and five hundred supplied pages is one unbroken block — and a rAF ticker counts
  a fresh frame on every fifth page. Sixteen perturbations across these five files each fired exactly on the
  test that owns the clause. `scripts/make-oversize-pdf.mjs` then closed FR-51's last computed row with
  `oversize-sample.pdf`: three boxes the engine reports as 612×792, 12,000×9,000 and 200,000×600 pt, which come
  out as uncapped, clamped by the *area* ceiling at 0.56×, and refused below the 0.25 minimum by the *side*
  ceiling — the distinction read off a file. The generator reads the three ceilings out of `src/lib/canvas.ts`
  and refuses to emit a page whose verdict has drifted from them, so a raised `MAX_RENDER_SIDE` stops the build
  of the fixture rather than quietly invalidating what it proves.

### Amended

Five requirements moved, on the owner's ruling of 2026-10-04, and each moved as the lock requires: the id is
unchanged, the whole requirement is restated, and the reason is written here to stay. Nothing in this list is a
requirement weakened to match the code — in every case the sentence was saying something the package does not do,
or cannot do on the engine we advertise, and one of them (`FR-47`) gained a promise instead of losing one.

- **`FR-31` True Flattening** now flattens *supported widgets and supported signature appearances*, says plainly
  that markup annotations — highlight, text markup, ink, free-text — are carried through as annotations rather
  than converted, and keeps the missing-appearance repair. **Reason:** the writer's `PDFForm.flatten()` walks
  `getFields()` and nothing else — for each field it takes `acroField.getWidgets()`, calls
  `flattenWidgetOntoPage(page, widget, appearanceRef)` per widget, then `removeField(field)`, and finishes with
  `flattenOrphanWidgets()` for widgets that carry `/FT` but are missing from `/Fields`
  (`@cantoo/pdf-lib/cjs/api/form/PDFForm.js:635-657`). A highlight or an ink is not a widget, so a flatten never
  sees one; whether it becomes page content is a question about content-stream surgery, which §2.5 already puts
  out of scope, and a flatten that fakes an appearance it cannot reproduce is worse than one that leaves the
  annotation alone. The appearance-repair half is real and stays: `flatten({ updateFieldAppearances: true })` is
  the default, and the field classes are where an absent `/N` stream is decided
  (`PDFTextField.js:669` `widget.getAppearances()?.normal instanceof PDFStream`). The old sentence — "turn
  widgets and marks into page content" — promised a conversion the package does not perform.
- **`FR-47` Touch & Gesture Handling** keeps its arbitration and adds one named exception: a freehand stroke,
  ink or the signing pad, is a pointer act with no key-by-key equivalent, and where the package offers such a
  control it says so on the control. **Reason:** "every gesture has a keyboard or control equivalent" is true of
  pinch, drag-to-scroll and tap, and false of a drawn mark by construction — the ink editor's path is the
  pointer's coordinates. The alternative reading of the old clause was to accept a typed-name signature as the
  "equivalent", which is a different feature the owner has ruled out, so the exception is stated instead of
  being worked around. This is the one amendment that adds a duty: the control has to disclose the absence.
- **`FR-39` Incremental, Viewport-Prioritised Indexing** now says invalidation is per page and *offered to the
  host*, that replacing the document discards the index rather than patching it, and — explicitly — that text
  held in annotation storage is not part of the index and nothing here promises it will become searchable.
  §6.2's search paragraph was restated to match. **Reason:** extraction reads the page's content stream
  (`getTextContent`), while forms, annotations and ink live in `annotationStorage` until they are saved, so the
  clause as written asked for an answer the extraction path cannot give; and the invalidation surface the
  package actually has is the host-facing per-page one (`usePdfSearch.invalidatePages`,
  `src/headless/usePdfSearch.ts:130`), not a private re-index after an edit the package did not make.
  Task **#206** asked the owner to choose between restating and withdrawing the clause; this is the restatement.
- **§2.1's accessibility principle and §6.2's cross-cutting rule** now make basic accessibility — WCAG 2.2 AA,
  keyboard completeness, forced-colours correctness, page-change announcement — mandatory in the core, and put
  the *tagged-document structure integration* (`FR-43`) in the opt-in tier column. **Reason:** the two rules
  contradicted each other as written. §3.1 forbids the shell from importing a feature and §4.7 prices a
  display-only application, while the structure tree is reached through the engine's own
  `StructTreeLayerBuilder`, which is a per-document capability like print or forms. The integration already
  ships that way (`src/features/structure.tsx`, `structureFeature`, measured at 0.37 kB over core when it
  landed); the document now says so, and nothing a reader relies on for access is opt-in.
- **§3.1's layer rule** is now four sentences a check can decide — the core engine glue imports no React at
  runtime, a headless hook renders nothing and touches no DOM at module scope, the shell imports no feature, and
  every documented entry point imports safely where there is no DOM (`FR-46`) — with one carve-out: an operation
  that is browser-only by nature may use the DOM *when invoked*. **Reason:** "the hooks contain no DOM" could
  not be true as stated and was never what the code claimed. `usePdfPrint` reaches the live document — it builds
  a container, appends it to `document.body` and calls `window.print()`
  (`src/headless/usePdfPrint.ts:141,182,242`) — and no server may import it *as a module* and be broken by
  that. The decidable property is therefore about load, not about invocation, which is what
  `src/lib/ssr.test.ts` holds and what a client boundary depends on. A reader of the old sentence could not
  tell a violated rule from a loosely written one.

### Changed

- **A zoom step now repositions the annotation and editor layers instead of rebuilding them (#219, FR-06's
  second sentence).** Both build effects listed `viewport` among their dependencies, so every scale change ran
  their teardown — `container.replaceChildren()` at `src/components/PdfPage.tsx:774`, `layer.destroy();
  drawLayer.destroy()` at `:940-942` — and constructed a fresh `AnnotationLayer` and `AnnotationEditorLayer`.
  That was not only the worker round trip and the element build; it was the reader's place in the page. The
  widget that held the focus lost it, a mark mid-drag lost its layer, and the `change`/`input` listeners the
  page attaches beside the container were left pointing at a div whose children had been replaced. The engine's
  own builders are the authority here, not a preference for less work: `AnnotationLayerBuilder.render`
  (`web/pdf_viewer.mjs:1861-1870`) calls `annotationLayer.update({ viewport, optionalContentConfig })` whenever
  it already has a div and constructs only when it does not, and the editor-layer builder does the same at
  `:4299-4305`; the reason that is enough is that `AnnotationElement` places every widget in percentages of the
  page box (`style.left = 100 * (x - pageX) / pageWidth`, in `build/pdf.mjs`), which is the one piece of
  arithmetic a scale change cannot invalidate. So `viewport` left both dependency lists, `rotation` stayed —
  `update()` re-sizes the box and does not re-orient a percent-placed element, which is also why the text layer
  has always rebuilt on rotation — and one effect after both builds now hands the new viewport to both layers.
  `optionalContentConfig` is not passed, deliberately: `updateOC` returns early without it
  (`pdf.mjs:17831-17836`), so a group the reader switched keeps the state it was last told about rather than
  silently re-showing what is hidden. `src/components/PdfPage.overlay.test.tsx` is the guard, and it asserts
  five things the counts alone cannot: one construction and one annotation read across three zoom steps, the
  `update()` list carrying each new box, the *same element* still in the document, `document.activeElement`
  still the widget, and the page's own form listener still firing. **Four counterfactuals, each restoring the
  source by checksum:** the dependency array keyed on `viewport` again gives `the zoom rebuilt the annotation
  layer: expected 3 to have a length of 1` and `the zoom step moved the reader out of the field: expected
  <body>… to be <input>`; removing the `update()` call empties four update lists; removing the teardown's
  `destroy()` fails the rotation case; leaving the editor layer out of the step fails its own count. Measured
  in chromium on `annotated-sample.pdf`, eight steps through the toolbar's zoom field, with one probe run
  against HEAD's source and one against this: **48 elements added and 48 removed per sequence becomes 0 and 0**,
  and 683 ms becomes 637 ms — the element count is the machine-independent number, the wall figure is one
  sample on this machine and is written down as that. Costs 0.06 kB gz on the shell (64.81 → 64.87) and 0.05 kB
  on core, with `headless` unchanged, measured by rebuilding and re-running `npm run size` on both sources.
  The register row this closes is `FR-06`, which #217 had moved to `partial` for exactly this reason, and it
  went back to `met` on the guard rather than on the code. Two defects the guard found on the way, both fixed
  in the source rather than in the test: the annotation layer was never `destroy()`ed when its page rotated or
  scrolled out — only its container was emptied, so the instance and the editable-annotation table the editor
  layer reads stayed alive behind a page that had moved on, while the engine's own
  `AnnotationLayerBuilder.cancel` does call it — and the editor layer now rebuilds together with it on a
  programmatic form write, because `layer.enable()` asks that linked annotation layer which elements an editor
  may take over, and a released one answers with nothing.
- **The browser matrix has a fourteenth check, and its first run found a race in the check (#219).**
  `zoom-updates-the-layers-in-place` reads the same clause off a real engine rather than off a stub: it watches
  the annotation and editor layers with a `MutationObserver`, drives the toolbar's zoom field through 150 / 200 /
  250 / 300 %, and fails on any element taken out or put in. Against HEAD's source it reports
  `4 zoom steps replaced 24 overlay elements and added 24`; against this one,
  `4 steps 2.84 → 3, 18 overlay elements in place throughout, 0 added / 0 removed` — and it is the only row that
  moved, twelve others staying green in the same cell, which is the shape a counterfactual should have. The first
  draft failed on *this* side twice, for two reasons that are both worth keeping. It counted
  `document.querySelectorAll('.pjsr-annotation-layer *')`, so the second page that 300 % legitimately mounted was
  read as the first page's layer growing (18 before, 26 after); the assertion now follows the node references it
  armed, and waits for each requested scale in turn rather than for “any change from the starting one”, which
  after the first step is true forever and would have timed the sequence as stillness. And on Firefox both cells
  *skipped* it, because `load()` waits for the document label and the painted canvas — not for the overlay — so
  arming watched a layer that had not been filled yet. The engine had done nothing wrong; the harness had read
  its own timing, which is the same trap the benchmark hit when it asked “is this page painted” of whichever
  canvas was first in the DOM. It now waits up to 10 s for the layer to carry an element and only treats a layer
  that stays empty as an engine finding; both Firefox cells report ok beside Chromium's two, with WebKit not
  installed on this host (§8's floor rows for it stay the CI job's to prove).
- **`Pack` and `check:examples` moved ahead of the bundle-size budget (#218).** The Verify job runs its steps
  explicitly and carries no `continue-on-error`, so a failing step skips every step behind it — and since
  #215's follow-on put the maturity and register gates before `Bundle size budget`, the two left behind it were
  still unreachable while owner decision **#208** stays open. That ordering made FR-52's own gap
  self-referential: its clause is that the documented examples compile against the packed artifact, the check
  that proves it has never executed on a runner, and the reason it has not was a step that reports bytes. Both
  moved steps read only files that exist before the budget runs — `Pack` needs the manifest and the file list,
  `check:examples` builds the tarball itself — so the reorder costs no time. What it buys was shown by feeding
  the job its own defect: a manifest whose `files` list omits a published subpath is caught by `Pack`, and with
  the budget in front of it the run reports nothing about that omission, because the job had already stopped.
  The size step keeps its verdict — it still reddens the job, and #208 is still owed — it simply no longer blinds
  what follows it. (FR-52, FR-58)
- **Eighteen requirements stopped being reported as `met`, because their guards asserted less than their clauses**
  (#217). The register read 44 met / 13 partial / 1 absent. The re-read this pass was deliberately blind to the
  register: each row was graded from `PRD.md`'s sentence against `src/` and the test tree only, asking per
  clause "does the code do this, and is there an assertion that fails if it stops?". Eighteen rows failed the
  second half of that question, and the four the earlier pass had already flagged turned out to be the tip
  rather than the whole — the
  findings, each verified by grep over the whole test tree rather than by reading one file:
  `FR-05` nothing calls `reportPageDims` and asserts a measured slot, so "the scrollbar does not jump" is only
  asserted as arithmetic on hand-supplied sizes; `FR-06`'s in-place zoom is violated by the code, not just
  unasserted — the annotation layer's effect (`src/components/PdfPage.tsx:703-796`) and the editor layer's
  (`:944`) both take `viewport` in their dependency arrays and destroy-and-rebuild on every scale step, while
  only the text and structure layers update in place; `FR-08`'s fit-mode repaint half has no assertion at all
  (jsdom reports a 0×0 viewport, so the only evidence is a manual measurement from 2026-09-29); `FR-10`'s
  recursion is never exercised — `buildTree` (`src/headless/usePdfOutline.ts:22`) is called by no test, and
  `outline.test.ts` re-implements the walk with its own `resolveItem` before asking the engine to convert a
  point; `FR-14` scrolls the active match into view at `PdfPage.tsx:970-977` with no test driving it, the only
  `scrollIntoView` assertions in the tree belonging to the thumbnail strip and stubbed out in
  `ViewerParts.composed.test.tsx:49`; `FR-15`'s next/previous arithmetic at `usePdfSearch.ts:485` is never
  called — `nextMatch`/`prevMatch` appear in tests only as `vi.fn()` stubs; `FR-16` asserts parsed field data,
  not one real HTML control, and `Sig` appears in no test file; `FR-17`'s published hook `usePdfFormValues` is
  imported by nothing under test; `FR-24`'s `setVisibility` and `usePdfOptionalContent` likewise, with both page
  tests passing `optionalContentConfig: null`, so the shared-instance promise is unchecked; `FR-26` has no test
  that hands the shell a host controller — the `PdfFindController` in `ViewerController.search.test.tsx:59` is
  the mock's own return value; `FR-28`'s three named refusable affordances are never refused: zero tests pass any
  `enable*` flag as `false`; `FR-29`'s `annotateFeature` is imported by two test files, one for its stylesheet
  list and one for a maturity string, and is never mounted, so manager disposal, the authoring round trip and
  survive-scroll-out are all unasserted; `FR-30`'s undo-of-the-last-apply (`undoApply`, `src/edit.tsx:439`)
  appears in no test; `FR-32` proves one mark into two boxes belonging to *different* fields, and the scan's
  progress state appears nowhere; `FR-36`'s thumbnail path wires two aborts (`PdfThumbnail.tsx:126,181`) that
  `PdfThumbnail.test.tsx` never mentions, and `usePdfPrint`'s signal is tested only for ceilings; `FR-37`'s
  `destroyed` is produced at `usePdfDocument.ts:489` and asserted only negatively, so deleting the branch would
  pass; `FR-54` publishes eighteen codes of which three (`PASSWORD_REQUIRED`, `WORKER_ERROR`, `WRITER_ERROR`) are
  produced by paths no test drives and two (`RENDER_CANCELLED`, `UNSUPPORTED_FEATURE`) are produced nowhere;
  `FR-55`'s `enableScripting: false` at `PdfPage.tsx:760` is asserted by nothing, and the allowlist is asserted
  at the library boundary only, never that the shell's option reaches the engine call.
  The register now reads **26 met / 31 partial / 1 absent**. Two rows the same pass questioned stayed `met` and
  the reason is recorded in their notes rather than argued here: `FR-13`'s yield is asserted on the hook path the
  shell actually uses, and `FR-27`'s ceiling, per-page counts and refusals all have their own assertions.
  **What this is a lesson about:** a `met` row satisfied the gate because the gate can check that a cited test
  *exists, is a test, and names the requirement* — it cannot check that the test asserts the sentence the row
  points at. Nineteen of these rows had a real guard file and a real `FR-NN` in its header; the assertion simply
  stopped at the first clause. The gate is unchanged (a machine should not have to read prose), which means the
  clause-by-clause re-read is the only thing that keeps this register honest, and it has to be repeated, not
  remembered. `ROADMAP.md`'s generated block was re-emitted from the new states.
- **`check:maturity` and `check:fr-evidence` are CI steps now, placed before the step that reddens the job.**
  Both ran only inside `npm run verify`, and no job in `.github/workflows/ci.yml` calls `verify` — so FR-50's
  promise that "a name that is exported and untagged fails the build" meant *this machine's* build, and the
  register that is the status of record had never been checked by a runner either. They sit after `Build` and
  **before** `Bundle size budget`, deliberately: the size gate is an open owner decision (#208) that stops the
  job at step five, and every step behind it — including the examples check, which is still unreached — is
  invisible while it stays undecided. A gate stacked behind an unresolved one is not a gate. Both new steps
  were fed their defect to prove they bite: dropping one name from `api-maturity.json` gives `FAIL
  AnnotateFeatureState is exported and untagged` and exit 1, and flipping one state word in the generated
  `ROADMAP.md` block gives `status block is stale` and exit 1; each file came back by checksum. Runner
  37202564139 then executed both steps green in all three Node cells — the maturity gate grading 320
  published names, the register gate reporting the register consistent with `PRD.md` and with the files on
  disk — which is the evidence FR-50 was missing: its clause is that an untagged export fails the build, and a
  build now means a runner's, so the row moves to `met`. Whether 57 experimental names is the right number to
  carry into `1.0.0` remains owner decision **#207**, which is about the baseline and not about the
  enforcement. (FR-50, FR-52,
  FR-58)
- **Three documents said CI had never run, and by 2026-10-04 that was no longer true.** `README.md`'s
  requirements table ("no `0.x` commit has been pushed, so no job has ever run"), its React row ("it has not
  run yet"), its browser-floor paragraph ("exists and has never executed") and the docs site's matching
  callout are now what actually happened: the `react` matrix is green in all four cells, the `browser` job is
  green with the same 67 ok / 5 skipped the local run reports, and the `consumer` job builds against both
  engine ends. What the runs still do **not** show kept its limits stated in the same sentences — one engine
  version inside a browser, Playwright's current builds rather than §8's pinned floors, no Edge, no hardware.
  (FR-48)
- **`check:fr-evidence` no longer depends on which machine ran it** (#215). The gate compared `ROADMAP.md`'s
  generated status block byte-for-byte against text joined with `\n`, while `--emit` wrote that LF block into a
  file whose prose was CRLF under `core.autocrlf=true`. So it was green on the machine that had just emitted
  it and exited 1 on any fresh checkout, where git hands back a wholly CRLF file — proved by cloning `15d0888`
  and running the gate there. The compare now normalises `\r\n` on both sides, `--emit` writes the block in
  whatever ending the file already uses (and through a function replacement, because a leading gap is
  somebody's prose and prose can carry `$&`), and the emitting file no longer ends up half one ending and
  half the other. Three self-test cases carry it: the same stale block written with CRLF still has to be
  caught, a CRLF checkout of an accurate block must produce nothing, and emitting into a CRLF file must leave
  it CRLF. Each was fed its own counterfactual — the byte-exact compare restored, and `--emit` forced to LF —
  and each turned the matching case red. Both conditions were then run for real: an all-LF working file and an
  all-CRLF one each pass, and the fixed gate passes inside a fresh clone, which is where it used to fail.
  Nothing in CI calls this check today, which is FR-50's open gap; that gap is now safe to close.
- **The composed parts read the viewer they sit in, which is the shape PRD §5.3 drew and could not
  compile** (FR-28). `ViewerRoot` takes a host `className` and `style` beside the frame classes the
  controller writes; `ViewerSidebar` takes `children`, and when it does the tab strip is not rendered,
  because a tab that selects nothing is a control that lies; `ThumbnailList` reads the document, the page
  count, the page on screen and the rotation from `useViewer()` and keeps only its starting width as a
  prop; `OutlineView` reads the bookmark tree from the outline tier's publication in that same store and
  follows a click's destination through the shell, so it takes nothing. **Breaking** for anyone who used
  them directly: `OutlineViewProps` and `ThumbnailListProps` are gone, and `Sidebar`'s `extraTabs` became
  `tabs` (omit it for a tab-less panel). Nothing published has ever carried those names to a consumer, but
  `0.1.2`'s root entry did export the components. `src/features/ids.ts` moved to
  `src/lib/feature-ids.ts` so a shell part can name a tier's publication without the shell importing from
  `src/features/` — which the boundary test now forbids with no exception left in it.

- **`renderPixels` and `maxRenderPixels` now constrain the renderer instead of replacing it** (FR-57). the renderer instead of replacing it** (FR-57).
  A host that passed a number larger than the platform or viewport ceiling used to get that number,
  which is the one outcome a safety budget cannot allow: the canvas comes back blank, not broken. What
  a host gets instead is `renderBudget` — the ceiling in force, which candidate set it, and what each
  of the others asked for — so the difference between a cap and a bug is readable without a debugger.
  A value below the ceiling behaves exactly as it did, and `0` keeps its pdf.js meaning of "render at
  CSS resolution".
- **A second viewer with a different worker URL now fails its load** (FR-02, FR-55). pdf.js holds
  `GlobalWorkerOptions.workerSrc` per realm, so two viewers with different worker code is not two
  configurations — the later load re-points the earlier one, and the page that pays for it is whichever
  scrolls in afterwards. The second viewer now reports `CONFIGURATION_ERROR` naming both origins, and
  the first keeps running. Two viewers that agree on the URL, or that configure nothing at all, are
  unaffected; a relative URL and its absolute spelling count as the same worker, because that is what
  pdf.js fetches.

- **The worker's "absent" state turned out to be two states** (FR-02). Measured on `pdfjs-dist@6.3`,
  `GlobalWorkerOptions.workerSrc` starts as `''` in a browser and `'./pdf.worker.mjs'` in Node, because the
  engine assigns it from its own `isNodeJS`. So `ensureWorker` probes in every browser realm and in no Node
  one — which is what README's "works in Vite, webpack and Rollup without a line of configuration" rests
  on, and the opposite of it had been written into this package's own comments. `worker.default.test.tsx`
  pins the Node row against the real engine (no probe, no write, and no detection-failure advice the package
  never earned), and `npm run probe:worker` pins the browser row in Chromium, failing the run if the engine
  ever stops starting empty. `scripts/browser-matrix.mjs` and the four `worker.fallback.*` files were
  already right about this; the comments are what changed.

- **`FR-33`: the refused XFA save now says why, in the API rather than in a sentence.** `download()` resolves
  `{ fileName, committed, refused }`, the hook publishes `refused`, and `onRefused` is there for a caller that
  does not await. A refusal is not a failure, so it never reaches `onError`; the file still arrives, because a
  reader whose edits cannot be kept should not also lose the document. The built-in control moves the reason
  into its own accessible name — the one place a reader looks at the moment the difference matters — and that
  string is in the catalog, so German, Spanish and French carry it too. What this replaces is a silent
  fallback: `saveEdits: true` on a pure-XFA document has always taken the loaded bytes instead of calling the
  `saveDocument()` that rejects, and nobody was ever told the file they were holding had no edits in it. Two
  clauses of the same row also gained the assertions they never had: a viewport change now provably *updates*
  the XFA layer rather than re-appending it (a re-append doubles the page and loses the focused field), and a
  search mark provably lands on the XFA tree rather than on the text layer a pure-XFA page never builds. Both
  were measured in a browser during `0.6`–`0.8` and recorded in comments; removing either mechanism now fails
  a test.

- **`FR-36`: an already-aborted signal performs no work, on the three paths that were still starting it.**
  Every effect in `PdfPage` opened with its work and asked about the signal afterwards, so a page mounted
  under a signal that had already fired still fetched its proxy from the worker, still allocated a canvas,
  still built a text layer — three costs paid for a page nobody will show; each of the seven now starts with
  one check, and the guard counts the `getPage` that does not happen. `usePdfDownload` read the signal between
  the byte await and the write, which produced no file but had already paid for the bytes, so the check moved
  to the top of the call — and the test that recorded the old boundary as “the honest limit” now asserts the
  clause instead. And the edit tier, the one place a write is long enough to want cancelling, called all four
  writer passes with no signal at all even though every one of them checks one: the panel now owns an
  `AbortController` for its mount, `createEditFeature({ signal })` gives a host the same lever, and a
  cancelled pass produces no document and no error report, because §3.6 says a cancellation is not a failure.
  Two limits stay as they were and are the clause’s own exceptions rather than gaps: a `getData` already in
  flight cannot be recalled, and a writer loop stops before its *next* page rather than undoing the one it
  changed. Signals are still not merged into one — each effect owns a cancellation of its own lifetime — but
  see the #203 entry below for why the *test* that policed that no longer exists.

- **`FR-10`: a bookmark click lands where the bookmark points.** `OutlineEntry` carries a `position` now — the
  `/XYZ`, `/FitH`, `/FitV` or `/FitR` values the destination actually held, plus the magnification — and the
  shell scrolls to it instead of to the top of the page. `parseDestinationPosition`, `resolveDestination`,
  `DestinationKind` and `PdfDestinationPosition` are published alongside it, and `OutlineView`’s `onSelectPage`
  gained a second argument, which a host already written can ignore. Three things had to be true for that to be
  a sentence worth writing. **The fixture changed first:** every destination in every fixture here read
  `/XYZ null null null`, which names a page and no place, so the clause could be implemented and tested against
  an array typed into a test without ever meeting a document that had one. **The offset is asked of the engine,
  not derived here** — `viewport.convertToViewportPoint` at the live scale with the page’s `/Rotate` and the
  reader’s rotation folded in — because the axis flip and the rotation are pdf.js’s business, and a viewer that
  guessed them would be wrong on a turned page. **And a destination that asks for a magnification changes the
  scale *before* it measures**, since its point is a distance down the page as displayed: the click parks the
  destination for one render, then scrolls. Measured in Chromium on the fixture at 100 %: “1. Introduction”
  (`/XYZ 72 660`) lands at 132 px — the subtitle line, 132 pt down a 792 pt page; “2. Sections” (`/Fit`) lands
  at page 2’s top; “3. Conclusion”, reached through the name tree with a 2× ask, takes 200 % and lands 344 px
  into page 3. The same resolver now backs an in-page link click too, which had been dropping the same half of
  the destination.

- **`FR-08`: a row is a box the shell paints, not a parent the pages live in.** Switching layout used to
  destroy pages. Rows were keyed by their first page, so the moment a page stopped being a row head — page 3 in
  the switch from continuous to spread — its row vanished, and a page inside a vanished row goes with it: React
  cannot move a mounted component between parents. The reader watched every other page fall back to blank and
  repaint on a change that moved nothing but a border, and anything held inside one (an open annotation popup,
  an armed editor, ink mid-stroke) went with it. Pages are now siblings of the row, keyed by page index, placed
  from `slot.pages`; the row keeps its white sheet, its shadow and its forced-colours outline, and the page
  boxes land where the flexbox used to put them. `ROADMAP`'s 2026-09-29 row proved the *pixels* survived a
  switch at a fixed zoom — that measurement is why the requirement was restated rather than dropped — but it
  did not count mounts, and a canvas can keep its pixels while the component that painted it is rebuilt. The two
  new test files count both, and their first versions passed against the broken code: jsdom's viewport shows
  two rows, and across two rows the continuous heads (1, 2) and the spread heads (1, 2) coincide. A guard for a
  clause about *regrouping* needs a window wide enough for the two groupings to disagree.

- **`FR-01`: two refusals that were clauses in the requirement and accidents in the code.** A source string
  is now refused when its scheme cannot name a document (`javascript:`, `vbscript:`, `about:`, `chrome://`,
  `chrome-extension://`, `view-source:` and their neighbours → `unsupported-scheme`), and when it is relative
  and there is no document base to resolve it against (`/files/a.pdf` in Node, a worker or a server render →
  `no-base-url`). Before this, `javascript:alert(1)` was refused only because it happens to contain no slash —
  the bare-word rule caught it — and `chrome://settings` classified as a url because a scheme with slashes
  looked like a path. Neither answer was a rule. The scheme list is deliberately a list of **refusals**, not
  an allowlist of every scheme: an allowlist would refuse `my-app://documents/a.pdf`, which a host's own
  desktop shell registers, and would need a release for each new document scheme. **This changes what a
  server render sees**: `normalizeSource('/files/a.pdf')` used to return that string for the engine to resolve
  against no origin at all, and now throws `INVALID_SOURCE` naming the missing base — which is the honest
  failure, and the reason the refusal carries its own reason code rather than arriving as a corrupt-document
  error four steps later. A refused scheme's message names the scheme and repeats nothing after the colon, so
  a `javascript:` payload does not reach a log line. Both rules are asserted as pairs: the same relative
  string classifies as `url` once a page exists.

- **`signFields` refuses a field that holds a signature value by failing the call.** It already refused; the
  refusal was a name in `refused`, the same list that holds fields the document does not have at all, and the
  other marks were written. Now a mark aimed at a `/Sig` field carrying a `/V` throws `ALREADY_SIGNED` with the
  field in `details`, checked before anything is written so the call leaves nothing half-done. The reason for
  the hardness: a document signed in three of the four boxes you asked for still reads as signed, and nothing
  in it says which one is missing. The built-in pad disables those rows and refuses a plan that names one, so
  the shell's behaviour is unchanged — this reaches a caller who drives the writer directly, and the tier has
  never been published.

- **A writer or merge operation reports what it could not do, in numbers.** A plan naming a page the document
  does not have, an angle that is not a quarter turn, a print range that cannot fit the canvas budget: each is
  now a `PdfError` — `CONFIGURATION_ERROR` for the caller's instruction, `RESOURCE_LIMIT` for the ceiling,
  `WRITER_ERROR` for the peer faulting, `PDF_PARSE_ERROR` for bytes that are not a document — and the failing
  numbers ride in `details` (`{ page: 20, total: 20 }`, `{ neededBytes, budgetBytes, pages, fits }`) rather
  than only inside the sentence. `@cantoo/pdf-lib`'s own exceptions never reach a host: they are kept verbatim
  as `cause`, because the diagnosis belongs in a support ticket and the code belongs in a `switch`.

- **One cost of the contract is bytes, and the ceiling noticed.** Core measured **29.09 kB → 30.01 kB** gzipped
  and the shell moved with it, which `npm run size` records as a stale baseline and `size:update` accepts as a
  decision. Less comfortable: `edit`'s cost over core went from **5.89 kB to 6.25 kB**, past the 6 kB
  per-feature ceiling in `scripts/check-size.mjs`, so `npm run verify` fails until either the writer's routing
  shrinks or the ceiling is reviewed and moved deliberately — FR-23 allows exactly those two answers and no
  third. Both numbers are here rather than only in a failing gate because the second is the one that matters:
  a tier that has to parse the file it is showing is the reason that ceiling moved once already. **W2 moved
  them again** — core **30.01 kB → 31.15 kB**, `edit` over core **6.25 kB → 6.42 kB** — for five rows of
  correctness, the refusal strings, the per-page row geometry and the destination position; the same two
  answers are still the only ones on offer and neither has been taken.
- **A supplied text index no longer indexes in one block** (FR-13). Walking a host's own pages used to be a run
  of microtasks with no turn between them — the worker path yields by round-tripping, a supplied read does not
  — so `usePdfSearch` now hands the loop a turn every `YIELD_PAGES` (5) pages of a supplied-index walk. No API
  moved and no result changed; a long search over a host-supplied index gets a few more frames of slack, which
  is what the clause asks for.
- **The attachment list can now name a file the catalog never listed** (FR-25). Hosts reading
  `usePdfAttachments().files` may see more entries on documents that carry files in `FileAttachment`
  annotations, and `getAttachments()` is no longer the whole of the source. The hook also gained the `signal`
  option FR-36 asks of every async path, because the walk is now per page and a host that navigates away
  mid-list should stop paying for pages it will never show.
- **`ViewerController.rotate()` lost its private copy of the rotation rule** (FR-09). It had its own modulo
  arithmetic beside `normalizeRotation`, which is how a perturbation of the shared reducer appeared to change
  nothing: the document-wide control was answering a different implementation. The duplication is gone and the
  behaviour is what it already was — measured before and after on all four inputs — so the reducer is now the
  only place the rule lives.
- **The benchmark stopped writing to a directory git cannot see, and stopped claiming a number §6 does not
  give.** `.spike/benchmark.json` is now `benchmarks/latest.json`, tracked, because FR-58 counts this as release
  evidence and a gitignored file cannot be evidence however accurate its numbers are. In the same file, profile
  C's in-script target had been restating "cold page under 120 ms" — a bar §6's table does not contain for that
  profile — and now quotes the row instead: engine time separate, main-thread work attributable to our layer
  under 200 ms, cold page measured but not offered as a package-only latency promise. Committing a changed
  record is a deliberate act: the run prints that, and a test fails if the committed one no longer matches the
  fixtures it claims to have measured.
- **#203, the post-lock sweep: five documents were still describing the pre-lock contract.** §8 raised the
  floors to Chrome and Edge 125, Safari and iOS Safari 18, Firefox 124 (provisional) and Node 22.13.0 at the
  October lock, and `docs/src/pages/Introduction.tsx`, `docs/src/pages/Compatibility.tsx`, this README's
  browser section, `src/styles/viewer.css`'s container-query note and `CODE_REFERENCE.md`'s `engines` row were
  still stating 90 / 14 / 90 / 20 — including one row that said `engines: node >= 20` was "the only engine
  statement the package makes", which stopped being true the day `check:packaging` began reading §8. The
  numbers were restated and the *reasons attached to them* were re-derived rather than transcribed, which is
  where the interesting part is: the CSS ships a `@media` branch beside every `@container` rule and avoids
  `:has()` and `dvh` because Safari 14 could not do them, and against a floor of 18 that is margin, not
  requirement — `:has()` is Safari 15.4, `@container` and `overflow: clip` are 16, read off MDN's
  browser-compat-data rather than recalled — so the documents now say the fallbacks are unexercised leftovers
  instead of dressing a stale constraint up as a decision. `CODE_REFERENCE.md` also claimed `PRD.md` §5.2
  still shows a slots form labelled "not the shipped API"; the rewrite deleted that example, so the decline is
  no longer a disagreement with the specification, and its §17 heading said 76 files / 770 tests where the
  suite is 107 files and 1,019 tests.
  **One guard came out with this sweep, and it is worth being exact about why.** `abort.test.ts` grepped
  `abort.ts` for `AbortSignal.any` on the stated ground that the call was newer than every advertised floor.
  That was true when it was written (Chrome 116 against a floor of 90) and false from the lock onward — and
  §5.6's platform baseline rule says a guard written to avoid an API the floors now admit *is* the defect. The
  test is gone, along with the `readFileSync` that fed it. No behaviour changed: nothing in the package ever
  called `AbortSignal.any` and nothing calls it now. What remains is the design reason, which was always the
  real one — each effect owns a cancellation of its own lifetime, so merging a host signal into a composed one
  would make a scale change look like an abandonment — and that belongs in the module header, not in a string
  search for a platform API.
  **The rest of the sweep was arithmetic, and it did not survive being re-measured.** §22 of
  `CODE_REFERENCE.md` tells a reader to run the commands rather than trust the document, so this pass ran them
  and wrote down what the document had gotten wrong. `engines` was recorded as `node >= 20` and as "the only
  engine statement the package makes" — both stopped being true at W7. The per-entry name counts were
  234 / 187 / 32 / 9 where `node scripts/inventory.mjs` reads **239 / 197 / 36 / 13** today, because FR-54
  re-exported the error contract onto the two writer tiers and nobody re-ran the command; the same four figures
  are on the docs API page, now corrected. The maturity row still said 315 names / 272 stable / 43 experimental
  where the manifest holds **320 / 263 / 57** plus 15 withdrawn. The label catalog was quoted as 144 strings in
  four places when `src/locales/locales.test.ts` asserts **136** — the trail is 123 → 131 → 134 → 144 → 147 →
  136, the last step being FR-18 taking the ink strings back out, and the test had been updated while the
  documents had not. §5 claimed "all 35 props" and named 34 of the interface's **44**: the whole `0.9` group —
  `httpHeaders`, `withCredentials`, `rangeChunkSize`, `disableRange`, `disableStream`, `retry`,
  `onRetryAttempt`, `onProgress`, `signal` — was absent, so §5 gained a transport-and-cancellation table and
  three callback lines written from the props' own doc comments, and §6 gained `retryPage(page)`. The
  repo-shape paragraph still said the specification has 51 requirements and that
  `0.1.2` was "committed and deliberately never published" — the registry, read with
  `npm view pdfjs-react-reader versions`, has had 0.1.2 since 2026-09-25, so that sentence was the opposite of
  the truth. Finally the citation probe itself: 315 path citations across the five long documents, every one of
  them resolving except three that name scratch harnesses the text marks as temporary and one that named
  `lib/ink.ts` in the present perfect, now dated. What the sweep cannot fix is the reason all of it was
  possible: §22 tells a reader to run the commands instead of trusting the document, and nothing runs them on
  anyone's behalf, so the numbers were correct when typed and stale by the fourth package after. That is
  **#213**.

### Removed

- **The core freehand ink surface (FR-18), withdrawn from `.` and `/headless`.** The shell could draw, and
  `annotateFeature` could draw, and only one of those two paths survives a save: the core's strokes were an
  SVG overlay that printed and never reached the document, so a reader who picked the wrong pen lost their
  mark without being told. Two ink paths meant one of them was a trap, so there is now one. Fifteen
  published names leave the surface:

  `usePdfInk`, `UsePdfInkOptions`, `UsePdfInkResult`, `InkLayer`, `InkLayerProps`, `InkStroke`,
  `InkSettings`, `createStrokeId`, `simplifyPoints`, `strokePathD`, `pointsBounds`, `strokeBounds`,
  `drawInkStrokes`, `INK_COLORS`, `INK_WIDTHS`

  With them go the surfaces that only that capability used: `PdfPageProps`'s `inkStrokes`, `inkDrawing`,
  `inkSettings` and `onInkCommit`; `ToolbarProps`'s `drawMode`, `onDrawToggle`, `inkSettings`,
  `onInkSettingsChange`, `onInkUndo`, `onInkClear` and `inkCanUndo`, and the `draw` control id the toolbar
  planned around; `UsePdfPrintOptions.getInkStrokes`, so a print job carries persisted marks and nothing
  drawn in-session (FR-19's "no transient core drawing capability"); the shell contract's
  `inkStrokesForPage` and the controller's `ink` and `commitFor`; eleven `PdfViewerLabels` keys
  (`drawOnDocument`, `exitDrawingMode`, `drawingTools`, `drawLabel`, `drawWithColor`, `penWidth`,
  `undoStroke`, `clearAllDrawings`, `penThin`, `penMedium`, `penThick`) and their three locale catalogs —
  `undoLabel` and `clearLabel` stay, because the edit tier's buttons are their only remaining users; the
  `.pjsr-ink*` and `.pjsr-annotation-layer--inert` rules and the `--pjsr-swatch` / `--pjsr-swatch-hit`
  tokens, which were the core sheet's drawing chrome (FR-22).

  `PdfPoint` and `ViewportPoint` do **not** leave the surface: they describe a point in a page or on a
  viewport, the signature and page-edit paths need both, and they moved to the layout module instead of
  being deleted, so the import a host already writes is unchanged.

  What the removal is *not* is a silent one: each name is recorded in `api-maturity.json` under `removed`
  with the maturity tag it held, the release that drops it and the section of this file that announces it,
  and `npm run check:maturity` fails if a removed name is still published, if an entry loses its tag or its
  announcement, or if the version it was removed in is not a major (§5.5). The warning is here rather than
  in a released minor because §5.5 plans none between `0.1.2` and `1.0.0` — `0.2`–`0.12` are internal
  milestones — so `1.0.0` is the first artifact a consumer can install without them.

### Verified, and what that verification did not reach

The run's own honesty is the requirement, so the gaps are in the record rather than implied by a green
count. **All three engines start on this Windows host and every check runs in all of them** — the 2026-10-04
solo pass is six engine×profile cells, **67 ok, 5 skipped, 0 failed, 0 not runnable**, at 1280×900 dpr 1 and
375×812 dpr 2: Chromium 153 and Firefox 155 take 12 ok on desktop and 10 ok with 2 skips on mobile, WebKit 26
the same, and each cell also reports its engine against §8's floor (153 vs 125, 155 vs 124, 26 vs 18 — six of
six at or above). Two claims this section used to make have been measured out of it. The first was that
Firefox and WebKit would not launch here at all; they do now, and the change is recorded rather than explained,
because nothing in this repository made it happen and the earlier `0xC0000142` diagnosis was accurate against
the build it saw. The second is worse and is ours: an intermediate run of this same command reported that
Firefox's own URL input "resolves to a node that never becomes interactive", which was the reason for 10 of its
12 failures. A probe against a lone dev server fills that input and drives the page without trouble, and the
failures reproduced only when a second `npm run test:browsers` was running against the same port. **The
contention was the defect, not the engine** — and the WebKit-desktop "1,000-page stall at page 733" filed from
the same run is likewise gone: alone, WebKit reaches page 999 in 0.1 s and paints it. The 90 s ceiling and the
scroll-position detail stay in the harness, because a row that has been red once has to be diagnosable from its
own line.

The engine range produced two findings of its own, from measuring the CI matrix axes locally before letting a
runner discover them. `npm i --no-save` on the React axis re-resolves the *peer* as well, because
`devDependencies` advertises `^6.2.108`, so every cell type-checked against `6.4.299` and reported one error —
and that error was real and ours: `src/lib/search.parity.test.ts` was writing a bare string into
`annotationStorage`, while a text widget writes `{ value: … }`, which is what `form.ts`'s `storedValue` has read
back out all along and what `6.4`'s `setValue(key, value: object)` now says. The test writes the widget's shape
and passes on `6.3.289` and `6.4.299`; with the engine pinned, all four React cells pass `typecheck`, `test` and
`build`. The other finding is not ours to fix: **`6.2.108`, the advertised peer floor, is a browser-only
release.** `await import('pdfjs-dist')` at that version dies in the engine's module scope with `ReferenceError:
DOMMatrix is not defined` and prints "Please use the `legacy` build in Node.js environments" (Node 24.21.0 has
no `DOMMatrix` global, so this is the build, not the harness); `6.3.289` and `6.4.299` import 62 names cleanly.
In a browser it loads and 22 of the 23 Chromium checks pass, but `pinch-vs-pan` fails with *"a two-finger pan
moved neither the page nor the scroll position"* — that release's `TouchManager` has no `onPanning` at all, zero
occurrences in its build and in its `.d.ts`, so FR-47's pan half has nothing to be handed to. Two consequences
are recorded as gaps on their own requirements (FR-46, FR-47) and one is an open proposal to the owner (#211):
either the floor moves to `^6.3.289`, which still excludes the CVE band and makes every promise testable, or
three promises get an engine-version asterisk. Nothing was coded to pretend the floor works meanwhile.
- **`FR-50`: every published name carries a maturity state, and the build says so.** `api-maturity.json`
  holds all **315** distinct names reachable from the twelve JS entry points — **272 stable, 43
  experimental, none deprecated** — and `npm run check:maturity` is the last step of `npm run verify`: it
  reads the published surface out of `dist/` through the same `scripts/api-names.mjs` that prints
  `CODE_REFERENCE.md` §4, and fails on an exported name with no state, a state with no name behind it (the
  stale direction, which no amount of prose maintenance catches), a non-stable name with no reason, or a
  fifth state invented in the file. It runs itself against nine synthetic violations before it grades the
  real manifest, because a check that has never seen a bad input has not been shown to be a check.
- **The classification is derived, not voted on.** A name reachable from a published entry at the `0.9.0`
  close is stable; anything newer is experimental, because `0.10` and `0.11` are both still unpublished and
  a shape cannot be learned from use that has had none. Twelve older names were moved by hand and each says
  why in its note: the core freehand ink group, because `#124` is an open proposal to retire it now that
  annotate's ink is the one that survives a save, and the four signing helpers, because where the signing
  surface lives is an open decision even though the capability is not. That is the useful property of the
  exercise — a promise you intend to break is not a promise, and the file is where the difference has to be
  written down.
- **What is deliberately not claimed:** the manifest is not shipped in the tarball and has no export-map
  subpath, so a consumer reads the states from the docs site — the API page's *Stability* table is generated
  from the same JSON, which is why it cannot drift — rather than from `node_modules`. Adding a
  `./api-maturity.json` entry is a one-line change if a tool ever needs it programmatically; it was not
  worth moving the published-subpath count for on the strength of a hypothesis.
- **One flake removed while the gate was being extended.** `edit.extract.test.tsx`'s second case waited on
  a 30 ms timer for an extract that is a twenty-page writer pass, so under a full-suite run it asserted
  against a plan that had not landed yet and reported `disabled: true` as though it were a defect. It now
  waits for the status line the first case in that file already waits for — the lesson was written in the
  file and applied to only one of the two tests that needed it.

- **`FR-51`: the six ways a document can be wrong, in one named suite.** `src/lib/edge-cases.test.ts` is a
  table whose rows are the requirement's own shapes — truncated mid object, xref past the end, encrypted,
  wrong password, rotated page, over-large page — and whose column is the thing `FR-51` actually asks for:
  which of `recovers`, `refuses` and `parks` each one is, because a viewer that shows a blank page for all
  six has not failed six times, it has failed to say anything. Each row also cites the file that proves the
  mechanism, and three guards keep the table from becoming decoration: the six keys are pinned against the
  requirement's list, every citation must still anchor on an `it(` in the file it names (a comment that
  mentions the words does not count), and the four rows that run in this process record that they ran — so
  skipping one fails the suite rather than shrinking it.
- **Two rows are cited rather than run, and the file says why instead of quietly dropping them.** The
  wrong-password re-prompt cannot share a process with the others: the engine re-asks in the same microtask
  chain, and a callback that answers every ask loops at about 27,000 asks a second and starves every load
  after it — which is why `encrypted.reprompt.test.ts` is its own file. The over-large page has **no
  fixture**: its ceilings are arithmetic, measured in `canvas.test.ts` against a 3060×3960 and a
  40,000×1000 box, and generating a giant page here would re-assert the same numbers with extra steps
  rather than reach the thing arithmetic cannot — what the engine reports for a page that big. That is an
  open task, not a passing test.
- **A fact no earlier test established.** `/Rotate` reaches `page.rotate` from the file and `getViewport`
  swaps the box to match: page 5 of `page-order-sample.pdf` is `612×792` stored and `792×612` reported,
  while page 8 is wide with *no* rotation at all. The second half is the point — without it the swap could
  be read as the engine reporting the longer side first. `layout.test.ts` has always assumed the rotation
  is there to be had; now something proves it.

- **`FR-49`, two profiles of four: `npm run bench` and a scanned-book fixture.** §6 names four document
  shapes because they fail differently, and until now one of them had a fixture and none of them had a
  harness. `scripts/benchmark.mjs` serves the playground, drives the fixtures in Chromium, and keeps the two
  kinds of number §6 insists on keeping apart: a **bar** is structural and fails the run — the canvas count
  stays bounded, off-screen canvases are genuinely gone rather than merely off screen, the render caps bind
  where they are supposed to — and a **measure** is a timing, printed with the machine it came from and
  never failed on, because "a maximum observed on one device does not become a promise that a slower
  reader's machine will break". Measured here: four canvases and four slots were the most mounted anywhere in a
  forty-step pass; profile B's pages paint at **25 % ink** where a text page manages 0.5 %. The most useful
  number is the one about which ceiling applies: at dpr 2 and 500 % zoom a letter page would want 48.5 MP, the
  screen-relative cap on a 1280×900 display says 13.8 MP, the canvas came back at 13.8 MP rendered at
  **1.07× instead of 2×**, and the page still painted — degradation, not a dead tab. The script reads all
  three ceilings out of `src/lib/canvas.ts` rather than copying them, because a benchmark that hard-codes the
  ceiling it checks would pass the day someone lowers it.
  **One number in that paragraph was wrong, and this is where the correction is recorded rather than in a
  silently edited line.** The cold page was reported at 100 ms — exactly §6's bar, which should have been the
  first clue. The harness was watching the first canvas in the DOM for ink, and during a jump to page 500 that
  is a page other than the one under test; the wait returned as soon as *anything* had pixels on it, so the
  timing recorded how long the jump took and not how long the render did. Measured page-scoped on 2026-10-04,
  profile A's cold page is a **147 ms median (124–199 ms of five samples)** in the committed record, above
  §6's 100 ms bar on this machine, and it is written into the record as a miss beside the bar it missed.
  Nothing about the bar changed: a baseline is not a target, and this one does not even reach it.
- **`scan-sample.pdf`, generated.** Twelve pages, each one 2550×3300 DeviceRGB scan drawn onto a letter box
  — 0.82 MB tracked, 8.4 MP per page once decoded, and **no text operators at all**, which `scan.test.ts`
  asserts through the engine rather than trusting the generator: a fixture that quietly grew a text layer
  would answer a pixels question with a text-run measurement. The generator's own self-check caught a real
  defect on its second run: the object-number ranges collided, so the page tree shared number 38 with the
  last image and pdf.js refused the document with "Invalid Root reference". A hand-written PDF can be wrong
  that way without any byte looking wrong, which is why the check now asserts that the highest object number
  equals the object count.
- **Three bars in this harness were wrong before they were right, and the file says so.** A 400 % zoom on a
  dpr-1 desktop peaked at 3.45 MP against a 33.6 MP ceiling, so "the cap held" described a run where no cap
  engaged. Counting canvases that had left the DOM but kept their buffer measured nothing, because a removed
  element is not in `document` to be queried. And comparing live *pixel* totals between the first and last
  third of a scroll failed on profile A for a reason that was not a leak — its pages have three different
  boxes, so the later third simply had bigger canvases; the count of canvases still held is the
  box-independent shape of the claim.
- **Profiles C and D have fixtures now, and the notes that said they did not are gone.** What remains open on
  this section is the part that cannot be run from here: §6 asks profile D for a real mobile-device validation
  beside the harness (tasks #141, #156), and every number above came from one Windows laptop with a
  13th/14th-generation Core i5 in it — the `browser` job that would run `npm run bench` on a runner has still
  never executed (#194). A committed record from one machine is honest evidence about that machine, which is
  exactly what §6 allows and no more.
- **What W8 fed to its own guards, and what came back.** Thirty-two perturbations, each one the negation of a
  clause this pass claims to prove, each applied alone and the file restored and md5-verified afterwards: four
  against the thumbnail card (the measured width, the pixel ratio, the leave-visible cancellation, the label),
  two against the text layer's rebuild counter, four against rotation (the layer identity, the double-render,
  the destroy set, the reducer), two against the yield bound, four against the attachment fixture, seven
  against the oversize row — including removing the minimum-scale check from `resolveRenderScale` itself and
  shrinking the fixture's 200,000-point page to one that fits — and nine against the benchmark record, down to
  deleting the file so the message that comes back is "run `npm run bench`". Every one fired on the test that
  owns it, and two of them fired on a *premise* rather than a behaviour: the generator refusing to emit a page
  whose verdict its own ceilings no longer imply, and the same refusal for a sheet under the operator floor.
  Both new generators were run twice and byte-compared, because a fixture that drifts between runs cannot carry
  a hash worth checking. The suite is **1,019 tests in 107 files** (from 985 in 100 — #203 takes one back out), `typecheck`, `build`,
  `check:packaging`, `check:examples`, `check:maturity` and `check:fr-evidence` all pass, and `npm run verify`
  stops at `size` for the one reason it is meant to: core at 30.68 kB against the accepted 29.09 kB baseline
  and `edit` at 6.43 kB of its 6 kB ceiling, which is decision #208 and not something a gate should be talked
  out of.

## [0.11.0] — 2026-10-01

Index & Assemble. Three requirements, one new entry point, and one claim withdrawn. `FR-39` turned the
search index into something that arrives — on a 1,000-page document, from the page the reader is looking at,
the first answer came **56 ms** after the query and the complete answer **1,176 ms** later, with the counter
saying *so far* in between because a growing number presented as final is a lie about the document. `FR-40`
let somebody else build the index. `FR-42` merged two documents into a third, which is the only genuinely new
capability across `0.9`–`0.12`, and it shipped as a writer, a hook and a recipe rather than a component. And
the requirement that read "re-indexing after a page edit invalidates only what changed" was measured before it
was documented, found not to mean what it sounds like, and the wiring built on that reading was taken back
out.

### Added

- **`FR-39`: incremental, viewport-prioritised indexing.** `usePdfSearch` no longer reads the file front to
  back before it answers anything. It reads outward from the page the reader is on — `outwardPageOrder(n,
  focus)` is focus, +1, −1, +2, −2, forward before backward at an equal distance, because a reader who
  searches from page 40 expects the next hit ahead of them — and publishes on whichever of 25 pages or
  120 ms comes first, always publishing the first page immediately so a query is never held behind a batch.
  Results are re-sorted into document order on the way out, and the active match is carried **by identity**
  across a publish, so the reader's position does not jump as the index grows. The shell hands the hook
  `currentPage - 1`, read when a search starts and never watched; a search that restarted on every scroll
  would never finish on the documents this is for.
- **A partial answer says it is partial.** `complete`, `pagesIndexed` and `pagesTotal` are on the controller,
  and the find bar's counter switches to one of two new labels — `{current} of {total} so far`, and the
  per-page variant — which takes the catalog from 144 to 146 strings in all four languages. This is the
  requirement's actual teeth: the timing is an optimisation, but a count that is still growing and reads as
  final is wrong information, and `SearchBox.counter.test.tsx` holds both wordings.
- **`FR-40`: an index built elsewhere.** `usePdfSearch` takes an `index`, the published shape is
  `{version: 1, pages: [{text, itemEnds}]}`, and `buildTextIndex(items)` makes one out of the same
  `getTextContent()` items the viewer would have read — so a server that has already extracted a corpus's
  text can hand the result over and keep our find bar, our marks and our page counts. What it is checked
  against is the page count, not a checksum: a well-formed index is indistinguishable from a stale one, and
  a mark from a stale index lands on words the reader can see are not what was matched. Refusal is reported
  in `indexError` **and the document is searched anyway** — refusing an index is not refusing a search — and
  a page the index leaves out (`null`) is read from the document, and only that page, which is asserted as
  the list of `getPage` calls rather than as a hope.
- **The parity proof, on real files.** `src/lib/search.parity.test.ts` builds an index from a fixture,
  round-trips it through JSON, and asserts match-for-match identical `PageMatch` arrays against the viewer's
  own extraction for nine queries over two fixtures, including the empty-string items both files are full of.
  It also proves the format does not depend on whether the host asked for marked content — boundary objects
  carry no `str` and are skipped, so publishing them changes nothing — and holds the counterfactual in the
  same test: a host that coerces those boundaries to empty strings keeps the text byte-identical and moves
  every item index, which is a mark on the wrong span.
- **`FR-42`: merging documents, on its own entry point.** `pdfjs-react-reader/merge` (the 25th subpath, 9
  names) exports `mergeDocuments`, `describeMergeSources`, `usePdfMerge` and the plan types. It is a separate
  entry because a viewer that only displays PDFs has no reason to carry a page-copying writer, and the
  merge-only consumer path measures **0.78 kB**. The property every other decision serves is that **the
  output is always a new file**: every source is loaded from a copy of the caller's buffer, and
  `pdf-merge.test.ts` asserts it by hashing the sources before and after, because a reader experimenting
  with a merge must not be able to destroy a document by trying it. A page may be taken twice, which
  `arrangePages` refuses — inside one document a page is an object to be permuted, across documents it is a
  thing to be copied — and the plan is validated in full before anything is copied, so a bad page number
  fails before it has built a document rather than part-way through one. What a merge does not carry is the
  interactive form: `copyPages` brings a page's widget annotations across but not the `AcroForm` that binds
  them, so on a merged file the values are visible and the fields are not live.
- **`usePdfMerge`, and the recipe that proves the shape is enough.** A hook and no component, for the same
  reason `enableDrop` hands a dropped file back rather than opening it: which documents may be merged, where
  they come from and what happens to the result are the host's business. The hook owns the part a host should
  not have to get right — page counts as they arrive, the plan as data, a merge that cannot touch a source —
  and `playground/src/MergeDemo.tsx` is what a host then writes, which is the honest test of that decision.
  Verified in Chromium: 20 and 2 pages read from two fixtures, three pages added and one moved earlier with
  the per-source *taken* counts following, a repeated page accepted, **wrote 4 pages: 3 + 1**, and the
  the resulting 5,134-byte file reopened in the reader with its pages in plan order, portrait and landscape
  sheets keeping their own boxes on the same zoom (a 792×1025 canvas and a 1025×792 one), because copying a
  page carries its `/MediaBox` with it.
- **`signal` on the merge**, checked before each page and before the save, so a caller that stops never
  receives bytes it did not ask for; `merge()` resolves `null` rather than throwing on its own cancel.

### Changed

- `PdfFindController` is now a published interface with the five incremental members optional
  (`complete`, `pagesIndexed`, `pagesTotal`, `invalidatePages`, `indexError`), so a host standing in for the
  engine's find does not have to implement progress it does not have. The playground's host-side controller
  is unchanged and still answers with pages and offsets only.

### Removed

- **The shell's form-change → index invalidation, which was built on a reading the engine does not support.**
  `FR-39`'s last clause says a re-index invalidates only what changed, and the wiring wrote that as "a typed
  form value enters the index". Measured, it does not: `getTextContent()` on `form-sample.pdf` returns the
  field *labels* (`Full name:`, `Notes:`), takes no `annotationStorage` at all, and returns no annotation
  text either — a sticky note's `/Contents` and a `/FreeText`'s value are drawn in a layer, not set in the
  page. So the call cleared a page's cache and re-read the same content stream, which is a small performance
  bug wearing a feature's clothes. `invalidatePages` stays on the controller as the host-facing operation it
  is — the cheap half of "only what changed", for a host that knows a page's text is no longer what it
  indexed — with the measured limit stated where the API is, in `usePdfSearch`, in `invalidatePageText`, and
  as two tests in `search.parity.test.ts` under *what the index cannot see*. Whether an XFA document's
  extraction moves when a field is edited has **not** been measured and is not claimed.

### Numbers

Suite **759 tests in 74 files**; source **80 files, 15,629 lines** outside tests; **25 subpaths**, 234 names
on the root entry, 187 on `/headless`, 32 on `/edit`, 9 on `/merge`. Core **29.09 kB** gzipped (from 28.01),
`all nine` 44.06, the shipped root path 60.75, `/headless` path 32.53, `merge-only` 0.78. The core figure
moved more than this release's shell code explains: a new tsup entry reshuffles the shared chunks every path
is built from, which is the same effect `0.10` recorded when the structure tier was added. Per-feature costs
are unchanged within a few bytes, and `edit` remains the largest at 5.89 kB over core.

## [0.10.0] — 2026-10-01

Access. Four requirements, one fixture, and an audit that paid for itself before it was finished: `FR-43`
arrived as `structureFeature` and then again as the annotation half, `FR-47` turned out to have a gesture
the viewer was swallowing, `FR-44` found a colour the user agent cannot reach, and `FR-45`'s axe run
reported an ARIA violation on its first pass — in a sidebar row that eleven hand-written accessibility
tests had walked past.

### Added

- **A tagged PDF to test against (`scripts/make-tagged-pdf.mjs`), and the key that decides whether it proves
  anything.** `FR-43` had been argued about for two releases without a single measurement, because
  `page.getStructTree()` answers `null` for all seventeen other readable fixtures — none declares
  `/MarkInfo`, a structure tree, or one marked content section. The new file writes two pages whose roles
  are a heading, a paragraph, a list with three items, a table with a header row, and a figure carrying
  `/Alt`. Writing it found the silent failure: **a `/StructElem` whose kid is an integer MCID is dropped
  unless the element also carries `/Pg`** — `parseKid` compares the element's page against the page being
  walked and returns `null` when it cannot tell — so the roles all still read back correctly with every
  mark unbound. `src/lib/tagged.test.ts` asserts the tree as authored, asserts that an untagged file answers
  `null`, and asserts the counterfactual by renaming `/Pg` in the bytes (same length, so the xref stays
  valid) and watching the marks vanish while the roles stay. The generator refuses to write a file whose
  elements lack the key.
- **`structureFeature` (`FR-43`): the document's structure tree, as accessibility structure.** A new
  opt-in tier at `pdfjs-react-reader/features/structure`, with its own `structure.css`, and the first
  feature in the package that ships no control, no panel and no key — its entire surface is two page props.
  `structureLayer` asks every page to extract its marked content, which is what a tree binds to, and
  `structTreeLayerBuilder` hands the page pdf.js's builder once the document has said it is tagged and the
  chunk has arrived. They are two props rather than one because a text layer built without marking cannot
  be bound afterwards without rebuilding it — the 39.8 ms-per-page rebuild this project removed from the
  zoom path in `0.8` — so the switch is static (mounting the feature decides it) and only the class waits
  for the document. The tier costs **0.37 kB over core**; the ≈50 kB of `pdfjs-dist/web/pdf_viewer.mjs` it
  reads is a lazy `import()` the browser fetches per tagged *document*, which is why the size gate cannot
  see it and why the docs say so rather than letting 0.37 imply the whole cost.
- **The annotation and editor layers now receive the structure layer, which closes `FR-43`'s second
  clause — after a fixture was built for it.** `PRD.md` asks that a widget be announced with its owning node
  rather than as an unlabelled control, and the annotation layer reads the builder from its *constructor*, so
  wiring it means re-rendering the page's annotations once the tree exists. That is a certain cost against a
  gain the repository could not show, because the one tagged fixture had no annotations — so
  `scripts/make-tagged-pdf.mjs` grew a `/Link` element over real words and a matching link annotation, and
  the page now hands the layer to both consumers. Measured in Chromium with the feature on: the `<a>` carries
  `aria-owns` pointing at the tree node that in turn owns its words, both ids resolving; with the feature
  off, no `aria-owns` at all. Cost, asserted as a number rather than waved at: two annotation-layer
  constructions per tagged page instead of one, and none for the untagged majority. **What it does not buy,
  said plainly:** the link's accessible name in Chrome is still its URL — the ownership reaches the words
  through two `aria-owns` hops and the name computation does not follow them — so the mechanism matches
  pdf.js's own viewer and the announcement remains a question for the `0.12` assistive-technology pass.
- **Where the tree goes, which was not where pdf.js puts it.** The engine appends its structure tree
  *inside* the page canvas, and can, because its canvas is `role="presentation"`. Ours is `role="img"` with
  the page's label, and `img` makes its descendants presentational — measured in Chromium against the same
  markup in both positions: inside, the accessibility tree reports an image and no heading at all; beside
  the canvas, it reports the heading and keeps the page name. So the tree is a sibling. Mounting it the
  obvious way, by copying the reference implementation's DOM, would have shipped an accessibility layer no
  assistive technology could see, with every test in the suite still passing.
- **What the browser pass proved, and the one thing it did not.** Against `tagged-sample.pdf`: 10 marked
  content spans across the two pages, two `.structTree` subtrees totalling 14 role nodes — `heading/1`,
  `paragraph`, `list` with three `listitem`s, `figure` carrying the `/Alt` as its name, and
  `table`/`row`/`columnheader`/`cell` — with **every `aria-owns` target resolving to a real element**, the
  trees measuring 0×0 (their containment holding), the same DOM node surviving `zoomTo(2)`, and the marks
  resolving again after a page rotation rebuilt them. Against an untagged document with the feature mounted:
  **zero requests** for the viewer module, which is the whole cost model of the tier observed rather than
  asserted. What it did *not* prove is the sentence people will want: that a screen reader announces these
  as headings. The snapshot available here filters unnamed nodes, and pdf.js's heading and list elements own
  their text by reference rather than carrying a name — so that claim waits for an assistive-technology
  pass in the `0.12` matrix, and `CODE_REFERENCE.md` §20 says so in those terms.
- **The `FR-43` spike's numbers, which reversed its own recommendation.** `StructTreeLayerBuilder` is
  exported from `pdfjs-dist/web/pdf_viewer.mjs` — not from `web/struct_tree_layer_builder.js`, which is
  pdf.js's *source* layout and is not in the shipped package — and bundling a file that imports just that
  class costs a consumer **≈ 50 kB gzipped at both 6.2.108 and 6.3.289, about 1.8× this package's entire
  core**, because the 320 kB viewer module does not tree-shake: the minified output still contains
  `PDFHistory`, `DownloadManager`, `ProgressBar`, `AnnotationEditorLayer` and the rest. Measured in a
  browser against the new fixture, what that buys is **1.4–4.6 ms a page** for an 8-node and a 10-node
  `.structTree` subtree whose `role`, `aria-level`, `aria-owns` and `aria-label` attributes turn the page's
  spans into a heading, a list, a table and a named figure. So the first recommendation, "record the
  exclusion", was pricing only the bytes, and the answer taken is the opt-in feature with a lazy `import()`
  gated on the document's own `MarkInfo` declaration.

  One clause of that measurement was wrong, and the browser pass is what found it: *our text layer marking 0
  of its 5 spans* was not our layer declining to mark, it was **the fixture never opening its marked
  sections** — see the `BDC` entry under Fixed. The role counts were real; the comparison was not.

- **Gesture arbitration (`FR-47`): the two-finger pan was being swallowed, and now it scrolls.** Wheel zoom
  and pinch have shipped since `0.2`, but the gesture between them was dead: pdf.js's `TouchManager` claims
  a two-finger `touchmove` with `preventDefault` and `stopPropagation` *before* it knows whether the span
  between the fingers changed, and this viewer answered only the zoom half. A reader who put two fingers on
  the page and dragged got nothing — not from the document, not from the host page. `onPanning` now moves
  the scroll container by the midpoint delta, so content follows the fingers, and the viewport declares
  `touch-action: pan-x pan-y` so the browser never begins its own page-pinch-zoom to race us. Two more
  clauses came with it: the freehand layer keeps every finger while it is armed (`isPinchingDisabled` is
  consulted before the manager claims anything, so the sequence is released rather than stolen), and a
  gesture we consume still bubbles — the host's listener survives and reads `defaultPrevented`, which is the
  DOM's own arbitration protocol and the one `FR-47` asks for. Verified in Chromium with synthetic touch
  sequences: a symmetric spread took the scale from `fit-width` to 1.73 with the move prevented, and a
  120 px two-finger drag moved `scrollTop` by exactly that much with the scale unchanged.
- **Forced colours (`FR-44`), and the boundary the reader's palette does not cross.** Every stylesheet's
  chrome colours now resolve to the system keywords — `Canvas`, `CanvasText`, `GrayText`, `ButtonFace`,
  `Highlight` — through the token block, because the user agent overrides the used value of every `<color>`
  regardless of what was authored, and the useful work is in the three things that override does not do.
  Separation carried by a shadow (the menu, the annotation popup, the page's own sheet, the thumbnail frame)
  comes back as an `outline`, which cannot change a box the engine sized. And four places keep their colours
  on purpose, with `forced-color-adjust: none` and a reason written next to each: the ink swatches and the
  ink strokes, the signature pad, the annotation colour plate, and the printed page — where the colour *is*
  the value, and forcing it would break the control in order to style it.
- **A second channel for each colour-only signal, outside any media query.** A search match carries a rule
  under it and the match the reader is on a ring around it; an armed toolbar button gets its transparent
  border turned on; the selected sidebar tab thickens the underline it already had. These are declared for
  every palette, not only the forced one, because WCAG 1.4.1 does not wait for high contrast — and the
  active match additionally carries `aria-current="true"`, set by the same statement that sets its class, so
  the two cannot drift.
- **The audit (`FR-45`): axe-core over the shell and the primitives, in the suite and named in CI.** Twelve
  tests run the WCAG 2.0/2.1/2.2 A and AA tag sets against the loading, failed and password states, the
  sidebar on each tab, the open search bar, an outline tree, an ink layer, the password prompt, and the real
  `PdfPage` with the engine's own text layer and marks in it. `npm run a11y` runs them on its own and the CI
  `verify` job names the step, though they already run inside `npm test` — the requirement is that
  conformance *can fail a job*, and it does. Two harness facts made the page-level audit possible: jsdom's
  `getContext('2d')` returns `null`, which the engine's text-measurement helper feeds straight into a
  `WeakMap` (`TypeError: Invalid value used as weak map key`), so the test stubs the two members a context
  is asked for; and `streamTextContent` is a `ReadableStream` of `{items, styles}`, not a promise of a list.
  What the audit cannot see is asserted as a list rather than assumed absent: axe reports `color-contrast`
  and `aria-hidden-focus` as `incomplete` under jsdom, because there is no layout — those, and the
  assistive-technology announcement, belong to the `0.12` matrix.

### Fixed

- **The sidebar's tablist contained a button that was not a tab, and axe said so on its first run.**
  `.pjsr-sidebar-tabs` carried `role="tablist"` *and* the close control, which is an `aria-required-children`
  violation — the panel's dismiss button was a child of the list a screen reader walks with the arrow keys.
  The row is now a header holding the tablist with the close beside it, the styling moved with it, and the
  tab strip's measured geometry unchanged (248×44, close at the far edge). Eleven accessibility assertions
  written before this release had covered the tablist's roving tabindex, its labels, its ids and its focus
  ring, and none of them could see a child that did not belong.
- **A form field's only affordance was a colour the user agent cannot reach.** `forms.css` paints the
  unfocused AcroForm field with an SVG written into a data URL, and the forced-colours override applies to
  the `<color>` values a browser can parse — a document inside a quoted attribute is opaque to it, so that
  indigo tint would have survived a black-on-white theme untouched while everything around it changed. It is
  worse than a stray colour in that theme: an unfocused field's border is `transparent`, so the tint was the
  *only* thing showing where the field is, and a 20-field form with its tint forced away is blank paper.
  Under `forced-colors: active` the image goes, the tint comes back as `Highlight` at the same alpha, and the
  box gets a real `CanvasText` edge.

- **`tagged-sample.pdf` bound nothing, and every assertion about it passed.** Its content streams opened each
  marked section with `BX /MC0 BDC` — one operand, where `BDC` takes a tag *and* a property list — so pdf.js
  logged `Skipping command BDC: expected 2 args` twenty times and emitted no marked content at all. The
  structure tree is built from `/StructParents`, `/ParentTree` and each element's `/Pg` and never reads a
  content stream, so the roles kept reading back exactly as authored while the `aria-owns` ids they pointed
  at were never written. Fixed by writing the property list inline (`BX /MC0 << /MCID 0 >> BDC`, the form
  that yields an id in this engine — the `/MC0` name-key into `/Properties` that real producers also supply
  reaches `getTextContent` unresolved and yields none), with the generator now refusing to emit a `BDC`
  without one and `tagged.test.ts` asserting the pairing both ways: the marks the content opens *equal* the
  marks the tree binds, and blanking a property list at the same byte length leaves the tree complete while
  the content marks go to zero.
- **`getMarkInfo()` resolves with a `Map`, not the object its own declaration promises.** The gate read
  `info.Marked`, which on a `Map` is `undefined`, which is indistinguishable from an untagged document — so
  the feature reported every tagged PDF in the world as untagged, silently, with no console line, and the
  unit test that should have caught it had been handed a plain object because that is what the types said.
  Both shapes are read now, and the `Map` (and `null` for a file declaring nothing) is pinned against the
  real engine in `tagged.test.ts`, so a change upstream is noticed at the boundary rather than in a browser.
- **An annotation's `/StructParent` maps to one element; a page's `/StructParents` maps to an array.**
  Writing the link into the fixture the obvious way — `2 [29 0 R]` — produced a file whose tree read back
  complete and simply had no link in it: `StructTreePage.parse` iterates the page's array but passes the
  annotation's value straight to `addNode`, which rejects a non-dictionary and drops the element. The legal
  form is `2 29 0 R`. Third silent failure mode of this one fixture, and the generator now checks the key
  maps to the element it claims.
- **`structureFeature` published a builder it never forwarded.** Its `Runner` put the class in the feature
  store and its `pageProps` returned only the static switch, so a page got marked text layers and a fetched
  chunk and no tree. `pageProps` now returns both, and the test asserts the *merged* props carry the class —
  the constant-only version was re-run to watch it fail, because the assertion this release originally had
  ("no `structTreeLayerBuilder` for an untagged document") is one the bug satisfies.

### Added to the gates, because none of these were catchable by anything that existed

- `scripts/copy-assets.mjs` now fails when a stylesheet is built but not offered in `exports`. The reverse
  check has been there since `0.6`; this direction was not, and `structure.css` spent a whole session
  imported successfully by the playground — which resolves `pdfjs-react-reader/*` onto `src/` — while no
  consumer could have imported it at all.
- `scripts/inventory.mjs` lists the `features/structure` entry, so §4's name counts include it.
- `src/styles/forced-colors.test.ts` reads every stylesheet and applies a rule derived from their contents
  rather than from a list: a sheet that declares a *literal* colour — a hex, an `rgb()`, a fill inside a data
  URL — must carry a `@media (forced-colors: active)` block saying what the override does with it, and no
  block may author a literal of its own. A sheet that only reads `var(--pjsr-*)` is exempt, because the core
  sheet re-points the tokens once for all of them, which is why adding a colour to `structure.css` fails the
  suite while the file's present absence of colour does not. The same file asserts the second channels exist
  as declarations, because a rule that deleted the mark's `border-bottom` would leave every DOM test green.
- The axe audit is a test file, so it gates `npm test`, the `react` matrix and the `consumer` job alike, and
  it asserts its own blind spots: `expect(incomplete).toEqual(['aria-hidden-focus', 'color-contrast'])`
  fails if jsdom ever grows a layout, which is the moment to re-read what the file claims rather than to drop
  an id from the array.
- Both new gates were checked by breaking them, not by reasoning: a `color: #ff0000` added to
  `structure.css` and a `border-bottom` deleted from the mark rule each failed the suite, and neutering
  `onPanning` or `isPinchingDisabled` each failed its gesture test.

## [0.9.0] — 2026-09-30

Reach. A viewer that cannot open a document from behind a bearer token, a signed URL or a session cookie is
useless in the deployment that was going to adopt it, and none of that needed new architecture: the engine
had accepted every one of those options for years and this package never forwarded them (`FR-34`), never
retried what could heal or refused to retry what could not (`FR-35`), never let a host stop what it had
asked (`FR-36`), never published the state it kept deriving twice (`FR-37`), and never let a host classify
a source string before handing it over (`FR-38`). Importing the package on a server, which had always
worked, became a tested property (`FR-46`).

Riding along from `0.8`: **signing**. A reader can draw a mark and have it written into a signature box in
the file, which puts signing beside rearranging and flattening as work this package does to a document
rather than merely to a view of one — through its own writer, not the engine's. It is also the first
feature that failed the size gate it was measured against, and what happened instead of the feature being
cut is the more durable result: `PRD.md` had a per-tier ceiling of 4 kB, signing measured 4.73 kB with
**no interface at all**, and the owner's answer was that a full module may cost bytes but must never stop
behaving smoothly under load. So the ceiling moved to 6 kB, and a new section — *Behaviour Under Load* —
became the NFR that governs, with figures behind it rather than an adjective.

Four rows the `PRD.md` rewrite had reopened closed in this release, and three of them moved the
requirement rather than the code — see the `FR-03`, `FR-08` and `FR-02` entries below.

### Added

- **The network contract (`FR-34`, the first item of `0.9`).** `httpHeaders`, `withCredentials`,
  `rangeChunkSize`, `disableRange` and `disableStream` on `UsePdfDocumentOptions` and on `PdfViewerProps`,
  forwarded to the engine's `getDocument` — for a URL source only, since every one of them is a property of
  a fetch and passing them beside `data` would be harmless and misleading. This is the capability that
  decides whether a document behind bearer auth, a signed URL or a session cookie can be opened at all, and
  the engine has accepted all five for years; the package simply never forwarded them.
  All five are **ref-read rather than watched**, and that was proven by breaking it on purpose: adding
  `httpHeaders` to the load effect's dependency array does not restart the load once per render, it loops
  without bound — **2,666 `getDocument` calls** in the re-render test and **60,417** in the reload test,
  against the 1 and 2 they assert, because each load sets state, the state re-renders the host, the
  re-render mints a new object literal, and the literal re-runs the effect. The same reasoning is why
  `reload()` after rotating a token picks the new one up where a closure captured at effect time would
  silently reuse the old. Four tests in `src/headless/usePdfDocument.network.test.tsx`; core grew 0.19 kB,
  inside the size ratchet's 256 B slack, so the baseline did not need re-accepting.
- **Host-facing cancellation (`FR-36`) on all nine operations the requirement names.** `signal` on
  `usePdfDocument`, `usePdfSearch`, `usePdfPrint`, `usePdfDownload`, `PdfPage` (the proxy fetch, the canvas
  render, and the text, annotation and XFA layers), `PdfThumbnail` (both passes), and the four writer
  functions, plus `PdfViewer` for the load. Exported helpers: `onAbort`, `abortError`, `isAbortError` and
  `throwIfAborted`. An abort runs the same teardown an unmount or a scroll-out would, so FR-04's rule — a
  cancellation is not a failure — holds for a stop the host initiated, and nothing reaches `onError`.
  Two things that only bite when you get them wrong. The load follows a **swapped** signal without
  restarting it: `signal` in the load effect's dependency array would reload the document for any host that
  builds a controller per render — the FR-34 trap in different clothes — so the subscription reaches the
  running teardown through a ref instead. And `AbortSignal.any` is deliberately not used: it is Chrome 116,
  Safari 17.4 and Firefox 124 against advertised floors of 90, 14 and 90. Nothing in this repository could
  ever catch that, since every CI job is Node on Linux, so a test strips comments and greps the source as a
  placeholder until FR-48 puts a real browser in the pipeline.
- **A requirement corrected and a helper deleted on that pass.** FR-36 said a host signal *composes* with
  the internal one. It does not, and should not: each effect owns a cancellation of its own lifetime — the
  page-proxy fetch ends when the page number changes, a canvas render when the scale does — so one merged
  signal across a component would make a zoom step look like the whole page had been abandoned. The
  requirement now states what is actually guaranteed (an abort triggers the internal teardown) and names the
  writer's limit in the same breath: its loop is synchronous inside `@cantoo/pdf-lib`, so an abort stops the
  next page and always prevents the bytes arriving, but cannot un-make a page already rearranged.
  `composeAbort` had been written, tested and exported from two entries before that review; nothing in the
  package needs two signals merged, so it is gone rather than left as surface area its own tests called.
- **Two limits asserted rather than glossed, and one counterfactual.** The download signal is checked
  before the file is written, so the worker round trip for the bytes is still paid. A test asserts that a
  *live* signal still produces a file, so the guard is proven not to be a wall, and that an aborted writer
  leaves the caller's byte buffer untouched. 46 tests across `abort.test.ts`, `search.abort.test.ts`,
  `usePdfDocument.abort.test.tsx` and the writer's new block. `extractAllText` had no test of its own before
  this, so the loop boundary is now covered too — an abort is honoured per page, not checked once before a
  thousand-page walk.
- **Bounded retries (`FR-35`), and the classification that makes them safe.** `retry` and
  `onRetryAttempt` on both `usePdfDocument` and `PdfViewer`: three attempts by default, full-jitter
  exponential backoff, a configurable ceiling, and `false` to opt out. On by default because the engine
  performs the fetch, so a host cannot retry it themselves.
  The part that matters is what is *not* retried. A 401 or 403 is surfaced on the first response with the
  reason `the server refused our credentials`, because retrying a refused credential turns one denied
  request into several — which is how a permission problem becomes a rate-limit problem and then an
  account lockout. A 404, a corrupt file, an encrypted document and our own cancellation are permanent
  too, and anything not positively identified as transient falls through to no.
  The engine reports a failed fetch as `ResponseException`, carrying `status` and a `missing` flag; a
  connection that never got a response arrives as the same class with `status: 0`, which is why 0 is
  transient for http and missing for `file:`. Errors are matched by `name` rather than `instanceof`,
  because the name is what survives the worker boundary.
  **The size ratchet refused this first**, and that is the gate doing its job: +0.91 kB on core against
  the 755 B the ratchet allows, and +0.82 kB on the headless-only path against 308 B. Rather than accept
  it immediately, the classifier was simplified — two hand-maintained status sets became the rule they
  encoded (any 5xx, plus the three 4xx that mean "later"), which is smaller *and* easier to audit, since a
  list has to be extended by whoever next meets a status it omits. `retry.ts` went from 1,578 B to 1,289 B
  minified, and the `pdfjs-dist` import went with it. The baseline is re-accepted at core 25.78 kB in the
  same diff, which is what `npm run size:update` is for. 37 tests across `retry.test.ts` and
  `usePdfDocument.retry.test.tsx`; the auth tests assert the surfaced error *is* the 401, so "exactly one
  call" cannot also be satisfied by a mock wired wrong.
- **The two state models, published (`FR-37`).** `PdfDocumentStatus` (`idle`, `loading`,
  `password-required`, `ready`, `error`, `destroyed`) and `PdfPageStatus` (`unrequested`, `queued`,
  `rendering`, `rendered`, `cancelled`, `released`, `error`) are exported from both entries, from
  `src/lib/status.ts` — a module of types only, so nothing is emitted and neither entry paid for it.
  The earlier revision of the PRD declined these enums on the grounds that an enum would restate what
  `doc`, `isReady` and `error` already answer; the target spec asks for them anyway, and the way to have
  both is to **derive the fields from the state instead of sitting them beside it**. `usePdfDocument` now
  holds one tagged value, and `status`, `doc`, `isReady` and `error` are read off it, which is what makes
  the requirement's invariant — never `ready` while the handle is null — structural rather than a rule to
  police. `passwordRequest: { reason, submit }` joins the result because §5.1's example renders its
  credential prompt from `status` alone and would otherwise have no way to answer it;
  `onPasswordRequired` stays as the event channel, and the new field is the same request as a state. Only
  the **live** request may move the state: a host that kept the first submit in a ref — a modal that
  outlived its prompt — answering after the engine had re-asked would clear the new prompt and leave the
  load waiting on a request nothing is showing.
- **`PdfPage.onStatusChange(pageNumber, status)`, and `rendered` as a join.** §3.5 defines `rendered` as
  painted *with its overlay layers laid out*, so the canvas resolving is not enough: the page waits on the
  passes it actually starts — canvas, text layer, annotation layer, XFA — keyed by name so a pure-XFA sheet
  or a headless host that passes no link service is not left waiting for a layer that cannot arrive. The
  annotation editor layer is deliberately outside the join, because it has nothing to paint until the
  reader does something, and gating on it could hold a page at `rendering` forever. `cancelled` fires only
  when a render was genuinely in flight, which is why a zoom step reads `released → rendering → rendered`
  with neither a cancellation nor an error: FR-04's "a render cancelled by a zoom step is not reported as a
  failure", now observable without a browser. `unrequested` is the one state a page never reports — an
  unmounted page cannot speak, and `virtualSlots` is what names it — and a test asserts that absence rather
  than leaving the union's honesty to prose. The page number rides along with the status, in the shape
  `onBaseDimensions` already uses: a host tracking a whole document then holds **one** `useCallback` rather
  than a closure per page, which is the difference between using this prop and quietly defeating the memo.
- **Byte progress, because §3.5 says `loading` must carry it.** `onProgress` on `usePdfDocument` and on
  `PdfViewer`, forwarding the engine's own `PDFDocumentLoadingTask.onProgress`. The one decision worth
  naming: pdf.js reports `percent` as `NaN` when the response did not say how long the file is — a chunked
  or gzipped body, which is ordinary for a served PDF — so `PdfLoadProgress.percent` is `number | null` and
  the `NaN` becomes `null`. A host binding `width: ${percent}%` to the engine's value gets *no bar at all*,
  which is a worse failure than an empty one. The shell forwards and does not draw a bar; the waiting
  notice stays as it was.
- **The shell is the demonstration consumer, and got smaller for it.** `ViewerController` carries
  `status`, `ViewerPages` picks between prompt, failure and waiting notice from that one value, and the
  built-in prompt is derived from the load instead of copied into shell state: a `useState`, a
  `submitPasswordRef` and the effect whose only job was clearing a stale prompt are gone. A resolved load
  ends the prompt by ceasing to be a request, and a host-supplied `onPasswordRequired` still stands the
  built-in dialog down.
- **What this found about our own tests.** `src/components/PdfPage.status.test.tsx` is the first file that
  ever rendered `PdfPage`, and two of its cases failed on a harness bug before they tested anything: the
  fake page proxy's `getViewport` returned one shared object, so a scale change left the viewport's
  identity untouched and the render effect — which keys on exactly that — did not re-run. Nothing was wrong
  in the component; the fake was lying about the engine, since a real `PageViewport` is a new object per
  scale. The fake behaves that way now, and the zoom assertions measure the repaint rather than the stub.
- **Verified in a browser, on both halves.** On the playground: `tracemonkey` reported
  `1,016,315 of 1,016,315 bytes — 100 %` through `onProgress`; `encrypted-sample.pdf` opened the built-in
  prompt — which is now a *derived* view of `password-required`, with no shell state of its own — and
  submitting the right password cleared the prompt by itself and painted page 1 (792 × 1025, 3,567
  non-white pixels); `damaged-truncated.pdf` produced the alert with the engine's own `Invalid PDF
  structure.` and a working *Try again*, after its 960 bytes had arrived in full — the parse failed, not the
  fetch. On the docs site's headless example, scrolling read out
  `ready → ready · 1 painting → ready`, which is the page model arriving from real `render()` tasks and real
  layers, not from a mock.
- 24 tests (10 on the load, 4 on progress, 10 on the page) took the suite to **546 in 46 files**, and core
  to **26.69 kB gz** — +0.55 kB on its own, inside the ratchet's slack, so FR-37 alone needed no
  re-accepting; it was FR-38, below, that crossed the line for the pair. Not wired, and said plainly: the
  shell does not subscribe to page statuses, because it has no per-page progress UI to spend bytes on and
  the requirement is that a host *can*, not that the shell must.
- **Deciding what a string is, before loading it (`FR-38`).** `classifySource(src)` answers
  `{ kind: 'url', url }`, `{ kind: 'bytes', data }` or
  `{ kind: 'refused', reason, message }` — `reason` being `empty`, `bare-name`, `windows-path` or
  `bad-base64` — and it never throws, which is the whole point of asking before you load: a host holding a
  value from an upload widget or a query parameter can branch on it instead of wrapping the loader in a
  `try`. `base64ToBytes` is exported alongside, validating before it decodes. The part that makes this one
  rule rather than two is that **`normalizeSource` is now built on `classifySource`**, and the tests assert
  the agreement rather than asserting two lists of expectations: a refused string throws the very
  `TypeError` carrying the classifier's `message`, a byte string loads to the byte-identical buffer, a URL
  loads as that URL. One behaviour change comes with it: a `;base64` data URL is decoded here instead of
  through `fetch()`, so it works without a network stack, and the old `Failed to resolve data URI` failure
  is gone — a data URL whose body is not base64 is refused now, which is the case that previously arrived
  at `atob` and threw a `DOMException` naming nothing. That branch is the single place the classifier has
  to catch, and it is the place its contract would otherwise break.
- **Server-side import is a tested property (`FR-46`).** `src/lib/ssr.test.ts` runs in the Node project,
  asserts first that `document`, `window`, `HTMLCanvasElement` and `Worker` really are absent — a premise
  nobody checks is a premise that quietly stops being true — and then imports **every JS target in
  `package.json`'s export map**, thirteen modules today, each mapped from its `dist/…` name back to its
  `src/…` file. The list is read from the map rather than typed into the test, so a fourteenth entry point
  is covered the day it is added, or the test fails looking for its source. It also pins the helpers that
  *reach* for the DOM: `resolveSourceUrl` with no `document.baseURI` returns the input, and
  `isAllowedSource` keeps refusing a cross-origin URL that a same-origin path entry would otherwise match
  — the asymmetry that makes the allowlist a security feature, asserted in the one environment where the
  document it normally consults does not exist. **Two documentation claims were wrong and are corrected:**
  the README said pdf.js "needs DOM globals at import time, so this package is client-side only", and the
  Installation page said the library "never touches `window` at module scope" as an unchecked remark. The
  true and narrower statement is now in both places: importing is safe anywhere, *rendering* is
  browser-only, so `'use client'` is about the render — and `classifySource` belongs on the server, which
  is where a source string usually gets decided. Not claimed: server rendering or hydration, and the test
  imports the sources, not `dist/`, because `npm test` runs before `npm run build`; the shipped bundle's
  own check is `0.12`'s browser matrix.
- **The size ratchet refused `FR-38`, and this time the answer was to measure rather than to golf.** The
  gate compares against the *accepted* baseline, so two features in one release means the second is the one
  that hits the wall: core stood at 26.69 kB after FR-37 against an accepted 26.14 kB, and `FR-38` pushed
  the total to 27.00 kB — +0.86 kB against the 0.78 kB the ratchet allows. The added bytes are the reason
  codes and the sentences that go with them, which *are* the feature, so the growth was attributed instead
  of trimmed: `src/lib/source.ts` measured 2,055 → 2,926 B minified (971 → 1,308 B gzipped), matching
  core's +0.31 kB for this feature, and the baseline is re-accepted at **core 27.00 kB** / headless entry
  30.13 kB / headless-only path 4.05 kB. 56 tests (39 on the source rule, 17 on the server import) take the
  suite to **602 in 48 files**.
- **A wrong password re-prompts, and the 60 s of silence turned out to be the measurement, not the engine
  (`FR-03`).** `FR-03`'s rewritten clause — an incorrect password must produce an *observable* second
  prompt — is what reopened the row, and `encrypted.test.ts` had closed it with "not covered": neither a
  resolution nor a second callback arrived within 60 s for this fixture. Re-measured against the real
  engine, the premise was wrong in both directions. pdf.js re-asks about **1 ms** after a wrong answer, and
  it re-asks **within the same microtask chain**: `getPassword` → `PasswordRequest` → `loadingTask.onPassword`
  → answer → re-parse → `PasswordException` → ask again, with nothing in that loop ever yielding to the event
  loop. Fed from inside the callback, the engine measured **~27,000 asks a second** (239,947 in 8.9 s). A
  watchdog that has to fire *between* two asks is what never ran — that is the silence that was being read.
  A prompt waiting for a keystroke cannot loop; an automated retry of a stored credential can, which is why
  the hazard is now documented on `PdfPasswordRequest.submit` and on `onPasswordRequired` rather than
  dismissed as obvious. `src/lib/encrypted.reprompt.test.ts` then asserts the requirement at the engine
  boundary: the asks become `[NEED_PASSWORD, INCORRECT_PASSWORD]`, the second one is *still* parked after
  50 ms of timers that could have run, and answering it with the right password opens the document. One load
  per process, for the reason `encrypted.test.ts` already gives — an abandoned encrypted load wedges the
  Node fake worker. One test added, the suite at **603 in 49 files**, and **core unchanged at 27.00 kB**:
  everything shipped that touched this was a comment, which is the price a requirement should cost when the
  behaviour was already there and only the proof was missing.
- **The device pixel ratio is watched now, not sampled (`FR-07`).** The ratio was always *readable* and that
  was the whole problem: `PdfPage` asked `window.devicePixelRatio` inside its render effect, so a window
  dragged to another display changed nothing until the reader zoomed or scrolled. There is no
  `devicePixelRatio` event, so `src/lib/dpr.ts` uses the one there is — a media query pinned to the current
  value, `(resolution: 1.25dppx)`, which stops matching the moment the device moves off it. The premise was
  measured in Chromium before it was written down: at 1.25 the query for `1.25dppx` matches and the ones for
  `2.5dppx` and `1.55dppx` do not. **`caniuse-lite`'s `css-media-resolution` is what added the second
  channel:** Chrome, Edge and Firefox are `y` at every floor this package advertises, while Safari and iOS
  Safari are partial-and-unknown below 16 — inside the floor — and an engine that does not know a media
  feature evaluates a query for it as never-matching, which is a watcher that silently never fires on
  exactly the browsers nobody has open. So the feature is detected by asking a question it must answer yes to
  (`(min-resolution: 0dppx)`, measured beside two controls that answer no: an unknown unit, an unknown
  feature) and where the answer is no the ratio is re-read on `resize`. Both channels dedupe on the number,
  so one move is reported once and a `resize` that changed nothing is reported never. One hub per realm,
  refcounted per *subscription* rather than per callback, because React's StrictMode subscribes and
  unsubscribes the same function around a double mount and a keyed set would have dropped a live watcher;
  a long document's pages therefore share one media query instead of one each. `PdfPage`, `PdfThumbnail`
  and the shell's canvas budget all read `useDevicePixelRatio()`, and a host that passes `devicePixelRatio`
  explicitly gets a value that cannot move, so a monitor switch does not repaint what it pinned.
- **`0.3`'s "read the ceiling once" decision is reversed, on purpose and in the comment.** The canvas budget
  is the screen's pixel count scaled by the density, so a stale ceiling clamps pages a 2× display could have
  painted; `0.3` kept it steady to avoid re-rendering everything on a hot-plug, and `FR-07` made
  re-rendering everything the requirement. Measured in the playground on `long-sample.pdf`, with the real
  code path and only the environment value substituted: a `resize` at an unchanged density produced **0**
  canvas ops against patched `CanvasRenderingContext2D` counters and left the buffer at 792×1025; one event
  with the ratio moved 1.25 → 2 produced exactly one repaint (10 `drawImage`, 2 `fillRect`, 9,534 `fillText`)
  and the buffer went to 1268×1640 while the CSS box stayed 634×820. **What is still not proven, and named
  as such:** that the media-query channel fires on a real switch — no page can change its own
  `devicePixelRatio`; overriding it in JavaScript moves the number but not the media feature, which is why
  the browser run above goes through the `resize` path — and whether every display switch fires `resize` on
  every engine. Both are `#141`'s. 16 tests (13 hub, 3 page); core 27.00 → **27.39 kB**, inside the
  ratchet's slack, and the headless entry unmoved.
- **The page box says what the page is called (`FR-12`).** The requirement's new clause — a reader who sees
  "xii" should be able to type "xii" — was untestable before this, because nothing in
  `playground/fixtures/` carried a `/PageLabels` dictionary at all, so `scripts/make-labelled-pdf.mjs` now
  writes one: roman front matter, a decimal body restarting at 1, an appendix as `/P (A-)` plus a numeral, ten
  pages, and every page painting the label it expects. Then pdf.js was asked rather than assumed: it answers
  `i ii iii 1 2 3 4 5 A-1 A-2`, composing the prefix and restarting at each range, and answers **`null`** for
  a document that declares nothing — which is the case for nearly every PDF there is, so the ordinary path is
  "no labels", not "labels that happen to be numbers". `src/lib/page-labels.ts` holds both directions and the
  two decisions in them. **Label first, number second:** page 6 of that fixture is labelled "2", so a reader
  typing "2" means the fifth page, and the numeric reading would land them on the page whose box says "ii";
  the display is what they are copying. **Clamping stays, but as the fallback and not the parser:** a whole
  number that names no label clamps into the document ("999" reaches the last page), and anything else is
  refused — including "3a", which `Number.parseInt` cheerfully reads as 3 and which a number input used to
  make unreachable, the box being unable to hold it. That is also why the control's `type` switches:
  `type="number"` reports "xii" as the empty string, so a label box cannot be a number box, and
  `labelsDifferFromNumbers` is what decides per document, spinner and numeric keyboard intact otherwise.
  `usePdfPageLabels(doc, signal)` is the read — once per document handle, `null` on a rejected read, and no
  round trip at all for a host who has already stopped, which is the rule FR-36 sets for the nine sites it
  names extended to the tenth that just appeared.
- **The size gate refused `FR-12`, on the `shell` path, and the answer was the same as last time: attribute,
  then accept.** Core moved +0.37 kB and `headless-only` +0.01 kB, while the shipped-file sum moved +1.44 kB
  and broke the ratchet — the same shared-chunk reshuffle `FR-36` recorded (a new chunk appeared, and sums
  are not sums of deltas). The new modules measure 412 B and 254 B gzipped on their own, next to a code path
  that touches one input element and one round trip, so the growth is the feature and `size:update` re-accepts
  at **core 27.76 kB** / shell 57.90 / headless 30.85 / `headless-only` 4.06 — which also folds in the 0.39 kB
  `FR-07` had left inside the slack. 29 tests in four files take the suite to **654 in 54 files**.
- **What the browser pass could and could not show, and the harness reason for both.** In the playground with
  the real engine on the new fixture: the box came up as a text input reading "i", page 1's own text layer
  saying `page 1 of 10, labelled "i"`, and typing "A-1" scrolled to 5760 px — 8 × (704 + 16), the top of page
  9 — where the imperative `goToPage(5)` control lands at 2880, so the arithmetic is the same one and the
  label resolved to the right page. What it could *not* show is the box following the reader back as they
  scroll, because the in-app tab reports `visibilityState: hidden` and never runs a frame: `requestAnimationFrame`
  is paused there while timers still fire, and the page in view is frame-driven. A separate finding, and not
  about labels: no test in this repository has ever mounted the real `useViewerController` against a *ready*
  document, and trying hangs jsdom outright, so the shell's page path has never been under test at all —
  filed with the rest of the browser-only evidence for `#141` and `#148`. The page-to-box direction is
  therefore asserted against a stub controller, where it can be.
- **A Sign section in the Pages tab** (`pdfjs-react-reader/edit`). Draw once in the pad, click the box
  you want it in, and the mark is written into that field's appearance stream. The document's boxes are
  listed with the page each is on, one Sign control per box, the pad's pixels arriving as page points
  scaled to the clicked box rather than stretched to the largest one. Three things a host should not
  have to trust me to have got right: **a field that already holds a `/V` is refused**, because on a
  `/Sig` that is somebody's claim over the bytes and not an empty box; **the file is never given a
  signature value**, so what ships is a picture of a signature and the panel says so in as many words
  (`signatureNotCryptographic`); and **nothing is written until the reader asks**, the way the rest of
  the tier already works.
- **`findSignatureFields` and `signFields`** (`src/lib/pdf-write.ts`), exported from `/edit`, and
  settled by Spike D in `ROADMAP.md`. The listing walks `/AcroForm/Fields` *and* each field's `/Kids`
  widgets, since a signature field's box often lives only on the kid; the writing resolves each widget,
  builds an `/XObject /Form` appearance whose `/BBox` is the widget's own `/Rect`, and registers it
  through `doc.context.stream` + `context.register`. Verified on all three shapes a real file offers: a
  self-field, a parent with a `/Kids` widget, and a `/F 20` no-rotate box — a fixture with exactly one
  signed field in it, `playground/fixtures/signature-sample.pdf`, from `scripts/make-signature-pdf.mjs`.
  That script writes two files: the empty form the panel and the tests read, and
  `signature-signed-sample.pdf`, the same document with three deliberately different silhouettes already
  in the three unsigned boxes — which is the file the browser pass below measured with.
- **`src/lib/signature.ts`** — the geometry alone, with no writer and no DOM in it: `padToBox`,
  `boxToPage`, `isSignable`, `signatureContent`. Exported from `/edit` on purpose, so a host writing
  its own pad gets the axis flip that is otherwise the easiest thing in the feature to get wrong. The
  seam test is the reason it is separate: a mark drawn in the pad's CSS pixels has to land inside the
  rectangle of the box that was clicked, in that box's coordinates, and 150 × 40 was chosen for the
  second box precisely so the wrong scaling reads as different numbers.
- **`signField(field, points)`** on the feature's published state, resolving false when nothing was
  written — an empty path, or a name the file does not hold — so a host that wants signing outside the
  sidebar can place it from there and say so honestly when it did not land. The list of boxes is not
  published: a host gets it from `findSignatureFields`, which is what the panel itself calls.
- **Ten labels**, and all three catalogs with them: 134 keys at the `0.8` freeze, **144** now, which is
  the count a type cannot check and `locales.test.ts` can.
- **A *Behaviour under load* section** in `README.md` and on the docs Introduction, with `PRD.md` §6 as
  their source: frame timing on the 1,000-page fixture (p50 7.0 ms, max 14.1 ms, no frame over 16.7),
  38–55 ms to reach and paint a cold page, the text layer's 39.8 ms → 1.0 ms, the signature listing's
  150–200 ms on a file that declares a form against 0 ms on one that does not, batched writes, and
  ceilings that refuse instead of crashing. Every one measured in Chromium on one Windows machine, and
  said as much.
- **The failure paths, finally exercised** (`#153`). `PRD.md`'s edge-case list — "damaged files,
  encrypted documents, rotated pages" — had two of three covered: rotation is tested in eight files, and
  nothing had ever asked pdf.js to open a broken or protected file. Now: `scripts/make-damaged-pdf.mjs`
  writes `damaged-truncated.pdf` (cut mid-object) and `damaged-xref.pdf` (whole file, a `startxref` that
  lies); `damaged.test.ts` loads both through the real engine; `encrypted.test.ts` asks what a protected
  document does; `PasswordPrompt.test.tsx` is the first test that component ever had; and
  `ViewerLayout.failure.test.tsx` pins what the reader sees and what the retry button actually re-asks.
  What measuring turned up, none of it guessable:
  - **Two kinds of damage behave differently, and both are normal.** A truncated file rejects with
    `InvalidPDFException: Invalid PDF structure.`; a file whose `startxref` points past the end — same
    length, intact header — **loads all three pages**, after pdf.js warns that it is re-indexing every
    object. "Damaged files show an error" was only ever true of one kind, and the tests hold both
    outcomes open. A single fixture could have been written to look like either.
  - **An encrypted document does not reject; it parks.** The load waits on a `NEED_PASSWORD` callback,
    and abandoning it by passing an `Error` — what the prompt's cancel does — rejects with
    `PasswordException` code 1, `No password given`. The right password opens it (one page). A wrong one
    produced neither a resolution nor the second `INCORRECT_PASSWORD` callback in a 60-second window, so
    the re-prompt is recorded as **unproven for this fixture** rather than asserted. **That reading was
    superseded on 2026-09-30,** and the superseding is the interesting part: the callback does arrive, about
    1 ms after the wrong answer, inside a microtask chain that never yields — so what the 60-second window
    was measuring was the harness. See the `FR-03` bullet earlier in this section.
  - **Sequential encrypted loads wedge Node's fake worker.** A probe running abandon → wrong → right in
    one process printed only its first line; each case needed its own process, which is how
    `encrypted.test.ts` is arranged.
  - A `Buffer` is refused by pdf.js on the call rather than as a rejected promise — and
    `normalizeSource` passes one through, since a Buffer is a `Uint8Array`. Left alone deliberately, with
    a test that stops anyone claiming bytes just work: no document promises a Buffer, and copying every
    byte array to satisfy an engine preference is the owner's call, not a silent side effect.
- **The worker's four states, asserted (`FR-02`).** `ensureWorker` probes two candidates and writes neither
  when both fail, and `worker.test.ts` had always proved that much. What `FR-02`'s rewritten clause named —
  "fall back to a main-thread worker rather than failing when neither resolves" — had never had a document
  loaded through it, and loading one is what closed the row. `src/lib/worker.fallback.test.ts` and its three
  siblings hold one state each, in a process of their own, because pdf.js memoises the fake-worker lookup per
  module instance and a second state in the same process would be measured against the first one's answer.
  With nothing pinned, a document loads and page 1 produces its operator stream on the main thread — pdf.js
  writes its own `./pdf.worker.mjs` default under `isNodeJS`, and there is no `Worker` global in Node to
  construct even if it asked. With the handler on `globalThis.pdfjsWorker`, it paints with **no URL at
  all**. With neither, the load fails naming `workerSrc`. With a dead URL — precisely what an unprobed
  candidate would have written — it fails naming a failed import instead, which is the second reason nothing
  is guessed at. The pixel half cannot be produced in this harness, so it was produced in a browser: a
  400×518 canvas render of the same fixture painted **1,728 non-white pixels with 0 `Worker` constructed**,
  against a control that built **1** worker and painted the same page — the control being what makes the
  zero mean anything. `src/headless/usePdfDocument.worker.test.tsx` adds the host-facing half: the advice
  this package appends to the engine's sentence is conditional on auto-detection having run and failed, so a
  reader who pinned a URL themselves is not told to pin the URL they already pinned.

### Changed

- **`FR-02`'s fallback clause was restated by the same kind of measuring, and this time the limit was the
  engine's.** The row said the package falls back to a main-thread worker when neither a local module nor a
  CDN URL resolves. pdf.js's "fake worker" *is* the worker's own parser, so that code has to be reachable
  without a URL, and there are only two ways it is: pdf.js's `isNodeJS` default, and a host that has assigned
  `globalThis.pdfjsWorker` itself. An ordinary page with neither does not fall back — it fails, in a browser
  synchronously from `getDocument` itself. What the package really guarantees is now what the row says:
  leaving `workerSrc` unset keeps those two states reachable, and the failure names the option the host owns.
  No behaviour changed — `ensureWorker` already left the field alone, and the dead-URL state measures what
  pinning a plausible candidate would have cost. Four documents carried the larger claim until this row
  closed, and all four were corrected: `README.md`, `docs/src/pages/Installation.tsx`, and
  `docs/src/pages/Compatibility.tsx` — which said "the pdf.js fake worker takes over" about a bundler whose
  `import.meta.url` cannot be used, when that failure empties the candidate list and a browser page simply
  fails — plus `CODE_REFERENCE.md` §10 and its §14 failure-path row. `src/lib/worker.ts`'s comment on
  `ensureWorker` was rewritten to the measured scope, and it is the only shipped file this touched.

- **`FR-08` was restated because a measurement said the requirement was wrong, not the code.** It asked
  that switching layout mode "does not re-render what is already painted". In the playground, counting
  canvas ops and tagging canvas nodes for identity: at a fixed 125 % zoom, spread → continuous kept the
  scale at 1.25, kept the same canvas nodes (so no remount), kept their 956×1237 backing stores and
  produced **1** op. In a fit mode the same switch moved scale 1.04 → 0.50 and re-rendered every canvas
  from 792×1025 to 386×499 — correct rather than wasteful, because fitting two pages into one width is a
  different fit than fitting one. The clause was unsatisfiable as written and now states the invariant the
  code actually holds: switching regroups rows without remounting a page, and repaints only when the fit
  target itself moves. The second time in this project a measurement changed a requirement instead of the
  code, and the reason that row was measured rather than read from source.
- **The per-feature ceiling moved from 4 kB to 6 kB, in the assertion that enforces it**
  (`scripts/check-size.mjs`; the decision is recorded in `ROADMAP.md` under *Signing shipped, where it
  landed*). Worth being exact about why this is a decision and not a relaxation: the gate is a constant
  in the script, not a line in `size-baseline.json`, so
  `npm run size:update` cannot lift it — the number had to be argued for. Signing cost 4.73 kB over
  core before its interface existed, and that is the writer pass plus the geometry, which is what a
  tier that modifies a file is. Meeting 4 kB would have meant shipping a page-organiser with no
  signing to a reader who expects one. `edit` now measures **5.72 kB**, and the whole tier set 14.44 kB
  over a 24.96 kB core.
- **A document's expensive question is asked when it is needed.** The first cut of the panel listed the
  boxes when the tier mounted, which put a 150–200 ms main-thread parse behind opening a sidebar tab on
  any file that had a form. What ships asks the engine's metadata first — one round trip, and a document
  that declares neither `/AcroForm` nor XFA never reaches the writer at all — and the parse waits until
  the reader has drawn something to place. A test counts the `getData` calls to keep the ordering, since
  the regression here is invisible to anything that only checks the result.
- **`CODE_REFERENCE.md`** — a reference for this package whose source of truth is the code, not `PRD.md`.
  Twenty-two sections: every export path and the names on it, all 35 `PdfViewer` props, the ten handle
  methods, the eight features with their control ids and priorities and panels and keys, every constant
  with its value, the label catalog, the test and toolchain inventory, what is *not* done, and a closing
  table of each place a document and the code disagree. Written against `dist/*.d.ts` and `src/`, with a
  §22 of one-liner commands that re-derive every number in it, because a document like this is only worth
  its length if it can be checked. `scripts/inventory.mjs` (promoted out of the scratch tree) is the
  generator for the name lists and is tracked for that reason — §22 tells a reader to run it.
- **`PRD.md` was read line by line against the source, and corrected** (2026-09-29). Eleven findings in
  the PRD itself, one in the docs API table (`edit` "9 names", where `inventory.mjs` reads 32 — the row
  predates signing, which added eleven of them) and one in the Requirements rows here ("19.3.0, in CI",
  when the job that ran on 2026-09-24 installed whatever the lockfile pinned and no job had installed 18).
  Most of the PRD's were in the 2024 prose
  that later releases had not revisited: the §3 diagram offered `usePdf` and `usePage`,
  which were never built, and a `Modal`, which does not exist (`grep Modal src/` → zero files); §3.1
  claimed three page layers where `PdfPage` stacks six; FR-11 quoted a thumbnail scale of 0.15–0.25 where
  the component computes `(cardWidth / base.width) × dpr` from a measured grid; FR-16 and FR-18 both
  called signing an overlay, when the SVG is the in-memory ink layer and a signature is a canvas pad
  written into `/AP`; FR-19 promised full-resolution printing of the entire document, when the scale is
  whatever fits 256 MiB and the range is selectable; FR-20 promised a flatten on download, which is
  `saveEdits` being mis-described — the code comment has said "this is 'save', not a true flatten" since
  `0.7`; FR-23's acceptance note listed four size markers where the gate configures eight, two of which
  are not hook names. §4.9 (FR-29–FR-33) was added, because `0.6`–`0.8` shipped an editor, a page writer,
  a flatten, signing and XFA display with **no requirement for any of them** and §4 still ended at FR-28;
  §6 gained an Error Handling bullet, because `ViewerLayout.failure.test.tsx` cites "PRD.md's
  error-handling line" and there wasn't one — the behaviour was shipped, tested and unrequired.
- **Three claims in my own new reference were found and removed.** §12 of the first draft said search
  indexes "lazily in viewport order from the current page, stopping at the first match", that `F3` moves
  between matches, and that print opens an about:blank window. None of the three is in the code —
  `extractAllText` walks every page in order, `SearchBox` binds `Enter`/`Shift+Enter`/`Escape` and no
  `F3`, print appends `div.pjsr-print` to the current document — and none was copied from a document
  either, so they were invented details that happened to sound like the architecture. Recorded in §21 of
  that file as well as here, since a code-derived reference that fabricates is worse than the stale one it
  replaced.
- **`PRD.md` was rewritten as a target specification** (2026-09-29), on the owner's instruction to write
  the document for the best possible package and reconcile it against the code afterwards rather than
  letting today's implementation bound the ambition. It now carries **51 requirements**, up from 33.
  FR-01 – FR-33 keep their ids, their wording and their subsections, so every citation in `ROADMAP.md`,
  in tests and in `scripts/` still resolves; §4 remains the requirement matrix, §6 the NFRs and §7 the
  milestones, because `check-size.mjs` cites §6 and `make-damaged-pdf.mjs` cites the Error Handling bullet
  by name. **FR-34 – FR-51 are new**, and every one of them came out of the second draft or out of the
  gap review that preceded it: the network contract (`httpHeaders`, credentials, range and streaming
  controls), bounded retries that never retry a 401, an `AbortSignal` on every asynchronous operation,
  exported source utilities, published document and page state unions, incremental viewport-prioritised
  indexing, an injectable external index, dual ESM and CJS output, document merge, structure-tree
  accessibility, forced-colours rendering, a WCAG 2.2 AA target, an SSR-safe module graph, touch and
  gesture arbitration, browser and engine verification matrices, a benchmark fixture suite for all four
  profiles, published API maturity tags, and an edge-case suite.
- **What the rewrite deliberately does not do is annotate itself.** The previous `PRD.md` carried an
  inline note on every requirement the code did not yet meet, which kept the document honest and made it
  unreadable. Rule 2 at the top of the new file moves that answer to one place: `PRD.md` is the
  requirement, `CODE_REFERENCE.md` is the present state, and the gap between them is the work list. The
  as-built document — every requirement annotated with whether the code met it, and every figure carrying
  its provenance — is preserved as **`PRD_as-built_2026-09-29.md`**, banner-marked as a snapshot. It was
  uncommitted when the rewrite replaced it, so keeping it was the reversible choice rather than a
  preference.
- **Nine line-number citations into `PRD.md` were repointed to sections,** in `ROADMAP.md` and
  `scripts/make-long-pdf.mjs`. A full rewrite moves every line, and `PRD.md:22` had already been cited
  from four places that all meant the same performance bar; they now say §2.1, which cannot rot the same
  way. The one in `CHANGELOG.md` was left alone on purpose — a changelog entry describes the state at its
  date, and rewriting history to fix a pointer is the worse trade. The two under `.spike/` are in a
  gitignored scratch tree.
- **The scope question the rewrite opened is answered: `1.0.0` ships all 51 requirements.** For one day
  `PRD.md` §7 ("1.0 — the lot") and `ROADMAP.md`'s GA gate (`FR-01`–`FR-33`) disagreed, and the
  disagreement was recorded in both files rather than resolved silently. The owner chose the PRD. So the
  release sequence no longer ends at `0.8`: **`0.9` Reach** (FR-34 – FR-38, FR-46 — the network contract,
  retries, cancellation tokens, published state unions, source utilities, SSR-safe import), **`0.10`
  Access** (FR-43 – FR-45, FR-47 — structure tree, forced colours, WCAG 2.2 AA, gesture arbitration),
  **`0.11` Index & Assemble** (FR-39, FR-40, FR-42 — incremental and injectable indexing, merge) and
  **`0.12` Prove** (FR-41, FR-48 – FR-51 — browser and engine matrices, the fixture suite, maturity tags,
  the edge-case suite, dual module output) are planned in `ROADMAP.md` §Releases, each with a gate. Prove is
  last on purpose: it certifies everything before it.
- **Two consequences of that decision are written into the roadmap rather than left to be discovered.**
  First, **the rewrite tightened requirements that the status table calls done.** FR-01 – FR-33 kept their
  ids and subsections, but `FR-03` now demands an observable second prompt on a wrong password — which we
  read at the time as *not* happening within 60 s, and which `0.9` then found had been happening all along,
  ~1 ms after the wrong answer (`FR-03`'s row, and the bullet above, carry the re-measurement) — `FR-07`
  now demands the pixel ratio be re-read when it changes, and `FR-12` now demands page labels.
  `FR-08`, `FR-14` and `FR-17` need checking. Reconciling all 33 rows
  against the new wording is `0.9`'s task 0, before any feature work, because a plan built on rows that say
  "done" when the requirement moved has holes in it. Second, **`0.12`'s theme is CI jobs and nothing is
  pushed until `1.0.0`**, so the first real execution of the browser and engine matrices is the release
  push itself. The alternative — pushing `dev` before `0.12` starts — breaks the 2026-09-25 shipping rule
  and is the owner's call.
- **The two PRDs are now one** (2026-09-29). A second, independently written `PRD_v2.md` was reviewed
  against the first and against the code, and merged into `PRD.md` rather than kept beside it — two
  specifications for one package is how a reader ends up building from the wrong one. What the draft
  contributed was structure the older file lacked: scope tiers split into *ships in `1.0`*, *deliberately
  after* and *the separate editing capability* (§2.2–§2.4); a module map and the published entry-point
  table (§3.2); concurrency and state models (§3.3–§3.4); API maturity tags with a change policy per tag
  (§5.4); and, in §6, an engine-compatibility policy, four named benchmark profiles, a security boundary
  list, a search-architecture statement, a React/runtime row and licence governance. Its rule that *every
  code example must compile against the published export map* is now §5's preamble, and it earned its keep
  immediately, twice over: §5.1 had imported `PdfPage` from `pdfjs-react-reader/headless` in **both**
  drafts, where that entry exports no React components; and the corrected example still did not type-check,
  because `PdfPage`'s `doc` prop is `PDFDocumentProxy` and not `PDFDocumentProxy | null`, so the slots have
  to render behind a `doc &&` guard. Both were found by dropping the example into `docs/src` and running
  `npm run typecheck` — the scratch file was removed afterwards, and the example in §5.1 is now the one
  that compiled.
- **Nine of the draft's statements were contradicted by the code, and each was corrected rather than
  copied.** A `/features/search` entry that does not exist (search stayed core); `base64ToPdfSource()` as
  an external utility, where base64 is a first-class source string classified inside `normalizeSource` and
  the decoder is not exported; an `AbortSignal` on every async operation, where the real mechanism is
  effect-scoped `cancelled` flags plus `task.cancel()` and `RenderingCancelledException` swallowed by name;
  two named state unions — `idle → loading → password-required → ready → error → destroyed` and
  `unrequested → queued → …` — of which neither enum exists, so §3.4 specifies the observable fields and
  the invariants instead; "both ESM and CJS outputs", where the build is ESM-only and has never emitted a
  `.cjs`; SSR validated for Next.js, where the package is client-side and `readCanvasEnvironment` exists
  precisely because it is; `merge` in the editing tier, which is not in `src/edit.tsx` or `dist/edit.d.ts`;
  pdf.js internals "never exposed as the public extension contract", where `dist/index.d.ts` ships an
  `annotationEditorUIManager` prop typed with the engine's own class — kept, and §5.4 now names it as the
  reason the engine policy pins a major; and incremental/lazy search indexing, which re-imported the
  invention removed from `CODE_REFERENCE.md` the same day. Its `< 55 ms` cold-page target was declined for
  a related reason: that is the top of our own measured range on one machine, and §6 records why a maximum
  observed on one device does not become a requirement.
- **`PRD_v2.md` is banner-marked superseded, not deleted.** It is untracked, so removing it would be
  unrecoverable, and it is the only record of what the draft proposed. Nothing else in the repository
  references it.
- **A false claim in `CODE_REFERENCE.md`, found while re-verifying the above.** §16 said of the CI
  workflows: "None of it has run." GitHub Actions reports 22 runs, the last green on both `main` and `dev`
  at `5059bc7` on 2026-09-24, covering `verify`, `docs` and `consumer`. Rewritten to say what actually ran,
  and to state the two limits that were hiding behind the overclaim — **every job is Node on
  `ubuntu-latest` and none starts a browser**, so no CI run has ever exercised a rendering path, and the
  `react` job added the same day has not run at all. The same sentence was corrected in the §21 log and in
  project memory. `PRD.md` §6's compatibility matrix is written against that: one row tested, six not.
- **CI now covers the React half of the peer range.** `peerDependencies` has advertised
  `^18.0.0 || ^19.0.0` since `0.2` while every job installed 19, and the docs said 18 was verified —
  which had been true once, by hand, at `0.1`. Rather than downgrade the sentence, the claim was tested
  and then made durable: with `react`, `react-dom` and both `@types/*` swapped to 18.3, `typecheck`, all
  428 tests and `build` pass (the source uses `useId`, which is 18+, and `forwardRef`; nothing 19-only),
  and a `react` matrix job in `ci.yml` installs majors 18 and 19 on every push. **The job has not run
  yet** — no `0.x` commit is pushed — so what is verified today is the local run, and the job is what
  keeps it verified afterwards. The suite grew underneath that record — it is 449 now, and the first pass
  was made at 428 — so it was re-run on 2026-09-29 rather than restated: `react`, `react-dom` and both
  `@types/*` at 18.3, and `npm run verify` end to end (typecheck, **449 tests in 38 files**, both
  bundles, the size gate at 24.96 kB core / 5.72 kB `edit` / 14.44 kB all) passes on React 18. Then
  `npm ci` put 19.3.0 back, which is what the lockfile and `package.json` name.
- **`FR-25` no longer requires an engine this package does not support.** It asked that attachments work
  on both the 5.x and the 6.x engine shapes, while the peer floor has been `^6.2.108` since `0.6`. The
  branches the roadmap had also slated for deletion stay, by decision: `ViewerController`'s feature test
  exists so that an engine without `getAttachmentContent` reads as "nothing to fetch" instead of throwing
  inside pdf.js's own click handler, and removing a graceful degradation to emphasise a peer constraint is
  the wrong trade. So the requirement now says what is true — 6.x supported and tested, the 5.x *data
  shape* tolerated and unit-tested, no other 5.x surface supported — and `attachments.ts`'s header says
  "tolerated" where it had gone on saying "the peer range allows both" after the floor stopped allowing it.

### Fixed

- **Flatten threw on any form whose signature box had never been signed** — a defect shipped in `0.7`
  and found by the signing fixture, not by a reader. `@cantoo/pdf-lib`'s `flatten()` needs each widget's
  `/N` and reports `Unexpected N type: undefined` when one is missing, which is what an unsigned form
  looks like: boxes with no appearances at all. `flattenBytes` now gives any such widget an empty
  appearance in its own box before flattening, so the page it is on
  flattens as the blank it actually is. Covered in both directions — a form with an unsigned box
  flattens, and one already signed keeps its appearance through the same pass.
- **The panel called an empty appearance "Already signed"** — found by running the panel in a browser,
  not by a test. Three of the fixture's four boxes came up saying it, two of them holding an appearance
  stream that draws nothing, which is what an unsigned form often carries and what the fixture writes on
  purpose. The meta line was reading `hasAppearance` while the refusal and the disabled control read
  `alreadySigned`, so the panel told a reader a box was signed and offered to sign it in the same
  breath. The meta now reads from `/V`, like every other claim on that row; `hasAppearance` stays on the
  published field data for a host that wants the weaker question.

### Notes on verification

- **A written mark paints, in the file and in the session.** A browser pass on the playground answered
  the half of this that `#144` was holding open, and it also corrected a wrong reading taken earlier in
  the same investigation. Loading `signature-signed-sample.pdf` found all three written marks **inside
  their own boxes** — the 200 × 60, the 150 × 40, and the `/F 20` box on page two — with nothing in any
  box for the unsigned file and only its own band in the box that holds a `/V`. Driving the panel
  instead of a file took page one's `sigPlain` box from **0 to 856 ink pixels** on the Sign click, and
  the mark stayed painted through a zoom step in and back. So the appearance format is right, a
  no-rotate flag does not cost us the display, and `annotationCanvasMap` is not needed for either case
  we can produce.
- **How the wrong reading happened, because it is easy to repeat.** The first pass counted pixels of the
  colour the *fixture* strokes with — `0.05 0.08 0.2 RG`, a navy — and found the in-session box empty,
  which was written up here as a repaint defect and filed as one. The writer draws in **black**:
  `signatureContent`'s default style. A navy filter cannot see the product's own mark, and the earlier
  "10 pixels, then 0" was the same mistake at two moments. The corrected method names no colour — hash
  the box's pixel region and count dark pixels before and after — which reports a change whatever the
  writer drew with. Two lessons with teeth: **a pixel assertion needs the colour the code under test
  actually chooses**, and a claimed defect should be re-measured with a method that could have found its
  opposite before it is written down. The jsdom half still holds: no canvas 2D context there, which is
  why this needed a browser at all.
- **A claim made during the spike and then withdrawn.** `ROADMAP.md` recorded that a `/F 16`
  (no-rotate) signature box paints nothing in our viewer, because pdf.js would not take its own-canvas
  path. The probe that showed it sampled a page-1 rectangle for a page-2 annotation, and re-measured
  correctly the engine reported `noRotate: false` for the box I had set `/F 20` on. The claim is
  retracted in the roadmap and the flag is carried as data (`noRotate` is what the file says, and
  `findSignatureFields` reports it) rather than as a behaviour.

- **The gate's bearer-token clause, met at the close rather than restated away.** `scripts/auth-server.mjs`
  serves `playground/fixtures/` on :5300 and answers 401 to anything without `Authorization:
  Bearer dev-token`, and the playground grew a token box wired to `httpHeaders`. Without the token the
  shell read *"Failed to load PDF: Unexpected server response (401) while retrieving PDF
  …/outline-sample.pdf"* with **0 canvases** and a working **Try again**, and the server logged **exactly
  one** request for that load — `FR-35`'s never-retry-a-401, observed rather than asserted. With the token
  the same URL gave **3 canvases**, page 1's 792×1025 buffer holding **5,117 non-white pixels**, a text
  layer reading "Page 1: Introduction", and "of 3" in the bar. Retyping the token to a wrong value without
  re-opening the URL reached the server **zero** times and left the document on screen: the
  read-at-load-start rule, in a browser rather than in a mock.

Tests went 393 → **449** across 38 files through the signing and failure-path work, and 449 → **661**
across **59 files** through `0.9` itself — 268 since the `0.8` close, the largest shares on the network
contract, the retry verdicts, the host signals and the ten sites that had to accept one, the published
state unions, and the four worker states. Typecheck, both bundles, the docs build and the size gate are
clean, every size path sits at +0.00 against the baseline re-accepted at `FR-12`, and `0.9.0` is now the
version in `package.json` — committed on local `dev`, nothing pushed and nothing published, because the
`0.2`–`0.9`
sequence goes out together as `1.0.0`.

## [0.8.0] — 2026-09-27

Hardening, and the freeze review. This release changed no API a host had to act on, added three
languages and one docs page that says what the package has been promising, and spent most of its time
on measurements that turned out to disagree with the reason each task was written down for. Two of the
five defects closed here were closed by finding the premise was wrong rather than by fixing the code.

The one that set the tone: `#137` asked for an XFA fixture whose fields bind, on the reading that ours
do not, because the rendered input carries a `fieldId` and no `data-id`. `XfaLayer.setAttributes` has
`case "dataId": break;` — the key is read from the layout object, used to attach the binding, and
deliberately never written to the DOM. Asking the question the way the task framed it could only ever
return "no". Asked as "does a keystroke arrive in annotation storage", on the fixture that already
existed, it arrives: `annotationStorage.size` goes 0 → 1. So the reader's edit is recorded and cannot be
written back, because `saveDocument()` throws on a pure-XFA document — which is what makes the download
guard right, and the comment above it now says that instead of the binding story.

### Added

- **Three locale catalogs**: `pdfjs-react-reader/locales/de`, `/fr`, `/es`. 134 strings each, typed as
  the complete `PdfViewerLabels` rather than the partial a host may send — so a key added to the English
  source stops all three building until it is answered — and frozen, since a catalog is shared by every
  viewer on the page. **2.18 kB gzipped** apiece. Separate entry points, not exports of the index:
  importing the viewer must not hand you a language you did not ask for, and `core` is unchanged at
  24.77 kB. `src/locales/locales.test.ts` asserts what a type cannot: the key list matches exactly, no
  value is empty or padded, every `{page}`-style slot survives translation with its name intact, and the
  catalog translates rather than echoing (four exceptions, each named in the test).
- **`PdfThumbnail` composes an XFA page's form** (`#136`). Such a page has no painted page — its canvas
  measures zero non-white pixels — so every thumbnail of an XFA document had been a blank card with a
  number under it. The card now runs the same `XfaLayer.render` the page does, against the document's own
  annotation storage, sized by `--total-scale-factor` at the card's scale.
- **The API surface page** (`docs`, `#/api`): every value export of the three barrels, what it is for,
  and the library layer grouped by module with its names listed verbatim. `1.0` freezes this list, and
  60 of the index barrel's 115 values were named nowhere in the docs before it — thirteen of them outside
  `lib/`, including whole components a host is meant to compose. All 115 are named now.
- **An upgrade table**, release by release from `0.2` to `1.0`, on the compatibility page: what changed,
  and what to do.
- `meanBox` and `spreadSample`, exported from both barrels — the estimator `#138` introduced, on the same
  criterion the rest of the library layer is judged by: a host writing its own windowing needs it.

### Changed

- **Rows the page-measurement has not reached are sized by the document's mean box, not page 1's**
  (`#138`). The virtualizer now fetches twelve pages spread from the second page to the last alongside
  page 1 and lays out every unmeasured row at their mean. On the 1,000-page fixture, the laid-out height
  once the first measurement lands went from **809,005 px — 15.2 % short** of the 954,482 px the document
  turns out to be — to **954,010 px, 0.04 % short**; where every one of 42 layout commits had been more
  than 5 % off, now exactly one is, and that one is the frame before any page has been fetched, which no
  estimate can reach. What did *not* change is the commit count, which is the finding: a chunk's
  twenty-odd `reportPageDims` calls already land as one render, because React batches what one
  synchronous tick schedules, so the batching pass this task asked for would have bought nothing.
- **A zoom step re-lays the text layer out instead of rebuilding it** (`#140`). `PdfPage` had built its
  `TextLayer` on `viewport`, which is a new object for a new scale exactly as for a new page, so every
  step of a pinch threw the spans away and asked the worker to extract the page again. 39.8 ms against
  **1.0 ms** for the tracemonkey title page's 163 spans; 9 ms against 0.2 ms for a two-span page, which
  says the cost was the round trip and not the text. Verified through the shell: a span tagged before the
  step is the same node after it and after a step back, with a byte-identical box, and the page's 56
  search marks are still 56. A *turn* still rebuilds, on purpose — pdf.js's `update` re-applies rotation
  to the layer box, not to spans positioned against the viewport it was built with.
- **The React abort `0.7` reported is gone, and the performance bar moved with it.** Eleven
  `Maximum update depth exceeded` errors on the stress pass became none to two, and the 1,000-page
  fixture's reader-speed pass re-measured at p50 7.0 ms and max 14.0–14.1 ms with **zero** frames over
  16.7 where it had been clean-but-max-14.0 already; the 1,100 px/frame pass, which had peaked at
  20.9 ms, now peaks at 14.0 with the same zero. This is a side effect of the two changes above rather
  than a fix aimed at it — the cycle React was breaking was work that both of them removed. `0.7`'s
  entry called the console unclean; it is not, at a reader's speed, and at twenty times that the
  remaining trips are React's own development instrumentation, which no production consumer can see.
- **The page box now writes back the page it went to.** Typing `1000` into a 20-page document used to
  leave `1000` in the box: the scroll clamps on its own, so `currentPage` never moves and the effect that
  mirrors it into the field never runs.

### Fixed

- **Highlights flashed off and back on at every zoom step.** A consequence of the rebuild above rather
  than a separate fault: the layer was cleared, re-rendered, and the marks re-wrapped. The spans are no
  longer thrown away, so the marks stay where they were.
- `usePdfDownload`'s comment claimed the save is refused because an XFA reader's keystroke never reaches
  storage. It reaches storage; the save is refused because the writer cannot rebuild a packet. The guard
  is unchanged, and the reason now matches the measurement.

### Not done

- **The real-device matrix (`#141`) is not done and cannot be from here.** iOS Safari 14 and 15, where
  the `:has()` fallback for container queries is written but has never been measured on any Safari, and
  Android Chrome. Every frame number in this release, and the one before it, is Chromium on one Windows
  machine at roughly 145 Hz. `PRD.md:22`'s bar is met on that machine and unmeasured anywhere else.
- **Freezing the exported collections** (`INK_COLORS`, `INK_WIDTHS`, `HIGHLIGHT_COLORS`, `ZOOM_LEVELS`,
  `PRINT_SCALES`, `DEFAULT_PAGE_ESTIMATE`, `DEFAULT_LABELS`) is recommended by the freeze review and not
  done here: it is a contract change for anyone currently writing to one, which is the behaviour worth
  breaking, and `1.0` is the release with that allowance. The docs page tells a host to spread instead,
  which is correct today and after.

## [0.7.0] — 2026-09-27

Writing where the engine cannot. This is the release that touches the zero-dependency rule, and the only
one that does: a tier that reorders, rotates, removes, extracts and splits whole pages, plus a flatten
that bakes a reader's marks into the page so they survive being opened somewhere with no editor. Both
need a PDF parser, so `@cantoo/pdf-lib` arrives as an **optional peer** — named by exactly one shipped
module, and by nothing at all unless you import `pdfjs-react-reader/edit`.

The measurement that scoped it: pdf.js can write a page's *contents* back into a file and cannot move a
page at all, because moving one is rewriting the page tree. And the tree cannot be rewritten through the
writer's own page API either — `removePage()` ends by deleting the object it just unlisted, so
remove-then-insert leaves a tree naming something that no longer exists and the file fails to reopen.
That was confirmed four ways before the mechanism was chosen. What ships is a permutation of `/Kids` with
`/Count` restated, which is why an undo is an inverse permutation, and why a *delete* — the one thing a
permutation cannot bring back — needs the single byte snapshot the tier holds.

### Added

- **`editFeature`** (`pdfjs-react-reader/edit`, **+3.60 kB** over core, against a 4 kB per-feature
  budget) — page rearranging and flatten, one tier, one dependency boundary. `createEditFeature({
  fileName })` for a host that saves under a fixed name; `arrangePages`, `flattenBytes` and the pure
  page-plan functions (`initialPlan`, `movePlanned`, `rotatePlanned`, `removePlanned`, `inversePlan`,
  `plannedPages`) are exported for a host that wants the mechanism and no panel.
- **The Pages tab**, a sidebar panel the tier owns rather than a drag handle bolted onto core's
  thumbnails, so the affordance is never inert and the writer stays opt-in. Rows move by button or by
  drag, each carries its own turn, split and remove controls, and the footer applies, extracts, undoes,
  undoes the last apply, and discards. Every action is announced through a `role="status"` live region,
  and a row's label numbers the page in the file being edited — so the list renumbers after an apply,
  which is what makes a second apply compose against the new document rather than the old one.
- **A plan, not an edit-in-place.** Moves, turns and removals mutate an array; nothing is written until
  Apply. A batch is therefore undone by stepping a stack with no bytes touched (measured: two moves, one
  Undo, no call to the writer at all), and Apply is the single write.
- **Extract and split.** Extract is the same writer pass handed to the save dialog instead of to the
  viewer, so the document on screen does not move. Split cuts the planned list at any row and writes two
  files from **one** read of the base bytes — measured at 4 + 16 with a pending order and 10 + 10 in the
  file's own order. Two files rather than five is a deliberate limit: a reader who wants equal parts can
  split twice, while a fourth download in one click is where a browser puts a permission prompt this
  viewer cannot honestly earn.
- **Flatten**, the bar control and the state call, which is what makes marks permanent: `downloadFeature`
  can only add an incremental update, so fields stay interactive and a mark stays an object a renderer
  may choose not to draw.
- **`replaceDocument(bytes, name?)`** on the controller and on `useViewer()` — the seam Apply uses, and
  general: the viewer loads new bytes in place, the download label carries across, per-page rotations
  clear, and a changed `src` or a dropped file wins over the replacement.
- **`pdfjs-react-reader/edit.css`**, the eighth sheet (2,469 B source, 1,266 B minified), and **19 more
  labels** — the catalogue is now 134 strings, up from 115.
- **Four fixtures**: `page-order-sample.pdf` (20 pages, each printing its own number, page 5 carrying
  `/Rotate 90`, so a move, a turn and a delete are readable back out of the file rather than only off
  the screen) and three array-form `/XFA` containers — the packet split across three pairs, the whole
  packet in one pair, and a hybrid that also carries `/Fields`.

### Changed

- **Arming an annotation tool no longer repaints a page that has nothing to take over.** The flag was
  already gated in `PdfPage`, but `annotationEditorEditing` was itself an effect dependency, so every
  mounted page still repainted — with the same answer, which is a wasted render rather than a lost mark.
  The gate is now part of the effect's identity, and the page's own `isEditable` fact is state rather
  than a ref, which also closes the race where a tool was armed before the annotation fetch resolved.
  Measured on `outline-sample.pdf` (3 pages, no annotations, 2 mounted): arming costs **0 render calls**
  where it used to cost 2. On `annotated-sample.pdf` it still costs exactly 2, both with the flag set,
  and `0.6`'s safety property re-measured clean on the same build.
- **Search now marks text on a pure-XFA page.** `XfaLayer.render` hands back bare text nodes, which a
  highlighter cannot split, so each is wrapped in an element of its own and the highlighter reads those
  when there is no text layer. `1 of 1 · p1` used to mean *one match, nothing shown*; it now means one
  match, marked, and scrolled to, with the layer's own 23 elements intact.
- **`saveDocument()` is no longer called on a document that has nothing to commit.** The tier asks the
  engine `annotationStorage.size` and takes `getData()` otherwise — the cheaper call, and the one that
  does not print pdf.js's own warning. Asking the engine rather than the features is deliberate: the
  download control reaches the same decision through `forms.isDirty` and `annotate.editing`, which needs
  those peers mounted, while the storage size is the fact those two only report on.

### Fixed

- Downloading or applying a **pure-XFA** document threw an opaque worker `UnknownErrorException`. Both
  commit paths now check `isPureXfa` and hand back the loaded bytes, and a test pins that neither asks
  the engine to commit one.
- A search mark on an XFA page was **present in the DOM and invisible**, because the highlight rules were
  scoped to `.pjsr-text-layer` while `.pjsr-xfa-layer .xfaLayer *` zeroes every background on the page.
  The XFA rule tints *behind* the glyphs rather than hiding them: over a canvas the mark's own text is
  transparent because the canvas paints the word, and here the layer *is* the page, so the same rule
  would have deleted it. Re-measured on both paths — XFA `background-color` at 55 % accent with the text
  colour intact, and a normal document's marks unchanged.
- A clean page-editing session printed one pdf.js console warning per write, for a document whose storage
  the reader had never touched. Console clean afterwards, measured.
- **Applying did not announce itself.** The panel's `role="status"` region went silent on the one action
  that changes the document under the reader, for three separate reasons found one at a time: the effect
  that voids a plan when the document changes also unsaid the notice the apply had just set; a document
  swap arrives as *two* changes (the old document going away, then the new one), so a flag consumed on
  the first was spent before the panel came back; and returning `null` unmounts the panel's markup
  without unmounting its component instance, so the region remounted already holding its text — which is
  not a change, and so not announced. It now empties for the duration of the swap and writes itself one
  task after the new document commits. `requestAnimationFrame` was the first choice for that write and
  is wrong here: a hidden tab never paints, so the callback never ran.
- **"Undo the last apply" said "Page changes discarded".** One notice kind was doing two jobs, and after
  an undo-apply the sentence described an action nobody had taken. It has its own label now.

### Notes on verification

Verified in Chromium against the playground and the docs site: reorder, rotate and remove through the
real controls, with the on-screen document changing after Apply (the first page's own printed text went
from "Page 01" to "Page 02", and the panel renumbered from 20 rows to 19 after a removal); the same for
extract, where the file led with the moved page while the viewer still showed the original order; split
at 4 + 16 and 10 + 10; one-snapshot undo-apply restoring a removed page; the empty-storage warning gone;
arming a tool costing zero renders on a page with nothing editable and two on a page with markups; and
the XFA mark painted and readable in a screenshot. The live region was read back at timed samples rather
than trusted: `Page 1 turned to 90 degrees`, `Page 3 removed`, `Page changes applied` surviving the
swap, and `Back to the document as it was before the apply`. 365 unit tests, with the two new
announcement assertions each run once more with the fix removed, to show they fail without it.
`npm run verify` green, with the size ratchet re-accepted for the seam.

**Three things this release does not claim.** That a *physical* pointer drag was exercised — the
gesture path is dispatch-tested, not driven through automation. That XFA can be saved, and the sentence
now says which half was measured: `saveDocument()` is unreliable across every container shape this
project can generate, while the fixtures' fields bind without a `dataId`, so `XfaLayer.setupStorage`
never attaches and no keystroke of ours ever reaches the storage a save would write — a real LiveCycle
form's edit path is therefore unmeasured, and `#137` is that gap. And that an XFA page has a thumbnail:
it paints zero operators, so the sidebar shows an empty 132×185 buffer, filed as `#136`.

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
