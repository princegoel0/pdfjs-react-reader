import { useState } from 'react';
import { PdfViewer, type PageLayout } from 'pdfjs-react-reader';
import { CheckKnob, Example, SelectKnob } from '../components/Example';
import { FORM_SAMPLE, SAMPLES } from '../fixtures';
import source from './ShellExample.tsx?raw';

const LAYOUTS: { label: string; value: string }[] = [
  { label: 'Continuous', value: 'continuous' },
  { label: 'Single page', value: 'single' },
  { label: 'Two-page spread', value: 'spread' },
];

export function ShellExample() {
  const [src, setSrc] = useState(FORM_SAMPLE);
  const [layout, setLayout] = useState('continuous');
  const [sidebar, setSidebar] = useState(false);
  const [forms, setForms] = useState(true);
  const [print, setPrint] = useState(true);
  const [download, setDownload] = useState(true);

  return (
    <Example
      title="Drop-in viewer"
      source={source}
      controls={
        <>
          <SelectKnob label="Document" value={src} options={SAMPLES} onChange={setSrc} />
          <SelectKnob
            label="Layout"
            value={layout}
            options={LAYOUTS}
            onChange={(value) => setLayout(value)}
          />
          <CheckKnob label="Sidebar open" checked={sidebar} onChange={setSidebar} />
          <CheckKnob label="Render forms" checked={forms} onChange={setForms} />
          <CheckKnob label="Print" checked={print} onChange={setPrint} />
          <CheckKnob label="Download" checked={download} onChange={setDownload} />
        </>
      }
    >
      <div className="doc-frame">
        {/* `key` remounts on document change so every piece of internal state —
            page, zoom, rotation, search — starts clean. */}
        <PdfViewer
          key={src}
          src={src}
          defaultLayout={layout as PageLayout}
          defaultSidebarOpen={sidebar}
          renderForms={forms}
          enablePrint={print}
          enableDownload={download}
        />
      </div>
    </Example>
  );
}
