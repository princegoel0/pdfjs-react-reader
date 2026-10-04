import { useId, useRef } from 'react';
import type { KeyboardEvent } from 'react';
import type { ReactNode } from 'react';
import { CloseIcon } from './icons';
import { useLabels } from './labels-context';

/**
 * A sidebar tab id. Built-in: `'thumbnails'`. Anything a feature contributes
 * through `PdfFeature#panel`, e.g. `'outline'`, is its panel id, so the type is
 * open on purpose — a closed union could not name a tab this package does not
 * ship.
 */
export type SidebarTab = string;

export interface SidebarTabSpec {
  id: SidebarTab;
  label: string;
}

export interface SidebarProps {
  open: boolean;
  /**
   * The tabs to show, in order. **Omit it to show none**: a tab that selects nothing is a control that
   * lies, and a host who has put their own content in the sidebar has already decided what it holds.
   */
  tabs?: readonly SidebarTabSpec[];
  /** The active tab. Only read when `tabs` is supplied. */
  tab?: SidebarTab;
  onTabChange?: (tab: SidebarTab) => void;
  onClose?: () => void;
  /** Content of the active tab, or the sidebar's whole body when there are no tabs. */
  children: ReactNode;
}

export function Sidebar({
  open,
  tabs,
  tab,
  onTabChange,
  onClose,
  children,
}: SidebarProps) {
  const labels = useLabels();
  // Instance-scoped so two viewers on one page never share element ids, which
  // would make aria-controls/aria-labelledby resolve to the other viewer.
  const uid = useId();
  const panelId = `${uid}-panel`;
  const tabId = (name: SidebarTab) => `${uid}-tab-${name.replace(/[^\w-]/g, '-')}`;
  const tabRefs = useRef(new Map<string, HTMLButtonElement | null>());
  // One expression for "there are tabs", so the JSX and the panel's role cannot disagree about it. The
  // tabbed shape is the one with an active tab; a tab-less sidebar body is a plain region, because
  // `role="tabpanel"` with no owning tab is an aria relationship nothing can satisfy.
  const tabList = tabs && tabs.length > 0 ? tabs : null;

  if (!open) return null;

  // Escape is handled on the panel itself rather than on window: a global
  // listener would close the sidebar while the user presses Escape inside a
  // PDF form field or a host-app dialog.
  const onKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key !== 'Escape' || !onClose) return;
    event.preventDefault();
    event.stopPropagation();
    onClose();
  };

  return (
    <aside className="pjsr-sidebar" aria-label={labels.sidebarRegion} onKeyDown={onKeyDown}>
      {/*
       * `role="tablist"` requires that every element it owns is a tab, and the close control is not one.
       * Until FR-45's audit ran it said so — `aria-required-children`, on the row, in the markup every
       * reader of the sidebar walks through — the header keeps the row styling and the tablist is the
       * cluster inside it, so the close button sits beside the list rather than among its children.
       */}
      <div className="pjsr-sidebar-header">
        {tabList && (
          <div className="pjsr-sidebar-tabs" role="tablist" aria-label={labels.sidebarViews}>
            {tabList.map((entry, index) => (
              <button
                key={entry.id}
                type="button"
                role="tab"
                id={tabId(entry.id)}
                aria-selected={tab === entry.id}
                aria-controls={panelId}
                tabIndex={tab === entry.id ? 0 : -1}
                className={`pjsr-sidebar-tab${tab === entry.id ? ' pjsr-sidebar-tab--active' : ''}`}
                onClick={() => onTabChange?.(entry.id)}
                ref={(el) => {
                  tabRefs.current.set(entry.id, el);
                }}
                onKeyDown={(event) => {
                  // Roving tabindex for the tablist: Left/Right move between tabs,
                  // wrapping, because a feature can add the last one.
                  if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
                  event.preventDefault();
                  const step = event.key === 'ArrowRight' ? 1 : -1;
                  const next = tabList[(index + step + tabList.length) % tabList.length]!;
                  onTabChange?.(next.id);
                  tabRefs.current.get(next.id)?.focus();
                }}
              >
                {entry.label}
              </button>
            ))}
          </div>
        )}
        {onClose && (
          <button
            type="button"
            className="pjsr-button pjsr-sidebar-close"
            aria-label={labels.closeSidebar}
            onClick={onClose}
          >
            <CloseIcon />
          </button>
        )}
      </div>
      <div
        className="pjsr-sidebar-panel"
        id={panelId}
        {...(tabList ? { role: 'tabpanel', 'aria-labelledby': tabId(tab ?? '') } : null)}
        tabIndex={-1}
      >
        {children}
      </div>
    </aside>
  );
}
