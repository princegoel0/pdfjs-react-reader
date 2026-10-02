import type { PdfError } from '../lib/errors';
import { LayersView } from '../components/LayersView';
import { usePdfFeaturePublish, usePdfFeatureShell, usePdfFeatureState } from '../components/FeatureHost';
import { usePdfOptionalContent } from '../headless/usePdfOptionalContent';
import { LAYERS_FEATURE_ID } from './ids';
import type { PdfFeature } from '../lib/features';
import type { OptionalContentRow } from '../lib/optional-content';

export interface LayersFeatureState {
  rows: OptionalContentRow[] | null;
  loading: boolean;
  error: PdfError | null;
  setVisibility: (id: string, visible: boolean) => void;
}

function LayersRunner() {
  const shell = usePdfFeatureShell();
  const { rows, loading, error, setVisibility } = usePdfOptionalContent({
    doc: shell.doc,
    // The shell's instance, not one fetched here: a config read from a different
    // object would report and set a state the pages never render with.
    config: shell.optionalContentConfig,
    revision: shell.contentVersion,
    onChanged: shell.repaint,
    onError: shell.reportError,
  });
  usePdfFeaturePublish<LayersFeatureState>({ rows, loading, error, setVisibility });
  return null;
}

function LayersPanel() {
  const state = usePdfFeatureState<LayersFeatureState>();
  return (
    <LayersView
      rows={state.rows ?? null}
      loading={state.loading}
      error={state.error ?? null}
      onToggle={state.setVisibility}
    />
  );
}

/**
 * Optional-content groups as a sidebar tab.
 *
 * It contributes a panel and no toolbar control: a layer is a property of the
 * document being read, not an action, so it belongs where the outline and the
 * thumbnails already live. Toggling one redraws the pages through `shell.repaint`,
 * and `revision` is read back so a `SetOCGState` action fired by an annotation
 * shows up here instead of leaving a checkbox disagreeing with the page.
 */
export const layersFeature: PdfFeature<LayersFeatureState> = {
  id: LAYERS_FEATURE_ID,
  Runner: LayersRunner,
  panel: {
    id: LAYERS_FEATURE_ID,
    label: (labels) => labels.layersTab,
    render: LayersPanel,
  },
};
