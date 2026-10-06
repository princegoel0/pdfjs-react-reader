import figures from '../size-figures.json';

/** The one place a size number is spelled out for this page: the gate writes the file, this renders it. */
const kb = (value: number) => `${value.toFixed(2)} kB`;
/** A peer figure means nothing without the version it was measured on, and the gate records both. */
const peer = (key: 'engineMain' | 'engineWorker' | 'writer') => {
  const entry = figures.peers[key];
  return entry ? `${entry.kB.toFixed(1)} kB on ${entry.version}` : 'not installed where this was built';
};

export function Compatibility() {
  return (
    <>
      <h1>Versions &amp; compatibility</h1>
      <p className="doc-lede">
        Everything the package needs at runtime, the versions it was actually tested against, and where a claim is a
        target rather than a measurement.
      </p>

      <h2>Runtime dependencies</h2>
      <p>
        Three required peer dependencies, one optional, and nothing else. There is no bundled state library, no date
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
            <td>6.3.289, in CI</td>
            <td>The engine. Rendering, text, annotations, editing and printing all go straight to it.</td>
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
              A PDF writer, and the reason the <code>edit</code> and <code>merge</code> tiers can rewrite a page tree or
              copy pages between documents at all. Declared optional so a host that never mounts either neither installs
              it nor pays its {peer('writer')}, and named by exactly two shipped modules — <code>pdf-write.ts</code> and{' '}
              <code>pdf-merge.ts</code> — so nothing else can drag it in. Not installed, importing{' '}
              <code>pdfjs-react-reader/edit</code> or <code>/merge</code> fails at build rather than at runtime, which
              is the loud way round.
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
        Not <code>^6.0.0</code>. <strong>CVE-2026-16633</strong> (<code>GHSA-hq66-cqwq-w95j</code>, high) is arbitrary
        JavaScript execution when a malicious PDF is opened, and it covers <code>&gt;= 5.6.83, &lt; 6.2.108</code>. That
        range includes every 6.0.x and 6.1.x release, so a permissive 6 floor would advertise vulnerable engines as
        supported.
      </p>
      <p>
        No 5.x release fixes it either. The earlier <code>^5.0.0</code> range therefore did more than allow a vulnerable
        version — it <em>excluded</em> every patched one, so an app following our own docs could not install a fixed{' '}
        <code>pdfjs-dist</code> without a peer-resolution error. v5 stayed supported while that was the only thing at
        stake: dropping it would have broken installs for no security gain, since a v5 user could not reach a fixed 5.x
        anyway.
      </p>
      <p>
        Annotation editing changed the balance, and the deciding evidence is mechanical rather than editorial.{' '}
        <code>AnnotationEditorUIManager</code> takes its arguments <strong>positionally</strong>, and 5.0.375 accepts
        fourteen while 5.7.284 and every 6.x accept sixteen with
        <code>viewerAlert</code> and <code>commentManager</code> inserted near the front — so the same construction
        hands <code>viewerAlert</code> to a v5 <code>altTextManager</code> slot and misconfigures the layer in silence.
        5.7+ matches 6.x signature-for-signature, but 5.7 is the unpatchable CVE line, so keeping it would mean
        promising to support a configuration we tell you to leave. The range is <code>^6.2.108</code>, one floor for
        both reasons. This is a breaking peer change, announced here as the versioning policy requires even at{' '}
        <code>0.x</code>.
      </p>
      <p>
        Note this is the engine's vulnerability, not ours, and we cannot patch it from here. Our own default already
        declines the trigger the advisory names: the annotation layer is rendered with{' '}
        <code>enableScripting: false</code> and the scripting sandbox is never loaded.
      </p>

      <h2>Why v4 of pdfjs-dist is not supported</h2>
      <p>
        An earlier range advertised <code>^4.2.67 || ^5.0.0</code>. It was tested and does not hold:
      </p>
      <ul>
        <li>
          <strong>4.2.67</strong> does not export <code>TextLayer</code> from the package root, and has no{' '}
          <code>canvas</code> render parameter — four type errors.
        </li>
        <li>
          <strong>4.10.38</strong> (the last v4) exports <code>TextLayer</code> but still has no <code>canvas</code>{' '}
          parameter. Its <code>render()</code> derives the target from <code>canvasContext.canvas</code>, so passing{' '}
          <code>canvas</code> would not throw — it would paint nothing and show blank pages.
        </li>
        <li>
          Printing relies on <code>printAnnotationStorage</code>, which is only honoured for{' '}
          <code>intent: 'print'</code> in v5.
        </li>
      </ul>
      <p>
        Restoring v4 support means an engine-detection shim at three call sites plus a second verification pass over
        forms and printing. Say so if you need it.
      </p>

      <h2>What XFA can and cannot do</h2>
      <p>
        A document whose pages are composed from an XFA template renders — <code>XfaLayer</code> builds it, at the box
        the template asks for rather than the MediaBox, and search marks its text the way it marks a text layer. Saving
        one back is not offered: the viewer hands <code>getData()</code> bytes to download and the edit tier refuses to
        write. That refusal is measured, and the measurement has a boundary worth stating precisely, because the two
        halves of the sentence are not equally supported.
      </p>
      <ul>
        <li>
          <strong>Measured: the save cannot be trusted.</strong> Against every <code>/XFA</code> container this project
          can generate — a single stream, an array split across three pairs, an array holding the whole packet, and a
          hybrid that also carries <code>/Fields</code> — <code>saveDocument()</code> either rejects with an opaque
          worker error, or returns bytes that drop the change, or returns bytes that will not reopen. Those are four
          fixtures and two outcomes; none of them is a file you can hand back to a reader.
        </li>
        <li>
          <strong>Not measured: whether a real form&apos;s edits could survive.</strong> <code>XfaLayer</code> binds a
          field to <code>annotationStorage</code> only when the layout node carries a <code>dataId</code>, and the
          packets these fixtures emit give their inputs a <code>fieldid</code> and no <code>dataId</code>. So typing
          into a field of a fixture reaches the DOM and nowhere else, and there is no edited document to save. A
          LiveCycle form from a real producer may bind, and may then save — this package does not know, and would rather
          say so than print a confident limit it did not observe.
        </li>
        <li>
          <strong>Measured: the thumbnail composes the form.</strong> A pure-XFA page paints zero operators, and a
          thumbnail is a painted canvas, so the sidebar showed an empty 132×185 buffer where the page should be — the
          same absence the page itself had before <code>0.8</code>. The card now lays the same <code>XfaLayer</code>{' '}
          tree over its canvas, at the card&apos;s own CSS scale rather than the density that sizes the bitmap, with the
          document&apos;s own <code>annotationStorage</code> at display intent, and it is marked <code>inert</code>:
          that tree is live DOM inside a <code>&lt;button&gt;</code>, so without it a nine-page form offers a keyboard
          reader nine copies of fields they cannot see. Both halves are asserted —{' '}
          <code>PdfThumbnail.xfa.test.tsx</code> for what the card asks the engine for, and the matrix&apos;s{' '}
          <code>sidebar-thumbs-outline</code> row for the tree a real engine laid out, its measured box and its tab
          order. Whether a value the reader typed reaches the card is the question the bullet above says this project
          cannot answer.
        </li>
      </ul>
      <p>
        A document that declares XFA <em>and</em> AcroForm fields is the interesting middle case, and pdf.js settles it
        the same way every time: the AcroForm wins, the packet is inert, and the save path is the ordinary one.{' '}
        <code>onCapabilities</code> tells you which document you have before a reader types into it.
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
              Both, from one build (FR-41): every published path ships <code>.js</code> and <code>.cjs</code> with a{' '}
              <code>.d.ts</code> and a <code>.d.cts</code> beside them, and the export map answers <code>import</code>{' '}
              and <code>require</code> separately. So a <code>require()</code>-only toolchain — Jest without ESM
              enabled, an older Node build script — resolves the package instead of failing to. The one limit is
              Node&apos;s rather than ours: <code>pdfjs-dist</code> is an ESM-only peer with no <code>exports</code>{' '}
              map, so a <code>require()</code> that reaches it needs a Node that can load ESM from CommonJS. That
              stopped being a question at <code>22.12.0</code>, which is why the floor below excludes everything older:
              inside the advertised range, <code>require()</code> works, and <code>npm run check:tarball</code> proves
              it by installing the published tarball into a CommonJS project and resolving every path both ways —
              <code>ERR_REQUIRE_ESM</code> fails that check rather than being excused.
            </td>
          </tr>
          <tr>
            <td>Bundler</td>
            <td>
              Anything that handles <code>exports</code> maps and <code>import.meta.url</code>: Vite 5+, webpack 5+,
              Rollup 4+, esbuild, Turbopack. <code>import.meta.url</code> is only used for worker resolution, and its
              failure is caught — nothing is pinned, and the load then fails naming <code>workerSrc</code> rather than
              hanging on a URL that could not be built.
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
            <td>Node (build toolchain and host-side import)</td>
            <td>
              <code>&gt;=22.13.0</code>. The library is browser code, so this is not a claim about where it renders: it
              is where <code>require()</code> of an ESM-only peer works without a flag and where the engine itself says
              it runs. Node 20 and 22.0–22.12 are outside the promise, and <code>npm run check:packaging</code> fails if{' '}
              <code>package.json</code>, this document&apos;s floor and the CI matrices ever state three different
              numbers.
            </td>
          </tr>
          <tr>
            <td>CSS</td>
            <td>
              Import <code>pdfjs-react-reader/styles.css</code>, plus <code>print.css</code> / <code>forms.css</code> /{' '}
              <code>outline.css</code> / <code>layers.css</code> / <code>attachments.css</code> /{' '}
              <code>structure.css</code> / <code>annotate.css</code> for the features you mounted, or supply your own
              rules for the <code>.pjsr-*</code> classes. The text layer in particular needs its positioning CSS or
              selectable text will overlay the page incorrectly.
            </td>
          </tr>
          <tr>
            <td>Content security policy</td>
            <td>
              The worker loads as a module script from your origin (or wherever you point <code>workerSrc</code>).
              Downloads use <code>blob:</code> URLs. A strict <code>worker-src</code> or <code>img-src</code> needs
              those entries.
            </td>
          </tr>
        </tbody>
      </table>

      <h2>Browsers</h2>
      <p>
        The floors are <code>PRD.md</code> §8&apos;s: Chrome and Edge 125, Safari and iOS Safari 18, Firefox 124
        (provisional). Be aware of what that does and does not mean:
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
            <td>
              Verified. <code>npm run test:browsers</code> drives the checks <code>npm run check:docs</code> counts — a
              painted canvas measured as ink over the whole page, backing-store density against{' '}
              <code>devicePixelRatio</code>, text you can select, search that marks and advances, thumbnails and
              outline, virtualization of a 1,000-page document, the toolbar fold at 375&nbsp;px, keyboard paging
              including the <code>ArrowRight</code> exemption, wheel zoom against plain scroll, pinch against two-finger
              pan, forced colours, and uncaught errors — through Chromium 153 at 1280×900 and 375×812 dpr 2, and the
              row&rsquo;s ok/skip tallies are recorded run by run in <code>fr-evidence.json</code> under{' '}
              <code>FR-48</code> rather than retyped here. Chromium&rsquo;s mobile profile skips the wheel check,
              because that emulation delivers no wheel events to the page at all — a finding about the profile, not the
              viewer. Every responsive, printing and form check in the log was run here too. The engine is Chromium 153
              against §8&apos;s floor of 125, so this is the current build passing, not the floor pinned.
            </td>
          </tr>
          <tr>
            <td>WebKit / Safari 18</td>
            <td>
              Runs on the runner, and passes but not yet reliably: forced colours and the 1,000-page walk are green
              there, while the print row has alternated on one line of its own harness (#248). WebKit 26 takes the same
              checks through <code>npm run test:browsers</code> at both profiles, and what it skips belongs to the
              emulation rather than the viewer: the mobile profile dispatches no wheel events and exposes no{' '}
              <code>Touch</code> constructor to synthesise a pinch from. Each run&rsquo;s reading is recorded with its
              run id in <code>fr-evidence.json</code> under <code>FR-48</code>. That is not the floor §8 claims either.
              Its Safari row asks for a reproducible Safari 18 / WebKit runner, and its own policy is that a current
              browser passing the suite does not certify an older floor — and a Linux WebKit is not macOS Safari. The{' '}
              <code>@media</code> fallbacks beside every <code>@container</code> rule and the{' '}
              <code>overflow: clip</code> → <code>hidden</code> fallback were written for a Safari 14 target that the
              2026-10-02 lock replaced: at a floor of 18, container queries and <code>overflow: clip</code>
              are both available, so those branches are margin rather than requirement, and nothing in this matrix or in
              any test exercises them either way.
            </td>
          </tr>
          <tr>
            <td>Gecko / Firefox 124</td>
            <td>
              Runs on the runner, and passes: Firefox 155 takes the same checks at both profiles, with the same two
              mobile skips and the same reasons, and each run&rsquo;s reading is recorded with its run id in{' '}
              <code>fr-evidence.json</code> under <code>FR-48</code>. §8&apos;s floor is 124, which no runner here
              produces — Playwright installs its current build — so by that table&apos;s execution policy the floor is
              still unverified even though the engine has finally started. A screen-reader pass with NVDA (FR-45) is
              Firefox evidence of a different kind and has not happened.
            </td>
          </tr>
          <tr>
            <td>Edge 125</td>
            <td>
              Nothing. Edge is inside the contract above and §8 keeps its own row for it, unverified: no check has ever
              run in Edge, on any machine, here or on CI. Its engine is Chromium&apos;s, which is the reason the
              Chromium results suggest it works and not the reason to say so.
            </td>
          </tr>
        </tbody>
      </table>
      <div className="doc-callout">
        If you are evaluating this for a Safari-critical product, the WebKit row is the closest thing to evidence you
        will find here, and it is still not a device pass. The layout code avoids <code>:has()</code> and{' '}
        <code>dvh</code> without a fallback — a leftover from the 90/14 target rather than something the 125/18 floors
        ask for, since both features are older than Safari 18, and no test would notice if either were used, and the{' '}
        <code>npm run test:browsers</code> job — locally, and on CI&apos;s Linux runner on every push to{' '}
        <code>dev</code> since 2026-10-04, where its reading per run is in <code>fr-evidence.json</code> — drives all
        three engines and classifies a browser that cannot start as <code>unverified</code> rather than passed. What
        remains outside it is what a Linux runner cannot produce: a pinned old-version floor, macOS Safari, Edge, and
        iOS or Android hardware.
      </div>

      <h2>Bundle size</h2>
      <p>
        Gzipped, excluding <code>pdfjs-dist</code>, React and the optional <code>@cantoo/pdf-lib</code>. Each row is a
        real consumer file bundled once with esbuild and once with Rollup, and the larger number is reported, so a path
        only counts as small if two independent tree-shakers agree. <strong>Nothing on this table is typed in</strong>:{' '}
        <code>npm run size</code> writes every figure to <code>docs/src/size-figures.json</code> and this page renders
        that file, so the numbers are the ones measured on <code>{figures.measuredOn}</code> rather than the ones
        somebody remembered at a release close. CI reports any path that grew past the numbers committed in{' '}
        <code>size-baseline.json</code>, and stops the build at
        <strong> twice</strong> an accepted number — or twice the 6&nbsp;kB a tier is expected to fit — so the growth is
        measured rather than estimated, and a feature is never refused for being a feature.
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
              Core (<code>PdfViewer</code> with no features)
            </td>
            <td>{kb(figures.kB['core'])}</td>
            <td>—</td>
          </tr>
          <tr>
            <td>Core + print</td>
            <td>{kb(figures.kB['core+print'])}</td>
            <td>+{kb(figures.overCore.print)}</td>
          </tr>
          <tr>
            <td>Core + download</td>
            <td>{kb(figures.kB['core+download'])}</td>
            <td>+{kb(figures.overCore.download)}</td>
          </tr>
          <tr>
            <td>Core + forms</td>
            <td>{kb(figures.kB['core+forms'])}</td>
            <td>+{kb(figures.overCore.forms)}</td>
          </tr>
          <tr>
            <td>Core + outline</td>
            <td>{kb(figures.kB['core+outline'])}</td>
            <td>+{kb(figures.overCore.outline)}</td>
          </tr>
          <tr>
            <td>Core + layers</td>
            <td>{kb(figures.kB['core+layers'])}</td>
            <td>+{kb(figures.overCore.layers)}</td>
          </tr>
          <tr>
            <td>Core + attachments</td>
            <td>{kb(figures.kB['core+attachments'])}</td>
            <td>+{kb(figures.overCore.attachments)}</td>
          </tr>
          <tr>
            <td>Core + annotate</td>
            <td>{kb(figures.kB['core+annotate'])}</td>
            <td>+{kb(figures.overCore.annotate)}</td>
          </tr>
          <tr>
            <td>Core + structure</td>
            <td>{kb(figures.kB['core+structure'])}</td>
            <td>+{kb(figures.overCore.structure)}</td>
          </tr>
          <tr>
            <td>Core + edit</td>
            <td>{kb(figures.kB['core+edit'])}</td>
            <td>+{kb(figures.overCore.edit)}</td>
          </tr>
          <tr>
            <td>All nine features</td>
            <td>{kb(figures.kB['all'])}</td>
            <td>+{kb(figures.overCore.all)}</td>
          </tr>
          <tr>
            <td>
              <code>/merge</code> alone (writer and hook, no shell)
            </td>
            <td>{kb(figures.kB['merge-only'])}</td>
            <td>separate entry</td>
          </tr>
          <tr>
            <td>Root entry, every export</td>
            <td>{kb(figures.kB['shell'])}</td>
            <td>—</td>
          </tr>
          <tr>
            <td>Headless entry, every export</td>
            <td>{kb(figures.kB['headless'])}</td>
            <td>—</td>
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
        The last three rows are measured differently from the feature rows above: they sum the shipped files reachable
        from an entry rather than bundling one import, so they are what a bundler that cannot tree-shake pays, and an
        upper bound for everyone else. Importing a single headless hook costs far less than any entry-wide figure —{' '}
        {kb(figures.kB['headless-only'])} for <code>usePdfDocument</code>, the path that carries the loading options —
        because the package is ESM and tree-shakeable.
      </p>
      <p>
        The gate is a ratchet, not a promise about how small the library stays. The budget was a fixed 45&nbsp;kB until{' '}
        <code>0.3</code>&apos;s production-robustness features pushed the shell to 45.45&nbsp;kB; raising the ceiling
        was the smaller fix, and a number every feature release has to renegotiate is not a requirement. What replaced
        it is the committed baseline plus a per-feature target — and since #208 both are things the build reports rather
        than argues with: it stops at twice the accepted number, which is the point where growth has stopped being a
        feature.
      </p>

      <h2>Versions</h2>
      <p>
        The package is <code>0.11.0</code>. While it is pre-1.0, minor versions may contain breaking changes, so pin
        exactly in an application. The full release entry, the development log and the versioning policy live in{' '}
        <code>CHANGELOG.md</code> at the repository root, which GitHub renders on the project home page.
      </p>

      <h2>Upgrading, release by release</h2>
      <p>
        Every change a host had to act on, in the order it happened. Nothing here is a judgement call the library made
        quietly: each line is something an application compiling against the previous version would have had to change.
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
              A <code>src</code> string that was not recognisably a URL, a data URI or base64 stopped being fetched and
              threw <code>TypeError</code> instead.
            </td>
            <td>
              Pass a URL, a <code>File</code>, bytes, or a <code>data:</code> URI. Anything else was a bug in the
              caller, and now says so at the call.
            </td>
          </tr>
          <tr>
            <td>0.3 → 0.4</td>
            <td>
              Six <code>PdfViewer</code> props — <code>enablePrint</code>, <code>printScale</code>,{' '}
              <code>enableDownload</code>, <code>downloadFileName</code>, <code>renderForms</code>,{' '}
              <code>onFormValuesChange</code> — became features you import, and a feature’s sheet became a second{' '}
              <code>…&lt;name&gt;.css</code> import.
            </td>
            <td>
              <code>{`features: [printFeature, downloadFeature]`}</code> and{' '}
              <code>import 'pdfjs-react-reader/print.css'</code>. The props were removed rather than deprecated: a prop
              that silently stopped working is the failure this release existed to remove.
            </td>
          </tr>
          <tr>
            <td>0.3 → 0.4</td>
            <td>
              <code>PdfPage</code>’s <code>renderForms</code> began defaulting to <code>false</code>, and{' '}
              <code>SidebarTab</code> widened from a closed union to <code>string</code>.
            </td>
            <td>
              Pass <code>renderForms</code> where a form should be fillable. The tab widening needs nothing of you and
              lets a feature name its own tab.
            </td>
          </tr>
          <tr>
            <td>0.4 → 0.5</td>
            <td>
              A multi-word search query became several terms that all have to appear, where it had been one exact
              phrase. <code>INK_WIDTHS</code> started carrying a label <em>key</em> rather than an English word.
            </td>
            <td>
              Quote a phrase if you want a phrase. The pen-width half no longer applies: FR-18 withdrew the core pen and{' '}
              <code>INK_WIDTHS</code> with it, and the widths on offer belong to <code>annotateFeature</code>.
            </td>
          </tr>
          <tr>
            <td>0.5 → 0.6</td>
            <td>
              The <code>pdfjs-dist</code> peer became <code>^6.2.108</code>; v5 was dropped. <code>usePdfDownload</code>
              ’s <code>withFormValues</code> was renamed <code>saveEdits</code>, and <code>usePdfFeaturePeer</code>{' '}
              began returning <code>Partial&lt;S&gt;</code>.
            </td>
            <td>
              Upgrade the peer — v5 lacks the editor API the annotate tier needs, and the annotation editor layer is the
              one place a version difference shows up as a crash rather than a missing feature. Rename the option. If
              you published a peer’s state from an effect, expect <code>undefined</code> on the first render and write
              the fallback you meant to.
            </td>
          </tr>
          <tr>
            <td>0.6 → 0.7</td>
            <td>
              Nothing a host had to change. A document with nothing to commit stopped being handed to{' '}
              <code>saveDocument()</code>, and a tool being armed stopped repainting pages that hold no editable
              annotation.
            </td>
            <td>Nothing. Both were the library taking back work it should not have done.</td>
          </tr>
          <tr>
            <td>0.7 → 0.8</td>
            <td>
              The text layer is re-laid out on a zoom step instead of rebuilt, an XFA page’s thumbnail now composes its
              form, and long mixed-size documents get a scroll bar that is right before every page has been measured.
              Three label catalogs and the <a href="#/api">API surface</a> page arrived.
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
              <code>signal</code> on every asynchronous operation it starts, the published <code>status</code> unions on
              the hook and on <code>PdfPage.onStatusChange</code>, <code>onProgress</code>, and the source helpers (
              <code>classifySource</code>, <code>base64ToBytes</code>) as exports. Two behaviours changed: a page box
              now answers a typed label as well as a number when the document declares <code>/PageLabels</code>, and
              canvas density follows the display a window is on rather than the one it started on.
            </td>
            <td>
              Nothing for existing code, with one exception worth deciding about: a load that fails transiently now
              retries — three attempts, full-jitter backoff, and never on a 401, 403 or 404. Pass{' '}
              <code>retry: false</code> for the single attempt back. Where you compared <code>doc</code> against{' '}
              <code>error</code> by hand, <code>status</code> is the same information as one value; and if you style the
              page box yourself, it becomes a text input on a labelled document, which is what the{' '}
              <code>data-labelled</code> attribute is for.
            </td>
          </tr>
          <tr>
            <td>0.x → 1.0</td>
            <td>
              The version where the surface stops moving. The plan is that 1.0 changes nothing except by accident — see{' '}
              <a href="#/api">the API surface</a> for what is being promised, and the release notes if it turns out
              otherwise.
            </td>
            <td>
              If you are on any 0.x, the work to reach 1.0 is the seven steps above. Pin the version, and treat a minor
              bump as a real upgrade from there on.
            </td>
          </tr>
        </tbody>
      </table>
    </>
  );
}
