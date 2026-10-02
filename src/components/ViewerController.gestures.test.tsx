/*
 * FR-47: which listener takes which gesture. FR-28 is the same controller's promise that each affordance —
 * fullscreen, drag-and-drop, wheel zoom — can be refused and observed by the host separately.
 *
 * Three of these four gestures arrive at the same element — the scroll container the virtualizer hands
 * out — and a reader's finger cannot say twice, so the answer has to be decided rather than discovered.
 * What is asserted here is the decision, and the one failure mode that made it necessary: pdf.js's
 * `TouchManager` claims a two-finger `touchmove` with `preventDefault` and `stopPropagation` *before* it
 * knows whether the span between the fingers changed. Zooming was answered; the pan was swallowed on the
 * way in, so a two-finger drag inside the viewer did nothing at all — not to the document, not to the
 * host page. `onPanning` is that fix, and test two is its counterfactual in the shape of a number.
 *
 * The synthetic touch events are `Event` plus hand-made touch lists because jsdom has no `Touch` or
 * `TouchList` constructor — only the `TouchEvent` name — while the engine iterates `touches` and
 * `changedTouches` and reads `clientX`/`screenX` off each entry, which an array of plain objects supplies.
 */
import { act, cleanup, render } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useViewerController } from './ViewerController';
import { ViewerProvider } from './ViewerContext';
import { ViewerLayout } from './ViewerLayout';

// The toolbar measures its own overflow and the virtualizer measures the scroll container; jsdom has
// neither a ResizeObserver. Same stub the toolbar and layout tests install.
class ObserverStub {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}
globalThis.ResizeObserver = ObserverStub as unknown as typeof ResizeObserver;

vi.mock('../headless/usePdfDocument', () => ({
  usePdfDocument: () => ({
    status: 'loading',
    doc: null,
    numPages: 0,
    isReady: false,
    error: null,
    capabilities: null,
    passwordRequest: null,
    reload: vi.fn(),
  }),
}));

afterEach(cleanup);

interface Finger {
  id: number;
  x: number;
  y: number;
}

const asTouch = (finger: Finger) => ({
  identifier: finger.id,
  clientX: finger.x,
  clientY: finger.y,
  screenX: finger.x,
  screenY: finger.y,
});

/**
 * Dispatch one phase of a multi-touch sequence. `all` is every finger still on the glass, `changed` the
 * ones this event moved or lifted — the distinction the engine's `#pruneTouchIds` turns on.
 */
function fireTouch(
  el: Element,
  type: 'touchstart' | 'touchmove' | 'touchend',
  all: Finger[],
  changed: Finger[],
): Event {
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperties(event, {
    touches: { value: all.map(asTouch) },
    changedTouches: { value: changed.map(asTouch) },
  });
  act(() => {
    el.dispatchEvent(event);
  });
  return event;
}

/** Two fingers down, spread symmetrically about their own midpoint, so only the span changes. */
function pinch(el: Element, a: Finger, b: Finger, spread: number) {
  fireTouch(el, 'touchstart', [a], [a]);
  fireTouch(el, 'touchstart', [a, b], [b]);
  const movedA = { ...a, x: a.x - spread };
  const movedB = { ...b, x: b.x + spread };
  fireTouch(el, 'touchmove', [movedA, movedB], [movedA, movedB]);
  return fireTouch(el, 'touchmove', [{ ...movedA, x: movedA.x - spread }, { ...movedB, x: movedB.x + spread }], [
    { ...movedA, x: movedA.x - spread },
    { ...movedB, x: movedB.x + spread },
  ]);
}

let controller: ReturnType<typeof useViewerController> | null = null;

function Shell() {
  controller = useViewerController({ src: '/fixtures/outline-sample.pdf' });
  return (
    <div data-host>
      <ViewerProvider controller={controller}>
        <ViewerLayout controller={controller} />
      </ViewerProvider>
    </div>
  );
}

/** Mount the shell and return its real scroll container, the element every gesture is registered on. */
function viewport() {
  const view = render(<Shell />);
  const el = view.container.querySelector<HTMLElement>('.pjsr-viewport');
  if (!el) throw new Error('no viewport to aim a gesture at');
  return { el, host: view.container.querySelector<HTMLElement>('[data-host]')!, view };
}

const scale = () => controller?.resolvedScale ?? 0;

describe('pinch and pan arbitration', () => {
  it('zooms on a two-finger spread, and takes the gesture away from the browser', () => {
    const { el } = viewport();
    const before = scale();

    const last = pinch(el, { id: 0, x: 50, y: 50 }, { id: 1, x: 150, y: 50 }, 100);

    expect(scale()).toBeGreaterThan(before);
    // Without this the browser pinch-zooms the whole page on top of our own zoom.
    expect(last.defaultPrevented).toBe(true);
  });

  it('scrolls the document when the fingers travel without changing their span', () => {
    const { el } = viewport();
    el.scrollTop = 200;
    const before = scale();

    const a = { id: 0, x: 50, y: 50 };
    const b = { id: 1, x: 150, y: 50 };
    fireTouch(el, 'touchstart', [a], [a]);
    fireTouch(el, 'touchstart', [a, b], [b]);
    // Both fingers down 50: same gap, new midpoint — a pan, and the only thing that can answer it.
    const moved = fireTouch(
      el,
      'touchmove',
      [{ ...a, y: 100 }, { ...b, y: 100 }],
      [{ ...a, y: 100 }, { ...b, y: 100 }],
    );

    expect(el.scrollTop).toBe(150);
    expect(moved.defaultPrevented).toBe(true);
    // The gesture that pans must not also be the gesture that zooms.
    expect(scale()).toBe(before);
  });

  it('gives the fingers to the drawing layer while freehand is armed', () => {
    const { el } = viewport();
    const before = scale();
    act(() => {
      controller?.ink.setDrawing(true);
    });

    const last = pinch(el, { id: 0, x: 50, y: 50 }, { id: 1, x: 150, y: 50 }, 100);

    expect(scale()).toBe(before);
    // `isPinchingDisabled` is consulted before the engine claims anything, so the sequence is released:
    // the host page and the `touch-action: none` surface under the finger both still get it.
    expect(last.defaultPrevented).toBe(false);
  });

  it('lets the first finger of a tap reach the widget it landed on', () => {
    const { el } = viewport();
    const widget = document.createElement('button');
    el.append(widget);
    const pressed = vi.fn();
    widget.addEventListener('pointerdown', pressed);

    // The engine's own order: `pointerdown` first, then the `touchstart` that arms its guard. So a tap is
    // never the gesture the guard was armed for, and a widget under the finger still activates.
    act(() => {
      widget.dispatchEvent(
        new PointerEvent('pointerdown', { bubbles: true, cancelable: true, pointerType: 'touch' }),
      );
    });
    fireTouch(el, 'touchstart', [{ id: 0, x: 10, y: 10 }], [{ id: 0, x: 10, y: 10 }]);

    expect(pressed).toHaveBeenCalledTimes(1);
    widget.remove();
  });
});

describe('wheel arbitration', () => {
  it('zooms on a mod-keyed wheel, and still tells the host about it', () => {
    const { el, host } = viewport();
    const seen: boolean[] = [];
    host.addEventListener('wheel', (event) => seen.push(event.defaultPrevented));
    const before = scale();

    act(() => {
      el.dispatchEvent(new WheelEvent('wheel', { deltaY: -120, ctrlKey: true, bubbles: true, cancelable: true }));
    });

    expect(scale()).toBeGreaterThan(before);
    // Not starving the host is FR-47's own words: the listener survives, and `defaultPrevented` is how it
    // learns the viewer already took the gesture. Stopping propagation here would pass the zoom and fail
    // the requirement.
    expect(seen).toEqual([true]);
  });

  it('leaves a plain wheel alone', () => {
    const { el } = viewport();
    const before = scale();

    const event = new WheelEvent('wheel', { deltaY: 120, bubbles: true, cancelable: true });
    act(() => {
      el.dispatchEvent(event);
    });

    expect(event.defaultPrevented).toBe(false);
    expect(scale()).toBe(before);
  });

  it('claims nothing outside its own container', () => {
    const { host } = viewport();
    const before = scale();

    const event = new WheelEvent('wheel', { deltaY: -120, ctrlKey: true, bubbles: true, cancelable: true });
    act(() => {
      host.dispatchEvent(event);
    });

    expect(event.defaultPrevented).toBe(false);
    expect(scale()).toBe(before);
  });
});

/*
 * The declarative half of the same decision. `touch-action` is the only way to state a gesture policy
 * before a listener runs, because the browser begins a pan as soon as it decides to, and a non-passive
 * `preventDefault` that arrives one frame late is a gesture that moved twice. jsdom does not resolve
 * stylesheets, so this reads the source the build ships — the same guard `AbortSignal.any` uses.
 */
describe('the gesture policy the browser reads first', () => {
  // `import.meta.url` is not a file URL under the jsdom project, so this is the repo-root-relative path
  // the other disk-reading tests use.
  const css = readFileSync(join(process.cwd(), 'src/styles/viewer.css'), 'latin1');
  const rule = css.slice(
    css.indexOf('.pjsr-viewport {'),
    css.indexOf('}', css.indexOf('.pjsr-viewport {')) + 1,
  );

  it('pans the page area and never lets the browser pinch-zoom the host page', () => {
    expect(rule).toMatch(/touch-action:\s*pan-x pan-y/);
    expect(rule).not.toMatch(/touch-action:[^;]*pinch-zoom/);
  });

  it('stops the document from chaining its scroll into the host page', () => {
    expect(rule).toMatch(/overscroll-behavior:\s*contain/);
  });
});
