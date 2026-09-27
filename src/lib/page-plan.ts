/*
 * The page-editing model, as data.
 *
 * A plan is everything the reader has decided about page order, rotation and deletion, and it
 * is always expressed against **one** document: the file the plan started from, whose pages are
 * numbered by their position when it was loaded. That single rule is what makes the rest cheap.
 * A rotation is keyed to the page rather than to its slot, so moving a page carries its rotation
 * with it and needs no bookkeeping; a deletion is simply an index missing from `order`; undo is
 * the previous plan, which is an array of integers, not a copy of the file; and one write at the
 * end turns the plan into bytes with `arrangePages`.
 *
 * It also matches what the writer can and cannot do, both measured in `0.7`'s Spike C: a move is
 * a permutation of the page tree (moving with `removePage` + `insertPage` deletes the page's
 * object and leaves the tree naming it), and a rotation belongs to the page object, so it
 * survives the move and arrives in a new slot reporting a new box.
 */

/** Which pages the document should hold, and how each should sit, against its base file. */
export interface PagePlan {
  /**
   * Base-document page indices, in the order they should appear. An index missing from the list
   * has been removed; the list is never empty, because a document without pages is not a
   * document.
   */
  order: number[];
  /**
   * Absolute rotation in degrees, keyed by base index. A page absent here keeps whatever the
   * file already says — the plan records the reader's change, not the page's whole state.
   */
  rotations: Record<number, number>;
}

/** The plan that says "unchanged" for a document of `count` pages. */
export function initialPlan(count: number): PagePlan {
  return { order: Array.from({ length: count }, (_, index) => index), rotations: {} };
}

/** True when the plan would produce the document as it stands: no moves, no turns, no cuts. */
export function isPristine(plan: PagePlan, count: number): boolean {
  if (Object.keys(plan.rotations).length > 0) return false;
  if (plan.order.length !== count) return false;
  return plan.order.every((index, slot) => index === slot);
}

/** How many pages the plan will keep, which is what the panel counts against the original. */
export function plannedPages(plan: PagePlan): number {
  return plan.order.length;
}

/**
 * Move the page at slot `from` so it ends at slot `to`, slots counted in the planned order.
 *
 * Out-of-range ends clamp rather than throw: a drag past either edge means "to the end", and a
 * button can be clicked just as the plan changes underneath it.
 */
export function movePlanned(plan: PagePlan, from: number, to: number): PagePlan {
  const order = [...plan.order];
  if (from < 0 || from >= order.length) return plan;
  const clamped = Math.max(0, Math.min(order.length - 1, to));
  if (clamped === from) return plan;
  const [moved] = order.splice(from, 1);
  if (moved === undefined) return plan;
  order.splice(clamped, 0, moved);
  return { order, rotations: plan.rotations };
}

/** Turn the page in slot `slot` by `degrees`, usually a quarter turn. */
export function rotatePlanned(plan: PagePlan, slot: number, degrees: number): PagePlan {
  const base = plan.order[slot];
  if (base === undefined) return plan;
  const current = plan.rotations[base] ?? 0;
  return {
    order: plan.order,
    rotations: { ...plan.rotations, [base]: ((current + degrees) % 360 + 360) % 360 },
  };
}

/**
 * Drop the page in slot `slot`, refusing to remove the last one.
 *
 * Returns `null` rather than an unchanged plan so the caller can distinguish "nothing happened"
 * from a plan that happens to be identical, which is what a live region needs to stay quiet.
 */
export function removePlanned(plan: PagePlan, slot: number): PagePlan | null {
  if (plan.order.length <= 1) return null;
  if (plan.order[slot] === undefined) return null;
  const order = plan.order.filter((_, index) => index !== slot);
  const gone = plan.order[slot];
  const { [gone]: _dropped, ...rotations } = plan.rotations;
  return { order, rotations };
}

/** The base index of the page currently planned for `slot`, for a label that names the page. */
export function pageAtSlot(plan: PagePlan, slot: number): number | undefined {
  return plan.order[slot];
}

/**
 * The plan that undoes `applied`, given the document as it stood before it.
 *
 * `order` is in the terms the writer wants: slot `k` of the document on screen should receive the
 * page now sitting at `order[k]`, which means looking up where each earlier page ended up.
 * Getting this backwards is invisible until a reader presses undo twice, so it is the part worth
 * reading slowly — the inverse of "page 3 went to the front" is "take slot 1, then 2, then 3,
 * then 0", not the same permutation again.
 *
 * Order and rotations both invert cleanly, which is why undo costs an array of integers rather
 * than a copy of the file. Removals do not: pages are named by indices the earlier document had
 * and the later one does not, so this returns `null` and the caller has to fall back to the bytes
 * it kept from before the apply. One limit to state plainly — a page whose *file* rotation was not
 * zero and whose earlier plan said nothing is restored to zero, because "leave it as loaded" and
 * "it was 0" are the same entry to a plan. A caller that must not lose that difference undoes an
 * apply from its snapshot.
 */
export function inversePlan(applied: PagePlan, before: PagePlan): PagePlan | null {
  if (applied.order.length !== before.order.length) return null;
  const where = new Map(applied.order.map((base, slot) => [base, slot]));
  const order = before.order.map((base) => where.get(base) ?? -1);
  if (order.includes(-1)) return null;
  const rotations: Record<number, number> = {};
  for (const base of before.order) {
    const was = before.rotations[base];
    const now = applied.rotations[base];
    if (was !== now) rotations[base] = was ?? 0;
  }
  return { order, rotations };
}

/**
 * Fold the viewer's own per-page rotation into a plan.
 *
 * The shell's rotations are view state keyed to the document on screen, which is the plan's base
 * document as long as nothing has been applied — so the two can be merged by index. A plan entry
 * wins, because it is the change the reader made in this panel, and a later write puts both into
 * the file and clears the view state.
 */
export function withViewRotations(plan: PagePlan, viewRotations: Record<number, number>): PagePlan {
  const entries = Object.entries(viewRotations).filter(
    ([base, angle]) => plan.order.includes(Number(base)) && angle % 360 !== 0,
  );
  if (!entries.length) return plan;
  const rotations = { ...plan.rotations };
  for (const [base, angle] of entries) {
    const index = Number(base);
    // Neither side is empty: whichever the reader did last is the one they meant, and the panel
    // cannot tell, so a turn set in both places composes rather than replaces.
    rotations[index] = ((rotations[index] ?? 0) + angle) % 360;
  }
  return { order: plan.order, rotations };
}
