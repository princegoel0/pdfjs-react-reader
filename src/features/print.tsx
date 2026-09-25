import { useCallback } from 'react';
import { CloseIcon, PrinterIcon } from '../components/icons';
import {
  usePdfFeatureOptions,
  usePdfFeaturePublish,
  usePdfFeatureShell,
  usePdfFeatureState,
} from '../components/FeatureHost';
import { usePdfPrint } from '../headless/usePdfPrint';
import { formatLabel } from '../lib/labels';
import type { PdfFeature } from '../lib/features';
import { PRINT_FEATURE_ID } from './ids';

export interface PrintFeatureOptions {
  /** Canvas scale for the print render; 1 is the 72 dpi PDF unit. Auto-tuned by default. */
  scale?: number;
}

export interface PrintFeatureState {
  /** Starts the job, or a no-op until the Runner has published. */
  print: () => void;
  cancel: () => void;
  isPrinting: boolean;
  /** 0..1 while pages are rendered for print. */
  progress: number;
  supported: boolean;
}

function PrintRunner() {
  const shell = usePdfFeatureShell();
  const options = usePdfFeatureOptions<PrintFeatureOptions>();
  const { print, cancel, isPrinting, progress, supported } = usePdfPrint({
    doc: shell.doc,
    rotation: shell.rotation,
    // Ink lives in core chrome, and a print that dropped the reader's drawing
    // would be a print that lies about what is on the page.
    getInkStrokes: shell.inkStrokesForPage,
    onError: shell.reportError,
  });

  const scale = options?.scale;
  const start = useCallback(() => {
    void print({ scale });
  }, [print, scale]);

  usePdfFeaturePublish<PrintFeatureState>({ print: start, cancel, isPrinting, progress, supported });
  return null;
}

function PrintControl() {
  const shell = usePdfFeatureShell();
  const state = usePdfFeatureState<PrintFeatureState>();
  const labels = shell.labels;

  // Rendering a long document takes tens of seconds, so the control turns into
  // its own abort rather than sitting disabled.
  if (state.isPrinting) {
    return (
      <button
        type="button"
        className="pjsr-button"
        aria-label={labels.cancelPrinting}
        title={formatLabel(labels.cancelPrintingProgress, {
          percent: Math.round(state.progress * 100),
        })}
        onClick={state.cancel}
      >
        <CloseIcon />
      </button>
    );
  }
  return (
    <button
      type="button"
      className="pjsr-button"
      aria-label={labels.printDocument}
      title={labels.printDocument}
      onClick={state.print}
    >
      <PrinterIcon />
    </button>
  );
}

/**
 * FR-19: render every page at print intent and hand the document to the browser.
 *
 * Opt-in, because the pipeline is the heaviest thing in the package after the
 * engine itself, and iOS has no print dialog for a page to ask for.
 */
export const printFeature: PdfFeature<PrintFeatureState> = {
  id: PRINT_FEATURE_ID,
  Runner: PrintRunner,
  controls: [
    {
      id: 'print',
      priority: 8,
      label: (labels, state) => (state.isPrinting ? labels.cancelPrinting : labels.printDocument),
      available: (state) => state.supported,
      render: PrintControl,
    },
  ],
  keys: [
    {
      key: 'p',
      ctrl: true,
      when: (state) => state.supported,
      run: (state) => state.print(),
    },
  ],
};

/** The same feature with a fixed print scale. */
export function createPrintFeature(options: PrintFeatureOptions): PdfFeature<PrintFeatureState> {
  return { ...printFeature, options };
}
