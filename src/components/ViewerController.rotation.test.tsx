/*
 * FR-09's first clause: "90° clockwise and counter-clockwise, per page or document-wide".
 *
 * The direction that had no assertion was the second one of each pair. `rotatePage(1, 90)` was covered (by the
 * per-page-rotation clear in `ViewerController.test.tsx`), and the toolbar's overflow planner treats
 * `rotateCw` and `rotateCcw` as equal-width siblings — which is a layout fact, not a rotation one. Nothing in
 * the suite failed if `rotate(-90)` left the document at `-90`, and `-90` is not what a `PageViewport` wants:
 * `normalizeRotation` exists precisely because `(-90) % 360` is `-90` in JavaScript, and the number it returns
 * is what every layer on every page is measured against.
 *
 * So the four corners of the sentence are asserted here: clockwise and counter-clockwise, on the document and
 * on one page, plus the two properties that make the per-page case mean anything — a page turn leaves the
 * document alone, and a document turn leaves a page's own turn *additive* rather than replacing it, because the
 * shell sums the two into the `rotation` prop each page is given.
 *
 * The document is mocked away: rotation is controller state and needs no loaded page to be right, and what a
 * page does with the number it is handed is `PdfPage.rotation.test.tsx`.
 */
import { act, cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useViewerController } from './ViewerController';

vi.mock('../headless/usePdfDocument', () => ({
  // No document on purpose: a rotation is controller state, and a fake `doc` would have to grow every method
  // the shell reaches for (`getPageLabels`, the viewport of page 1, the annotation layers) to keep a test about
  // degrees honest.
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

let latest: ReturnType<typeof useViewerController> | null = null;

function Harness() {
  latest = useViewerController({ src: '/papers/thesis.pdf' });
  return <span />;
}

/**
 * Read the controller *after* the action, not the object captured before it.
 *
 * `useViewerController` returns a fresh object per render, so a reference held across an `act()` is a snapshot
 * of the state as it was — and a test that asserted on the stale copy would pass whatever the rotation did.
 */
function state(): ReturnType<typeof useViewerController> {
  if (!latest) throw new Error('the controller harness published nothing');
  return latest;
}

afterEach(() => {
  cleanup();
  latest = null;
});

describe('turning the document (FR-09)', () => {
  it('takes a quarter turn each way and stays inside 0…359', () => {
    render(<Harness />);
    expect(state().rotation).toBe(0);

    act(() => state().rotate(90));
    expect(state().rotation).toBe(90);

    act(() => state().rotate(90));
    expect(state().rotation).toBe(180);

    // The counter-clockwise control from 180: back to 90, which is a turn rather than a reset.
    act(() => state().rotate(-90));
    expect(state().rotation).toBe(90);

    // And the wrap a counter-clockwise press has to produce from 90: not `-90`, which is what JavaScript's
    // `%` would answer, and not 0 — a document turned left is at 270.
    act(() => state().rotate(-180));
    expect(state().rotation).toBe(270);
    expect(state().rotation).toBeGreaterThanOrEqual(0);
  });
});

describe('turning one page (FR-09)', () => {
  it('turns the page it is asked for and does not touch the document', () => {
    render(<Harness />);

    act(() => state().rotatePage(3, 90));
    expect(state().pageRotations[2]).toBe(90);
    expect(state().rotation, 'a page turn moved the whole document').toBe(0);
    expect(Object.keys(state().pageRotations), 'the turn leaked to another page').toEqual(['2']);

    act(() => state().rotatePage(3, -90));
    expect(state().pageRotations[2], 'counter-clockwise left a negative page rotation').toBe(0);
  });

  it('keeps a page’s own turn when the document is turned, because the shell adds them', () => {
    render(<Harness />);
    act(() => state().rotatePage(2, 180));

    act(() => state().rotate(90));
    expect(state().rotation).toBe(90);
    expect(state().pageRotations[1], 'the document turn overwrote the page turn').toBe(180);

    /*
     * The sum `ViewerPages` computes per page — `rotation + (pageRotations[index] ?? 0)`, normalised — is the
     * only thing a page is handed, so it is asserted here rather than through an API the controller does not
     * have. Page 2 is at 270 and its neighbour is at the document's own 90.
     */
    const sum = (index: number) =>
      (state().rotation + (state().pageRotations[index] ?? 0)) % 360;
    expect(sum(1)).toBe(270);
    expect(sum(0)).toBe(90);
  });
});
