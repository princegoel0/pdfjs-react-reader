/*
 * FR-14's last clause: "scroll the active match into view", and only for a navigation the reader asked for.
 *
 * The first two clauses are guarded in `src/lib/highlight.test.tsx` — `mark` nodes, and the active one
 * distinguished by class, ring hook and `aria-current` together. What was unguarded is the page-level call
 * that makes the third one real: `PdfPage.tsx:1020-1022` asks the browser to centre `.pjsr-mark--active`,
 * and every shell test replaces `scrollIntoView` with a no-op (`ViewerParts.composed.test.tsx:49`), so
 * deleting the call left the suite green. A search that reports "3 of 20" while the third match is forty
 * screens away is a search the reader cannot use, and the counter is not the feedback.
 *
 * The window is part of the claim, not an implementation detail. Matches reach a page long after the
 * request that asked for them — the walk is incremental and a page can be mounted by scrolling into the
 * range — and centring the active mark then would yank the reader to the top of a document they had
 * scrolled away from. So a fresh navigation stamp is what unlocks the scroll, the stamp is spent once, and
 * a mark applied without one does not move the page at all. Each of those three is a separate test below,
 * because each is a separate way to be wrong.
 */
import { act, cleanup, render, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PDFDocumentProxy, PDFPageProxy } from 'pdfjs-dist';
import { PdfPage } from './PdfPage';
import { createPdfLinkService } from '../lib/link-service';
import type { PageMatch } from '../lib/search';

/** Every `scrollIntoView` the page asked for, with the node that got it. */
const scrolls = vi.hoisted(() => [] as Array<{ node: string; options: unknown }>);

const SPANS = ['Revenue rose 12 percent', 'and costs fell 3 percent', 'in the third quarter'];

const calls = vi.hoisted(() => ({ builds: 0 }));

vi.mock('pdfjs-dist', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  TextLayer: class {
    textDivs: HTMLElement[] = [];
    container: HTMLElement;

    constructor(params: { container: HTMLElement }) {
      calls.builds += 1;
      this.container = params.container;
    }

    render(): Promise<void> {
      // The divs the matcher indexes into, in the order it expects them: one per text item.
      const spans = SPANS.map((text) => {
        const span = document.createElement('span');
        span.textContent = text;
        return span;
      });
      this.textDivs = spans;
      this.container.replaceChildren(...spans);
      return Promise.resolve();
    }

    update(): void {}
    cancel(): void {}
  },
  AnnotationLayer: class {
    render(): Promise<void> {
      return Promise.resolve();
    }
    update(): void {}
    destroy(): void {}
  },
  DrawLayer: class {
    setParent(): void {}
    destroy(): void {}
  },
  AnnotationEditorLayer: class {
    render(): Promise<void> {
      return Promise.resolve();
    }
    destroy(): void {}
    update(): void {}
  },
  XfaLayer: { render: () => ({}), update: () => undefined },
}));

function fakePage(): PDFPageProxy {
  return {
    rotate: 0,
    isPureXfa: false,
    filterFactory: {},
    getViewport: ({ scale = 1 }: { scale?: number }) => ({
      width: 200 * scale,
      height: 260 * scale,
      clone: () => ({ width: 0, height: 0 }),
    }),
    render: () => ({ promise: Promise.resolve(), cancel: () => undefined }),
    streamTextContent: () => Promise.resolve({ items: SPANS.map((str) => ({ str })) }),
    getAnnotations: async () => [],
    getXfa: async () => null,
  } as unknown as PDFPageProxy;
}

const doc = {
  getPage: async () => fakePage(),
} as unknown as PDFDocumentProxy;

/** Two matches on this page; `active` says which of the two the reader is on. */
const MATCHES: PageMatch[] = [
  { pageIndex: 0, beginIdx: 0, endIdx: 0, beginOffset: 13, endOffset: 23 },
  { pageIndex: 0, beginIdx: 1, endIdx: 1, beginOffset: 15, endOffset: 24 },
];

function strip(highlights: PageMatch[], active: number, navigatedAt: number) {
  return (
    <PdfPage
      doc={doc}
      pageNumber={1}
      scale={1}
      rotation={0}
      linkService={createPdfLinkService()}
      onStatusChange={() => undefined}
      highlights={highlights}
      activeHighlight={active}
      navigateToActiveAt={navigatedAt}
    />
  );
}

/** Which node scrolled, as a name the assertions can read: 'active', 'plain' or 'not-a-mark'. */
function label(container: HTMLElement | null, mark: Element): string {
  if (!mark.classList.contains('pjsr-mark')) return 'not-a-mark';
  return mark === container?.querySelector('.pjsr-mark--active') ? 'active' : 'plain';
}

beforeEach(() => {
  scrolls.length = 0;
  calls.builds = 0;
  // jsdom has no layout, so it has no `scrollIntoView` either. Installed on the prototype so the test
  // sees the element the call was made *on*, which is the half of the clause under test.
  Element.prototype.scrollIntoView = function (options?: unknown) {
    scrolls.push({ node: label(document.body, this as Element), options });
  };
});

afterEach(() => {
  cleanup();
  delete (Element.prototype as unknown as { scrollIntoView?: unknown }).scrollIntoView;
});

describe('scrolling to the active match (FR-14)', () => {
  it('centres the active mark and no other, when the reader asked for it', async () => {
    const at = Date.now();
    const { container } = render(strip(MATCHES, 1, at));
    await waitFor(() => expect(scrolls.length).toBe(1));

    // The one element that moved is the one carrying the active class.
    expect(scrolls[0]?.node).toBe('active');
    expect(container.querySelectorAll('.pjsr-mark')).toHaveLength(2);
    expect(container.querySelector('.pjsr-mark--active')?.textContent).toBe('3 percent');
    // `block: 'center'` is the claim, not a detail: to the nearest edge would leave the mark under
    // the toolbar on a page scrolled just past it, which is where a reader usually is.
    expect(scrolls[0]?.options).toEqual({ block: 'center', behavior: 'auto' });
  });

  it('spends the navigation: the same request does not move the page twice', async () => {
    const at = Date.now();
    const { container, rerender } = render(strip(MATCHES, 1, at));
    await waitFor(() => expect(scrolls.length).toBe(1));

    // The same stamp, a new publish: the marks are re-applied (the walk keeps growing) and the reader
    // stays where they were put.
    rerender(strip(MATCHES, 1, at));
    await act(async () => undefined);
    await act(async () => undefined);
    expect(scrolls, 'a stamp already honoured is not a request').toHaveLength(1);

    // A fresh navigation is a fresh request, and it is honoured.
    rerender(strip(MATCHES, 0, Date.now() + 1));
    await waitFor(() => expect(scrolls.length).toBe(2));
    expect(scrolls[1]?.node).toBe('active');
    expect(container.querySelectorAll('.pjsr-mark')).toHaveLength(2);
  });

  it('leaves the page alone when the marks arrive without a navigation', async () => {
    // `navigateToActiveAt` defaults to 0: the page was mounted by scrolling into the match range, and
    // matches were applied to it. Centring then would pull the reader back to the middle of a page
    // they have already left.
    const { container } = render(strip(MATCHES, 1, 0));
    await act(async () => undefined);
    await act(async () => undefined);
    expect(container.querySelectorAll('.pjsr-mark')).toHaveLength(2);
    expect(scrolls, 'no navigation, no scroll').toHaveLength(0);
  });

  it('refuses a navigation the reader made long ago', async () => {
    // Older than the window the page holds a request open for: the answer arrived too late to be
    // what the reader was looking for, and moving the page now is a surprise rather than a service.
    const { container } = render(strip(MATCHES, 1, Date.now() - 5000));
    await act(async () => undefined);
    await act(async () => undefined);
    expect(container.querySelector('.pjsr-mark--active')).toBeTruthy();
    expect(scrolls, 'a stale request is not honoured with a jump').toHaveLength(0);
  });

  /*
   * The incremental walk publishes more than once for a single navigation — the first page, then every
   * 25 pages or 120 ms — and each publish re-runs this effect. Without the spent-stamp guard the reader
   * who pressed Enter, watched the page move, then scrolled away, gets pulled back to the middle of the
   * match list 120 ms later by an answer about a document they had already moved on from. The test that
   * found this (`counterfactual-t1b`, CF9) is why the guard is asserted rather than assumed: the marks
   * array has to be a *new* array, because a publish that changes nothing re-runs nothing.
   */
  it('moves the page once, even though one navigation publishes several times', async () => {
    const at = Date.now();
    const { rerender } = render(strip(MATCHES, 1, at));
    await waitFor(() => expect(scrolls.length).toBe(1));

    // The same request, the same matches — and a new array, which is what a publish hands the page.
    rerender(strip([...MATCHES], 1, at));
    await act(async () => undefined);
    await act(async () => undefined);
    rerender(strip([...MATCHES], 1, at));
    await act(async () => undefined);
    await act(async () => undefined);

    expect(scrolls, 'the second and third publish are not second and third requests').toHaveLength(1);
  });

  it('does not scroll when there is no active match to scroll to', async () => {
    const { container } = render(strip(MATCHES, -1, Date.now()));
    await act(async () => undefined);
    await act(async () => undefined);
    expect(container.querySelectorAll('.pjsr-mark')).toHaveLength(2);
    expect(container.querySelector('.pjsr-mark--active')).toBeNull();
    expect(scrolls).toHaveLength(0);
  });
});
