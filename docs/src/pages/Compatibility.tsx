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
        Three required peer dependencies, one optional, and nothing else. There is no bundled state
        library, no date library, no polyfill package, and no CSS framework.
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
            <td>6.3.289, in CI</td>
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
            <td>19.3.0, in CI; 18.3.1 verified at 0.1, not re-run</td>
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
            <td>19.3.0, in CI; 18.3.1 verified at 0.1, not re-run</td>
            <td>DOM rendering for the shell and the annotation layer.</td>
          </tr>
          <tr>
            <td>
              <code>@cantoo/pdf-lib</code>
            </td>
            <td>
              <code>^2.11.1</code>, <strong>optional</strong>
            </td>
            <td>2.11.1</td>
            <td>
              A PDF writer, and the reason the <code>edit</code> tier can rewrite a page tree at all.
              Declared optional so a host that never mounts it neither installs it nor pays its 251.4 kB,
              and named by exactly one shipped module — <code>pdf-write.ts</code> — so nothing else can
              drag it in. Not installed, importing <code>pdfjs-react-reader/edit</code> fails at build
              rather than at runtime, which is the loud way round.
            </td>
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

      <h2>What XFA can and cannot do</h2>
      <p>
        A document whose pages are composed from an XFA template renders — <code>XfaLayer</code> builds
        it, at the box the template asks for rather than the MediaBox, and search marks its text the way
        it marks a text layer. Saving one back is not offered: the viewer hands <code>getData()</code>{' '}
        bytes to download and the edit tier refuses to write. That refusal is measured, and the
        measurement has a boundary worth stating precisely, because the two halves of the sentence are
        not equally supported.
      </p>
      <ul>
        <li>
          <strong>Measured: the save cannot be trusted.</strong> Against every <code>/XFA</code> container
          this project can generate — a single stream, an array split across three pairs, an array holding
          the whole packet, and a hybrid that also carries <code>/Fields</code> —{' '}
          <code>saveDocument()</code> either rejects with an opaque worker error, or returns bytes that
          drop the change, or returns bytes that will not reopen. Those are four fixtures and two
          outcomes; none of them is a file you can hand back to a reader.
        </li>
        <li>
          <strong>Not measured: whether a real form&apos;s edits could survive.</strong>{' '}
          <code>XfaLayer</code> binds a field to <code>annotationStorage</code> only when the layout node
          carries a <code>dataId</code>, and the packets these fixtures emit give their inputs a{' '}
          <code>fieldid</code> and no <code>dataId</code>. So typing into a field of a fixture reaches the
          DOM and nowhere else, and there is no edited document to save. A LiveCycle form from a real
          producer may bind, and may then save — this package does not know, and would rather say so than
          print a confident limit it did not observe.
        </li>
        <li>
          <strong>Measured, and unfixable here: the thumbnail is blank.</strong> A pure-XFA page paints
          zero operators, and a thumbnail is a painted canvas, so the sidebar shows an empty 132×185
          buffer where the page should be. Composing the layer at print intent into that buffer is open
          work.
        </li>
      </ul>
      <p>
        A document that declares XFA <em>and</em> AcroForm fields is the interesting middle case, and
        pdf.js settles it the same way every time: the AcroForm wins, the packet is inert, and the save
        path is the ordinary one. <code>onCapabilities</code> tells you which document you have before a
        reader types into it.
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
              only used for worker resolution, and its failure is caught — nothing is pinned, and the
              load then fails naming <code>workerSrc</code> rather than hanging on a URL that could not
              be built.
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
              <code>structure.css</code> /{' '}
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
        Gzipped, excluding <code>pdfjs-dist</code>, React and the optional{' '}
        <code>@cantoo/pdf-lib</code>, measured on the <code>0.9</code> build. Each row is a real
        consumer file bundled once with esbuild and once with Rollup, and the larger number is
        reported, so a path only counts as small if two independent tree-shakers agree. CI fails the
        build when a path grows more than 2&nbsp;% above the numbers committed in{' '}
        <code>size-baseline.json</code>, and fails on its own when any single feature costs more than
        6&nbsp;kB over core, so these are enforced rather than estimated.
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
            <td>28.01 kB</td>
            <td>—</td>
          </tr>
          <tr>
            <td>Core + print</td>
            <td>30.47 kB</td>
            <td>+2.55 kB</td>
          </tr>
          <tr>
            <td>Core + download</td>
            <td>28.69 kB</td>
            <td>+0.78 kB</td>
          </tr>
          <tr>
            <td>Core + forms</td>
            <td>29.97 kB</td>
            <td>+2.06 kB</td>
          </tr>
          <tr>
            <td>Core + outline</td>
            <td>28.90 kB</td>
            <td>+0.96 kB</td>
          </tr>
          <tr>
            <td>Core + layers</td>
            <td>29.13 kB</td>
            <td>+1.21 kB</td>
          </tr>
          <tr>
            <td>Core + attachments</td>
            <td>29.00 kB</td>
            <td>+1.09 kB</td>
          </tr>
          <tr>
            <td>Core + annotate</td>
            <td>29.77 kB</td>
            <td>+1.85 kB</td>
          </tr>
          <tr>
            <td>Core + structure</td>
            <td>28.38 kB</td>
            <td>+0.37 kB</td>
          </tr>
          <tr>
            <td>Core + edit</td>
            <td>33.82 kB</td>
            <td>+5.89 kB</td>
          </tr>
          <tr>
            <td>All nine features</td>
            <td>43.05 kB</td>
            <td>+15.04 kB</td>
          </tr>
          <tr>
            <td>Root entry, every export</td>
            <td>59.14 kB</td>
            <td>—</td>
          </tr>
          <tr>
            <td>Headless entry, every export</td>
            <td>31.02 kB</td>
            <td>—</td>
          </tr>
          <tr>
            <td>One headless hook (<code>usePdfDocument</code>)</td>
            <td>4.06 kB</td>
            <td>—</td>
          </tr>
        </tbody>
      </table>
      <p>
        The last three rows are measured differently from the feature rows above: they sum the shipped files
        reachable from an entry rather than bundling one import, so they are what a bundler that
        cannot tree-shake pays, and an upper bound for everyone else. Importing a single headless hook
        costs far less than any entry-wide figure — 4.06&nbsp;kB for <code>usePdfDocument</code>, the path
        that carries the <code>0.9</code> loading options —
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
        The package is <code>0.10.0</code>. While it is pre-1.0, minor versions may contain breaking
        changes, so pin exactly in an application. The full release entry, the development log and the
        versioning policy live in <code>CHANGELOG.md</code> at the repository root, which GitHub renders
        on the project home page.
      </p>

      <h2>Upgrading, release by release</h2>
      <p>
        Every change a host had to act on, in the order it happened. Nothing here is a judgement call
        the library made quietly: each line is something an application compiling against the previous
        version would have had to change.
      </p>
      <table className="doc-table">
        <thead>
          <tr>
            <th>From → to</th>
            <th>What changed</th>
            <th>What to do</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>0.2 → 0.3</td>
            <td>
              A <code>src</code> string that was not recognisably a URL, a data URI or base64 stopped
              being fetched and threw <code>TypeError</code> instead.
            </td>
            <td>Pass a URL, a <code>File</code>, bytes, or a <code>data:</code> URI. Anything else was a bug in the caller, and now says so at the call.</td>
          </tr>
          <tr>
            <td>0.3 → 0.4</td>
            <td>
              Six <code>PdfViewer</code> props — <code>enablePrint</code>, <code>printScale</code>,{' '}
              <code>enableDownload</code>, <code>downloadFileName</code>, <code>renderForms</code>,{' '}
              <code>onFormValuesChange</code> — became features you import, and a feature’s sheet became a
              second <code>…&lt;name&gt;.css</code> import.
            </td>
            <td>
              <code>{`features: [printFeature, downloadFeature]`}</code> and{' '}
              <code>import 'pdfjs-react-reader/print.css'</code>. The props were removed rather than
              deprecated: a prop that silently stopped working is the failure this release existed to
              remove.
            </td>
          </tr>
          <tr>
            <td>0.3 → 0.4</td>
            <td>
              <code>PdfPage</code>’s <code>renderForms</code> began defaulting to <code>false</code>, and{' '}
              <code>SidebarTab</code> widened from a closed union to <code>string</code>.
            </td>
            <td>
              Pass <code>renderForms</code> where a form should be fillable. The tab widening needs
              nothing of you and lets a feature name its own tab.
            </td>
          </tr>
          <tr>
            <td>0.4 → 0.5</td>
            <td>
              A multi-word search query became several terms that all have to appear, where it had been
              one exact phrase. <code>INK_WIDTHS</code> started carrying a label <em>key</em> rather than
              an English word.
            </td>
            <td>
              Quote a phrase if you want a phrase. If you render the pen widths yourself, read{' '}
              <code>labels[option.labelKey]</code> — the array no longer holds text you can show, which
              is the point: it never held your language.
            </td>
          </tr>
          <tr>
            <td>0.5 → 0.6</td>
            <td>
              The <code>pdfjs-dist</code> peer became <code>^6.2.108</code>; v5 was dropped.{' '}
              <code>usePdfDownload</code>’s <code>withFormValues</code> was renamed{' '}
              <code>saveEdits</code>, and <code>usePdfFeaturePeer</code> began returning{' '}
              <code>Partial&lt;S&gt;</code>.
            </td>
            <td>
              Upgrade the peer — v5 lacks the editor API the annotate tier needs, and the annotation
              editor layer is the one place a version difference shows up as a crash rather than a
              missing feature. Rename the option. If you published a peer’s state from an effect, expect{' '}
              <code>undefined</code> on the first render and write the fallback you meant to.
            </td>
          </tr>
          <tr>
            <td>0.6 → 0.7</td>
            <td>
              Nothing a host had to change. A document with nothing to commit stopped being handed to{' '}
              <code>saveDocument()</code>, and a tool being armed stopped repainting pages that hold no
              editable annotation.
            </td>
            <td>Nothing. Both were the library taking back work it should not have done.</td>
          </tr>
          <tr>
            <td>0.7 → 0.8</td>
            <td>
              The text layer is re-laid out on a zoom step instead of rebuilt, an XFA page’s thumbnail
              now composes its form, and long mixed-size documents get a scroll bar that is right before
              every page has been measured. Three label catalogs and the{' '}
              <a href="#/api">API surface</a> page arrived.
            </td>
            <td>
              Nothing. One new import is worth knowing about: <code>{`labels={DE_LABELS}`}</code>.
            </td>
          </tr>
          <tr>
            <td>0.8 → 0.9</td>
            <td>
              The load grew its network options — <code>httpHeaders</code>, <code>withCredentials</code>,{' '}
              <code>rangeChunkSize</code>, <code>disableRange</code>, <code>disableStream</code> — plus{' '}
              <code>signal</code> on every asynchronous operation it starts, the published{' '}
              <code>status</code> unions on the hook and on <code>PdfPage.onStatusChange</code>,{' '}
              <code>onProgress</code>, and the source helpers (<code>classifySource</code>,{' '}
              <code>base64ToBytes</code>) as exports. Two behaviours changed: a page box now answers a
              typed label as well as a number when the document declares <code>/PageLabels</code>, and
              canvas density follows the display a window is on rather than the one it started on.
            </td>
            <td>
              Nothing for existing code, with one exception worth deciding about: a load that fails
              transiently now retries — three attempts, full-jitter backoff, and never on a 401, 403 or
              404. Pass <code>retry: false</code> for the single attempt back. Where you compared{' '}
              <code>doc</code> against <code>error</code> by hand, <code>status</code> is the same
              information as one value; and if you style the page box yourself, it becomes a text input on
              a labelled document, which is what the <code>data-labelled</code> attribute is for.
            </td>
          </tr>
          <tr>
            <td>0.x → 1.0</td>
            <td>
              The version where the surface stops moving. The plan is that 1.0 changes nothing except by
              accident — see <a href="#/api">the API surface</a> for what is being promised, and the
              release notes if it turns out otherwise.
            </td>
            <td>
              If you are on any 0.x, the work to reach 1.0 is the seven steps above. Pin the version, and
              treat a minor bump as a real upgrade from there on.
            </td>
          </tr>
        </tbody>
      </table>
    </>
  );
}
