import figures from '../size-figures.json';
import { ShellExample } from '../examples/ShellExample';

/** The one place a size number is spelled out for this page: the gate writes the file, this renders it. */
const kb = (value: number) => `${value.toFixed(2)} kB`;
/** A peer figure is only meaningful with the version it was measured on, and the gate knows both. */
const peer = (key: 'engineMain' | 'engineWorker' | 'writer') => {
  const entry = figures.peers[key];
  return entry ? `${kb(entry.kB)} (${entry.version})` : 'not installed where this was built';
};

/** Every row of the footprint table names the import a reader writes; see the note above the table. */
export function Introduction() {
  return (
    <>
      <h1>Introduction</h1>
      <p className="doc-lede">
        An MIT-licensed, headless-first PDF viewer for React, built directly on Mozilla's <code>pdfjs-dist</code>. It
        ships the plumbing that is tedious to get right — virtualized rendering, the canvas/text/annotation layer stack,
        worker lifecycle, search, forms, page editing, and printing — as hooks you can drive from your own UI, plus an
        optional drop-in component whose extra capabilities are imports, so the bundle holds only the ones you mounted.
      </p>

      <ShellExample />

      <h2>Why</h2>
      <p>
        Most React PDF viewers are either unmaintained wrappers around old <code>pdfjs-dist</code> releases, or they put
        search, form filling and annotations behind a commercial licence. This one talks to the engine directly and
        keeps every capability free under MIT.
      </p>

      <h2>What you get</h2>
      <ul>
        <li>
          <strong>Virtualized rendering.</strong> Only the rows crossing the viewport keep a live canvas; off-screen
          pages are unmounted and their pixel buffers cleared, which is what keeps long documents alive on mobile
          Safari.
        </li>
        <li>
          <strong>Real text layer.</strong> Selectable, searchable text rendered as an overlay, with search matches
          highlighted in place.
        </li>
        <li>
          <strong>Search, layout modes, and a sidebar.</strong> Continuous, single page and two-page spread; thumbnails
          are core, and the bookmarks tab is a feature you import.
        </li>
        <li>
          <strong>Forms, annotation editing, page editing, printing and download as features.</strong> Interactive
          AcroForm widgets (text, checkbox, radio, choice, button, and a signature widget that renders as its box) wired
          to pdf.js annotation storage; highlight, free text and ink marks that are real PDF annotations and go back
          into the file on save; a <strong>Pages</strong> tab that moves, turns, removes, extracts and splits whole
          pages, and a flatten that bakes the marks in so they survive a viewer with no editor; a print pipeline that
          renders every page at print intent; a save that can carry your edits. Each is an import, and each is measured
          in the Footprint table below.
        </li>
        <li>
          <strong>XFA forms render.</strong> A pure-XFA document is painted from its own template instead of showing a
          blank page, and search marks its text as it marks a text layer. Saving one back is not offered, and the reason
          is measured rather than assumed — <a href="#/compatibility">the limits page</a> says which half of that was
          tested and which could not be. Its sidebar thumbnail composes that template rather than showing a blank card,
          for the same underlying reason: a pure-XFA page paints no operators, so a miniature made of canvas alone has
          nothing in it.
        </li>
        <li>
          <strong>Encrypted documents.</strong> A built-in password prompt, or take over the UI entirely.
        </li>
        <li>
          <strong>The production edges.</strong> Canvas ceilings, so deep zoom paints instead of blanking; a
          document-source allowlist for URLs you did not author; pdf.js support assets from your own origin; an opt-in
          Trusted Types policy; and a capabilities report that says what the opened document actually is.
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
              Everything: the <code>PdfViewer</code> shell, its parts, the feature contract and every headless hook.
              Importing <code>PdfViewer</code> from here does not drag in the features you did not mount.
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
              The page-editing and flatten tier: <code>editFeature</code>, <code>createEditFeature</code>, the pure
              page-plan helpers, and <code>arrangePages</code> / <code>flattenBytes</code> on their own.
            </td>
          </tr>
          <tr>
            <td>
              <code>pdfjs-react-reader/merge</code>
            </td>
            <td>
              Two documents, one new file: <code>mergeDocuments</code>, <code>describeMergeSources</code> and the{' '}
              <code>usePdfMerge</code> picker state — and no component, because which files may be merged and what
              happens to the result is the host&apos;s business. With <code>edit</code>, this is where
              <code>@cantoo/pdf-lib</code> is reached — its <em>optional</em> peer. Install it to mount either, and
              neither the root entry nor <code>headless</code> asks for it.
            </td>
          </tr>
          <tr>
            <td>
              <code>
                pdfjs-react-reader/features/{'{print | download | forms | outline | layers | attachments | annotate}'}
              </code>
            </td>
            <td>
              One optional capability each: its <code>Runner</code>, toolbar control, keys and panel, passed to{' '}
              <code>PdfViewer</code> as <code>features</code>. <a href="#/features">Features &amp; tiers</a>.
            </td>
          </tr>
          <tr>
            <td>
              <code>pdfjs-react-reader/styles.css</code>
            </td>
            <td>The default theme for the core chrome. Import it, or theme through the tokens.</td>
          </tr>
          <tr>
            <td>
              <code>pdfjs-react-reader/{'{print | forms | outline | layers | attachments | annotate | edit}'}.css</code>
            </td>
            <td>
              The rules for those features&apos; markup, as separate files because a bundler drops CSS that no
              JavaScript imports.
            </td>
          </tr>
        </tbody>
      </table>

      <h2>Footprint</h2>
      <p>
        Measured gzipped, excluding <code>pdfjs-dist</code>, React and <code>@cantoo/pdf-lib</code> — all peer
        dependencies, the last of them optional and pulled in only by the <code>edit</code> tier. Each row is a real
        consumer file bundled once with esbuild and once with Rollup, and the larger of the two reported:
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
              <code>PdfViewer</code> alone — pages, text, search, thumbnails, chrome
            </td>
            <td>{kb(figures.kB['core'])}</td>
            <td>—</td>
          </tr>
          <tr>
            <td>
              <code>+ printFeature</code>
            </td>
            <td>{kb(figures.kB['core+print'])}</td>
            <td>+{kb(figures.overCore.print)}</td>
          </tr>
          <tr>
            <td>
              <code>+ downloadFeature</code>
            </td>
            <td>{kb(figures.kB['core+download'])}</td>
            <td>+{kb(figures.overCore.download)}</td>
          </tr>
          <tr>
            <td>
              <code>+ formsFeature</code>
            </td>
            <td>{kb(figures.kB['core+forms'])}</td>
            <td>+{kb(figures.overCore.forms)}</td>
          </tr>
          <tr>
            <td>
              <code>+ outlineFeature</code>
            </td>
            <td>{kb(figures.kB['core+outline'])}</td>
            <td>+{kb(figures.overCore.outline)}</td>
          </tr>
          <tr>
            <td>
              <code>+ layersFeature</code>
            </td>
            <td>{kb(figures.kB['core+layers'])}</td>
            <td>+{kb(figures.overCore.layers)}</td>
          </tr>
          <tr>
            <td>
              <code>+ attachmentsFeature</code>
            </td>
            <td>{kb(figures.kB['core+attachments'])}</td>
            <td>+{kb(figures.overCore.attachments)}</td>
          </tr>
          <tr>
            <td>
              <code>+ annotateFeature</code>
            </td>
            <td>{kb(figures.kB['core+annotate'])}</td>
            <td>+{kb(figures.overCore.annotate)}</td>
          </tr>
          <tr>
            <td>
              <code>+ structureFeature</code> — the document tree, as accessibility structure
            </td>
            <td>{kb(figures.kB['core+structure'])}</td>
            <td>+{kb(figures.overCore.structure)}</td>
          </tr>
          <tr>
            <td>
              <code>+ editFeature</code> — pages, flatten and signing
            </td>
            <td>{kb(figures.kB['core+edit'])}</td>
            <td>+{kb(figures.overCore.edit)}</td>
          </tr>
          <tr>
            <td>All nine</td>
            <td>{kb(figures.kB['all'])}</td>
            <td>+{kb(figures.overCore.all)}</td>
          </tr>
          <tr>
            <td>
              A merge on its own (<code>pdfjs-react-reader/merge</code>)
            </td>
            <td>{kb(figures.kB['merge-only'])}</td>
            <td>separate entry</td>
          </tr>
          <tr>
            <td>
              One headless hook (<code>usePdfDocument</code>)
            </td>
            <td>{kb(figures.kB['headless-only'])}</td>
            <td>—</td>
          </tr>
        </tbody>
      </table>
      <p>
        All nine together cost less than their sum, because each is measured against the same core they attach to. The
        two shipped-file paths are what a bundler that cannot tree-shake pays for the whole entry surface:{' '}
        <strong>{kb(figures.kB['shell'])}</strong> for <code>index.js</code> and{' '}
        <strong>{kb(figures.kB['headless'])}</strong> for <code>headless.js</code>, each plus <code>styles.css</code> —
        and <code>edit.js</code> and <code>merge.js</code> are the only two shipped files that import the writer. Read
        the <em>Over core</em> column rather than the base row when you are asking what a feature costs: adding an entry
        point reshuffles the shared chunks every path is built from, so <code>core</code> itself moves for reasons that
        are not about your bundle. For scale, <code>pdfjs-dist</code> gzips to {peer('engineMain')} on the main thread
        and {peer('engineWorker')} in its worker, and <code>@cantoo/pdf-lib</code> to {peer('writer')} — measured by the
        same command, at the same gzip level, on the versions this tree installs, so the ratio between our layer and the
        engine is the point rather than the digits.
      </p>
      <p>
        Measured on the build the gate bundles (`npm run size`, {figures.measuredOn}). CI runs it, and it compares every
        path against the numbers committed in <code>size-baseline.json</code> and <em>reports</em> growth beyond
        2&nbsp;% (+256&nbsp;B of slack for minifier jitter) as <code>GREW</code>; it fails a number only at
        <strong>200&nbsp;% of the accepted size</strong>, or when a single feature costs twice the
        <strong>6&nbsp;kB</strong> its tier is expected to fit. A budget that blocks feature work is a ceiling wearing
        another name, and a doubling is never a feature — it is a dependency arriving or the same code shipped twice.
        Bytes are a ratchet rather than a promise: a library that grows with features cannot honestly promise a fixed
        size, so what the gate protects is that a number never moves quietly — accepting growth means running{' '}
        <code>npm run size:update</code>, which puts the new number in the same diff as the code that caused it. That
        6&nbsp;kB was 4&nbsp;kB until signing, which measured 4.73&nbsp;kB for the writer pass and its geometry alone,
        before any interface: the number moved because the requirement that does not move is what a feature costs a
        reader&rsquo;s machine, not what it weighs.
      </p>

      <h2>Behaviour under load</h2>
      <p>
        Size negotiates; this does not. Every figure is measured against <code>long-sample.pdf</code> — a thousand
        pages, a nested page tree, three page sizes cycling so no single estimate flatters it — in Chromium on one
        Windows machine, which is the honest limit of the evidence.
      </p>
      <ul>
        <li>
          <strong>Scrolling a thousand pages drops no frames:</strong> p50 7.0&nbsp;ms, max 14.1&nbsp;ms, none over
          16.7&nbsp;ms at reader speed; a faster 1,100&nbsp;px/frame pass peaks at 14.0&nbsp;ms with the same result.
          Two to four page canvases are live at any moment, and a row that leaves the viewport has its buffer released.
        </li>
        <li>
          <strong>A cold page paints in 38–55&nbsp;ms</strong> wherever it is in the document, and a zoom step re-lays
          out the text layer instead of rebuilding it — 39.8&nbsp;ms per page per step became 1.0&nbsp;ms.
        </li>
        <li>
          <strong>An expensive question is asked when it is needed, not when it is mounted.</strong> Reading a document
          to find its signature fields costs 150–200&nbsp;ms of main thread on a thousand-page file that declares a
          form, and 0&nbsp;ms on one that does not: the panel asks the engine that cheap question on open, and parses
          the file only once there is a mark to place. The parse runs once per document and says what it is doing while
          it runs.
        </li>
        <li>
          <strong>Writes are deliberate, so a batch costs one pass.</strong> Ten page moves are ten edits to a list of
          integers and one writer pass at Apply — which is also why undo costs nothing until a file is actually written.
        </li>
      </ul>

      <h2>Accessibility</h2>
      <p>
        The shell is built to be usable by keyboard and screen reader out of the box: the page region is focusable so
        the search shortcut — and print's, when that feature is mounted — are reachable, controls carry{' '}
        <code>aria-label</code>, disclosures use <code>aria-expanded</code> and toggles <code>aria-pressed</code>, the
        match counter is an <code>aria-live</code> region, load failures are <code>role="alert"</code>, and every text
        token clears WCAG AA contrast. Touch targets reach 44&nbsp;px on coarse pointers while mouse-driven screens keep
        the dense layout. Shortcuts are scoped to the viewer instance, so a viewer never hijacks the host page's{' '}
        <code>Ctrl+F</code>. Under <code>forced-colors</code> the chrome takes the system palette, and nothing that
        means something means it by colour alone.
      </p>
      <p>
        Conformance is audited rather than inspected: axe-core runs the WCAG 2.0, 2.1 and 2.2 A and AA rules over the
        shell and every primitive in the test suite, and the run states what it cannot see — contrast and target size
        need a layout, and an assistive technology has to be the reader for the rest. Those belong to the browser
        matrix, not to this page.
      </p>

      <h2>Browser support</h2>
      <p>
        The contract floors are <code>PRD.md</code> §8&apos;s: Chrome and Edge 125, Safari and iOS Safari 18, Firefox
        124 (provisional), Node 22.13.0. What has actually been measured for each of them is the other column of that
        table, and the honest summary is on the <a href="#/compatibility">Compatibility</a> page: one engine
        current-build matrix, no pinned floor, no device.
      </p>
    </>
  );
}
