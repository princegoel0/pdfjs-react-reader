export function Recipes() {
  return (
    <>
      <h1>Recipes</h1>
      <p className="doc-lede">
        The patterns that come up once you stop wanting the default toolbar.
      </p>

      <h2>Print from your own button</h2>
      <pre>
        <code>{`import { usePdfDocument, usePdfPrint } from 'pdfjs-react-reader/headless';

const { doc } = usePdfDocument({ src });
const print = usePdfPrint({ doc, getInkStrokes });

<button disabled={!print.supported || print.isPrinting} onClick={() => print.print({ range: [1, 5] })}>
  {print.isPrinting ? \`Rendering \${Math.round(print.progress * 100)}%\` : 'Print pages 1–5'}
</button>

// Escape hatch: the control that started the job should be able to abort it.
print.cancel();`}</code>
      </pre>
      <p>
        Each page is rendered at <code>intent: 'print'</code> into a canvas inside a body-level{' '}
        <code>.pjsr-print</code> container, with freehand ink drawn on top and stored form values
        included. Resolution is chosen from a canvas memory budget rather than hardcoded, because
        every page keeps a live canvas until the dialog closes. The container is torn down and each
        canvas zeroed afterwards — the thing that stops mobile Safari crashing on long documents.
      </p>
      <div className="doc-callout">
        <strong>iOS Safari is excluded.</strong> It prints the top document, so the pipeline would
        blank the page instead of printing it. <code>print.supported</code> is false there; hide
        your control rather than disabling it.
      </div>

      <h2>Save, with or without edits</h2>
      <pre>
        <code>{`import { usePdfDownload } from 'pdfjs-react-reader/headless';

const download = usePdfDownload({ doc, fileName: 'contract.pdf' });

// Original bytes, untouched.
download.download();
// Incremental update carrying the current form values.
download.download({ withFormValues: true });`}</code>
      </pre>
      <p>
        <code>withFormValues</code> uses <code>saveDocument()</code>, which produces an editable
        form — the <code>/AcroForm</code> dictionary survives, values are written as{' '}
        <code>/V</code> with regenerated appearances. It is not a flatten. The shell passes{' '}
        <code>form.isDirty</code> so an untouched document downloads byte-identical to the original.
      </p>

      <h2>Read and write forms programmatically</h2>
      <pre>
        <code>{`const form = usePdfFormValues({ doc });

form.fields;                       // FormField[] with type, options, current value
form.setValue('fullName', 'Ada');  // re-renders the widget
form.getFormData();                // Record<string, FormValue>
form.setFormData(saved);
form.reset();                      // back to the document's own defaults
form.isDirty;`}</code>
      </pre>
      <p>
        Programmatic writes bump an internal version so the annotation layer re-reads stored values:
        pdf.js's <code>AnnotationLayer.update()</code> only repositions, it never refreshes them.
      </p>

      <h2>Jump to an outline entry</h2>
      <pre>
        <code>{`const { entries } = usePdfOutline({ doc });

// Destination resolution is subtle: a numeric dest[0] is a 0-based page index,
// but an object { num, gen } is a PDF object reference whose number is not a
// page number. resolveDestinationPageIndex() handles both, plus named dests.
onClick={() => scrollToPage(entry.pageIndex + 1)}`}</code>
      </pre>

      <h2>Partial loading over HTTP</h2>
      <pre>
        <code>{`<PdfViewer
  src={{
    url: 'https://cdn.example.com/atlas.pdf',
    range: { start: 0, end: 65535 },
    httpHeaders: { Authorization: \`Bearer \${token}\` },
    withCredentials: true,
  }}
/>`}</code>
      </pre>
      <p>
        The server must answer range requests. pdf.js reads the trailer first and fetches only the
        objects a page needs, which is how a 400 MB atlas opens instantly.
      </p>

      <h2>Server rendering</h2>
      <p>
        The package touches no browser globals at module scope, so importing it during SSR is safe.
        Rendering is not: gate the component behind a client boundary or a mounted check, since the
        worker, canvas and <code>ResizeObserver</code> all need a DOM.
      </p>
      <pre>
        <code>{`'use client';
import dynamic from 'next/dynamic';

const PdfViewer = dynamic(
  () => import('pdfjs-react-reader').then((m) => m.PdfViewer),
  { ssr: false },
);`}</code>
      </pre>

      <h2>Testing your code against it</h2>
      <p>
        The interesting logic is pure and exported, so most of it never needs a browser:{' '}
        <code>computeSlots</code> for layout grouping, <code>planPrintPages</code> and{' '}
        <code>planPrintScale</code> for print planning, <code>buildPageText</code> and{' '}
        <code>convertMatches</code> for search, <code>readFormValues</code> for forms. The repo's
        own suite is 97 tests over those helpers, running in a few hundred milliseconds.
      </p>

      <h2>Fixtures</h2>
      <p>
        The playground and these docs load small PDFs generated by scripts in the repo, which is the
        fastest way to reproduce an edge case:
      </p>
      <pre>
        <code>{`node scripts/make-form-pdf.mjs       # AcroForm: text, checkbox, radio, choice, button
node scripts/make-outline-pdf.mjs    # 3 pages, bookmarks, named destinations
node scripts/make-encrypted-pdf.mjs  # RC4-40 encrypted, password "secret"`}</code>
      </pre>
    </>
  );
}
