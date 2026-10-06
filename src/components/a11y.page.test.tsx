/*
 * FR-45 on the page path: the audit run over `PdfPage` itself, with the engine's own text layer in it.
 *
 * The shell audit (`a11y.audit.test.tsx`) still mounts the chrome only. It used to be blocked: a document that is
 * `ready` puts `PdfPage` on screen and `PdfPage` wanted a page proxy the harness had never been able to invent —
 * that was `#175`, and it is closed: the proxy below is now what `ViewerLayout.ready.test.tsx` hands the *whole*
 * shell under jsdom. What remains un-done is narrower than the old sentence: nobody has pointed axe at that ready
 * mount yet, so the page subtree is audited here, one page at a time, rather than through the composed viewer. What is *not* real in this file is the engine's annotation and
 * structure markup, both faked by the page proxy they are handed — the first answers no annotations, the
 * second is the element `FakeBuilder` builds — so their accessibility belongs to the browser pass that
 * mounted the true ones and to the `0.12` matrix.
 */
import { act, cleanup, render, waitFor } from '@testing-library/react';
import { runAudit, violationList } from './axe-audit-harness';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PDFDocumentProxy, PDFPageProxy } from 'pdfjs-dist';
import { PdfPage } from './PdfPage';
import { createPdfLinkService } from '../lib/link-service';
import type { PageMatch } from '../lib/search';

// The words the page carries, in the shape the worker sends them: one line, two items.
const TEXT_ITEMS = [
  {
    str: 'Revenue',
    transform: [1, 0, 0, 1, 72, 700],
    width: 60,
    height: 12,
    fontName: 'g_d0_f1',
    dir: 'ltr',
  },
  {
    str: 'rose 12 percent',
    transform: [1, 0, 0, 1, 140, 700],
    width: 90,
    height: 12,
    fontName: 'g_d0_f1',
    dir: 'ltr',
  },
];

const TEXT_STYLES = {
  g_d0_f1: { fontFamily: 'sans-serif', ascent: 0.8, descent: 0.2, vertical: false },
};

function fakePage(): PDFPageProxy {
  return {
    rotate: 0,
    isPureXfa: false,
    filterFactory: {},
    imageResources: {},
    getViewport: ({ scale = 1 }: { scale?: number }) => ({
      width: 612 * scale,
      height: 792 * scale,
      scale,
      rotation: 0,
      rawDims: { pageWidth: 612, pageHeight: 792, pageX: 0, pageY: 0 },
      clone: function clone() {
        return this;
      },
      convertToViewportPoint: (x: number, y: number) => [x, 792 - y],
    }),
    render: () => ({ promise: Promise.resolve(), cancel: vi.fn() }),
    /*
     * The engine hands the text layer a `ReadableStream` of `{items, styles}` chunks, not a promise of a
     * finished list — the constructor wraps anything else it is given and the reader then iterates nothing.
     * One chunk is enough: the layer is built, the spans exist, and the marks have words to sit on.
     */
    streamTextContent: () =>
      new ReadableStream({
        start(controller) {
          controller.enqueue({ items: TEXT_ITEMS, styles: TEXT_STYLES });
          controller.close();
        },
      }),
    getAnnotations: async () => [],
    getOperatorList: async () => ({ promise: Promise.resolve() }),
    getXfa: async () => null,
  } as unknown as PDFPageProxy;
}

const doc = {
  getPage: async () => fakePage(),
  cachedDict: 1,
  isPureXfa: false,
} as unknown as PDFDocumentProxy;

/*
 * jsdom's `getContext('2d')` returns `null`, and the text layer's measurement helper puts that straight
 * into a `WeakMap`, so the page dies on `TypeError: Invalid value used as weak map key` before one span is
 * built. The stub below is what the engine asks of a context and nothing more — `font`, which it writes,
 * and `measureText`, which it reads — and the widths it reports are a 6px monospace, because the text layer
 * is here to be audited for structure, not for the geometry a real font would give it.
 */
const realGetContext = HTMLCanvasElement.prototype.getContext;
HTMLCanvasElement.prototype.getContext = function patched(
  this: HTMLCanvasElement,
  kind: string,
  ...rest: unknown[]
) {
  const context = (realGetContext as GetContextType).apply(this, [kind, ...rest] as never);
  if (context || kind !== '2d') return context;
  return {
    canvas: this,
    font: '',
    measureText: (text: string) => ({ width: text.length * 6 }),
  };
} as typeof HTMLCanvasElement.prototype.getContext;

type GetContextType = typeof HTMLCanvasElement.prototype.getContext;

const match = (beginIdx: number, endIdx: number, beginOffset: number, endOffset: number): PageMatch => ({
  pageIndex: 2,
  beginIdx,
  endIdx,
  beginOffset,
  endOffset,
});

afterEach(cleanup);

/** The page on screen, with a search that found one word and the reader sitting on the second hit. */
function mountPage() {
  return render(
    <div className="pjsr-viewer">
      <div className="pjsr-viewport">
        <PdfPage
          doc={doc}
          pageNumber={3}
          scale={1}
          linkService={createPdfLinkService()}
          highlights={[match(0, 0, 0, 7), match(1, 1, 5, 12)]}
          activeHighlight={1}
        />
      </div>
    </div>,
  );
}

// Serialised through the harness: #216's failure was not a violation, it was an audit that lost its CPU and
// left axe-core's run lock set for every audit behind it.
async function audit(node: Element) {
  const { violations, passes } = await runAudit(node);
  expect(passes.length, 'the page rendered nothing').toBeGreaterThan(0);
  return violationList({ violations });
}

describe('the page, audited', () => {
  it('paints a text layer before it is judged', async () => {
    const { container } = mountPage();
    // The engine builds its spans on its own schedule, the page marks them once the layer has settled, and
    // the audit is only worth running on the result of both.
    await waitFor(() => {
      expect(container.querySelectorAll('.pjsr-text-layer span').length).toBeGreaterThan(0);
      expect(container.querySelectorAll('mark')).toHaveLength(2);
    });
    expect(await audit(container)).toEqual([]);
  });

  /*
   * The two channels FR-44 added, asserted on the element the page built rather than on a copy of it: a
   * word that matched, and among them the one the reader is on, said in the tree as well as in the tint.
   */
  it('says which match is the current one in the tree, not only in the paint', async () => {
    const { container } = mountPage();
    await waitFor(() => {
      expect(container.querySelectorAll('mark').length).toBe(2);
    });

    const marks = [...container.querySelectorAll('mark')];
    expect(marks.map((mark) => mark.className)).toEqual([
      'pjsr-mark',
      'pjsr-mark pjsr-mark--active',
    ]);
    expect(marks.map((mark) => mark.getAttribute('aria-current'))).toEqual([null, 'true']);
  });
});
