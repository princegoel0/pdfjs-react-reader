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
 * The ceiling that matters is *probed*, not assumed (§6.1): `probeCanvasCeiling`
 * allocates upward until a pixel stops coming back, because an over-large canvas
 * does not throw — measured in Chromium on 2026-10-03, a 512 Mpx surface keeps the
 * width it was given, hands back a working-looking 2D context, and reads
 * `0,0,0,0` where a rectangle was just filled. A user-agent string may lower where
 * that probe starts; it may never raise the result or stand in for it, which is what
 * makes the mobile rule hold on a device that reports a desktop-class string.
 */

/** pdf.js `AppOptions.maxCanvasPixels`: 33.5 M device pixels, about 134 MB of RGBA. */
export const MAX_RENDER_PIXELS = 2 ** 25;

/** pdf.js's `compatParams` override for iOS and Android, where the real limit is far lower. */
export const MAX_RENDER_PIXELS_MOBILE = 5_242_880;

/** pdf.js `AppOptions.maxCanvasDim`. Past this a side may fail to allocate at all. */
export const MAX_RENDER_SIDE = 32_767;

/** pdf.js `AppOptions.capCanvasAreaFactor`: how far above the screen's own pixel count a canvas may go. */
export const CAP_AREA_FACTOR = 200;

/**
 * §6.1's minimum render scale: the renderer lowers toward this and stops.
 *
 * Below it a page is not a soft page, it is an unreadable one — the text layer is
 * positioned against the CSS box while the canvas is a quarter-resolution copy of it,
 * so the words a reader selects are no longer the words they see. A page that cannot be
 * painted at or above this is refused with `RESOURCE_LIMIT` instead.
 */
export const MIN_RENDER_SCALE = 0.25;

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
  /**
   * True when no scale at or above {@link MIN_RENDER_SCALE} can represent the page.
   *
   * The caller must not paint: `scale` is the floor, and a canvas that big comes back blank
   * while the text layer sits over it as though it had content. §6.1's answer is a refusal
   * with `RESOURCE_LIMIT`, which names the page and the budget to whoever can act on it.
   */
  refused: boolean;
  /** The ceiling that produced the answer, so a host can tell a cap from a bug. */
  limitedBy?: 'pixels' | 'side';
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
  if (!(width > 0) || !(height > 0)) return { scale: requested, capped: false, refused: false };
  // pdf.js reserves `maxPixels: 0` for "CSS pixels only", which is how you keep
  // a document legible on a device whose canvas limit is effectively none.
  if (maxPixels === 0) return { scale: 1, capped: requested > 1, refused: false };

  let ceiling = requested;
  let limitedBy: RenderScale['limitedBy'];
  if (maxPixels > 0) {
    const byPixels = Math.sqrt(maxPixels / (width * height));
    if (byPixels < ceiling) {
      ceiling = byPixels;
      limitedBy = 'pixels';
    }
  }
  if (maxSide > 0) {
    for (const side of [maxSide / width, maxSide / height]) {
      if (side < ceiling) {
        ceiling = side;
        limitedBy = 'side';
      }
    }
  }
  if (ceiling >= requested) return { scale: requested, capped: false, refused: false };
  if (ceiling < MIN_RENDER_SCALE) {
    return { scale: MIN_RENDER_SCALE, capped: true, refused: true, limitedBy };
  }
  return { scale: ceiling, capped: true, refused: false, limitedBy };
}

/**
 * The area ceiling from the environment alone: the platform default, tightened to a
 * multiple of the screen's own pixel count. Rendering far more pixels than the display can
 * show is waste, and on a phone it is the difference between a page and a crashed tab.
 *
 * This is one of §6.1's four candidates, not the answer — see {@link resolveCanvasBudget}.
 */
export function maxRenderPixelsFor(
  env: CanvasEnvironment,
  capAreaFactor = CAP_AREA_FACTOR,
): number {
  const base = defaultRenderPixelsFor(env);
  const viewport = viewportWorkingSet(env, capAreaFactor);
  return viewport === undefined ? base : Math.min(base, viewport);
}

/** §6.1's package default for the detected class. A user-agent string may only ever *lower* this. */
export function defaultRenderPixelsFor(env: CanvasEnvironment): number {
  return isMobileCanvasEnvironment(env) ? MAX_RENDER_PIXELS_MOBILE : MAX_RENDER_PIXELS;
}

/** The viewport-derived working set, or `undefined` when the screen is unknown (a server, or a locked tab). */
export function viewportWorkingSet(
  env: CanvasEnvironment,
  capAreaFactor = CAP_AREA_FACTOR,
): number | undefined {
  const { screenWidth, screenHeight, devicePixelRatio } = env;
  if (!(screenWidth > 0) || !(screenHeight > 0)) return undefined;
  return Math.ceil(
    screenWidth * screenHeight * devicePixelRatio ** 2 * (1 + capAreaFactor / 100),
  );
}

/** Which of §6.1's ceilings set the number. */
export type CanvasCeilingSource = 'host' | 'platform' | 'viewport' | 'default';

export interface CanvasBudget {
  /** Device pixels a page canvas may cover. `0` is pdf.js's "CSS pixels only". */
  maxPixels: number;
  /** The ceiling that won, so a host can tell a cap from a bug. */
  applied: CanvasCeilingSource;
  /** Every candidate that was in play, including the ones the winner beat. */
  candidates: Partial<Record<CanvasCeilingSource, number>>;
}

/**
 * §6.1's combination rule: the effective ceiling is the **minimum** of the package default,
 * the viewport working set, the probed platform-safe ceiling and the host-configured budget.
 *
 * A host value therefore *constrains* and never overrides — `renderPixels: 200_000_000` on a
 * phone buys 33.5 Mpx, not 200 Mpx, because the ceiling exists to bound what the renderer
 * allocates rather than to record what the application asked for. `0` is the one host value
 * that is not a minimum: it is pdf.js's documented "render at CSS resolution", and it wins
 * by being smaller than everything.
 *
 * The probe contributes nothing until it has run, which is why `platformPixels` is optional:
 * the first paint is never waited for, and a page that arrives before the answer is capped by
 * the three ceilings that are already known.
 */
export function resolveCanvasBudget({
  env,
  hostPixels,
  platformPixels,
  capAreaFactor = CAP_AREA_FACTOR,
}: {
  env: CanvasEnvironment;
  hostPixels?: number;
  /** `null` is the shape the realm cache holds before the probe has answered, so it is accepted here. */
  platformPixels?: number | null;
  capAreaFactor?: number;
}): CanvasBudget {
  const candidates: Partial<Record<CanvasCeilingSource, number>> = {};
  if (typeof hostPixels === 'number' && Number.isFinite(hostPixels) && hostPixels >= 0) {
    candidates.host = hostPixels;
  }
  if (typeof platformPixels === 'number' && platformPixels > 0) candidates.platform = platformPixels;
  const viewport = viewportWorkingSet(env, capAreaFactor);
  if (viewport !== undefined) candidates.viewport = viewport;
  candidates.default = defaultRenderPixelsFor(env);

  // The minimum, then the first name in this list that equals it — so a tie is reported against
  // the more intentional ceiling (a host that asked for exactly the default hears that its own
  // value is in force) rather than against whichever candidate happened to be tested last.
  const order: CanvasCeilingSource[] = ['host', 'platform', 'viewport', 'default'];
  const values = order
    .map((source) => candidates[source])
    .filter((value): value is number => value !== undefined);
  const maxPixels = Math.min(...values);
  const applied = order.find((source) => candidates[source] === maxPixels) ?? 'default';
  return { maxPixels, applied, candidates };
}

/** The pdf.js mobile compatibility tier: iOS (including iPadOS, which reports `MacIntel`) and Android. */
export function isMobileCanvasEnvironment(env: CanvasEnvironment): boolean {
  return /Android/.test(env.userAgent)
    || /\b(?:iPad|iPhone|iPod)(?=;)/.test(env.userAgent)
    || (env.platform === 'MacIntel' && env.maxTouchPoints > 1);
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

/* -------------------------------------------------------------------- *
 * The platform-safe ceiling (§6.1: "Detection, not labels")
 * -------------------------------------------------------------------- */

/** The slice of a canvas surface the probe uses. A real element satisfies it, and so can a test. */
export interface ProbeCanvasLike {
  width: number;
  height: number;
  getContext(kind: '2d'): {
    fillStyle: string;
    fillRect(x: number, y: number, width: number, height: number): void;
    getImageData(x: number, y: number, width: number, height: number): { data: ArrayLike<number> };
  } | null;
}

export interface CanvasProbeOptions {
  /**
   * The largest area to try. Defaults to {@link MAX_RENDER_PIXELS}.
   *
   * The probe never allocates above it, which is what keeps a measurement that exists to bound
   * memory from costing more than the budget does: §6.1's combination rule is a minimum, so a
   * platform that clears the ceiling already in force has answered the only question that changes
   * an outcome. Callers pass `maxRenderPixelsFor(env)` — the class default and the viewport
   * working set, whichever is smaller — and that is also how a user-agent string is allowed to
   * lower the search without ever raising the result.
   */
  limit?: number;
  /** The first area tried. Small enough to be free on every platform, big enough to fail on a weak one. */
  start?: number;
  /** How much the area grows per step while searching upward. */
  factor?: number;
  /** A ceiling on allocations, so a surprising platform cannot make the search long. */
  maxSteps?: number;
  /** Makes a square surface of this side length, or returns null where no canvas exists. */
  createCanvas?: (side: number) => ProbeCanvasLike | null;
  /** Resolves once the surface has been composited. §6.1's second failure mode is a canvas that dies on the next frame. */
  nextFrame?: () => Promise<void>;
}

const PROBE_START_AREA = 2 ** 20;
const PROBE_FACTOR = 4;
const PROBE_MAX_STEPS = 12;

/**
 * A square surface of `side` px, painted in the far corner, read back.
 *
 * The readback is the only signal that means anything. Measured in Chromium on
 * 2026-10-03: a 512 Mpx canvas keeps the width it was given, `getContext('2d')` answers with a
 * live context, and the pixel at the corner where a red rectangle was just filled reads
 * `0,0,0,0`. A null context would have been easy and would have caught nothing.
 */
function paints(side: number, createCanvas: (side: number) => ProbeCanvasLike | null): boolean {
  const canvas = createCanvas(side);
  if (!canvas) return false;
  try {
    canvas.width = side;
    canvas.height = side;
    const context = canvas.getContext('2d');
    if (!context) return false;
    context.fillStyle = '#ff0000';
    context.fillRect(side - 2, side - 2, 2, 2);
    const { data } = context.getImageData(side - 1, side - 1, 1, 1);
    return data[0] === 255 && Boolean(data[3]);
  } catch {
    // An engine that refuses the allocation outright is answering the same question.
    return false;
  } finally {
    // Release the buffer: the probe's own peak must not be the sum of its steps.
    canvas.width = 0;
    canvas.height = 0;
  }
}

function defaultCreateCanvas(side: number): ProbeCanvasLike | null {
  const doc = (globalThis as typeof globalThis & { document?: Document }).document;
  if (!doc?.createElement) return null;
  return doc.createElement('canvas') as unknown as ProbeCanvasLike;
}

function composeFrame(): Promise<void> {
  const raf = (globalThis as typeof globalThis & { requestAnimationFrame?: (cb: () => void) => number })
    .requestAnimationFrame;
  if (!raf) return Promise.resolve();
  return new Promise((resolve) => {
    raf(() => raf(() => resolve()));
  });
}

/**
 * Probes the platform's real canvas ceiling, in device pixels.
 *
 * Grows geometrically from {@link PROBE_START_AREA} until a surface stops painting, then
 * bisects between the last surface that worked and the first that did not, and finally
 * re-checks the winner after a frame — a canvas that survives allocation and blanks on
 * composite is the failure §6.1 names explicitly. The search is bounded by `limit` and by
 * `maxSteps`, it releases every surface before allocating the next, and it waits for a frame
 * between surfaces, so its cost is one canvas at the ceiling plus a handful of steps spread over
 * frames rather than one block of them.
 *
 * Returns `null` for *no information* — no canvas factory (a server, a worker, a page with
 * canvas disabled), or a platform where even the first surface failed to paint. That is
 * deliberately not `0`: the budget treats it as "this ceiling is not in play" and falls back
 * to the package default, which is the answer the constants were written for.
 */
export async function probeCanvasCeiling(
  options: CanvasProbeOptions = {},
): Promise<number | null> {
  const limit = options.limit ?? MAX_RENDER_PIXELS;
  const factor = options.factor ?? PROBE_FACTOR;
  const maxSteps = options.maxSteps ?? PROBE_MAX_STEPS;
  const createCanvas = options.createCanvas ?? defaultCreateCanvas;
  const nextFrame = options.nextFrame ?? composeFrame;
  if (!createCanvas(1)) return null;

  let steps = 0;
  // Down, always: `Math.round` on a non-square area can push the side past the limit and make
  // the probe allocate more than the ceiling it exists to bound — measured with
  // `sqrt(5 242 880) = 2290.0…` rounding to 2290, whose square is 1 220 pixels over.
  const sideFor = (area: number): number => Math.floor(Math.sqrt(area));
  const fits = (area: number): boolean => {
    steps += 1;
    if (steps > maxSteps) return false;
    return paints(sideFor(area), createCanvas);
  };

  // One surface per frame, from the second onward. The reason is measured rather than theoretical: with
  // this yield the shell's whole search costs ~80 ms spread over six frames and its first surface lands a
  // few ms after the page's first paint, while the same search run without it was measured pushing that
  // first paint from ~270 ms to ~2 s. A synchronous ladder of big canvases is main-thread work a paint
  // would otherwise sit in front of, so yielding is what turns §6.1's "runs off the render path and never
  // delays a first paint" from a property of how busy the page happens to be into a property of the
  // search. `scripts/canvas-probe.mjs` reads the frame every surface landed on and fails if two share one.
  const probe = async (area: number): Promise<boolean> => {
    if (steps > 0) await nextFrame();
    return fits(area);
  };

  // The limit is always the last rung, so "everything below it works" is answered by testing it
  // rather than by stopping short and bisecting towards a number nobody measured.
  const rungs: number[] = [];
  for (let area = Math.min(options.start ?? PROBE_START_AREA, limit); area < limit; area *= factor) {
    rungs.push(area);
  }
  rungs.push(limit);

  let good = 0;
  let bad = limit;
  for (const area of rungs) {
    if (!(await probe(area))) {
      bad = area;
      break;
    }
    good = area;
  }
  if (good === 0) return null;

  // Bisect only after a failure, so the common desktop path is the ladder and nothing else. When
  // every rung held, `bad` is still the limit and there is nothing between them to look for — but
  // the frame check below still runs on that answer, because a surface that allocates and then
  // blanks is exactly what the ladder cannot see.
  while (good < bad && bad / good > 1.5 && steps <= maxSteps) {
    const middle = Math.sqrt(good * bad);
    if (await probe(middle)) good = middle;
    else bad = middle;
  }

  // The frame check runs on the answer, not on every candidate: this is the failure mode that
  // costs a blank page rather than a millisecond, and it is the one an allocation alone misses.
  // The second `probe` of the same area is the check itself — `probe` yields first, so this surface
  // is allocated on the frame after the one that proved it fits.
  let winner = good;
  while (winner > 1 && steps <= maxSteps) {
    if (!(await probe(winner))) {
      winner /= factor;
      continue;
    }
    if (await probe(winner)) return Math.floor(winner);
    winner /= factor;
  }
  return winner > 0 ? Math.floor(winner) : null;
}

let probedCeiling: number | null = null;
let probing: Promise<number | null> | null = null;

/** The probed ceiling for this realm, or `null` before the probe has answered. */
export function probedCanvasCeiling(): number | null {
  return probedCeiling;
}

/**
 * The platform ceiling, probing once per realm and caching the answer (§6.1: "for the
 * lifetime of the realm"). Concurrent callers share one probe, so two viewers mounting at
 * once measure once.
 */
export function ensureCanvasCeiling(options?: CanvasProbeOptions): Promise<number | null> {
  probing ??= probeCanvasCeiling(options).then((ceiling) => {
    probedCeiling = ceiling;
    return ceiling;
  });
  return probing;
}

/** Test seam: the realm memoisation is the thing a second call cannot undo. */
export function __resetCanvasCeilingForTests(): void {
  probedCeiling = null;
  probing = null;
}
