import { describe, expect, it } from 'vitest';
import {
  applyRotation,
  computeLayout,
  computeSlots,
  findStartIndex,
  findVisibleRange,
  scaledPageSize,
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
