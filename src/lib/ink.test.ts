import { describe, expect, it } from 'vitest';
import {
  createStrokeId,
  pointsBounds,
  simplifyPoints,
  strokeBounds,
  strokePathD,
  type InkStroke,
  type PdfPoint,
} from './ink';

const p = (x: number, y: number): PdfPoint => ({ x, y });

describe('simplifyPoints', () => {
  it('keeps endpoints and drops points inside the threshold', () => {
    const result = simplifyPoints([p(0, 0), p(0.2, 0), p(0.4, 0), p(10, 10)], 1);
    expect(result).toEqual([p(0, 0), p(10, 10)]);
  });
  it('retains spaced-out points', () => {
    const result = simplifyPoints([p(0, 0), p(5, 0), p(10, 0)], 1);
    expect(result).toEqual([p(0, 0), p(5, 0), p(10, 0)]);
  });
  it('copies through short strokes', () => {
    expect(simplifyPoints([p(1, 2)], 1)).toEqual([p(1, 2)]);
    expect(simplifyPoints([], 1)).toEqual([]);
  });
  it('does not mutate the input', () => {
    const input = [p(0, 0), p(0.1, 0), p(9, 9)];
    const result = simplifyPoints(input, 1);
    result[0]!.x = 99;
    expect(input[0]!.x).toBe(0);
  });
});

describe('strokePathD', () => {
  it('returns nothing for no points', () => {
    expect(strokePathD([])).toBe('');
  });
  it('moves to a lone point', () => {
    expect(strokePathD([p(3, 4)])).toBe('M 3 4');
  });
  it('draws a straight line for two points', () => {
    expect(strokePathD([p(0, 0), p(5, 5)])).toBe('M 0 0 L 5 5');
  });
  it('smooths three or more points with quadratic segments', () => {
    const d = strokePathD([p(0, 0), p(10, 0), p(20, 10)]);
    expect(d).toBe('M 0 0 Q 10 0 20 10');
  });
  it('ends interior segments at midpoints', () => {
    const d = strokePathD([p(0, 0), p(10, 0), p(20, 10), p(30, 20)]);
    // First curve ends at the midpoint of segment 2, then closes on the last point.
    expect(d).toBe('M 0 0 Q 10 0 15 5 Q 20 10 30 20');
  });
});

describe('bounds', () => {
  it('computes point extents', () => {
    expect(pointsBounds([p(2, 8), p(6, 3)])).toEqual({ minX: 2, minY: 3, maxX: 6, maxY: 8 });
    expect(pointsBounds([])).toBeNull();
  });
  it('pads stroke bounds by half the width', () => {
    const stroke: InkStroke = {
      id: 's1',
      pageIndex: 0,
      points: [p(10, 10), p(20, 30)],
      color: '#000',
      width: 4,
    };
    expect(strokeBounds(stroke)).toEqual({
      minX: 8,
      minY: 8,
      maxX: 22,
      maxY: 32,
      width: 14,
      height: 24,
    });
    expect(strokeBounds({ ...stroke, points: [] })).toBeNull();
  });
});

describe('createStrokeId', () => {
  it('produces unique ids', () => {
    expect(new Set([createStrokeId(), createStrokeId(), createStrokeId()]).size).toBe(3);
  });
});
