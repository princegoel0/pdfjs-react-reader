import { beforeAll, describe, expect, it, vi } from 'vitest';
import { fireEvent, render } from '@testing-library/react';
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

function pageBox(currentPage: number, numPages: number) {
  const onPageChange = vi.fn();
  const { container } = render(
    <LabelsContext.Provider value={DEFAULT_LABELS}>
      <Toolbar
        currentPage={currentPage}
        numPages={numPages}
        scaleMode="fit-width"
        resolvedScale={1}
        onPageChange={onPageChange}
        onScaleModeChange={vi.fn()}
      />
    </LabelsContext.Provider>,
  );
  return { input: container.querySelector<HTMLInputElement>('.pjsr-page-input'), onPageChange };
}

describe('Toolbar page box', () => {
  it('asks for a page the document has', () => {
    const { input, onPageChange } = pageBox(3, 14);
    if (!input) throw new Error('no page box rendered');
    fireEvent.change(input, { target: { value: '9' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onPageChange).toHaveBeenCalledWith(9);
    expect(input.value).toBe('9');
  });

  // The scroll clamps on its own, so `currentPage` never moves to a page past the end
  // and the effect that mirrors it into the box never runs. Only the box can correct.
  it('writes the page it went to when the typed one is past the end', () => {
    const { input, onPageChange } = pageBox(3, 14);
    if (!input) throw new Error('no page box rendered');
    fireEvent.change(input, { target: { value: '1000' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onPageChange).toHaveBeenCalledWith(14);
    expect(input.value).toBe('14');
  });

  it('returns to the page in view when the box holds nothing parseable', () => {
    const { input, onPageChange } = pageBox(3, 14);
    if (!input) throw new Error('no page box rendered');
    fireEvent.change(input, { target: { value: '—' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onPageChange).not.toHaveBeenCalled();
    expect(input.value).toBe('3');
  });
});
