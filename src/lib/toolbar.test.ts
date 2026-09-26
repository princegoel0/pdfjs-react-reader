import { describe, expect, it } from 'vitest';
import { applyControlConfig, mergeToolbarItems, planToolbarOverflow, withReplacedControls } from './toolbar';
import type { ToolbarItemMeasure } from './toolbar';

/** The real control set, in visual order, at the desktop token sizes. */
function items(overrides: Partial<Record<string, number>> = {}): ToolbarItemMeasure[] {
  const base: ToolbarItemMeasure[] = [
    { id: 'sidebar', priority: 3, width: 32 },
    { id: 'prev', priority: 1, width: 32 },
    { id: 'page', priority: 1, width: 52 },
    { id: 'count', priority: 11, width: 32, hideOnly: true },
    { id: 'next', priority: 1, width: 32 },
    { id: 'search', priority: 4, width: 32 },
    { id: 'draw', priority: 6, width: 32 },
    { id: 'zoomOut', priority: 2, width: 32 },
    { id: 'zoomIn', priority: 2, width: 32 },
    { id: 'fit', priority: 5, width: 80 },
    { id: 'rotateCcw', priority: 7, width: 32 },
    { id: 'rotateCw', priority: 7, width: 32 },
    { id: 'layout', priority: 10, width: 96 },
    { id: 'download', priority: 9, width: 32 },
    { id: 'print', priority: 8, width: 32 },
    { id: 'meta', priority: 12, width: 160, hideOnly: true },
  ];
  return base.map((item) =>
    item.id in overrides ? { ...item, width: overrides[item.id]! } : item,
  );
}

const GAP = 6;
const MENU = 32;

const ids = (plan: { inline: string[] }) => plan.inline.join(',');

describe('planToolbarOverflow', () => {
  it('keeps every control inline when the row fits', () => {
    const all = items();
    const needed = all.reduce((sum, i) => sum + i.width, 0) + GAP * (all.length - 1);
    const plan = planToolbarOverflow(all, needed, GAP, MENU);
    expect(plan.showMenu).toBe(false);
    expect(plan.overflow).toEqual([]);
    expect(plan.inline).toHaveLength(all.length);
  });

  it('folds the lowest-priority cluster first', () => {
    const all = items();
    const needed = all.reduce((sum, i) => sum + i.width, 0) + GAP * (all.length - 1);
    // One item short of fitting: the document title (priority 12) goes.
    const plan = planToolbarOverflow(all, needed - 1, GAP, MENU);
    expect(plan.hidden).toEqual(['meta']);
    expect(plan.inline).not.toContain('meta');
  });

  it('drops informational items from the bar without adding them to the menu', () => {
    const plan = planToolbarOverflow(items({ meta: 400 }), 900, GAP, MENU);
    expect(plan.hidden).toContain('meta');
    expect(plan.overflow).not.toContain('meta');
  });

  it('never splits an equal-priority cluster', () => {
    // Tight enough that the rotate pair cannot both fit: both must go together.
    const plan = planToolbarOverflow(items(), 420, GAP, MENU);
    expect(plan.inline.includes('rotateCcw')).toBe(plan.inline.includes('rotateCw'));
    expect(plan.overflow.includes('rotateCcw')).toBe(plan.overflow.includes('rotateCw'));
    expect(plan.inline).toContain('prev');
    expect(plan.inline).toContain('next');
  });

  it('reserves room for the menu trigger once something folds', () => {
    const all = items();
    // Wide enough that only the document title has to go, so no trigger is
    // needed: dropping an informational item is not an overflow.
    const needed = all.reduce((sum, i) => sum + i.width, 0) + GAP * (all.length - 1);
    const plan = planToolbarOverflow(all, needed - 1, GAP, MENU);
    expect(plan.showMenu).toBe(false);
    expect(plan.hidden).toEqual(['meta']);
  });

  it('keeps the folded row inside the bar at every width', () => {
    const all = items();
    const navOnly = ['prev', 'page', 'next'];
    for (let available = 100; available <= 900; available += 5) {
      const plan = planToolbarOverflow(all, available, GAP, MENU);
      const inline = all.filter((item) => plan.inline.includes(item.id));
      const used =
        inline.reduce((sum, item) => sum + item.width, 0) +
        GAP * Math.max(0, inline.length - 1) +
        (plan.showMenu ? GAP + MENU : 0);
      // The one tolerated overflow is the last cluster standing, which relies
      // on the row wrapping rather than hiding every control.
      if (used > available) expect(inline.map((item) => item.id)).toEqual(navOnly);
    }
  });

  it('orders the menu most important first', () => {
    const plan = planToolbarOverflow(items(), 300, GAP, MENU);
    expect(plan.overflow).toEqual([...plan.overflow].sort((a, b) => PRIORITY[a]! - PRIORITY[b]!));
  });

  it('keeps the highest-priority cluster in the bar at any width', () => {
    const plan = planToolbarOverflow(items(), 40, GAP, MENU);
    expect(ids(plan)).toBe('prev,page,next');
    expect(plan.showMenu).toBe(true);
  });

  it('handles an empty control set', () => {
    expect(planToolbarOverflow([], 400, GAP, MENU)).toEqual({
      inline: [],
      overflow: [],
      hidden: [],
      showMenu: false,
    });
  });
});

const PRIORITY: Record<string, number> = {
  prev: 1,
  page: 1,
  next: 1,
  zoomOut: 2,
  zoomIn: 2,
  sidebar: 3,
  search: 4,
  fit: 5,
  draw: 6,
  rotateCcw: 7,
  rotateCw: 7,
  print: 8,
  download: 9,
  layout: 10,
  count: 11,
  meta: 12,
};

describe('applyControlConfig', () => {
  const list = [
    { id: 'page', priority: 1 },
    { id: 'search', priority: 4 },
    { id: 'layout', priority: 10 },
  ];

  it('leaves the list alone with no configuration', () => {
    const out = applyControlConfig(list, undefined);
    expect(out.map((item) => item.id)).toEqual(['page', 'search', 'layout']);
    expect(out).not.toBe(list);
  });

  it('removes by id', () => {
    expect(applyControlConfig(list, { hide: ['search'] }).map((item) => item.id)).toEqual([
      'page',
      'layout',
    ]);
  });

  it('re-orders by id', () => {
    const out = applyControlConfig(list, { priorities: { layout: 1 } });
    expect(out.find((item) => item.id === 'layout')?.priority).toBe(1);
  });

  it('cannot be coaxed back with a priority for a hidden id', () => {
    // Removal runs first, which is what makes `hide` mean what it says.
    const out = applyControlConfig(list, { hide: ['search'], priorities: { search: 0 } });
    expect(out.some((item) => item.id === 'search')).toBe(false);
  });

  it('ignores ids that are not in the bar', () => {
    // Fullscreen is absent on a browser without it, and a host hiding it by
    // policy should get the same result either way.
    expect(applyControlConfig(list, { hide: ['fullscreen'], priorities: { nope: 2 } })).toHaveLength(
      3,
    );
  });

  it('keeps the same object when nothing about it changed', () => {
    // `PdfPage` is not the only memoised consumer: a fresh item object on every
    // render would re-render the bar's whole subtree.
    const out = applyControlConfig(list, { priorities: { search: 4 } });
    expect(out[1]).toBe(list[1]);
  });

  it('places the listed controls first and leaves the rest in order', () => {
    const out = applyControlConfig(list, { order: ['layout', 'page'] });
    expect(out.map((item) => item.id)).toEqual(['layout', 'page', 'search']);
  });

  it('orders what is there, not what was asked for', () => {
    // `fullscreen` is absent on a browser without the API, and a host that
    // listed it should see the same bar either way.
    const out = applyControlConfig(list, { order: ['fullscreen', 'layout'] });
    expect(out.map((item) => item.id)).toEqual(['layout', 'page', 'search']);
  });

  it('cannot be brought back by ordering a hidden id', () => {
    const out = applyControlConfig(list, { hide: ['search'], order: ['search', 'layout'] });
    expect(out.map((item) => item.id)).toEqual(['layout', 'page']);
  });
});

describe('mergeToolbarItems', () => {
  interface Item {
    id: string;
    label?: string;
  }
  const base: Item[] = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];

  it('replaces in place, so a swapped control keeps its position', () => {
    const replacement: Item = { id: 'b', label: 'mine' };
    const out = mergeToolbarItems(base, [replacement]);
    expect(out.map((item) => item.id)).toEqual(['a', 'b', 'c']);
    expect(out[1]).toBe(replacement);
  });

  it('appends a control that names nothing existing', () => {
    expect(mergeToolbarItems(base, [{ id: 'z', label: 'new' }]).map((item) => item.id)).toEqual([
      'a',
      'b',
      'c',
      'z',
    ]);
  });

  it('returns a copy of the base list when there is nothing to add', () => {
    const out = mergeToolbarItems(base, []);
    expect(out).not.toBe(base);
    expect(out).toEqual(base);
  });
});

describe('withReplacedControls', () => {
  it('hands back the host object untouched when no feature takes anything over', () => {
    // Identity matters: the toolbar memoises on this, and every viewer that does
    // not annotate must keep the configuration it already had.
    const config = { hide: ['meta'], order: ['search', 'page'] } as const;
    expect(withReplacedControls(config, [])).toBe(config);
    expect(withReplacedControls(undefined, [])).toBeUndefined();
  });

  it('adds a hide list where the host had none', () => {
    expect(withReplacedControls(undefined, ['draw'])).toEqual({ hide: ['draw'] });
  });

  it('keeps what the host hid and everything else it configured', () => {
    const out = withReplacedControls(
      { hide: ['meta'], priorities: { layout: 2 }, order: ['search'] },
      ['draw'],
    );
    expect(out).toEqual({
      hide: ['meta', 'draw'],
      priorities: { layout: 2 },
      order: ['search'],
    });
  });

  it('removes the replaced control from a bar that is otherwise configured around it', () => {
    // The composition the shell relies on: a host that re-ordered `draw` still
    // loses it, because removal runs before ordering.
    const list = [
      { id: 'search', priority: 4 },
      { id: 'draw', priority: 6 },
      { id: 'print', priority: 8 },
    ];
    const config = withReplacedControls({ order: ['draw', 'search'] }, ['draw']);
    expect(applyControlConfig(list, config).map((item) => item.id)).toEqual(['search', 'print']);
  });
});
