export function Installation() {
  return (
    <>
      <h1>Installation &amp; worker</h1>
      <p className="doc-lede">
        Two dependencies to line up: React, and a <code>pdfjs-dist</code> version you are
        comfortable with. The worker is resolved for you, with two escape hatches.
      </p>

      <h2>Install</h2>
      <pre>
        <code>{`npm install pdfjs-react-reader pdfjs-dist

# or
pnpm add pdfjs-react-reader pdfjs-dist
yarn add pdfjs-react-reader pdfjs-dist`}</code>
      </pre>
      <p>
        <code>pdfjs-dist</code> is a peer dependency on purpose: it stays your copy, at your
        version, and the package requires <code>^5.0.0</code> — see{' '}
        <a href="#/compatibility">Versions &amp; compatibility</a> for why v4 is excluded. React 18
        or 19 is required. The build is ESM-only
        (<code>"type": "module"</code>) with generated TypeScript declarations.
      </p>

      <h2>Import the theme</h2>
      <pre>
        <code>{`import 'pdfjs-react-reader/styles.css';`}</code>
      </pre>
      <p>
        Once per app, near your other global CSS. Skip it if you are building your own UI from the
        headless hooks and bringing your own styles.
      </p>

      <h2>The worker</h2>
      <p>
        pdf.js does its parsing in a worker, and finding that worker file is the single most common
        integration problem. The package tries three things, in order:
      </p>
      <ol>
        <li>
          An explicit <code>workerSrc</code> you pass to <code>PdfViewer</code> or{' '}
          <code>usePdfDocument</code> always wins — use this for a CDN or a copied asset.
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
          If nothing answers, <code>workerSrc</code> is left unset so pdf.js can still fall back to
          its main-thread "fake worker", and a failed load tells you to pass <code>workerSrc</code>
          instead of surfacing a bare fetch error.
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
        With Next.js, render the viewer in a client component (
        <code>'use client'</code>). The library never touches <code>window</code> at module scope,
        but the worker resolution and canvas rendering are browser-only by nature.
      </div>

      <h2>Sources</h2>
      <p>
        <code>src</code> accepts a URL string, a <code>File</code> or <code>Blob</code>, a{' '}
        <code>Uint8Array</code>, or an object with range/length metadata for HTTP partial loading.
        A <code>File</code> also lends its name to the toolbar label and the download filename.
      </p>
      <pre>
        <code>{`<PdfViewer src="/a.pdf" />
<PdfViewer src={selectedFile} />
<PdfViewer src={bytes} />
<PdfViewer src={{ url: 'https://host/a.pdf', httpHeaders: { Authorization: 'Bearer …' } }} />`}</code>
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
            <td>Typecheck, tests, build and the size budget in one go.</td>
          </tr>
        </tbody>
      </table>
    </>
  );
}
