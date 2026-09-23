import { ShellExample } from '../examples/ShellExample';

export function Introduction() {
  return (
    <>
      <h1>Introduction</h1>
      <p className="doc-lede">
        An MIT-licensed, headless-first PDF viewer for React, built directly on Mozilla's{' '}
        <code>pdfjs-dist</code>. It ships the plumbing that is tedious to get right — virtualized
        rendering, the canvas/text/annotation layer stack, worker lifecycle, search, forms, and
        printing — as hooks you can drive from your own UI, plus an optional drop-in component.
      </p>

      <ShellExample />

      <h2>Why</h2>
      <p>
        Most React PDF viewers are either unmaintained wrappers around old <code>pdfjs-dist</code>{' '}
        releases, or they put search, form filling and annotations behind a commercial licence. This
        one talks to the engine directly and keeps every capability free under MIT.
      </p>

      <h2>What you get</h2>
      <ul>
        <li>
          <strong>Virtualized rendering.</strong> Only the rows crossing the viewport keep a live
          canvas; off-screen pages are unmounted and their pixel buffers cleared, which is what
          keeps long documents alive on mobile Safari.
        </li>
        <li>
          <strong>Real text layer.</strong> Selectable, searchable text rendered as an overlay, with
          search matches highlighted in place.
        </li>
        <li>
          <strong>Forms and annotations.</strong> Interactive AcroForm widgets (text, checkbox,
          radio, choice, button) wired to pdf.js annotation storage, plus link annotations and
          freehand ink.
        </li>
        <li>
          <strong>Search, outline, thumbnails, layout modes.</strong> Continuous, single page and
          two-page spread.
        </li>
        <li>
          <strong>Printing and download.</strong> A headless print pipeline that renders every page
          at print intent, and a save that can carry your form edits.
        </li>
        <li>
          <strong>Encrypted documents.</strong> A built-in password prompt, or take over the UI
          entirely.
        </li>
      </ul>

      <h2>Two entry points</h2>
      <table className="doc-table">
        <thead>
          <tr>
            <th>Import</th>
            <th>Contains</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>
              <code>pdfjs-react-reader</code>
            </td>
            <td>
              Everything: the <code>PdfViewer</code> shell, its parts, and every headless hook.
            </td>
          </tr>
          <tr>
            <td>
              <code>pdfjs-react-reader/headless</code>
            </td>
            <td>Hooks and pure helpers only — no shell components, no toolbar markup.</td>
          </tr>
          <tr>
            <td>
              <code>pdfjs-react-reader/styles.css</code>
            </td>
            <td>The default theme. Import it, or theme through the tokens.</td>
          </tr>
        </tbody>
      </table>

      <h2>Footprint</h2>
      <p>
        Measured gzipped, excluding <code>pdfjs-dist</code> itself, which stays a peer dependency:
      </p>
      <table className="doc-table">
        <thead>
          <tr>
            <th>Consumer path</th>
            <th>Size</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>
              Shell (<code>index.js</code> + shared chunk + CSS)
            </td>
            <td>37.0 kB</td>
          </tr>
          <tr>
            <td>
              Headless (<code>headless.js</code> + shared chunk + CSS)
            </td>
            <td>22.3 kB</td>
          </tr>
        </tbody>
      </table>
      <p>
        CI runs <code>npm run size</code> and fails the build over the 45 kB budget, so these
        numbers cannot drift quietly.
      </p>

      <h2>Accessibility</h2>
      <p>
        The shell is built to be usable by keyboard and screen reader out of the box: the page
        region is focusable so the search and print shortcuts are reachable, controls carry{' '}
        <code>aria-label</code>, disclosures use <code>aria-expanded</code> and toggles{' '}
        <code>aria-pressed</code>, the match counter is an <code>aria-live</code> region, load
        failures are <code>role="alert"</code>, and every text token clears WCAG AA contrast. Touch
        targets reach 44&nbsp;px on coarse pointers while mouse-driven screens keep the dense
        layout. Shortcuts are scoped to the viewer instance, so a viewer never hijacks the host
        page's <code>Ctrl+F</code>.
      </p>

      <h2>Browser support</h2>
      <p>Chrome ≥ 90, Safari ≥ 14, Firefox ≥ 90, Edge ≥ 90, and modern mobile browsers.</p>
    </>
  );
}
