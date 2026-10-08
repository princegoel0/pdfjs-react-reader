# pdfjs-react-reader

A headless-first PDF viewer for React, built directly on [pdfjs-dist](https://www.npmjs.com/package/pdfjs-dist).
MIT-licensed, no feature behind a paywall.

It ships the parts that are tedious to get right — virtualized rendering, the canvas/text/annotation
layer stack, worker lifecycle, whole-document search, AcroForm editing, annotation editing, page
rearranging, printing — as hooks you can drive from your own interface, plus an optional drop-in
component for when you just need a viewer. In that component, a capability is an import rather than a
prop, so the bundle holds only the ones you mounted.

Every one of those has a runnable example on the
[documentation site](https://princegoel0.github.io/pdfjs-react-reader/).

```bash
npm install pdfjs-react-reader pdfjs-dist
```

```tsx
import { PdfViewer } from 'pdfjs-react-reader';
import { printFeature } from 'pdfjs-react-reader/features/print';
import 'pdfjs-react-reader/styles.css';
import 'pdfjs-react-reader/print.css';

export function Report() {
  return (
    <PdfViewer
      src="/contract.pdf"
      defaultScale="fit-width"
      features={[printFeature]}
    />
  );
}
```

`<PdfViewer src="…" />` on its own is a viewer that reads: pages, selectable text, search,
thumbnails, ink, zoom, rotation, layout. Print, save, fillable form widgets, the bookmarks tab, the
layers tab, the attachments tab and marking up the document are `printFeature`, `downloadFeature`,
`formsFeature`, `outlineFeature`, `layersFeature`, `attachmentsFeature` and `annotateFeature`. Moving,
turning, deleting, extracting and splitting whole pages is `editFeature`, which also draws a signature into a form's signature field. Combining pages from two documents into a third file
is `usePdfMerge` on `pdfjs-react-reader/merge` — a writer, a hook and a recipe, and no component, because the
picker is the host's design. Those two are the tiers that bring their own PDF writer, so it is an optional peer rather than a dependency of everything
else.

## What it does

Core, in every import of the shell:

- **Virtualized** — only rows crossing the viewport hold a live canvas, and off-screen buffers are
  cleared, which is what keeps a 400-page document alive on mobile Safari.
- **Selectable text layer** with search matches highlighted in place.
- **Search** across the whole document, debounced, with stale runs cancelled — and indexing that starts at
  the page in view and walks outward, so the first answer arrives while the rest of the file is still being
  read and the counter says *so far* until it is finished. Several words mean a
  page holding **all** of them; `regex: true` makes the query a JavaScript expression, a pattern that
  will not compile says so instead of reporting no results, and per-page counts come out with the
  matches. Supply your own `find` object and the bar runs on your answers instead.
- **Thumbnails, rotation, layout modes** (continuous, single page, two-page spread). Rotation works
  per page as well as globally, and the text and annotation layers turn with it.
- **Page labels honoured** where the document declares them: the page field shows `iii` or `A-1` and
  accepts the same back, while an ordinary PDF keeps its plain number box.
- **Annotations, read or written** — link annotations and markup render as the file says, and
  `annotateFeature` turns that layer into an editor: highlight, free text and ink, a colour chosen from
  the engine's own palette, and a Delete that is live only while a mark is selected. The marks are real
  PDF annotations, so they survive zoom, rotation and scrolling a page out of the way, and
  `downloadFeature` writes them into the file. Freehand ink without the feature is stored in PDF user
  space, so zoom and rotation both map correctly, and it prints.
- **XFA forms render** — a pure-XFA document is painted from its template by `XfaLayer` rather than
  showing nothing, at the page size the template asks for, and search marks land on its text as they do
  on a text layer. Saving one back is not offered: measured against every `/XFA` container shape this
  project can generate, `saveDocument()` either rejects, drops the value, or returns bytes that will not
  reopen — and those fixtures bind their fields without a `dataId`, so a keystroke never reaches
  `annotationStorage` to begin with. Whether a real LiveCycle form's edits survive is unmeasured, and
  [the page that documents the limit](https://princegoel0.github.io/pdfjs-react-reader/#/compatibility)
  says which half is which. Its thumbnails compose the same template rather than a blank card, because a
  pure-XFA page paints no operators and a miniature of canvas alone would show nothing.
- **Document structure that acts** — a link that switches a layer does switch it, and the layers panel
  agrees with it; a paperclip annotation saves the file it carries on double-click or `Ctrl/Cmd + Enter`.
- **Encrypted documents** with a built-in password prompt you can replace.
- **Production edges** — a canvas area ceiling (an over-large canvas paints blank rather than
  throwing), an `allowedSources` allowlist for URLs you did not author, pdf.js support assets served
  from your own origin, an opt-in Trusted Types policy, and a `capabilities` report of what the
  opened document declares.
- **Driven from code** — a `ref` handle (`goToPage`, `zoomTo`, `rotatePage`, `search`,
  `toggleFullscreen`, …) and change events that report what the user did rather than what mounted:
  page, scale, layout, fullscreen, and `onAnnotationChange` for what the editor can undo, delete or
  save right now.
- **Gestures** — Ctrl/Cmd + wheel (which is also how a trackpad pinch arrives), two-finger pinch on
  touch, a two-finger drag that scrolls the document instead of vanishing into a gesture that never
  became a pinch, keyboard paging, optional drag-and-drop to open a file, any percentage from 25 % to
  500 %, and an `Automatic` mode that fits a landscape page whole and a portrait one by width. The page
  area declares `touch-action: pan-x pan-y`, so the browser never pinch-zooms its own page underneath a
  zoom that is the viewer's to make, and a gesture the viewer consumes still reaches the host's listeners
  with `defaultPrevented` set — nothing outside the viewer's own container is claimed.
- **Localisable** — every string in the shell lives in one typed catalog, 137 labels since `0.12` withdrew the ink controls and the pen gained its disclosure; override
  the subset you need and the rest keeps its English default, or take a complete language from
  `pdfjs-react-reader/locales/de`, `/fr` or `/es` — 2.35–2.39 kB gzipped each, and a separate entry so
  importing the viewer never hands you a language you did not ask for.
- **Composable** — the shell's state is `useViewerController`, published through `ViewerProvider`, and
  the four parts (`ViewerRoot`, `ViewerToolbar`, `ViewerSidebar`, `ViewerPages`) read it. Write your own
  arrangement without forking anything, and hand the toolbar `{ hide, priorities, order, add }` to
  decide which of its controls survive.
- **Accessible** — see [Accessibility](#accessibility).

Opt-in, one import each:

| Feature | Adds | Cost over core |
| --- | --- | --- |
| `features/print` | Print at print intent — all pages, the current one, or a range the reader picks — honouring stored form values and ink, with a memory-budgeted resolution, a cancellable progress loop and `Ctrl/Cmd + P`. | 2.41 kB |
| `features/download` | Download of the original bytes, or an incremental save carrying the edits — field values and annotation marks both ride the same storage. | 0.87 kB |
| `features/forms` | AcroForm widgets — text, checkbox, radio, choice, button — wired to pdf.js annotation storage, with `createFormsFeature({ onChange })` and programmatic get/set/reset. | 1.98 kB |
| `features/outline` | The bookmarks sidebar tab. | 0.89 kB |
| `features/layers` | A sidebar tab listing the document's optional-content groups, switching one and having every page redraw. | 1.20 kB |
| `features/attachments` | A sidebar tab listing the files embedded in the PDF and saving any one of them. | 1.43 kB |
| `features/annotate` | Marking up the document: pdf.js's own editor manager behind three tools — highlight, free text, ink — with a highlight colour from the engine's palette, and a Delete that is live only while a mark is selected. Undo and redo are on the state the feature publishes, so the controls are yours to place. | 2.05 kB |
| `features/structure` | The document's own structure tree, as accessibility structure: headings, lists, tables and named figures become `role`d elements that own the words they describe, for the one class of PDF that declares them. Contributes no control and no panel — there is nothing for a reader to press — and fetches its peer payload only for a document that says it is tagged. | 0.74 kB |
| `edit` | Whole pages, and a file that no longer depends on a reader: a **Pages** sidebar tab that moves, turns and removes pages through a plan you can step back before writing anything, then applies it, extracts the planned pages as a new file, or splits the list at any row into two. Plus **Flatten**, which bakes every mark and field value into the page so it survives a viewer with no editor to show it.
  A **Sign** section appears in that tab when the document has signature fields: draw a mark, choose a box, and it is
  written into the field's appearance. It is a picture of a signature — the file is never given a signature value, and
  a box that already holds a real one is refused rather than covered over. One of the two tiers with its own dependency — `@cantoo/pdf-lib`, an *optional* peer, imported by nothing else in the package. | 6.42 kB |
| `merge` | Combining pages from two or more documents into a **third file**: `mergeDocuments({ sources, order })` copies the pages it is told to copy, in the order it is told, and `usePdfMerge` is the state a picker needs — pages per source, the plan, and the write. No component, because which documents may be merged and what happens to the result are the host's business; [Recipes](https://princegoel0.github.io/pdfjs-react-reader/#/recipes) shows the writer bare. A page may be taken twice here, which the page plan inside one document refuses; a source is never written, which the tests assert by hashing. What does not cross the boundary is the interactive form: a page arrives with its widget annotations, not with the `AcroForm` that binds them. | its own entry: 1.70 kB |

All nine together cost 16.33 kB, less than their sum, because they share the shell they attach to.
They are also the reference for writing your own: the contract and the authoring hooks are public.
(Measured on this build; see [Size](#size) for how each row is produced and why a tier that
parses files is allowed the kilobytes that costs.)

Mounting the last one is the same as mounting any other, and it is the only one that needs a package
beside this one:

```bash
npm install pdfjs-react-reader pdfjs-dist @cantoo/pdf-lib
```

```tsx
import { PdfViewer } from 'pdfjs-react-reader';
import { editFeature } from 'pdfjs-react-reader/edit';
import 'pdfjs-react-reader/styles.css';
import 'pdfjs-react-reader/edit.css';

<PdfViewer src="/contract.pdf" features={[editFeature]} />;
```

That gives a **Pages** tab in the sidebar and a **Flatten** control in the bar. The tab is where the
plan lives: rows move by button or by drag, each carries its own controls, the badge on a row means
*changed here* rather than *what the file says*, and nothing is written until Apply.

## Requirements

| Package | Required | Tested with |
| --- | --- | --- |
| `pdfjs-dist` | `^6.2.108` | 6.3.289, the version installed here and the one CI's `verify` job runs. CI builds a throwaway consumer against `6.2.108` and `6.4.299`, and since #194 its `browser` matrix carries that same pair as an axis, so a page is painted at both ends of the range rather than only compiled: the swap happens inside the install that pins the rest of the tree, and the cell refuses to run if the disk is not the version it asked for. **The first run through it found a difference the range hides:** at `6.2.108` the engine has no link-ownership code at all (`enableLinkOwnership` appears nowhere in its `build/pdf.mjs`), so a link is not given the words it is drawn over — it does on `6.3.289` and later, and there is no published 6.x in between. #249 settled that by letting the *feature* declare its floor instead of moving the package's: `structureFeature.engineRequirements` names `6.3.289` for that one behaviour and says what happens below it, `structureFeature`’s state carries `linkOwnershipAvailable`, and `^6.2.108` stays the peer range because the rest of the tier works there. The matrix’s structure row reads the same boundary and, below it, asserts the degradation instead of the wiring — so a release that silently *gains* the ownership trips the row. Each reading is recorded under `FR-48` in `fr-evidence.json` |
| `react` | `^18.0.0 \|\| ^19.0.0` | 19.3.0 and 18.3.1, both verified locally. The 18 pass was re-run on 2026-09-29 with `@types/react@18`: `npm run verify` end to end — typecheck, all 449 tests then in the suite, both bundles, the size gate. The `react` matrix job has since run on CI: all four cells (18 and 19, minimum and latest patch) passed typecheck, the suite and the build on 2026-10-04 |
| `react-dom` | `^18.0.0 \|\| ^19.0.0` | 19.3.0 and 18.3.1, swapped in alongside `react` for the same run |
| `@cantoo/pdf-lib` | `^2.11.1`, **optional** — only `editFeature` asks for it | 2.11.1 |

Nothing else at runtime — no state library, no date library, no polyfills, no CSS framework. The one
exception is deliberately an *optional* peer: writing pages needs a PDF parser, and a viewer that never
mounts the `edit` tier should not install one. Optional peers are not installed for you, so mounting
that tier means adding the package yourself.

`pdfjs-dist` v4 is **not** supported: it has no `canvas` render parameter (its `render()` reads
`canvasContext.canvas`), so a v4 install would show blank pages rather than fail loudly. 4.2.67 also
lacks the `TextLayer` export. See [CHANGELOG.md](./CHANGELOG.md) for the full reasoning.

The floor is `6.2.108` rather than `6.0.0` on purpose: CVE-2026-16633 (high — arbitrary JavaScript
execution when opening a malicious PDF) affects `>= 5.6.83, < 6.2.108`, so 6.0.x and 6.1.x are inside
the vulnerable band as much as v5 is. v5 was supported until `0.6`, which dropped it: pdf.js's
`AnnotationEditorUIManager` takes its arguments **positionally**, and 5.0.x has two fewer of them, so
the same call cannot configure an editor layer on both lines — and 5.7+, where the signature matches,
has no release that fixes the CVE. Supporting it would mean advising a line we simultaneously tell you
to leave.

What the floor does not carry is measured, not assumed: `6.2.108` is a **browser-only** release. In a browser
it loads and runs this package's checks; imported in Node it dies in the engine's own module scope with
`ReferenceError: DOMMatrix is not defined` and prints "Please use the `legacy` build in Node.js environments",
so an SSR or Jest host on exactly that version cannot import this package either. Its `TouchManager` also
exposes no `onPanning`, and because that manager prevents every two-finger `touchmove` before it knows which
gesture it is holding, a pan on the floor had nothing to be handed and the document simply stopped moving —
so the package asks the installed engine whether it reports panning and, when it does not, pans the document
itself (`src/lib/touch-pan.ts`). That was measured in Chromium on `6.2.108` on 2026-10-05: 25 checks ok, 1
skipped, 0 failed, the pinch-vs-pan row reading `spread 3 → 3.37, two-finger drag scrolled to 160 and held
3.37`. The Node half is still true and is still FR-46's gap. `6.3.289` and `6.4.299` — which, with
`6.2.108`, are the only releases that exist in this range — do all of it. The owner decided on 2026-10-05 that
the advertised floor stays where it is and that this gap is the package's to close rather than the range's to
narrow; the range above is what is promised and this paragraph is what is known about it.

Your bundler needs to handle ESM and `exports` maps — Vite 5+, webpack 5+, Rollup 4+, esbuild and
Turbopack all work. There is a CommonJS build beside it — `0.12`'s FR-41 — so every published path ships
`index.js` and `index.cjs`, `index.d.ts` and `index.d.cts`, and the export map answers `import` and
`require` separately, so `require('pdfjs-react-reader/headless')` resolves instead of throwing. The floor is
where that stops being a question: `pdfjs-dist` is an ESM-only peer with no `exports` map of its own, so a
`require()` that reaches it needs a Node that can load ESM from CommonJS, which arrived unflagged in
22.12.0, and the peer's own `engines` starts at 22.13.0. So `engines.node` is `>=22.13.0`, Node 20 and
22.0–22.12 are not supported, and `npm run check:packaging` fails if the manifest, `PRD.md` §8's Node rows or
the CI matrices ever disagree about that number — the floor is one value in three places, checked rather
than repeated.

## Entry points

| Import | Contains |
| --- | --- |
| `pdfjs-react-reader` | Everything: the `PdfViewer` shell, its parts, the feature contract, and every headless hook. Importing `PdfViewer` does not drag in features you did not mount. |
| `pdfjs-react-reader/headless` | Hooks and pure helpers only — no shell components. |
| `pdfjs-react-reader/features/{print,download,forms,outline,layers,attachments,annotate,structure}` | One optional capability each. |
| `pdfjs-react-reader/edit` | The page-editing and flatten tier: `editFeature`, `createEditFeature`, the pure page-plan helpers, and `arrangePages` / `flattenBytes` on their own. |
| `pdfjs-react-reader/merge` | Putting two documents into a third: `mergeDocuments`, `describeMergeSources` and `usePdfMerge`, with no component — the picker is yours, because which documents may be merged and what happens to the result are the host's business. Together with `/edit` this is where `@cantoo/pdf-lib` is reached: neither the root entry nor `/headless` imports the writer, so a host that never names one of these paths cannot pull it in. |
| `pdfjs-react-reader/styles.css` + `/print.css` `/forms.css` `/outline.css` `/layers.css` `/attachments.css` `/annotate.css` `/structure.css` `/edit.css` | The default theme for the core chrome, as CSS custom properties, then one sheet per feature that has markup of its own. Separate files because a bundler drops CSS that no JavaScript imports — import the sheets for what you mounted, and nothing else. |

## Stability

Every one of the **320** names this package publishes carries a maturity state, and the file that says so is
[`api-maturity.json`](api-maturity.json): **263 stable, 57 experimental, none deprecated**, plus a `removed`
ledger of the 15 names FR-18 withdrew — read 2026-10-04 from `npm run check:maturity`, which is the command
that recomputes it, because a count copied into a document is a count that goes stale. Stable means a
breaking change needs a major version. Experimental means shipped, typed, and still being shaped by use — it
may change in a minor, with a changelog line — and each experimental name records *why* it is in that state,
which is what stops a temporary label from becoming permanent.

The set is not maintained by hand. `npm run check:maturity` reads the published names out of the build and
fails if one has no state, if a state has no name, if a non-stable name has no reason, or if the file invents
a fifth state; it is the last step of `npm run verify` and a named step in the `verify` CI job, and it runs
itself against nine synthetic violations
before it grades the real ones. The docs site's [API page](https://princegoel0.github.io/pdfjs-react-reader/)
lists every non-stable name with its reason, generated from the same file.

## Headless

Build the entire interface yourself. This is a working viewer in about forty lines:

```tsx
import { useState } from 'react';
import { PdfPage } from 'pdfjs-react-reader';
import { usePdfDocument, usePdfVirtualizer } from 'pdfjs-react-reader/headless';

export function CustomViewer({ src }: { src: string }) {
  const { doc, numPages, error } = usePdfDocument({ src });
  const [scale, setScale] = useState<'fit-width' | number>('fit-width');
  const {
    containerRef, virtualSlots, totalHeight, currentPage, resolvedScale, scrollToPage, reportPageDims,
  } = usePdfVirtualizer({ doc, numPages, scale, gap: 10 });

  return (
    <>
      <div>
        <button onClick={() => scrollToPage(Math.max(1, currentPage - 1))}>Prev</button>
        {currentPage} / {numPages}
        <button onClick={() => scrollToPage(Math.min(numPages, currentPage + 1))}>Next</button>
        <select value={String(scale)} onChange={(e) => setScale(Number(e.target.value))}>
          {[1, 1.5, 2].map((v) => <option key={v} value={v}>{v * 100}%</option>)}
        </select>
      </div>
      <div ref={containerRef} style={{ height: '80vh', overflow: 'auto' }}>
        <div style={{ position: 'relative', height: totalHeight }}>
          {doc && virtualSlots.map((slot) => (
            <div key={slot.indices[0]} style={{ position: 'absolute', left: '50%', transform: `translate(-50%, ${slot.offsetTop}px)` }}>
              {slot.indices.map((index) => (
                <PdfPage key={index} doc={doc} pageNumber={index + 1} scale={resolvedScale} onBaseDimensions={reportPageDims} />
              ))}
            </div>
          ))}
        </div>
      </div>
      {error && <p role="alert">{error.message}</p>}
    </>
  );
}
```

The [documentation site](https://princegoel0.github.io/pdfjs-react-reader/) runs this live, alongside
the shell, theming and form examples.

## Errors and cancellation

Every failure that reaches you is a `PdfError`: a stable `code`, a `message` safe to put in front of a
reader, optional `details` with the numbers, and the engine's own error as `cause`. Branch on the code —
a message is wording, and wording is the part a library is allowed to improve.

```tsx
import { PdfViewer } from 'pdfjs-react-reader';
import { isCancellationCode } from 'pdfjs-react-reader/headless';

export function ContractViewer({
  signIn,
  show,
}: {
  signIn: () => void;
  show: (message: string) => void;
}) {
  return (
    <PdfViewer
      src="/contract.pdf"
      onError={(error) => {
        if (isCancellationCode(error.code)) return;   // the reader stopped it; not a fault
        if (error.code === 'AUTH_ERROR') return signIn();
        show(error.message);
      }}
    />
  );
}
```

Seventeen codes ship, from `INVALID_SOURCE` to `UNKNOWN_ERROR`, and `PDF_ERROR_CODES` is the list. A code
is never reused for a different meaning, and a code is in the list because something produces it — a throw
site in this package, or an exception class the installed engine actually stamps — which is a rule
`src/lib/error-codes.coverage.test.ts` enforces rather than claims; it is what took `UNSUPPORTED_FEATURE`
out (#242), the name whose only claimed producer was a table row for a class no shipped `pdfjs-dist`
contains. Three of them are cancellations — `LOAD_CANCELLED`,
`RENDER_CANCELLED`, `SEARCH_CANCELLED` — and a cancellation never reaches an error callback at all: a load
you abort reads `status: 'cancelled'`, a page you scroll out reads `cancelled`, and an aborted index goes
back to `idle`. Both ends of the page path can be started again — `handle.retryPage(page)` re-queues one
page without disturbing zoom or position, and `reload()` starts the document over.

A source refused by `allowedSources` names the **origin** it refused and never the path or the query,
because a pre-signed URL carries its credential in the query string and an error message is exactly the
thing that ends up in a log line.

## The shell, controlled

`PdfViewer` owns its own state, so it takes a ref instead of a pile of controlled props:

```tsx
import { useRef, useState } from 'react';
import { PdfViewer, type PdfViewerHandle } from 'pdfjs-react-reader';

export function ContractViewer() {
  const viewer = useRef<PdfViewerHandle>(null);
  const [page, setPage] = useState(1);
  const [zoom, setZoom] = useState(1);
  return (
    <>
      <PdfViewer
        ref={viewer}
        src="/contract.pdf"
        onPageChange={setPage}
        onScaleChange={setZoom}
      />
      <button onClick={() => viewer.current?.goToPage(page + 1)}>next</button>
    </>
  );
}
```

viewer.current?.goToPage(12);
viewer.current?.zoomTo(1.5);        // any percentage, not just the presets
viewer.current?.rotatePage(3, 90);  // one page, not the document
viewer.current?.search('indemnity');
```

`goToPage · zoomTo · zoomBy · fitTo · setLayout · rotate · rotatePage · retryPage · openSidebar ·
toggleFullscreen · search · invalidatePages` are the whole surface, and every page they name is 1-based.
(`replaceDocument` is on the controller a host-written layout receives rather than on the handle: a ref
cannot take a document the shell's own state would then not know about.) The change events fire for what
the user did, not for what mounted: a fit mode resolving to 87 % during load does not announce itself
as a change.

Strings are one typed catalog, so a partial override is always valid:

```tsx
import { PdfViewer } from 'pdfjs-react-reader';
import type { PdfViewerLabelsOverride } from 'pdfjs-react-reader';

const de: PdfViewerLabelsOverride = { nextPage: 'Nächste Seite', pageOf: 'Seite {page} von {total}' };
<PdfViewer src="/vertrag.pdf" labels={de} />
```

The bar's contents are configurable by control id — the built-ins (`sidebar`, `page`, `search`,
`zoomIn`, `layout`, `meta`, …) and each mounted feature's own id:

```tsx
import { PdfViewer, type ToolbarItem } from 'pdfjs-react-reader';
import { printFeature } from 'pdfjs-react-reader/features/print';

const myControl: ToolbarItem = {
  id: 'count',
  priority: 40,
  label: 'Page count',
  node: <span>of 12</span>,
};

export function ContractViewer({ src }: { src: string }) {
  return (
    <PdfViewer
      src={src}
      features={[printFeature]}
      controls={{
        hide: ['search', 'meta'],
        priorities: { layout: 2 },   // what survives a narrow bar
        order: ['search', 'page'],   // where controls sit while it is in it
        add: [myControl],            // an existing id replaces it in place
      }}
    />
  );
}
```

And the shell is a controller plus a layout, both exported, so a different arrangement is a few lines
of JSX rather than a fork:

```tsx
import {
  useViewerController,
  ViewerProvider,
  ViewerRoot,
  ViewerToolbar,
  ViewerPages,
  type PdfViewerProps,
} from 'pdfjs-react-reader';

export function ReadingView(props: PdfViewerProps) {
  const controller = useViewerController(props);
  return (
    <ViewerProvider controller={controller}>
      <ViewerRoot>
        <ViewerPages />
        <ViewerToolbar />
      </ViewerRoot>
    </ViewerProvider>
  );
}
```

`ViewerRoot` carries the theme tokens, the keyboard and drop handlers and the mounted features'
runners, so print, save, forms, the outline panel and the annotation editors work there exactly as
they do in the default layout; your own components inside it read the same state through
`useViewer()`.

## Writing a feature

A feature is a value: a `Runner` component that owns the hooks and publishes state, plus optional
toolbar controls, a sidebar panel, key bindings and per-page props. The nine built-ins are written
against this same contract, and `features/structure` is the one that uses none of the three UI hooks:
its whole contribution is page props.

```tsx
import { usePdfFeaturePublish, usePdfFeatureShell, usePdfFeatureState } from 'pdfjs-react-reader';
import type { PdfFeature } from 'pdfjs-react-reader';

function ProgressRunner() {
  const shell = usePdfFeatureShell();
  usePdfFeaturePublish({ percent: Math.round((shell.currentPage / (shell.numPages || 1)) * 100) });
  return null;
}

export const progressFeature: PdfFeature = {
  id: 'progress',
  Runner: ProgressRunner,
  controls: [
    {
      id: 'progress',
      priority: 11,
      label: (l) => l.pageOf,
      render: () => {
        const { percent = 0 } = usePdfFeatureState<{ percent?: number }>();
        return <progress value={percent} max={100} />;
      },
    },
  ],
};
```

Two rules, both learned from a silent failure: a feature contributes a *component*, never a hook the
shell calls (a variable number of hooks crashes the moment the list changes length), and Runners are
keyed by `id`, not position (drop a feature from an inline array and an index key remounts the
survivor and discards its state). See the
[features page](https://princegoel0.github.io/pdfjs-react-reader/#/features) for the full contract.

## The worker

pdf.js parses in a worker, and locating it is the usual integration headache. Without `workerSrc`
the package looks for the worker inside your own `node_modules`, probing a bundler-relative
specifier first and a bare one second, and keeps the first URL that actually answers. That covers
Vite (dev server and build), webpack 5 and Rollup without a line of configuration.

Nothing is assigned when no candidate answers, which is not a fallback of its own: pdf.js's main-thread
parser *is* the worker's code, so it has to be reachable without a URL for that to run — as it is in Node,
where the engine supplies its own default, and as it is for a host that has assigned
`globalThis.pdfjsWorker` itself. Everywhere else the load fails naming `workerSrc`, the option you own,
rather than a fetch error for a URL you never wrote. Pinning a plausible-but-dead candidate would overwrite
the Node default and cause that second, worse failure — which is why the probe checks each URL instead of
guessing.

```tsx
import { PdfViewer } from 'pdfjs-react-reader';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

export function ContractViewer({ src }: { src: string }) {
  return <PdfViewer src={src} workerSrc={workerUrl} />;
}
```

Pin it when you serve the worker from a CDN or copy it into a fixed location. Importing the package is
safe anywhere, a server bundle included — every entry point in the export map is imported with no DOM
present and must not throw, which is a test rather than a hope. *Rendering* is browser-only: the worker
and the canvas need a real document, so in Next.js the viewer lives in a `'use client'` component, while
the pure helpers (`classifySource`, `base64ToBytes`, `resolveSourceUrl`, `normalizeSource`) stay usable on
the server — which is where a source string usually gets decided.

## Beyond the worker

pdf.js also fetches `cmaps/`, `standard_fonts/` and `wasm/` while parsing. They default to an unpkg
root pinned to your `pdfjs-dist` version; `assetUrl="/pdfjs-assets/"` points them at a directory you
serve instead — those three folder names, kept as-is, under that root. There is no automatic
self-hosted discovery because pdf.js concatenates a *directory* with a filename at runtime and a
bundler only emits files it was told about by name.

A string `src` you did not author is bounded by `allowedSources`, and one that is not recognizably a
URL or a path throws rather than being fetched:

```tsx
import { PdfViewer } from 'pdfjs-react-reader';

export function UploadsViewer({ userUrl }: { userUrl: string }) {
  return <PdfViewer src={userUrl} allowedSources={['/uploads/', 'https://cdn.example.com']} />;
}
```

Once a document is open, `onCapabilities` says what it is, which is the only way to know a form will
not fill in before the user types into it:

```tsx
import { PdfViewer } from 'pdfjs-react-reader';

export function FormCheckViewer({
  src,
  show,
}: {
  src: string;
  show: (fillable: boolean) => void;
}) {
  return (
    <PdfViewer
      src={src}
      // `c.form` is 'none' | 'acroform' | 'xfa' | 'mixed' — the only way to know before a reader types.
      onCapabilities={(c) => show(c.form !== 'none')}
    />
  );
}
```

On a page served with `require-trusted-types-for 'script'` pdf.js cannot start its worker at all — it
accepts a string URL, and constructing a `Worker` from one throws there, which pdf.js swallows while
parsing on the main thread. `configureTrustedTypes('your-policy-name')` opts in to building the
worker through your own policy; the name must already appear in your `trusted-types` directive, which
is why nothing here picks one.

## Theming

Plain CSS custom properties, no CSS-in-JS. Every colour and size resolves from a `--pjsr-*` token
declared on `.pjsr-viewer`:

```css
.pjsr-viewer {
  --pjsr-accent: #0b7285;
  --pjsr-viewport-bg: #f1f3f5;
}
```

Because the viewer declares the tokens on its own root, set them on that element — a stylesheet rule
as above, or the `style` prop for a runtime value. The rules are spread across one sheet per tier
(`styles.css`, then `print.css`, `forms.css`, `outline.css`, `layers.css`, `attachments.css`,
`annotate.css`, `structure.css`, `edit.css`) so a
feature you did not mount also costs you no CSS, but they all read the same tokens. See
`docs/src/examples/ThemeExample.tsx` for full dark
and sepia presets.

## Responsive toolbar

The bar is not built from breakpoints. Each control carries a priority, the toolbar measures the
natural width of every one, and it folds the least useful into a `⋯` menu as space runs out — so page
navigation and zoom survive to 320 px while the feature controls and layout give way first. A feature
joins that same planner rather than getting a special case, so three added capabilities cost three
menu entries, not a wrapped toolbar. Control *size* follows the input device instead: 44 px targets
under `(pointer: coarse)`, 32 px with a mouse.

## Accessibility

- The page region is focusable (`role="region"`), so keyboard shortcuts are reachable and the region
  is announced.
- Where the reader is in the document is announced as they move: one polite region per viewer, saying
  the same sentence the page counter shows, after the movement stops rather than on every page passed.
  It names a page by its label when the document has one, it is built from the label table so a host's
  language and its own wording carry, and a viewer appearing on page 1 says nothing at all.
- Shortcuts are scoped to the viewer instance: a viewer never hijacks the host page's `Ctrl+F`.
  `Ctrl/Cmd + P` belongs to `printFeature`, so a viewer that did not mount it leaves the key to the
  browser.
- Controls carry `aria-label`; disclosures use `aria-expanded`, toggles `aria-pressed`.
- A document that declares a structure tree can have it read as one — headings, lists, tables and
  figures with their alternative text — by mounting `features/structure`. It is opt-in because the
  payload it needs is a peer module, fetched only for a document that says it is tagged.
- Under `forced-colors` the chrome takes the system palette rather than arguing with it, and the three
  places where the colour is the thing itself keep theirs: the annotation colour plate, the signature pad,
  and the text layer whose spans are deliberately invisible. Separations a high-contrast theme drops with
  the shadow (a menu's edge, a page's, a thumbnail's) come back as outlines, which cannot move a box.
- Nothing that means something relies on colour alone. A search match carries a rule under it and the one
  you are on a ring around it plus `aria-current`; an armed control turns on the border it already had;
  the selected sidebar tab thickens its underline.
- The match counter is an `aria-live="polite"` region; load failures are `role="alert"`.
- Every text token clears WCAG AA contrast, measured rather than assumed.
- Touch targets reach 44 px with 8 px gaps on coarse pointers; `prefers-reduced-motion` is honoured.
- Conformance is audited rather than inspected: axe-core runs the WCAG 2.0, 2.1 and 2.2 A and AA rules
  over the shell and every primitive in the suite (`npm run a11y`, and a named step in CI) — including the
  shell with a document on screen, again after a keyboard page change, and with the toolbar folded and its
  overflow panel open (`src/components/a11y.ready.test.tsx`, #247). What it
  cannot see without a layout — contrast, target size, and whether an assistive technology really
  announces what the DOM says — is listed in that file. `npm run test:browsers` now drives three engines
  through the claims jsdom cannot make, and two of the three are measured rather than declared:
  `npm run a11y:browser-record` runs the same rule set inside chromium, Firefox and WebKit over a document with
  real form controls and commits the contrast and target-size readings to `a11y/browser.json` (#267). The third —
  what a screen reader actually says — is still an operator, a pairing and a date.

## Size

Gzipped, excluding `pdfjs-dist`, React and `@cantoo/pdf-lib` (all peer dependencies). Each row is one
consumer file bundled twice — with esbuild and with Rollup — and the larger of the two is what is
quoted, so a path only counts as small if two independent tree-shakers agree. Nothing here is remembered at a
release close: every figure below is the one `npm run size` measured and wrote to
`docs/src/size-figures.json` — dated there, with each peer figure carrying the version it was taken on — and
`npm run check:docs` fails the build when this file's two tables and that one disagree (#240).

| What you import | Size | Over core |
| --- | --- | --- |
| `PdfViewer`, no features — pages, text, search, thumbnails, chrome | 33.26 kB | — |
| `+ printFeature` | 35.67 kB | +2.41 kB |
| `+ downloadFeature` | 34.12 kB | +0.87 kB |
| `+ formsFeature` | 35.24 kB | +1.98 kB |
| `+ outlineFeature` | 34.14 kB | +0.89 kB |
| `+ layersFeature` | 34.45 kB | +1.20 kB |
| `+ attachmentsFeature` | 34.68 kB | +1.43 kB |
| `+ annotateFeature` | 35.31 kB | +2.05 kB |
| `+ structureFeature` | 34.00 kB | +0.74 kB |
| `+ editFeature` | 39.68 kB | +6.42 kB |
| All nine | 49.58 kB | +16.33 kB |
| A single headless hook (`usePdfDocument`) | 5.52 kB | — |
| A merge, on its own (`/merge`, writer and hook) | 1.70 kB | separate entry, not over core |
| The same two shipped paths as CommonJS (`index.cjs`, `headless.cjs`) | 61.96 / 32.68 kB | the other format, not another feature |
| A shipped locale catalog (`locales/de`, `/fr` or `/es`) | 2.35–2.39 kB | separate entry, not over core |

Summing the shipped files of a whole entry — what a bundler that cannot tree-shake pays — gives
69.50 kB for `index.js` and 37.91 kB for `headless.js`, each with `styles.css`. `edit.js` and `merge.js`
are the two shipped files that import the writer, so a host that never names either path never loads it. What the `core` figure does not show is that adding an entry point
moves it: a new tsup entry reshuffles the shared chunks every path is built from, which is why the *Over
core* column, not the base row, is the number that describes what a feature costs you.

CI runs `npm run size`, which compares each path against the numbers committed in
`size-baseline.json` and **reports** growth beyond minifier noise (2 % plus 256 bytes) as `GREW` on the
build output. It fails a number only when a path reaches **200 % of its accepted size**, or a single
feature reaches twice its **6 kB** expected cost over core. That line is deliberate: a budget that blocks
feature work is a ceiling wearing a different name, while a doubling is never a feature — it is a
dependency arriving, a tier being imported statically, or the same code shipped twice. It is a ratchet
rather than a promise: a library that grows with features cannot honestly promise a fixed size, and
`pdfjs-dist` decides a bundle's weight long before this layer does. What the gate guarantees is that bytes
never arrive quietly — accepting growth means running `npm run size:update`, so the increase lands in the
same diff as the code that caused it. Shrinking is always allowed and reported.

The 6 kB figure is not the ceiling this project started with: it was 4 kB until the signing work, which
measured 4.73 kB for the writer pass and the geometry it needs *before* any interface was counted. The
number moved because the requirement that does not bend is a different one — what a feature does to the
reader's machine, not what it weighs — and that is written down rather than smoothed over. See
[Behaviour under load](#behaviour-under-load).


For scale, `pdfjs-dist` 6.3.289 gzips to 131.7 kB for the main-thread module (`pdf.min.mjs`) and 375.3 kB
for its worker, and `@cantoo/pdf-lib` 2.11.1 bundles minified to 251.5 kB for what the `edit` tier
actually imports — 256.1 kB if a host takes the whole API — each measured the way `scripts/check-size.mjs`
measures, at gzip level 9. So the engine dominates any viewer bundle regardless of this package, and the
`edit` tier doubles that weight when a host mounts it and installs the writer.

## Behaviour under load

Size is a ratchet. This is the requirement that is not: the viewer has to stay smooth while it is
working, on documents big enough to make a mistake visible. `npm run bench` is the instrument (FR-49):
it serves the playground, drives the fixtures, separates the two kinds of
number §6 insists on keeping apart — a **bar** is structural and fails the run (canvas count bounded,
off-screen canvases gone, the render caps binding where they should), a **measure** is a timing printed
with the machine it came from, and never compared against *another* machine's number, because a maximum
observed on one machine is not a promise a slower reader's device will keep. It **is** compared against the
accepted baseline for the machine that produced it, in `benchmarks/baseline.json`, and past that tolerance the
job fails — FR-49's "a regression is a failing job rather than a slower feeling", with the tolerance derived
from the spread the environment has already shown rather than from a number somebody liked. A leg with no
accepted entry here, too few samples, or a fixture that changed under it is reported as `n/a` and counted in
the summary: an unmeasured leg is not a passing one. The run also writes **`benchmarks/latest.json`, which is
tracked**: the machine model, OS, browser and engine versions, the git revision, each fixture's sha256, and
p50/p95/max for every sampled number. A test reads that file back and fails if a field goes missing or a
fixture hash no longer matches the bytes on disk, so the record cannot drift from the documents it describes.
Measured here (Chromium, Windows, `pdfjs-dist` 6.3.289, 2026-10-07):

- **Profile A — text-heavy, `long-sample.pdf`, a thousand pages, three page sizes cycling so no single
  estimate flatters it.** A page that had never been painted took a median **102 ms** of five samples
  (101–112 ms) to its first ink, which is still *above* §6's 100 ms bar on this machine — by 2 ms today,
  by 47 ms in the 2026-10-04 record and by 90 ms in the one from earlier today at `a37af3f` — and the
  record says so rather than promoting a number into a requirement. That spread is also why the bar stays
  where the document put it: §6 keeps baselines out of the
  contract precisely so a machine cannot vote. Four page canvases and four slots were the most mounted anywhere
  in a forty-step pass, no sample along the way was blank, the widest canvas reached 4.6 MP against a 33.6 MP
  absolute ceiling, and the longest main-thread block in a cold load was 57 ms.
- **Profile B — image-heavy, `scan-sample.pdf`, twelve pages each carrying one 2550×3300 RGB scan.** Pages
  paint at **29.53 % ink** where a text page manages 0.52 %, and a cold page took a median 183 ms (181–295 ms
  across the five, the work being the 25 MP decode each page carries). Two canvases and two slots at the peak
  of the scroll; 3.8 MP largest, 1571 px widest.
- **Profile C — vector-heavy, `vector-sample.pdf`, four A1 drawing sheets of 336 clipped cells each.** The
  engine reports 12,922 operators per sheet, and this is the profile where the two costs are told apart — by
  marks the viewer puts in its own paint path, read from the load being measured, not by subtracting one page
  load from another. Sheet 4 came in at a median 171 ms cold; inside that same load the awaited `page.render()`
  took 110.9 ms and the passes this package drives — text, annotations, XFA — took a median **69.8 ms**, against
  §6's 200 ms for this profile. The same page at the same box with none of the viewer in the way
  (`playground/raw.html`) rendered in a median 66.1 ms, and the record prints both engine numbers rather than
  choosing: they answer different questions, and the marked one is the one attributed.
- **Profile D — the low-memory harness.** The scans again, on a 412×915 phone context at dpr 3 with an
  Android user agent and 6× CPU throttling, zoomed to 300 % through the toolbar's overflow menu because that
  is where the control is on a bar that narrow. The canvas came back at 5.2 MP — the mobile package default,
  to two decimal places — painted at **1.10× instead of 3×** and still showing 27.7 % ink, and the tab was
  alive to report it. That is the clause: resolution gives way, not the page. A throttled desktop core is not
  a handset, and §6's real-device pass is still open.
- **The cap that actually binds is the screen-relative one.** At dpr 2 and 500 % zoom a letter page would
  want 48.5 MP; the ceiling that applies on a 1280×900 display is 13.8 MP, the canvas came back at 13.8 MP
  rendered at 1.07× instead of 2×, and the page still painted. Resolution degrades, the tab does not die —
  which is the whole point of the caps, and the reason the benchmark reads the ceiling out of
  `src/lib/canvas.ts` rather than copying it.
- **A zoom step re-lays out the text layer instead of rebuilding it.** 39.8 ms per page per step became
  1.0 ms, which is the difference between zooming on a dense page and watching it flicker.
- **A feature's expensive question is asked when it is needed, not when it is mounted.** Reading a
  thousand-page document to find its signature fields costs 150–200 ms of main thread, and 0 ms for a
  document that declares no form — the panel asks the engine that cheap question on open, shows the
  pad, and parses the file only once there is a mark to place. The parse runs once per document and
  says what it is doing while it runs.
- **Writes are deliberate, so a batch costs one pass.** Moving ten pages is ten edits to a list of
  integers and one writer pass at Apply; the plan is kilobytes and the document is megabytes, which is
  also why undo costs nothing until a file is actually written.

What that last group buys is the shape of the rule: bytes may grow where a feature genuinely reads and
writes files, and what is not allowed is work done without being asked for, twice, or in silence.

## Browser support

The contract floors are `PRD.md` §8's: Chrome and Edge 125, Safari and iOS Safari 18, Firefox 124
(provisional), Node 22.13.0, `pdfjs-dist` 6.2.108. Those are the *minimums the promise carries*; what has
actually proved each of them is a different column of the same table, and it is mostly `unverified`.

What is measured where: `npm run test:browsers` (FR-48) drives thirteen claims — a canvas that paints,
backing-store density against `devicePixelRatio`, selectable text, search marks and the no-hits state,
thumbnails and outline, the 1,000-page document's slot count, the toolbar fold at 375 px, keyboard paging,
wheel zoom against plain scroll, pinch against two-finger pan, forced colours, uncaught errors — through
Chromium, Firefox and WebKit at 1280×900 and 375×812 dpr 2. **All three engines run on this host**: the
2026-10-04 pass is **67 ok, 5 skipped, 0 failed** over six cells — Chromium 153 with 23 ok and 1 skip, Firefox
155 and WebKit 26 with 22 ok and 2 skips each — and every skip belongs to the emulation rather than the
viewer, which dispatches no wheel events on the small profile and, on Firefox and WebKit, exposes no `Touch`
constructor to synthesise a pinch from. What that is *not* is floor evidence. §8 claims Chrome 125, Firefox
124 and Safari 18, and its own execution policy says a current browser passing the suite does not certify an
older floor; no Edge check has ever run anywhere, and no real device has been touched. The CI `browser` job
has now run — green on 2026-10-04 with the same 67 ok / 5 skipped over six cells — but it installs
Playwright's current builds, so it is the same evidence as a local run and not the pinned-floor job §8's
execution policy names.

**That gap is now an instrument rather than an intention, and the instrument says the floors are wrong.**
`npm run test:floors` drives the playground in the pinned browser build each §8 row names — a browser build comes
from the Playwright release cut against it, so Chromium 125 is Playwright 1.44.1, Firefox 124 is 1.43.1 and
WebKit 18.0 is 1.46.1 — and it refuses to run at all unless the drivers are pinned, because the current build
passing is exactly the inference §8 forbids. Measured on 2026-10-09, none of the three rendered a document:
Chromium 125 boots and then the viewer's own status line reads `Failed to load PDF: URL.parse is not a function`
with a *Try again* button — FR-54's error surface reporting the engine, `URL.parse` and `Promise.try` both
undefined there — while Firefox 124 and WebKit 18.0 never reach a first paint, throwing `Iterator is not defined`
and `Can't find variable: Iterator` because `pdf.mjs` evaluates `Iterator.prototype` at module scope. Those are the
engine's own calls, counted across all five published `pdfjs-dist` 6.x releases (`6.0.227`, `6.1.200`, `6.2.108`,
`6.3.289`, `6.4.299`): every one calls `URL.parse` eight times in `pdf.mjs` and three in the worker, and
`Promise.try` four times in each, while the module-scope `Iterator.prototype` check arrives with `6.2.108` — the
floor this package advertises. So §8's browser numbers are the promise the engine it names cannot keep, and raising
them (or lowering the engine floor, which the §6.2 advisory forbids) is a contract decision rather than a code
change. Until it is taken, the floor rows stay `unverified` and the instrument stays out of CI, where it would be
red by design. The CSS ships `@media`
fallbacks beside every `@container` rule and avoids `:has()`. Both of those are written against a target that
no longer exists: `@container` and `:has()` are older than the §8 floor of Safari 18, so the fallbacks are
margin rather than requirement, nothing exercises them, and no test would fail if someone deleted them. If
Safari is critical to you, test that first.

## Links

- [CHANGELOG.md](./CHANGELOG.md) — release entries, development log, versioning policy.
- [ROADMAP.md](./ROADMAP.md) — which features ship in which `0.x` release on the way to `1.0.0`.
- [Documentation site](https://princegoel0.github.io/pdfjs-react-reader/) — live examples; source in
  `docs/`, served on :5200 by `npm run docs`, published from `main` by `.github/workflows/docs.yml`.
- [PRD.md](./PRD.md) — the original requirements (`FR-nn`) and architecture; §2 records what stays
  out of `1.0`.
- [CODE_REFERENCE.md](./CODE_REFERENCE.md) — what the software **does**, read out of the source rather
  than out of the documents: every import path, prop, name, constant, feature and failure behaviour, with
  the file and line each claim came from. Where this and `PRD.md` disagree, the code wins and the
  disagreement is listed in its final section.

## Development

```bash
npm run dev          # playground on :5199 with the repo's fixture PDFs
npm run serve:auth   # the same fixtures on :5300, behind `Authorization: Bearer dev-token`
npm run docs         # documentation site on :5200
npm run verify       # typecheck + tests + build + size + packaging + examples + maturity + deps + docs + evidence
npm run check:deps   # §6.2: both audit surfaces matched against security/dependency-triage.json (path: SECURITY.md)
npm run check:examples  # every documented example, type-checked against the packed artifact, not against src
npm run size:update  # accept new baseline numbers after a deliberate growth
node scripts/make-form-pdf.mjs       # AcroForm: text, checkbox, radio, choice, button
node scripts/make-outline-pdf.mjs    # 3 pages, bookmarks, named destinations
node scripts/make-encrypted-pdf.mjs  # RC4-40 encrypted, password "secret"
node scripts/make-cjk-pdf.mjs        # CID-encoded, so the cMap path is exercised
node scripts/make-scripted-pdf.mjs   # document-level JavaScript
node scripts/make-attachments-ocg-pdf.mjs  # 3 attached files + 3 layers, one off by default
node scripts/make-annotated-pdf.mjs  # highlight, underline, strikeout, squiggly, note, ink, free text
node scripts/make-labelled-pdf.mjs   # /PageLabels: roman front matter, a decimal body, an A- appendix
node scripts/make-tagged-pdf.mjs   # /MarkInfo, a /StructTreeRoot and marked content: heading, list, table, figure
node scripts/make-page-order-pdf.mjs # 20 pages, each printing its own number, page 5 rotated
node scripts/make-signature-pdf.mjs  # four /FT /Sig fields in three shapes, one already signed
node scripts/make-xfa-pdf.mjs        # pure XFA: single-stream /XFA packet, no /Fields
node scripts/make-xfa-array-pdf.mjs  # the same packet in array form, and an AcroForm hybrid
node scripts/make-long-pdf.mjs       # 1,000 pages in a nested tree, for the performance bar
node scripts/make-vector-pdf.mjs     # four A1 drawing sheets, 336 clipped cells each: §6's profile C
node scripts/make-oversize-pdf.mjs   # 612×792, 12,000×9,000 and 200,000×600 pt pages, for the caps
```

`playground/` exercises the whole surface against generated fixtures (AcroForm, outline with named
destinations, RC4-encrypted, CID-encoded CJK, document-level JavaScript, embedded files with
optional-content layers, seven kinds of markup, a 20-page document for page editing, four XFA
containers, and one tagged document whose structure tree reads back as headings, a list, a table and a
named figure). Point it at `npm run serve:auth` and a bearer token to see the network options do their
work: without the token the viewer reports the 401 and offers a retry, with it the same URL paints.

One limit worth knowing before you trust a green suite: **no test loads real PDF bytes through the shell in
jsdom.** The shell itself is mounted against a document that has finished loading — `src/components/ViewerLayout.ready.test.tsx`
drives the whole composed viewer over a hand-built page proxy, the same class of stand-in the page-level files use —
but the engine cannot be opened under Node: pdf.js calls `Uint8Array.prototype.toHex` (in the catalog's fingerprint
path) and `Map.prototype.getOrInsertComputed`, and Node v24 has neither, so a load of actual bytes fails there rather
than painting. The painted page is therefore verified in the browser matrix and not by `npm test`. `docs/` is a Vite app that renders the library — against `src` in
development, against the built `dist` in CI.

## Status

Version `0.11.0`, built on `dev` and **not pushed**: the `0.2`–`0.11` sequence lives on this machine
only — `git rev-list --count origin/dev..dev` is where to read that number, and `git log` on `dev` which
of these releases is committed, rather than from a sentence that goes stale one commit later. Nothing is
published. npm has `0.1.0`, `0.1.1` and `0.1.2` (the last one went out on 2026-09-25); everything from `0.2` 
to `0.11` exists only on local `dev` and publishes together with `1.0.0`, which is the
shipping rule in [`ROADMAP.md`](./ROADMAP.md) §Releases. So the tables above describe this working tree,
not the tarball on npm. While the package is pre-1.0 a minor may break the API — `0.4` did, with six
`PdfViewer` props becoming four feature imports — so pin exactly.

## Licence

MIT — see [LICENSE](./LICENSE).
