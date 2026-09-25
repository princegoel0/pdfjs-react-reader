import { useCallback } from 'react';
import { DownloadIcon } from '../components/icons';
import {
  usePdfFeatureOptions,
  usePdfFeaturePeer,
  usePdfFeaturePublish,
  usePdfFeatureShell,
  usePdfFeatureState,
} from '../components/FeatureHost';
import { usePdfDownload } from '../headless/usePdfDownload';
import { DOWNLOAD_FEATURE_ID, FORMS_FEATURE_ID } from './ids';
import type { PdfFeature } from '../lib/features';
import type { FormFeatureState } from './forms';

export interface DownloadFeatureOptions {
  /** Name for the saved file; defaults to the document's own name. */
  fileName?: string;
}

export interface DownloadFeatureState {
  download: () => void;
  isBusy: boolean;
}

function DownloadRunner() {
  const shell = usePdfFeatureShell();
  const options = usePdfFeatureOptions<DownloadFeatureOptions>();
  // Ask the forms feature rather than assuming it: when it is not mounted its
  // publication is gone, and an untouched file is the honest thing to save.
  const forms = usePdfFeaturePeer<FormFeatureState>(FORMS_FEATURE_ID);
  const { download, isBusy } = usePdfDownload({
    doc: shell.doc,
    fileName: options?.fileName ?? shell.documentLabel,
    onError: shell.reportError,
  });

  const withFormValues = forms?.isDirty === true;
  const start = useCallback(() => {
    // Save what the reader is looking at: with edits pending, the file carries
    // the current field values instead of the pristine bytes.
    void download({ withFormValues });
  }, [download, withFormValues]);

  usePdfFeaturePublish<DownloadFeatureState>({ download: start, isBusy });
  return null;
}

function DownloadControl() {
  const shell = usePdfFeatureShell();
  const state = usePdfFeatureState<DownloadFeatureState>();
  return (
    <button
      type="button"
      className="pjsr-button"
      aria-label={shell.labels.downloadDocument}
      title={shell.labels.downloadDocument}
      disabled={state.isBusy}
      aria-busy={state.isBusy || undefined}
      onClick={state.download}
    >
      <DownloadIcon />
    </button>
  );
}

/**
 * FR-20: save the document the viewer is showing.
 *
 * Opt-in because it is a file leaving the app, and an app that hosts other
 * people's PDFs may not want a reader to be able to take one.
 */
export const downloadFeature: PdfFeature<DownloadFeatureState> = {
  id: DOWNLOAD_FEATURE_ID,
  Runner: DownloadRunner,
  controls: [
    {
      id: 'download',
      priority: 9,
      label: (labels) => labels.overflowDownload,
      render: DownloadControl,
    },
  ],
};

/** The same feature saving under a fixed name. */
export function createDownloadFeature(
  options: DownloadFeatureOptions,
): PdfFeature<DownloadFeatureState> {
  return { ...downloadFeature, options };
}
