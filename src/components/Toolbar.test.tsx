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

function pageBox(currentPage: number, numPages: number, pageLabels: readonly string[] | null = null) {
  const onPageChange = vi.fn();
  const { container } = render(
    <LabelsContext.Provider value={DEFAULT_LABELS}>
      <Toolbar
        currentPage={currentPage}
        numPages={numPages}
        pageLabels={pageLabels}
        scaleMode="fit-width"
        resolvedScale={1}
        onPageChange={onPageChange}
        onScaleModeChange={vi.fn()}
      />
    </LabelsContext.Provider>,
  );
  return { input: container.querySelector<HTMLInputElement>('.pjsr-page-input'), onPageChange };
}

/** What `playground/fixtures/labelled-sample.pdf` reports from `doc.getPageLabels()`. */
const LABELLED = ['i', 'ii', 'iii', '1', '2', '3', '4', '5', 'A-1', 'A-2'];

describe('Toolbar page box with labels (FR-12)', () => {
  it('shows the label of the page in view rather than its index', () => {
    const { input } = pageBox(3, 10, LABELLED);
    expect(input?.value).toBe('iii');
  });

  /*
   * `type="number"` reads "xii" as the empty string, so a labelled document has to be given a text box —
   * and an ordinary one must keep its spinner and its numeric keyboard, which is why the control follows the
   * document instead of being text always. The identity table is the test of that: it is a real
   * `/PageLabels` answer, and it changes nothing.
   */
  it('changes the control only when the labels differ from the numbers', () => {
    const labelled = pageBox(3, 10, LABELLED);
    expect(labelled.input?.type).toBe('text');
    expect(labelled.input?.getAttribute('data-labelled')).toBe('true');
    expect(labelled.input?.getAttribute('max')).toBeNull();

    const ordinary = pageBox(3, 14, Array.from({ length: 14 }, (_, i) => String(i + 1)));
    expect(ordinary.input?.type).toBe('number');
    expect(ordinary.input?.getAttribute('data-labelled')).toBeNull();
    expect(ordinary.input?.getAttribute('max')).toBe('14');
    expect(ordinary.input?.value).toBe('3');
  });

  it('navigates by the label a reader types, including the one that looks like a number', () => {
    const typed = (value: string) => {
      const box = pageBox(1, 10, LABELLED);
      if (!box.input) throw new Error('no page box rendered');
      fireEvent.change(box.input, { target: { value } });
      fireEvent.keyDown(box.input, { key: 'Enter' });
      return box;
    };

    expect(typed('ii').onPageChange).toHaveBeenCalledWith(2);
    expect(typed('A-1').onPageChange).toHaveBeenCalledWith(9);
    // Page 6 of this document is labelled "2", so "2" means the fifth page — what the reader was looking at.
    const two = typed('2');
    expect(two.onPageChange).toHaveBeenCalledWith(5);
    expect(two.input?.value).toBe('2');
  });

  it('writes the label of the page it clamped to', () => {
    const { input, onPageChange } = pageBox(3, 10, LABELLED);
    if (!input) throw new Error('no page box rendered');
    fireEvent.change(input, { target: { value: '999' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onPageChange).toHaveBeenCalledWith(10);
    expect(input.value).toBe('A-2');
  });

  it('puts the page in view back when the box names no page', () => {
    const { input, onPageChange } = pageBox(3, 10, LABELLED);
    if (!input) throw new Error('no page box rendered');
    // "xii" is a plausible label and this document has no fourth front-matter page.
    fireEvent.change(input, { target: { value: 'xii' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onPageChange).not.toHaveBeenCalled();
    expect(input.value).toBe('iii');
  });

  it('keeps a document that labels nothing on the rule it has always had', () => {
    const { input, onPageChange } = pageBox(3, 14, null);
    if (!input) throw new Error('no page box rendered');
    fireEvent.change(input, { target: { value: '9' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onPageChange).toHaveBeenCalledWith(9);
    expect(input.value).toBe('9');
  });
});

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
