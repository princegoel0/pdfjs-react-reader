/**
 * FR-57 and §6.1: the four canvas ceilings combine as a minimum, and the renderer stops at
 * the 0.25 scale floor.
 *
 * The clause under test is the one that turns a budget into a guarantee: "a host value
 * therefore *constrains* the renderer and never overrides it". Before this, the shell computed
 * `maxRenderPixels ?? autoRenderPixels`, so a host asking for 200 Mpx on a phone got an
 * arithmetic that honoured the request and a page that came back blank — the failure mode the
 * ceiling exists to prevent, caused by the one input that was supposed to be safe. Every
 * assertion here is paired with a number that *should* lose, because a minimum is only
 * testable by what it refuses.
 */
import { describe, expect, it } from 'vitest';
import {
  CAP_AREA_FACTOR,
  MAX_RENDER_PIXELS,
  MAX_RENDER_PIXELS_MOBILE,
  MAX_RENDER_SIDE,
  MIN_RENDER_SCALE,
  resolveCanvasBudget,
  resolveRenderScale,
  viewportWorkingSet,
  type CanvasEnvironment,
} from './canvas';

const desktop: CanvasEnvironment = {
  userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
  platform: 'Win32',
  maxTouchPoints: 0,
  screenWidth: 1920,
  screenHeight: 1080,
  devicePixelRatio: 1,
};

/**
 * The same desktop with no screen to measure. §6.1's working-set candidate is derived from the
 * display, so a browser that will not say what its screen is leaves three candidates, not four
 * — which is also the shape of a server render and of a locked-down tab.
 */
const noScreen: CanvasEnvironment = { ...desktop, screenWidth: 0, screenHeight: 0 };

const phone: CanvasEnvironment = {
  userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)',
  platform: 'iPhone',
  maxTouchPoints: 5,
  screenWidth: 390,
  screenHeight: 844,
  devicePixelRatio: 3,
};

/** A small screen, whose working set really is below the mobile package default. */
const smallPhone: CanvasEnvironment = { ...phone, screenWidth: 320, screenHeight: 480, devicePixelRatio: 2 };

/** A tablet that lies about being a desktop — the case §6.1's "detection, not labels" names. */
const ipadReportingMacIntel: CanvasEnvironment = {
  ...noScreen,
  platform: 'MacIntel',
  maxTouchPoints: 5,
};

describe('the four ceilings combine as a minimum (FR-57)', () => {
  it('takes the package default when nothing else is in play', () => {
    const budget = resolveCanvasBudget({ env: noScreen });
    expect(budget.maxPixels).toBe(MAX_RENDER_PIXELS);
    expect(budget.applied).toBe('default');
  });

  it('detects the mobile class from touch points alone, whatever the platform string says', () => {
    const budget = resolveCanvasBudget({ env: ipadReportingMacIntel });
    expect(budget.maxPixels).toBe(MAX_RENDER_PIXELS_MOBILE);
    expect(budget.candidates.viewport).toBeUndefined();
  });

  it('lets the viewport working set win on a small screen', () => {
    const budget = resolveCanvasBudget({ env: smallPhone });
    expect(budget.applied).toBe('viewport');
    expect(budget.maxPixels).toBe(viewportWorkingSet(smallPhone));
    expect(budget.maxPixels).toBeLessThan(MAX_RENDER_PIXELS_MOBILE);
  });

  it('takes the mobile default rather than the working set on a large phone', () => {
    // The minimum cuts both ways: a 390 × 844 screen at 3× allows 9.96 Mpx of working set and
    // still gets the 5.24 Mpx class ceiling, because the working set is a cap and not a floor.
    const budget = resolveCanvasBudget({ env: phone });
    expect(budget.applied).toBe('default');
    expect(budget.maxPixels).toBe(MAX_RENDER_PIXELS_MOBILE);
    expect(budget.candidates.viewport).toBeGreaterThan(MAX_RENDER_PIXELS_MOBILE);
  });

  it('treats a host budget as a constraint, never as an override', () => {
    const raised = resolveCanvasBudget({ env: noScreen, hostPixels: 200_000_000 });
    // The clause in one assertion: asking for six times the ceiling buys the ceiling.
    expect(raised.maxPixels).toBe(MAX_RENDER_PIXELS);
    expect(raised.applied).toBe('default');
    // …and the number the host asked for is still visible, so `applied` can be trusted.
    expect(raised.candidates.host).toBe(200_000_000);
  });

  it('honours a host budget that asks for less', () => {
    const lowered = resolveCanvasBudget({ env: desktop, hostPixels: 1_000_000 });
    expect(lowered.maxPixels).toBe(1_000_000);
    expect(lowered.applied).toBe('host');
  });

  it('keeps pdf.js’s `0` meaning "CSS pixels only" rather than reading it as unset', () => {
    const cssOnly = resolveCanvasBudget({ env: desktop, hostPixels: 0 });
    expect(cssOnly.maxPixels).toBe(0);
    expect(cssOnly.applied).toBe('host');
  });

  it('puts the probed platform ceiling between the host and the default', () => {
    const budget = resolveCanvasBudget({
      env: noScreen,
      hostPixels: 40_000_000,
      platformPixels: 12_000_000,
    });
    expect(budget.maxPixels).toBe(12_000_000);
    expect(budget.applied).toBe('platform');
  });

  it('ignores a platform ceiling that has not been measured yet', () => {
    const budget = resolveCanvasBudget({ env: noScreen, platformPixels: null });
    expect(budget.applied).toBe('default');
    expect(budget.candidates.platform).toBeUndefined();
  });

  it('names the host when its number happens to equal the winner', () => {
    // A tie is not ambiguous to the person reading it: they want to know their own value is
    // the one in force, not that some other ceiling coincided with it.
    const budget = resolveCanvasBudget({ env: noScreen, hostPixels: MAX_RENDER_PIXELS });
    expect(budget.applied).toBe('host');
  });

  it('carries the §6.1 canonical values rather than restating them', () => {
    expect(MAX_RENDER_PIXELS).toBe(33_554_432);
    expect(MAX_RENDER_PIXELS_MOBILE).toBe(5_242_880);
    expect(MAX_RENDER_SIDE).toBe(32_767);
    expect(CAP_AREA_FACTOR).toBe(200);
    expect(MIN_RENDER_SCALE).toBe(0.25);
  });
});

describe('the minimum render scale (FR-57)', () => {
  const at = (over: Partial<Parameters<typeof resolveRenderScale>[0]>) =>
    resolveRenderScale({ width: 612, height: 792, devicePixelRatio: 2, ...over });

  it('lowers the scale toward the floor and reports the cap', () => {
    const capped = at({ maxPixels: 1_000_000 });
    expect(capped.capped).toBe(true);
    expect(capped.refused).toBe(false);
    expect(capped.limitedBy).toBe('pixels');
    expect(capped.scale).toBeGreaterThanOrEqual(MIN_RENDER_SCALE);
    expect(capped.scale).toBeLessThan(2);
  });

  it('refuses a page that cannot be represented at or above the floor', () => {
    // A 4000 × 6000 CSS px sheet under a 1 Mpx budget needs 0.0083 — a blank canvas with a
    // text layer positioned over it, which is worse than no page at all.
    const refused = resolveRenderScale({
      width: 4000,
      height: 6000,
      devicePixelRatio: 2,
      maxPixels: 1_000_000,
    });
    expect(refused.refused).toBe(true);
    expect(refused.limitedBy).toBe('pixels');
    // The floor is what a caller paints *if* it paints; `refused` is the instruction not to.
    expect(refused.scale).toBe(MIN_RENDER_SCALE);
  });

  it('refuses on a side ceiling too, because a host can lower that one as well', () => {
    const refused = resolveRenderScale({
      width: 4000,
      height: 3000,
      devicePixelRatio: 1,
      maxPixels: MAX_RENDER_PIXELS,
      maxSide: 800,
    });
    expect(refused.limitedBy).toBe('side');
    expect(refused.refused).toBe(true);
  });

  it('does not refuse a page that only just fits', () => {
    // Exactly at the floor: 0.25 is allowed, since the clause is "at or above it".
    const edge = resolveRenderScale({ width: 1000, height: 1000, devicePixelRatio: 2, maxPixels: 62_500 });
    expect(edge.scale).toBe(MIN_RENDER_SCALE);
    expect(edge.refused).toBe(false);
  });

  it('leaves an uncapped page untouched', () => {
    const plain = at({ maxPixels: MAX_RENDER_PIXELS });
    expect(plain).toEqual({ scale: 2, capped: false, refused: false, limitedBy: undefined });
  });
});
