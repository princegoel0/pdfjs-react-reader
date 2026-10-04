/**
 * FR-57 / §6.1's "Detection, not labels": the platform-safe canvas ceiling is measured by
 * allocating, not inferred from a user-agent string.
 *
 * The signal being looked for is a pixel that comes back. Measured in Chromium on 2026-10-03: a 512 Mpx
 * canvas keeps the width it was given, `getContext('2d')` answers with a live context, and the rectangle
 * that was just filled reads `0,0,0,0` — so a probe that looked for a null context or a shrunk
 * `canvas.width` would report a ceiling of "unlimited" on a platform that cannot paint. Every fake here is
 * built to fail the way that measurement says a real one fails, and `scripts/canvas-probe.mjs` re-runs
 * the same code against a real engine, including the frame timeline this file's last describe asserts.
 *
 * The exit test for the package is the first case: a fake platform with a low ceiling changes
 * the outcome. The rest bound what the probe is allowed to cost, because a probe that allocates
 * 268 Mpx to prove a point is worse than the bug it finds.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  MAX_RENDER_PIXELS,
  MAX_RENDER_PIXELS_MOBILE,
  ensureCanvasCeiling,
  probeCanvasCeiling,
  probedCanvasCeiling,
  __resetCanvasCeilingForTests,
  type ProbeCanvasLike,
} from './canvas';

const M = 1024 * 1024;

/**
 * A platform that can hold `allocMax` device pixels, and — separately — can keep them after a
 * frame. The two are different failures and the probe has to tell them apart: the first is an
 * allocation that never happened, the second is a page that goes blank a beat later.
 */
function fakePlatform(allocMax: number, frameMax = allocMax) {
  const allocations: number[] = [];
  /** Which frame each surface was allocated on — `nextFrame` is what moves this counter. */
  const frames: number[] = [];
  let framesElapsed = 0;
  const createCanvas = (side: number): ProbeCanvasLike | null => {
    const area = side * side;
    allocations.push(area);
    frames.push(framesElapsed);
    const holds = framesElapsed === 0 ? area <= allocMax : area <= frameMax;
    return {
      width: 0,
      height: 0,
      getContext: () => ({
        fillStyle: '',
        fillRect: () => {},
        getImageData: () => ({ data: holds ? [255, 0, 0, 255] : [0, 0, 0, 0] }),
      }),
    };
  };
  const nextFrame = async () => {
    framesElapsed += 1;
  };
  return { createCanvas, nextFrame, allocations, frames };
}

afterEach(__resetCanvasCeilingForTests);

describe('probing the platform ceiling (FR-57)', () => {
  it('finds a ceiling below the package default', async () => {
    const platform = fakePlatform(6 * M);
    const ceiling = await probeCanvasCeiling({
      limit: MAX_RENDER_PIXELS,
      createCanvas: platform.createCanvas,
      nextFrame: platform.nextFrame,
    });
    // Within one bisection step of the truth, and never above it: an over-reported ceiling is
    // the failure this exists to prevent, so the test that matters is the upper bound.
    expect(ceiling).not.toBeNull();
    expect(ceiling!).toBeGreaterThan(4 * M);
    expect(ceiling!).toBeLessThanOrEqual(6 * M);
  });

  it('never allocates above the limit it was given', async () => {
    const platform = fakePlatform(256 * M);
    await probeCanvasCeiling({
      limit: MAX_RENDER_PIXELS,
      createCanvas: platform.createCanvas,
      nextFrame: platform.nextFrame,
    });
    // §6.1's probe exists to bound memory, so its own worst step must be the ceiling it is
    // measuring against — not the largest canvas the platform can be tricked into trying.
    expect(Math.max(...platform.allocations)).toBeLessThanOrEqual(MAX_RENDER_PIXELS);
  });

  it('answers the limit, quickly, on a platform that clears it', async () => {
    const platform = fakePlatform(256 * M);
    const ceiling = await probeCanvasCeiling({
      limit: MAX_RENDER_PIXELS,
      createCanvas: platform.createCanvas,
      nextFrame: platform.nextFrame,
    });
    expect(ceiling).toBe(MAX_RENDER_PIXELS);
    /*
     * Seven allocations, and the list is the receipt: one existence check, the 1 / 4 / 16 / 33.5
     * Mpx ladder, then the winner painted once before a frame and once after. That is the whole
     * cost of confirming the default on a desktop, and the search stops there because a bigger
     * answer cannot change a minimum. Note the last three entries are 33 547 264, not the
     * 33 554 432 asked for: a probe can only paint a square with whole sides, so it rounds the
     * side down and never allocates above its own limit.
     */
    expect(platform.allocations).toEqual([
      1, 1_048_576, 4_194_304, 16_777_216, 33_547_264, 33_547_264, 33_547_264,
    ]);
  });

  it('stops at a mobile-class limit, which is how a user-agent string is allowed to matter', async () => {
    const platform = fakePlatform(256 * M);
    const ceiling = await probeCanvasCeiling({
      limit: MAX_RENDER_PIXELS_MOBILE,
      createCanvas: platform.createCanvas,
      nextFrame: platform.nextFrame,
    });
    expect(ceiling).toBe(MAX_RENDER_PIXELS_MOBILE);
    expect(Math.max(...platform.allocations)).toBeLessThanOrEqual(MAX_RENDER_PIXELS_MOBILE);
  });

  it('lowers the answer when the surface survives allocation and dies on the next frame', async () => {
    // The failure §6.1 names in its own words, and the one an allocation-only probe cannot see.
    const platform = fakePlatform(256 * M, 2 * M);
    const ceiling = await probeCanvasCeiling({
      limit: MAX_RENDER_PIXELS,
      createCanvas: platform.createCanvas,
      nextFrame: platform.nextFrame,
    });
    expect(ceiling).not.toBeNull();
    expect(ceiling!).toBeLessThan(2.1 * M);
  });

  it('reports no information rather than zero where no canvas exists', async () => {
    const ceiling = await probeCanvasCeiling({ createCanvas: () => null });
    // `null` means "this ceiling is not in play"; `0` would mean "the platform can paint
    // nothing", and the budget would refuse every page on a server render.
    expect(ceiling).toBeNull();
  });

  it('reports no information when even the smallest surface fails', async () => {
    const platform = fakePlatform(0);
    const ceiling = await probeCanvasCeiling({
      limit: MAX_RENDER_PIXELS,
      createCanvas: platform.createCanvas,
      nextFrame: platform.nextFrame,
    });
    expect(ceiling).toBeNull();
  });

  it('bounds its own search', async () => {
    // A platform that answers "yes" to everything and never loses a frame still cannot make this
    // loop run on forever, and a step budget exhausted mid-search fails towards the small side.
    const platform = fakePlatform(Number.MAX_SAFE_INTEGER);
    const ceiling = await probeCanvasCeiling({
      limit: MAX_RENDER_PIXELS,
      maxSteps: 2,
      createCanvas: platform.createCanvas,
      nextFrame: platform.nextFrame,
    });
    expect(platform.allocations.length).toBeLessThanOrEqual(4);
    expect(ceiling === null || ceiling <= MAX_RENDER_PIXELS).toBe(true);
  });
});

describe('the search off the render path (FR-57)', () => {
  it('allocates one surface per frame from the second onward', async () => {
    const platform = fakePlatform(256 * M);
    await probeCanvasCeiling({
      limit: MAX_RENDER_PIXELS,
      createCanvas: platform.createCanvas,
      nextFrame: platform.nextFrame,
    });
    // The 1×1 existence check shares frame 0 with the first rung; every real surface after it gets a
    // frame of its own. Measured in Chromium this is what the harness reads: the ladder used to allocate
    // all of its rungs inside one frame, and a realm's first big canvas costs ~900 ms in that frame —
    // work a first paint would otherwise sit in front of. Removing the yield collapses this list to
    // zeros, which is the regression this assertion exists to catch.
    const surfaces = platform.allocations
      .map((area, index) => ({ area, frame: platform.frames[index] }))
      .filter((surface) => surface.area > 1);
    expect(surfaces.map((surface) => surface.frame)).toEqual(
      surfaces.map((_, index) => index),
    );
  });
});

describe('one probe per realm (FR-57)', () => {
  it('caches the answer and shares it between callers', async () => {
    const platform = fakePlatform(6 * M);
    const options = {
      limit: MAX_RENDER_PIXELS,
      createCanvas: platform.createCanvas,
      nextFrame: platform.nextFrame,
    };
    const [first, second] = await Promise.all([
      ensureCanvasCeiling(options),
      ensureCanvasCeiling(options),
    ]);
    expect(first).toBe(second);
    expect(first).toBe(probedCanvasCeiling());
    // Two viewers mounting at once measure once — the allocations are the evidence, not a spy
    // on the promise identity, which a second call could satisfy while still allocating twice.
    const before = platform.allocations.length;
    await ensureCanvasCeiling(options);
    expect(platform.allocations).toHaveLength(before);
  });

  it('hands the cached number to a caller that never triggers a probe', async () => {
    const platform = fakePlatform(6 * M);
    await ensureCanvasCeiling({
      limit: MAX_RENDER_PIXELS,
      createCanvas: platform.createCanvas,
      nextFrame: platform.nextFrame,
    });
    const read = vi.fn();
    await ensureCanvasCeiling({ limit: MAX_RENDER_PIXELS, createCanvas: read });
    expect(read).not.toHaveBeenCalled();
    expect(probedCanvasCeiling()).toBeGreaterThan(4 * M);
  });
});
