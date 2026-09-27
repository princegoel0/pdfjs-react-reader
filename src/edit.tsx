import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ChevronDownIcon,
  ChevronUpIcon,
  DownloadIcon,
  RotateCwIcon,
  SplitIcon,
  TrashIcon,
} from './components/icons';
import {
  usePdfFeatureOptions,
  usePdfFeaturePublish,
  usePdfFeatureShell,
  usePdfFeatureState,
} from './components/FeatureHost';
import { downloadBytes, pdfFileName } from './lib/download';
import { formatLabel } from './lib/labels';
import type { PdfViewerLabels } from './lib/labels';
import {
  initialPlan,
  isPristine,
  movePlanned,
  removePlanned,
  rotatePlanned,
  withViewRotations,
} from './lib/page-plan';
import { arrangePages, flattenBytes } from './lib/pdf-write';
import { EDIT_FEATURE_ID } from './features/ids';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import type { PagePlan } from './lib/page-plan';
import type { PdfFlattenResult } from './lib/pdf-write';
import type { PdfFeature } from './lib/features';

export interface EditFeatureOptions {
  /** Name for the saved file; defaults to the document's own name. */
  fileName?: string;
}

/** What the panel should tell a screen reader just happened, in words the host can translate. */
export type PageEditNotice =
  | { kind: 'moved'; page: number; position: number }
  | { kind: 'removed'; page: number }
  | { kind: 'rotated'; page: number; angle: number }
  | { kind: 'applied' }
  | { kind: 'extracted'; count: number }
  | { kind: 'split'; files: number; first: number; second: number }
  | { kind: 'restored' }
  /** The document went back to the snapshot an apply replaced, which is not the same news. */
  | { kind: 'reverted' };

export interface EditFeatureState {
  /**
   * Flatten the document as it now stands and return the bytes.
   *
   * Resolves to `null` when another flatten is in flight, which is the only way this
   * can be asked twice — a second `saveDocument()` while the first is writing produces
   * two files from one click.
   */
  flatten: () => Promise<PdfFlattenResult | null>;
  /** True while a flatten or an apply is running, for a control that wants to say "working". */
  isBusy: boolean;
  /** What the last flatten reported, so a host can say "there was no form to flatten". */
  lastResult: PdfFlattenResult | null;

  /**
   * The pending page plan, or `null` when nothing has been edited since this document loaded.
   *
   * Every index in it is a page of the document as loaded, which is what lets a move, a turn
   * and a deletion share one representation — and one undo.
   */
  plan: PagePlan | null;
  /** True when applying would write a different file. */
  isDirty: boolean;
  /** Steps that can be undone within the pending batch, which costs no bytes. */
  canUndo: boolean;
  /** True after an apply, until another happens: the bytes from before it are still held. */
  canUndoApply: boolean;
  /** How many pending edits there are, for a footer that counts them. */
  pendingEdits: number;
  /** The last thing the reader did to the pages, for the panel's live region. */
  notice: PageEditNotice | null;
  /** Move the page at slot `from` so it lands at slot `to`; both are planned positions. */
  movePage: (from: number, to: number) => void;
  /** Turn the page in slot `slot` a quarter turn clockwise. */
  rotatePage: (slot: number) => void;
  /** Take the page in slot `slot` out of the plan. Refused when one page would remain. */
  removePage: (slot: number) => void;
  undoPageEdits: () => void;
  discardPageEdits: () => void;
  /**
   * Write the plan into the document and show the result.
   *
   * Resolves false when there is nothing to apply, another write is in flight, or the writer
   * failed — which the viewer's own `onError` also reports.
   */
  applyPageEdits: () => Promise<boolean>;
  /**
   * Write the plan to a file and hand it over, leaving the document on screen alone.
   *
   * The same bytes as `applyPageEdits` and a different intent.
   */
  extractPlanned: () => Promise<boolean>;
  /** Split the planned list at `slot` into two files. False when either side would be empty. */
  splitPlanned: (slot: number) => Promise<boolean>;
  /** Put back the document as it was before the last apply. */
  undoApply: () => void;
}

/*
 * The bytes of the document as the reader sees it, asked in whichever of the two ways is true.
 *
 * pdf.js keeps a reader's edits — form values and 0.6's marks alike — in `annotationStorage`, and
 * `saveDocument()` commits them; with that store empty it says so in the console and advises
 * `getData()` instead. Asking the engine rather than the features is deliberate: the download
 * control reaches the same decision through `forms.isDirty` and `annotate.editing`, which needs
 * both peers mounted, whereas the storage size is the fact those signals only report on.
 */
async function committedBytes(doc: PDFDocumentProxy): Promise<Uint8Array> {
  const stored = doc.annotationStorage?.size ?? 0;
  // A pure-XFA document cannot be committed either, so its base is always the loaded file.
  const bytes = stored && doc.isPureXfa !== true ? await doc.saveDocument() : await doc.getData();
  return new Uint8Array(bytes);
}

/**
 * The `edit` tier: flatten what the reader sees, and rearrange the pages.
 *
 * Both halves write a file, so both live behind the one optional peer. The flatten asks pdf.js
 * for the current bytes first, so whatever the form feature typed and whatever the annotate
 * feature marked is in what gets flattened — the two write into the same `annotationStorage`
 * that `saveDocument()` commits. The page editor works on a plan rather than on the document: it
 * changes a list of integers, and only `applyPageEdits` turns that into a new file. That is what
 * makes undo cheap enough to offer at all, since a permutation is a handful of bytes while a
 * real document is megabytes.
 */
function EditRunner() {
  const shell = usePdfFeatureShell();
  const options = usePdfFeatureOptions<EditFeatureOptions>();
  const [isBusy, setBusy] = useState(false);
  const [lastResult, setLastResult] = useState<PdfFlattenResult | null>(null);
  const busy = useRef(false);

  const [plan, setPlan] = useState<PagePlan | null>(null);
  const [history, setHistory] = useState<PagePlan[]>([]);
  const [notice, setNotice] = useState<PageEditNotice | null>(null);

  const docRef = useRef(shell.doc);
  docRef.current = shell.doc;
  const pagesRef = useRef(shell.numPages);
  pagesRef.current = shell.numPages;
  const viewRotationsRef = useRef(shell.pageRotations);
  viewRotationsRef.current = shell.pageRotations;
  const replaceRef = useRef(shell.replaceDocument);
  replaceRef.current = shell.replaceDocument;
  const turnRef = useRef(shell.rotatePage);
  turnRef.current = shell.rotatePage;
  const nameRef = useRef(options?.fileName ?? shell.documentLabel);
  nameRef.current = options?.fileName ?? shell.documentLabel;
  const onErrorRef = useRef(shell.reportError);
  onErrorRef.current = shell.reportError;
  const planRef = useRef<PagePlan | null>(null);
  planRef.current = plan;
  const historyRef = useRef<PagePlan[]>([]);
  historyRef.current = history;
  /** The document as it stood before the last apply, which is the only snapshot kept. */
  const appliedRef = useRef<{ bytes: Uint8Array; rotations: Record<number, number> } | null>(
    null,
  );
  /** The bytes the last write started from, which is what an undo of that apply restores. */
  const baseRef = useRef<Uint8Array>(new Uint8Array());
  /** True while a swap this tier announced is on its way, so the reset below keeps the notice. */
  const selfSwapRef = useRef(false);

  /*
   * A plan is a list of page numbers *of one document*, so any new document voids it — whether
   * the host pointed somewhere else, a file was dropped, or this tier applied one of its own.
   * Holding a stale plan would offer to move page 14 of a document that now has nine.
   *
   * The announcement survives the swap this tier caused. `applyPageEdits` sets its notice and
   * *then* the new document arrives, so clearing it here unsaid the one action the reader most
   * needs told — measured in the browser: the live region was empty 2 s after an apply.
   */
  useEffect(() => {
    setPlan(null);
    setHistory([]);
    if (selfSwapRef.current) {
      /*
       * A replacement arrives as two changes to `shell.doc` — the old document going away, then the
       * new one loading — and only the second ends the announcement's grace. Consuming the flag on
       * the first was measured in a browser: the live region still read empty after an apply,
       * because the second pass unsaid it.
       */
      if (shell.doc) selfSwapRef.current = false;
      return;
    }
    setNotice(null);
  }, [shell.doc]);

  const record = useCallback((next: PagePlan | null, note: PageEditNotice) => {
    const current = planRef.current;
    if (!next || next === current) return;
    // The step before the first edit is "no edits", held as the identity plan rather than as
    // `null`, so one move is undoable in the same way as ten.
    setHistory([...historyRef.current, current ?? initialPlan(pagesRef.current)]);
    setPlan(next);
    // A new action means any swap still waiting to be announced is no longer what happened.
    selfSwapRef.current = false;
    setNotice(note);
  }, []);

  const movePage = useCallback(
    (from: number, to: number) => {
      const base = planRef.current ?? initialPlan(pagesRef.current);
      const page = base.order[from];
      if (page === undefined) return;
      const target = to < 0 ? 0 : to;
      record(movePlanned(base, from, target), { kind: 'moved', page: page + 1, position: target + 1 });
    },
    [record],
  );

  const rotatePage = useCallback(
    (slot: number) => {
      const base = planRef.current ?? initialPlan(pagesRef.current);
      const page = base.order[slot];
      if (page === undefined) return;
      const next = rotatePlanned(base, slot, 90);
      if (next === base) return;
      record(next, { kind: 'rotated', page: page + 1, angle: next.rotations[page] ?? 0 });
    },
    [record],
  );

  const removePage = useCallback(
    (slot: number) => {
      const base = planRef.current ?? initialPlan(pagesRef.current);
      const page = base.order[slot];
      if (page === undefined) return;
      record(removePlanned(base, slot), { kind: 'removed', page: page + 1 });
    },
    [record],
  );

  const undoPageEdits = useCallback(() => {
    const steps = historyRef.current;
    const previous = steps[steps.length - 1];
    if (!previous) return;
    setHistory(steps.slice(0, -1));
    setPlan(isPristine(previous, pagesRef.current) ? null : previous);
    setNotice(null);
  }, []);

  const discardPageEdits = useCallback(() => {
    setPlan(null);
    setHistory([]);
    setNotice({ kind: 'restored' });
  }, []);

  /*
   * One save, then one writer pass per arrangement, each handed to `sink`.
   *
   * The bytes the reader is looking at — marks and form values included, since both live in the
   * `annotationStorage` that `saveDocument()` commits — are what the plan's indices refer to, so
   * they are captured once and reused for every file a call produces. Splitting therefore costs
   * one save rather than one per part, and every path that leaves the viewer with a file goes
   * through here, which is the only place `saveDocument()` is allowed to fail.
   */
  const writePlans = useCallback(
    async (plans: PagePlan[], sink: (bytes: Uint8Array, index: number) => void): Promise<boolean> => {
      const doc = docRef.current;
      if (!doc || !plans.length || busy.current) return false;
      busy.current = true;
      setBusy(true);
      try {
        const base = await committedBytes(doc);
        baseRef.current = base;
        for (let index = 0; index < plans.length; index += 1) {
          const plan = plans[index];
          if (!plan) return false;
          const folded = withViewRotations(plan, viewRotationsRef.current);
          const result = await arrangePages(base, folded);
          sink(result.bytes, index);
        }
        return true;
      } catch (err) {
        onErrorRef.current(err instanceof Error ? err : new Error(String(err)));
        return false;
      } finally {
        busy.current = false;
        setBusy(false);
      }
    },
    [],
  );

  const applyPageEdits = useCallback(async () => {
    const pending = planRef.current;
    if (!pending) return false;
    const rotations = viewRotationsRef.current;
    const ok = await writePlans([pending], (bytes) => replaceRef.current(bytes));
    if (ok) {
      // The snapshot an undo of this apply restores, taken before the swap replaced it.
      appliedRef.current = { bytes: baseRef.current, rotations };
      setPlan(null);
      setHistory([]);
      selfSwapRef.current = true;
      setNotice({ kind: 'applied' });
    }
    return ok;
  }, [writePlans]);

  /**
   * Hand the plan over as a separate file and leave the document on screen alone.
   *
   * "Extract these five pages" must not cost the reader the other fifteen they were looking at,
   * which is the whole difference between this and `applyPageEdits` — same bytes, different sink.
   */
  const extractPlanned = useCallback(async () => {
    // The plan is the reader's pending arrangement; with none, the whole list is what they are
    // looking at, and an extract of all of it is a copy — which is a thing a reader may want.
    const pending = planRef.current ?? initialPlan(pagesRef.current);
    const count = pending.order.length;
    const ok = await writePlans([pending], (bytes) =>
      downloadBytes(bytes, pdfFileName(nameRef.current)),
    );
    if (ok) setNotice({ kind: 'extracted', count });
    return ok;
  }, [writePlans]);

  /**
   * Split the list at `slot` into two files.
   *
   * Two rather than N: a reader who means "split this in two at page 120" is common, and a reader
   * who means "into five equal parts" is not what the row's affordance says. It also keeps the
   * browser from being asked for four downloads in a row, which it blocks behind a permission the
   * viewer cannot earn honestly. Both parts have to hold a page, so the control only appears where
   * the split is real.
   */
  const splitPlanned = useCallback(
    async (slot: number) => {
      // Splitting the document as it stands is the common case, so no edit has to precede it.
      const pending = planRef.current ?? initialPlan(pagesRef.current);
      if (slot < 1 || slot >= pending.order.length) return false;
      const first = pending.order.slice(0, slot);
      const second = pending.order.slice(slot);
      const base = nameRef.current;
      let files = 0;
      const ok = await writePlans(
        [
          { order: first, rotations: pending.rotations },
          { order: second, rotations: pending.rotations },
        ],
        (bytes, index) => {
          files += 1;
          downloadBytes(bytes, pdfFileName(`${base}-part-${index + 1}`));
        },
      );
      if (ok) setNotice({ kind: 'split', files, first: first.length, second: second.length });
      return ok;
    },
    [writePlans],
  );

  const undoApply = useCallback(() => {
    const snapshot = appliedRef.current;
    if (!snapshot) return;
    appliedRef.current = null;
    replaceRef.current(snapshot.bytes);
    /*
     * Swapping a document clears the viewer's per-page rotations, which `applyPageEdits` has
     * just written into the file it replaced. They were view state before that, so they come
     * back as view state — one relative turn each, which is how the shell tracks them.
     */
    for (const [index, angle] of Object.entries(snapshot.rotations)) {
      const normalised = ((angle % 360) + 360) % 360;
      if (normalised) turnRef.current(Number(index) + 1, normalised);
    }
    selfSwapRef.current = true;
    setNotice({ kind: 'reverted' });
  }, []);

  const flatten = useCallback(async (): Promise<PdfFlattenResult | null> => {
    const doc = docRef.current;
    if (!doc || busy.current) return null;
    busy.current = true;
    setBusy(true);
    try {
      const result = await flattenBytes(await committedBytes(doc));
      setLastResult(result);
      return result;
    } catch (err) {
      const next = err instanceof Error ? err : new Error(String(err));
      onErrorRef.current(next);
      return null;
    } finally {
      busy.current = false;
      setBusy(false);
    }
  }, []);

  const flattenAndSave = useCallback(async () => {
    const result = await flatten();
    // A document with nothing to flatten still gets its file: the reader asked for a
    // copy of what they are looking at, and `hadNoForm` says why it looks unchanged.
    if (result) downloadBytes(result.bytes, pdfFileName(nameRef.current));
    return result;
  }, [flatten]);

  const dirty = plan !== null && !isPristine(plan, shell.numPages);
  usePdfFeaturePublish<EditFeatureState>({
    flatten: flattenAndSave,
    isBusy,
    lastResult,
    plan,
    isDirty: dirty,
    canUndo: history.length > 0,
    canUndoApply: appliedRef.current !== null,
    pendingEdits: history.length + (plan ? 1 : 0),
    notice,
    movePage,
    rotatePage,
    removePage,
    undoPageEdits,
    discardPageEdits,
    applyPageEdits,
    extractPlanned,
    splitPlanned,
    undoApply,
  });
  return null;
}

function FlattenControl() {
  const shell = usePdfFeatureShell();
  const state = usePdfFeatureState<EditFeatureState>();
  return (
    <button
      type="button"
      className="pjsr-button"
      aria-label={shell.labels.flattenDocument}
      title={shell.labels.flattenDocument}
      disabled={state.isBusy}
      aria-busy={state.isBusy || undefined}
      onClick={() => void state.flatten()}
    >
      <DownloadIcon />
    </button>
  );
}

/** The notice in the reader's language, because the tier publishes facts, not English. */
function noticeText(labels: PdfViewerLabels, notice: PageEditNotice): string {
  switch (notice.kind) {
    case 'moved':
      return formatLabel(labels.pagesMoved, { page: notice.page, position: notice.position });
    case 'removed':
      return formatLabel(labels.pagesRemoved, { page: notice.page });
    case 'rotated':
      return formatLabel(labels.pagesRotated, { page: notice.page, angle: notice.angle });
    case 'applied':
      return labels.pagesApplied;
    case 'reverted':
      return labels.pagesApplyReverted;
    case 'extracted':
      return formatLabel(labels.pagesExtracted, { count: notice.count });
    case 'split':
      return formatLabel(labels.pagesSplit, {
        files: notice.files,
        first: notice.first,
        second: notice.second,
      });
    case 'restored':
      return labels.pagesRestored;
  }
}

/**
 * The page list: every page the document will keep, in the order it will keep them.
 *
 * Buttons first and dragging as the shortcut, because the list has to be usable without a
 * pointer — and a row that can only be moved by dragging it is not operable by a keyboard.
 * Each row names the page it shows rather than its position, so a reader who moves page 12
 * three places still sees "Page 12", which is the only way to tell whether the move landed.
 */
function PagesPanel() {
  const shell = usePdfFeatureShell();
  const state = usePdfFeatureState<EditFeatureState>();
  const [dragging, setDragging] = useState<number | null>(null);
  const labels = shell.labels;
  const plan = state.plan;
  const order = plan?.order ?? initialPlan(shell.numPages).order;
  const last = order.length - 1;

  /*
   * The live region has to *change* its text for the change to be announced. An apply unmounts
   * this panel's markup while the document it wrote loads — the component instance survives, so
   * its state does too — and a region that mounts already holding its words has announced nothing.
   * Emptying it for the duration of the swap and writing after the new document has committed makes
   * that case the same as the ordinary one, where the notice changes in place.
   *
   * A timer rather than `requestAnimationFrame`, which was tried first and is wrong here: a hidden
   * tab never paints, so the callback never ran and the announcement never arrived — measured.
   */
  const [announced, setAnnounced] = useState('');
  useEffect(() => {
    if (!shell.doc) {
      setAnnounced('');
      return;
    }
    const text = state.notice ? noticeText(labels, state.notice) : '';
    const timer = setTimeout(() => setAnnounced(text), 0);
    return () => clearTimeout(timer);
  }, [state.notice, labels, shell.doc]);

  if (!shell.doc) return null;

  const drop = (slot: number) => {
    if (dragging !== null && dragging !== slot) state.movePage(dragging, slot);
    setDragging(null);
  };

  return (
    <div className="pjsr-pages">
      {/* Nothing to report is not a report: an empty line keeps its height for the
          pending count that will one day be in it, and says nothing in the meantime. */}
      <p className="pjsr-pages-summary" data-state={state.isDirty ? 'pending' : 'clean'}>
        {state.isDirty ? formatLabel(labels.pagesPending, { count: state.pendingEdits }) : ''}
      </p>
      <ol className="pjsr-pages-list">
        {order.map((page, slot) => {
          const angle = plan?.rotations[page];
          const name = formatLabel(labels.pageLabel, { page: page + 1 });
          return (
            <li
              key={page}
              className="pjsr-pages-row"
              draggable
              onDragStart={() => setDragging(slot)}
              onDragOver={(event) => {
                event.preventDefault();
                event.dataTransfer.dropEffect = 'move';
              }}
              onDrop={(event) => {
                event.preventDefault();
                drop(slot);
              }}
              onDragEnd={() => setDragging(null)}
            >
              <span className="pjsr-pages-position">{slot + 1}</span>
              <span className="pjsr-pages-page">
                {formatLabel(labels.pageOf, { page: page + 1, total: shell.numPages })}
                {angle ? <span className="pjsr-pages-angle">{`${angle}°`}</span> : null}
              </span>
              <span className="pjsr-pages-actions">
                <button
                  type="button"
                  className="pjsr-button pjsr-button--page-edit"
                  aria-label={`${labels.movePageEarlier} — ${name}`}
                  disabled={slot === 0}
                  onClick={() => state.movePage(slot, slot - 1)}
                >
                  <ChevronUpIcon />
                </button>
                <button
                  type="button"
                  className="pjsr-button pjsr-button--page-edit"
                  aria-label={`${labels.movePageLater} — ${name}`}
                  disabled={slot === last}
                  onClick={() => state.movePage(slot, slot + 1)}
                >
                  <ChevronDownIcon />
                </button>
                <button
                  type="button"
                  className="pjsr-button pjsr-button--page-edit"
                  aria-label={`${labels.rotateClockwise} — ${name}`}
                  onClick={() => state.rotatePage(slot)}
                >
                  <RotateCwIcon />
                </button>
                {slot > 0 && slot < order.length ? (
                  <button
                    type="button"
                    className="pjsr-button pjsr-button--page-edit"
                    aria-label={`${labels.splitPagesHere} — ${name}`}
                    onClick={() => void state.splitPlanned(slot)}
                  >
                    <SplitIcon />
                  </button>
                ) : null}
                <button
                  type="button"
                  className="pjsr-button pjsr-button--page-edit"
                  aria-label={`${labels.removePage} — ${name}`}
                  disabled={order.length <= 1}
                  onClick={() => state.removePage(slot)}
                >
                  <TrashIcon />
                </button>
              </span>
            </li>
          );
        })}
      </ol>
      <div className="pjsr-pages-actions-bar">
        <button
          type="button"
          className="pjsr-button pjsr-button--text"
          disabled={!state.isDirty || state.isBusy}
          onClick={() => void state.applyPageEdits()}
        >
          {labels.applyPages}
        </button>
        <button
          type="button"
          className="pjsr-button pjsr-button--text"
          title={labels.extractPages}
          disabled={!state.isDirty || state.isBusy}
          onClick={() => void state.extractPlanned()}
        >
          {labels.extractPages}
        </button>
        <button
          type="button"
          className="pjsr-button pjsr-button--text"
          disabled={!state.canUndo}
          onClick={state.undoPageEdits}
        >
          {labels.undoLabel}
        </button>
        <button
          type="button"
          className="pjsr-button pjsr-button--text"
          disabled={!state.canUndoApply}
          onClick={state.undoApply}
        >
          {labels.undoApplyPages}
        </button>
        <button
          type="button"
          className="pjsr-button pjsr-button--text"
          disabled={!state.isDirty}
          onClick={state.discardPageEdits}
        >
          {labels.discardPages}
        </button>
      </div>
      {/* One live region for the whole panel: a reader who cannot see the list moving has to
          hear it, and only the last action is worth announcing. */}
      <p className="pjsr-pages-status" role="status">
        {announced}
      </p>
    </div>
  );
}

/**
 * FR-20's second half: true flattening, behind an optional peer dependency.
 *
 * Its own entry rather than `features/flatten`, because the `edit` tier is one
 * dependency boundary — the writer this tier needs is the same one page reordering will
 * need, and two entries importing it separately would let a host pay for the library
 * twice over without noticing.
 *
 * Opt-in like `downloadFeature`, for the same reason: it hands the application a file.
 */
export const editFeature: PdfFeature<EditFeatureState> = {
  id: EDIT_FEATURE_ID,
  Runner: EditRunner,
  panel: {
    id: EDIT_FEATURE_ID,
    label: (labels) => labels.pagesTab,
    render: PagesPanel,
  },
  controls: [
    {
      id: 'flatten',
      // With the shell's download control at 9: both write a file to the reader's
      // disk, so both should give up their place in the bar together rather than one
      // surviving alone.
      priority: 9,
      label: (labels) => labels.flattenDocument,
      render: FlattenControl,
    },
  ],
};

/** The same tier saving under a fixed name. */
export function createEditFeature(
  options: EditFeatureOptions,
): PdfFeature<EditFeatureState> {
  return { ...editFeature, options };
}

export {
  initialPlan,
  inversePlan,
  isPristine,
  movePlanned,
  plannedPages,
  removePlanned,
  rotatePlanned,
} from './lib/page-plan';
export { arrangePages, flattenBytes } from './lib/pdf-write';
export type { PagePlan } from './lib/page-plan';
export type {
  PdfArrangeResult,
  PdfBytes,
  PdfFlattenResult,
  PdfPageArrangement,
} from './lib/pdf-write';
