import { useId, useRef } from 'react';
import type { KeyboardEvent } from 'react';
import type { ReactNode } from 'react';
import { CloseIcon } from './icons';

export type SidebarTab = 'thumbnails' | 'outline';

export interface SidebarProps {
  open: boolean;
  tab: SidebarTab;
  onTabChange: (tab: SidebarTab) => void;
  onClose?: () => void;
  /** Content of the active tab (ThumbnailList or OutlineView). */
  children: ReactNode;
}

export function Sidebar({ open, tab, onTabChange, onClose, children }: SidebarProps) {
  // Instance-scoped so two viewers on one page never share element ids, which
  // would make aria-controls/aria-labelledby resolve to the other viewer.
  const uid = useId();
  const panelId = `${uid}-panel`;
  const tabId = (name: SidebarTab) => `${uid}-tab-${name}`;
  const tabRefs = useRef<Record<SidebarTab, HTMLButtonElement | null>>({
    thumbnails: null,
    outline: null,
  });

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
    <aside className="pjsr-sidebar" aria-label="Document navigation" onKeyDown={onKeyDown}>
      <div className="pjsr-sidebar-tabs" role="tablist" aria-label="Sidebar views">
        {(['thumbnails', 'outline'] as const).map((name) => (
          <button
            key={name}
            type="button"
            role="tab"
            id={tabId(name)}
            aria-selected={tab === name}
            aria-controls={panelId}
            tabIndex={tab === name ? 0 : -1}
            className={`pjsr-sidebar-tab${tab === name ? ' pjsr-sidebar-tab--active' : ''}`}
            onClick={() => onTabChange(name)}
            ref={(el) => {
              tabRefs.current[name] = el;
            }}
            onKeyDown={(event) => {
              // Roving tabindex for the tablist: Left/Right move between tabs.
              if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
              event.preventDefault();
              const next = name === 'thumbnails' ? 'outline' : 'thumbnails';
              onTabChange(next);
              tabRefs.current[next]?.focus();
            }}
          >
            {name === 'thumbnails' ? 'Thumbnails' : 'Outline'}
          </button>
        ))}
        {onClose && (
          <button
            type="button"
            className="pjsr-button pjsr-sidebar-close"
            aria-label="Close sidebar"
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
