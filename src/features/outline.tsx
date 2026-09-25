import { OutlineView } from '../components/OutlineView';
import { usePdfFeaturePublish, usePdfFeatureShell, usePdfFeatureState } from '../components/FeatureHost';
import { usePdfOutline } from '../headless/usePdfOutline';
import { OUTLINE_FEATURE_ID } from './ids';
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

function OutlinePanel() {
  const shell = usePdfFeatureShell();
  const state = usePdfFeatureState<OutlineFeatureState>();
  return (
    <OutlineView
      entries={state.entries ?? null}
      loading={state.loading}
      onSelectPage={shell.scrollToPage}
    />
  );
}

/**
 * The bookmark tree as a sidebar panel — the reference example of a feature with
 * a panel, no toolbar control and nothing to say about pages.
 */
export const outlineFeature: PdfFeature<OutlineFeatureState> = {
  id: OUTLINE_FEATURE_ID,
  Runner: OutlineRunner,
  panel: {
    id: OUTLINE_FEATURE_ID,
    label: (labels) => labels.outlineTab,
    render: OutlinePanel,
  },
};
