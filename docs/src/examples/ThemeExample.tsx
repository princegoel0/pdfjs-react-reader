import { useState } from 'react';
import type { CSSProperties } from 'react';
import { PdfViewer } from 'pdfjs-react-reader';
import { Example, SelectKnob } from '../components/Example';
import { FORM_SAMPLE } from '../fixtures';
import source from './ThemeExample.tsx?raw';

type Tokens = Record<string, string>;

/* The viewer declares its tokens on `.pjsr-viewer`, so a host cannot win by
   setting them on an ancestor — they have to land on the element itself.
   `style` is applied to that element, which makes it the override point. */
const PRESETS: Record<string, Tokens> = {
  default: {},
  midnight: {
    '--pjsr-bg': '#1b1f2a',
    '--pjsr-fg': '#e6e9f0',
    '--pjsr-muted-fg': '#a6adbd',
    '--pjsr-border': '#333a4a',
    '--pjsr-toolbar-bg': '#222735',
    '--pjsr-hover-bg': '#2c3342',
    '--pjsr-accent': '#a5b2ff',
    '--pjsr-viewport-bg': '#12151d',
    '--pjsr-page-shadow': '0 1px 2px rgba(0, 0, 0, 0.5)',
    '--pjsr-menu-shadow': '0 16px 40px rgba(0, 0, 0, 0.6)',
    '--pjsr-danger-fg': '#ff8b80',
  },
  sepia: {
    '--pjsr-bg': '#fbf6ea',
    '--pjsr-fg': '#3b3227',
    '--pjsr-muted-fg': '#7a6c58',
    '--pjsr-border': '#e3d9c3',
    '--pjsr-toolbar-bg': '#f5eedd',
    '--pjsr-hover-bg': '#ece2cb',
    '--pjsr-accent': '#8a5a1e',
    '--pjsr-viewport-bg': '#efe6d2',
  },
};

export function ThemeExample() {
  const [preset, setPreset] = useState('default');

  return (
    <Example
      title="Token overrides"
      source={source}
      controls={
        <SelectKnob
          label="Preset"
          value={preset}
          options={[
            { label: 'Default (light)', value: 'default' },
            { label: 'Midnight', value: 'midnight' },
            { label: 'Sepia', value: 'sepia' },
          ]}
          onChange={setPreset}
        />
      }
    >
      <div className="doc-frame">
        <PdfViewer
          src={FORM_SAMPLE}
          defaultSidebarOpen
          style={PRESETS[preset] as CSSProperties}
        />
      </div>
    </Example>
  );
}
