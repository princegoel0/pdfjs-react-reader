/**
 * Deciding which toolbar controls stay in the bar and which fold into the
 * overflow menu. Pure so the eviction order can be unit-tested without a DOM.
 */

export interface ToolbarItemMeasure {
  id: string;
  /** Lower numbers stay in the bar longer. Items sharing a number are an
   * atomic cluster: they fold together, so a pair like prev/next can never be
   * split into a lone button. */
  priority: number;
  /** Natural width in CSS px, measured from the hidden sizer row. */
  width: number;
  /** Informational rather than actionable, so it is dropped instead of being
   * moved into the menu (a document title has no meaning in an action list). */
  hideOnly?: boolean;
}

export interface ToolbarOverflowPlan {
  /** Item ids in the given visual order. */
  inline: string[];
  /** Item ids in the menu, most important first. */
  overflow: string[];
  /** Items that are neither in the bar nor in the menu. */
  hidden: string[];
  showMenu: boolean;
}

function totalWidth(items: ToolbarItemMeasure[], gap: number): number {
  if (items.length === 0) return 0;
  let total = 0;
  for (const item of items) total += item.width;
  return total + gap * (items.length - 1);
}

/**
 * Folds the lowest-priority clusters first, so the controls a reader uses most
 * survive down to the narrowest container. Reserves room for the ⋯ trigger as
 * soon as one item is evicted, which is what keeps the row from oscillating
 * around the boundary where the last item exactly fits.
 */
export function planToolbarOverflow(
  items: ToolbarItemMeasure[],
  available: number,
  gap: number,
  menuWidth: number,
): ToolbarOverflowPlan {
  if (totalWidth(items, gap) <= available) {
    return { inline: items.map((item) => item.id), overflow: [], hidden: [], showMenu: false };
  }

  const budget = available - menuWidth - gap;

  // One entry per distinct priority, in visual order; eviction order is by
  // priority descending, so the least important cluster goes first.
  const clusters = new Map<number, ToolbarItemMeasure[]>();
  for (const item of items) {
    const cluster = clusters.get(item.priority);
    if (cluster) cluster.push(item);
    else clusters.set(item.priority, [item]);
  }

  let remaining = items.slice();
  const overflow: ToolbarItemMeasure[] = [];
  const hidden: ToolbarItemMeasure[] = [];

  for (const priority of [...clusters.keys()].sort((a, b) => b - a)) {
    if (totalWidth(remaining, gap) <= budget) break;
    const cluster = clusters.get(priority)!;
    // Never empty the bar: the highest-priority cluster always stays inline and
    // relies on the row wrapping instead.
    if (cluster.length === remaining.length) break;
    remaining = remaining.filter((item) => !cluster.includes(item));
    for (const item of cluster) {
      (item.hideOnly ? hidden : overflow).push(item);
    }
  }

  overflow.sort((a, b) => a.priority - b.priority);

  return {
    inline: remaining.map((item) => item.id),
    overflow: overflow.map((item) => item.id),
    hidden: hidden.map((item) => item.id),
    showMenu: overflow.length > 0,
  };
}
