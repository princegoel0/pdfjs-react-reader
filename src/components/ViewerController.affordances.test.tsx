/*
 * FR-28's last sentence: *the shell's own affordances are part of this contract and each is individually
 * switchable and observable*, and "an affordance that ships without a prop to refuse it is a host's problem".
 *
 * Four affordances the shell takes from the page — wheel zoom, pinch zoom, fullscreen, drag-and-drop — plus
 * the keyboard's paging. Each has a prop (`ViewerController.tsx:237-241`), and the gesture tests
 * (`ViewerController.gestures.test.tsx`) prove what the shell *does* when they are on, which is the half the
 * clause is not about. The half with no assertion was the refusal: a prop that is read nowhere is a prop, and
 * "observable" means something specific — a refused affordance has to leave the chrome consistent (no control
 * that does nothing, no drop highlight for a drop that will be ignored) and hand the gesture back to the host
 * rather than eating it.
 *
 * What is asserted per affordance, off and on:
 *
 *  - **wheel zoom**: off, a mod-keyed wheel leaves `resolvedScale` alone and is *not* `defaultPrevented`, so
 *    the host page scrolls; on, it zooms and the host is told the gesture was taken;
 *  - **pinch zoom**: off, a two-finger spread changes nothing;
 *  - **keyboard paging**: off, a `PageDown` is not claimed; on, it is prevented — with no document mounted the
 *    page cannot move, so the claim being tested is the one the clause makes, about who owns the key;
 *  - **fullscreen**: off, `fsAvailable` is false, the bar renders no control for it, and
 *    `toggleFullscreen()` never reaches the element's `requestFullscreen`; on, all three flip together —
 *    which is what "observable" is: a host that turns it off does not get a button that lies;
 *  - **drag-and-drop**: off, a `dragover` is left to the page and the drop highlight never appears; on, the
 *    gesture is claimed, `pjsr-viewer--dragover` shows, and the file reaches `onDropFile`.
 *
 * jsdom has no `ResizeObserver`, no fullscreen API and no scroll geometry, so the two engine probes are
 * stubbed where the clause needs them and the mount is the composed shell (`ViewerLayout`), because a
 * toolbar the test never rendered cannot show whether a control is missing from it.
 */
import { act, cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { useViewerController } from './ViewerController';
import { ViewerProvider } from './ViewerContext';
import { ViewerLayout } from './ViewerLayout';
import { DEFAULT_LABELS } from '../lib/labels';

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

const requestFullscreen = vi.fn(() => Promise.resolve());

const seen = { controller: null as ReturnType<typeof useViewerController> | null };

interface Options {
  enableWheelZoom?: boolean;
  enablePinchZoom?: boolean;
  enableFullscreen?: boolean;
  enableKeyboardNavigation?: boolean;
  enableDrop?: boolean;
  onDropFile?: (file: File) => void;
}

function Shell(options: Options) {
  seen.controller = useViewerController({
    src: '/fixtures/outline-sample.pdf',
    labels: { ...DEFAULT_LABELS },
    ...options,
  });
  return (
    <div data-host>
      <ViewerProvider controller={seen.controller}>
        <ViewerLayout controller={seen.controller} />
      </ViewerProvider>
    </div>
  );
}

/** Mount the composed shell and hand back the element each affordance is registered on. */
function mount(options: Options = {}) {
  Object.defineProperty(Element.prototype, 'requestFullscreen', {
    configurable: true,
    value: requestFullscreen,
  });
  // A component *type*, not a call: `Shell(options)` would run the hooks in the test's own context, where
  // React has no dispatcher to write through.
  const WithOptions = () => Shell(options);
  const view = render(<WithOptions />);
  const el = view.container.querySelector<HTMLElement>('.pjsr-viewport');
  const root = view.container.querySelector<HTMLElement>('.pjsr-viewer');
  if (!el || !root || !seen.controller) throw new Error('the composed shell never mounted');
  return { el, root, view, controller: () => seen.controller as ReturnType<typeof useViewerController> };
}

const scale = () => seen.controller?.resolvedScale ?? 0;

/**
 * The bar's real fullscreen controls, minus the measuring copies.
 *
 * `Toolbar` renders a second set inside `.pjsr-toolbar-sizer` — `visibility: hidden`, kept out of the
 * accessibility tree and the tab order — so a query that names a control without naming the bar it belongs to
 * resolves twice and cannot tell "the control is there" from "the control is there twice".
 */
function fullscreenControls(container: HTMLElement): HTMLElement[] {
  return [
    ...container.querySelectorAll<HTMLElement>('[aria-label="' + DEFAULT_LABELS.enterFullscreen + '"]'),
  ].filter((el) => !el.closest('.pjsr-toolbar-sizer'));
}

const finger = (id: number, x: number, y: number) => ({
  identifier: id,
  clientX: x,
  clientY: y,
  screenX: x,
  screenY: y,
  pageX: x,
  pageY: y,
  force: 1,
});

function fireTouch(el: Element, type: string, touches: unknown[], changed: unknown[]) {
  const event = new Event(type, { bubbles: true, cancelable: true }) as Event & {
    touches: unknown[];
    changedTouches: unknown[];
    targetTouches: unknown[];
  };
  Object.defineProperty(event, 'touches', { value: touches });
  Object.defineProperty(event, 'changedTouches', { value: changed });
  Object.defineProperty(event, 'targetTouches', { value: touches });
  act(() => {
    el.dispatchEvent(event);
  });
  return event;
}

afterEach(() => {
  cleanup();
  requestFullscreen.mockClear();
  delete (Element.prototype as unknown as Record<string, unknown>).requestFullscreen;
});

describe('FR-28: each shell affordance is refused on its own, and the refusal is visible', () => {
  it('refuses wheel zoom and leaves the gesture to the host page', () => {
    const { el } = mount({ enableWheelZoom: false });
    const before = scale();

    const event = new WheelEvent('wheel', { deltaY: -120, ctrlKey: true, bubbles: true, cancelable: true });
    act(() => {
      el.dispatchEvent(event);
    });

    expect(scale(), 'no zoom from a wheel the host was told it could not have').toBe(before);
    expect(event.defaultPrevented, 'a refused wheel is not a consumed wheel').toBe(false);
  });

  it('takes the wheel when it was not refused, which is what makes the refusal above a switch', () => {
    const { el } = mount();
    const before = scale();

    const event = new WheelEvent('wheel', { deltaY: -120, ctrlKey: true, bubbles: true, cancelable: true });
    act(() => {
      el.dispatchEvent(event);
    });

    expect(scale()).toBeGreaterThan(before);
    expect(event.defaultPrevented).toBe(true);
  });

  it('refuses pinch zoom: two fingers spreading change nothing', () => {
    const { el } = mount({ enablePinchZoom: false });
    const before = scale();
    const a = finger(0, 50, 50);
    const b = finger(1, 150, 50);

    fireTouch(el, 'touchstart', [a], [a]);
    fireTouch(el, 'touchstart', [a, b], [b]);
    const last = fireTouch(
      el,
      'touchmove',
      [{ ...a, x: 20 }, { ...b, x: 200 }],
      [{ ...a, x: 20 }, { ...b, x: 200 }],
    );

    expect(scale(), 'the span grew and the document did not').toBe(before);
    expect(last.defaultPrevented, 'and the browser keeps its own pinch').toBe(false);
  });

  it('refuses keyboard paging, so the host page scrolls and the keys stay its own', () => {
    const { el } = mount({ enableKeyboardNavigation: false });

    const event = new KeyboardEvent('keydown', { key: 'PageDown', bubbles: true, cancelable: true });
    act(() => {
      el.dispatchEvent(event);
    });
    expect(event.defaultPrevented, 'PageDown belongs to the page again').toBe(false);

    const arrows = new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true });
    act(() => {
      el.dispatchEvent(arrows);
    });
    expect(arrows.defaultPrevented).toBe(false);
  });

  it('claims PageDown when navigation was not refused', () => {
    const { el } = mount();

    const event = new KeyboardEvent('keydown', { key: 'PageDown', bubbles: true, cancelable: true });
    act(() => {
      el.dispatchEvent(event);
    });

    expect(event.defaultPrevented, 'the viewer owns the key, document or no document').toBe(true);
  });

  it('hides the fullscreen control when it is refused, and never reaches the element', () => {
    const { root, view, controller } = mount({ enableFullscreen: false });

    expect(controller().fsAvailable, 'the capability the bar branches on').toBe(false);
    expect(fullscreenControls(view.container), 'no control that does nothing').toEqual([]);

    act(() => {
      controller().toggleFullscreen();
    });
    expect(
      requestFullscreen,
      'the prop refuses the affordance, not just the button — the handle publishes this method',
    ).not.toHaveBeenCalled();
    expect(root.className, 'and the shell carries no fullscreen state').not.toContain('--fullscreen');
  });

  it('shows and runs the fullscreen control when it was not refused', () => {
    const { view, controller } = mount();

    expect(controller().fsAvailable).toBe(true);
    const controls = fullscreenControls(view.container);
    expect(controls, 'the bar has the control the host did not refuse').toHaveLength(1);

    act(() => {
      controls[0]!.click();
    });
    expect(requestFullscreen).toHaveBeenCalled();
  });

  it('leaves a drag to the page when drop is refused, and shows no drop target', () => {
    const { root, controller } = mount();

    const over = new Event('dragover', { bubbles: true, cancelable: true }) as Event & {
      dataTransfer: unknown;
    };
    Object.defineProperty(over, 'dataTransfer', { value: { dropEffect: 'none', types: [] } });
    act(() => {
      root.dispatchEvent(over);
    });

    expect(over.defaultPrevented, 'a viewer that will not take a file must not advertise that it will').toBe(
      false,
    );
    expect(controller().dragOver).toBe(false);
    expect(root.className).not.toContain('pjsr-viewer--dragover');
  });

  it('claims the drag, shows the drop target and hands the file over when drop is enabled', () => {
    const onDropFile = vi.fn();
    const { root, controller } = mount({ enableDrop: true, onDropFile });

    const over = new Event('dragover', { bubbles: true, cancelable: true }) as Event & {
      dataTransfer: { dropEffect: string; types: string[] };
    };
    Object.defineProperty(over, 'dataTransfer', { value: { dropEffect: 'none', types: [] } });
    act(() => {
      root.dispatchEvent(over);
    });

    expect(over.defaultPrevented).toBe(true);
    expect(controller().dragOver, 'the shell says out loud that it will take the file').toBe(true);
    expect(root.className).toContain('pjsr-viewer--dragover');

    const file = new File(['%PDF-1.7'], 'dropped.pdf', { type: 'application/pdf' });
    const drop = new Event('drop', { bubbles: true, cancelable: true }) as Event & { dataTransfer: unknown };
    Object.defineProperty(drop, 'dataTransfer', { value: { files: [file], dropEffect: 'copy' } });
    act(() => {
      root.dispatchEvent(drop);
    });

    expect(onDropFile).toHaveBeenCalledWith(file);
    expect(controller().dragOver, 'and the highlight goes when the drop lands').toBe(false);
  });
});
