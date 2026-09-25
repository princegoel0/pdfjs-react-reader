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
  tab: SidebarTab;
  onTabChange: (tab: SidebarTab) => void;
  onClose?: () => void;
  /** Tabs contributed by features, after the built-in thumbnails tab. */
  extraTabs?: readonly SidebarTabSpec[];
  /** Content of the active tab (ThumbnailList or a feature panel). */
  children: ReactNode;
}

export function Sidebar({
  open,
  tab,
  onTabChange,
  onClose,
  extraTabs,
  children,
}: SidebarProps) {
  const labels = useLabels();
  // Instance-scoped so two viewers on one page never share element ids, which
  // would make aria-controls/aria-labelledby resolve to the other viewer.
  const uid = useId();
  const panelId = `${uid}-panel`;
  const tabId = (name: SidebarTab) => `${uid}-tab-${name.replace(/[^\w-]/g, '-')}`;
  const tabRefs = useRef(new Map<string, HTMLButtonElement | null>());

  if (!open) return null;

  const tabs: SidebarTabSpec[] = [
    { id: 'thumbnails', label: labels.thumbnailsTab },
    ...(extraTabs ?? []),
  ];

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
      <div className="pjsr-sidebar-tabs" role="tablist" aria-label={labels.sidebarViews}>
        {tabs.map((entry, index) => (
          <button
            key={entry.id}
            type="button"
            role="tab"
            id={tabId(entry.id)}
            aria-selected={tab === entry.id}
            aria-controls={panelId}
            tabIndex={tab === entry.id ? 0 : -1}
            className={`pjsr-sidebar-tab${tab === entry.id ? ' pjsr-sidebar-tab--active' : ''}`}
            onClick={() => onTabChange(entry.id)}
            ref={(el) => {
              tabRefs.current.set(entry.id, el);
            }}
            onKeyDown={(event) => {
              // Roving tabindex for the tablist: Left/Right move between tabs,
              // wrapping, because a feature can add the last one.
              if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
              event.preventDefault();
              const step = event.key === 'ArrowRight' ? 1 : -1;
              const next = tabs[(index + step + tabs.length) % tabs.length]!;
              onTabChange(next.id);
              tabRefs.current.get(next.id)?.focus();
            }}
          >
            {entry.label}
          </button>
        ))}
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
        role="tabpanel"
        tabIndex={-1}
        aria-labelledby={tabId(tab)}
      >
        {children}
      </div>
    </aside>
  );
}
