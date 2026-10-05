/**
 * Two `TouchManager` stand-ins, transcribed from real engines, for tests that need a gesture arbiter whose
 * behaviour is known rather than installed.
 *
 * They exist because the panning question (#211) is answered by asking the engine, so the guard has to be
 * able to present an engine that answers each way. The floor's shape is read off
 * `.spike/engine-62108/package/build/pdf.mjs:4797-4955`, taken from `npm pack pdfjs-dist@6.2.108` on
 * 2026-10-05; the reporting shape is read off `node_modules/pdfjs-dist/build/pdf.mjs:4824-5071` at 6.3.289.
 * What matters is kept, what does not is left out: neither stand-in reads `screenX` for the span the way the
 * engines do, because a test supplies both coordinates identical, and neither reproduces the engine's
 * unconfirmed-pinch reversal.
 *
 * These are not the package's code and are not exported from any entry point.
 */

export interface ManagerOptions {
  container: HTMLElement;
  signal: AbortSignal;
  onPinchStart?: () => void;
  onPinching?: (origin: [number, number], previous: number, current: number) => void;
  onPanning?: (dx: number, dy: number) => void;
}

interface Finger {
  identifier: number;
  clientX: number;
  clientY: number;
  screenX: number;
  screenY: number;
}

interface TouchEventLike extends Event {
  touches: ArrayLike<Finger>;
}

const pairOf = (event: TouchEventLike): [Finger, Finger] | null =>
  event.touches.length === 2 ? [event.touches[0] as Finger, event.touches[1] as Finger] : null;

const spanOf = ([a, b]: [Finger, Finger]) => Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);

/**
 * `6.2.108`: arms `touchmove` on the second finger, prevents it, and reports only pinching.
 *
 * The real class computes a span threshold from `MIN_TOUCH_DISTANCE_TO_PINCH` and returns early when the
 * span has not changed — and on that release it reads the constant off the *constructor* while declaring it
 * as an instance getter, so the comparison is against `undefined`, which is false, so a same-span drag is
 * treated as a pinch and reported to `onPinching` with a ratio of one. The load-bearing fact for us is the
 * one the option bag shows: **there is no `onPanning` to call**, and the move was already prevented.
 */
export class FloorTouchManager {
  /** `35 / OutputScale.pixelRatio`, which is 35 at a pixel ratio of 1. */
  get MIN_TOUCH_DISTANCE_TO_PINCH(): number {
    return 35;
  }

  constructor(options: ManagerOptions) {
    const { container, signal } = options;
    let armed = false;
    let previous = 0;
    container.addEventListener(
      'touchstart',
      (raw) => {
        const event = raw as TouchEventLike;
        const fingers = pairOf(event);
        if (!fingers) return;
        if (!armed) {
          armed = true;
          container.addEventListener('touchmove', onMove, { signal, passive: false });
          options.onPinchStart?.();
        }
        previous = spanOf(fingers);
        event.preventDefault();
        event.stopPropagation();
      },
      { signal, passive: false },
    );
    const onMove = (raw: Event) => {
      const event = raw as TouchEventLike;
      const fingers = pairOf(event);
      if (!fingers) return;
      event.preventDefault();
      event.stopPropagation();
      const current = spanOf(fingers);
      options.onPinching?.([0, 0], previous, current);
      previous = current;
    };
  }
}

/**
 * `6.3.289` and later: the same claim on the move, then a callback for whichever gesture it decides the
 * span describes — `onPanning` when only the midpoint travelled, `onPinching` when the span changed.
 */
export class ReportingTouchManager {
  get MIN_TOUCH_DISTANCE_TO_PINCH(): number {
    return 35;
  }

  constructor(options: ManagerOptions) {
    const { container, signal } = options;
    let armed = false;
    let previous = 0;
    let pan: { x: number; y: number } | null = null;
    container.addEventListener(
      'touchstart',
      (raw) => {
        const event = raw as TouchEventLike;
        const fingers = pairOf(event);
        if (!fingers) return;
        if (!armed) {
          armed = true;
          container.addEventListener('touchmove', onMove, { signal, passive: false });
          options.onPinchStart?.();
        }
        previous = spanOf(fingers);
        const [a, b] = fingers;
        pan = { x: (a.clientX + b.clientX) / 2, y: (a.clientY + b.clientY) / 2 };
        event.preventDefault();
        event.stopPropagation();
      },
      { signal, passive: false },
    );
    const onMove = (raw: Event) => {
      const event = raw as TouchEventLike;
      const fingers = pairOf(event);
      if (!fingers || !pan) return;
      event.preventDefault();
      event.stopPropagation();
      const [a, b] = fingers;
      const x = (a.clientX + b.clientX) / 2;
      const y = (a.clientY + b.clientY) / 2;
      const current = spanOf(fingers);
      if (Math.abs(current - previous) <= this.MIN_TOUCH_DISTANCE_TO_PINCH) {
        options.onPanning?.(x - pan.x, y - pan.y);
      } else {
        options.onPinching?.([pan.x, pan.y], previous, current);
      }
      previous = current;
      pan = { x, y };
    };
  }
}

/** The gesture the panning question turns on: two fingers, fixed span, travelling together. */
export function twoFingerSequence(
  el: HTMLElement,
  from: { x: number; y: number },
  gap: number,
  steps: number[],
): { first: Event; last: Event } {
  const finger = (id: number, x: number, y: number): Finger => ({
    identifier: id,
    clientX: x,
    clientY: y,
    screenX: x,
    screenY: y,
  });
  const fire = (type: string, all: Finger[], changed: Finger[]) => {
    const event = new Event(type, { bubbles: true, cancelable: true });
    Object.defineProperties(event, {
      touches: { value: all },
      changedTouches: { value: changed },
    });
    el.dispatchEvent(event);
    return event;
  };
  const a = finger(0, from.x - gap / 2, from.y);
  const b = finger(1, from.x + gap / 2, from.y);
  const first = fire('touchstart', [a], [a]);
  fire('touchstart', [a, b], [b]);
  let last = first;
  for (const dy of steps) {
    const movedA = finger(0, from.x - gap / 2, from.y + dy);
    const movedB = finger(1, from.x + gap / 2, from.y + dy);
    last = fire('touchmove', [movedA, movedB], [movedA, movedB]);
  }
  return { first, last };
}
