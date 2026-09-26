import { AnnotationEditorParamsType } from 'pdfjs-dist';

/**
 * What the annotation editor reports about itself, in the viewer's own words.
 *
 * The editor manager is the only thing that knows when a mark has been made, moved
 * or removed, and it says so through one event: `editingstateschanged`, which it
 * fires only when something actually differs from what it last reported. Deriving the
 * host's `onAnnotationChange` from that is cheaper and more truthful than polling the
 * manager, and it means a host hears about a change exactly when the engine considers
 * there is one — including the changes no viewer UI surfaces, like a keyboard delete.
 */
/** The keys the manager merges into its own record of the previous state. */
type EngineStateKey =
  | 'isEditing'
  | 'isEmpty'
  | 'hasSomethingToUndo'
  | 'hasSomethingToRedo'
  | 'hasSelectedEditor'
  | 'hasSelectedText';

export interface PdfAnnotationState {
  /** A tool is armed, or a mark is selected: the viewer is in editing mode. */
  isEditing: boolean;
  /** No editor holds anything, which is the engine's own "nothing to show" test. */
  isEmpty: boolean;
  /** Something can be undone — in practice, unsaved changes exist this session. */
  canUndo: boolean;
  canRedo: boolean;
  /** A mark is selected, which is what a Delete control acts on. */
  canDelete: boolean;
  /** Text is selected, so the highlight tool has something to work on. */
  hasSelectedText: boolean;
}

/**
 * The state as the viewer reports it, from an `editingstateschanged` payload.
 *
 * The manager merges every dispatch into its previous state before sending, so the
 * details arrive complete after the first change and partial before it — which is why
 * every field needs a default rather than an assertion. A missing or malformed
 * payload reads as the resting state: a viewer that has never armed a tool has
 * nothing to report, and a surprise in an engine event must not become a thrown error
 * inside a host's callback.
 */
export function readEditingState(details: unknown): PdfAnnotationState {
  const d = (details ?? {}) as Partial<Record<EngineStateKey, unknown>>;
  return {
    isEditing: d.isEditing === true,
    isEmpty: d.isEmpty !== false,
    canUndo: d.hasSomethingToUndo === true,
    canRedo: d.hasSomethingToRedo === true,
    canDelete: d.hasSelectedEditor === true,
    hasSelectedText: d.hasSelectedText === true,
  };
}

/**
 * The current highlight colour and thickness out of an `annotationeditorparamschanged`
 * payload — the event the manager fires to say what its own controls should show.
 *
 * The details are an array of `[paramType, value]` pairs, the same shape pdf.js's
 * `ColorPicker` consumes, so a toolbar swatch can follow the engine's idea of the
 * current colour instead of keeping a second copy that would drift the first time a
 * reader selects a mark another viewer authored.
 */
export function readEditingParams(details: unknown): {
  color: string | null;
  thickness: number | null;
} {
  const entries = Array.isArray(details) ? (details as [unknown, unknown][]) : [];
  let color: string | null = null;
  let thickness: number | null = null;
  for (const [type, value] of entries) {
    if (type === AnnotationEditorParamsType.HIGHLIGHT_COLOR && typeof value === 'string') {
      color = value;
    } else if (
      type === AnnotationEditorParamsType.HIGHLIGHT_THICKNESS &&
      typeof value === 'number'
    ) {
      thickness = value;
    }
  }
  return { color, thickness };
}

/** The parameter a colour control dispatches back through the manager's bus. */
export const HIGHLIGHT_COLOR_PARAM = AnnotationEditorParamsType.HIGHLIGHT_COLOR;

/**
 * The colours the manager is built with, in the order it is handed them.
 *
 * The names are pdf.js's own, so what a reader picks here is what the engine's own
 * toolbar would have offered; there are no `_HCM` entries because those are only read
 * when `pageColors` is supplied, which this viewer never does.
 *
 * **The `#` on each value is load-bearing and was measured.** Every consumer treats a
 * value as a paint — the highlight's `fill` attribute on its draw-layer svg, the
 * colour swatch's `background-color`, and the colour an editor reports for itself —
 * and an invalid paint does not fail: `fill` resolves through inheritance to black. A
 * value written `FFFF00` therefore parsed fine, saved fine, and painted a black bar
 * over the reader's text.
 */
export const HIGHLIGHT_COLORS = [
  { name: 'Yellow', color: '#FFFF00' },
  { name: 'Green', color: '#00FF00' },
  { name: 'Pink', color: '#FF0093' },
  { name: 'Blue', color: '#00FFFF' },
  { name: 'Orange', color: '#FFC800' },
  { name: 'Red', color: '#FF0000' },
  { name: 'Purple', color: '#800080' },
] as const;

/** The palette as the manager wants it: `NAME=#RRGGBB` pairs in one string. */
export const HIGHLIGHT_PALETTE_STRING = HIGHLIGHT_COLORS
  .map(({ name, color }) => `${name}=${color}`)
  .join(',');

/** What a fresh highlight gets, which is the first entry — the manager's own rule. */
export const DEFAULT_HIGHLIGHT_COLOR = HIGHLIGHT_COLORS[0].color;
