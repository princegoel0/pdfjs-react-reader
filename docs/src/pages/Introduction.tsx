import { ShellExample } from '../examples/ShellExample';

export function Introduction() {
  return (
    <>
      <h1>Introduction</h1>
      <p className="doc-lede">
        An MIT-licensed, headless-first PDF viewer for React, built directly on Mozilla's{' '}
        <code>pdfjs-dist</code>. It ships the plumbing that is tedious to get right — virtualized
        rendering, the canvas/text/annotation layer stack, worker lifecycle, search, forms, page
        editing, and printing — as hooks you can drive from your own UI, plus an optional drop-in
        component whose extra capabilities are imports, so the bundle holds only the ones you mounted.
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
          <strong>Search, layout modes, and a sidebar.</strong> Continuous, single page and two-page
          spread; thumbnails are core, and the bookmarks tab is a feature you import.
        </li>
        <li>
          <strong>Forms, annotation editing, page editing, printing and download as features.</strong>{' '}
          Interactive AcroForm widgets (text, checkbox, radio, choice, button) wired to pdf.js annotation
          storage; highlight, free text and ink marks that are real PDF annotations and go back into the
          file on save; a <strong>Pages</strong> tab that moves, turns, removes, extracts and splits whole
          pages, and a flatten that bakes the marks in so they survive a viewer with no editor; a print
          pipeline that renders every page at print intent; a save that can carry your edits. Each is an
          import, and each is measured in the Footprint table below.
        </li>
        <li>
          <strong>XFA forms render.</strong> A pure-XFA document is painted from its own template instead
          of showing a blank page, and search marks its text as it marks a text layer. Saving one back is
          not offered, and the reason is measured rather than assumed —{' '}
          <a href="#/compatibility">the limits page</a> says which half of that was tested and which
          could not be. Its sidebar thumbnail stays blank, for the same underlying reason: a pure-XFA page
          paints no operators.
        </li>
        <li>
          <strong>Freehand ink.</strong> Core, and it goes to the printer with the page.
        </li>
        <li>
          <strong>Encrypted documents.</strong> A built-in password prompt, or take over the UI
          entirely.
        </li>
        <li>
          <strong>The production edges.</strong> Canvas ceilings, so deep zoom paints instead of
          blanking; a document-source allowlist for URLs you did not author; pdf.js support assets
          from your own origin; an opt-in Trusted Types policy; and a capabilities report that says
          what the opened document actually is.
        </li>
      </ul>

      <h2>Entry points</h2>
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
              Everything: the <code>PdfViewer</code> shell, its parts, the feature contract and every
              headless hook. Importing <code>PdfViewer</code> from here does not drag in the
              features you did not mount.
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
              <code>pdfjs-react-reader/edit</code>
            </td>
            <td>
              The page-editing and flatten tier: <code>editFeature</code>, <code>createEditFeature</code>,
              the pure page-plan helpers, and <code>arrangePages</code> / <code>flattenBytes</code> on
              their own. The only entry that reaches for <code>@cantoo/pdf-lib</code>, its{' '}
              <em>optional</em> peer — install it to mount this, and nothing else asks for it.
            </td>
          </tr>
          <tr>
            <td>
              <code>
                pdfjs-react-reader/features/{'{print | download | forms | outline | layers | attachments | annotate}'}
              </code>
            </td>
            <td>
              One optional capability each: its <code>Runner</code>, toolbar control, keys and panel,
              passed to <code>PdfViewer</code> as <code>features</code>.{' '}
              <a href="#/features">Features &amp; tiers</a>.
            </td>
          </tr>
          <tr>
            <td>
              <code>pdfjs-react-reader/styles.css</code>
            </td>
            <td>
              The default theme for the core chrome. Import it, or theme through the tokens.
            </td>
          </tr>
          <tr>
            <td>
              <code>
                pdfjs-react-reader/{'{print | forms | outline | layers | attachments | annotate | edit}'}.css
              </code>
            </td>
            <td>
              The rules for those features&apos; markup, as separate files because a bundler drops CSS that
              no JavaScript imports.
            </td>
          </tr>
        </tbody>
      </table>

      <h2>Footprint</h2>
      <p>
        Measured gzipped, excluding <code>pdfjs-dist</code>, React and{' '}
        <code>@cantoo/pdf-lib</code> — all peer dependencies, the last of them optional and pulled in
        only by the <code>edit</code> tier. Each row is a real consumer file bundled once with esbuild
        and once with Rollup, and the larger of the two reported:
      </p>
      <table className="doc-table">
        <thead>
          <tr>
            <th>What you import</th>
            <th>Size</th>
            <th>Over core</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>
              <code>PdfViewer</code> alone — pages, text, search, ink, thumbnails, chrome
            </td>
            <td>24.77 kB</td>
            <td>—</td>
          </tr>
          <tr>
            <td>
              <code>+ printFeature</code>
            </td>
            <td>27.28 kB</td>
            <td>+2.50 kB</td>
          </tr>
          <tr>
            <td>
              <code>+ downloadFeature</code>
            </td>
            <td>25.55 kB</td>
            <td>+0.78 kB</td>
          </tr>
          <tr>
            <td>
              <code>+ formsFeature</code>
            </td>
            <td>26.69 kB</td>
            <td>+1.92 kB</td>
          </tr>
          <tr>
            <td>
              <code>+ outlineFeature</code>
            </td>
            <td>25.71 kB</td>
            <td>+0.93 kB</td>
          </tr>
          <tr>
            <td>
              <code>+ layersFeature</code>
            </td>
            <td>25.98 kB</td>
            <td>+1.21 kB</td>
          </tr>
          <tr>
            <td>
              <code>+ attachmentsFeature</code>
            </td>
            <td>25.88 kB</td>
            <td>+1.10 kB</td>
          </tr>
          <tr>
            <td>
              <code>+ annotateFeature</code>
            </td>
            <td>26.64 kB</td>
            <td>+1.86 kB</td>
          </tr>
          <tr>
            <td>
              <code>+ editFeature</code> — pages and flatten
            </td>
            <td>28.35 kB</td>
            <td>+3.58 kB</td>
          </tr>
          <tr>
            <td>All eight</td>
            <td>37.03 kB</td>
            <td>+12.25 kB</td>
          </tr>
          <tr>
            <td>
              One headless hook (<code>usePdfDocument</code>)
            </td>
            <td>2.59 kB</td>
            <td>—</td>
          </tr>
        </tbody>
      </table>
      <p>
        All eight together cost less than their sum, because each is measured against the same core they
        attach to. The two shipped-file paths are what a bundler that cannot tree-shake pays for the
        whole entry surface: <strong>52.61 kB</strong> for <code>index.js</code> and{' '}
        <strong>27.10 kB</strong> for <code>headless.js</code>, each plus <code>styles.css</code>;{' '}
        <code>edit.js</code> is its own 5.39 kB, and it is the only shipped file that imports the writer.
        For scale, <code>pdfjs-dist</code> gzips to 128.6 kB on the main thread and 366.5 kB in its
        worker, and <code>@cantoo/pdf-lib</code> to 245.5 kB.
      </p>
      <p>
        Measured on 0.8.0. CI runs <code>npm run size</code>, which compares every path against the
        numbers committed in <code>size-baseline.json</code> and fails on growth beyond 2&nbsp;%
        (+256&nbsp;B of slack for minifier jitter), and fails on its own if any single feature costs
        more than 4&nbsp;kB over core. It is a ratchet rather than a ceiling: a library that grows
        with features cannot honestly promise a fixed size, so what the gate protects is the process —
        accepting growth means running <code>npm run size:update</code>, which puts the new number in
        the same diff as the code that caused it.
      </p>

      <h2>Accessibility</h2>
      <p>
        The shell is built to be usable by keyboard and screen reader out of the box: the page
        region is focusable so the search shortcut — and print's, when that feature is mounted — are
        reachable, controls carry{' '}
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
