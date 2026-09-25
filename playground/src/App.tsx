import { useCallback, useRef, useState } from 'react';
import {
  PdfViewer,
  type FormValue,
  type AnyPdfFeature,
  type PdfViewerHandle,
  type PdfViewerLabelsOverride,
} from 'pdfjs-react-reader';
import { downloadFeature } from 'pdfjs-react-reader/features/download';
import { createFormsFeature } from 'pdfjs-react-reader/features/forms';
import { outlineFeature } from 'pdfjs-react-reader/features/outline';
import { printFeature } from 'pdfjs-react-reader/features/print';
import 'pdfjs-react-reader/styles.css';
import 'pdfjs-react-reader/print.css';
import 'pdfjs-react-reader/forms.css';
import 'pdfjs-react-reader/outline.css';
import './app.css';

// The standard pdf.js test document (14 pages).
const DEFAULT_PDF = 'https://raw.githubusercontent.com/mozilla/pdf.js/master/web/compressed.tracemonkey-pldi-09.pdf';

// Deliberately partial: everything not listed here must keep its English
// default, which is the behaviour a consumer relies on.
const GERMAN: PdfViewerLabelsOverride = {
  toggleSidebar: 'Seitenleiste umschalten',
  previousPage: 'Vorherige Seite',
  nextPage: 'Nächste Seite',
  searchDocument: 'Dokument durchsuchen',
  zoomIn: 'Vergrößern',
  zoomOut: 'Verkleinern',
  pageOf: 'Seite {page} von {total}',
  pageLabel: 'Seite {page}',
  loadingDocument: 'PDF wird geladen…',
  thumbnailsTab: 'Miniaturen',
  outlineTab: 'Gliederung',
};

export default function App() {
  const viewer = useRef<PdfViewerHandle | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [url, setUrl] = useState('');
  const [appliedUrl, setAppliedUrl] = useState('');
  const [german, setGerman] = useState(false);
  const [dropEnabled, setDropEnabled] = useState(true);
  const [assetMode, setAssetMode] = useState<'' | 'cdn' | '/pdfjs-dist/'>('');
  const [restrict, setRestrict] = useState(false);
  const [formValues, setFormValues] = useState<Record<string, FormValue> | null>(null);
  const [log, setLog] = useState<string[]>([]);
  // All four on, so the first thing a visitor sees is what the old default
  // looked like — and unchecking one is how you watch a control leave the bar.
  const [withPrint, setWithPrint] = useState(true);
  const [withDownload, setWithDownload] = useState(true);
  const [withForms, setWithForms] = useState(true);
  const [withOutline, setWithOutline] = useState(true);
  const src = file ?? (appliedUrl || DEFAULT_PDF);

  // Rebuilt inline on purpose: features keyed by id must survive a list that has
  // no stable identity, which is the ordinary way a host app will write this.
  const features: AnyPdfFeature[] = [
    ...(withPrint ? [printFeature] : []),
    ...(withDownload ? [downloadFeature] : []),
    ...(withForms ? [createFormsFeature({ onChange: setFormValues })] : []),
    ...(withOutline ? [outlineFeature] : []),
  ];

  const note = useCallback((message: string) => {
    setLog((previous) => [message, ...previous].slice(0, 8));
  }, []);

  return (
    <div className="app">
      <header className="app-header">
        <strong>pdfjs-react-reader</strong>
        <label>
          Open local PDF:&nbsp;
          <input
            type="file"
            accept="application/pdf"
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          />
        </label>
        <form
          className="app-url"
          onSubmit={(e) => {
            e.preventDefault();
            setAppliedUrl(url.trim());
          }}
        >
          <input
            type="url"
            placeholder="PDF URL (Enter to open)…"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
          />
        </form>
        {file && (
          <button type="button" onClick={() => setFile(null)}>
            Back to default
          </button>
        )}
        <label>
          <input type="checkbox" checked={german} onChange={(e) => setGerman(e.target.checked)} />
          &nbsp;Partial German labels
        </label>
        <label>
          <input
            type="checkbox"
            checked={dropEnabled}
            onChange={(e) => setDropEnabled(e.target.checked)}
          />
          &nbsp;Swap on drop
        </label>
        <label>
          <input
            type="checkbox"
            checked={restrict}
            onChange={(e) => setRestrict(e.target.checked)}
          />
          &nbsp;Allow only /fixtures/
        </label>
        <label>
          &nbsp;Support assets:&nbsp;
          <select
            value={assetMode}
            onChange={(e) => setAssetMode(e.target.value as '' | 'cdn' | '/pdfjs-dist/')}
          >
            <option value="">default (cdn)</option>
            <option value="cdn">cdn</option>
            <option value="/pdfjs-dist/">self-hosted</option>
          </select>
        </label>
        <span className="app-features" aria-label="Mounted features">
          <label>
            <input
              type="checkbox"
              checked={withPrint}
              onChange={(e) => setWithPrint(e.target.checked)}
            />
            &nbsp;print
          </label>
          <label>
            <input
              type="checkbox"
              checked={withDownload}
              onChange={(e) => setWithDownload(e.target.checked)}
            />
            &nbsp;download
          </label>
          <label>
            <input
              type="checkbox"
              checked={withForms}
              onChange={(e) => setWithForms(e.target.checked)}
            />
            &nbsp;forms
          </label>
          <label>
            <input
              type="checkbox"
              checked={withOutline}
              onChange={(e) => setWithOutline(e.target.checked)}
            />
            &nbsp;outline
          </label>
        </span>
      </header>
      <div className="app-main">
        <div className="app-viewer">
          <PdfViewer
            ref={viewer}
            src={src}
            assetUrl={assetMode || undefined}
            allowedSources={restrict ? ['/fixtures/'] : undefined}
            labels={german ? GERMAN : undefined}
            features={features}
            onError={(err) => console.error('[playground] viewer error', err)}
            onPageChange={(page) => note(`onPageChange ${page}`)}
            onScaleChange={(scale) => note(`onScaleChange ${scale.toFixed(2)}`)}
            onLayoutChange={(layout) => note(`onLayoutChange ${layout}`)}
            onCapabilities={(c) =>
              note(`capabilities form=${c.form} xfa=${c.renderedFromXfa} js=${c.hasJSActions}`)
            }
            onFullscreenChange={(active) => note(`onFullscreenChange ${active}`)}
            onExternalLink={(link) => note(`onExternalLink ${link}`)}
            enableDrop={dropEnabled}
            onDropFile={(dropped) => note(`onDropFile ${dropped.name}`)}
          />
        </div>
        <aside className="app-panel">
          <h3>Imperative handle</h3>
          <div className="app-actions">
            <button type="button" onClick={() => viewer.current?.goToPage(5)}>
              goToPage(5)
            </button>
            <button type="button" onClick={() => viewer.current?.zoomTo(2)}>
              zoomTo(2)
            </button>
            <button type="button" onClick={() => viewer.current?.fitTo('width')}>
              fitTo('width')
            </button>
            <button type="button" onClick={() => viewer.current?.setLayout('spread')}>
              setLayout('spread')
            </button>
            <button type="button" onClick={() => viewer.current?.rotatePage(3, 90)}>
              rotatePage(3, 90)
            </button>
            <button type="button" onClick={() => viewer.current?.openSidebar(true, 'outline')}>
              openSidebar(true, 'outline')
            </button>
            <button type="button" onClick={() => viewer.current?.toggleFullscreen()}>
              toggleFullscreen()
            </button>
            <button type="button" onClick={() => viewer.current?.search('license')}>
              search('license')
            </button>
          </div>
          <h3>Events</h3>
          <ol className="app-log">
            {log.map((line, index) => (
              // The log is a stack, so the same message legitimately appears at
              // two positions; index is the only identity it has.
              <li key={`${index}:${line}`}>{line}</li>
            ))}
          </ol>
        </aside>
        {formValues && Object.keys(formValues).length > 0 && (
          <aside className="app-panel">
            <h3>Form values (getFormData)</h3>
            <pre>{JSON.stringify(formValues, null, 2)}</pre>
          </aside>
        )}
      </div>
    </div>
  );
}
