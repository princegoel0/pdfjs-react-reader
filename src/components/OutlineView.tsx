import { useState } from 'react';
import type { OutlineEntry, PdfDestinationPosition } from '../lib/outline';
import { formatLabel } from '../lib/labels';
import { OUTLINE_FEATURE_ID } from '../lib/feature-ids';
import { useLabels } from './labels-context';
import { useViewer } from './ViewerContext';

/** What the outline tier publishes from its Runner — read here, never passed in. */
interface OutlinePublication {
  entries?: OutlineEntry[] | null;
  loading?: boolean;
}

function OutlineNode({
  entry,
  depth,
  onSelectPage,
}: {
  entry: OutlineEntry;
  depth: number;
  onSelectPage: (pageNumber: number, position?: PdfDestinationPosition) => void;
}) {
  const labels = useLabels();
  const [open, setOpen] = useState(!entry.collapsed);
  const hasChildren = entry.children.length > 0;
  const title = entry.title || labels.untitledEntry;

  return (
    <li className="pjsr-outline-item">
      <div className="pjsr-outline-row" style={{ paddingInlineStart: 4 + depth * 12 }}>
        {hasChildren ? (
          <button
            type="button"
            className="pjsr-outline-caret"
            aria-label={formatLabel(open ? labels.collapseSection : labels.expandSection, { title })}
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
            if (entry.pageIndex !== null) onSelectPage(entry.pageIndex + 1, entry.position ?? undefined);
          }}
        >
          {title}
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

/**
 * The bookmark tree, reading the viewer it sits in.
 *
 * Two things used to arrive as props and are now taken: the destination a click resolves to, from the
 * controller, and the entries, from the outline tier's publication in that controller's store — which is
 * why a host writing their own layout puts `<OutlineView/>` in it and stops. The store hands back an empty
 * object for a feature that is not mounted, so without `outlineFeature` this is the empty row rather than a
 * crash or a invented prop.
 *
 * A click carries the place the bookmark names along with its page. That is what makes a link to the middle
 * of a page land in the middle, and `followDestination` is the shell's own resolution of it: a viewer that
 * has the place and does not use it is the reason a document's carefully authored bookmarks feel broken.
 */
export function OutlineView() {
  const labels = useLabels();
  const { store, shellApi } = useViewer();
  const published = store.get(OUTLINE_FEATURE_ID) as OutlinePublication;
  const entries = published.entries ?? null;
  const loading = Boolean(published.loading);

  const select = (pageNumber: number, position?: PdfDestinationPosition) =>
    shellApi.followDestination(pageNumber, position ?? null);

  if (loading) {
    return (
      <div className="pjsr-outline-empty" role="status">
        {labels.outlineLoading}
      </div>
    );
  }
  if (!entries || entries.length === 0) {
    return <div className="pjsr-outline-empty">{labels.outlineEmpty}</div>;
  }
  return (
    // Plain nested lists: `role="tree"` would demand treeitem/group roles and a
    // roving tabindex, and announcing a half-implemented tree is worse than the
    // correct list semantics the markup already has.
    <ul className="pjsr-outline-tree">
      {entries.map((entry, i) => (
        <OutlineNode key={i} entry={entry} depth={0} onSelectPage={select} />
      ))}
    </ul>
  );
}
