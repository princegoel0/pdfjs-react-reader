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
import { ANNOTATE_FEATURE_ID, DOWNLOAD_FEATURE_ID, FORMS_FEATURE_ID } from './ids';
import type { PdfFeature } from '../lib/features';
import type { AnnotateFeatureState } from './annotate';
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
  // Ask the features that can make an edit rather than assuming either is mounted:
  // when one is not, its publication is gone, and an untouched file is the honest
  // thing to save.
  const forms = usePdfFeaturePeer<FormFeatureState>(FORMS_FEATURE_ID);
  const annotate = usePdfFeaturePeer<AnnotateFeatureState>(ANNOTATE_FEATURE_ID);
  const { download, isBusy } = usePdfDownload({
    doc: shell.doc,
    fileName: options?.fileName ?? shell.documentLabel,
    onError: shell.reportError,
  });

  // A reader's marks live in the same `annotationStorage` the form fields write to,
  // and `getData()` returns the bytes the document was loaded from — so asking only
  // `forms` meant a document annotated without the form feature downloaded clean and
  // empty. `canUndo` is the branch that works: measured against the engine, arming a
  // tool with nothing made leaves it false even though converting the file's own
  // annotations has already put three entries in storage, and making one mark makes it
  // true. `isEmpty` would have been wrong in both directions.
  //
  // Both fields read as missing on the first render, because a peer publishes from an
  // effect — and `=== true` on `undefined` is the answer that wants giving: no edits.
  const hasEdits = forms.isDirty === true || annotate.editing?.canUndo === true;
  const start = useCallback(() => {
    // Save what the reader is looking at: with edits pending, the file carries them
    // instead of the pristine bytes.
    void download({ saveEdits: hasEdits });
  }, [download, hasEdits]);

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
 *
 * Whatever the reader changed goes into the file: form fields, and — with
 * {@link annotateFeature} mounted — the highlights, ink and text they made.
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
