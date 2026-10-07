export function Installation() {
  return (
    <>
      <h1>Installation &amp; worker</h1>
      <p className="doc-lede">
        Two dependencies to line up — React, and a <code>pdfjs-dist</code> version you are
        comfortable with — and an optional third that only the page-editing tier asks for. The worker
        is resolved for you, with two escape hatches.
      </p>

      <h2>Install</h2>
      <pre>
        <code>{`npm install pdfjs-react-reader pdfjs-dist

# or
pnpm add pdfjs-react-reader pdfjs-dist
yarn add pdfjs-react-reader pdfjs-dist

# and only if you mount pdfjs-react-reader/edit or /merge:
npm install @cantoo/pdf-lib`}</code>
      </pre>
      <p>
        <code>pdfjs-dist</code> is a peer dependency on purpose: it stays your copy, at your
        version, and the package requires <code>^6.2.108</code> — see{' '}
        <a href="#/compatibility">Versions &amp; compatibility</a> for why v4 is excluded and why the
        6.x floor is 6.2.108. React 18 or 19 is required. The build is dual —{' '}
        <code>"type": "module"</code> with a <code>.cjs</code> and a <code>.d.cts</code> beside every{' '}
        <code>.js</code> — so a <code>require()</code> host and an <code>import</code> host both resolve,
        on Node <code>&gt;=22.13.0</code>. That floor is where both halves of the promise come from: every
        <code>pdfjs-dist</code> release in the advertised range declares <code>engines.node</code> starting
        at <code>22.13.0</code> itself, and loading an ESM-only peer from <code>require()</code> stopped
        needing a flag at <code>22.12.0</code>, one minor before the floor.
        it (see <a href="#/compatibility">Versions &amp; compatibility</a> for the one limit that belongs
        to Node rather than to this package).
      </p>
      <p>
        <code>@cantoo/pdf-lib</code> is an <em>optional</em> peer, and the only things that ask for it are
        the two writer tiers: <code>edit</code>, which reorders pages and flattens marks, and{' '}
        <code>merge</code>, which copies pages between documents into a third file. The core keeps its
        zero-dependency rule by not having one. Nothing is installed for you: without it, importing{' '}
        <code>pdfjs-react-reader/edit</code> or <code>pdfjs-react-reader/merge</code> fails at build, and
        importing anything else in the package — including the root entry and <code>/headless</code>, which
        do not re-export either — works, typechecks and runs.
      </p>

      <h2>Import the theme</h2>
      <pre>
        <code>{`import 'pdfjs-react-reader/styles.css';

// and, for the features you mounted:
import 'pdfjs-react-reader/print.css';
import 'pdfjs-react-reader/forms.css';
import 'pdfjs-react-reader/outline.css';
import 'pdfjs-react-reader/layers.css';
import 'pdfjs-react-reader/attachments.css';
import 'pdfjs-react-reader/annotate.css';
import 'pdfjs-react-reader/structure.css';
import 'pdfjs-react-reader/edit.css';`}</code>
      </pre>
      <p>
        <code>styles.css</code> once per app, near your other global CSS. Skip it if you are building
        your own UI from the headless hooks and bringing your own styles. The feature sheets are
        separate files on purpose: a bundler drops CSS that no JavaScript module imports, so a
        feature's rules cannot ride inside its own module, and one file per tier is what lets a
        download-only viewer ship no print rules at all. <code>download</code> needs no sheet — its
        control is an ordinary toolbar button, and <code>structure</code> needs one that is not about looks
        at all: its rule is what keeps an accessibility layer out of the page's layout, so mounting the
        feature and skipping the sheet is a defect rather than an unstyled viewer.
      </p>

      <h2>Optional capabilities</h2>
      <p>
        <code>{'<PdfViewer src="/a.pdf" />'}</code> is a viewer that reads: pages, selectable text,
        search, thumbnails, zoom and rotation. Print, save, fillable form widgets, the bookmarks
        tab, the layers panel, the attachments panel, marking the document up, moving or flattening
        whole pages, and reading a tagged document's structure tree are features you add,
        because they are imports and an import is the only thing
        that decides what your bundle contains:
      </p>
      <pre>
        <code>{`import { PdfViewer } from 'pdfjs-react-reader';
import { printFeature } from 'pdfjs-react-reader/features/print';
import { downloadFeature } from 'pdfjs-react-reader/features/download';
import { formsFeature } from 'pdfjs-react-reader/features/forms';
import { outlineFeature } from 'pdfjs-react-reader/features/outline';
import { layersFeature } from 'pdfjs-react-reader/features/layers';
import { attachmentsFeature } from 'pdfjs-react-reader/features/attachments';
import { annotateFeature } from 'pdfjs-react-reader/features/annotate';
import { structureFeature } from 'pdfjs-react-reader/features/structure';
import { editFeature } from 'pdfjs-react-reader/edit';

<PdfViewer
  src="/a.pdf"
  features={[printFeature, downloadFeature, formsFeature, outlineFeature, layersFeature, attachmentsFeature, annotateFeature, structureFeature, editFeature]}
/>`}</code>
      </pre>
      <p>
        See <a href="#/features">Features &amp; tiers</a> for what each one adds, what it costs, and
        how to write your own.
      </p>

      <h2>The worker</h2>
      <p>
        pdf.js does its parsing in a worker, and finding that worker file is the single most common
        integration problem. The package tries three things, in order:
      </p>
      <ol>
        <li>
          An explicit <code>workerSrc</code> you pass to <code>PdfViewer</code> or{' '}
          <code>usePdfDocument</code> always wins — use this for a CDN or a copied asset. It wins
          <em> globally</em>, though: pdf.js keeps this on <code>GlobalWorkerOptions</code>, so a second
          viewer that passes its own <code>workerSrc</code> changes what every <strong>later</strong>
          load on the page resolves to, while documents already open keep the worker they were given.
          Auto-detection probes once per page, however many documents load — <code>worker.test.ts</code>{' '}
          pins that. Hosts who need two workers on one page pass an explicit <code>workerSrc</code> to
          each, or let the first resolve and the rest inherit it.
        </li>
        <li>
          Otherwise it probes two specifiers for the worker and keeps the first URL that answers: a
          bundler-relative one,{' '}
          <code>new URL('../../pdfjs-dist/build/pdf.worker.min.mjs', import.meta.url)</code>, then a
          bare one. The relative form is tried first because a bare specifier is only rewritten at
          build time — under a Vite dev server it resolves next to this package and 404s. Nothing is
          needed in a normal Vite, webpack 5 or Rollup app.
        </li>
        <li>
          If nothing answers, <code>workerSrc</code> is left unset. That is not a fallback of its own —
          pdf.js&apos;s main-thread parser <em>is</em> the worker&apos;s code, so it has to be reachable
          without a URL: Node supplies its own default, and a browser can render on the main thread only if
          you have assigned <code>globalThis.pdfjsWorker = {'{ WorkerMessageHandler }'}</code> yourself.
          Otherwise the load fails telling you to pass <code>workerSrc</code>, instead of a fetch error for a
          URL you never wrote — which is the second reason nothing is guessed at.
          <code>worker.fallback.test.ts</code> and its three sibling files measure every one of these
          states.
        </li>
      </ol>
      <pre>
        <code>{`import { configureWorker, PdfViewer } from 'pdfjs-react-reader';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

// Only needed if you want to pin the location yourself.
configureWorker(workerUrl);

export function Report() {
  return <PdfViewer src="/reports/q3.pdf" workerSrc={workerUrl} />;
}`}</code>
      </pre>
      <div className="doc-callout">
        With Next.js, render the viewer in a client component (<code>&#39;use client&#39;</code>).
        Importing the package is safe on the server — every entry point is imported without a DOM in the
        test suite and none of them throws — but the worker resolution and the canvas are browser-only by
        nature, so it is the <em>render</em> that needs the boundary, not the import. One boundary is the
        peer&apos;s rather than ours: <code>pdfjs-dist</code> 6.2.108, the floor of the advertised range,
        throws <code>DOMMatrix is not defined</code> from its own module scope when Node imports its modern
        entry, and its <code>legacy</code> build imports cleanly. A server that must run on exactly that
        version aliases <code>pdfjs-dist/legacy/build/pdf.mjs</code>; from 6.3.289 up nothing needs aliasing.
      </div>
      <pre>
        <code>{`// app/report/[id]/page.tsx — a server component. No viewer here, but deciding what
// the source string *is* needs no DOM, and this is where it is cheapest to do it.
import { classifySource } from 'pdfjs-react-reader/headless';

export default async function ReportPage({ params }: { params: { id: string } }) {
  const record = await loadReport(params.id);
  const source = classifySource(record.fileRef); // never throws: url | bytes | refused
  if (source.kind === 'refused') throw new Error(source.message);
  return <ReportViewer src={record.fileRef} />;
}

// components/report-viewer.tsx — the boundary is one line, and it is about rendering.
'use client';
import { PdfViewer } from 'pdfjs-react-reader';

export function ReportViewer({ src }: { src: string }) {
  return <PdfViewer src={src} />;
}`}</code>
      </pre>

      <h2>Support assets</h2>
      <p>
        Apart from the worker, pdf.js fetches three more folders while parsing:{' '}
        <code>cmaps/</code> for CID-encoded CJK text, <code>standard_fonts/</code> for the 14
        built-in fonts, and <code>wasm/</code> for the JBIG2 and JPEG 2000 decoders. A missing one is
        never a load error — a Chinese document just paints blank glyphs where the text should be,
        and a JBIG2 image fails to decode with nothing pointing at the cause.
      </p>
      <p>
        By default they are read from <code>CDN_ASSET_ROOT</code>: an unpkg URL pinned to the{' '}
        <code>pdfjs-dist</code> version you have installed. To keep the documents on your own
        network, copy the three folders out of <code>node_modules/pdfjs-dist/</code> and point{' '}
        <code>assetUrl</code> at the directory that holds them:
      </p>
      <pre>
        <code>{`// 'cdn' (the default), or any directory you serve — a path or an absolute URL.
// Copy the three folders in beside it, keeping their names:
//   public/pdfjs-assets/cmaps/…
//   public/pdfjs-assets/standard_fonts/…
//   public/pdfjs-assets/wasm/…
<PdfViewer src="/a.pdf" assetUrl="/pdfjs-assets/" />`}</code>
      </pre>
      <p>
        The root gets a trailing <code>/</code> if you leave it off, and a relative one is resolved
        against the page rather than the worker — the cMaps are fetched inside the worker, whose base
        URL is a module file, not your site. What you cannot do is have the package find them in{' '}
        <code>node_modules</code> for you: pdf.js builds these paths by concatenating a directory with
        a filename at runtime, while a bundler only copies files named by literal specifiers and
        renames them with hashes. That is why <code>assetUrl</code> takes a directory and there is no
        automatic mode. <code>usePdfDocument</code> also accepts{' '}
        <code>cMapUrl</code> and <code>standardFontUrl</code> to override one folder at a time.
      </p>

      <h2>Content Security Policy</h2>
      <p>
        Nothing here injects a script tag or evaluates a string, so the default setup needs your CSP
        to allow two things: the worker file, and the asset root. Self-hosting both with{' '}
        <code>workerSrc</code> and <code>assetUrl</code> keeps the policy on your own origin; leaving
        the default adds <code>https://unpkg.com</code> to <code>connect-src</code>.
      </p>
      <p>
        <code>require-trusted-types-for 'script'</code> is the one policy that changes how the worker
        is started, because pdf.js has no Trusted Types support at all:{' '}
        <code>GlobalWorkerOptions.workerSrc</code> only accepts a plain string, and constructing a{' '}
        <code>Worker</code> from one throws on such a page. pdf.js catches that and parses on the main
        thread — so the viewer works, and nobody tells you the worker is gone. Opt in to fix it:
      </p>
      <pre>
        <code>{`import { configureTrustedTypes } from 'pdfjs-react-reader';

// CSP: require-trusted-types-for 'script'; trusted-types pdfjs-react-reader#worker;
// The name must already be allowed by your directive, so it is never chosen for you.
configureTrustedTypes();

// Now every load builds its own worker through your policy and hands pdf.js
// the instance instead of a URL, which is what keeps it off the main thread.`}</code>
      </pre>
      <p>
        This is opt-in for two reasons: a policy name your directive does not list throws when the
        page's scripts run, and a library should not pick names in your CSP. Once configured, loads
        own their worker and dispose of it — <code>PDFWorker.destroy()</code> does not terminate a
        port it was handed, so the package does it.
      </p>

      <h2>Sources</h2>
      <p>
        <code>src</code> accepts a URL string, a <code>data:</code> URI, a base64 string, a{' '}
        <code>File</code> or <code>Blob</code>, or an <code>ArrayBuffer</code> /{' '}
        <code>Uint8Array</code> of PDF bytes. A <code>File</code> also lends its name to the toolbar
        label and the download filename. A string that is none of those — a bare word, a Windows path
        with backslashes — throws <code>TypeError</code> instead of fetching whatever your origin
        happens to serve at that location and handing it to a PDF parser.
      </p>
      <pre>
        <code>{`<PdfViewer src="/a.pdf" />
<PdfViewer src="https://host/a.pdf" />
<PdfViewer src={selectedFile} />
<PdfViewer src={bytes} />`}</code>
      </pre>
      <p>
        When the URL is not one you wrote — a field from a CMS, a link a user pasted — bound it with{' '}
        <code>allowedSources</code>. Entries are URL prefixes or bare origins, plus paths, which are
        pinned to the page's own origin so that <code>'/files/'</code> cannot also admit{' '}
        <code>https://elsewhere.example/files/</code>. Byte sources are always accepted; the app
        handed those over itself.
      </p>
      <pre>
        <code>{`<PdfViewer
  src={userSuppliedUrl}
  allowedSources={['/uploads/', 'https://cdn.example.com']}
/>

// Opt out explicitly, if that is ever what you mean:
<PdfViewer src={userSuppliedUrl} allowedSources={['*']} />`}</code>
      </pre>

      <h2>Remounting</h2>
      <p>
        Give the component a <code>key</code> when the document changes identity:
      </p>
      <pre>
        <code>{`<PdfViewer key={doc.id} src={doc.url} />`}</code>
      </pre>
      <p>
        That resets page, zoom, rotation, search and form state together. Without it the viewer
        reloads the document but keeps its internal state, which is rarely what you want when
        switching to a different file.
      </p>

      <h2>Scripts</h2>
      <table className="doc-table">
        <thead>
          <tr>
            <th>Command</th>
            <th>Does</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>
              <code>npm run dev</code>
            </td>
            <td>The playground app on port 5199 — fixtures, form editing, printing.</td>
          </tr>
          <tr>
            <td>
              <code>npm run docs</code>
            </td>
            <td>This site on port 5200, against the sources.</td>
          </tr>
          <tr>
            <td>
              <code>npm run verify</code>
            </td>
            <td>Typecheck, tests, build and the size gate in one go.</td>
          </tr>
          <tr>
            <td>
              <code>npm run size:update</code>
            </td>
            <td>
              Accept the current bundle sizes into <code>size-baseline.json</code> after deciding a
              growth is worth it.
            </td>
          </tr>
        </tbody>
      </table>
    </>
  );
}
