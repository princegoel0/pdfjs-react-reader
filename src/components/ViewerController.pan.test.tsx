/*
 * FR-47 on an engine that cannot arbitrate a pan (#211 / #225): the shell still scrolls.
 *
 * The advertised peer floor, `pdfjs-dist@6.2.108`, has no `onPanning` option at all. Its `TouchManager`
 * claims every two-finger `touchmove` with `preventDefault` + `stopPropagation` and then reports only
 * pinching, so on that release a two-finger drag inside the viewer moves nothing — not the document, not the
 * host page. That is what the browser matrix reported at the floor on 2026-10-04:
 * `a two-finger pan moved neither the page nor the scroll position`, with 22 other checks green.
 *
 * The controller now asks the installed class whether it hands panning back (`src/lib/touch-pan.ts`) and,
 * when it does not, scrolls the container itself. These tests drive the real shell against both engine
 * shapes, because the answer changes what is attached and only the mounted controller can show that.
 *
 * Measured on 2026-10-05 by breaking each half in turn and restoring it byte-for-byte (the battery is
 * `.spike/counterfactual-225.mjs`, and its CF0 run of the unmutated tree reported 20 passed / 0 failed, so the
 * failures below are the mutations and not the harness):
 *  - with `addTwoFingerPan` never called: **1 failed** — `expected 200 to be 150`, the document not moving,
 *    which is the defect being closed;
 *  - with the probe answering `reportsPanning: true` whatever it sees: **2 failed** — this file's floor-engine
 *    pan above, and the lib's “gets a false answer from an engine that has no onPanning”;
 *  - with the probe answering `reportsPanning: false` whatever it sees: **2 failed** — the lib's true-answer
 *    case, and here `expected 100 to be 150`, which is the double scroll: our handler and the engine's own
 *    callback both moving the same drag;
 *  - with the span guard removed from `addTwoFingerPan`: **1 failed** — `expected 270 to be 200`, a pinch that
 *    also scrolled, asserted in `src/lib/touch-pan.test.tsx` where the guard lives.
 *
 * The one thing this file deliberately does *not* claim: that the probe's “could not ask” default is
 * load-bearing here. When the manager cannot be constructed the controller returns before it ever asks, so
 * that default is guarded in the lib test instead, where flipping it fails
 * `does not overrule an engine it could not ask` (`expected { reportsPanning: false, … } to deeply equal
 * { reportsPanning: true, … }`).
 */
import { act, cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ViewerLayout } from './ViewerLayout';
import { ViewerProvider } from './ViewerContext';
import { useViewerController } from './ViewerController';
import {
  FloorTouchManager,
  ReportingTouchManager,
  twoFingerSequence,
  type ManagerOptions,
} from '../lib/touch-engine-stand-ins';

// The toolbar measures its own overflow and the virtualizer measures the scroll container; jsdom has neither.
class ObserverStub {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}
globalThis.ResizeObserver = ObserverStub as unknown as typeof ResizeObserver;

// No document: the gesture is answered by the controller's scale and the container's scroll position, and
// loading a real one in jsdom is a separate, older problem (#175).
vi.mock('../headless/usePdfDocument', () => ({
  usePdfDocument: () => ({
    status: 'loading',
    doc: null,
    numPages: 0,
    isReady: false,
    capabilities: null,
    error: null,
    passwordRequest: null,
    reload: vi.fn(),
  }),
}));

afterEach(cleanup);

/**
 * Which stand-in the mocked `TouchManager` instantiates, chosen per test.
 *
 * Hoisted because the `vi.mock` factory runs when the module graph is first imported, long before any test
 * body: the factory may close over nothing that a test declares.
 */
type EngineCtor = new (options: ManagerOptions) => object;
const engine = vi.hoisted(() => ({ impl: null as unknown as EngineCtor }));

vi.mock('pdfjs-dist', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    // A function, not a class: `new` on a function that returns an object hands back that object, and a class
    // whose constructor returns a stand-in has to argue with the type system about its own instance type.
    TouchManager: function TouchManagerProxy(this: unknown, options: ManagerOptions) {
      return new engine.impl(options);
    },
  };
});

let controller: ReturnType<typeof useViewerController> | null = null;

/** Mount the shell on one engine shape and hand back its scroll container. */
function viewportWith(impl: EngineCtor): HTMLElement {
  engine.impl = impl;
  const view = render(<Shell />);
  const el = view.container.querySelector<HTMLElement>('.pjsr-viewport');
  if (!el) throw new Error('no viewport to aim a gesture at');
  el.scrollTop = 200;
  return el;
}

const scale = () => controller?.resolvedScale ?? 0;

describe('the shell on the engine advertised as the floor (FR-47)', () => {
  it('scrolls the document for a two-finger drag, even though the engine reports no panning', () => {
    const el = viewportWith(FloorTouchManager);
    twoFingerSequence(el, { x: 100, y: 100 }, 50, [25, 50]);
    // 200 → 150: the fingers travelled 50 points down, so the document came up by 50.
    expect(el.scrollTop).toBe(150);
  });

  it('does not zoom the gesture it just scrolled', () => {
    const el = viewportWith(FloorTouchManager);
    const before = scale();
    twoFingerSequence(el, { x: 100, y: 100 }, 50, [25, 50]);
    expect(scale()).toBe(before);
  });

  it('still zooms on a spread, which stays the engine’s answer', () => {
    const el = viewportWith(FloorTouchManager);
    const before = scale();
    const finger = (id: number, x: number, y: number) => ({
      identifier: id,
      clientX: x,
      clientY: y,
      screenX: x,
      screenY: y,
    });
    const fire = (type: string, list: unknown[], changed: unknown[]) => {
      const event = new Event(type, { bubbles: true, cancelable: true });
      Object.defineProperty(event, 'touches', { value: list });
      Object.defineProperty(event, 'changedTouches', { value: changed });
      act(() => {
        el.dispatchEvent(event);
      });
    };
    fire('touchstart', [finger(0, 75, 100)], [finger(0, 75, 100)]);
    fire('touchstart', [finger(0, 75, 100), finger(1, 125, 100)], [finger(1, 125, 100)]);
    fire('touchmove', [finger(0, 25, 100), finger(1, 175, 100)], [finger(0, 25, 100), finger(1, 175, 100)]);
    fire('touchmove', [finger(0, 0, 100), finger(1, 200, 100)], [finger(0, 0, 100), finger(1, 200, 100)]);
    expect(scale()).toBeGreaterThan(before);
  });
});

describe('the shell on an engine that reports panning (FR-47)', () => {
  it('scrolls exactly once per drag, on the engine’s own callback', () => {
    const el = viewportWith(ReportingTouchManager);
    twoFingerSequence(el, { x: 100, y: 100 }, 50, [25, 50]);
    // 200 → 150 and not 100: had the package also attached its fallback here, every step would move twice.
    expect(el.scrollTop).toBe(150);
  });

  it('leaves no handler of ours behind when the engine will not construct', () => {
    // The fallback is attached only after the manager exists. Attach it first and a manager that throws — an
    // engine whose constructor the peer range outgrew — leaves our scroll handler on a container where
    // nothing prevents the browser's own pan, so the document moves twice for one drag.
    engine.impl = class {
      constructor(_options: ManagerOptions) {
        throw new Error('this TouchManager cannot be constructed');
      }
    };
    const el = viewportWith(engine.impl);
    twoFingerSequence(el, { x: 100, y: 100 }, 50, [25, 50]);
    expect(el.scrollTop).toBe(200);
  });

  it('mounts no arbitration at all when the affordance is refused', () => {
    // FR-28 prices each affordance separately, so `enablePinchZoom: false` has to leave neither the engine's
    // claim nor ours on the container. A stray pan handler here would be a gesture the host switched off and
    // did not get switched off — and with no manager preventing the browser's own pan it would scroll twice.
    let constructions = 0;
    engine.impl = class CountedManager extends ReportingTouchManager {
      constructor(options: ManagerOptions) {
        super(options);
        constructions += 1;
      }
    };

    const view = render(<Shell enablePinchZoom={false} />);
    const el = view.container.querySelector<HTMLElement>('.pjsr-viewport')!;
    el.scrollTop = 200;
    twoFingerSequence(el, { x: 100, y: 100 }, 50, [25, 50]);
    expect(constructions).toBe(0);
    expect(el.scrollTop).toBe(200);
  });
});

function Shell({ enablePinchZoom = true }: { enablePinchZoom?: boolean }) {
  controller = useViewerController({ src: '/fixtures/outline-sample.pdf', enablePinchZoom });
  return (
    <ViewerProvider controller={controller}>
      <ViewerLayout controller={controller} />
    </ViewerProvider>
  );
}
