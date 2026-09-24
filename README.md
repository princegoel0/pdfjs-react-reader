# pdfjs-react-reader

A headless-first PDF viewer for React, built directly on [pdfjs-dist](https://www.npmjs.com/package/pdfjs-dist).
MIT-licensed, no feature behind a paywall.

It ships the parts that are tedious to get right — virtualized rendering, the canvas/text/annotation
layer stack, worker lifecycle, whole-document search, AcroForm editing, printing — as hooks you can
drive from your own interface, plus an optional drop-in component for when you just need a viewer.

Every one of those has a runnable example on the
[documentation site](https://princegoel0.github.io/pdfjs-react-reader/).

```bash
npm install pdfjs-react-reader pdfjs-dist
```

```tsx
import { PdfViewer } from 'pdfjs-react-reader';
import 'pdfjs-react-reader/styles.css';

export function Report() {
  return <PdfViewer src="/contract.pdf" defaultScale="fit-width" />;
}
```

## What it does

- **Virtualized** — only rows crossing the viewport hold a live canvas, and off-screen buffers are
  cleared, which is what keeps a 400-page document alive on mobile Safari.
- **Selectable text layer** with search matches highlighted in place.
- **AcroForm widgets** — text, checkbox, radio, choice and button fields wired to pdf.js annotation
  storage, with `onFormValuesChange` and programmatic get/set/reset.
- **Search** across the whole document, debounced, with stale runs cancelled.
- **Outline, thumbnails, rotation, layout modes** (continuous, single page, two-page spread).
- **Freehand ink** stored in PDF user space, so zoom and rotation both map correctly — and it prints.
- **Printing** at print intent, honouring stored form values and ink, with a memory-budgeted
  resolution and a cancellable progress loop.
- **Download** of the original bytes, or an incremental save carrying the edits.
- **Encrypted documents** with a built-in password prompt you can replace.
- **Accessible** — see [Accessibility](#accessibility).

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

## Two entry points

| Import | Contains |
| --- | --- |
| `pdfjs-react-reader` | Everything: the `PdfViewer` shell, its parts, and every headless hook. |
| `pdfjs-react-reader/headless` | Hooks and pure helpers only — no shell components. |
| `pdfjs-react-reader/styles.css` | The default theme, as CSS custom properties. |

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
as above, or the `style` prop for a runtime value. See `docs/src/examples/ThemeExample.tsx` for full
dark and sepia presets.

## Responsive toolbar

The bar is not built from breakpoints. Each control carries a priority, the toolbar measures the
natural width of every one, and it folds the least useful into a `⋯` menu as space runs out — so page
navigation and zoom survive to 320 px while print, download and layout give way first. Control *size*
follows the input device instead: 44 px targets under `(pointer: coarse)`, 32 px with a mouse.

## Accessibility

- The page region is focusable (`role="region"`), so keyboard shortcuts are reachable and the region
  is announced.
- Shortcuts are scoped to the viewer instance: a viewer never hijacks the host page's `Ctrl+F`.
- Controls carry `aria-label`; disclosures use `aria-expanded`, toggles `aria-pressed`.
- The match counter is an `aria-live="polite"` region; load failures are `role="alert"`.
- Every text token clears WCAG AA contrast, measured rather than assumed.
- Touch targets reach 44 px with 8 px gaps on coarse pointers; `prefers-reduced-motion` is honoured.

## Size

Gzipped, excluding `pdfjs-dist` (a peer dependency):

| Path | Size |
| --- | --- |
| Shell — `index.js` + shared chunk + CSS | 37.0 kB |
| Headless — `headless.js` + shared chunk + CSS | 22.3 kB |
| A single headless hook (`usePdfDocument`) tree-shaken | 1.7 kB |

CI runs `npm run size` and fails above the 45 kB budget.

Both figures above are ceilings: because the package is ESM with `"sideEffects": ["**/*.css"]`,
importing only what you use costs less than the whole path. For scale, `pdfjs-dist` itself is ~532 kB
gzipped, so it dominates any viewer bundle regardless of this package.

Named imports are already tree-shakeable; the open work is making the *shell* opt-in per feature
rather than all-or-nothing, which is `ROADMAP.md` §0.4.

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
npm run verify       # typecheck + tests + build + size budget (prepublishOnly runs this)
node scripts/make-form-pdf.mjs   # regenerate fixtures
```

`playground/` exercises the whole surface against generated fixtures (AcroForm, outline with named
destinations, RC4-encrypted). `docs/` is a Vite app that renders the library — against `src` in
development, against the built `dist` in CI.

## Status

Version 0.1.0 — feature-complete against the brief, with documentation, CI and a size budget in
place. Not yet published to npm; the repository URL is still to be added to `package.json`.

## Licence

MIT — see [LICENSE](./LICENSE).
