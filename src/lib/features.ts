/**
 * The feature contract (FR-21).
 *
 * A feature is a plain value the application hands to `PdfViewer`, so a feature
 * nobody asks for never enters the module graph. Everything in this file is
 * either a type or a pure function over those types: no feature code, no pdf.js
 * call, and no import from `src/features/`, which is what keeps the core shell
 * free of the features it hosts. The build-time half of that promise is checked
 * by `scripts/check-size.mjs`, not by a comment.
 */
import type { ComponentType } from 'react';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import type { AnnotationValueStore } from './form';
import type { InkStroke } from './ink';
import type { PdfViewerLabels, PdfViewerLabelsOverride } from './labels';
import type { PageLayout, ScaleMode } from './layout';

/** What a feature's Runner publishes for its own controls and the shell to read. */
export type FeaturePublication = Record<string, unknown>;

/** The knobs the shell forwards to every page it renders. */
export interface FeaturePageProps {
  renderForms?: boolean;
  annotationStorage?: AnnotationValueStore | null;
  formVersion?: number;
  onFormChange?: () => void;
}

/**
 * Everything the shell offers a feature. Stable in shape; members that change
 * identity between renders are documented as such because features read them in
 * effects.
 */
export interface PdfViewerShell {
  doc: PDFDocumentProxy | null;
  numPages: number;
  /** 1-based page at the top of the viewport. */
  currentPage: number;
  /** Scale actually applied, after fit modes resolve. */
  scale: number;
  /** Requested scale mode, which a numeric fit resolve never replaces. */
  scaleMode: ScaleMode;
  rotation: number;
  documentLabel?: string;
  labels: PdfViewerLabels;
  labelsOverride?: PdfViewerLabelsOverride;
  scrollToPage: (page: number) => void;
  setScaleMode: (mode: ScaleMode) => void;
  setLayout: (layout: PageLayout) => void;
  /** Routes a failure into the viewer's own `onError`. */
  reportError: (error: Error) => void;
  /** Freehand strokes on a 0-based page. Ink is core chrome, and print needs it. */
  inkStrokesForPage: (index: number) => InkStroke[];
  openSidebar: (open: boolean, tab?: string) => void;
}

export interface PdfFeatureControl<S extends object = FeaturePublication> {
  id: string;
  /**
   * Eviction order in the toolbar, on the same scale as the built-in controls:
   * 1 is page navigation, 12 is the document label. Lower stays in the bar
   * longer, and equal priorities fold as one cluster.
   */
  priority: number;
  /** Row label once the control has folded into the overflow menu. */
  label(labels: PdfViewerLabels, state: S): string;
  /**
   * When this says no the control is absent from the bar *and* the menu, which
   * is how print disappears on a platform with no print dialog rather than
   * sitting there disabled.
   */
  available?(state: S, shell: PdfViewerShell): boolean;
  /**
   * Rendered by the toolbar. It may appear in three places at once — the
   * off-screen sizer, the bar, and the menu — so it must read state through
   * `usePdfFeatureState` rather than own it: only the Runner is mounted once.
   */
  render: ComponentType;
}

export interface PdfFeaturePanel<S extends object = FeaturePublication> {
  id: string;
  label(labels: PdfViewerLabels, state: S): string;
  render: ComponentType;
}

/** The subset of a keydown event a feature binding needs. */
export interface FeatureKeyEvent {
  key: string;
  ctrlKey: boolean;
  metaKey: boolean;
  altKey: boolean;
  preventDefault: () => void;
}

export interface PdfFeatureKeyBinding<S extends object = FeaturePublication> {
  /** Key as reported by `KeyboardEvent.key`, matched case-insensitively. */
  key: string;
  /** Requires Ctrl, or Cmd on macOS, which the viewer treats as the same chord. */
  ctrl?: boolean;
  /** Refuses to consume the chord, e.g. because the platform cannot print. */
  when?(state: S, shell: PdfViewerShell): boolean;
  run(state: S, shell: PdfViewerShell, event: FeatureKeyEvent): void;
}

export interface PdfFeature<S extends object = FeaturePublication> {
  id: string;
  /**
   * Owns the feature's hooks and is the only place that publishes. Mounted once
   * per viewer instance, keyed by `id`, never by position in the list.
   */
  Runner?: ComponentType;
  /** Merged into every page's props, last mounted wins on a clash. */
  pageProps?(state: S): FeaturePageProps;
  controls?: readonly PdfFeatureControl<S>[];
  panel?: PdfFeaturePanel<S>;
  keys?: readonly PdfFeatureKeyBinding<S>[];
  /** Per-instance options for features built by a `create*Feature` factory. */
  options?: unknown;
}

/**
 * A feature in a list.
 *
 * `PdfFeature<S>` is what a feature author writes; the shell only ever holds a
 * bag of features whose state types differ from each other, and TypeScript
 * cannot keep `S` honest across that mix — a state interface is not assignable
 * to `Record<string, unknown>` merely because it is an object. `any` here erases
 * the one type the shell provably never uses: each feature still reads its own
 * state through `usePdfFeatureState<S>()`, where the type is real again.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AnyPdfFeature = PdfFeature<any>;

/** What the shell runs when the application names no features at all. */
export const NO_FEATURES: readonly AnyPdfFeature[] = Object.freeze([]);

/**
 * True when two publications carry the same values one level deep.
 *
 * The compare is what stops a Runner that rebuilds its published object on
 * every render from re-rendering the shell forever. It is deliberately shallow:
 * a feature that publishes a fresh nested object each render would defeat it, so
 * published values are expected to be primitives or stable references.
 */
export function samePublication(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  const ak = Object.keys(a);
  const bk = Object.keys(b);
  if (ak.length !== bk.length) return false;
  return ak.every((key) => Object.is((a as Record<string, unknown>)[key], (b as Record<string, unknown>)[key]));
}

/** Merges each mounted feature's page contributions in list order. */
export function mergeFeaturePageProps(
  features: readonly AnyPdfFeature[],
  get: (id: string) => FeaturePublication,
): FeaturePageProps {
  const merged: FeaturePageProps = {};
  for (const feature of features) {
    if (!feature.pageProps) continue;
    Object.assign(merged, feature.pageProps(get(feature.id)));
  }
  return merged;
}

/**
 * The first feature binding that claims this chord.
 *
 * List order decides the winner, so a feature installed later can override one
 * installed earlier — the same rule the toolbar applies to duplicate ids.
 */
export function findFeatureKey(
  features: readonly AnyPdfFeature[],
  get: (id: string) => FeaturePublication,
  shell: PdfViewerShell,
  event: FeatureKeyEvent,
): { feature: AnyPdfFeature; binding: PdfFeatureKeyBinding } | null {
  const ctrl = event.ctrlKey || event.metaKey;
  for (const feature of features) {
    if (!feature.keys?.length) continue;
    const state = get(feature.id);
    for (const binding of feature.keys) {
      if (binding.key.toLowerCase() !== event.key.toLowerCase()) continue;
      if (Boolean(binding.ctrl) !== ctrl) continue;
      if (binding.when && !binding.when(state, shell)) continue;
      return { feature, binding };
    }
  }
  return null;
}
