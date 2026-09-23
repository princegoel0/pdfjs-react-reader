import { describe, expect, it } from 'vitest';
import {
  PRINT_MEMORY_BUDGET,
  estimatePrintBytes,
  formatBytes,
  maxPrintablePages,
  planPrintPages,
  planPrintScale,
  printCanvasSize,
} from './print';

/** A4 portrait in PDF units (72 dpi). */
const A4 = { width: 595, height: 842 };

describe('planPrintPages', () => {
  it('prints the whole document by default', () => {
    expect(planPrintPages(3)).toEqual([1, 2, 3]);
    expect(planPrintPages(4, null)).toEqual([1, 2, 3, 4]);
  });

  it('clamps a range to the document', () => {
    expect(planPrintPages(10, [2, 4])).toEqual([2, 3, 4]);
    expect(planPrintPages(10, [8, 20])).toEqual([8, 9, 10]);
    expect(planPrintPages(10, [-5, 3])).toEqual([1, 2, 3]);
    expect(planPrintPages(10, [0, 0])).toEqual([1]);
  });

  it('never returns an empty range for a valid page', () => {
    expect(planPrintPages(10, [5, 2])).toEqual([5]);
  });

  it('survives garbage input', () => {
    expect(planPrintPages(0, [1, 5])).toEqual([]);
    expect(planPrintPages(Number.NaN)).toEqual([]);
    expect(planPrintPages(5, [Number.NaN, Number.NaN])).toEqual([1, 2, 3, 4, 5]);
    expect(planPrintPages(5, [2, Number.NaN])).toEqual([2, 3, 4, 5]);
    expect(planPrintPages(5, [2.7, 3.9])).toEqual([2, 3]);
  });
});

describe('printCanvasSize', () => {
  it('floors fractional pixels so the canvas never exceeds the viewport', () => {
    expect(printCanvasSize(A4, 1.5)).toEqual({ width: 892, height: 1263 });
  });

  it('keeps at least one pixel of each dimension', () => {
    expect(printCanvasSize({ width: 0.2, height: 0.1 }, 1)).toEqual({ width: 1, height: 1 });
  });
});

describe('estimatePrintBytes', () => {
  it('charges four bytes per device pixel per page', () => {
    expect(estimatePrintBytes(A4, 1, 1)).toBe(595 * 842 * 4);
    expect(estimatePrintBytes(A4, 1, 3)).toBe(595 * 842 * 4 * 3);
  });
});

describe('planPrintScale', () => {
  it('prefers the sharpest scale that fits the budget', () => {
    expect(planPrintScale(A4, 14)).toBe(2);
    expect(planPrintScale(A4, 40)).toBe(1.5);
    expect(planPrintScale(A4, 60)).toBe(1);
  });

  it('stays inside the budget', () => {
    for (const pages of [1, 12, 33, 34, 59, 60]) {
      const scale = planPrintScale(A4, pages);
      if (scale === null) continue;
      expect(estimatePrintBytes(A4, scale, pages)).toBeLessThanOrEqual(PRINT_MEMORY_BUDGET);
    }
  });

  it('gives up rather than promise an out-of-memory print', () => {
    expect(planPrintScale(A4, 200)).toBeNull();
  });

  it('returns null for nothing to print or unusable dimensions', () => {
    expect(planPrintScale(A4, 0)).toBeNull();
    expect(planPrintScale({ width: 0, height: 842 }, 5)).toBeNull();
  });

  it('honours a custom budget and level list', () => {
    const onePageAtScale1 = estimatePrintBytes(A4, 1, 1);
    expect(planPrintScale(A4, 1, [2, 1], onePageAtScale1)).toBe(1);
    expect(planPrintScale(A4, 1, [1], onePageAtScale1 - 1)).toBeNull();
  });
});

describe('maxPrintablePages', () => {
  it('reports how many sheets fit at a scale', () => {
    expect(maxPrintablePages(A4, 2)).toBe(
      Math.floor(PRINT_MEMORY_BUDGET / estimatePrintBytes(A4, 2, 1)),
    );
    expect(maxPrintablePages(A4, 2)).toBe(33);
    expect(maxPrintablePages(A4, 1)).toBeGreaterThan(maxPrintablePages(A4, 2));
  });
});

describe('formatBytes', () => {
  it('rounds to one decimal below 10 MB and to whole MB above', () => {
    expect(formatBytes(512 * 1024)).toBe('0.5 MB');
    expect(formatBytes(2 * 1024 * 1024)).toBe('2 MB');
    expect(formatBytes(PRINT_MEMORY_BUDGET)).toBe('256 MB');
  });
});
