/**
 * FR-57 / §6.1's floor, on the component that has to honour it.
 *
 * "The renderer lowers scale toward this value before it gives up; a page that cannot be
 * represented at or above it is refused with `RESOURCE_LIMIT`." The half that is easy to get
 * backwards is *who* gives up: `resolveRenderScale` can only report that the page does not fit,
 * and `PdfPage` is the one that decides not to paint. Painting anyway is the failure this clause
 * exists to prevent — the canvas comes back blank, the text layer is laid out over it as though
 * it had content, and the reader finds out by selecting a word that is not where it looks.
 *
 * So the assertions are the absence of a paint, the coded error with the numbers a host needs,
 * and the §3.5 page state that makes the absence visible in the UI rather than silent.
 */
import { cleanup, render, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PDFDocumentProxy, PDFPageProxy } from 'pdfjs-dist';
import { PdfPage } from './PdfPage';
import { createPdfLinkService } from '../lib/link-service';
import { isPdfError } from '../lib/errors';
import { MIN_RENDER_SCALE } from '../lib/canvas';
import type { PdfPageStatus } from '../lib/status';

vi.mock('pdfjs-dist', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  TextLayer: class {
    textDivs: HTMLElement[] = [];
    render(): Promise<void> {
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

afterEach(cleanup);

/**
 * A 200 × 260 pt page that counts its paints.
 *
 * `render` records rather than throwing, so "never painted" is an assertion about the component
 * and not about a fake that would have failed the test for its own reasons.
 */
function fakePage(paints: number[]): PDFPageProxy {
  const box = { width: 200, height: 260 };
  return {
    rotate: 0,
    isPureXfa: false,
    filterFactory: {},
    getViewport: () => ({ ...box, clone: () => ({ ...box }) }),
    render: () => {
      paints.push(1);
      return { promise: Promise.resolve(), cancel: vi.fn() };
    },
    streamTextContent: () => Promise.resolve({ items: [] }),
    getAnnotations: async () => [],
    getXfa: async () => null,
  } as unknown as PDFPageProxy;
}

function mount(over: { maxRenderPixels?: number; maxRenderSide?: number }) {
  const paints: number[] = [];
  const page = fakePage(paints);
  const doc = { getPage: async () => page } as unknown as PDFDocumentProxy;
  const errors: unknown[] = [];
  const reported: PdfPageStatus[] = [];
  render(
    <PdfPage
      doc={doc}
      pageNumber={7}
      scale={1}
      linkService={createPdfLinkService()}
      devicePixelRatio={2}
      {...(over.maxRenderPixels === undefined ? null : { maxRenderPixels: over.maxRenderPixels })}
      {...(over.maxRenderSide === undefined ? null : { maxRenderSide: over.maxRenderSide })}
      onError={(error) => errors.push(error)}
      onStatusChange={(_page, status) => {
        if (reported.at(-1) !== status) reported.push(status);
      }}
    />,
  );
  return { paints, errors, reported };
}

describe('a page that cannot be painted at the minimum scale is refused (FR-57)', () => {
  it('reports RESOURCE_LIMIT and never paints', async () => {
    // 200 × 260 at 2× needs 104 000 device px; a 3 000 px budget wants a scale of 0.17.
    const view = mount({ maxRenderPixels: 3_000 });
    await waitFor(() => expect(view.errors).toHaveLength(1));
    const error = view.errors[0];
    expect(isPdfError(error, 'RESOURCE_LIMIT')).toBe(true);
    expect((error as { details?: Record<string, unknown> }).details).toMatchObject({
      page: 7,
      width: 200,
      height: 260,
      maxPixels: 3_000,
      minScale: MIN_RENDER_SCALE,
    });
    // The clause in one line: the page was refused, not painted badly.
    expect(view.paints).toEqual([]);
  });

  it('reaches the §3.5 error state, so the refusal is something a reader is shown', async () => {
    const view = mount({ maxRenderPixels: 3_000 });
    await waitFor(() => expect(view.reported).toContain('error'));
    expect(view.reported).not.toContain('rendering');
    expect(view.reported).not.toContain('rendered');
  });

  it('paints the same page when the budget can hold it, so the refusal is the budget’s doing', async () => {
    const view = mount({ maxRenderPixels: 1_000_000 });
    await waitFor(() => expect(view.paints).toHaveLength(1));
    expect(view.errors).toEqual([]);
  });

  it('refuses on a side ceiling as well as an area one', async () => {
    // The other §6.1 candidate: a host that caps a side below what 0.25 of the page needs.
    const view = mount({ maxRenderSide: 40 });
    await waitFor(() => expect(view.errors).toHaveLength(1));
    expect(isPdfError(view.errors[0], 'RESOURCE_LIMIT')).toBe(true);
    expect((view.errors[0] as { details?: Record<string, unknown> }).details?.maxSide).toBe(40);
    expect(view.paints).toEqual([]);
  });
});
