import { useCallback, useContext, useMemo, useState } from 'react';
import { CloseIcon, PrinterIcon } from '../components/icons';
import {
  usePdfFeatureOptions,
  usePdfFeaturePublish,
  usePdfFeatureShell,
  usePdfFeatureState,
} from '../components/FeatureHost';
import { ToolbarMeasuring } from '../components/toolbar-measuring';
import { usePdfPrint } from '../headless/usePdfPrint';
import { formatLabel } from '../lib/labels';
import { printRangeFor } from '../lib/print';
import type { PrintScope } from '../lib/print';
import type { PdfFeature } from '../lib/features';
import { PRINT_FEATURE_ID } from '../lib/feature-ids';

export type { PrintScope };

export interface PrintFeatureOptions {
  /** Canvas scale for the print render; 1 is the 72 dpi PDF unit. Auto-tuned by default. */
  scale?: number;
  /**
   * Where the page selector starts. Defaults to `'all'`, or to `'range'` when
   * `range` is given. Initial only: from then on the reader owns it, which is
   * the point of putting it in the bar.
   */
  scope?: PrintScope;
  /** Initial 1-based inclusive range for the `'range'` scope. */
  range?: [number, number];
}

export interface PrintFeatureState {
  /** Starts the job at the range the selector shows, or a no-op before the Runner publishes. */
  print: () => void;
  cancel: () => void;
  isPrinting: boolean;
  /** 0..1 while pages are rendered for print. */
  progress: number;
  supported: boolean;
  scope: PrintScope;
  setScope: (scope: PrintScope) => void;
  /** The two bounds as the reader set them, already resolved: `to` is never 0. */
  from: number;
  to: number;
  setRange: (from: number, to: number) => void;
  /** What `print()` will send: the scope resolved against the document. */
  range: [number, number];
}

function PrintRunner() {
  const shell = usePdfFeatureShell();
  const options = usePdfFeatureOptions<PrintFeatureOptions>();
  const { print, cancel, isPrinting, progress, supported } = usePdfPrint({
    doc: shell.doc,
    rotation: shell.rotation,
    onError: shell.reportError,
  });

  const [scope, setScope] = useState<PrintScope>(
    options?.scope ?? (options?.range ? 'range' : 'all'),
  );
  const [from, setFrom] = useState(options?.range?.[0] ?? 1);
  // 0 means "not chosen yet", which resolves to the last page. A feature mounts
  // before the document reports its page count, and defaulting to `numPages`
  // here would freeze the selector at page 0 of a document still loading.
  const [chosenTo, setChosenTo] = useState(options?.range?.[1] ?? 0);
  const to = chosenTo || shell.numPages || 1;

  const setRange = useCallback((nextFrom: number, nextTo: number) => {
    setFrom(nextFrom);
    setChosenTo(nextTo);
  }, []);

  const scale = options?.scale;
  // Published as a memoised tuple: the store compares one level deep, so a fresh
  // array on every render would re-publish, re-render and re-publish forever.
  const range = useMemo(
    () => printRangeFor(scope, { from, to, currentPage: shell.currentPage, numPages: shell.numPages }),
    [scope, from, to, shell.currentPage, shell.numPages],
  );

  const start = useCallback(() => {
    void print({ range, scale });
  }, [print, range, scale]);

  usePdfFeaturePublish<PrintFeatureState>({
    print: start,
    cancel,
    isPrinting,
    progress,
    supported,
    scope,
    setScope,
    from: range[0],
    to: range[1],
    setRange,
    range,
  });
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
      title={formatLabel(labels.printRangeSummary, { from: state.from, to: state.to })}
      onClick={state.print}
    >
      <PrinterIcon />
    </button>
  );
}

/**
 * The page selector, as its own control rather than part of the print button.
 *
 * Separate because they fold differently: printing is the action a reader came
 * for and stays in the bar, while the range is a refinement that gives its place
 * up first at 11. It is also stateless here — the Runner owns the scope, because
 * a control is rendered up to three times and cannot hold a value of its own.
 */
function PrintScopeControl() {
  const shell = usePdfFeatureShell();
  const state = usePdfFeatureState<PrintFeatureState>();
  const labels = shell.labels;
  const total = shell.numPages || 1;
  // The range fields widen this control from 116 px to 197 px, and the bar folds on measured widths: measured
  // narrow, the reader's own choice is what evicts the control they just used (#243). So the copy the bar
  // measures renders them always.
  const measuring = useContext(ToolbarMeasuring);

  return (
    <div className="pjsr-print-scope" title={labels.printPagesLabel}>
      <select
        className="pjsr-print-scope-select"
        aria-label={labels.printPagesLabel}
        value={state.scope}
        onChange={(event) => state.setScope(event.target.value as PrintScope)}
      >
        <option value="all">{labels.printScopeAll}</option>
        <option value="current">{labels.printScopeCurrent}</option>
        <option value="range">{labels.printScopeRange}</option>
      </select>
      {(state.scope === 'range' || measuring) && (
        <>
          <input
            type="number"
            className="pjsr-print-scope-input"
            aria-label={labels.printFromPage}
            min={1}
            max={total}
            value={state.from}
            onChange={(event) => state.setRange(Number(event.target.value), state.to)}
          />
          <span className="pjsr-print-scope-dash" aria-hidden="true">
            –
          </span>
          <input
            type="number"
            className="pjsr-print-scope-input"
            aria-label={labels.printToPage}
            min={1}
            max={total}
            value={state.to}
            onChange={(event) => state.setRange(state.from, Number(event.target.value))}
          />
        </>
      )}
    </div>
  );
}

/**
 * FR-19: render the chosen pages at print intent and hand the document to the
 * browser.
 *
 * Opt-in, because the pipeline is the heaviest thing in the package after the
 * engine itself, and iOS has no print dialog for a page to ask for.
 */
export const printFeature: PdfFeature<PrintFeatureState> = {
  id: PRINT_FEATURE_ID,
  stylesheets: ['pdfjs-react-reader/print.css'],
  Runner: PrintRunner,
  controls: [
    {
      id: 'print',
      priority: 8,
      label: (labels, state) => (state.isPrinting ? labels.cancelPrinting : labels.printDocument),
      available: (state) => state.supported === true,
      render: PrintControl,
    },
    {
      id: 'print-pages',
      priority: 11,
      label: (labels) => labels.printPagesLabel,
      available: (state) => state.supported === true,
      render: PrintScopeControl,
    },
  ],
  keys: [
    {
      key: 'p',
      ctrl: true,
      when: (state) => state.supported === true,
      run: (state) => state.print(),
    },
  ],
};

/** The same feature with a fixed print scale or an initial page scope. */
export function createPrintFeature(options: PrintFeatureOptions): PdfFeature<PrintFeatureState> {
  return { ...printFeature, options };
}
