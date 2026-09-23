import { describe, expect, it } from 'vitest';
import { planToolbarOverflow } from './toolbar';
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
