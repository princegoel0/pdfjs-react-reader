export function Recipes() {
  return (
    <>
      <h1>Recipes</h1>
      <p className="doc-lede">
        The patterns that come up once you stop wanting the default toolbar. Everything below drives
        the headless hooks directly; the <a href="#/features">built-in features</a> are the same
        calls, wrapped in a control the shell can fold away for you.
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
// Incremental update carrying what is in the annotation storage.
download.download({ saveEdits: true });`}</code>
      </pre>
      <p>
        <code>saveEdits</code> uses <code>saveDocument()</code>, which produces an editable form — the{' '}
        <code>/AcroForm</code> dictionary survives, values are written as <code>/V</code> with
        regenerated appearances, and annotation marks go in as annotations rather than painted into
        the page. It is not a flatten. Without it you get <code>getData()</code>, which is the file as
        it was loaded — measured: with one highlight on the page and nothing else changed,{' '}
        <code>getData()</code> returned the original 6,058 bytes and <code>saveDocument()</code>{' '}
        returned 7,067 with a second <code>/Highlight</code> in them.
      </p>
      <p>
        The <code>downloadFeature</code> control decides that for you: it saves when{' '}
        <code>formsFeature</code> reports <code>isDirty</code> <em>or</em> <code>annotateFeature</code>{' '}
        reports <code>canUndo</code>, and hands back the original file otherwise. The second half is
        recent and load-bearing — asking only the form feature meant a document marked up without one
        downloaded with the marks missing. <code>canUndo</code> is the flag that works because arming a
        tool is not an edit: converting the page&apos;s own annotations into editors puts entries in{' '}
        <code>annotationStorage</code> without the reader having changed anything, so the storage&apos;s
        size says &ldquo;save&rdquo; when nothing needs saving.
      </p>

      <h2>Gate your own save on the editor</h2>
      <pre>
        <code>{`<PdfViewer
  src="/contract.pdf"
  features={[annotateFeature, downloadFeature]}
  onAnnotationChange={(state) => {
    setSaveEnabled(state.canUndo);       // not state.isEmpty
    setDirty(state.canUndo);             // "discard your changes?" on close
  }}
/>`}</code>
      </pre>
      <p>
        <code>state.canDelete</code> is what a Delete button of your own reads, <code>isEditing</code>{' '}
        says a tool is armed or a mark is active, and <code>hasSelectedText</code> says the highlight
        tool has something to work on. The event is the engine&apos;s own report, so it fires for a
        change made with the keyboard as readily as one made through this viewer&apos;s controls — and{' '}
        <code>isEmpty</code> is not a save gate: after every mark is deleted it reads empty while the
        deletion itself is still unsaved.
      </p>

      <h2>Rearrange, extract or split pages</h2>
      <pre>
        <code>{`import {
  arrangePages,
  initialPlan,
  movePlanned,
  removePlanned,
  rotatePlanned,
} from 'pdfjs-react-reader/edit';

let plan = initialPlan(20);                  // 20 pages, nothing touched
plan = movePlanned(plan, 0, 4);              // the first page down to slot 4
plan = rotatePlanned(plan, 3, 90);           // whatever now sits in slot 3
plan = removePlanned(plan, 7) ?? plan;       // null only if that was the last page

const { bytes, pages, removed } = await arrangePages(original, plan);`}</code>
      </pre>
      <p>
        The writer behind the Pages tab, on its own. A plan is plain data — an <code>order</code> of
        indices into the document as loaded, and a <code>rotations</code> map keyed by the same
        indices — so every operation before the write is an array edit, and undo is either the inverse
        permutation or nothing at all. Slots, not page numbers: <code>movePlanned(plan, 0, 4)</code>{' '}
        names two positions in the list as it currently stands, which is why a batch of moves composes
        and why the panel&apos;s row labels renumber after an apply.
      </p>
      <p>
        A move is a permutation of the page tree&apos;s <code>/Kids</code> with <code>/Count</code>{' '}
        restated, never <code>removePage()</code> followed by <code>insertPage()</code>. The second one
        cannot work here and the reason is in the writer: removal ends by deleting the page object, so
        the tree it leaves behind names something that no longer exists, and the file fails to reopen.
        That was measured before the mechanism was chosen, and it is the whole reason this tier
        re-implements the ordering step.
      </p>
      <p>
        Extract and split are the same call over a different slice — extract writes{' '}
        <code>plan.order</code> as a new file, and a split writes two arrangements from one read of the
        base bytes. None of them touches what is on screen: the viewer swaps to new bytes through{' '}
        <code>useViewer()</code>&apos;s <code>replaceDocument(bytes, name)</code>, which is exactly what
        the panel&apos;s Apply button does.
      </p>
      <p>
        <strong>Flatten is a different thing, and it is worth knowing which one you want.</strong>{' '}
        <code>{'download({ saveEdits: true })'}</code> adds an incremental update, so the fields stay
        interactive and a mark stays an object a renderer may choose not to draw.{' '}
        <code>flattenBytes</code> paints them into the page instead, which is what you want before
        sending a file to someone with no editor — and what you want never to do to a document someone
        is still filling in.
      </p>

      <h2>Merge two documents into a third</h2>
      <pre>
        <code>{`import { describeMergeSources, mergeDocuments } from 'pdfjs-react-reader/merge';

const sources = [
  { bytes: await fetch('/fixtures/report.pdf').then((r) => r.arrayBuffer()), name: 'report' },
  { bytes: coverPageBytes, name: 'cover' },
];

const [{ pages: reportPages }, { pages: coverPages }] = await describeMergeSources(sources);

const result = await mergeDocuments(
  {
    sources,
    order: [
      { source: 1, page: 0 },            // the cover, first
      { source: 0, page: 2 },            // page 3 of the report
      { source: 0, page: 3 },
      { source: 1, page: 0 },            // and the cover again at the back
    ],
  },
  { signal: controller.signal },
);
// result.bytes is a NEW document. reportPages stays 12; both sources are byte-identical.
// result.taken is [2, 2] — how many pages came from each, in the order they were offered.`}</code>
      </pre>
      <p>
        The whole of what the package ships for a merge is the writer above and{' '}
        <code>usePdfMerge</code>, which is the same thing plus the counts and the plan as state. There is no
        component, and that is a decision rather than an omission: which documents may be merged, where their
        bytes come from and what happens to the result are the host&apos;s business, in the same way a dropped
        file is handed back rather than opened. <code>playground/src/MergeDemo.tsx</code> is what a host then
        writes — two pickers, an ordered list with earlier/later/remove on each row, and one button — and it is
        the honest test of the seam, because if the demo is awkward the awkwardness is a bug report against the
        hook.
      </p>
      <p>
        Four things are worth knowing before you build on it. <strong>The output is always a new file</strong>,
        and every source is read from a copy of your buffer, so nothing you pass in can be damaged by trying a
        merge. <strong>The same page may be taken twice</strong>, which the page-plan API above refuses: inside
        one document a page is an object to be permuted, across documents it is one to be copied.{' '}
        <strong>The plan is validated before anything is copied</strong>, so a page number that does not exist
        fails on the first line rather than halfway through a document you then have to discard. And{' '}
        <strong>the interactive form does not come across</strong>: a page arrives with its widget annotations
        but not the <code>AcroForm</code> that binds them, so on a merged file the values are visible and the
        fields are not live — the same rule flattening documents from the other direction.
      </p>
      <p>
        To show a merged result, hand the bytes to the viewer the way you would any other document — a{' '}
        <code>Uint8Array</code> passed as <code>src</code>, or{' '}
        <code>replaceDocument(result.bytes, 'merged.pdf')</code> from{' '}
        <code>useViewer()</code> if you are inside the shell.
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
node scripts/make-encrypted-pdf.mjs  # RC4-40 encrypted, password "secret"
node scripts/make-cjk-pdf.mjs        # CID-encoded, so the cMap path is exercised
node scripts/make-scripted-pdf.mjs   # document-level JavaScript
node scripts/make-attachments-ocg-pdf.mjs  # 3 attached files + 3 layers, one off by default
node scripts/make-annotated-pdf.mjs  # highlight, underline, strikeout, squiggly, note, ink, free text
node scripts/make-labelled-pdf.mjs   # /PageLabels: roman front matter, a decimal body, an A- appendix`}</code>
      </pre>
    </>
  );
}
