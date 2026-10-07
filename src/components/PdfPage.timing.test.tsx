/**
 * FR-49's seam in the paint path: the passes a page runs are timed, by name, so a benchmark can attribute work
 * to this layer from the load it is measuring instead of subtracting one page load from another.
 *
 * §6's profile C target is *"viewer main-thread work attributable to our layer under 200 ms; engine render time
 * reported separately"*. Until the seam existed the benchmark got that by subtracting two page loads — the
 * viewer's cold page in one browser context, an engine-only harness at the same box in another — and said so in
 * its own report line, because a difference between two runs is a weaker claim than a measurement of one. The
 * four passes `usePageProgress` already keeps for its own `rendered` join are the seam: `canvas` is the awaited
 * `page.render()`, and `text`, `annotations` and `xfa` are the engine's layer classes run from this package's
 * effects. Nothing new had to be invented to name them, which is the argument for marking them here: the same
 * boundaries that decide when a page may report `rendered` are the boundaries a benchmark reads.
 *
 * jsdom has no UserTiming — `performance.mark` is `undefined` there, which is why the whole suite runs today
 * without the seam doing anything — so the fake below is what proves the seam is *called* and closed, and
 * `npm run bench` is what proves it answers in a browser.
 *
 * **What this file's first version got wrong, and what that is worth remembering.** It accepted any `measure`
 * call. The seam then shared one boundary mark between two spans — the setup span's end was the engine span's
 * start — so closing the first cleared the name the second measured from, and Chromium threw *inside the render
 * promise*, which is this page's error path. jsdom stayed green the whole time. Two things came of it: the
 * split was cut rather than kept (the awaited paint and the overlay passes say what §6 asks without it), and
 * the fake now refuses a measure whose marks are not open, the way the browser does. The last two cases assert
 * that a refusal, real or forced, cannot reach a reader as a page failure. A fake that cannot say no cannot
 * catch anything.
 */
import { cleanup, render, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PDFDocumentProxy, PDFPageProxy } from 'pdfjs-dist';
import { PdfPage } from './PdfPage';
import { createPdfLinkService } from '../lib/link-service';
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
  XfaLayer: { render: () => ({}), update: () => undefined },
}));

/** A 200 × 260 page that records every time it is asked to paint. */
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

interface Recorded {
  ops: Array<{ op: 'mark' | 'measure' | 'clearMarks' | 'clearMeasures'; name: string; start?: string; end?: string }>;
  measures: Array<{ name: string; start: string; end: string }>;
  refused: string[];
}

/**
 * A `performance` that answers the way Chromium does: `measure(name, start, end)` refuses when either named
 * mark is not currently open. `refuse` forces a named span to be rejected even when its marks are there.
 */
function fakeTiming(options: { refuse?: string[] } = {}): { performance: Performance; log: Recorded } {
  const log: Recorded = { ops: [], measures: [], refused: [] };
  const open = new Set<string>();
  const push = (op: Recorded['ops'][number]) => log.ops.push(op);
  const performance = {
    now: () => 0,
    mark: (name: string) => {
      open.add(name);
      push({ op: 'mark', name });
    },
    measure: (name: string, start?: string, end?: string) => {
      push({ op: 'measure', name, start, end });
      if (options.refuse?.includes(name)) {
        log.refused.push(name);
        throw new Error(`Failed to execute 'measure' on 'Performance': the measure '${name}' cannot be created`);
      }
      if (!start || !end || !open.has(start) || !open.has(end)) {
        const missing = !start ? '(no start given)' : !end ? '(no end given)' : !open.has(start) ? start : end;
        log.refused.push(`${name} (missing ${missing})`);
        throw new Error(`Failed to execute 'measure' on 'Performance': the mark '${missing}' does not exist`);
      }
      log.measures.push({ name, start, end });
    },
    clearMarks: (name: string) => {
      open.delete(name);
      push({ op: 'clearMarks', name });
    },
    clearMeasures: (name: string) => push({ op: 'clearMeasures', name }),
  } as unknown as Performance;
  return { performance, log };
}

function element(page: PDFPageProxy, scale: number, onStatus?: (page: number, status: PdfPageStatus) => void) {
  const doc = { getPage: async () => page } as unknown as PDFDocumentProxy;
  return (
    <PdfPage
      doc={doc}
      pageNumber={7}
      scale={scale}
      linkService={createPdfLinkService()}
      devicePixelRatio={2}
      onError={() => undefined}
      {...(onStatus ? { onStatusChange: onStatus } : {})}
    />
  );
}

/** Mount page 7 with a recording `performance` installed, since the seam reads it through `globalThis`. */
function mount(page: PDFPageProxy, reported: PdfPageStatus[]) {
  const fake = fakeTiming();
  vi.stubGlobal('performance', fake.performance);
  const view = render(element(page, 1, (_p, status) => {
    if (reported.at(-1) !== status) reported.push(status);
  }));
  return { ...view, log: fake.log };
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('the paint path reports its passes by name (FR-49)', () => {
  it('names the awaited paint and the overlay layers, on the page that ran them', async () => {
    const paints: number[] = [];
    const { log } = mount(fakePage(paints), []);
    await waitFor(() => expect(paints).toHaveLength(1));
    await waitFor(() => expect(log.measures.map((m) => m.name)).toContain('pjsr:p7:canvas'));

    const names = log.measures.map((m) => m.name);
    expect(names, 'the awaited paint is the span §6 wants reported separately').toContain('pjsr:p7:canvas');
    expect(names, 'the text layer pass never closed').toContain('pjsr:p7:text');
    expect(names, 'the annotation layer pass never closed').toContain('pjsr:p7:annotations');
    for (const m of log.measures) {
      expect(m.name, `${m.name} does not say which page it belongs to`).toMatch(/^pjsr:p7:/);
    }
    expect(log.refused, `the seam asked UserTiming for something it had not marked: ${log.refused.join(', ')}`).toEqual([]);
  });

  it('leaves nothing behind: every span it measures it also discards', async () => {
    const paints: number[] = [];
    const { log } = mount(fakePage(paints), []);
    await waitFor(() => expect(paints).toHaveLength(1));
    await waitFor(() => expect(log.measures.length).toBeGreaterThan(0));
    for (const m of log.measures) {
      const cleared = (op: string, name: string) => log.ops.some((o) => o.op === op && o.name === name);
      expect(cleared('clearMeasures', m.name), `${m.name} was measured and never cleared, so the timeline grows per paint`).toBe(
        true,
      );
      expect(cleared('clearMarks', m.start), `${m.start} outlived its measure`).toBe(true);
      expect(cleared('clearMarks', m.end), `${m.end} outlived its measure`).toBe(true);
    }
  });

  it('discards a name before reusing it, which is what a scroll depends on', async () => {
    const paints: number[] = [];
    const page = fakePage(paints);
    const { log, rerender } = mount(page, []);
    await waitFor(() => expect(paints).toHaveLength(1));
    // A zoom step repaints the same page, so every mark name is reused. A start mark left behind by a paint
    // that was torn down mid-flight would otherwise lengthen the span that opens next.
    rerender(element(page, 2));
    await waitFor(() => expect(paints).toHaveLength(2));

    const name = 'pjsr:p7:canvas:start';
    const opened = log.ops.filter((o) => o.op === 'mark' && o.name === name).length;
    const clearedFirst = log.ops.filter((o) => o.op === 'clearMarks' && o.name === name).length;
    expect(opened, 'the canvas pass mark was never opened twice, so the rerender did not repaint').toBeGreaterThan(1);
    expect(clearedFirst, 'a span was opened without clearing its name first').toBeGreaterThanOrEqual(opened);
  });
});

describe('the seam is observation, not a decision (FR-49, FR-46)', () => {
  it('paints the page and reports no error when UserTiming refuses the measure', async () => {
    const paints: number[] = [];
    const reported: PdfPageStatus[] = [];
    const fake = fakeTiming({ refuse: ['pjsr:p7:canvas'] });
    vi.stubGlobal('performance', fake.performance);
    render(
      element(fakePage(paints), 1, (_p, status) => {
        if (reported.at(-1) !== status) reported.push(status);
      }),
    );
    await waitFor(() => expect(paints).toHaveLength(1));
    await waitFor(() => expect(reported).toContain('rendered'));
    expect(fake.log.refused.length, 'the fake refused nothing, so this case measured nothing').toBeGreaterThan(0);
    // The paint and its `rendered` state do not depend on the measurement: a browser that will not answer about
    // a span must not turn the page into an error. This is the assertion that the shared-mark bug needed.
  });

  it('paints the same page and reaches the same state where UserTiming does not exist', async () => {
    // jsdom's own answer: `performance` exists but has no `mark`, so both helpers fall through.
    vi.stubGlobal('performance', { now: () => 0 });
    const paints: number[] = [];
    const reported: PdfPageStatus[] = [];
    render(
      element(fakePage(paints), 1, (_p, status) => {
        if (reported.at(-1) !== status) reported.push(status);
      }),
    );
    await waitFor(() => expect(paints).toHaveLength(1));
    await waitFor(() => expect(reported).toContain('rendered'));
  });
});
