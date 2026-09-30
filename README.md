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
turning, deleting, extracting and splitting whole pages is `editFeature`, which also draws a signature into a form's signature field — the one
tier that brings its own PDF writer, so it is an optional peer rather than a dependency of everything
else.

## What it does

Core, in every import of the shell:

- **Virtualized** — only rows crossing the viewport hold a live canvas, and off-screen buffers are
  cleared, which is what keeps a 400-page document alive on mobile Safari.
- **Selectable text layer** with search matches highlighted in place.
- **Search** across the whole document, debounced, with stale runs cancelled. Several words mean a
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
  says which half is which. Its thumbnails are blank too, for the reason you would guess: a pure-XFA
  page paints no operators.
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
  touch, keyboard paging, optional drag-and-drop to open a file, any percentage from 25 % to 500 %, and
  an `Automatic` mode that fits a landscape page whole and a portrait one by width.
- **Localisable** — every string in the shell lives in one typed catalog, 144 labels after the signing work; override
  the subset you need and the rest keeps its English default, or take a complete language from
  `pdfjs-react-reader/locales/de`, `/fr` or `/es` — 2.37–2.39 kB gzipped each, and a separate entry so
  importing the viewer never hands you a language you did not ask for.
- **Composable** — the shell's state is `useViewerController`, published through `ViewerProvider`, and
  the four parts (`ViewerRoot`, `ViewerToolbar`, `ViewerSidebar`, `ViewerPages`) read it. Write your own
  arrangement without forking anything, and hand the toolbar `{ hide, priorities, order, add }` to
  decide which of its controls survive.
- **Accessible** — see [Accessibility](#accessibility).

Opt-in, one import each:

| Feature | Adds | Cost over core |
| --- | --- | --- |
| `features/print` | Print at print intent — all pages, the current one, or a range the reader picks — honouring stored form values and ink, with a memory-budgeted resolution, a cancellable progress loop and `Ctrl/Cmd + P`. | 2.52 kB |
| `features/download` | Download of the original bytes, or an incremental save carrying the edits — field values and annotation marks both ride the same storage. | 0.75 kB |
| `features/forms` | AcroForm widgets — text, checkbox, radio, choice, button — wired to pdf.js annotation storage, with `createFormsFeature({ onChange })` and programmatic get/set/reset. | 2.02 kB |
| `features/outline` | The bookmarks sidebar tab. | 0.94 kB |
| `features/layers` | A sidebar tab listing the document's optional-content groups, switching one and having every page redraw. | 1.19 kB |
| `features/attachments` | A sidebar tab listing the files embedded in the PDF and saving any one of them. | 1.07 kB |
| `features/annotate` | Marking up the document: pdf.js's own editor manager behind three tools — highlight, free text, ink — with a highlight colour from the engine's palette, and a Delete that is live only while a mark is selected. Undo and redo are on the state the feature publishes, so the controls are yours to place. | 1.83 kB |
| `edit` | Whole pages, and a file that no longer depends on a reader: a **Pages** sidebar tab that moves, turns and removes pages through a plan you can step back before writing anything, then applies it, extracts the planned pages as a new file, or splits the list at any row into two. Plus **Flatten**, which bakes every mark and field value into the page so it survives a viewer with no editor to show it.
  A **Sign** section appears in that tab when the document has signature fields: draw a mark, choose a box, and it is
  written into the field's appearance. It is a picture of a signature — the file is never given a signature value, and
  a box that already holds a real one is refused rather than covered over. This is the one tier with its own dependency — `@cantoo/pdf-lib`, an *optional* peer, imported by nothing else. | 5.87 kB |

All eight together cost 14.76 kB, less than their sum, because they share the shell they attach to.
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
| `pdfjs-dist` | `^6.2.108` | 6.3.289, the version installed here; CI would install it too, but no `0.x` commit has been pushed, so no job has ever run |
| `react` | `^18.0.0 \|\| ^19.0.0` | 19.3.0 and 18.3.1, both verified locally. The 18 pass was re-run on 2026-09-29 with `@types/react@18`: `npm run verify` end to end — typecheck, all 449 tests then in the suite, both bundles, the size gate. A `react` matrix job in `ci.yml` installs both majors on every push and is what keeps this true after the next change; it has not run yet |
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

Your bundler needs to handle ESM and `exports` maps — Vite 5+, webpack 5+, Rollup 4+, esbuild and
Turbopack all work. There is no CommonJS build.

## Entry points

| Import | Contains |
| --- | --- |
| `pdfjs-react-reader` | Everything: the `PdfViewer` shell, its parts, the feature contract, and every headless hook. Importing `PdfViewer` does not drag in features you did not mount. |
| `pdfjs-react-reader/headless` | Hooks and pure helpers only — no shell components. |
| `pdfjs-react-reader/features/{print,download,forms,outline,layers,attachments,annotate}` | One optional capability each. |
| `pdfjs-react-reader/edit` | The page-editing and flatten tier: `editFeature`, `createEditFeature`, the pure page-plan helpers, and `arrangePages` / `flattenBytes` on their own. The only entry that reaches for `@cantoo/pdf-lib`. |
| `pdfjs-react-reader/styles.css` + `/print.css` `/forms.css` `/outline.css` `/layers.css` `/attachments.css` `/annotate.css` `/edit.css` | The default theme for the core chrome, as CSS custom properties, then one sheet per feature that has markup of its own. Separate files because a bundler drops CSS that no JavaScript imports — import the sheets for what you mounted, and nothing else. |

## Headless

Build the entire interface yourself. This is a working viewer in about forty lines:

```tsx
import { useState } from 'react';
import { PdfPage, usePdfDocument, usePdfVirtualizer } from 'pdfjs-react-reader/headless';

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

## The shell, controlled

`PdfViewer` owns its own state, so it takes a ref instead of a pile of controlled props:

```tsx
import { useRef } from 'react';
import { PdfViewer, type PdfViewerHandle } from 'pdfjs-react-reader';

const viewer = useRef<PdfViewerHandle>(null);

<PdfViewer ref={viewer} src="/contract.pdf" onPageChange={setPage} onScaleChange={setZoom} />;

viewer.current?.goToPage(12);
viewer.current?.zoomTo(1.5);        // any percentage, not just the presets
viewer.current?.rotatePage(3, 90);  // one page, not the document
viewer.current?.search('indemnity');
```

`goToPage · zoomTo · zoomBy · fitTo · setLayout · rotate · rotatePage · openSidebar ·
toggleFullscreen · search` are the whole surface. The change events fire for what the user did, not
for what mounted: a fit mode resolving to 87 % during load does not announce itself as a change.

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
<PdfViewer
  src="/contract.pdf"
  features={[printFeature]}
  controls={{
    hide: ['draw', 'meta'],
    priorities: { layout: 2 },   // what survives a narrow bar
    order: ['search', 'page'],   // where controls sit while it is in it
    add: [myControl],            // an existing id replaces it in place
  }}
/>
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
} from 'pdfjs-react-reader';

function ReadingView(props) {
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
toolbar controls, a sidebar panel, key bindings and per-page props. The eight built-ins are written
against this same contract.

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
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
<PdfViewer src={src} workerSrc={workerUrl} />
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
<PdfViewer src={userUrl} allowedSources={['/uploads/', 'https://cdn.example.com']} />
```

Once a document is open, `onCapabilities` says what it is, which is the only way to know a form will
not fill in before the user types into it:

```tsx
<PdfViewer src={src} onCapabilities={(c) => c.form /* 'none' | 'acroform' | 'xfa' | 'mixed' */} />
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
`annotate.css`, `edit.css`) so a
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
- Shortcuts are scoped to the viewer instance: a viewer never hijacks the host page's `Ctrl+F`.
  `Ctrl/Cmd + P` belongs to `printFeature`, so a viewer that did not mount it leaves the key to the
  browser.
- Controls carry `aria-label`; disclosures use `aria-expanded`, toggles `aria-pressed`.
- The match counter is an `aria-live="polite"` region; load failures are `role="alert"`.
- Every text token clears WCAG AA contrast, measured rather than assumed.
- Touch targets reach 44 px with 8 px gaps on coarse pointers; `prefers-reduced-motion` is honoured.

## Size

Gzipped, excluding `pdfjs-dist`, React and `@cantoo/pdf-lib` (all peer dependencies). Each row is one
consumer file bundled twice — with esbuild and with Rollup — and the larger of the two is what is
quoted, so a path only counts as small if two independent tree-shakers agree.

| What you import | Size | Over core |
| --- | --- | --- |
| `PdfViewer`, no features — pages, text, search, ink, thumbnails, chrome | 27.76 kB | — |
| `+ printFeature` | 30.28 kB | +2.52 kB |
| `+ downloadFeature` | 28.51 kB | +0.75 kB |
| `+ formsFeature` | 29.78 kB | +2.02 kB |
| `+ outlineFeature` | 28.71 kB | +0.94 kB |
| `+ layersFeature` | 28.95 kB | +1.19 kB |
| `+ attachmentsFeature` | 28.84 kB | +1.07 kB |
| `+ annotateFeature` | 29.59 kB | +1.83 kB |
| `+ editFeature` | 33.63 kB | +5.87 kB |
| All eight | 42.53 kB | +14.76 kB |
| A single headless hook (`usePdfDocument`) | 4.06 kB | — |
| A shipped locale catalog (`locales/de`, `/fr` or `/es`) | 2.37–2.39 kB | separate entry, not over core |

Summing the shipped files of a whole entry — what a bundler that cannot tree-shake pays — gives
57.90 kB for `index.js` and 30.85 kB for `headless.js`, each with `styles.css`. `edit.js` is its own
file at 8.55 kB, and it is the only shipped file that imports the writer, so a host that never mounts
the tier never loads it.

CI runs `npm run size`, which compares each path against the numbers committed in
`size-baseline.json` and fails when one grows more than 2 % above them (plus 256 bytes of slack, so
minifier jitter is not a failure), and separately fails if any single feature exceeds **6 kB** over
core. It is a ratchet rather than a ceiling: a library that grows with features cannot honestly promise
a fixed size, and `pdfjs-dist` decides a bundle's weight long before this layer does. What the gate
guarantees is that bytes never arrive quietly — accepting growth means running `npm run size:update`,
so the increase lands in the same diff as the code that caused it. Shrinking is always allowed and
reported.

The 6 kB figure is not the ceiling this project started with: it was 4 kB until the signing work, which
measured 4.73 kB for the writer pass and the geometry it needs *before* any interface was counted. The
number moved because the requirement that does not bend is a different one — what a feature does to the
reader's machine, not what it weighs — and that is written down rather than smoothed over. See
[Behaviour under load](#behaviour-under-load).


For scale, `pdfjs-dist` 6.3.289 gzips to 131.7 kB for the main-thread module (`pdf.min.mjs`) and 375.3 kB
for its worker, and `@cantoo/pdf-lib` 2.11.1 bundles minified to 251.4 kB for what the `edit` tier
actually imports — 256.1 kB if a host takes the whole API — each measured the way `scripts/check-size.mjs`
measures, at gzip level 9. So the engine dominates any viewer bundle regardless of this package, and the
`edit` tier doubles that weight when a host mounts it and installs the writer.

## Behaviour under load

Size is a ratchet. This is the requirement that is not: the viewer has to stay smooth while it is
working, on documents big enough to make a mistake visible. Every figure here is measured against
`long-sample.pdf` — a thousand pages, a nested page tree, three page sizes cycling so no single
estimate flatters it — in Chromium on one Windows machine, which is the honest limit of what has been
tested (see [Browser support](#browser-support)).

- **Scrolling a thousand pages drops no frames.** A reader-speed pass measures p50 7.0 ms and a max of
  14.1 ms per frame, with zero frames over 16.7 ms; a faster 1,100 px/frame pass peaks at 14.0 ms, also
  with none over. Reaching a page that has never been painted and drawing it takes 38–55 ms.
- **Only what is on screen is held.** Two to four page canvases are mounted at any moment across the
  whole pass, and a row that leaves the viewport has its canvas zeroed rather than kept.
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

Targets are Chrome ≥ 90, Safari ≥ 14, Firefox ≥ 90 and Edge ≥ 90, plus modern mobile browsers.

Honesty note: every measurement in the development log was taken in Chromium. Safari and Firefox are
targets, not verified — the CSS ships `@media` fallbacks beside every `@container` rule and avoids
`:has()` precisely because Safari 14 has no container queries, but nothing has been measured there.
If Safari is critical to you, test that first.

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
npm run verify       # typecheck + tests + build + size gate (prepublishOnly runs this)
npm run size:update  # accept new baseline numbers after a deliberate growth
node scripts/make-form-pdf.mjs       # AcroForm: text, checkbox, radio, choice, button
node scripts/make-outline-pdf.mjs    # 3 pages, bookmarks, named destinations
node scripts/make-encrypted-pdf.mjs  # RC4-40 encrypted, password "secret"
node scripts/make-cjk-pdf.mjs        # CID-encoded, so the cMap path is exercised
node scripts/make-scripted-pdf.mjs   # document-level JavaScript
node scripts/make-attachments-ocg-pdf.mjs  # 3 attached files + 3 layers, one off by default
node scripts/make-annotated-pdf.mjs  # highlight, underline, strikeout, squiggly, note, ink, free text
node scripts/make-labelled-pdf.mjs   # /PageLabels: roman front matter, a decimal body, an A- appendix
node scripts/make-page-order-pdf.mjs # 20 pages, each printing its own number, page 5 rotated
node scripts/make-signature-pdf.mjs  # four /FT /Sig fields in three shapes, one already signed
node scripts/make-xfa-pdf.mjs        # pure XFA: single-stream /XFA packet, no /Fields
node scripts/make-xfa-array-pdf.mjs  # the same packet in array form, and an AcroForm hybrid
node scripts/make-long-pdf.mjs       # 1,000 pages in a nested tree, for the performance bar
```

`playground/` exercises the whole surface against generated fixtures (AcroForm, outline with named
destinations, RC4-encrypted, CID-encoded CJK, document-level JavaScript, embedded files with
optional-content layers, seven kinds of markup, a 20-page document for page editing, four XFA
containers). Point it at `npm run serve:auth` and a bearer token to see the network options do their
work: without the token the viewer reports the 401 and offers a retry, with it the same URL paints.

One limit worth knowing before you trust a green suite: **no test has mounted the real viewer controller
against a document that had finished loading** — under jsdom that combination hangs, so the shell's page
path is covered by unit tests around its parts and by browser passes against the playground, not by a
jsdom render of the whole viewer. Fixing the harness is part of the CI work in `ROADMAP.md`. `docs/` is a Vite app that renders the library — against `src` in
development, against the built `dist` in CI.

## Status

Version `0.9.0`, built on `dev` and **not pushed**: the `0.2`–`0.9` sequence lives on this machine
only — `git rev-list --count origin/dev..dev` is where to read that number, rather than from a sentence
that goes stale one commit later. Nothing is published. npm has `0.1.0` and `0.1.1`; the `0.2`–`0.9` releases are
committed locally and publish together with `1.0.0`, and `0.10`–`0.12` are planned but not started, which
is the shipping rule in [`ROADMAP.md`](./ROADMAP.md) §Releases. While the package is pre-1.0 a minor may
break the API — `0.4` did, with six `PdfViewer` props becoming four feature imports — so pin exactly.

## Licence

MIT — see [LICENSE](./LICENSE).
