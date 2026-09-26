import { beforeAll, describe, expect, it, vi } from 'vitest';
import { render } from '@testing-library/react';
import { DEFAULT_LABELS, type PdfViewerLabels } from '../lib/labels';
import { LabelsContext } from './labels-context';
import { Toolbar, INK_WIDTHS } from './Toolbar';

// The bar measures its own overflow with two ResizeObservers and jsdom has none.
class ObserverStub {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}
beforeAll(() => {
  globalThis.ResizeObserver = ObserverStub as unknown as typeof ResizeObserver;
});

// Every key replaced by its own name: any string the bar renders from a literal
// instead of the catalog shows up as English inside this, which is the bug the
// file exists to catch.
const CATALOG = Object.fromEntries(
  Object.keys(DEFAULT_LABELS).map((key) => [key, `[${key}]`]),
) as unknown as PdfViewerLabels;

function bar(labels: PdfViewerLabels) {
  return render(
    <LabelsContext.Provider value={labels}>
      <Toolbar
        currentPage={3}
        numPages={14}
        scaleMode="fit-width"
        resolvedScale={1}
        onPageChange={vi.fn()}
        onScaleModeChange={vi.fn()}
        drawMode
        inkSettings={{ color: '#d92d20', width: 3 }}
        onInkSettingsChange={vi.fn()}
        onInkUndo={vi.fn()}
        onInkClear={vi.fn()}
      />
    </LabelsContext.Provider>,
  );
}

describe('Toolbar labels', () => {
  it('words the pen widths from the catalog, not from INK_WIDTHS', () => {
    const { container } = bar(CATALOG);
    const widths = container.querySelector('select[aria-label="[penWidth]"]');
    expect([...(widths?.querySelectorAll('option') ?? [])].map((o) => o.textContent)).toEqual(
      INK_WIDTHS.map((option) => `[${option.labelKey}]`),
    );
  });

  it('renders the ink clear button from the catalog', () => {
    const { container } = bar(CATALOG);
    const clear = container.querySelector('button[aria-label="[clearAllDrawings]"]');
    expect(clear?.textContent).toBe('[clearLabel]');
  });

  it('takes the page counter from the catalog too', () => {
    const { container } = bar(CATALOG);
    expect(container.querySelector('.pjsr-page-count')?.textContent).toBe('[pageCountOf]');
  });

  it('keeps its own English defaults', () => {
    const { container } = bar(DEFAULT_LABELS);
    expect(container.querySelector('.pjsr-page-count')?.textContent).toBe('of 14');
    const widths = container.querySelector('select[aria-label="Pen width"]');
    expect([...(widths?.querySelectorAll('option') ?? [])].map((o) => o.textContent)).toEqual([
      'Thin',
      'Medium',
      'Thick',
    ]);
  });
});
