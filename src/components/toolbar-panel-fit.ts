/*
 * Fitting the ⋯ panel to the box that clips it (#241; FR-45, FR-28).
 *
 * `.pjsr-viewer` clips with `overflow: clip`, and a clip is not a scrollbar waiting to be used: content outside
 * it is not painted, not hit-testable, and cannot be scrolled to. Measured on the matrix's own mobile profile
 * (375×812, chromium): the panel wanted 421 px while the clipped box left 196 px below the trigger, so four of
 * its nine rows — Download, Page layout, Enter fullscreen, Print pages — had their centres hit-testing the page
 * behind the viewer or nothing at all, and asking the panel to scroll moved it 0 px because `scrollHeight` equalled
 * `clientHeight`. An unbounded panel has nothing to scroll, which is the whole defect.
 *
 * So the panel is bounded to the space the clip still has beneath it and scrolls within that bound: every folded
 * row can then be brought inside a box a pointer can land in. The arithmetic lives here, separate from the
 * component, because it is arithmetic on measured edges — and measured edges are what a browser row can prove and
 * a unit test can pin at both ends, including the end where a hopeless measurement must still yield something
 * usable rather than a strip of nothing.
 */

/** A strip shorter than this cannot show a row at touch size, so it is not a bound worth applying. */
export const MIN_PANEL_HEIGHT = 96;

/** Kept between the panel's own bottom edge and the clip's, so its border is not sitting on the cut. */
export const PANEL_BOTTOM_MARGIN = 8;

/**
 * The height the panel may take: what the clipped ancestor still has below its top edge, floored at
 * `MIN_PANEL_HEIGHT` so a container too short to hold a row still holds a scrollable strip of rows.
 */
export function panelMaxHeight(
  space: { panelTop: number; clipBottom: number },
  margin = PANEL_BOTTOM_MARGIN,
  minimum = MIN_PANEL_HEIGHT,
): number {
  return Math.max(Math.floor(space.clipBottom - space.panelTop - margin), minimum);
}

/**
 * The nearest ancestor that cuts this element off, or `null` when nothing does.
 *
 * Only `clip` and `hidden` count: a scrollable ancestor is not a wall, because the reader can move it. Read
 * upward from the element rather than matched by class, so a host that wraps the viewer in a clipped box of its
 * own gets *that* edge — the clip that matters is whichever one is actually cutting.
 *
 * The shorthand is read beside the longhands because a browser and a layout-free test double disagree about which
 * one they report: Chromium answers `overflowX`/`overflowY` for a box styled with the `overflow` shorthand, jsdom
 * answers empty strings for both and only carries the shorthand. Checking all three keeps the walk true in the
 * place the claim is measured and in the place the rule is unit-tested.
 */
export function clipAncestor(el: Element): Element | null {
  for (let a = el.parentElement; a; a = a.parentElement) {
    const s = getComputedStyle(a);
    if (/clip|hidden/.test(`${s.overflowX} ${s.overflowY} ${s.getPropertyValue('overflow')}`)) return a;
  }
  return null;
}
