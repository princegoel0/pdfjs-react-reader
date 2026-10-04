import { Fragment, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import type { PageLayout, ScaleMode } from '../lib/layout';
import { planToolbarOverflow } from '../lib/toolbar';
import type { ToolbarControlConfig } from '../lib/toolbar';
import { applyControlConfig, mergeToolbarItems } from '../lib/toolbar';
import {
  formatZoomPercent,
  MAX_SCALE,
  MIN_SCALE,
  nextZoomDown,
  nextZoomUp,
  parseZoomPercent,
  ZOOM_LEVELS,
} from '../lib/zoom';
import { formatLabel } from '../lib/labels';
import { formatPageLabel, labelsDifferFromNumbers, resolvePageInput } from '../lib/page-labels';
import { useLabels } from './labels-context';
import {
  ChevronLeftIcon,
  ChevronRightIcon,
  MaximizeIcon,
  MinimizeIcon,
  MinusIcon,
  MoreIcon,
  PanelLeftIcon,
  PlusIcon,
  RotateCcwIcon,
  RotateCwIcon,
  SearchIcon,
} from './icons';

export type { PageLayout, ScaleMode };

export { ZOOM_LEVELS } from '../lib/zoom';

export interface ToolbarProps {
  currentPage: number;
  numPages: number;
  /**
   * What the pages are called, from `doc.getPageLabels()`. Absent or plain-numbered, the page box stays a
   * number input; anything else makes it a text box that shows the label and accepts one back (FR-12).
   */
  pageLabels?: readonly string[] | null;
  scaleMode: ScaleMode;
  resolvedScale: number;
  onPageChange: (page: number) => void;
  onScaleModeChange: (mode: ScaleMode) => void;
  searchOpen?: boolean;
  onSearchToggle?: () => void;
  /** Rendered inside the search bar while `searchOpen` is true. */
  searchContent?: ReactNode;
  sidebarOpen?: boolean;
  onSidebarToggle?: () => void;
  pageLayout?: PageLayout;
  onPageLayoutChange?: (layout: PageLayout) => void;
  onRotate?: (delta: number) => void;
  /** Document name shown in the bar at wide sizes. */
  docLabel?: string;
  /** Effective zoom as a percentage, e.g. "124%". */
  zoomLabel?: string;
  /**
   * Controls contributed by mounted features, folded into the same overflow
   * plan as these: their `priority` decides what survives a narrow bar.
   */
  featureItems?: readonly ToolbarItem[];
  /** Remove, re-order or add controls. See {@link ToolbarControls}. */
  controls?: ToolbarControls;
  /** Toggles fullscreen. Omit to hide the control where it is unsupported. */
  onFullscreenToggle?: () => void;
  fullscreenActive?: boolean;
  /** Rotates one page in place. Omit to keep rotation global only. */
  onRotatePage?: (pageNumber: number, delta: number) => void;
}

/**
 * A control that can sit in the bar or fold into the overflow menu.
 *
 * `priority` is the eviction order: 1 is page navigation, 12 is the document
 * label. Items sharing a priority fold as one cluster, so a pair like the
 * rotate buttons can never be split into a lone leftover button.
 */
export interface ToolbarItem {
  id: string;
  priority: number;
  /** Visible text for this item's row in the overflow menu. */
  label: string;
  /** Information, not an action: dropped rather than menuised when it will not fit. */
  hideOnly?: boolean;
  node: ReactNode;
}

/**
 * What the application says about the bar's contents.
 *
 * Everything keys on a control's `id`. The built-ins are `sidebar`, `prev`,
 * `page`, `next`, `search`, `zoomOut`, `zoomCustom`, `zoomIn`, `fit`,
 * `rotateCcw`, `rotateCw`, `rotatePage`, `fullscreen`, `layout`, `count` and
 * `meta`; a mounted feature adds its own control id, which is whatever its
 * `controls[].id` says (`print`, `download`, …). An id that is not present —
 * `fullscreen` on a browser without it, or one whose feature you did not mount —
 * is simply ignored.
 *
 * `priorities` decides what survives a narrow bar; `order` decides where a
 * control sits while it is in it. They are separate because folding is about
 * importance and placement is about habit.
 */
export interface ToolbarControls extends ToolbarControlConfig {
  /**
   * Host-written controls. One that names an existing id replaces it *where it
   * stands*; one that names nothing new is placed by its own priority, and folds
   * into the overflow by the same arithmetic as everything else.
   */
  add?: readonly ToolbarItem[];
}

interface Metrics {
  /** Content width available to the toolbar row. */
  avail: number;
  gap: number;
  widths: Record<string, number>;
}

function pxLength(value: string): number {
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function sameWidths(a: Record<string, number>, b: Record<string, number>): boolean {
  const keys = Object.keys(a);
  if (keys.length !== Object.keys(b).length) return false;
  return keys.every((key) => a[key] === b[key]);
}

export function Toolbar({
  currentPage,
  numPages,
  pageLabels = null,
  scaleMode,
  resolvedScale,
  onPageChange,
  onScaleModeChange,
  searchOpen = false,
  onSearchToggle,
  searchContent,
  sidebarOpen = false,
  onSidebarToggle,
  pageLayout = 'continuous',
  onPageLayoutChange,
  onRotate,
  docLabel,
  zoomLabel,
  featureItems,
  controls,
  onFullscreenToggle,
  fullscreenActive = false,
  onRotatePage,
}: ToolbarProps) {
  const labels = useLabels();
  /*
   * Whether this document calls its pages something other than their numbers. Memoised because the check
   * walks the table, and a thousand-page labelled document re-renders this bar on every page the reader
   * turns — the answer only changes with the document.
   */
  const labelled = useMemo(() => labelsDifferFromNumbers(pageLabels, numPages), [pageLabels, numPages]);
  // The box holds the page's *name*, which is its label when the document has one (FR-12).
  const boxValue = () => (labelled ? formatPageLabel(pageLabels, currentPage - 1) : String(currentPage));
  const [pageInput, setPageInput] = useState(boxValue);
  const [menuOpen, setMenuOpen] = useState(false);
  const [metrics, setMetrics] = useState<Metrics | null>(null);
  const toolbarRef = useRef<HTMLDivElement | null>(null);
  const sizerRef = useRef<HTMLDivElement | null>(null);
  const overflowRef = useRef<HTMLDivElement | null>(null);
  const menuButtonRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    setPageInput(boxValue());
  }, [currentPage, labelled]);

  // Mirrors pageInput: kept in sync with the scale actually on screen, so a fit
  // mode or a pinch gesture updates the box rather than leaving a stale number.
  const [zoomInput, setZoomInput] = useState(() => formatZoomPercent(resolvedScale));
  useEffect(() => {
    setZoomInput(formatZoomPercent(resolvedScale));
  }, [resolvedScale]);
  const applyZoomInput = () => {
    const scale = parseZoomPercent(zoomInput);
    // Reject rather than snap: an unparsable edit should return the box to what
    // is on screen instead of silently jumping the zoom somewhere.
    if (scale === null || Number.isNaN(scale)) {
      setZoomInput(formatZoomPercent(resolvedScale));
      return;
    }
    onScaleModeChange(scale);
  };

  // Close the overflow menu on outside interaction or Escape.
  useEffect(() => {
    if (!menuOpen) return;
    const onPointerDown = (e: PointerEvent) => {
      if (!overflowRef.current?.contains(e.target as Node)) setMenuOpen(false);
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      setMenuOpen(false);
      // Return focus to the trigger so keyboard users are not dropped at the
      // top of the host document when the menu dismisses.
      menuButtonRef.current?.focus();
    };
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [menuOpen]);

  // `type="number"` only enforces min/max on the spinner and the keyboard, so a typed
  // value can leave the document. The scroll clamps, but `currentPage` then never
  // changes and the sync effect never runs — so the box has to be corrected here,
  // or it keeps showing a page that does not exist.
  const commitPage = () => {
    const target = resolvePageInput(pageInput, pageLabels, numPages);
    if (target === null) {
      // Names no page and is not a whole number: the box goes back to what is on screen rather than to
      // wherever the digits inside the string pointed.
      setPageInput(boxValue());
      return;
    }
    // Write the resolved page back, because a value clamped into the document has to be corrected here
    // even though the scroll lands where it lands: `currentPage` does not change when the reader was
    // already on the last page, so nothing else would put the box right.
    setPageInput(labelled ? formatPageLabel(pageLabels, target - 1) : String(target));
    if (target !== currentPage) onPageChange(target);
  };

  const selectValue = typeof scaleMode === 'number' ? String(scaleMode) : scaleMode;

  const items: ToolbarItem[] = [];

  if (onSidebarToggle) {
    items.push({
      id: 'sidebar',
      priority: 3,
      label: labels.overflowSidebar,
      node: (
        <button
          type="button"
          className="pjsr-button"
          aria-label={labels.toggleSidebar}
          title={labels.toggleSidebar}
          aria-expanded={sidebarOpen}
          onClick={onSidebarToggle}
        >
          <PanelLeftIcon />
        </button>
      ),
    });
  }

  items.push(
    {
      id: 'prev',
      priority: 1,
      label: labels.overflowGoToPage,
      node: (
        <button
          type="button"
          className="pjsr-button"
          aria-label={labels.previousPage}
          title={labels.previousPage}
          disabled={currentPage <= 1}
          onClick={() => onPageChange(currentPage - 1)}
        >
          <ChevronLeftIcon />
        </button>
      ),
    },
    {
      id: 'page',
      priority: 1,
      label: labels.overflowGoToPage,
      node: (
        <input
          /*
           * The control follows the document. A labelled page box has to hold "xii", and `type="number"`
           * reads such a value as the empty string, so the browser would erase what the reader typed before
           * it ever reached `commitPage`. An ordinary PDF keeps its spinner and its numeric keyboard, which
           * is the case nine hundred and ninety-nine documents in a thousand are.
           */
          type={labelled ? 'text' : 'number'}
          className="pjsr-page-input"
          data-labelled={labelled ? 'true' : undefined}
          spellCheck={false}
          aria-label={labels.pageNumber}
          {...(labelled ? null : { min: 1, max: numPages || 1 })}
          value={pageInput}
          onChange={(e) => setPageInput(e.target.value)}
          onBlur={commitPage}
          onKeyDown={(e) => {
            if (e.key === 'Enter') commitPage();
          }}
        />
      ),
    },
    {
      id: 'count',
      priority: 11,
      label: labels.overflowPageCount,
      hideOnly: true,
      node: (
        <span className="pjsr-page-count">
          {formatLabel(labels.pageCountOf, { total: numPages || '—' })}
        </span>
      ),
    },
    {
      id: 'next',
      priority: 1,
      label: labels.overflowGoToPage,
      node: (
        <button
          type="button"
          className="pjsr-button"
          aria-label={labels.nextPage}
          title={labels.nextPage}
          disabled={numPages === 0 || currentPage >= numPages}
          onClick={() => onPageChange(currentPage + 1)}
        >
          <ChevronRightIcon />
        </button>
      ),
    },
  );

  if (onSearchToggle) {
    items.push({
      id: 'search',
      priority: 4,
      label: labels.overflowSearch,
      node: (
        <button
          type="button"
          className="pjsr-button"
          aria-label={labels.searchDocument}
          title={labels.searchDocument}
          aria-expanded={searchOpen}
          onClick={onSearchToggle}
        >
          <SearchIcon />
        </button>
      ),
    });
  }

  items.push(
    {
      id: 'zoomOut',
      priority: 2,
      label: labels.overflowZoomRange,
      node: (
        <button
          type="button"
          className="pjsr-button"
          aria-label={labels.zoomOut}
          title={labels.zoomOut}
          disabled={resolvedScale <= MIN_SCALE}
          onClick={() => onScaleModeChange(nextZoomDown(resolvedScale))}
        >
          <MinusIcon />
        </button>
      ),
    },
    {
      id: 'fit',
      priority: 5,
      label: labels.zoomLevel,
      node: (
        <select
          className="pjsr-zoom-select"
          aria-label={labels.zoomLevel}
          title={labels.zoomLevel}
          value={selectValue}
          onChange={(e) => {
            const value = e.target.value;
            onScaleModeChange(
              value === 'fit-width' || value === 'fit-page' || value === 'automatic'
                ? value
                : Number(value),
            );
          }}
        >
          <option value="automatic">{labels.zoomAutomatic}</option>
          <option value="fit-width">{labels.fitWidth}</option>
          <option value="fit-page">{labels.fitPage}</option>
          {/* A custom scale has no matching option, which would leave the select
              rendering blank while zoom is in fact applied. */}
          {typeof scaleMode === 'number' && !ZOOM_LEVELS.includes(scaleMode) && (
            <option value={String(scaleMode)}>{formatZoomPercent(scaleMode)}%</option>
          )}
          {ZOOM_LEVELS.map((level) => (
            <option key={level} value={String(level)}>
              {Math.round(level * 100)}%
            </option>
          ))}
        </select>
      ),
    },
    {
      id: 'zoomIn',
      priority: 2,
      label: labels.overflowZoomRange,
      node: (
        <button
          type="button"
          className="pjsr-button"
          aria-label={labels.zoomIn}
          title={labels.zoomIn}
          disabled={resolvedScale >= MAX_SCALE}
          onClick={() => onScaleModeChange(nextZoomUp(resolvedScale))}
        >
          <PlusIcon />
        </button>
      ),
    },
  );

  items.push({
    id: 'zoomCustom',
    priority: 9,
    label: labels.zoomCustom,
    node: (
      <span className="pjsr-zoom-custom">
        <input
          className="pjsr-zoom-input"
          type="text"
          inputMode="decimal"
          aria-label={labels.zoomCustom}
          title={labels.zoomCustom}
          value={zoomInput}
          onChange={(e) => setZoomInput(e.target.value)}
          onBlur={applyZoomInput}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              applyZoomInput();
            } else if (e.key === 'Escape') {
              e.preventDefault();
              setZoomInput(formatZoomPercent(resolvedScale));
              e.currentTarget.blur();
            }
          }}
        />
        <span className="pjsr-zoom-custom-suffix" aria-hidden="true">
          %
        </span>
      </span>
    ),
  });

  if (onRotate) {
    items.push(
      {
        id: 'rotateCcw',
        priority: 7,
        label: labels.overflowRotate,
        node: (
          <button
            type="button"
            className="pjsr-button"
            aria-label={labels.rotateCounterclockwise}
            title={labels.rotateCounterclockwise}
            onClick={() => onRotate(-90)}
          >
            <RotateCcwIcon />
          </button>
        ),
      },
      {
        id: 'rotateCw',
        priority: 7,
        label: labels.overflowRotate,
        node: (
          <button
            type="button"
            className="pjsr-button"
            aria-label={labels.rotateClockwise}
            title={labels.rotateClockwise}
            onClick={() => onRotate(90)}
          >
            <RotateCwIcon />
          </button>
        ),
      },
    );
  }

  if (onRotatePage) {
    items.push({
      id: 'rotatePage',
      priority: 8,
      label: labels.rotateCurrentPage,
      node: (
        <button
          type="button"
          className="pjsr-button pjsr-button--page-rotate"
          aria-label={formatLabel(labels.rotatePageLabel, { page: currentPage })}
          title={labels.rotateCurrentPage}
          onClick={() => onRotatePage(currentPage, 90)}
        >
          <RotateCwIcon />
          <span className="pjsr-button-badge" aria-hidden="true">
            {currentPage}
          </span>
        </button>
      ),
    });
  }

  if (onFullscreenToggle) {
    items.push({
      id: 'fullscreen',
      priority: 11,
      label: fullscreenActive ? labels.exitFullscreen : labels.enterFullscreen,
      node: (
        <button
          type="button"
          className="pjsr-button"
          aria-label={fullscreenActive ? labels.exitFullscreen : labels.enterFullscreen}
          title={fullscreenActive ? labels.exitFullscreen : labels.enterFullscreen}
          aria-pressed={fullscreenActive}
          onClick={() => onFullscreenToggle()}
        >
          {fullscreenActive ? <MinimizeIcon /> : <MaximizeIcon />}
        </button>
      ),
    });
  }

  if (onPageLayoutChange) {
    items.push({
      id: 'layout',
      priority: 10,
      label: labels.pageLayout,
      node: (
        <select
          className="pjsr-zoom-select"
          aria-label={labels.pageLayout}
          title={labels.pageLayout}
          value={pageLayout}
          onChange={(e) => onPageLayoutChange(e.target.value as PageLayout)}
        >
          <option value="continuous">{labels.layoutContinuous}</option>
          <option value="single">{labels.layoutSingle}</option>
          <option value="spread">{labels.layoutSpread}</option>
        </select>
      ),
    });
  }

  /* Feature controls join the same fold at the priorities the features ask for,
     so an opted-in print button evicts exactly where the built-in one did. */
  if (featureItems?.length) items.push(...featureItems);

  if (docLabel || zoomLabel) {
    items.push({
      id: 'meta',
      priority: 12,
      label: labels.overflowDocument,
      hideOnly: true,
      node: (
        <div className="pjsr-toolbar-meta">
          {docLabel && (
            <span className="pjsr-meta-title" title={docLabel}>
              {docLabel}
            </span>
          )}
          {zoomLabel && <span className="pjsr-meta-zoom">{zoomLabel}</span>}
        </div>
      ),
    });
  }

  /* The application's own controls first — `add` may replace a built-in by id or
     contribute a new one — and only then its configuration, so `hide` applies to
     the list the host actually ended up with rather than to the built-ins. */
  const configured = applyControlConfig(mergeToolbarItems(items, controls?.add ?? []), controls);

  /* The bar folds on measured widths rather than hand-tuned breakpoints, which
     rot the moment a label changes. Every item is measured once from this
     off-screen copy: `visibility: hidden` keeps it out of the accessibility
     tree and out of the tab order, so the duplicated controls cannot surface a
     second set of names or steal focus. */
  const sizer = (
    <div className="pjsr-toolbar-sizer" ref={sizerRef} aria-hidden="true">
      {configured.map((item) => (
        <span key={item.id} data-pjsr-item={item.id}>
          {item.node}
        </span>
      ))}
      <span data-pjsr-item="menu">
        <button type="button" className="pjsr-button" tabIndex={-1}>
          <MoreIcon />
        </button>
      </span>
    </div>
  );

  useLayoutEffect(() => {
    const toolbar = toolbarRef.current;
    const sizerEl = sizerRef.current;
    if (!toolbar || !sizerEl) return;

    const read = () => {
      const style = getComputedStyle(toolbar);
      const sizerStyle = getComputedStyle(sizerEl);
      const widths: Record<string, number> = {};
      for (const child of Array.from(sizerEl.children)) {
        const el = child as HTMLElement;
        const id = el.dataset.pjsrItem;
        if (id) widths[id] = el.offsetWidth;
      }
      const next: Metrics = {
        avail:
          toolbar.clientWidth - pxLength(style.paddingLeft) - pxLength(style.paddingRight),
        gap: pxLength(sizerStyle.columnGap),
        widths,
      };
      setMetrics((prev) =>
        prev &&
        prev.avail === next.avail &&
        prev.gap === next.gap &&
        sameWidths(prev.widths, next.widths)
          ? prev
          : next,
      );
    };

    read();
    // The sizer is `width: max-content`, so it resizes whenever any control's
    // natural width does — a longer document name, a 4-digit page count.
    const observer = new ResizeObserver(read);
    observer.observe(toolbar);
    observer.observe(sizerEl);
    return () => observer.disconnect();
  }, []);

  const plan = metrics
    ? planToolbarOverflow(
        configured.map((item) => ({
          id: item.id,
          priority: item.priority,
          width: metrics.widths[item.id] ?? 0,
          hideOnly: item.hideOnly,
        })),
        metrics.avail,
        metrics.gap,
        metrics.widths['menu'] ?? 0,
      )
    : {
        inline: configured.map((item) => item.id),
        overflow: [] as string[],
        hidden: [] as string[],
        showMenu: false,
      };

  const inlineSet = new Set(plan.inline);
  /* Walk the planner's order, not the visual one: the menu reads most useful
     action first, and equal priorities are then guaranteed to be adjacent, so
     the rotate pair collapses into a single "Rotate [↺][↻]" row instead of two
     rows that both say Rotate. */
  const byId = new Map(configured.map((item) => [item.id, item]));
  const overflowItems = plan.overflow
    .map((id) => byId.get(id))
    .filter((item): item is ToolbarItem => item !== undefined);
  const menuRows: ToolbarItem[][] = [];
  for (const item of overflowItems) {
    const row = menuRows[menuRows.length - 1];
    /* Same priority *and* same label. The built-in pairs share both on purpose
       (prev/next, the rotate arrows); a feature that happens to pick a priority
       a built-in already uses must not be filed under the built-in's name, which
       is how print ended up reading "Rotate current page". */
    if (row && row[0]!.priority === item.priority && row[0]!.label === item.label) row.push(item);
    else menuRows.push([item]);
  }

  return (
    <div className="pjsr-toolbar" ref={toolbarRef} role="toolbar" aria-label={labels.viewerControls}>
      {configured
        .filter((item) => inlineSet.has(item.id))
        .map((item) => (
          <Fragment key={item.id}>{item.node}</Fragment>
        ))}

      {plan.showMenu && (
        <div className="pjsr-overflow" ref={overflowRef}>
          <button
            type="button"
            className="pjsr-button"
            ref={menuButtonRef}
            aria-label={labels.moreControls}
            title={labels.moreControls}
            aria-haspopup="true"
            aria-expanded={menuOpen}
            onClick={() => setMenuOpen((open) => !open)}
          >
            <MoreIcon />
          </button>
          {menuOpen && (
            <div className="pjsr-overflow-menu">
              {menuRows.map((row) => (
                <div className="pjsr-overflow-row" key={row[0]!.id}>
                  <span className="pjsr-overflow-label">{row[0]!.label}</span>
                  {row.map((item) => (
                    <Fragment key={item.id}>{item.node}</Fragment>
                  ))}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {searchOpen && searchContent && <div className="pjsr-search">{searchContent}</div>}

      {sizer}
    </div>
  );
}
