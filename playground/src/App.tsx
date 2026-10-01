import { useCallback, useRef, useState } from 'react';
import {
  PdfViewer,
  type FormValue,
  type AnyPdfFeature,
  type PdfViewerHandle,
  type PdfViewerLabelsOverride,
  type PdfViewerProps,
} from 'pdfjs-react-reader';
import { CustomLayoutViewer, progressControl } from './CustomLayout';
import { useHostIndexFind } from './HostFind';
import { downloadFeature } from 'pdfjs-react-reader/features/download';
import { createFormsFeature } from 'pdfjs-react-reader/features/forms';
import { annotateFeature } from 'pdfjs-react-reader/features/annotate';
import { editFeature } from 'pdfjs-react-reader/edit';
import { outlineFeature } from 'pdfjs-react-reader/features/outline';
import { printFeature } from 'pdfjs-react-reader/features/print';
import { layersFeature } from 'pdfjs-react-reader/features/layers';
import { attachmentsFeature } from 'pdfjs-react-reader/features/attachments';
import { structureFeature } from 'pdfjs-react-reader/features/structure';
import { DE_LABELS } from 'pdfjs-react-reader/locales/de';
import 'pdfjs-react-reader/styles.css';
import 'pdfjs-react-reader/print.css';
import 'pdfjs-react-reader/forms.css';
import 'pdfjs-react-reader/outline.css';
import 'pdfjs-react-reader/layers.css';
import 'pdfjs-react-reader/annotate.css';
import 'pdfjs-react-reader/attachments.css';
import 'pdfjs-react-reader/edit.css';
import 'pdfjs-react-reader/structure.css';
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
  zoomAutomatic: 'Automatisch',
  clearLabel: 'Löschen',
  pageCountOf: 'von {total}',
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
  // Typed into `httpHeaders` below. Read when a load starts and never mid-load, so a
  // new token needs the URL re-opened — which is the behaviour, not an oversight.
  const [token, setToken] = useState('');
  const [german, setGerman] = useState(false);
  // The shipped catalog, imported the way an application imports it. The partial
  // override above is the different case: it exists to prove that a catalog which
  // answers only some keys keeps the English for the rest.
  const [germanCatalog, setGermanCatalog] = useState(false);
  const [dropEnabled, setDropEnabled] = useState(true);
  const [assetMode, setAssetMode] = useState<'' | 'cdn' | '/pdfjs-dist/'>('');
  const [restrict, setRestrict] = useState(false);
  const [formValues, setFormValues] = useState<Record<string, FormValue> | null>(null);
  const [log, setLog] = useState<string[]>([]);
  // The last byte report the load made, kept out of the event log on purpose: progress arrives per chunk,
  // and eight lines of it would push every real event off the panel.
  const [bytes, setBytes] = useState('');
  // All four on, so the first thing a visitor sees is what the old default
  // looked like — and unchecking one is how you watch a control leave the bar.
  const [withPrint, setWithPrint] = useState(true);
  const [withDownload, setWithDownload] = useState(true);
  const [withForms, setWithForms] = useState(true);
  const [withOutline, setWithOutline] = useState(true);
  // Off by default: these two only say anything about the fixture that carries
  // layers and attached files, and an empty tab on the usual document is noise.
  const [withLayers, setWithLayers] = useState(false);
  const [withAttachments, setWithAttachments] = useState(false);
  // Annotation authoring needs a document with room to annotate and a reader who
  // means to draw on it, so it starts off.
  const [withAnnotate, setWithAnnotate] = useState(false);
  const [withEdit, setWithEdit] = useState(false);
  // Off by default, and it changes nothing you can see on screen: the structure tree is the page as an
  // accessibility tree, so the only fixture that answers is `tagged-sample.pdf`, and what to look for is
  // in the browser's own a11y snapshot rather than in the pixels.
  const [withStructure, setWithStructure] = useState(false);
  // The same props, rendered through a layout written in playground/src/CustomLayout.tsx.
  const [compound, setCompound] = useState(false);
  // Find results come from playground/src/HostFind.tsx instead of the engine's text.
  const [hostFind, setHostFind] = useState(false);
  const hostFindController = useHostIndexFind();
  // Drop two controls, move one, add a host control — the bar's own configuration.
  const [trim, setTrim] = useState(false);
  const src = file ?? (appliedUrl || DEFAULT_PDF);

  // Rebuilt inline on purpose: features keyed by id must survive a list that has
  // no stable identity, which is the ordinary way a host app will write this.
  const features: AnyPdfFeature[] = [
    ...(withPrint ? [printFeature] : []),
    ...(withDownload ? [downloadFeature] : []),
    ...(withForms ? [createFormsFeature({ onChange: setFormValues })] : []),
    ...(withOutline ? [outlineFeature] : []),
    ...(withLayers ? [layersFeature] : []),
    ...(withAttachments ? [attachmentsFeature] : []),
    ...(withAnnotate ? [annotateFeature] : []),
    ...(withEdit ? [editFeature] : []),
    ...(withStructure ? [structureFeature] : []),
  ];

  const note = useCallback((message: string) => {
    setLog((previous) => [message, ...previous].slice(0, 8));
  }, []);

  // One props object, two layouts: the stock `PdfViewer` and the host-written
  // one in CustomLayout.tsx take exactly the same thing.
  const viewerProps: PdfViewerProps = {
    src,
    assetUrl: assetMode || undefined,
    allowedSources: restrict ? ['/fixtures/'] : undefined,
    // A fresh object literal on every render, which is exactly the shape FR-34 had to
    // survive: the load reads it at start and does not re-read it, so retyping the token
    // does not reload the document underneath the reader.
    httpHeaders: token ? { Authorization: `Bearer ${token}` } : undefined,
    labels: germanCatalog ? DE_LABELS : german ? GERMAN : undefined,
    features,
    find: hostFind ? hostFindController : undefined,
    onError: (err) => console.error('[playground] viewer error', err),
    onProgress: (p) =>
      setBytes(`${p.loaded} of ${p.total || '?'} bytes — ${p.percent ?? 'unknown'} %`),
    onPageChange: (page) => note(`onPageChange ${page}`),
    onScaleChange: (scale) => note(`onScaleChange ${scale.toFixed(2)}`),
    onLayoutChange: (layout) => note(`onLayoutChange ${layout}`),
    onCapabilities: (c) =>
      note(`capabilities form=${c.form} xfa=${c.renderedFromXfa} js=${c.hasJSActions}`),
    onFullscreenChange: (active) => note(`onFullscreenChange ${active}`),
    onExternalLink: (link) => note(`onExternalLink ${link}`),
    onAnnotationChange: (state) =>
      note(
        `onAnnotationChange editing=${state.isEditing} empty=${state.isEmpty} ` +
          `undo=${state.canUndo} delete=${state.canDelete}`,
      ),
    enableDrop: dropEnabled,
    onDropFile: (dropped) => note(`onDropFile ${dropped.name}`),
    controls: trim
      ? {
          hide: ['draw', 'meta'],
          priorities: { layout: 2 },
          order: ['search', 'page', 'prev', 'next', 'layout'],
          add: [progressControl],
        }
      : undefined,
  };

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
        <label>
          Bearer token:&nbsp;
          <input
            type="text"
            spellCheck={false}
            placeholder="for http://localhost:5300/…"
            value={token}
            onChange={(e) => setToken(e.target.value)}
          />
        </label>
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
            checked={germanCatalog}
            onChange={(e) => setGermanCatalog(e.target.checked)}
          />
          &nbsp;Shipped German catalog
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
          <label>
            <input
              type="checkbox"
              checked={withLayers}
              onChange={(e) => setWithLayers(e.target.checked)}
            />
            &nbsp;layers
          </label>
          <label>
            <input
              type="checkbox"
              checked={withAttachments}
              onChange={(e) => setWithAttachments(e.target.checked)}
            />
            &nbsp;attachments
          </label>
          <label>
            <input
              type="checkbox"
              checked={withAnnotate}
              onChange={(e) => setWithAnnotate(e.target.checked)}
            />
            &nbsp;annotate
          </label>
          <label>
            <input
              type="checkbox"
              checked={withEdit}
              onChange={(e) => setWithEdit(e.target.checked)}
            />
            &nbsp;edit
          </label>
          <label>
            <input
              type="checkbox"
              checked={withStructure}
              onChange={(e) => setWithStructure(e.target.checked)}
            />
            &nbsp;structure
          </label>
        </span>
        <label>
          <input type="checkbox" checked={compound} onChange={(e) => setCompound(e.target.checked)} />
          &nbsp;host-written layout
        </label>
        <label>
          <input type="checkbox" checked={hostFind} onChange={(e) => setHostFind(e.target.checked)} />
          &nbsp;host find results
        </label>
        <label>
          <input type="checkbox" checked={trim} onChange={(e) => setTrim(e.target.checked)} />
          &nbsp;trim the bar
        </label>
      </header>
      <div className="app-main">
        <div className="app-viewer">
          {compound ? (
            <CustomLayoutViewer ref={viewer} {...viewerProps} />
          ) : (
            <PdfViewer ref={viewer} {...viewerProps} />
          )}
        </div>
        <aside className="app-panel">
          <h3>Imperative handle</h3>
          <p className="app-load" role="status">
            {bytes || 'no byte report yet'}
          </p>
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
