import type { OptionalContentRow } from '../lib/optional-content';
import { formatLabel } from '../lib/labels';
import { useLabels } from './labels-context';

export interface LayersViewProps {
  /** Rows in document order, or null while the config is still being read. */
  rows: OptionalContentRow[] | null;
  loading?: boolean;
  error?: Error | null;
  onToggle: (id: string, visible: boolean) => void;
}

/**
 * The layer list a reader switches: one checkbox per optional-content group.
 *
 * Visibility is read from the caller rather than kept here, because a PDF can
 * also change layers through an annotation action — the panel has to show what
 * the document actually says, not what the last click asked for.
 */
export function LayersView({ rows, loading = false, error, onToggle }: LayersViewProps) {
  const labels = useLabels();

  if (loading) {
    return (
      <div className="pjsr-layers-empty" role="status">
        {labels.layersLoading}
      </div>
    );
  }
  if (error) {
    return (
      <div className="pjsr-layers-empty" role="alert">
        {formatLabel(labels.layersFailed, { message: error.message })}
      </div>
    );
  }
  if (!rows || rows.length === 0) {
    return <div className="pjsr-layers-empty">{labels.layersEmpty}</div>;
  }

  return (
    <ul className="pjsr-layers">
      {rows.map((row, index) =>
        row.kind === 'section' ? (
          <li key={`s${index}`} className="pjsr-layers-section" style={{ paddingInlineStart: 4 + row.depth * 12 }}>
            {row.name}
          </li>
        ) : (
          <li key={row.id} className="pjsr-layers-item" style={{ paddingInlineStart: 4 + row.depth * 12 }}>
            <label className="pjsr-layers-row">
              <input
                type="checkbox"
                checked={row.visible}
                onChange={(event) => onToggle(row.id, event.target.checked)}
              />
              <span className="pjsr-layers-name" title={row.name || row.id}>
                {row.name || labels.untitledEntry}
              </span>
            </label>
          </li>
        ),
      )}
    </ul>
  );
}
