# pdfjs-react-reader

A headless-first PDF viewer for React, built directly on [pdfjs-dist](https://www.npmjs.com/package/pdfjs-dist).
MIT-licensed, no feature behind a paywall.

It ships the parts that are tedious to get right — virtualized rendering, the canvas/text/annotation
layer stack, worker lifecycle, whole-document search, AcroForm editing, printing — as hooks you can
drive from your own interface, plus an optional drop-in component for when you just need a viewer.
In that component, a capability is an import rather than a prop, so the bundle holds only the ones you
mounted.

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
thumbnails, ink, zoom, rotation, layout. Print, save, fillable form widgets and the bookmarks tab are
`printFeature`, `downloadFeature`, `formsFeature` and `outlineFeature`.

## What it does

Core, in every import of the shell:

- **Virtualized** — only rows crossing the viewport hold a live canvas, and off-screen buffers are
  cleared, which is what keeps a 400-page document alive on mobile Safari.
- **Selectable text layer** with search matches highlighted in place.
- **Search** across the whole document, debounced, with stale runs cancelled.
- **Thumbnails, rotation, layout modes** (continuous, single page, two-page spread). Rotation works
  per page as well as globally, and the text and annotation layers turn with it.
- **Annotations on screen** — link annotations and markup render read-only; freehand ink is stored in
  PDF user space, so zoom and rotation both map correctly, and it prints.
- **Encrypted documents** with a built-in password prompt you can replace.
- **Production edges** — a canvas area ceiling (an over-large canvas paints blank rather than
  throwing), an `allowedSources` allowlist for URLs you did not author, pdf.js support assets served
  from your own origin, an opt-in Trusted Types policy, and a `capabilities` report of what the
  opened document declares.
- **Driven from code** — a `ref` handle (`goToPage`, `zoomTo`, `rotatePage`, `search`,
  `toggleFullscreen`, …) and change events that report what the user did rather than what mounted.
- **Gestures** — Ctrl/Cmd + wheel (which is also how a trackpad pinch arrives), two-finger pinch on
  touch, keyboard paging, optional drag-and-drop to open a file, and any percentage zoom.
- **Localisable** — every string in the shell lives in one typed catalog; override the subset you
  need and the rest keeps its English default.
- **Accessible** — see [Accessibility](#accessibility).

Opt-in, one import each:

| Feature | Adds | Cost over core |
| --- | --- | --- |
| `features/print` | Print at print intent — all pages, the current one, or a range the reader picks — honouring stored form values and ink, with a memory-budgeted resolution, a cancellable progress loop and `Ctrl/Cmd + P`. | 2.02 kB |
| `features/download` | Download of the original bytes, or an incremental save carrying the edits. | 0.86 kB |
| `features/forms` | AcroForm widgets — text, checkbox, radio, choice, button — wired to pdf.js annotation storage, with `createFormsFeature({ onChange })` and programmatic get/set/reset. | 1.99 kB |
| `features/outline` | The bookmarks sidebar tab. | 0.93 kB |

All four together cost 5.18 kB, less than their sum, because they share the shell they attach to.
They are also the reference for writing your own: the contract and the authoring hooks are public.
(Those costs are the `0.4.0` release build; see [Size](#size) for what the current release measures.)

## Requirements

| Package | Required | Tested with |
| --- | --- | --- |
| `pdfjs-dist` | `^5.0.0 \|\| ^6.2.108` | 6.3.289 |
| `react` | `^18.0.0 \|\| ^19.0.0` | 18.3.1, 19.3.0 |
| `react-dom` | `^18.0.0 \|\| ^19.0.0` | 18.3.1, 19.3.0 |

Nothing else at runtime — no state library, no date library, no polyfills, no CSS framework.

`pdfjs-dist` v4 is **not** supported: it has no `canvas` render parameter (its `render()` reads
`canvasContext.canvas`), so a v4 install would show blank pages rather than fail loudly. 4.2.67 also
lacks the `TextLayer` export. See [CHANGELOG.md](./CHANGELOG.md) for the full reasoning.

The 6.x floor is `6.2.108` rather than `6.0.0` on purpose: CVE-2026-16633 (high — arbitrary
JavaScript execution when opening a malicious PDF) affects `>= 5.6.83, < 6.2.108`, and no 5.x release
fixes it. v5 stays supported, but if you can move to `6.2.108` or later you should.

Your bundler needs to handle ESM and `exports` maps — Vite 5+, webpack 5+, Rollup 4+, esbuild and
Turbopack all work. There is no CommonJS build.

## Entry points

| Import | Contains |
| --- | --- |
| `pdfjs-react-reader` | Everything: the `PdfViewer` shell, its parts, the feature contract, and every headless hook. Importing `PdfViewer` does not drag in features you did not mount. |
| `pdfjs-react-reader/headless` | Hooks and pure helpers only — no shell components. |
| `pdfjs-react-reader/features/{print,download,forms,outline}` | One optional capability each. |
| `pdfjs-react-reader/styles.css` | The default theme for the core chrome, as CSS custom properties. |
| `pdfjs-react-reader/{print,forms,outline}.css` | The rules for those features' markup. Separate files because a bundler drops CSS that no JavaScript imports. |

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
runners, so print, save, forms and the outline panel work there exactly as they do in the default
layout; your own components inside it read the same state through `useViewer()`.

## Writing a feature

A feature is a value: a `Runner` component that owns the hooks and publishes state, plus optional
toolbar controls, a sidebar panel, key bindings and per-page props. The four built-ins are written
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

Nothing is assigned when no candidate answers, so pdf.js can still fall back to its main-thread
worker, and a failed load names `workerSrc` as the fix instead of surfacing a fetch error.

```tsx
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
<PdfViewer src={src} workerSrc={workerUrl} />
```

Pin it when you serve the worker from a CDN or copy it into a fixed location. Note that `pdfjs-dist`
itself needs DOM globals at import time, so this package is client-side only — in Next.js, import it
from a `"use client"` component and load it dynamically rather than in a server component.

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
(`styles.css`, then `print.css`, `forms.css`, `outline.css`) so a feature you did not mount also costs
you no CSS, but they all read the same tokens. See `docs/src/examples/ThemeExample.tsx` for full dark
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

Gzipped, excluding `pdfjs-dist` and React (both peer dependencies). Measured on `0.4.0`: each row is
one consumer file bundled with esbuild and with Rollup, and the larger of the two, so a path only
counts as small if two independent tree-shakers agree.

| What you import | Size | Over core |
| --- | --- | --- |
| `PdfViewer`, no features — pages, text, search, ink, thumbnails, chrome | 20.61 kB | — |
| `+ printFeature` | 22.63 kB | +2.02 kB |
| `+ downloadFeature` | 21.47 kB | +0.86 kB |
| `+ formsFeature` | 22.60 kB | +1.99 kB |
| `+ outlineFeature` | 21.54 kB | +0.93 kB |
| All four | 25.79 kB | +5.18 kB |
| A single headless hook (`usePdfDocument`) | 2.59 kB | — |

Summing the shipped files of a whole entry — what a bundler that cannot tree-shake pays — gives
44.01 kB for `index.js` and 21.77 kB for `headless.js`, each with `styles.css`.

CI runs `npm run size`, which compares each path against the numbers committed in
`size-baseline.json` and fails when one grows more than 2 % above them (plus 256 bytes of slack, so
minifier jitter is not a failure), and separately fails if any single feature exceeds 4 kB over core.
It is a ratchet rather than a ceiling: a library that grows with features cannot honestly promise a
fixed size, and `pdfjs-dist` decides a bundle's weight long before this layer does. What the gate
guarantees is that bytes never arrive quietly — accepting growth means running `npm run size:update`,
so the increase lands in the same diff as the code that caused it. Shrinking is always allowed and
reported.

For scale, `pdfjs-dist` itself is ~532 kB gzipped, so it dominates any viewer bundle regardless of
this package.

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

## Development

```bash
npm run dev          # playground on :5199 with the repo's fixture PDFs
npm run docs         # documentation site on :5200
npm run verify       # typecheck + tests + build + size gate (prepublishOnly runs this)
npm run size:update  # accept new baseline numbers after a deliberate growth
node scripts/make-form-pdf.mjs       # AcroForm: text, checkbox, radio, choice, button
node scripts/make-outline-pdf.mjs    # 3 pages, bookmarks, named destinations
node scripts/make-encrypted-pdf.mjs  # RC4-40 encrypted, password "secret"
node scripts/make-cjk-pdf.mjs        # CID-encoded, so the cMap path is exercised
node scripts/make-scripted-pdf.mjs   # document-level JavaScript
node scripts/make-attachments-ocg-pdf.mjs  # 3 attached files + 3 layers, one off by default
```

`playground/` exercises the whole surface against generated fixtures (AcroForm, outline with named
destinations, RC4-encrypted, CID-encoded CJK, document-level JavaScript, embedded files with
optional-content layers). `docs/` is a Vite app that renders the library — against `src` in
development, against the built `dist` in CI.

## Status

Version `0.4.0`, built on `dev`. npm has `0.1.0` and `0.1.1`; the `0.2`–`0.9` releases are committed
locally and publish together with `1.0.0`, which is the shipping rule in
[`ROADMAP.md`](./ROADMAP.md) §Releases. While the package is pre-1.0 a minor may break the API — `0.4`
did, with six `PdfViewer` props becoming four feature imports — so pin exactly.

## Licence

MIT — see [LICENSE](./LICENSE).
