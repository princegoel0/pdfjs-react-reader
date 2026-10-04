import type { PdfError } from '../lib/errors';
import { AttachmentsView } from '../components/AttachmentsView';
import { usePdfFeaturePublish, usePdfFeatureShell, usePdfFeatureState } from '../components/FeatureHost';
import { usePdfAttachments } from '../headless/usePdfAttachments';
import { ATTACHMENTS_FEATURE_ID } from '../lib/feature-ids';
import type { AttachmentInfo } from '../lib/attachments';
import type { PdfFeature } from '../lib/features';

export interface AttachmentsFeatureState {
  files: AttachmentInfo[] | null;
  loading: boolean;
  error: PdfError | null;
  busyId: string | null;
  saveError: { id: string; message: string } | null;
  download: (id: string) => void;
}

function AttachmentsRunner() {
  const shell = usePdfFeatureShell();
  const { files, loading, error, busyId, saveError, download } = usePdfAttachments({
    doc: shell.doc,
    onError: shell.reportError,
  });
  usePdfFeaturePublish<AttachmentsFeatureState>({ files, loading, error, busyId, saveError, download });
  return null;
}

function AttachmentsPanel() {
  const state = usePdfFeatureState<AttachmentsFeatureState>();
  return (
    <AttachmentsView
      files={state.files ?? null}
      loading={state.loading}
      error={state.error ?? null}
      busyId={state.busyId}
      saveError={state.saveError ?? null}
      onDownload={state.download}
    />
  );
}

/**
 * Embedded files as a sidebar tab.
 *
 * Panel-only, like the outline: the list belongs beside the pages, and the one
 * action it offers is saving a file, which the reader can do without the document
 * they are reading being replaced.
 */
export const attachmentsFeature: PdfFeature<AttachmentsFeatureState> = {
  id: ATTACHMENTS_FEATURE_ID,
  stylesheets: ['pdfjs-react-reader/attachments.css'],
  Runner: AttachmentsRunner,
  panel: {
    id: ATTACHMENTS_FEATURE_ID,
    label: (labels) => labels.attachmentsTab,
    render: AttachmentsPanel,
  },
};
