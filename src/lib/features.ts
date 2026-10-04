/**
 * The feature contract (FR-21).
 *
 * A feature is a plain value the application hands to `PdfViewer`, so a feature
 * nobody asks for never enters the module graph. Everything in this file is
 * either a type or a pure function over those types: no feature code, no pdf.js
 * call, and no import from `src/features/`, which is what keeps the core shell
 * free of the features it hosts. The build-time half of that promise is checked
 * by `scripts/check-size.mjs`, not by a comment. The one runtime import is §3.6's
 * `PdfError`, because `orderFeatures` refuses a malformed list with a code rather
 * than with a sentence — the same reason `src/lib/source.ts` throws what it throws.
 */
import type { ComponentType } from 'react';
import type {
  AnnotationEditorUIManager,
  PDFDocumentProxy,
  PDFPageProxy,
} from 'pdfjs-dist';
import type { AnnotationValueStore } from './form';
import type { PdfViewerLabels, PdfViewerLabelsOverride } from './labels';
import type { PageLayout, ScaleMode } from './layout';
import type { PdfAnnotationState } from './editing-state';
import type { PdfDestinationPosition } from './outline';
import { PdfError } from './errors';
import type { OptionalContentConfigHandle } from './optional-content';

/** What a feature's Runner publishes for its own controls and the shell to read. */
export type FeaturePublication = Record<string, unknown>;

/**
 * The part of pdf.js's `StructTreeLayerBuilder` a page uses.
 *
 * Written here rather than imported from `pdfjs-dist/web/pdf_viewer.mjs`: naming that module anywhere in
 * the core is the thing `scripts/check-size.mjs` greps for, even in a type position, because the shipped
 * file is a 320 kB pre-bundled viewer that does not tree-shake. `render` is typed as what the
 * implementation does — it resolves the tree's root element, which is the only way it can be mounted —
 * and not as the generated declaration, which promises `void`.
 */
export interface PdfStructTreeLayer {
  render(): Promise<HTMLElement | null>;
  updateTextLayer(): void;
  hide(): void;
  show(): void;
}

/**
 * pdf.js's constructor: positional, and identical across the advertised peer range.
 *
 * `rawDims` is `unknown` rather than a shape, because that is what the caller has: the generated
 * declaration types the viewport's `rawDims` as `Object`, which is assignable to nothing narrower, and
 * `any` in the engine's own signature. The builder reads four numeric fields off it and only to place one
 * element, so naming them here would be a promise about a peer's internals that nothing checks.
 */
export interface PdfStructTreeLayerBuilder {
  new (page: PDFPageProxy, rawDims: unknown): PdfStructTreeLayer;
}

/** The knobs the shell forwards to every page it renders. */
export interface FeaturePageProps {
  renderForms?: boolean;
  annotationStorage?: AnnotationValueStore | null;
  formVersion?: number;
  onFormChange?: () => void;
  /**
   * True while an annotation tool is armed, forwarded to `page.render()`.
   *
   * pdf.js then leaves the *editable* annotations out of the canvas
   * (`mustBeViewedWhenEditing` returns `!data.isEditable`), which is what stops a
   * page from painting a highlight twice — once as the annotation it was, once as
   * the editor holding it. Document-wide, because every page is editing or none
   * is, so it can ride the merged page props.
   */
  annotationEditorEditing?: boolean;
  /**
   * The document-wide editor manager, when a feature owns one.
   *
   * Deliberately the only editor thing that fits here: page props are merged once
   * and handed to every page, so anything per-page — the draw layer, the editor
   * layer itself — has to be built by the page that owns the divs it attaches to.
   */
  annotationEditorUIManager?: AnnotationEditorUIManager | null;
  /**
   * Ask every page to extract its marked-content structure, which is what a structure tree binds to.
   *
   * A static switch rather than a per-document answer, and deliberately so: a text layer built without it
   * has no `markedContent` wrappers at all, so a page that learned the document was tagged *after*
   * building one would have to rebuild the layer to attach a tree — the 39.8 ms-per-page rebuild this
   * project removed from the zoom path in `0.8`, arriving instead on the first paint of every page.
   * Asking is the feature's decision, made when it is mounted; whether a tree then appears is the
   * document's, and costs nothing on a page that turns out to have none.
   */
  structureLayer?: boolean;
  /**
   * pdf.js's structure-tree builder, once the feature has imported it and read the document's `MarkInfo`.
   *
   * The constructor rather than an instance, for the reason documented on
   * {@link FeaturePageProps.annotationEditorUIManager}: the instance owns a page's DOM and has to be built
   * by the page that owns the divs its tree is appended to. It arrives asynchronously, and the page's
   * text layer is already marked by then, so nothing rebuilds when it lands.
   */
  structTreeLayerBuilder?: PdfStructTreeLayerBuilder | null;
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
  /**
   * Per-page rotation the reader set with the viewer's own control, keyed by 0-based page.
   *
   * A feature that writes the document has to fold these into it, because a swap of the
   * document clears them: they become `/Rotate` entries rather than view state.
   */
  pageRotations: Record<number, number>;
  documentLabel?: string;
  /**
   * Show different bytes in place of the document on screen.
   *
   * A feature that rewrites the file needs this because the result cannot be shown in
   * place: reordering pages is a new document, and a reader who cannot see it cannot keep
   * going. The host's `src` still wins as soon as it changes, so an edit never outlives the
   * document it was made against.
   */
  replaceDocument: (bytes: Uint8Array, name?: string) => void;
  labels: PdfViewerLabels;
  labelsOverride?: PdfViewerLabelsOverride;
  scrollToPage: (page: number) => void;
  /**
   * Land on a 1-based page *at the place a destination names*, and take the magnification it asks for.
   *
   * A feature that resolves a `/Dest` of its own — a link panel, a structured-tree jump, an attachment that
   * carries a target — should not have to choose between the page and the position, which is the choice the
   * outline used to be handed. `null` means the document named no place, and the page top is what you get.
   */
  followDestination: (page: number, position: PdfDestinationPosition | null) => void;
  setScaleMode: (mode: ScaleMode) => void;
  setLayout: (layout: PageLayout) => void;
  /** Turn one page of the document on screen, in view state until a feature writes it. */
  rotatePage: (page: number, degrees: number) => void;
  /** Routes a failure into the viewer's own `onError`, coded as §3.6's `PdfError`. */
  reportError: (error: PdfError) => void;
  /**
   * Routes an annotation-editor change into the viewer's own `onAnnotationChange`.
   *
   * The manager is the only thing that knows a mark has moved, and the callback is a
   * prop of the component that mounted the feature — so a feature cannot reach it
   * directly, and the seam has to be here. Same shape as `reportError`.
   */
  reportAnnotationChange: (state: PdfAnnotationState) => void;
  /**
   * Asks every mounted page to redraw without changing any of its inputs.
   *
   * A layer switched through `OptionalContentConfig` changes what the engine paints
   * while leaving the document, the viewport and the scale untouched, so nothing in
   * the props would otherwise re-run the render. Stable identity: it is safe to put
   * in an effect's dependency list.
   */
  repaint: () => void;
  /** The counter `repaint` bumps. Read it to notice a change you did not make. */
  contentVersion: number;
  /**
   * The document's single `OptionalContentConfig`, or null before it resolves.
   *
   * Mutate this one and nothing else: pdf.js builds a new config on every
   * `getOptionalContentConfig()` call and every render that is not handed one, so a
   * layer switched on any other instance paints as if it never moved.
   */
  optionalContentConfig: OptionalContentConfigHandle | null;
  /**
   * The viewer's root element, as a ref.
   *
   * A feature that must hand a DOM node to engine code — an annotation editor
   * needs a container to route keyboard and pointer events through — reads this
   * inside an effect. It is the ref rather than the element so that depending on
   * the shell object costs nothing before mount.
   */
  rootRef: { current: HTMLElement | null };
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
   * Ids of the features this one requires, validated before anything mounts.
   *
   * A *requirement*, not a wish: a dependency is a feature whose absence makes
   * this one wrong, so `orderFeatures` refuses the list when the named id is not
   * there. A feature that merely *reads* a peer when it happens to be mounted is
   * not a dependency and must not be declared as one — `download` asks `forms`
   * whether the document has edits and works correctly when it never answers,
   * which is what `usePdfFeaturePeer`'s `Partial` return is for. Declaring that
   * pair would turn an optional composition into a refusal.
   *
   * Ordering is the other half, and it is observable wherever the shell has to resolve a
   * tie: which Runner initialises first, which feature has the last word on a page
   * contribution (the later one), which of two equal-priority controls stays in the bar when
   * the toolbar folds, and which feature claims a chord both of them bind (the first one).
   * Registration order answers all four, rather than the host's written order answering some
   * and the dependency graph answering the rest.
   */
  dependsOn?: readonly string[];
  /**
   * Owns the feature's hooks and is the only place that publishes. Mounted once
   * per viewer instance, keyed by `id`, never by position in the list.
   */
  Runner?: ComponentType;
  /** Merged into every page's props, last mounted wins on a clash. */
  pageProps?(state: S): FeaturePageProps;
  controls?: readonly PdfFeatureControl<S>[];
  /**
   * Built-in control ids this feature takes over, which the shell then hides.
   *
   * It exists for the case where two controls do one job: a feature that authors
   * the mark the shell also draws would replace the shell's, because offered side
   * by side the two are indistinguishable until one of them loses the reader's
   * work. No built-in needs it today — the shell draws nothing of its own since
   * FR-18 withdrew its freehand surface — so this is the seam a host or a later
   * feature writes through, and `withReplacedControls` folds it into the same
   * `controls.hide` list the application can write by hand.
   *
   * Declaring it on the feature rather than telling hosts to write
   * `controls: { hide: … }` means the fold travels with the feature, and the shell
   * still needs no import of it to apply the rule.
   */
  replaces?: readonly string[];
  panel?: PdfFeaturePanel<S>;
  keys?: readonly PdfFeatureKeyBinding<S>[];
  /**
   * The published stylesheet specifiers this feature's own chrome needs, spelled as an
   * application would import them — `styles.css` not included, because that one belongs
   * to the shell and every consumer of it imports it.
   *
   * Declared on the value rather than discovered by convention (§3.7), so the reader
   * of a feature list can see what registering it will pull into the page *before*
   * registering it — a stylesheet that arrives by naming convention is a stylesheet a
   * host cannot audit, and one they forgot to import is a control that renders
   * unstyled. The shell never loads these: CSS has no runtime import a bundler can
   * tree-shake, so the application imports them itself and this field is what tells it
   * the list. `src/features/stylesheets.test.tsx` fails when a built-in declares a
   * sheet that is not published, or stops declaring one it needs.
   */
  stylesheets?: readonly string[];
  /**
   * Releases what this feature owns when the shell unregisters it.
   *
   * For a feature with a Runner, the Runner's own effect cleanups are usually enough, and
   * this field is then unnecessary — it exists for the resources that outlive a component:
   * an object URL cached across documents, a module-level table keyed by feature id, a
   * worker. The shell calls it once, on unmount, after retiring the feature's published
   * state, so a peer reads `{}` rather than a dead feature's last publication.
   *
   * It runs *before* that feature's Runner effect cleanups, because that is how React tears
   * a deleted subtree down — parent first, asserted in `FeatureHost.registration.test.tsx`.
   * So a resource the Runner acquired belongs in the Runner, and `cleanup` belongs to what
   * the Runner never held.
   */
  cleanup?: () => void;
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
 * The feature list in registration order: validated, and with every dependency before
 * its dependents.
 *
 * Validation is the point. A duplicate id is not a cosmetic clash — the store, the
 * toolbar and the runners all key on `id`, so two features under one id means a control
 * whose state belongs to neither copy and a reader who loses their marks without ever
 * being told. A missing dependency is a feature that will read a peer that never
 * publishes. A cycle is a list that cannot be initialised at all. Each therefore fails
 * with §3.6's `CONFIGURATION_ERROR`, naming the feature and the problem, and the shell
 * calls this before it renders, so nothing has mounted by the time it throws.
 *
 * Ordering is a stable topological sort: the only moves are a dependency stepping ahead
 * of a dependent that was written before it, so a list nobody has dependencies in comes
 * back as the *same array*, which is what keeps `features` a stable memo dependency for
 * every host that never declares one.
 */
export function orderFeatures(
  features: readonly AnyPdfFeature[],
): readonly AnyPdfFeature[] {
  const byId = new Map<string, AnyPdfFeature>();
  for (const feature of features) {
    if (byId.has(feature.id)) {
      throw new PdfError('CONFIGURATION_ERROR', `feature id "${feature.id}" is registered twice; one id cannot hold two features' state`, {
        details: { problem: 'duplicate-id', feature: feature.id },
      });
    }
    byId.set(feature.id, feature);
  }

  for (const feature of features) {
    for (const dependency of feature.dependsOn ?? []) {
      if (byId.has(dependency)) continue;
      throw new PdfError('CONFIGURATION_ERROR', `feature "${feature.id}" depends on "${dependency}", which is not in the list`, {
        details: { problem: 'missing-dependency', feature: feature.id, dependency },
      });
    }
  }

  const ordered: AnyPdfFeature[] = [];
  const emitted = new Set<string>();
  const stack: string[] = [];
  const visiting = new Set<string>();
  const visit = (feature: AnyPdfFeature): void => {
    if (emitted.has(feature.id)) return;
    if (visiting.has(feature.id)) {
      const cycle = [...stack.slice(stack.indexOf(feature.id)), feature.id];
      throw new PdfError('CONFIGURATION_ERROR', `features ${cycle.map((id) => `"${id}"`).join(' → ')} form a dependency cycle, which cannot be initialised`, {
        details: { problem: 'dependency-cycle', feature: feature.id, cycle },
      });
    }
    visiting.add(feature.id);
    stack.push(feature.id);
    for (const dependency of feature.dependsOn ?? []) visit(byId.get(dependency)!);
    stack.pop();
    visiting.delete(feature.id);
    emitted.add(feature.id);
    ordered.push(feature);
  };
  for (const feature of features) visit(feature);

  return features.some((feature) => feature.dependsOn?.length) ? ordered : features;
}

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

/** Merges each mounted feature's page contributions in registration order, last one winning. */
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
 * The built-in control ids the mounted features take over, deduplicated.
 *
 * Reading it from the list rather than from each feature's own control means the
 * shell never has to know what a feature imports: `annotate` says `draw`, and the
 * shell hides it.
 */
export function replacedControlIds(features: readonly AnyPdfFeature[]): string[] {
  const ids = features.flatMap((feature) => feature.replaces ?? []);
  return ids.length ? [...new Set(ids)] : ids;
}

/**
 * The first feature binding that claims this chord.
 *
 * Registration order decides the winner, so an earlier feature keeps a chord and a later one
 * asking for the same key is never reached: taking a chord away from a mounted feature means
 * being placed before it. `orderFeatures` is what produces that order, which is why a
 * dependency claims its chords ahead of the features that depend on it.
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
