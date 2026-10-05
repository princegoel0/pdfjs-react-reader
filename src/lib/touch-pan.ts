/**
 * Two-finger panning, decided by asking the engine rather than by reading its version.
 *
 * pdf.js's `TouchManager` claims a two-finger `touchmove` with `preventDefault` and `stopPropagation` before
 * it knows whether the span between the fingers changed (FR-47: a pinch zooms, a pan scrolls, and one
 * physical gesture cannot answer twice). Releases from `6.3` hand the pan back through an `onPanning`
 * callback; the advertised peer floor `6.2.108` has no such option — its constructor destructures
 * `container, isPinchingDisabled, isPinchingStopped, onPinchStart, onPinching, onPinchEnd, signal` and its
 * `#onTouchMove` returns without doing anything when the span is unchanged, *after* having prevented the
 * browser's own scroll. On that engine a two-finger drag moves neither the document nor the host page.
 *
 * So the package answers the question itself, with the engine's own behaviour rather than with a version
 * string: build one against a detached element, fire a pan at it, and see whether a panning callback came
 * back. That is a probe, which is how §6.1's canvas ceiling is decided too, and it is the only kind of
 * answer that survives a pdf.js minor moving the API — a `6.2.108`-shaped engine that gains panning in a
 * patch keeps the engine's arbitration, and one that loses it gets ours.
 *
 * When the engine does not report panning, `addTwoFingerPan` is what scrolls. It registers on the same
 * element, and a two-finger move is classified by the same rule the engine publishes — a span change inside
 * `MIN_TOUCH_DISTANCE_TO_PINCH` is a pan, anything wider is the pinch and belongs to the engine. Nothing here
 * calls `preventDefault`: the engine already does, and a second refusal would be the viewer deciding a
 * gesture the host could still see coming.
 */

/** The engine's own span tolerance when it publishes none: `35 / pixelRatio`, at a pixel ratio of 1. */
const DEFAULT_SPAN_TOLERANCE = 35;

export interface TouchPanning {
  /** True when the engine calls back for a pan, so the package must not scroll one itself. */
  reportsPanning: boolean;
  /** False when the engine could not be asked at all — the answer then says nothing about it. */
  probed: boolean;
  /** How much the span between two fingers may change and still be counted as a pan. */
  spanTolerance: number;
}

interface Finger {
  identifier: number;
  clientX: number;
  clientY: number;
  screenX: number;
  screenY: number;
}

/** The option bag is structural: the published type calls every callback a bare `Function`. */
type TouchManagerLike = new (options: {
  container: HTMLElement;
  signal: AbortSignal;
  onPinchStart?: () => void;
  onPinching?: (...args: number[]) => void;
  onPanning?: (dx: number, dy: number) => void;
}) => { MIN_TOUCH_DISTANCE_TO_PINCH?: number };

function touch(id: number, x: number, y: number): Finger {
  return { identifier: id, clientX: x, clientY: y, screenX: x, screenY: y };
}

/**
 * One phase of a two-finger sequence, shaped the way the engine reads it.
 *
 * A plain `Event` with `touches`/`changedTouches` defined, because jsdom has no `Touch` or `TouchList`
 * constructor and the engine only ever iterates those lists and reads coordinates off each entry. The same
 * object works in a real browser, which is the point: one probe, two environments, no branch.
 */
function firePhase(el: HTMLElement, type: string, all: Finger[], changed: Finger[]): void {
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperties(event, {
    touches: { value: all },
    changedTouches: { value: changed },
  });
  el.dispatchEvent(event);
}

/**
 * Ask an engine whether it hands panning back.
 *
 * Returns `reportsPanning: true, probed: false` when it cannot tell — an engine that will not even construct
 * is not an engine whose pan we are going to take over, and a wrong answer in that direction costs a dead
 * gesture, while a wrong answer in the other costs a document that scrolls twice.
 */
export function probeTouchPanning(TouchManagerClass: unknown): TouchPanning {
  const engineOwns: TouchPanning = { reportsPanning: true, probed: false, spanTolerance: DEFAULT_SPAN_TOLERANCE };
  if (typeof TouchManagerClass !== 'function') return engineOwns;
  const Ctor = TouchManagerClass as TouchManagerLike;
  const controller = new AbortController();
  let panned = false;
  let spanTolerance = Number.NaN;
  try {
    const container = document.createElement('div');
    const manager = new Ctor({
      container,
      signal: controller.signal,
      onPinching: () => {},
      onPanning: () => {
        panned = true;
      },
    });
    // Two fingers at a fixed 50-point span, travelling down the page together: a pan, and the only gesture
    // that can produce a panning callback. Three moves, because an engine that tracks gesture ownership
    // spends the first one arming itself.
    const a = touch(0, 100, 100);
    const b = touch(1, 150, 100);
    firePhase(container, 'touchstart', [a], [a]);
    firePhase(container, 'touchstart', [a, b], [b]);
    for (const dy of [20, 40, 60]) {
      const movedA = touch(0, 100, 100 + dy);
      const movedB = touch(1, 150, 100 + dy);
      firePhase(container, 'touchmove', [movedA, movedB], [movedA, movedB]);
    }
    spanTolerance = manager?.MIN_TOUCH_DISTANCE_TO_PINCH ?? Number.NaN;
  } catch {
    return engineOwns;
  } finally {
    controller.abort();
  }
  return {
    reportsPanning: panned,
    probed: true,
    spanTolerance:
      Number.isFinite(spanTolerance) && spanTolerance > 0 ? spanTolerance : DEFAULT_SPAN_TOLERANCE,
  };
}

/**
 * Scroll the container for a two-finger drag whose span does not change, until it does.
 *
 * Registered alongside the engine, not instead of it: the pinch callback stays the engine's, and the moment a
 * move widens or narrows the span beyond the tolerance this gesture stops being a pan for good — the same
 * latch the engine keeps, so a reader who starts a pinch cannot also be scrolling.
 */
export function addTwoFingerPan(
  el: HTMLElement,
  options: { signal: AbortSignal; spanTolerance: number },
): void {
  const { signal, spanTolerance } = options;
  let pan: { span: number; x: number; y: number } | null = null;

  const pair = (event: Event): [Finger, Finger] | null => {
    const touches = (event as unknown as { touches?: ArrayLike<Finger> }).touches;
    if (!touches || touches.length !== 2) return null;
    return [touches[0] as Finger, touches[1] as Finger];
  };
  const span = ([a, b]: [Finger, Finger]) => Math.hypot(a.screenX - b.screenX, a.screenY - b.screenY);

  const onStart = (event: Event) => {
    const fingers = pair(event);
    if (!fingers) {
      pan = null;
      return;
    }
    const [a, b] = fingers;
    pan = { span: span(fingers), x: (a.clientX + b.clientX) / 2, y: (a.clientY + b.clientY) / 2 };
  };
  const onMove = (event: Event) => {
    if (!pan) return;
    const fingers = pair(event);
    if (!fingers) {
      pan = null;
      return;
    }
    const [a, b] = fingers;
    if (Math.abs(span(fingers) - pan.span) > spanTolerance) {
      pan = null;
      return;
    }
    const x = (a.clientX + b.clientX) / 2;
    const y = (a.clientY + b.clientY) / 2;
    // Content follows the fingers, so a downward drag reveals what is above it — the same sign the engine's
    // own `onPanning` deltas are read with, which is what keeps one implementation of the rule.
    el.scrollLeft -= x - pan.x;
    el.scrollTop -= y - pan.y;
    pan = { span: span(fingers), x, y };
  };
  const onEnd = (event: Event) => {
    if (!pair(event)) pan = null;
  };

  const opts = { signal, passive: true };
  el.addEventListener('touchstart', onStart, opts);
  el.addEventListener('touchmove', onMove, opts);
  el.addEventListener('touchend', onEnd, opts);
  el.addEventListener('touchcancel', onEnd, opts);
}
