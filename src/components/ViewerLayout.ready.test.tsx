/*
 * FR-28 with a document on screen: the parts read the controller, and the keyboard affordance moves a page.
 *
 * Every other shell mount in this repository hands the controller `doc: null, isReady: false`, which is why two
 * legs of the clause went unasserted: `ViewerController.affordances.test.tsx` could only test the keyboard's
 * *claim* ("with no document mounted the page cannot move"), and the parts could be shown to render but never
 * shown reading a number that came from a document. That was `#175`, recorded as a hang — mounting the real
 * controller against a finished load was killed at 60 s and at 120 s with no output. Measured 2026-10-06 the
 * hang is gone; what it had been hiding is the four jsdom answers the mount needs, which now live in
 * `ready-shell-harness.tsx` (and are what `a11y.ready.test.tsx` audits through, #247).
 *
 * What stays the browser matrix's is the engine and the paint: see the harness's header for why a real file
 * cannot be opened under Node at all.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  NUM_PAGES,
  ROW_PITCH,
  installReadyShellJsdom,
  mountReadyShell,
  pressKeyIn,
  readyScroll,
  resetReadyShell,
  shellChrome,
} from './ready-shell-harness';

installReadyShellJsdom();

vi.mock('../headless/usePdfDocument', async () => {
  const { readyLoadResult: load } = await import('./ready-fake-document');
  return { usePdfDocument: () => load() };
});

const pageChanges = vi.hoisted(() => vi.fn());

afterEach(() => {
  resetReadyShell();
  pageChanges.mockClear();
});

describe('FR-28: the composed shell against a document that has finished loading', () => {
  it('has every part read the one controller, with a document behind it', () => {
    const { view } = mountReadyShell();
    const seen = shellChrome(view);
    // The bar shows the document's size and the reader's place, the frame holds the pages the virtualizer
    // chose, and the sidebar's thumbnail list covers all four — three parts, one state, no prop passed.
    expect(seen.count).toBe(`of ${NUM_PAGES}`);
    expect(seen.pageInput).toBe('1');
    expect(seen.thumbnails).toBe(NUM_PAGES);
    expect(seen.pages).toBeGreaterThan(0);
    expect(seen.pages).toBeLessThan(NUM_PAGES);
  });

  it('moves the page for real when the keyboard affordance is left on', async () => {
    const { view, controller } = mountReadyShell({ onPageChange: pageChanges });
    const before = shellChrome(view);
    expect(controller().currentPage).toBe(1);

    const root = view.container.querySelector('.pjsr-viewer')!;
    const event = await pressKeyIn(root, 'PageDown');

    // The leg `ViewerController.affordances.test.tsx` could only reach as far as `defaultPrevented`: here the
    // reader actually moved, the chrome moved with them, and the host was told.
    expect(event.defaultPrevented, 'an enabled affordance claims the key').toBe(true);
    expect(readyScroll.top, 'one page of pitch beyond the first row').toBe(ROW_PITCH);
    expect(controller().currentPage).toBe(2);
    expect(shellChrome(view).pageInput).toBe('2');
    expect(shellChrome(view).pages, 'the next row comes on screen as the reader arrives').toBeGreaterThan(before.pages);
    expect(pageChanges.mock.calls.flat(), 'the typed event sees the move').toEqual([2]);
  });

  it('leaves the reader where they were when the keyboard affordance is refused', async () => {
    const { view, controller } = mountReadyShell({
      enableKeyboardNavigation: false,
      onPageChange: pageChanges,
    });

    const root = view.container.querySelector('.pjsr-viewer')!;
    const event = await pressKeyIn(root, 'PageDown');

    expect(event.defaultPrevented, 'a refused key belongs to the host page').toBe(false);
    expect(readyScroll.top).toBe(0);
    expect(controller().currentPage).toBe(1);
    expect(shellChrome(view).pageInput).toBe('1');
    expect(pageChanges).not.toHaveBeenCalled();
  });
});
