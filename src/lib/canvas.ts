/**
 * Canvas ceilings for the on-screen render path.
 *
 * pdf.js enforces none of these inside `page.render()` — its own viewer clamps
 * the output scale in `PDFPageView.draw()` from `AppOptions`. The numbers below
 * are those values, restated rather than imported: `OutputScale`'s statics read
 * `window.screen` and `devicePixelRatio`, and taking a dependency on the engine
 * for six lines of arithmetic would let a pdf.js minor silently change what our
 * pages render at.
 *
 * Why these are constants rather than a boot-time probe: the only way to measure
 * a canvas ceiling is to allocate a canvas at the limit, which is exactly the
 * memory the ceiling exists to avoid.
 */

/** pdf.js `AppOptions.maxCanvasPixels`: 33.5 M device pixels, about 134 MB of RGBA. */
export const MAX_RENDER_PIXELS = 2 ** 25;

/** pdf.js's `compatParams` override for iOS and Android, where the real limit is far lower. */
export const MAX_RENDER_PIXELS_MOBILE = 5_242_880;

/** pdf.js `AppOptions.maxCanvasDim`. Past this a side may fail to allocate at all. */
export const MAX_RENDER_SIDE = 32_767;

/** pdf.js `AppOptions.capCanvasAreaFactor`: how far above the screen's own pixel count a canvas may go. */
export const CAP_AREA_FACTOR = 200;

export interface CanvasEnvironment {
  userAgent: string;
  platform: string;
  maxTouchPoints: number;
  /** `screen.availWidth`/`availHeight` in CSS pixels. Zero when unknown, which skips the area cap. */
  screenWidth: number;
  screenHeight: number;
  devicePixelRatio: number;
}

export interface RenderScaleOptions {
  /** The page box in CSS pixels at the current zoom. */
  width: number;
  height: number;
  /** Usually `window.devicePixelRatio`. */
  devicePixelRatio: number;
  /** Device pixels the canvas may cover. `0` means render at CSS resolution. Defaults to {@link MAX_RENDER_PIXELS}. */
  maxPixels?: number;
  /** Maximum length of either side. Defaults to {@link MAX_RENDER_SIDE}. */
  maxSide?: number;
}

export interface RenderScale {
  /** Device pixels per CSS pixel to render at. Never above the requested ratio. */
  scale: number;
  /** True when a ceiling lowered the requested ratio, so the page is softer than the display. */
  capped: boolean;
}

/** The pdf.js mobile compatibility tier: iOS (including iPadOS, which reports `MacIntel`) and Android. */
export function isMobileCanvasEnvironment(env: CanvasEnvironment): boolean {
  return /Android/.test(env.userAgent)
    || /\b(?:iPad|iPhone|iPod)(?=;)/.test(env.userAgent)
    || (env.platform === 'MacIntel' && env.maxTouchPoints > 1);
}

/**
 * The area ceiling in device pixels for an environment: the platform default,
 * tightened to a multiple of the screen's own pixel count. Rendering far more
 * pixels than the display can show is waste, and on a phone it is the difference
 * between a page and a crashed tab.
 */
export function maxRenderPixelsFor(
  env: CanvasEnvironment,
  capAreaFactor = CAP_AREA_FACTOR,
): number {
  const base = isMobileCanvasEnvironment(env) ? MAX_RENDER_PIXELS_MOBILE : MAX_RENDER_PIXELS;
  const { screenWidth, screenHeight, devicePixelRatio } = env;
  if (!(screenWidth > 0) || !(screenHeight > 0)) return base;
  const screenPixels = Math.ceil(
    screenWidth * screenHeight * devicePixelRatio ** 2 * (1 + capAreaFactor / 100),
  );
  return Math.min(base, screenPixels);
}

/**
 * Clamps a device-pixel ratio so the resulting canvas fits both the area and the
 * side ceilings. Exceeding either does not throw — the browser hands back a canvas
 * that allocates nothing and renders blank — so this is the whole defence.
 */
export function resolveRenderScale({
  width,
  height,
  devicePixelRatio,
  maxPixels = MAX_RENDER_PIXELS,
  maxSide = MAX_RENDER_SIDE,
}: RenderScaleOptions): RenderScale {
  const requested =
    Number.isFinite(devicePixelRatio) && devicePixelRatio > 0 ? devicePixelRatio : 1;
  if (!(width > 0) || !(height > 0)) return { scale: requested, capped: false };
  // pdf.js reserves `maxPixels: 0` for "CSS pixels only", which is how you keep
  // a document legible on a device whose canvas limit is effectively none.
  if (maxPixels === 0) return { scale: 1, capped: requested > 1 };

  let ceiling = requested;
  if (maxPixels > 0) ceiling = Math.min(ceiling, Math.sqrt(maxPixels / (width * height)));
  if (maxSide > 0) ceiling = Math.min(ceiling, maxSide / width, maxSide / height);
  if (ceiling >= requested) return { scale: requested, capped: false };
  return { scale: ceiling, capped: true };
}

/** Reads the environment where it exists; every field has a server-safe fallback. */
export function readCanvasEnvironment(): CanvasEnvironment {
  const g = globalThis as typeof globalThis & {
    navigator?: Navigator;
    screen?: { availWidth: number; availHeight: number };
  };
  return {
    userAgent: g.navigator?.userAgent ?? '',
    platform: g.navigator?.platform ?? '',
    maxTouchPoints: g.navigator?.maxTouchPoints ?? 0,
    screenWidth: g.screen?.availWidth ?? 0,
    screenHeight: g.screen?.availHeight ?? 0,
    devicePixelRatio: g.devicePixelRatio ?? 1,
  };
}
