/*
 * FR-45, FR-28, #241: the ⋯ panel has to fit the box that clips it.
 *
 * `.pjsr-viewer` clips with `overflow: clip`, so a panel taller than the space left below the trigger does not
 * become scrollable — content past a clip is not painted, not hit-testable, and cannot be scrolled to. Measured at
 * 375×812, four of nine folded rows hit-tested the page behind the viewer. The bound is arithmetic on measured
 * edges, so both ends of it are pinned here: what remains when there is room, and what the floor is for when there
 * is not. A bound that can go to zero or negative is the same defect wearing a scrollbar — it hides every row
 * instead of the bottom few — so the floor is asserted against the naive form of this function, not decoration.
 *
 * The reachability half of the claim is measured in a real layout by
 * `scripts/browser-matrix.mjs#toolbar-fold`, because jsdom performs no layout at all.
 */
import { describe, expect, it } from 'vitest';
import { clipAncestor, MIN_PANEL_HEIGHT, PANEL_BOTTOM_MARGIN, panelMaxHeight } from './toolbar-panel-fit';

describe('FR-45: fitting the overflow panel to the box that clips it', () => {
  it('takes what the clipped ancestor still has below the panel, less the margin', () => {
    // The matrix's own mobile profile, measured: panel top at y 492 inside a viewer that ends at y 688.
    expect(panelMaxHeight({ panelTop: 492, clipBottom: 688 })).toBe(688 - 492 - PANEL_BOTTOM_MARGIN);
  });

  it('never bounds a panel to less than a row can use', () => {
    // A viewer whose remaining space is none — or negative, because a host gave the toolbar the whole box.
    expect(panelMaxHeight({ panelTop: 688, clipBottom: 688 })).toBe(MIN_PANEL_HEIGHT);
    expect(panelMaxHeight({ panelTop: 700, clipBottom: 688 })).toBe(MIN_PANEL_HEIGHT);
    expect(panelMaxHeight({ panelTop: 0, clipBottom: 0 })).toBe(MIN_PANEL_HEIGHT);
  });

  it('rounds down rather than spilling a pixel past the cut', () => {
    expect(panelMaxHeight({ panelTop: 100.6, clipBottom: 300.9 })).toBe(192);
  });

  describe('clipAncestor', () => {
    const build = () => {
      const root = document.createElement('div');
      const clipper = document.createElement('div');
      const scroller = document.createElement('div');
      const leaf = document.createElement('span');
      scroller.append(leaf);
      clipper.append(scroller);
      root.append(clipper);
      document.body.append(root);
      return { root, clipper, scroller, leaf };
    };

    it('names the nearest ancestor that cuts, and ignores one that can be scrolled', () => {
      const { clipper, scroller, leaf } = build();
      clipper.style.overflow = 'clip';
      scroller.style.overflow = 'auto';
      // Walking up from the leaf: the scroller is nearer, but a scroll container is not a wall.
      expect(clipAncestor(leaf)).toBe(clipper);
    });

    it('finds a `hidden` box too, and says nothing clips an unbounded tree', () => {
      const { clipper, leaf } = build();
      clipper.style.overflow = 'hidden';
      expect(clipAncestor(leaf)).toBe(clipper);
      clipper.style.overflow = 'visible';
      expect(clipAncestor(leaf)).toBeNull();
    });
  });
});
