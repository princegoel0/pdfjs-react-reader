/*
 * FR-12's seam: the controller's label table has to arrive in the bar the reader types into.
 *
 * The two halves either side of this are covered elsewhere — `labelled.test.ts` proves the engine reports
 * the table for `labelled-sample.pdf`, `usePdfPageLabels.test.tsx` proves the hook asks and publishes it —
 * and the middle link, `ViewerParts` handing `pageLabels` to `Toolbar`, is the one a rename or a dropped
 * prop would break quietly, with every other file still green. The other half of the controller's wiring
 * (its `pageLabels` field) is not tested here because it cannot be wrong without the type checker saying
 * so: the published interface declares the field, so the returned object has to carry it.
 *
 * So the bar is mounted against a stub controller rather than the real one, and that is a measured limit and
 * not a shortcut: mounting `useViewerController` with a *ready* document hangs this harness outright (the
 * virtualizer is handed a scroll container that never reports a size, and no test in the repository has
 * ever mounted the shell's page path under jsdom — which is its own finding about how much of the shell is
 * browser-only evidence, filed for `#148`). What labels have to do with that is nothing: the page area does
 * not read the table.
 */
import { fireEvent, render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { ScaleMode } from '../lib/layout';
import type { ViewerController } from './ViewerController';
import { ViewerProvider } from './ViewerContext';
import { ViewerToolbar } from './ViewerParts';

/** What `labelled-sample.pdf` reports from `doc.getPageLabels()`. */
const LABELS = ['i', 'ii', 'iii', '1', '2', '3', '4', '5', 'A-1', 'A-2'];

class ObserverStub {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}
globalThis.ResizeObserver = ObserverStub as unknown as typeof ResizeObserver;

function stubController(overrides: Partial<ViewerController> = {}): ViewerController {
  const scrollToPage = vi.fn();
  const base = {
    currentPage: 1,
    numPages: LABELS.length,
    pageLabels: LABELS,
    scaleMode: 1 satisfies ScaleMode,
    resolvedScale: 1,
    scrollToPage,
    setScaleMode: vi.fn(),
    searchOpen: false,
    setSearchOpen: vi.fn(),
    search: { query: '', results: [], activeIndex: -1 },
    sidebarOpen: false,
    setSidebarOpen: vi.fn(),
    pageLayout: 'continuous',
    setPageLayout: vi.fn(),
    rotate: vi.fn(),
    rotatePage: vi.fn(),
    docLabel: 'labelled-sample',
    zoomLabel: '100 %',
    featureItems: [],
    controls: {},
    fsAvailable: false,
    toggleFullscreen: vi.fn(),
    isFullscreen: false,
  };
  return { ...base, ...overrides, scrollToPage } as unknown as ViewerController;
}

function barWith(controller: ViewerController) {
  render(
    <ViewerProvider controller={controller}>
      <ViewerToolbar />
    </ViewerProvider>,
  );
  const input = document.querySelector<HTMLInputElement>('.pjsr-page-input');
  if (!input) throw new Error('the bar rendered no page box');
  return { input, scrollToPage: controller.scrollToPage };
}

describe('the bar around a labelled document', () => {
  it('names the page in the box, in a control that can hold a name', () => {
    const { input } = barWith(stubController());
    expect(input.value).toBe('i');
    expect(input.type).toBe('text');
    expect(input.getAttribute('data-labelled')).toBe('true');
  });

  it('turns a typed label into the page wearing it, and asks the scroll for it', () => {
    const { input, scrollToPage } = barWith(stubController());
    fireEvent.change(input, { target: { value: 'A-1' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(scrollToPage).toHaveBeenCalledWith(9);

    // The number that means something else in this document: page 6 is labelled "2".
    fireEvent.change(input, { target: { value: '2' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(scrollToPage).toHaveBeenLastCalledWith(5);
  });

  it('puts the current page back when the value names nothing', () => {
    const { input, scrollToPage } = barWith(stubController());
    fireEvent.change(input, { target: { value: 'xiv' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(scrollToPage).not.toHaveBeenCalled();
    expect(input.value).toBe('i');
  });

  it('keeps a plain number box for a document with no table', () => {
    const { input } = barWith(stubController({ pageLabels: null }));
    expect(input.type).toBe('number');
    expect(input.getAttribute('data-labelled')).toBeNull();
    expect(input.value).toBe('1');

    fireEvent.change(input, { target: { value: '999' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(input.value).toBe('10');
  });

  it('keeps a plain number box when the table is only the numbers', () => {
    const { input } = barWith(stubController({ pageLabels: ['1', '2', '3', '4', '5', '6', '7', '8', '9', '10'] }));
    expect(input.type).toBe('number');
    expect(input.value).toBe('1');
  });

  /*
   * The other direction, which the browser pass cannot show: the in-app tab is `hidden`, so
   * `requestAnimationFrame` never runs and the virtualizer never re-derives the page in view — the scroll
   * itself lands (page 9's label resolved to page 9's offset, 8 × 720 px), but nothing downstream of the
   * frame ticker moves. So the page → box half is asserted here instead.
   */
  it('renames the page the reader moved to', () => {
    const view = render(
      <ViewerProvider controller={stubController()}>
        <ViewerToolbar />
      </ViewerProvider>,
    );
    expect(document.querySelector<HTMLInputElement>('.pjsr-page-input')?.value).toBe('i');

    const moveTo = (currentPage: number) =>
      view.rerender(
        <ViewerProvider controller={stubController({ currentPage })}>
          <ViewerToolbar />
        </ViewerProvider>,
      );

    moveTo(9);
    expect(document.querySelector<HTMLInputElement>('.pjsr-page-input')?.value).toBe('A-1');
    moveTo(5);
    expect(document.querySelector<HTMLInputElement>('.pjsr-page-input')?.value).toBe('2');
  });
});
