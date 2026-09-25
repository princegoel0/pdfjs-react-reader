import { createContext, useContext } from 'react';
import { DEFAULT_LABELS, type PdfViewerLabels } from '../lib/labels';

/**
 * Defaults to `DEFAULT_LABELS` rather than `null`, because several shell parts
 * are exported on their own and must render correctly outside a `PdfViewer`.
 */
export const LabelsContext = createContext<PdfViewerLabels>(DEFAULT_LABELS);

export function useLabels(): PdfViewerLabels {
  return useContext(LabelsContext);
}
