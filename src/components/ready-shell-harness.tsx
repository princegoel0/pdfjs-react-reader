/*
 * The ready-document shell, mounted under jsdom: the harness #175 needed, and the one #247 reuses.
 *
 * Every other shell mount in this repository hands the controller `doc: null, isReady: false`. That is why two
 * legs of FR-28 went unasserted (the keyboard affordance could only be shown to *claim* a page change), and why
 * FR-45's audit had never seen a page: the populated toolbar, the mounted slots, the thumbnail list and the
 * engine's own layer markup exist only once a document has finished loading.
 *
 * Four jsdom answers make that mountable, and each one is here because the shell genuinely asks for it:
 *
 *  - no `ResizeObserver`, and the shell measures its viewport with one. The stub has to *report*:
 *    `ThumbnailList.tsx:30` and the toolbar's sizer both read `entries[0].contentRect.width`, so an observer
 *    that never calls back leaves every fit mode holding its last scale and the thumbnail grid without a width;
 *  - no `IntersectionObserver`, and `PdfThumbnail.tsx:75` builds one per card. Whether it reports is not
 *    load-bearing here — the cards this mounts are listed by the list, and the observer only decides when one
 *    paints, which is shown by this stub never reporting and the mount still working;
 *  - `clientWidth`/`clientHeight` are 0, `scrollTop` goes nowhere and `scrollTo` is unimplemented, so the
 *    virtualizer's loop — write a scroll position, read it back on the next frame — never turns;
 *  - `scrollIntoView` does not exist at all (`ThumbnailList.tsx:45`, `PdfPage.tsx:1029` call it).
 *
 * A fifth answer is here for the ⋯ panel only, and it is off by default: the fold planner reads each sizer
 * child's `offsetWidth`, jsdom answers 0 for every element, and ten zero-width controls always fit a bar, so
 * `plan.showMenu` is false no matter what the viewport says. `readyFold.itemWidth` puts a real number behind
 * that one property so the panel can exist under jsdom at all — see `a11y.ready.test.tsx`, which audits it.
 *
 * The fake document is in `ready-fake-document.ts`, not here, and that split is load-bearing: a `vi.mock`
 * factory that imports this module asks for the mocked hook in the middle of being asked to produce it, and the
 * test run stops at collection without an error. The mount helper needs the components; the factory must not.
 */
import { act, render } from '@testing-library/react';

import { useViewerController } from './ViewerController';
import { ViewerLayout } from './ViewerLayout';
import { ViewerProvider } from './ViewerContext';
import { DEFAULT_LABELS } from '../lib/labels';

export { NUM_PAGES, PAGE_HEIGHT, ROW_PITCH, fakeReadyDocument, readyLoadResult } from './ready-fake-document';

/** The scroll box the virtualizer writes and reads back; `resetReadyShell` puts it away between cases. */
export const readyScroll = { top: 0 };

/** The box every measurement answers with, for the cases that need a narrow bar instead of a wide one. */
export const readyViewport = { width: 800, height: 600 };

/** `0` leaves jsdom's own answer in place, which folds nothing; see the header's fifth bullet. */
export const readyFold = { itemWidth: 0 };

class ReportingObserver {
  private targets = new Set<Element>();
  constructor(private callback: ResizeObserverCallback) {}
  observe(element: Element) {
    this.targets.add(element);
    queueMicrotask(() => {
      if (!this.targets.has(element)) return;
      // A real entry, not an empty call: handing those measurements `undefined` throws outside the test's own
      // frames, so it surfaces as an unhandled error rather than as a failure. That is how this was found.
      const entry = {
        target: element,
        contentRect: {
          width: readyViewport.width,
          height: readyViewport.height,
          top: 0,
          left: 0,
          right: readyViewport.width,
          bottom: readyViewport.height,
        },
        borderBoxSize: [{ inlineSize: readyViewport.width, blockSize: readyViewport.height }],
        contentBoxSize: [{ inlineSize: readyViewport.width, blockSize: readyViewport.height }],
        devicePixelContentBoxSize: [{ inlineSize: readyViewport.width, blockSize: readyViewport.height }],
      } as unknown as ResizeObserverEntry;
      this.callback([entry], this as unknown as ResizeObserver);
    });
  }
  unobserve(element: Element) {
    this.targets.delete(element);
  }
  disconnect() {
    this.targets.clear();
  }
}

class IdleObserver {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
  takeRecords(): IntersectionObserverEntry[] {
    return [];
  }
}

const realGetContext = HTMLCanvasElement.prototype.getContext;

/** The answers above, installed. Called at module scope by every file that mounts the ready shell. */
export function installReadyShellJsdom(): void {
  globalThis.ResizeObserver = ReportingObserver as unknown as typeof ResizeObserver;
  globalThis.IntersectionObserver = IdleObserver as unknown as typeof IntersectionObserver;
  Element.prototype.scrollIntoView = function scrollIntoView() {};
  Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable: true, get: () => readyViewport.width });
  Object.defineProperty(HTMLElement.prototype, 'clientHeight', {
    configurable: true,
    get: () => readyViewport.height,
  });
  Object.defineProperty(HTMLElement.prototype, 'scrollTop', {
    configurable: true,
    get: () => readyScroll.top,
    set(value: number) {
      readyScroll.top = value;
    },
  });
  // Only the sizer's own children, and only when a case asks for it: `offsetWidth` is what the fold planner
  // reads, and 0 for all of them is the reason jsdom never shows the ⋯ panel.
  Object.defineProperty(HTMLElement.prototype, 'offsetWidth', {
    configurable: true,
    get(this: HTMLElement) {
      return readyFold.itemWidth > 0 && this.dataset.pjsrItem ? readyFold.itemWidth : 0;
    },
  });
  Element.prototype.scrollTo = function scrollTo(this: Element, options?: ScrollToOptions | number) {
    this.scrollTop = typeof options === 'number' ? options : (options?.top ?? 0);
    this.dispatchEvent(new Event('scroll'));
  };
  HTMLCanvasElement.prototype.getContext = function patched(this: HTMLCanvasElement, kind: string, ...rest: unknown[]) {
    const context = realGetContext.apply(this, [kind, ...rest] as never);
    if (context || kind !== '2d') return context;
    // pdf.js's text layer keys a WeakMap off the context it was handed, so `null` throws inside the layer.
    return { canvas: this, font: '', measureText: (text: string) => ({ width: text.length * 6 }) };
  } as typeof HTMLCanvasElement.prototype.getContext;
}

export function resetReadyShell(): void {
  readyScroll.top = 0;
  readyViewport.width = 800;
  readyViewport.height = 600;
  readyFold.itemWidth = 0;
}

export interface ReadyShellOptions {
  enableKeyboardNavigation?: boolean;
  onPageChange?: (page: number) => void;
}

/** The shell as a host writes it, with the sidebar open so every part of it has something to say. */
export function mountReadyShell(options: ReadyShellOptions = {}) {
  /**
   * The controller is rebuilt on every render, so the instance captured at mount would never move — the reason
   * this hands back a getter rather than a value.
   */
  const live: { current: ReturnType<typeof useViewerController> | null } = { current: null };
  function Shell() {
    live.current = useViewerController({
      src: '/fixtures/outline-sample.pdf',
      labels: { ...DEFAULT_LABELS },
      defaultScale: 1,
      defaultSidebarOpen: true,
      ...options,
    });
    return (
      <ViewerProvider controller={live.current}>
        <ViewerLayout controller={live.current} />
      </ViewerProvider>
    );
  }
  let view: ReturnType<typeof render> | null = null;
  act(() => {
    view = render(<Shell />);
  });
  if (!live.current) throw new Error('the shell never built its controller');
  return { view: view!, controller: () => live.current! };
}

/** Whatever the chrome currently says about where the reader is. */
export function shellChrome(view: ReturnType<typeof render>) {
  const container = view.container;
  return {
    slots: container.querySelectorAll('.pjsr-page-slot').length,
    pages: container.querySelectorAll('.pjsr-page').length,
    pageInput: container.querySelector<HTMLInputElement>('.pjsr-page-input')?.value,
    count: container.querySelector('.pjsr-page-count')?.textContent?.trim(),
    thumbnails: container.querySelectorAll('.pjsr-thumbnail').length,
  };
}

export async function pressKeyIn(element: Element, key: string) {
  const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true });
  await act(async () => {
    element.dispatchEvent(event);
    await new Promise((resolve) => setTimeout(resolve, 50));
  });
  return event;
}
