import { HeadlessExample } from '../examples/HeadlessExample';

const HOOKS: [string, string][] = [
  [
    'usePdfDocument({ src, workerSrc?, onPasswordRequired? })',
    'Loads the file. Returns { doc, numPages, isReady, error, reload }.',
  ],
  [
    'usePdfVirtualizer({ doc, numPages, scale, layout?, rotation?, gap? })',
    'The scroll engine. Returns { containerRef, virtualSlots, totalHeight, currentPage, resolvedScale, scrollToPage, reportPageDims }.',
  ],
  [
    'usePdfSearch({ doc })',
    'Whole-document search with a 200 ms debounce and cancellation of stale runs. Returns matches, status, and next/prev.',
  ],
  [
    'usePdfOutline({ doc })',
    'The bookmark tree, with destinations resolved to 1-based page numbers.',
  ],
  [
    'usePdfFormValues({ doc })',
    'Fields, widgets, values, isDirty, plus storage/getFormData/setFormData/reset for programmatic form access.',
  ],
  ['usePdfInk({ resetKey })', 'Freehand strokes stored in PDF user space, so zoom and rotation both map correctly.'],
  [
    'usePdfPrint({ doc, rotation?, getInkStrokes? })',
    'Headless print pipeline: { print, cancel, isPrinting, progress, error, supported }.',
  ],
  [
    'usePdfDownload({ doc, fileName? })',
    'Saves the file, optionally with form values via saveDocument().',
  ],
];

export function Headless() {
  return (
    <>
      <h1>Headless hooks</h1>
      <p className="doc-lede">
        Import from <code>pdfjs-react-reader/headless</code> and build the entire interface
        yourself. You get the document proxy, the virtualizer, and the layer components — you choose
        where every button lives.
      </p>

      <HeadlessExample />

      <h2>The pieces</h2>
      <table className="doc-table">
        <thead>
          <tr>
            <th>Hook</th>
            <th>Returns</th>
          </tr>
        </thead>
        <tbody>
          {HOOKS.map(([sig, note]) => (
            <tr key={sig}>
              <td>
                <code>{sig}</code>
              </td>
              <td>{note}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <h2>Rendering pages</h2>
      <p>
        <code>PdfPage</code> draws one page: canvas, selectable text layer, annotation layer and ink
        overlay. The virtualizer hands you rows (<code>virtualSlots</code>) already grouped for the
        active layout, positioned by <code>offsetTop</code>:
      </p>
      <pre>
        <code>{`<div ref={containerRef} style={{ height: totalHeight, position: 'relative' }}>
  {virtualSlots.map((slot) => (
    <div
      key={slot.indices[0]}
      style={{ position: 'absolute', top: 0, transform: \`translate(-50%, \${slot.offsetTop}px)\` }}
    >
      {slot.indices.map((index) => (
        <PdfPage
          key={index}
          doc={doc}
          pageNumber={index + 1}
          scale={resolvedScale}
          onBaseDimensions={reportPageDims}
        />
      ))}
    </div>
  ))}
</div>`}</code>
      </pre>
      <p>
        <code>reportPageDims</code> feeds measured page sizes back into the virtualizer, so the
        scrollbar stops guessing after the first page renders.
      </p>

      <h2>Two rules that matter</h2>
      <div className="doc-callout">
        <strong>Do not pass inline callbacks that appear in a layer's dependency list.</strong>{' '}
        <code>PdfPage</code> rebuilds the pdf.js text and annotation layers when its props change
        identity, which clears the container, drops text selection and flashes the page. The shell
        reads its callbacks through refs for exactly this reason; do the same in your own code.
      </div>
      <div className="doc-callout">
        <strong>Give the viewport element a height and let it scroll.</strong> The virtualizer
        measures its <code>containerRef</code>; a container sized by its content will report zero
        and render nothing but the first row.
      </div>

      <h2>Search without the shell</h2>
      <pre>
        <code>{`const search = usePdfSearch({ doc });

search.run('speculation', { caseSensitive: false, wholeWord: true });
// search.matches   -> PageMatch[] with pageIndex and a rect per hit
// search.status    -> 'idle' | 'searching' | 'results' | 'empty' | 'error'
search.next();

// Pass each page its slice of matches to highlight in the text layer:
<PdfPage doc={doc} pageNumber={i + 1} scale={scale} highlights={byPage.get(i)} />`}</code>
      </pre>

      <h2>Pure helpers</h2>
      <p>
        Everything the hooks are built from is exported too, so you can unit-test your own logic
        against it: <code>computeSlots</code>, <code>findVisibleRange</code>,{' '}
        <code>buildPageText</code>, <code>planPrintPages</code>, <code>planPrintScale</code>,{' '}
        <code>strokePathD</code>, <code>drawInkStrokes</code>, <code>parseDestination</code>,{' '}
        <code>collectWidgets</code>, <code>readFormValues</code>.
      </p>
    </>
  );
}
