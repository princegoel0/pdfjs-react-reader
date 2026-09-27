/*
 * The plan model, tested on the properties that make the rest of the feature cheap.
 *
 * Two of these exist because the alternative was measured to be wrong: a move has to be a
 * permutation the writer can apply in one pass (moving a page with `removePage` and
 * `insertPage` leaves the page tree naming an object the file no longer holds), and undo has to
 * be possible without a byte snapshot per keystroke, which is what makes an inverse plan worth
 * having — and what makes its limits worth testing.
 */
import { describe, expect, it } from 'vitest';
import type { PagePlan } from './page-plan';
import {
  initialPlan,
  inversePlan,
  isPristine,
  movePlanned,
  pageAtSlot,
  plannedPages,
  removePlanned,
  rotatePlanned,
  withViewRotations,
} from './page-plan';

describe('initialPlan', () => {
  it('starts untouched', () => {
    const plan = initialPlan(4);
    expect(plan.order).toEqual([0, 1, 2, 3]);
    expect(isPristine(plan, 4)).toBe(true);
    expect(plannedPages(plan)).toBe(4);
  });
});

describe('movePlanned', () => {
  it('moves a page and leaves the rest in order', () => {
    const plan = movePlanned(initialPlan(5), 4, 0);
    expect(plan.order).toEqual([4, 0, 1, 2, 3]);
    expect(isPristine(plan, 5)).toBe(false);
  });

  it('clamps a drag that ends past either edge', () => {
    expect(movePlanned(initialPlan(3), 0, 99).order).toEqual([1, 2, 0]);
    expect(movePlanned(initialPlan(3), 2, -5).order).toEqual([2, 0, 1]);
  });

  it('gives back the same plan when nothing moves', () => {
    // The panel decides whether to announce and whether to grow the undo stack, so a no-op has
    // to be recognisable as the same object rather than an equal copy.
    const plan = initialPlan(3);
    expect(movePlanned(plan, 1, 1)).toBe(plan);
    expect(movePlanned(plan, 9, 0)).toBe(plan);
  });
});

describe('rotatePlanned', () => {
  it('turns the page in the slot, not the slot', () => {
    const turned = rotatePlanned(initialPlan(3), 0, 90);
    expect(turned.rotations).toEqual({ 0: 90 });
    // Moving the page afterwards must not leave the angle behind.
    const moved = movePlanned(turned, 0, 2);
    expect(moved.order).toEqual([1, 2, 0]);
    expect(moved.rotations).toEqual({ 0: 90 });
    expect(pageAtSlot(moved, 2)).toBe(0);
  });

  it('wraps a full turn back to where it started and drops the entry', () => {
    const plan = rotatePlanned(rotatePlanned(initialPlan(2), 1, 90), 1, 270);
    expect(plan.rotations[1]).toBe(0);
    // A page the file already rotates is left alone until the reader says otherwise, so an
    // explicit 0 is still a change the writer must write.
    expect(isPristine(plan, 2)).toBe(false);
  });

  it('ignores a slot that is not planned', () => {
    const plan = initialPlan(2);
    expect(rotatePlanned(plan, 7, 90)).toBe(plan);
  });
});

describe('removePlanned', () => {
  it('takes a page out and forgets its rotation', () => {
    const start = rotatePlanned(initialPlan(3), 1, 90);
    const plan = removePlanned(start, 1);
    expect(plan?.order).toEqual([0, 2]);
    expect(plan?.rotations).toEqual({});
    expect(plannedPages(plan!)).toBe(2);
  });

  it('refuses to remove the last page', () => {
    expect(removePlanned({ order: [1], rotations: {} }, 0)).toBeNull();
  });

  it('refuses a slot outside the plan', () => {
    expect(removePlanned(initialPlan(3), 5)).toBeNull();
  });
});

describe('inversePlan', () => {
  /** What `arrangePages` does to a page list: slot `k` takes the page at `plan.order[k]`. */
  const apply = (document: number[], plan: PagePlan) => plan.order.map((index) => document[index]);

  it('undoes a reorder, in the right direction', () => {
    const before = initialPlan(4);
    const applied = movePlanned(before, 3, 0);
    const inverse = inversePlan(applied, before);
    expect(applied.order).toEqual([3, 0, 1, 2]);
    // The inverse is "take slot 1, then 2, then 3, then 0" — not the same permutation again,
    // which is the mistake that only shows up when a reader presses undo twice.
    expect(inverse?.order).toEqual([1, 2, 3, 0]);
    expect(apply(applied.order, inverse!)).toEqual([0, 1, 2, 3]);
  });

  it('restores the angle a page used to have, and clears one it did not', () => {
    const before: PagePlan = { order: [0, 1], rotations: { 0: 90 } };
    const turned = rotatePlanned(before, 0, 90);
    expect(turned.rotations).toEqual({ 0: 180 });
    expect(inversePlan(turned, before)?.rotations).toEqual({ 0: 90 });

    const fresh = rotatePlanned(initialPlan(2), 1, 90);
    expect(inversePlan(fresh, initialPlan(2))?.rotations).toEqual({ 1: 0 });
  });

  it('gives up when a page is gone, because no permutation brings it back', () => {
    const before = initialPlan(3);
    const applied = removePlanned(before, 2)!;
    expect(inversePlan(applied, before)).toBeNull();
  });
});

describe('withViewRotations', () => {
  it('folds the viewer’s own turns into the plan', () => {
    const plan = withViewRotations(initialPlan(3), { 1: 90, 2: 0 });
    expect(plan.rotations).toEqual({ 1: 90 });
    expect(isPristine(plan, 3)).toBe(false);
  });

  it('composes with a turn made in the panel, and skips pages the plan removed', () => {
    const turned = rotatePlanned(initialPlan(3), 0, 90);
    const merged = withViewRotations(turned, { 0: 90, 2: 180 });
    expect(merged.rotations).toEqual({ 0: 180, 2: 180 });
    const afterRemove = removePlanned(merged, 2)!;
    expect(withViewRotations(afterRemove, { 2: 90 }).rotations).toEqual({ 0: 180 });
  });
});
