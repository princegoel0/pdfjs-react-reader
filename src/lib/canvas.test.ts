import { describe, expect, it } from 'vitest';
import {
  CAP_AREA_FACTOR,
  MAX_RENDER_PIXELS,
  MAX_RENDER_PIXELS_MOBILE,
  MAX_RENDER_SIDE,
  isMobileCanvasEnvironment,
  maxRenderPixelsFor,
  resolveRenderScale,
  type CanvasEnvironment,
} from './canvas';

const desktop: CanvasEnvironment = {
  userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/140.0.0.0',
  platform: 'Win32',
  maxTouchPoints: 0,
  screenWidth: 1920,
  screenHeight: 1080,
  devicePixelRatio: 1,
};

const env = (over: Partial<CanvasEnvironment> = {}): CanvasEnvironment => ({
  ...desktop,
  ...over,
});

describe('resolveRenderScale', () => {
  it('leaves an ordinary page alone', () => {
    // Letter at 100% on a 2x display: 1224x1584 device px, nowhere near a limit.
    expect(resolveRenderScale({ width: 612, height: 792, devicePixelRatio: 2 })).toEqual({
      scale: 2,
      capped: false,
    });
  });

  it('clamps to the area ceiling before the canvas can go blank', () => {
    // Letter at 500% on a 2x display would be 3060x3960 CSS px = 48.5 M device px.
    const { scale, capped } = resolveRenderScale({
      width: 3060,
      height: 3960,
      devicePixelRatio: 2,
    });
    expect(capped).toBe(true);
    expect(scale).toBeLessThan(2);
    expect(Math.pow(scale, 2) * 3060 * 3960).toBeLessThanOrEqual(MAX_RENDER_PIXELS + 1);
  });

  it('clamps to the side ceiling on a very wide page', () => {
    const { scale } = resolveRenderScale({
      width: 40_000,
      height: 1000,
      devicePixelRatio: 1,
      maxPixels: Number.POSITIVE_INFINITY,
    });
    expect(scale).toBeCloseTo(MAX_RENDER_SIDE / 40_000, 10);
  });

  it('prefers the tighter of the two ceilings', () => {
    const area = resolveRenderScale({ width: 6000, height: 6000, devicePixelRatio: 4 });
    const side = resolveRenderScale({ width: 60_000, height: 100, devicePixelRatio: 4 });
    expect(area.scale).toBeLessThan(4);
    expect(side.scale).toBeLessThan(area.scale);
  });

  it('renders at CSS resolution when the area ceiling is switched off', () => {
    expect(resolveRenderScale({ width: 612, height: 792, devicePixelRatio: 3, maxPixels: 0 }))
      .toEqual({ scale: 1, capped: true });
    expect(resolveRenderScale({ width: 612, height: 792, devicePixelRatio: 1, maxPixels: 0 }))
      .toEqual({ scale: 1, capped: false });
  });

  it('never upscales', () => {
    // A 1x display on a tiny page: the ceilings are satisfied, and the answer is
    // still 1 rather than a sharper fiction.
    expect(resolveRenderScale({ width: 100, height: 100, devicePixelRatio: 1 }))
      .toEqual({ scale: 1, capped: false });
  });

  it('survives degenerate geometry and ratios', () => {
    expect(resolveRenderScale({ width: 0, height: 792, devicePixelRatio: 2 }).scale).toBe(2);
    expect(resolveRenderScale({ width: 612, height: Number.NaN, devicePixelRatio: 2 }).scale).toBe(2);
    expect(resolveRenderScale({ width: 612, height: 792, devicePixelRatio: 0 }).scale).toBe(1);
    expect(resolveRenderScale({ width: 612, height: 792, devicePixelRatio: Number.NaN }).scale).toBe(1);
    expect(resolveRenderScale({ width: 612, height: 792, devicePixelRatio: -3 }).scale).toBe(1);
  });

  it('keeps a positive scale however hostile the input', () => {
    // Sub-zero would hand pdf.js a zero-sized canvas, which is the failure mode
    // the ceiling exists to prevent.
    const { scale } = resolveRenderScale({
      width: 1e9,
      height: 1e9,
      devicePixelRatio: 2,
      maxPixels: 1000,
    });
    expect(scale).toBeGreaterThan(0);
    expect(Number.isFinite(scale)).toBe(true);
  });
});

describe('maxRenderPixelsFor', () => {
  it('uses the desktop ceiling when the screen is larger than it', () => {
    const big = env({ screenWidth: 3840, screenHeight: 2160, devicePixelRatio: 2 });
    expect(maxRenderPixelsFor(big)).toBe(MAX_RENDER_PIXELS);
  });

  it('tightens to the screen area on a modest laptop', () => {
    const modest = env({ screenWidth: 1366, screenHeight: 768, devicePixelRatio: 1 });
    const pixels = maxRenderPixelsFor(modest);
    expect(pixels).toBeLessThan(MAX_RENDER_PIXELS);
    expect(pixels).toBe(Math.ceil(1366 * 768 * (1 + CAP_AREA_FACTOR / 100)));
  });

  it('applies the device pixel ratio to the screen area', () => {
    const one = env({ screenWidth: 1000, screenHeight: 1000, devicePixelRatio: 1 });
    const two = env({ screenWidth: 1000, screenHeight: 1000, devicePixelRatio: 2 });
    expect(maxRenderPixelsFor(two)).toBe(maxRenderPixelsFor(one) * 4);
  });

  it('falls back to the platform default when there is no screen', () => {
    // Server render, or a worker without a display.
    expect(maxRenderPixelsFor(env({ screenWidth: 0, screenHeight: 0 }))).toBe(MAX_RENDER_PIXELS);
  });

  it('uses the mobile ceiling on iOS and Android', () => {
    expect(isMobileCanvasEnvironment(env({ userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0)' }))).toBe(true);
    expect(isMobileCanvasEnvironment(env({ userAgent: 'Mozilla/5.0 (Linux; Android 15)' }))).toBe(true);
    const phone = env({
      userAgent: 'Mozilla/5.0 (Linux; Android 15) Mobile Safari/537.36',
      platform: 'Linux armv8l',
      maxTouchPoints: 5,
      screenWidth: 393,
      screenHeight: 751,
      devicePixelRatio: 2.75,
    });
    expect(maxRenderPixelsFor(phone)).toBe(MAX_RENDER_PIXELS_MOBILE);
  });

  it('catches iPadOS, which reports itself as a Mac', () => {
    const ipad = env({
      userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Safari/605.1.15',
      platform: 'MacIntel',
      maxTouchPoints: 5,
    });
    expect(isMobileCanvasEnvironment(ipad)).toBe(true);
    // A real MacBook with a touchscreen must not be downgraded.
    expect(isMobileCanvasEnvironment({ ...ipad, maxTouchPoints: 0 })).toBe(false);
  });

  it('does not treat a desktop Safari user-agent as mobile', () => {
    expect(isMobileCanvasEnvironment(env({
      userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_5) Safari/605.1.15',
      platform: 'MacIntel',
      maxTouchPoints: 0,
    }))).toBe(false);
  });
});
