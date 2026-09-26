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

/** Anything the bar can hold: identified by `id`, ordered by `priority`. */
export interface ToolbarConfigurable {
  id: string;
  priority: number;
}

/**
 * What the application says about the bar's contents. Both halves key on a
 * control's `id` — `sidebar`, `page`, `zoomIn`, `layout`, or a feature's own id
 * — so changing one entry never means restating the list.
 */
export interface ToolbarControlConfig {
  /** Drop these entirely. A control that is not there cannot be clicked. */
  hide?: readonly string[];
  /** Re-order. Lower stays in the bar longer; 1 is page navigation. */
  priorities?: Readonly<Record<string, number>>;
  /**
   * Placement, not eviction: the named controls come first in this order and
   * everything else follows in the order it was built in. One id is enough to
   * pull a control to the front; list them all to dictate the bar exactly.
   */
  order?: readonly string[];
}

/**
 * Fold the control ids that mounted features take over into the host's own list.
 *
 * One mechanism, not two: a feature's `replaces` becomes an entry in the same
 * `hide` the application writes, so `hide` keeps its meaning of removal-before
 * anything else, and a host that already hid that control — or replaced it with
 * its own under the same id — is contradicted by nothing. The host's object comes
 * back untouched when no feature asks for anything, which keeps the toolbar's
 * memoisation stable for every viewer that does not annotate.
 */
export function withReplacedControls(
  config: ToolbarControlConfig | undefined,
  replaces: readonly string[],
): ToolbarControlConfig | undefined {
  if (!replaces.length) return config;
  return { ...config, hide: [...(config?.hide ?? []), ...replaces] };
}

/**
 * Apply the application's configuration to a list of controls.
 *
 * Removal runs first, which is what makes `hide` mean what it says: a hidden
 * control cannot be brought back by a priority or an order entry for the same
 * id. Unknown ids are ignored rather than rejected, because the bar is built
 * from optional props — ordering by `fullscreen` should read the same whether or
 * not the platform offered it.
 */
export function applyControlConfig<T extends ToolbarConfigurable>(
  items: readonly T[],
  config: ToolbarControlConfig | undefined,
): T[] {
  if (!config) return [...items];
  const hidden = config.hide ? new Set(config.hide) : undefined;
  const kept = items
    .filter((item) => !hidden?.has(item.id))
    .map((item) => {
      const priority = config.priorities?.[item.id];
      return priority === undefined || priority === item.priority ? item : { ...item, priority };
    });
  if (!config.order?.length) return kept;
  const rank = new Map(config.order.map((id, index) => [id, index]));
  const listed = kept.filter((item) => rank.has(item.id));
  const rest = kept.filter((item) => !rank.has(item.id));
  listed.sort((a, b) => rank.get(a.id)! - rank.get(b.id)!);
  return [...listed, ...rest];
}

/**
 * Overlay `additions` on `base`, by id.
 *
 * An addition that names an existing control replaces it *where it stands*, so a
 * host swapping out one button does not move it to the end of the bar; one that
 * names nothing is appended and lands wherever its priority puts it.
 */
export function mergeToolbarItems<T extends { id: string }>(
  base: readonly T[],
  additions: readonly T[],
): T[] {
  if (additions.length === 0) return [...base];
  const byId = new Map(additions.map((addition) => [addition.id, addition]));
  const seen = new Set<string>();
  const out = base.map((item) => {
    const replacement = byId.get(item.id);
    if (!replacement) return item;
    seen.add(item.id);
    return replacement;
  });
  for (const addition of additions) {
    if (!seen.has(addition.id)) out.push(addition);
  }
  return out;
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
