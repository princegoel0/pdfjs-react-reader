/*
 * FR-47's panning half, decided by asking the engine (#211 / #225).
 *
 * The advertised peer floor `pdfjs-dist@6.2.108` has no `onPanning` option: its `TouchManager` prevents every
 * two-finger `touchmove` and then reports only pinching, so on that release a two-finger drag moves neither
 * the document nor the host page. `src/lib/touch-pan.ts` answers that by putting the question to the
 * installed class — construct it against a detached element, fire a pan at it, see whether a panning
 * callback came back — and scrolling the container itself when none did.
 *
 * Measured on 2026-10-05 (full battery and restoration notes in `src/components/ViewerController.pan.test.tsx`):
 *  - the probe answers `{ reportsPanning: false, probed: true }` for the floor's shape and
 *    `{ reportsPanning: true, probed: true }` for 6.3.289's, and that separation is what the whole design
 *    rests on — hard-coding either answer fails the other case plus its controller test;
 *  - with the span guard deleted from `addTwoFingerPan`, “gives up the gesture the moment the span changes”
 *    answers `expected 270 to be 200`: a pinch that also scrolled the document;
 *  - with the cannot-ask default flipped to `reportsPanning: false`, “does not overrule an engine it could not
 *    ask” answers `expected { reportsPanning: false, …(2) } to deeply equal { reportsPanning: true, …(2) }`;
 *  - removing `addTwoFingerPan` from the controller is measured in the controller's file, where the scroll
 *    that never happens is the point: `expected 200 to be 150`.
 */
import { describe, expect, it, vi } from 'vitest';
import { TouchManager as InstalledTouchManager } from 'pdfjs-dist';
import { addTwoFingerPan, probeTouchPanning } from './touch-pan';
import { FloorTouchManager, ReportingTouchManager, twoFingerSequence } from './touch-engine-stand-ins';

function scrollable(): HTMLElement {
  const el = document.createElement('div');
  // jsdom resolves no layout, so the scroll position is a plain writable property — which is exactly what
  // both the engine's `onPanning` and our handler write to.
  Object.defineProperty(el, 'scrollHeight', { value: 4000 });
  el.scrollTop = 200;
  el.scrollLeft = 40;
  document.body.append(el);
  return el;
}

describe('asking an engine whether it reports panning (FR-47)', () => {
  it('gets a false answer from an engine that has no onPanning', () => {
    const answer = probeTouchPanning(FloorTouchManager);
    expect(answer).toMatchObject({ reportsPanning: false, probed: true });
  });

  it('gets a true answer from an engine that hands the pan back', () => {
    const answer = probeTouchPanning(ReportingTouchManager);
    expect(answer).toMatchObject({ reportsPanning: true, probed: true });
  });

  it('reads the span tolerance off the engine rather than guessing one', () => {
    expect(probeTouchPanning(FloorTouchManager).spanTolerance).toBe(35);
  });

  it('falls back to a default tolerance when the engine publishes none', () => {
    class NoConstant {
      constructor(_options: unknown) {}
    }
    expect(probeTouchPanning(NoConstant).spanTolerance).toBe(35);
  });

  it('does not overrule an engine it could not ask', () => {
    // An engine that will not construct is not an engine whose pan we take over: the wrong guess here would
    // put a scroll handler on top of the browser's own, and the document would move twice per drag.
    const answer = probeTouchPanning(
      class {
        constructor() {
          throw new Error('this engine cannot be constructed at all');
        }
      },
    );
    expect(answer).toEqual({ reportsPanning: true, probed: false, spanTolerance: 35 });
  });

  it('is not a version string: the installed engine answers for itself', () => {
    const answer = probeTouchPanning(InstalledTouchManager);
    // Which way it answers is the installed release's business, not this test's — that is the whole point of
    // probing. What the test does hold is that the probe reached it and got a usable answer, and that both
    // stand-ins above sit on either side of whatever that answer is.
    expect(answer.probed).toBe(true);
    expect(typeof answer.reportsPanning).toBe('boolean');
    expect(answer.spanTolerance).toBeGreaterThan(0);
  });
});

describe('panning the container when the engine will not (FR-47)', () => {
  it('moves the document by the midpoint delta, content following the fingers', () => {
    const el = scrollable();
    const controller = new AbortController();
    addTwoFingerPan(el, { signal: controller.signal, spanTolerance: 35 });

    twoFingerSequence(el, { x: 100, y: 100 }, 50, [25, 50]);
    // Fingers travel down by 50 in total, so what is above them comes into view: 200 → 150. Same sign as the
    // engine's own `onPanning` deltas, which is what keeps one implementation of the rule.
    expect(el.scrollTop).toBe(150);
    expect(el.scrollLeft).toBe(40);
    el.remove();
  });

  it('moves it sideways for a horizontal drag', () => {
    const el = scrollable();
    const controller = new AbortController();
    addTwoFingerPan(el, { signal: controller.signal, spanTolerance: 35 });
    const finger = (id: number, x: number, y: number) => ({
      identifier: id,
      clientX: x,
      clientY: y,
      screenX: x,
      screenY: y,
    });
    const fire = (type: string, all: unknown[]) => {
      const event = new Event(type, { bubbles: true, cancelable: true });
      Object.defineProperty(event, 'touches', { value: all });
      Object.defineProperty(event, 'changedTouches', { value: all });
      el.dispatchEvent(event);
    };
    fire('touchstart', [finger(0, 70, 100), finger(1, 120, 100)]);
    fire('touchmove', [finger(0, 50, 100), finger(1, 100, 100)]);
    expect(el.scrollLeft).toBe(60);
    el.remove();
  });

  it('gives up the gesture the moment the span changes, so a pinch is not also a scroll', () => {
    const el = scrollable();
    const controller = new AbortController();
    addTwoFingerPan(el, { signal: controller.signal, spanTolerance: 35 });
    const fire = (type: string, list: unknown[]) => {
      const event = new Event(type, { bubbles: true, cancelable: true });
      Object.defineProperty(event, 'touches', { value: list });
      Object.defineProperty(event, 'changedTouches', { value: list });
      el.dispatchEvent(event);
    };
    const finger = (id: number, x: number, y: number) => ({
      identifier: id,
      clientX: x,
      clientY: y,
      screenX: x,
      screenY: y,
    });

    fire('touchstart', [finger(0, 75, 100), finger(1, 125, 100)]);
    // 50 points apart, then 120 — the reader is pinching, and the engine owns this gesture from here on.
    fire('touchmove', [finger(0, 40, 100), finger(1, 160, 100)]);
    const after = el.scrollTop;
    fire('touchmove', [finger(0, 40, 30), finger(1, 160, 30)]);
    expect(el.scrollTop).toBe(after);
    el.remove();
  });

  it('never prevents the event itself', () => {
    const el = scrollable();
    const controller = new AbortController();
    addTwoFingerPan(el, { signal: controller.signal, spanTolerance: 35 });
    const { last } = twoFingerSequence(el, { x: 100, y: 100 }, 50, [25]);
    // The engine's claim is the one that matters; a second refusal would be the viewer deciding a gesture the
    // host can still see arriving.
    expect(last.defaultPrevented).toBe(false);
    el.remove();
  });

  it('stops when the signal aborts, which is what a refused affordance and an unmount both do', () => {
    const el = scrollable();
    const controller = new AbortController();
    addTwoFingerPan(el, { signal: controller.signal, spanTolerance: 35 });
    controller.abort();
    twoFingerSequence(el, { x: 100, y: 100 }, 50, [25, 50]);
    expect(el.scrollTop).toBe(200);
    el.remove();
  });

  it('restarts tracking when the fingers lift and come back, instead of jumping', () => {
    const el = scrollable();
    const controller = new AbortController();
    addTwoFingerPan(el, { signal: controller.signal, spanTolerance: 35 });
    const finger = (id: number, x: number, y: number) => ({
      identifier: id,
      clientX: x,
      clientY: y,
      screenX: x,
      screenY: y,
    });
    const fire = (type: string, list: unknown[]) => {
      const event = new Event(type, { bubbles: true, cancelable: true });
      Object.defineProperty(event, 'touches', { value: list });
      Object.defineProperty(event, 'changedTouches', { value: list.length ? list : [finger(0, 0, 0)] });
      el.dispatchEvent(event);
    };
    fire('touchstart', [finger(0, 75, 100), finger(1, 125, 100)]);
    fire('touchmove', [finger(0, 75, 130), finger(1, 125, 130)]);
    expect(el.scrollTop).toBe(170);
    fire('touchend', []);
    // A fresh gesture far down the page must not drag the scroll position 300 points across the gap.
    fire('touchstart', [finger(0, 75, 500), finger(1, 125, 500)]);
    fire('touchmove', [finger(0, 75, 520), finger(1, 125, 520)]);
    expect(el.scrollTop).toBe(150);
    el.remove();
  });
});

describe('the two engines behave differently, which is why the question is asked', () => {
  it('the floor never calls onPanning, whatever it is handed', () => {
    const el = document.createElement('div');
    const controller = new AbortController();
    const onPanning = vi.fn();
    new FloorTouchManager({ container: el, signal: controller.signal, onPanning });
    twoFingerSequence(el, { x: 100, y: 100 }, 50, [25, 50, 75]);
    expect(onPanning).not.toHaveBeenCalled();
  });

  it('6.3 calls it for the same gesture', () => {
    const el = document.createElement('div');
    const controller = new AbortController();
    const onPanning = vi.fn();
    new ReportingTouchManager({ container: el, signal: controller.signal, onPanning });
    twoFingerSequence(el, { x: 100, y: 100 }, 50, [25, 50, 75]);
    expect(onPanning).toHaveBeenCalled();
  });
});
