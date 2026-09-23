import { useState } from 'react';
import type { CSSProperties } from 'react';
import { PdfPage, usePdfDocument, usePdfVirtualizer, type ScaleMode } from 'pdfjs-react-reader';
import { Example } from '../components/Example';
import { OUTLINE_SAMPLE } from '../fixtures';
import source from './HeadlessExample.tsx?raw';

const chrome: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  padding: '8px 10px',
  background: '#1b1f2a',
  color: '#e6e9f0',
  fontSize: 13,
};

const button: CSSProperties = {
  padding: '4px 10px',
  border: '1px solid #3a4152',
  borderRadius: 6,
  background: '#242a38',
  color: '#e6e9f0',
  font: 'inherit',
  cursor: 'pointer',
};

const pageShadow: CSSProperties = {
  boxShadow: '0 2px 6px rgba(0,0,0,.45)',
  background: '#fff',
};

const SCALES = ['fit-width', '1', '1.25', '1.5', '2'];

/**
 * No `Toolbar`, no `Sidebar`, none of the shell's CSS classes: this is the same
 * document rendered from `usePdfDocument` + `usePdfVirtualizer` + `PdfPage`,
 * with a dark control bar that belongs entirely to the host.
 */
export function HeadlessExample() {
  const { doc, numPages, error } = usePdfDocument({ src: OUTLINE_SAMPLE });
  const [scale, setScale] = useState<ScaleMode>('fit-width');
  const {
    containerRef,
    virtualSlots,
    totalHeight,
    currentPage,
    resolvedScale,
    scrollToPage,
    reportPageDims,
  } = usePdfVirtualizer({ doc, numPages, scale, gap: 10 });

  return (
    <Example title="Custom UI from the headless hooks" source={source}>
      <div style={{ border: '1px solid #d4d7de', borderRadius: 10, overflow: 'hidden' }}>
        <div style={chrome}>
          <button type="button" style={button} onClick={() => scrollToPage(Math.max(1, currentPage - 1))}>
            Prev
          </button>
          <span style={{ fontVariantNumeric: 'tabular-nums' }}>
            {currentPage} / {numPages || '—'}
          </span>
          <button
            type="button"
            style={button}
            onClick={() => scrollToPage(Math.min(numPages || 1, currentPage + 1))}
          >
            Next
          </button>
          <select
            style={{ ...button, marginLeft: 'auto' }}
            aria-label="Zoom"
            value={typeof scale === 'number' ? String(scale) : scale}
            onChange={(e) =>
              setScale(e.target.value === 'fit-width' ? 'fit-width' : Number(e.target.value))
            }
          >
            {SCALES.map((value) => (
              <option key={value} value={value}>
                {value === 'fit-width' ? 'Fit width' : `${Math.round(Number(value) * 100)}%`}
              </option>
            ))}
          </select>
          <span style={{ fontVariantNumeric: 'tabular-nums' }}>
            {Math.round(resolvedScale * 100)}%
          </span>
        </div>
        <div
          ref={containerRef}
          style={{ position: 'relative', height: 380, overflow: 'auto', background: '#2a2f3c' }}
        >
          {error && <p style={{ color: '#ffb4a8', padding: 12 }}>{error.message}</p>}
          {doc && (
            <div style={{ position: 'relative', height: totalHeight }}>
              {virtualSlots.map((slot) => (
                <div
                  key={slot.indices[0]}
                  style={{
                    position: 'absolute',
                    top: 0,
                    left: '50%',
                    transform: `translate(-50%, ${slot.offsetTop}px)`,
                    display: 'flex',
                    gap: 10,
                  }}
                >
                  {slot.indices.map((index) => (
                    <div key={index} style={pageShadow}>
                      <PdfPage
                        doc={doc}
                        pageNumber={index + 1}
                        scale={resolvedScale}
                        onBaseDimensions={reportPageDims}
                      />
                    </div>
                  ))}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </Example>
  );
}
