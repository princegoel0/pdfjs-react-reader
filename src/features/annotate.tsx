import { useCallback, useEffect, useRef, useState } from 'react';
import { AnnotationEditorType, AnnotationEditorUIManager } from 'pdfjs-dist';
import { HighlightIcon, PenIcon, TextIcon, TrashIcon } from '../components/icons';
import { usePdfFeaturePublish, usePdfFeatureShell, usePdfFeatureState } from '../components/FeatureHost';
import { ANNOTATE_FEATURE_ID } from './ids';
import {
  DEFAULT_HIGHLIGHT_COLOR,
  HIGHLIGHT_COLORS,
  HIGHLIGHT_COLOR_PARAM,
  HIGHLIGHT_PALETTE_STRING,
  readEditingParams,
  readEditingState,
  type PdfAnnotationState,
} from '../lib/editing-state';
import type { PdfViewerLabels } from '../lib/labels';
import type { PdfFeature } from '../lib/features';

/**
 * The tool a reader arms.
 *
 * Stamp and signature are not here, and it is not a matter of building their UI:
 * both were measured to break `saveDocument()` rather than fail politely. A
 * signature editor cannot be given any data at all — the manager takes a
 * `SignatureManager` and `pdfjs-dist` exports no such class — and while one sits
 * in the annotation storage the save throws in `serializeDraw`. A stamp created
 * through the paste path reaches the storage with no image registered, and the
 * save then throws in the worker on `imageRef`. Both are removed rather than kept
 * and disabled: a tool that corrupts the document is worse than no tool.
 *
 * Underline, strikeout and squiggly are absent for a third reason: pdf.js 6.3
 * gives its editors no subtype at all. `AnnotationEditorType` is only FREETEXT,
 * HIGHLIGHT, STAMP, INK, POPUP, SIGNATURE and COMMENT, `AnnotationEditorParamsType`
 * has no `HIGHLIGHT_TYPE_*`, and a `/Underline` in the document reports itself not
 * editable. So a reader highlights, and the markups another viewer authored stay
 * as they are.
 */
export type AnnotateTool = 'none' | 'free-text' | 'highlight' | 'ink';

/** The state a viewer that has never armed a tool reports. */
const RESTING = readEditingState(null);

const MODE_BY_TOOL: Record<AnnotateTool, number> = {
  none: AnnotationEditorType.NONE,
  'free-text': AnnotationEditorType.FREETEXT,
  highlight: AnnotationEditorType.HIGHLIGHT,
  ink: AnnotationEditorType.INK,
};

type BusListener = (args: unknown) => void;

/**
 * The manager's event bus, written here because `pdfjs-dist` exports no
 * `EventBus` from its package root — a host could not build the real one, and the
 * manager only ever calls `dispatch`.
 *
 * Subscriptions are keyed by name: the manager listens for six of them
 * (`editingaction`, `pagechanging`, `scalechanging`, `rotationchanging`,
 * `setpreference`, `switchannotationeditorparams`) and dispatches others, so a
 * bus that ignored the name would run its own action handlers on unrelated
 * events.
 *
 * It is also the seam `onAnnotationChange` hangs on: the engine reports its own
 * changes through these names, so the viewer's event can be derived from what the
 * manager actually says instead of from a guessed polling cycle.
 */
export function createEditorEventBus() {
  const listeners = new Map<string, Set<BusListener>>();
  return {
    dispatch(name: string, args?: unknown) {
      listeners.get(name)?.forEach((listener) => listener(args));
    },
    on(name: string, listener: BusListener) {
      const existing = listeners.get(name);
      if (existing) existing.add(listener);
      else listeners.set(name, new Set([listener]));
    },
    off(name: string, listener: BusListener) {
      listeners.get(name)?.delete(listener);
    },
  };
}

export interface AnnotateFeatureState {
  /** The document-wide manager every page registers its editor layer with. */
  uiManager: AnnotationEditorUIManager | null;
  tool: AnnotateTool;
  setTool: (tool: AnnotateTool) => void;
  /** What the manager last said about itself. See {@link PdfAnnotationState}. */
  editing: PdfAnnotationState;
  /** The colour a new highlight will use, or the selected one's current colour. */
  highlightColor: string;
  /**
   * Points new highlights (or the selected mark) at another palette colour.
   *
   * Dispatched rather than assigned: `updateParams` is reached through the manager's
   * bus in pdf.js's own viewer, and the same call covers both cases — a selected
   * editor is recoloured, and with nothing selected the value becomes the default for
   * the next mark.
   */
  setHighlightColor: (color: string) => void;
  /** Removes the selected marks. Enabled only while `editing.canDelete` holds. */
  deleteSelection: () => void;
}

/** pdf.js's own alert identifiers, in this viewer's words. */
const ALERT_LABELS: Record<string, keyof PdfViewerLabels> = {
  'pdfjs-editor-highlight-added-alert': 'highlightAdded',
  'pdfjs-editor-freetext-added-alert': 'freeTextAdded',
  'pdfjs-editor-ink-added-alert': 'inkAdded',
  // The engine also has ids for stamp and signature; this feature offers neither.
};

/**
 * The manager's alert element, made to announce in words the reader's language
 * actually contains.
 *
 * pdf.js reports "a mark was added" by writing `data-l10n-id` onto whatever
 * element it was handed, expecting Fluent to turn that into text — and this
 * viewer passes `l10n: null`, so the attribute alone says nothing to anyone.
 * Watching it and writing the mapped label into the element keeps the engine's own
 * judgement about which moments are worth announcing, which a feature could not
 * reconstruct from the state events without guessing. The attribute is removed
 * after each read: announcing the same id twice in a row is otherwise no mutation
 * at all, and a second highlight would be silent.
 */
function createAlertRegion(labels: { current: PdfViewerLabels }) {
  const element = document.createElement('div');
  element.className = 'pjsr-alert';
  element.setAttribute('role', 'status');
  element.setAttribute('aria-live', 'polite');
  const observer = new MutationObserver(() => {
    const id = element.getAttribute('data-l10n-id');
    if (!id) return;
    const key = ALERT_LABELS[id];
    element.textContent = key ? labels.current[key] : '';
    element.removeAttribute('data-l10n-id');
    element.removeAttribute('data-l10n-args');
  });
  return {
    element,
    start: () => observer.observe(element, { attributes: true, attributeFilter: ['data-l10n-id'] }),
    stop: () => observer.disconnect(),
  };
}

/**
 * Owns the one manager per document.
 *
 * The manager is document-wide — it is what keeps an editor alive while its page
 * scrolls out of the virtualized window and back — so it belongs to the Runner,
 * which is mounted once. Everything per-page (the draw layer, the editor layer) is
 * built by `PdfPage` from the manager published here.
 */
function AnnotateRunner() {
  const shell = usePdfFeatureShell();
  const [uiManager, setUiManager] = useState<AnnotationEditorUIManager | null>(null);
  const [tool, setTool] = useState<AnnotateTool>('none');
  const [editing, setEditing] = useState<PdfAnnotationState>(RESTING);
  const [highlightColor, setHighlightColor] = useState<string>(DEFAULT_HIGHLIGHT_COLOR);
  const { doc, rootRef } = shell;
  // One bus for the life of the Runner: the manager is rebuilt with the document,
  // and the two effects below need the same instance the manager registered on.
  const busRef = useRef<ReturnType<typeof createEditorEventBus> | null>(null);
  if (!busRef.current) busRef.current = createEditorEventBus();
  const bus = busRef.current;
  // Read through a ref, because a catalog change mid-session must not rebuild the
  // manager — and the announcements would otherwise be stuck in the first language.
  const labels = useRef(shell.labels);
  labels.current = shell.labels;
  // Same reason for the host's `onAnnotationChange`: the listeners below live as long
  // as the document, and the shell object is rebuilt on every viewer render.
  const shellRef = useRef(shell);
  shellRef.current = shell;

  useEffect(() => {
    const root = rootRef.current;
    if (!doc || !root) return;
    const alert = createAlertRegion(labels);
    root.append(alert.element);
    alert.start();
    const manager = new AnnotationEditorUIManager(
      root,
      // The manager reads `classList` off the viewer and nothing else, so the
      // root stands in for pdf.js's PDFViewer.
      { classList: root.classList } as never,
      alert.element as never,
      // The three collaborators this feature does not enable: each is read through
      // optional chaining, so null switches the flow off rather than throwing.
      null, // altTextManager
      null, // commentManager
      null, // signatureManager, which pdf.js does not export, so signing is out
      bus as never,
      doc,
      null, // pageColors
      // The palette, as `NAME=#RRGGBB` pairs: this is what the readers' marks are
      // painted with, and what the colour control below lists. See `lib/editing-state`
      // for why the `#` on every value is load-bearing.
      HIGHLIGHT_PALETTE_STRING,
      false, // enableHighlightFloatingButton
      false, // enableUpdatedAddImage
      false, // enableNewAltTextWhenAddingImage
      null, // mlManager
      null, // editorUndoBar, which pdf.js assigns but never reads
      false, // supportsPinchToZoom — the shell owns pinch zoom
    );
    setUiManager(manager);
    return () => {
      setTool('none');
      setUiManager(null);
      manager.destroy();
      alert.stop();
      alert.element.remove();
    };
  }, [doc, rootRef, bus]);

  // Scale and rotation reach the manager through its bus, not by writing its
  // fields. `onScaleChanging` is where pdf.js derives `realScale`, walks the
  // editors waiting to be rescaled, and commits the one in flight;
  // `onRotationChanging` commits too. Assigning `viewParameters` instead — which
  // is what this feature first did — skips all three quietly.
  useEffect(() => {
    if (uiManager) bus.dispatch('scalechanging', { scale: shell.scale });
  }, [uiManager, shell.scale, bus]);

  useEffect(() => {
    if (uiManager) bus.dispatch('rotationchanging', { pagesRotation: shell.rotation });
  }, [uiManager, shell.rotation, bus]);

  // The state events are the viewer's `onAnnotationChange`, so they are subscribed
  // for as long as the bus exists — before the manager is built and after it is
  // destroyed — and the handlers never close over the shell they were registered by.
  useEffect(() => {
    const onStates = (args: unknown) => {
      const next = readEditingState((args as { details?: unknown })?.details);
      setEditing(next);
      shellRef.current.reportAnnotationChange(next);
    };
    // The engine also reports what *its* controls should show, including the colour
    // of a mark that was selected — which is how the swatch can report a colour the
    // reader never chose, authored by another viewer before this one opened the file.
    const onParams = (args: unknown) => {
      const { color } = readEditingParams((args as { details?: unknown })?.details);
      if (color) setHighlightColor(color);
    };
    bus.on('editingstateschanged', onStates);
    bus.on('annotationeditorparamschanged', onParams);
    return () => {
      bus.off('editingstateschanged', onStates);
      bus.off('annotationeditorparamschanged', onParams);
    };
  }, [bus]);

  useEffect(() => {
    void uiManager?.updateMode(MODE_BY_TOOL[tool]);
  }, [uiManager, tool]);

  const setHighlightColorThroughBus = useCallback(
    (color: string) => {
      setHighlightColor(color);
      bus.dispatch('switchannotationeditorparams', { type: HIGHLIGHT_COLOR_PARAM, value: color });
    },
    [bus],
  );

  const deleteSelection = useCallback(() => {
    // `delete()` acts on the current selection, which is why the control is disabled
    // unless the engine has reported one: with nothing selected it is a no-op that a
    // reader would read as a broken button.
    uiManager?.delete();
  }, [uiManager]);

  usePdfFeaturePublish<AnnotateFeatureState>({
    uiManager,
    tool,
    setTool,
    editing,
    highlightColor,
    setHighlightColor: setHighlightColorThroughBus,
    deleteSelection,
  });
  return null;
}

/** The tools the bar offers, in the order they appear. */
const TOOLS: readonly {
  tool: Exclude<AnnotateTool, 'none'>;
  label: keyof PdfViewerLabels;
  icon: typeof HighlightIcon;
}[] = [
  { tool: 'highlight', label: 'highlightTool', icon: HighlightIcon },
  { tool: 'free-text', label: 'freeTextTool', icon: TextIcon },
  { tool: 'ink', label: 'inkTool', icon: PenIcon },
];

/**
 * The tool picker, its colour, and Delete.
 *
 * One control, because they are one job: the three tools are mutually exclusive
 * (arming highlight while free text is armed would mean two layers of pointer
 * capture on the same page), the colour says what a mark looks like, and Delete
 * takes the selected one away. Pressing the armed tool again is how you stop, which
 * is why each button is `aria-pressed` rather than a radio group — the bar stays one
 * row and the state is legible to a screen reader without a visible "off" button.
 *
 * The colour is a select over the engine's own palette rather than pdf.js's
 * `ColorPicker`: that class renders the toolbar it is embedded in, whose buttons have
 * no accessible name outside Fluent, and this sheet hides it. A labelled select gets
 * the same seven values through the same parameter, and the swatch beside it is the
 * only thing that has to carry colour.
 */
function AnnotateToolsControl() {
  const shell = usePdfFeatureShell();
  const state = usePdfFeatureState<AnnotateFeatureState>();
  const labels = shell.labels;

  return (
    <div className="pjsr-annotate" role="group" aria-label={labels.annotationTools}>
      {TOOLS.map(({ tool, label, icon: Icon }) => (
        <button
          key={tool}
          type="button"
          className="pjsr-button"
          aria-pressed={state.tool === tool}
          aria-label={labels[label]}
          title={labels[label]}
          onClick={() => state.setTool(state.tool === tool ? 'none' : tool)}
        >
          <Icon />
        </button>
      ))}
      <span
        className="pjsr-annotate-swatch"
        style={{ backgroundColor: state.highlightColor }}
        aria-hidden="true"
      />
      <select
        className="pjsr-annotate-colour"
        aria-label={labels.highlightColour}
        title={labels.highlightColour}
        value={state.highlightColor}
        onChange={(event) => state.setHighlightColor(event.currentTarget.value)}
      >
        {HIGHLIGHT_COLORS.map(({ name, color }) => (
          <option key={color} value={color}>
            {name}
          </option>
        ))}
        {/* A mark authored elsewhere can carry a colour off this palette, and the
            select must still show what is on the page rather than snap to Yellow. */}
        {!HIGHLIGHT_COLORS.some(({ color }) => color === state.highlightColor) && (
          <option value={state.highlightColor}>{state.highlightColor}</option>
        )}
      </select>
      <button
        type="button"
        className="pjsr-button"
        aria-label={labels.deleteAnnotation}
        title={labels.deleteAnnotation}
        disabled={!state.editing.canDelete}
        onClick={state.deleteSelection}
      >
        <TrashIcon />
      </button>
    </div>
  );
}

/**
 * FR-18 authoring: the annotation editors, as a feature.
 *
 * Mounting it is what makes pages build an editor layer at all — `<PdfViewer>`
 * without it renders annotations read-only and costs nothing for this code.
 *
 * The ink tool here is *not* the shell's `draw` control, which paints an SVG
 * overlay that prints but is never written into the document. This one produces a
 * real `/Ink` annotation that survives a download — see the tool list for what
 * the engine will and will not author.
 */
export const annotateFeature: PdfFeature<AnnotateFeatureState> = {
  id: ANNOTATE_FEATURE_ID,
  Runner: AnnotateRunner,
  // The shell's freehand toggle, whose strokes print but never reach a download.
  // Two ink tools in one bar is one too many, and this is the one that saves.
  replaces: ['draw'],
  pageProps: (state) => ({
    annotationEditorUIManager:
      (state.uiManager as AnnotationEditorUIManager | null | undefined) ?? null,
    annotationEditorEditing: state.tool !== 'none',
  }),
  controls: [
    {
      id: 'annotate',
      // With the shell's own drawing toggle at 6: both are authoring, so both
      // leave the bar together rather than stranding one tool per row.
      priority: 6,
      label: (labels) => labels.annotationTools,
      available: (state, shell) =>
        Boolean(state.uiManager) && shell.doc?.isPureXfa !== true,
      render: AnnotateToolsControl,
    },
  ],
};
