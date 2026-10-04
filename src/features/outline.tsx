import { OutlineView } from '../components/OutlineView';
import { usePdfFeaturePublish, usePdfFeatureShell } from '../components/FeatureHost';
import { usePdfOutline } from '../headless/usePdfOutline';
import { OUTLINE_FEATURE_ID } from '../lib/feature-ids';
import type { PdfFeature } from '../lib/features';
import type { OutlineEntry } from '../lib/outline';

export interface OutlineFeatureState {
  entries: OutlineEntry[] | null;
  loading: boolean;
}

function OutlineRunner() {
  const shell = usePdfFeatureShell();
  const { entries, loading } = usePdfOutline({ doc: shell.doc });
  usePdfFeaturePublish<OutlineFeatureState>({ entries, loading });
  return null;
}

/** The feature owns the reading; `OutlineView` is the shell's own part, and finds this publication by id. */

/**
 * The bookmark tree as a sidebar panel — the reference example of a feature with
 * a panel, no toolbar control and nothing to say about pages.
 */
export const outlineFeature: PdfFeature<OutlineFeatureState> = {
  id: OUTLINE_FEATURE_ID,
  stylesheets: ['pdfjs-react-reader/outline.css'],
  Runner: OutlineRunner,
  panel: {
    id: OUTLINE_FEATURE_ID,
    label: (labels) => labels.outlineTab,
    render: OutlineView,
  },
};
