/*
 * FR-57's wiring: the shell is the place where §6.1's four ceilings meet.
 *
 * `src/lib/canvas.budget.test.ts` proves the arithmetic; this file proves the shell uses it,
 * because the two fail differently. A pure function can be right and still be bypassed — the
 * line this replaced was `maxRenderPixels ?? autoRenderPixels`, which was a correct reading of
 * the host's prop and a wrong answer about the budget. So the assertions here are about the
 * value the shell hands to its pages and about what happens when the probe answers *after* the
 * first paint: the pages must be re-resolved, or the measured ceiling is a number nobody acts on.
 *
 * The probe is driven through a stubbed `requestAnimationFrame` and a stubbed
 * `ensureCanvasCeiling`, which is the honest shape of this test: jsdom has no canvas memory to
 * measure, so the platform's real number is measured in Chromium (`.spike/canvas-probe-browser.mjs`)
 * and what is tested here is what the shell does with an answer.
 */
import { act, cleanup, render, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import { useViewerController } from './ViewerController';
import { MAX_RENDER_PIXELS } from '../lib/canvas';

class ObserverStub {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}
globalThis.ResizeObserver = ObserverStub as unknown as typeof ResizeObserver;

/**
 * `cached` is what the realm already knows at mount (so the hook can skip the probe entirely),
 * `answer` is what the probe resolves to, and `gate` holds that answer back until the test opens
 * it. The gate is what makes "the ceiling landed after the first paint" a moment the test controls
 * rather than a race it hopes to win — without it, whether the answer arrived before or after the
 * assertions depended on how loaded the runner was.
 */
const probeState = vi.hoisted(() => {
  let open: () => void = () => undefined;
  const closed = new Promise<void>((resolve) => {
    open = resolve;
  });
  return {
    cached: null as number | null,
    answer: null as number | null,
    gate: Promise.resolve() as Promise<void>,
    closed,
    open: () => open(),
  };
});

vi.mock('../lib/canvas', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  probedCanvasCeiling: () => probeState.cached,
  ensureCanvasCeiling: vi.fn(async () => {
    await probeState.gate;
    return probeState.answer;
  }),
}));

/**
 * One document object, shared across every render.
 *
 * The mock below must hand back the *same* `doc` each call: the controller keys effects on it, so
 * a literal built inside the mock re-runs them on every render and the harness loops until Node
 * runs out of heap. That is a property of the shell worth knowing, and it is why the destination
 * test beside this file defines its fake at module scope too.
 */
const fakeDoc = {
  numPages: 1,
  getPage: async () => {
    throw new Error('this test never paints a page');
  },
  getOptionalContentConfig: async () => ({}),
  getOutline: async () => null,
  getPageLabels: async () => null,
  getMetadata: async () => ({ info: {}, metadata: null }),
  cleanup: () => {},
} as unknown as PDFDocumentProxy;

vi.mock('../headless/usePdfDocument', () => ({
  usePdfDocument: () => ({
    status: 'ready',
    doc: fakeDoc,
    numPages: 1,
    isReady: true,
    error: null,
    capabilities: null,
    passwordRequest: null,
    reload: vi.fn(),
  }),
}));

/**
 * jsdom reports no screen at all (`screen.availWidth` is 0), so the working-set candidate is
 * absent here and the shell runs on the package default. The case where a screen *is* known is
 * written below by replacing `globalThis.screen`, because the wiring deserves a test on both
 * sides of that branch rather than only the one the environment happens to give.
 */
const SCREEN = { availWidth: 1280, availHeight: 720 };
const WORKING_SET = Math.ceil(1280 * 720 * 1 * (1 + 200 / 100));

const probe: {
  controller: ReturnType<typeof useViewerController> | null;
} = { controller: null };

function Probe({ maxRenderPixels }: { maxRenderPixels?: number }) {
  const controller = useViewerController({
    src: '/fixtures/labelled-sample.pdf',
    defaultScale: 1,
    ...(maxRenderPixels === undefined ? null : { maxRenderPixels }),
  });
  probe.controller = controller;
  return null;
}

async function mount(props: { maxRenderPixels?: number } = {}) {
  await act(async () => {
    render(<Probe {...props} />);
  });
  const controller = probe.controller;
  if (!controller) throw new Error('the probe never published its controller');
  return controller;
}

afterEach(() => {
  cleanup();
  probe.controller = null;
  probeState.cached = null;
  probeState.answer = null;
  probeState.gate = Promise.resolve();
});

/** The two frames the hook waits for, each scheduled on the next macrotask. */
function stubFrames() {
  let frames = 0;
  return vi
    .spyOn(globalThis, 'requestAnimationFrame')
    .mockImplementation((callback: FrameRequestCallback) => {
      frames += 1;
      setTimeout(() => callback(frames * 16), 0);
      return frames;
    });
}

describe('the shell applies §6.1’s minimum (FR-57)', () => {
  it('reports the package default when the environment cannot say what its screen is', async () => {
    const controller = await mount();
    expect(controller.renderBudget.candidates.viewport).toBeUndefined();
    expect(controller.renderBudget.maxPixels).toBe(MAX_RENDER_PIXELS);
    expect(controller.renderBudget.applied).toBe('default');
    expect(controller.renderPixels).toBe(MAX_RENDER_PIXELS);
  });

  it('lets the viewport working set win when there is a screen to measure', async () => {
    const original = globalThis.screen;
    Reflect.set(globalThis, 'screen', SCREEN);
    try {
      const controller = await mount();
      expect(controller.renderBudget.applied).toBe('viewport');
      expect(controller.renderPixels).toBe(WORKING_SET);
    } finally {
      Reflect.set(globalThis, 'screen', original);
    }
  });

  it('lets a host budget that asks for less win', async () => {
    const controller = await mount({ maxRenderPixels: 1_000_000 });
    expect(controller.renderBudget.applied).toBe('host');
    expect(controller.renderPixels).toBe(1_000_000);
  });

  it('refuses a host budget that asks for more, and says so', async () => {
    const controller = await mount({ maxRenderPixels: MAX_RENDER_PIXELS * 6 });
    // The clause: a bigger number from the host does not buy a bigger canvas.
    expect(controller.renderPixels).toBe(MAX_RENDER_PIXELS);
    expect(controller.renderBudget.applied).toBe('default');
    // And the number the host asked for is still visible, so `applied` can be trusted.
    expect(controller.renderBudget.candidates.host).toBe(MAX_RENDER_PIXELS * 6);
  });

  it('takes the probed platform ceiling when it lands, and repaints the pages under it', async () => {
    const raf = stubFrames();
    probeState.answer = 1_500_000;
    probeState.gate = probeState.closed;

    const controller = await mount();
    // The first paint is always under the assumed ceiling, because the probe has not answered yet.
    expect(controller.renderBudget.applied).toBe('default');
    expect(controller.contentVersion).toBe(0);

    probeState.open();
    await waitFor(() => expect(probe.controller?.renderBudget.applied).toBe('platform'), {
      timeout: 2000,
    });

    const after = probe.controller;
    if (!after) throw new Error('the probe vanished');
    expect(after.renderPixels).toBe(1_500_000);
    // The pages on screen were painted under the old ceiling, so the shell redraws them.
    expect(after.contentVersion).toBeGreaterThan(0);
    raf.mockRestore();
  });

  it('does not repaint when the probe finds nothing below the ceiling in force', async () => {
    const raf = stubFrames();
    probeState.answer = 40_000_000;
    const controller = await mount();
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
    const after = probe.controller;
    if (!after) throw new Error('the probe vanished');
    // A platform that clears the default changes nothing, because the rule is a minimum — and the
    // repaint is the thing that must not happen, since it costs every page on screen a full pass.
    expect(after.renderBudget.applied).toBe('default');
    expect(after.renderPixels).toBe(MAX_RENDER_PIXELS);
    expect(after.contentVersion).toBe(controller.contentVersion);
    raf.mockRestore();
  });
});
