import { useState } from 'react';
import { PdfViewer, type FormValue } from 'pdfjs-react-reader';
import { Example } from '../components/Example';
import { FORM_SAMPLE } from '../fixtures';
import source from './FormsExample.tsx?raw';

export function FormsExample() {
  const [values, setValues] = useState<Record<string, FormValue> | null>(null);

  return (
    <Example title="AcroForm values, live" source={source}>
      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) 260px', gap: 12 }}>
        <div className="doc-frame doc-frame--short">
          <PdfViewer src={FORM_SAMPLE} defaultScale="fit-width" onFormValuesChange={setValues} />
        </div>
        <div>
          <h3 style={{ margin: '0 0 8px', fontSize: 14 }}>onFormValuesChange</h3>
          <pre style={{ maxHeight: 300, overflow: 'auto' }}>
            <code>{values ? JSON.stringify(values, null, 2) : 'Edit a field to see the payload.'}</code>
          </pre>
        </div>
      </div>
    </Example>
  );
}
