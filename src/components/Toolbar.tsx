import { Fragment, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import type { PageLayout, ScaleMode } from '../lib/layout';
import type { InkSettings } from '../lib/ink';
import { planToolbarOverflow } from '../lib/toolbar';
import {
  ChevronLeftIcon,
  ChevronRightIcon,
  CloseIcon,
  DownloadIcon,
  MinusIcon,
  MoreIcon,
  PanelLeftIcon,
  PenIcon,
  PlusIcon,
  PrinterIcon,
  RotateCcwIcon,
  RotateCwIcon,
  SearchIcon,
} from './icons';

export type { PageLayout, ScaleMode };

export const ZOOM_LEVELS = [0.25, 0.33, 0.5, 0.66, 0.75, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2, 2.5, 3, 4, 5];

export const INK_COLORS = ['#d92d20', '#4f46e5', '#067647', '#181d27'];

export const INK_WIDTHS = [
  { label: 'Thin', value: 1.5 },
  { label: 'Medium', value: 3 },
  { label: 'Thick', value: 6 },
];

export interface ToolbarProps {
  currentPage: number;
  numPages: number;
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
  drawMode?: boolean;
  onDrawToggle?: () => void;
  inkSettings?: InkSettings;
  onInkSettingsChange?: (patch: Partial<InkSettings>) => void;
  onInkUndo?: () => void;
  onInkClear?: () => void;
  inkCanUndo?: boolean;
  /** Document name shown in the bar at wide sizes. */
  docLabel?: string;
  /** Effective zoom as a percentage, e.g. "124%". */
  zoomLabel?: string;
  /** Opens the print pipeline. Omit to hide the control (e.g. where printing is unsupported). */
  onPrint?: () => void;
  /** Aborts a running print job; the control swaps to a cancel button while `printing`. */
  onPrintCancel?: () => void;
  printing?: boolean;
  /** 0..1 while pages are rendered for print. */
  printProgress?: number;
  /** Saves the document. Omit to hide the control. */
  onDownload?: () => void;
  downloading?: boolean;
}

/**
 * A control that can sit in the bar or fold into the overflow menu.
 *
 * `priority` is the eviction order: 1 is page navigation, 12 is the document
 * label. Items sharing a priority fold as one cluster, so a pair like the
 * rotate buttons can never be split into a lone leftover button.
 */
interface ToolbarItem {
  id: string;
  priority: number;
  /** Visible text for this item's row in the overflow menu. */
  label: string;
  /** Information, not an action: dropped rather than menuised when it will not fit. */
  hideOnly?: boolean;
  node: ReactNode;
}

interface Metrics {
  /** Content width available to the toolbar row. */
  avail: number;
  gap: number;
  widths: Record<string, number>;
}

function nextZoomUp(scale: number): number {
  return ZOOM_LEVELS.find((z) => z > scale + 0.001) ?? ZOOM_LEVELS[ZOOM_LEVELS.length - 1]!;
}

function nextZoomDown(scale: number): number {
  return [...ZOOM_LEVELS].reverse().find((z) => z < scale - 0.001) ?? ZOOM_LEVELS[0]!;
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
  drawMode = false,
  onDrawToggle,
  inkSettings,
  onInkSettingsChange,
  onInkUndo,
  onInkClear,
  inkCanUndo = false,
  docLabel,
  zoomLabel,
  onPrint,
  onPrintCancel,
  printing = false,
  printProgress = 0,
  onDownload,
  downloading = false,
}: ToolbarProps) {
  const [pageInput, setPageInput] = useState(String(currentPage));
  const [menuOpen, setMenuOpen] = useState(false);
  const [metrics, setMetrics] = useState<Metrics | null>(null);
  const toolbarRef = useRef<HTMLDivElement | null>(null);
  const sizerRef = useRef<HTMLDivElement | null>(null);
  const overflowRef = useRef<HTMLDivElement | null>(null);
  const menuButtonRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    setPageInput(String(currentPage));
  }, [currentPage]);

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

  const commitPage = () => {
    const parsed = Number.parseInt(pageInput, 10);
    if (Number.isFinite(parsed)) onPageChange(parsed);
    else setPageInput(String(currentPage));
  };

  const selectValue = typeof scaleMode === 'number' ? String(scaleMode) : scaleMode;

  const items: ToolbarItem[] = [];

  if (onSidebarToggle) {
    items.push({
      id: 'sidebar',
      priority: 3,
      label: 'Sidebar',
      node: (
        <button
          type="button"
          className="pjsr-button"
          aria-label="Toggle sidebar"
          title="Toggle sidebar"
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
      label: 'Go to page',
      node: (
        <button
          type="button"
          className="pjsr-button"
          aria-label="Previous page"
          title="Previous page"
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
      label: 'Go to page',
      node: (
        <input
          type="number"
          className="pjsr-page-input"
          aria-label="Page number"
          min={1}
          max={numPages || 1}
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
      label: 'Page count',
      hideOnly: true,
      node: <span className="pjsr-page-count">of {numPages || '—'}</span>,
    },
    {
      id: 'next',
      priority: 1,
      label: 'Go to page',
      node: (
        <button
          type="button"
          className="pjsr-button"
          aria-label="Next page"
          title="Next page"
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
      label: 'Search',
      node: (
        <button
          type="button"
          className="pjsr-button"
          aria-label="Search document"
          title="Search document"
          aria-expanded={searchOpen}
          onClick={onSearchToggle}
        >
          <SearchIcon />
        </button>
      ),
    });
  }

  if (onDrawToggle) {
    items.push({
      id: 'draw',
      priority: 6,
      label: 'Draw',
      node: (
        <button
          type="button"
          className="pjsr-button"
          aria-label="Draw on document"
          aria-pressed={drawMode}
          title="Draw on document"
          onClick={onDrawToggle}
        >
          <PenIcon />
        </button>
      ),
    });
  }

  items.push(
    {
      id: 'zoomOut',
      priority: 2,
      label: 'Zoom in / out',
      node: (
        <button
          type="button"
          className="pjsr-button"
          aria-label="Zoom out"
          title="Zoom out"
          disabled={resolvedScale <= ZOOM_LEVELS[0]!}
          onClick={() => onScaleModeChange(nextZoomDown(resolvedScale))}
        >
          <MinusIcon />
        </button>
      ),
    },
    {
      id: 'fit',
      priority: 5,
      label: 'Zoom level',
      node: (
        <select
          className="pjsr-zoom-select"
          aria-label="Zoom level"
          title="Zoom level"
          value={selectValue}
          onChange={(e) => {
            const value = e.target.value;
            onScaleModeChange(
              value === 'fit-width' || value === 'fit-page' ? value : Number(value),
            );
          }}
        >
          <option value="fit-width">Fit width</option>
          <option value="fit-page">Fit page</option>
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
      label: 'Zoom in / out',
      node: (
        <button
          type="button"
          className="pjsr-button"
          aria-label="Zoom in"
          title="Zoom in"
          disabled={resolvedScale >= ZOOM_LEVELS[ZOOM_LEVELS.length - 1]!}
          onClick={() => onScaleModeChange(nextZoomUp(resolvedScale))}
        >
          <PlusIcon />
        </button>
      ),
    },
  );

  if (onRotate) {
    items.push(
      {
        id: 'rotateCcw',
        priority: 7,
        label: 'Rotate',
        node: (
          <button
            type="button"
            className="pjsr-button"
            aria-label="Rotate counterclockwise"
            title="Rotate counterclockwise"
            onClick={() => onRotate(-90)}
          >
            <RotateCcwIcon />
          </button>
        ),
      },
      {
        id: 'rotateCw',
        priority: 7,
        label: 'Rotate',
        node: (
          <button
            type="button"
            className="pjsr-button"
            aria-label="Rotate clockwise"
            title="Rotate clockwise"
            onClick={() => onRotate(90)}
          >
            <RotateCwIcon />
          </button>
        ),
      },
    );
  }

  if (onPageLayoutChange) {
    items.push({
      id: 'layout',
      priority: 10,
      label: 'Page layout',
      node: (
        <select
          className="pjsr-zoom-select"
          aria-label="Page layout"
          title="Page layout"
          value={pageLayout}
          onChange={(e) => onPageLayoutChange(e.target.value as PageLayout)}
        >
          <option value="continuous">Continuous</option>
          <option value="single">Single</option>
          <option value="spread">Spread</option>
        </select>
      ),
    });
  }

  if (onDownload) {
    items.push({
      id: 'download',
      priority: 9,
      label: 'Download',
      node: (
        <button
          type="button"
          className="pjsr-button"
          aria-label="Download document"
          title="Download document"
          disabled={downloading}
          aria-busy={downloading || undefined}
          onClick={onDownload}
        >
          <DownloadIcon />
        </button>
      ),
    });
  }

  if (onPrint) {
    items.push({
      id: 'print',
      priority: 8,
      label: printing ? 'Cancel printing' : 'Print',
      node: printing ? (
        /* Rendering a long document takes tens of seconds, so the control
           turns into its own abort rather than sitting disabled. */
        <button
          type="button"
          className="pjsr-button"
          aria-label="Cancel printing"
          title={`Cancel printing (${Math.round(printProgress * 100)}% rendered)`}
          onClick={onPrintCancel}
        >
          <CloseIcon />
        </button>
      ) : (
        <button
          type="button"
          className="pjsr-button"
          aria-label="Print document"
          title="Print document"
          onClick={onPrint}
        >
          <PrinterIcon />
        </button>
      ),
    });
  }

  if (docLabel || zoomLabel) {
    items.push({
      id: 'meta',
      priority: 12,
      label: 'Document',
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

  /* The bar folds on measured widths rather than hand-tuned breakpoints, which
     rot the moment a label changes. Every item is measured once from this
     off-screen copy: `visibility: hidden` keeps it out of the accessibility
     tree and out of the tab order, so the duplicated controls cannot surface a
     second set of names or steal focus. */
  const sizer = (
    <div className="pjsr-toolbar-sizer" ref={sizerRef} aria-hidden="true">
      {items.map((item) => (
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
        items.map((item) => ({
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
        inline: items.map((item) => item.id),
        overflow: [] as string[],
        hidden: [] as string[],
        showMenu: false,
      };

  const inlineSet = new Set(plan.inline);
  /* Walk the planner's order, not the visual one: the menu reads most useful
     action first, and equal priorities are then guaranteed to be adjacent, so
     the rotate pair collapses into a single "Rotate [↺][↻]" row instead of two
     rows that both say Rotate. */
  const byId = new Map(items.map((item) => [item.id, item]));
  const overflowItems = plan.overflow
    .map((id) => byId.get(id))
    .filter((item): item is ToolbarItem => item !== undefined);
  const menuRows: ToolbarItem[][] = [];
  for (const item of overflowItems) {
    const row = menuRows[menuRows.length - 1];
    if (row && row[0]!.priority === item.priority) row.push(item);
    else menuRows.push([item]);
  }

  return (
    <div className="pjsr-toolbar" ref={toolbarRef} role="toolbar" aria-label="PDF viewer controls">
      {items
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
            aria-label="More controls"
            title="More controls"
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

      {drawMode && inkSettings && onInkSettingsChange && (
        <div className="pjsr-ink" role="group" aria-label="Drawing tools">
          <span className="pjsr-ink-label">Draw</span>
          <div className="pjsr-ink-colors">
            {INK_COLORS.map((color) => (
              <button
                key={color}
                type="button"
                className={`pjsr-ink-swatch${inkSettings.color === color ? ' pjsr-ink-swatch--active' : ''}`}
                aria-label={`Draw with ${color}`}
                aria-pressed={inkSettings.color === color}
                onClick={() => onInkSettingsChange({ color })}
              >
                <span className="pjsr-ink-swatch-dot" style={{ background: color }} />
              </button>
            ))}
          </div>
          <select
            className="pjsr-zoom-select"
            aria-label="Pen width"
            value={String(inkSettings.width)}
            onChange={(e) => onInkSettingsChange({ width: Number(e.target.value) })}
          >
            {INK_WIDTHS.map((option) => (
              <option key={option.value} value={String(option.value)}>
                {option.label}
              </option>
            ))}
          </select>
          <button
            type="button"
            className="pjsr-button pjsr-button--text"
            aria-label="Undo stroke"
            disabled={!inkCanUndo}
            onClick={() => onInkUndo?.()}
          >
            Undo
          </button>
          <button
            type="button"
            className="pjsr-button pjsr-button--text"
            aria-label="Clear all drawings"
            onClick={() => onInkClear?.()}
          >
            Clear
          </button>
          <button
            type="button"
            className="pjsr-button"
            aria-label="Exit drawing mode"
            title="Exit drawing mode"
            onClick={onDrawToggle}
          >
            <CloseIcon />
          </button>
        </div>
      )}

      {sizer}
    </div>
  );
}
