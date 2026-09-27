import { useState } from 'react';
import { PdfViewer, type PdfViewerLabelsOverride } from 'pdfjs-react-reader';
import { DE_LABELS } from 'pdfjs-react-reader/locales/de';
import { ES_LABELS } from 'pdfjs-react-reader/locales/es';
import { FR_LABELS } from 'pdfjs-react-reader/locales/fr';
import { Example, SelectKnob } from '../components/Example';
import { OUTLINE_SAMPLE } from '../fixtures';
import source from './LabelsExample.tsx?raw';

const CATALOGS: Record<string, { label: string; catalog: PdfViewerLabelsOverride }> = {
  en: { label: 'English (the default)', catalog: {} },
  de: { label: 'Deutsch — pdfjs-react-reader/locales/de', catalog: DE_LABELS },
  fr: { label: 'Français — pdfjs-react-reader/locales/fr', catalog: FR_LABELS },
  es: { label: 'Español — pdfjs-react-reader/locales/es', catalog: ES_LABELS },
  // A catalog and a correction in one object: the later spread wins, which is how a
  // host adjusts one word of a shipped language without forking it.
  mixed: {
    label: 'Deutsch, with one string replaced',
    catalog: { ...DE_LABELS, outlineTab: 'Inhaltsverzeichnis' },
  },
};

export function LabelsExample() {
  const [code, setCode] = useState('de');

  return (
    <Example
      title="Language"
      source={source}
      controls={
        <SelectKnob
          label="Catalog"
          value={code}
          options={Object.entries(CATALOGS).map(([key, entry]) => ({
            label: entry.label,
            value: key,
          }))}
          onChange={setCode}
        />
      }
    >
      <div className="doc-frame">
        <PdfViewer src={OUTLINE_SAMPLE} labels={CATALOGS[code]?.catalog} defaultSidebarOpen />
      </div>
    </Example>
  );
}
