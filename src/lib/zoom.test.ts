import { describe, expect, it } from 'vitest';
import {
  MAX_SCALE,
  MIN_SCALE,
  ZOOM_LEVELS,
  clampScale,
  formatZoomPercent,
  nextZoomDown,
  nextZoomUp,
  parseZoomPercent,
  pinchScale,
  wheelScale,
  zoomBy,
} from './zoom';

describe('nextZoomUp / nextZoomDown', () => {
  it('walks the preset ladder', () => {
    expect(nextZoomUp(1)).toBe(1.1);
    expect(nextZoomDown(1)).toBe(0.9);
  });

  it('stops at the ends instead of wrapping or overshooting', () => {
    expect(nextZoomUp(MAX_SCALE)).toBe(MAX_SCALE);
    expect(nextZoomDown(MIN_SCALE)).toBe(MIN_SCALE);
  });

  it('snaps an arbitrary scale to the next step in the pressed direction', () => {
    // A wheel/pinch gesture can leave us on 1.37, which is not on the ladder.
    expect(nextZoomUp(1.37)).toBe(1.5);
    expect(nextZoomDown(1.37)).toBe(1.25);
  });

  it('moves exactly one rung of the ladder per press', () => {
    for (const [index, level] of ZOOM_LEVELS.entries()) {
      if (index < ZOOM_LEVELS.length - 1) {
        expect(nextZoomUp(level), `up from ${level}`).toBe(ZOOM_LEVELS[index + 1]);
      }
      if (index > 0) {
        expect(nextZoomDown(level), `down from ${level}`).toBe(ZOOM_LEVELS[index - 1]);
      }
    }
  });
});

describe('clampScale', () => {
  it('bounds the scale to the usable range', () => {
    expect(clampScale(0.001)).toBe(MIN_SCALE);
    expect(clampScale(99)).toBe(MAX_SCALE);
    expect(clampScale(1.5)).toBe(1.5);
  });

  it('falls back to the minimum for values that cannot be rendered', () => {
    // A NaN scale would silently collapse every page to zero width.
    expect(clampScale(Number.NaN)).toBe(MIN_SCALE);
    expect(clampScale(Number.POSITIVE_INFINITY)).toBe(MAX_SCALE);
    expect(clampScale(Number.NEGATIVE_INFINITY)).toBe(MIN_SCALE);
  });
});

describe('zoomBy', () => {
  it('scales what is on screen, not the nominal 1.0', () => {
    expect(zoomBy(0.8, 1.25)).toBeCloseTo(1);
    expect(zoomBy(2, 0.5)).toBe(1);
  });

  it('cannot be pushed past the ceiling by repeated calls', () => {
    let scale = 4;
    for (let i = 0; i < 10; i += 1) scale = zoomBy(scale, 1.5);
    expect(scale).toBe(MAX_SCALE);
  });
});

describe('parseZoomPercent', () => {
  it('reads the number the toolbar displays', () => {
    expect(parseZoomPercent('150')).toBe(1.5);
    expect(parseZoomPercent('150%')).toBe(1.5);
    expect(parseZoomPercent('  150 % ')).toBe(1.5);
    expect(parseZoomPercent('100')).toBe(1);
  });

  it('rejects anything that is not a usable percentage', () => {
    expect(parseZoomPercent('')).toBeNull();
    expect(parseZoomPercent('   ')).toBeNull();
    expect(parseZoomPercent('abc')).toBeNull();
    expect(parseZoomPercent('0')).toBeNull();
    expect(parseZoomPercent('-50')).toBeNull();
    expect(parseZoomPercent('Infinity')).toBeNull();
    // A trailing unit other than % is a typo, not a value to guess at.
    expect(parseZoomPercent('150px')).toBeNull();
  });

  it('clamps a valid but unrenderable percentage into range', () => {
    expect(parseZoomPercent('10000')).toBe(MAX_SCALE);
    expect(parseZoomPercent('1')).toBe(MIN_SCALE);
  });
});

describe('formatZoomPercent', () => {
  it('rounds away binary float dust', () => {
    // 1.1 * 100 is 110.00000000000001 in IEEE-754.
    expect(formatZoomPercent(1.1)).toBe('110');
    expect(formatZoomPercent(0.66)).toBe('66');
    expect(formatZoomPercent(1 / 3)).toBe('33');
  });

  it('is the inverse of parseZoomPercent for the ladder', () => {
    for (const level of ZOOM_LEVELS) {
      expect(parseZoomPercent(formatZoomPercent(level))).toBe(level);
    }
  });
});

describe('pinchScale', () => {
  it('applies the finger-spread ratio to the scale the gesture started from', () => {
    expect(pinchScale(1, 100, 150)).toBe(1.5);
    expect(pinchScale(1, 100, 50)).toBe(0.5);
  });

  it('holds steady on degenerate distances', () => {
    // pdf.js reports 0 between a two-finger and a one-finger event.
    expect(pinchScale(1.5, 0, 120)).toBe(1.5);
    expect(pinchScale(1.5, 120, 0)).toBe(1.5);
    expect(pinchScale(1.5, -1, 120)).toBe(1.5);
    expect(pinchScale(1.5, 120, Number.NaN)).toBe(1.5);
  });

  it('stays inside the clamp during a long drag', () => {
    expect(pinchScale(1, 10, 100000)).toBe(MAX_SCALE);
    expect(pinchScale(1, 100000, 1)).toBe(MIN_SCALE);
  });
});

describe('wheelScale', () => {
  it('is a no-op without scroll', () => {
    expect(wheelScale(1.5, 0)).toBe(1.5);
  });

  it('zooms out when the wheel rolls down and in when it rolls up', () => {
    expect(wheelScale(1, 100)).toBeLessThan(1);
    expect(wheelScale(1, -100)).toBeGreaterThan(1);
  });

  it('is symmetric for equal and opposite deltas', () => {
    const up = wheelScale(1, -120);
    const down = wheelScale(up, 120);
    expect(down).toBeCloseTo(1, 5);
  });

  it('respects the clamp for trackpad flings', () => {
    expect(wheelScale(3, -5000)).toBe(MAX_SCALE);
    expect(wheelScale(0.5, 5000)).toBe(MIN_SCALE);
  });

  it('honours a coarser sensitivity', () => {
    expect(Math.abs(wheelScale(1, 100, 0.01) - 1)).toBeGreaterThan(
      Math.abs(wheelScale(1, 100, 0.0015) - 1),
    );
  });
});
