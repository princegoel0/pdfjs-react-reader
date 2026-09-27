import { describe, expect, it } from 'vitest';
import {
  applyRotation,
  automaticFitMode,
  computeLayout,
  computeSlots,
  findStartIndex,
  findVisibleRange,
  meanBox,
  scaledPageSize,
  spreadSample,
} from './layout';

describe('applyRotation', () => {
  const dims = { width: 600, height: 800 };
  it('swaps dimensions for 90/270 degrees', () => {
    expect(applyRotation(dims, 90)).toEqual({ width: 800, height: 600 });
    expect(applyRotation(dims, 270)).toEqual({ width: 800, height: 600 });
  });
  it('keeps dimensions for 0/180/360 and normalizes negatives', () => {
    expect(applyRotation(dims, 0)).toEqual(dims);
    expect(applyRotation(dims, 180)).toEqual(dims);
    expect(applyRotation(dims, 360)).toEqual(dims);
    expect(applyRotation(dims, -90)).toEqual({ width: 800, height: 600 });
  });
});

describe('automaticFitMode', () => {
  it('fits a portrait page by width', () => {
    expect(automaticFitMode({ width: 612, height: 792 })).toBe('fit-width');
  });

  it('fits a landscape page as a whole', () => {
    expect(automaticFitMode({ width: 792, height: 612 })).toBe('fit-page');
  });

  it('gives a square page width, which is the tie-break it documents', () => {
    expect(automaticFitMode({ width: 500, height: 500 })).toBe('fit-width');
  });

  it('follows the shape the reader sees, so rotation is applied first', () => {
    const portrait = { width: 612, height: 792 };
    expect(automaticFitMode(portrait)).toBe('fit-width');
    expect(automaticFitMode(applyRotation(portrait, 90))).toBe('fit-page');
  });
});

describe('scaledPageSize', () => {
  it('scales and falls back to the estimate', () => {
    expect(scaledPageSize({ width: 600, height: 800 }, { width: 612, height: 792 }, 0.5, 0))
      .toEqual({ width: 300, height: 400 });
    expect(scaledPageSize(undefined, { width: 612, height: 792 }, 2, 0))
      .toEqual({ width: 1224, height: 1584 });
    expect(scaledPageSize(undefined, { width: 612, height: 792 }, 1, 90))
      .toEqual({ width: 792, height: 612 });
  });
});

describe('computeLayout', () => {
  const sizes = [
    { width: 100, height: 100 },
    { width: 100, height: 200 },
    { width: 100, height: 50 },
  ];
  it('accumulates offsets with gaps and excludes the trailing gap', () => {
    const layout = computeLayout(sizes, 10);
    expect(layout.offsets).toEqual([0, 110, 320]);
    expect(layout.heights).toEqual([100, 200, 50]);
    expect(layout.totalHeight).toBe(370);
  });
  it('handles an empty document', () => {
    expect(computeLayout([], 10).totalHeight).toBe(0);
  });
});

describe('findStartIndex', () => {
  const layout = computeLayout(
    [{ width: 10, height: 100 }, { width: 10, height: 100 }, { width: 10, height: 100 }],
    0,
  );
  it('finds the first page whose bottom exceeds y', () => {
    expect(findStartIndex(layout, 0)).toBe(0);
    expect(findStartIndex(layout, 100)).toBe(1);
    expect(findStartIndex(layout, 250)).toBe(2);
  });
  it('returns past-the-end when y is beyond all content', () => {
    expect(findStartIndex(layout, 1000)).toBe(3);
  });
});

describe('findVisibleRange', () => {
  const layout = computeLayout(
    Array.from({ length: 10 }, () => ({ width: 10, height: 100 })),
    10,
  );
  it('returns the pages intersecting the viewport plus overscan', () => {
    // Viewport 0..150 shows pages 0 (0-100) and 1 (110-210).
    expect(findVisibleRange(layout, 0, 150, 0)).toEqual({ start: 0, end: 1 });
    // Overscan of 120px reaches into page above and below.
    expect(findVisibleRange(layout, 150, 100, 120)).toEqual({ start: 0, end: 3 });
  });
  it('clamps to the last page when scrolled past content', () => {
    expect(findVisibleRange(layout, 5000, 100, 0)).toEqual({ start: 9, end: 9 });
  });
  it('returns an empty range for an empty layout', () => {
    expect(findVisibleRange(computeLayout([], 10), 0, 100, 0)).toEqual({ start: 0, end: -1 });
  });
});

describe('computeSlots', () => {
  it('puts every page in its own row for continuous and single', () => {
    expect(computeSlots(4, 'continuous')).toEqual([[0], [1], [2], [3]]);
    expect(computeSlots(4, 'single')).toEqual([[0], [1], [2], [3]]);
  });
  it('keeps page 1 alone, then pairs pages in spread', () => {
    expect(computeSlots(6, 'spread')).toEqual([[0], [1, 2], [3, 4], [5]]);
  });
  it('handles 0, 1 and 2 pages', () => {
    expect(computeSlots(0, 'spread')).toEqual([]);
    expect(computeSlots(0, 'continuous')).toEqual([]);
    expect(computeSlots(1, 'spread')).toEqual([[0]]);
    expect(computeSlots(2, 'spread')).toEqual([[0], [1]]);
  });
});

describe('meanBox', () => {
  it('is null for no boxes, which is the caller having measured nothing yet', () => {
    expect(meanBox([])).toBeNull();
  });
  it('is the box itself for a document that turns out to be one size', () => {
    expect(meanBox([{ width: 612, height: 792 }, { width: 612, height: 792 }])).toEqual({
      width: 612,
      height: 792,
    });
  });
  it('averages each axis on its own', () => {
    expect(meanBox([{ width: 792, height: 612 }, { width: 595, height: 842 }])).toEqual({
      width: 693.5,
      height: 727,
    });
  });
  it('sums to the document, which is why it is the mean and not the median', () => {
    const boxes = [
      { width: 792, height: 612 },
      { width: 595, height: 842 },
      { width: 612, height: 792 },
    ];
    const average = meanBox(boxes)!;
    expect(average.height * boxes.length).toBeCloseTo(boxes.reduce((s, b) => s + b.height, 0));
    expect(average.width * boxes.length).toBeCloseTo(boxes.reduce((s, b) => s + b.width, 0));
  });
});

describe('spreadSample', () => {
  it('leaves page 1 to the caller, who has already fetched it', () => {
    expect(spreadSample(1000, 12).every((n) => n > 1)).toBe(true);
  });
  it('reaches the end of the document without naming a page twice', () => {
    const picks = spreadSample(1000, 12);
    expect(picks.length).toBe(12);
    expect(new Set(picks).size).toBe(12);
    expect(picks[0]).toBe(2);
    expect(Math.max(...picks)).toBe(1000);
    expect([...picks].sort((a, b) => a - b)).toEqual(picks);
  });
  it('takes the middle when one page is enough', () => {
    expect(spreadSample(1000, 1)).toEqual([501]);
  });
  it('gives every page once when asked for more than the document has', () => {
    expect(spreadSample(4, 12)).toEqual([2, 3, 4]);
  });
  it('is empty where a mean over it would only repeat page 1', () => {
    expect(spreadSample(2, 12)).toEqual([]);
    expect(spreadSample(1, 12)).toEqual([]);
    expect(spreadSample(0, 12)).toEqual([]);
    expect(spreadSample(1000, 0)).toEqual([]);
  });
});
