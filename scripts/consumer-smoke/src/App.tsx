/*
 * Compiled and built against the *installed* package, never against `src/`, so
 * this exercises the export map, the shipped .d.ts files and the bundler
 * rewriting that the published artifact depends on. If it stops building, the
 * release is broken for consumers even when the library's own tests pass.
 */
import { PdfViewer, usePdfDocument, type PdfViewerProps } from 'pdfjs-react-reader';
import { usePdfSearch } from 'pdfjs-react-reader/headless';
// Every published stylesheet, named: a sheet the export map promises but the
// build does not emit is a consumer build failure, not a silently unstyled panel.
import 'pdfjs-react-reader/styles.css';
import 'pdfjs-react-reader/print.css';
import 'pdfjs-react-reader/forms.css';
import 'pdfjs-react-reader/outline.css';
import 'pdfjs-react-reader/layers.css';
import 'pdfjs-react-reader/annotate.css';
import 'pdfjs-react-reader/attachments.css';

// Deliberately no `workerSrc`: auto-detection is the path that regressed in 0.1.0.
const viewer: PdfViewerProps = { src: '/sample.pdf', defaultScale: 'fit-width' };

export function App() {
  const { doc, numPages } = usePdfDocument({ src: '/sample.pdf' });
  const { results, search } = usePdfSearch({ doc });
  return (
    <div data-pages={numPages}>
      <button onClick={() => search('clause')}>search ({results.length})</button>
      <PdfViewer {...viewer} />
    </div>
  );
}
