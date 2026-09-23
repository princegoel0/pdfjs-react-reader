import { useState } from 'react';
import { PdfViewer, type FormValue } from 'pdfjs-react-reader';
import 'pdfjs-react-reader/styles.css';
import './app.css';

// The standard pdf.js test document (14 pages).
const DEFAULT_PDF = 'https://raw.githubusercontent.com/mozilla/pdf.js/master/web/compressed.tracemonkey-pldi-09.pdf';

export default function App() {
  const [file, setFile] = useState<File | null>(null);
  const [url, setUrl] = useState('');
  const [appliedUrl, setAppliedUrl] = useState('');
  const [formValues, setFormValues] = useState<Record<string, FormValue> | null>(null);
  const src = file ?? (appliedUrl || DEFAULT_PDF);

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
      </header>
      <div className="app-main">
        <div className="app-viewer">
          <PdfViewer
            key={file ? file.name : appliedUrl || 'default'}
            src={src}
            onFormValuesChange={setFormValues}
            onError={(err) => console.error('[playground] viewer error', err)}
          />
        </div>
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
