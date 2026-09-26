export function Compatibility() {
  return (
    <>
      <h1>Versions &amp; compatibility</h1>
      <p className="doc-lede">
        Everything the package needs at runtime, the versions it was actually tested against, and
        where a claim is a target rather than a measurement.
      </p>

      <h2>Runtime dependencies</h2>
      <p>
        Three peer dependencies and nothing else. There is no bundled state library, no date
        library, no polyfill package, and no CSS framework.
      </p>
      <table className="doc-table">
        <thead>
          <tr>
            <th>Package</th>
            <th>Required</th>
            <th>Tested</th>
            <th>Why</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>
              <code>pdfjs-dist</code>
            </td>
            <td>
              <code>^6.2.108</code>
            </td>
            <td>6.3.289</td>
            <td>
              The engine. Rendering, text, annotations, editing and printing all go straight to it.
            </td>
          </tr>
          <tr>
            <td>
              <code>react</code>
            </td>
            <td>
              <code>^18.0.0 || ^19.0.0</code>
            </td>
            <td>18.3.1, 19.3.0</td>
            <td>
              Hooks and JSX runtime. Needs <code>useId</code>, so 18.0 is the floor.
            </td>
          </tr>
          <tr>
            <td>
              <code>react-dom</code>
            </td>
            <td>
              <code>^18.0.0 || ^19.0.0</code>
            </td>
            <td>18.3.1, 19.3.0</td>
            <td>DOM rendering for the shell and the annotation layer.</td>
          </tr>
        </tbody>
      </table>
      <pre>
        <code>{`npm install pdfjs-react-reader pdfjs-dist
# react and react-dom must already be in the app`}</code>
      </pre>

      <h2>Why the floor is 6.2.108, and why v5 went away in 0.6</h2>
      <p>
        Not <code>^6.0.0</code>. <strong>CVE-2026-16633</strong> (<code>GHSA-hq66-cqwq-w95j</code>,
        high) is arbitrary JavaScript execution when a malicious PDF is opened, and it covers{' '}
        <code>&gt;= 5.6.83, &lt; 6.2.108</code>. That range includes every 6.0.x and 6.1.x release, so
        a permissive 6 floor would advertise vulnerable engines as supported.
      </p>
      <p>
        No 5.x release fixes it either. The earlier <code>^5.0.0</code> range therefore did more than
        allow a vulnerable version — it <em>excluded</em> every patched one, so an app following our
        own docs could not install a fixed <code>pdfjs-dist</code> without a peer-resolution error. v5
        stayed supported while that was the only thing at stake: dropping it would have broken installs
        for no security gain, since a v5 user could not reach a fixed 5.x anyway.
      </p>
      <p>
        Annotation editing changed the balance, and the deciding evidence is mechanical rather than
        editorial. <code>AnnotationEditorUIManager</code> takes its arguments <strong>positionally</strong>,
        and 5.0.375 accepts fourteen while 5.7.284 and every 6.x accept sixteen with
        <code>viewerAlert</code> and <code>commentManager</code> inserted near the front — so the same
        construction hands <code>viewerAlert</code> to a v5 <code>altTextManager</code> slot and
        misconfigures the layer in silence. 5.7+ matches 6.x signature-for-signature, but 5.7 is the
        unpatchable CVE line, so keeping it would mean promising to support a configuration we tell you
        to leave. The range is <code>^6.2.108</code>, one floor for both reasons. This is a breaking peer
        change, announced here as the versioning policy requires even at <code>0.x</code>.
      </p>
      <p>
        Note this is the engine's vulnerability, not ours, and we cannot patch it from here. Our own
        default already declines the trigger the advisory names: the annotation layer is rendered with{' '}
        <code>enableScripting: false</code> and the scripting sandbox is never loaded.
      </p>

      <h2>Why v4 of pdfjs-dist is not supported</h2>
      <p>
        An earlier range advertised <code>^4.2.67 || ^5.0.0</code>. It was tested and does not hold:
      </p>
      <ul>
        <li>
          <strong>4.2.67</strong> does not export <code>TextLayer</code> from the package root, and
          has no <code>canvas</code> render parameter — four type errors.
        </li>
        <li>
          <strong>4.10.38</strong> (the last v4) exports <code>TextLayer</code> but still has no{' '}
          <code>canvas</code> parameter. Its <code>render()</code> derives the target from{' '}
          <code>canvasContext.canvas</code>, so passing <code>canvas</code> would not throw — it
          would paint nothing and show blank pages.
        </li>
        <li>
          Printing relies on <code>printAnnotationStorage</code>, which is only honoured for{' '}
          <code>intent: 'print'</code> in v5.
        </li>
      </ul>
      <p>
        Restoring v4 support means an engine-detection shim at three call sites plus a second
        verification pass over forms and printing. Say so if you need it.
      </p>

      <h2>Toolchain</h2>
      <table className="doc-table">
        <thead>
          <tr>
            <th>Requirement</th>
            <th>Detail</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>Module format</td>
            <td>
              ESM only (<code>"type": "module"</code>). There is no CommonJS build, so a
              <code>require()</code>-only bundler will not resolve it.
            </td>
          </tr>
          <tr>
            <td>Bundler</td>
            <td>
              Anything that handles <code>exports</code> maps and <code>import.meta.url</code>:
              Vite 5+, webpack 5+, Rollup 4+, esbuild, Turbopack. <code>import.meta.url</code> is
              only used for worker resolution, and its failure is caught — the pdf.js fake worker
              takes over.
            </td>
          </tr>
          <tr>
            <td>TypeScript</td>
            <td>
              5.6+ recommended. Declarations ship with the package; <code>strict</code> and{' '}
              <code>noUncheckedIndexedAccess</code> are what this repo builds under.
            </td>
          </tr>
          <tr>
            <td>Node (developing only)</td>
            <td>
              <code>&gt;=20</code>. Not a runtime requirement — the library is browser code.
            </td>
          </tr>
          <tr>
            <td>CSS</td>
            <td>
              Import <code>pdfjs-react-reader/styles.css</code>, plus{' '}
              <code>print.css</code> / <code>forms.css</code> / <code>outline.css</code> /{' '}
              <code>layers.css</code> / <code>attachments.css</code> /{' '}
              <code>annotate.css</code> for the
              features you mounted, or supply your own rules for the <code>.pjsr-*</code> classes. The
              text layer in particular needs its positioning CSS or selectable text will overlay the
              page incorrectly.
            </td>
          </tr>
          <tr>
            <td>Content security policy</td>
            <td>
              The worker loads as a module script from your origin (or wherever you point{' '}
              <code>workerSrc</code>). Downloads use <code>blob:</code> URLs. A strict{' '}
              <code>worker-src</code> or <code>img-src</code> needs those entries.
            </td>
          </tr>
        </tbody>
      </table>

      <h2>Browsers</h2>
      <p>
        The support targets are Chrome ≥ 90, Safari ≥ 14, Firefox ≥ 90 and Edge ≥ 90. Be aware of
        what that does and does not mean:
      </p>
      <table className="doc-table">
        <thead>
          <tr>
            <th>Engine</th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>Chromium (desktop and the mobile-shell emulation paths)</td>
            <td>Verified — every responsive, printing and form check in the log was run here.</td>
          </tr>
          <tr>
            <td>WebKit / Safari 14+</td>
            <td>
              Targeted, not verified. The CSS ships <code>@media</code> fallbacks alongside every{' '}
              <code>@container</code> rule precisely because Safari 14 has no container queries, and{' '}
              <code>overflow: clip</code> has a <code>hidden</code> fallback for the same reason.
            </td>
          </tr>
          <tr>
            <td>Gecko / Firefox 90+</td>
            <td>Targeted, not verified.</td>
          </tr>
        </tbody>
      </table>
      <div className="doc-callout">
        If you are evaluating this for a Safari-critical product, treat the WebKit row as the thing
        to test first. The layout code avoids <code>:has()</code> and <code>dvh</code> without a
        fallback for exactly that reason, but no measurement has been taken there.
      </div>

      <h2>Bundle size</h2>
      <p>
        Gzipped, excluding <code>pdfjs-dist</code> and React, measured on the 0.6 build. Each row is a real
        consumer file bundled once with esbuild and once with Rollup, and the larger number is
        reported, so a path only counts as small if two independent tree-shakers agree. CI fails the
        build when a path grows more than 2&nbsp;% above the numbers committed in{' '}
        <code>size-baseline.json</code>, and fails on its own when any single feature costs more than
        4&nbsp;kB over core, so these are enforced rather than estimated.
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
            <td>Core (<code>PdfViewer</code> with no features)</td>
            <td>23.66 kB</td>
            <td>—</td>
          </tr>
          <tr>
            <td>Core + print</td>
            <td>26.19 kB</td>
            <td>+2.53 kB</td>
          </tr>
          <tr>
            <td>Core + download</td>
            <td>24.43 kB</td>
            <td>+0.77 kB</td>
          </tr>
          <tr>
            <td>Core + forms</td>
            <td>25.62 kB</td>
            <td>+1.96 kB</td>
          </tr>
          <tr>
            <td>Core + outline</td>
            <td>24.60 kB</td>
            <td>+0.95 kB</td>
          </tr>
          <tr>
            <td>Core + layers</td>
            <td>24.85 kB</td>
            <td>+1.19 kB</td>
          </tr>
          <tr>
            <td>Core + attachments</td>
            <td>24.74 kB</td>
            <td>+1.08 kB</td>
          </tr>
          <tr>
            <td>Core + annotate</td>
            <td>25.51 kB</td>
            <td>+1.85 kB</td>
          </tr>
          <tr>
            <td>All seven features</td>
            <td>32.75 kB</td>
            <td>+9.09 kB</td>
          </tr>
          <tr>
            <td>Root entry, every export</td>
            <td>50.87 kB</td>
            <td>—</td>
          </tr>
          <tr>
            <td>Headless entry, every export</td>
            <td>26.78 kB</td>
            <td>—</td>
          </tr>
          <tr>
            <td>One headless hook (<code>usePdfDocument</code>)</td>
            <td>2.59 kB</td>
            <td>—</td>
          </tr>
        </tbody>
      </table>
      <p>
        The last three rows are measured differently from the feature rows above: they sum the shipped files
        reachable from an entry rather than bundling one import, so they are what a bundler that
        cannot tree-shake pays, and an upper bound for everyone else. Importing a single headless hook
        costs far less than any entry-wide figure — 2.59&nbsp;kB for <code>usePdfDocument</code> —
        because the package is ESM and tree-shakeable.
      </p>
      <p>
        The gate is a ratchet, not a promise about how small the library stays. The budget was a fixed
        45&nbsp;kB until <code>0.3</code>&apos;s production-robustness features pushed the shell to
        45.45&nbsp;kB; raising the ceiling was the smaller fix, and a number every feature release has
        to renegotiate is not a requirement. What replaced it is the committed baseline plus the
        per-feature cap, which is the part that can stay fixed.
      </p>

      <h2>Versions</h2>
      <p>
        The package is <code>0.6.0</code>. While it is pre-1.0, minor versions may contain breaking
        changes, so pin exactly in an application. <code>0.4</code> is one such minor: six{' '}
        <code>PdfViewer</code> props became four feature imports, listed at{' '}
        <a href="#/features">Features &amp; tiers</a>. The full release entry, the development log and
        the versioning policy live in <code>CHANGELOG.md</code> at the repository root, which GitHub
        renders on the project home page.
      </p>
    </>
  );
}
