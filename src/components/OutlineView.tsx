import { useState } from 'react';
import type { OutlineEntry } from '../lib/outline';

export interface OutlineViewProps {
  entries: OutlineEntry[] | null;
  loading?: boolean;
  onSelectPage: (pageNumber: number) => void;
}

function OutlineNode({
  entry,
  depth,
  onSelectPage,
}: {
  entry: OutlineEntry;
  depth: number;
  onSelectPage: (pageNumber: number) => void;
}) {
  const [open, setOpen] = useState(!entry.collapsed);
  const hasChildren = entry.children.length > 0;

  return (
    <li className="pjsr-outline-item">
      <div className="pjsr-outline-row" style={{ paddingInlineStart: 4 + depth * 12 }}>
        {hasChildren ? (
          <button
            type="button"
            className="pjsr-outline-caret"
            aria-label={`${open ? 'Collapse' : 'Expand'} ${entry.title || '(untitled)'}`}
            aria-expanded={open}
            onClick={() => setOpen((v) => !v)}
          >
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
              style={{
                transform: open ? 'rotate(90deg)' : undefined,
                transition: 'transform 0.12s ease',
              }}
            >
              <polyline points="9 6 15 12 9 18" />
            </svg>
          </button>
        ) : (
          <span className="pjsr-outline-caret-spacer" aria-hidden="true" />
        )}
        <button
          type="button"
          className="pjsr-outline-link"
          disabled={entry.pageIndex === null}
          title={entry.title}
          onClick={() => {
            if (entry.pageIndex !== null) onSelectPage(entry.pageIndex + 1);
          }}
        >
          {entry.title || '(untitled)'}
        </button>
      </div>
      {hasChildren && open && (
        <ul className="pjsr-outline-children">
          {entry.children.map((child, i) => (
            <OutlineNode key={i} entry={child} depth={depth + 1} onSelectPage={onSelectPage} />
          ))}
        </ul>
      )}
    </li>
  );
}

export function OutlineView({ entries, loading = false, onSelectPage }: OutlineViewProps) {
  if (loading) {
    return (
      <div className="pjsr-outline-empty" role="status">
        Loading outline…
      </div>
    );
  }
  if (!entries || entries.length === 0) {
    return <div className="pjsr-outline-empty">This document has no outline.</div>;
  }
  return (
    // Plain nested lists: `role="tree"` would demand treeitem/group roles and a
    // roving tabindex, and announcing a half-implemented tree is worse than the
    // correct list semantics the markup already has.
    <ul className="pjsr-outline-tree">
      {entries.map((entry, i) => (
        <OutlineNode key={i} entry={entry} depth={0} onSelectPage={onSelectPage} />
      ))}
    </ul>
  );
}
