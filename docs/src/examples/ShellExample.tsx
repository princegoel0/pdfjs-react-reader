import { useState } from 'react';
import { PdfViewer, type AnyPdfFeature, type PageLayout } from 'pdfjs-react-reader';
import { downloadFeature } from 'pdfjs-react-reader/features/download';
import { formsFeature } from 'pdfjs-react-reader/features/forms';
import { outlineFeature } from 'pdfjs-react-reader/features/outline';
import { printFeature } from 'pdfjs-react-reader/features/print';
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
  const [outline, setOutline] = useState(true);

  // Three of the viewer's capabilities are features you name here, so switching
  // one off is switching its code off in your bundle, not hiding a button.
  const features: AnyPdfFeature[] = [
    ...(print ? [printFeature] : []),
    ...(download ? [downloadFeature] : []),
    ...(forms ? [formsFeature] : []),
    ...(outline ? [outlineFeature] : []),
  ];

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
          <CheckKnob label="Forms feature" checked={forms} onChange={setForms} />
          <CheckKnob label="Print feature" checked={print} onChange={setPrint} />
          <CheckKnob label="Download feature" checked={download} onChange={setDownload} />
          <CheckKnob label="Outline feature" checked={outline} onChange={setOutline} />
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
          features={features}
        />
      </div>
    </Example>
  );
}
