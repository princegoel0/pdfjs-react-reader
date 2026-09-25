import type { AttachmentInfo } from '../lib/attachments';
import { formatLabel } from '../lib/labels';
import { useLabels } from './labels-context';

export interface AttachmentsViewProps {
  /** Attached files in name order, or null while the list is being read. */
  files: AttachmentInfo[] | null;
  loading?: boolean;
  error?: Error | null;
  /** The file whose bytes are in flight, so its row can say so. */
  busyId?: string | null;
  /** The last save that failed. */
  saveError?: { id: string; message: string } | null;
  onDownload: (id: string) => void;
}

/**
 * The files a document carries.
 *
 * Saving is the whole interaction: opening an attachment inside the viewer would
 * mean handing the shell a new document source, which a feature cannot do without
 * a second document-loading API, and a viewer that replaced what you were reading
 * on a click would be a worse one anyway.
 */
export function AttachmentsView({
  files,
  loading = false,
  error,
  busyId = null,
  saveError = null,
  onDownload,
}: AttachmentsViewProps) {
  const labels = useLabels();

  if (loading) {
    return (
      <div className="pjsr-attachments-empty" role="status">
        {labels.attachmentsLoading}
      </div>
    );
  }
  if (error) {
    return (
      <div className="pjsr-attachments-empty" role="alert">
        {formatLabel(labels.attachmentsFailed, { message: error.message })}
      </div>
    );
  }
  if (!files || files.length === 0) {
    return <div className="pjsr-attachments-empty">{labels.attachmentsEmpty}</div>;
  }

  return (
    <ul className="pjsr-attachments">
      {files.map((file) => (
        <li key={file.id} className="pjsr-attachments-item">
          <div className="pjsr-attachments-row">
            <span className="pjsr-attachments-name" title={file.description || file.filename}>
              {file.filename}
            </span>
            <button
              type="button"
              className="pjsr-button pjsr-attachments-save"
              disabled={busyId === file.id}
              onClick={() => onDownload(file.id)}
            >
              {formatLabel(labels.downloadAttachment, { name: file.filename })}
            </button>
          </div>
          {file.description && <div className="pjsr-attachments-note">{file.description}</div>}
          {saveError?.id === file.id && (
            <div className="pjsr-attachments-error" role="alert">
              {saveError.message}
            </div>
          )}
        </li>
      ))}
    </ul>
  );
}
