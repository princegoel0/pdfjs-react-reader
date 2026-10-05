import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ComponentType, CSSProperties, DragEvent, KeyboardEvent } from 'react';
import { TouchManager } from 'pdfjs-dist';
import { usePdfDocument } from '../headless/usePdfDocument';
import type { PdfError } from '../lib/errors';
import { toPdfError } from '../lib/errors';
import type { PasswordReason } from '../lib/status';
import { usePdfPageLabels } from '../headless/usePdfPageLabels';
import { usePdfSearch, type PdfFindController } from '../headless/usePdfSearch';
import { usePdfVirtualizer } from '../headless/usePdfVirtualizer';
import { applyRotation, type PageLayout, type ScaleMode } from '../lib/layout';
import { addTwoFingerPan, probeTouchPanning } from '../lib/touch-pan';
import { readCanvasEnvironment, resolveCanvasBudget } from '../lib/canvas';
import type { CanvasBudget } from '../lib/canvas';
import { DEFAULT_LABELS, formatLabel, type PdfViewerLabels } from '../lib/labels';
import {
  findFeatureKey,
  mergeFeaturePageProps,
  NO_FEATURES,
  orderFeatures,
  replacedControlIds,
  type AnyPdfFeature,
  type FeaturePageProps,
  type PdfViewerShell,
} from '../lib/features';
import { withReplacedControls } from '../lib/toolbar';
import { FeaturePart, useFeatureStore } from './FeatureHost';
import type { FeatureStore } from './FeatureHost';
import { useDevicePixelRatio } from './useDevicePixelRatio';
import { useCanvasCeiling } from './useCanvasCeiling';
import type { PdfViewerHandle, PdfViewerProps } from './PdfViewer';
import type { SidebarTab, SidebarTabSpec } from './Sidebar';
import type { ToolbarControls, ToolbarItem } from './Toolbar';
import type { PageMatch } from '../lib/search';
import type { PdfAnnotationState } from '../lib/editing-state';
import {
  enterFullscreen,
  exitFullscreen,
  fullscreenElement,
  fullscreenSupported,
  onFullscreenChange as subscribeFullscreenChange,
} from '../lib/fullscreen';
import { isEditableTarget, pageNavigationKey } from '../lib/keyboard';
import { clampScale, pinchScale, wheelScale, zoomBy } from '../lib/zoom';
import { resolveDestination, type PdfDestinationPosition } from '../lib/outline';
import type { OptionalContentConfigHandle } from '../lib/optional-content';
import { createPdfLinkService } from '../lib/link-service';

const clampPage = (page: number, total: number): number =>
  Math.min(Math.max(1, Math.round(page)), Math.max(1, total));

const normalizeRotation = (degrees: number): number => ((degrees % 360) + 360) % 360;

/**
 * Calls `fire` on every change to `value` except the first observed one.
 *
 * The viewer's change events describe what the user did, so firing them during
 * mount would report a fit-mode resolve nobody asked for and would surprise any
 * consumer that sets state from them. The comparison is against a ref seeded at
 * first render rather than a "primed" flag set in the effect, because React's
 * StrictMode runs every effect twice on mount and a flag would fire on the
 * second pass. `fire` lives in a ref, so an inline arrow from the host cannot
 * re-run the effect and loop.
 */
function useChangeSignal<T>(value: T, fire: (value: T) => void): void {
  const lastReported = useRef(value);
  const fireRef = useRef(fire);
  fireRef.current = fire;
  useEffect(() => {
    if (Object.is(lastReported.current, value)) return;
    lastReported.current = value;
    fireRef.current(value);
  }, [value]);
}

/**
 * Everything the viewer shell knows and does, in one object.
 *
 * `PdfViewer` is this hook plus a layout. The split is what lets a host arrange
 * the same parts without re-implementing the wiring — see `ViewerLayout` for the
 * default arrangement, which consumes exactly these members and nothing else.
 */
export interface ViewerController {
  // ---- the document --------------------------------------------------------
  doc: ReturnType<typeof usePdfDocument>['doc'];
  /** The §3.5 lifecycle, so a host writing its own page region branches on one value. */
  status: ReturnType<typeof usePdfDocument>['status'];
  numPages: number;
  isReady: boolean;
  error: PdfError | null;
  reload: (src?: PdfViewerProps['src']) => void;
  /** Show different bytes in place of the document on screen; see `PdfViewerShell`. */
  replaceDocument: (bytes: Uint8Array, name?: string) => void;

  // ---- geometry ------------------------------------------------------------
  /** The scrollable viewport element; also where wheel, pinch and click live. */
  containerRef: ReturnType<typeof usePdfVirtualizer>['containerRef'];
  virtualSlots: ReturnType<typeof usePdfVirtualizer>['virtualSlots'];
  totalHeight: number;
  currentPage: number;
  /**
   * What the pages are called, when the document labels them at all (FR-12). `null` for the ordinary case;
   * `formatPageLabel(pageLabels, currentPage - 1)` is the name to show, whatever a host-written layout
   * decides to do with it.
   */
  pageLabels: readonly string[] | null;
  resolvedScale: number;
  scaleMode: ScaleMode;
  setScaleMode: (mode: ScaleMode) => void;
  rotation: number;
  pageLayout: PageLayout;
  setPageLayout: (layout: PageLayout) => void;
  pageRotations: Record<number, number>;
  gap: number;
  devicePixelRatio?: number;
  renderPixels: number;
  /**
   * §6.1's combination rule as it resolved for this viewer: the effective ceiling, which of
   * the four candidates set it, and what each of the others asked for.
   *
   * Published because "this page is blurry" is only actionable if a host can tell a cap from a
   * bug — a `capped` scale with `applied: 'viewport'` is the shell behaving as designed, and
   * with `applied: 'host'` it is the application's own number.
   */
  renderBudget: CanvasBudget;
  maxRowWidth: number;
  scrollToPage: ReturnType<typeof usePdfVirtualizer>['scrollToPage'];
  reportPageDims: ReturnType<typeof usePdfVirtualizer>['reportPageDims'];
  linkService: ReturnType<typeof createPdfLinkService>;

  // ---- search --------------------------------------------------------------
  search: PdfFindController;
  searchOpen: boolean;
  setSearchOpen: (open: boolean) => void;
  matchesByPage: Map<number, PageMatch[]>;
  activeLocalByPage: Map<number, number>;
  navigateToActiveAt: number;

  // ---- chrome --------------------------------------------------------------
  sidebarOpen: boolean;
  setSidebarOpen: (open: boolean) => void;
  sidebarTab: SidebarTab;
  setSidebarTab: (tab: SidebarTab) => void;
  /** Bumped to redraw pages whose input did not change — see `repaint`. */
  contentVersion: number;
  repaint: () => void;
  /** The one layer config this viewer renders and mutates, or null before it resolves. */
  optionalContentConfig: OptionalContentConfigHandle | null;
  isFullscreen: boolean;
  fsAvailable: boolean;
  toggleFullscreen: () => void;
  rotate: (delta: number) => void;
  rotatePage: (page: number, degrees: number) => void;
  docLabel: string | undefined;
  zoomLabel: string;
  labels: PdfViewerLabels;

  // ---- features ------------------------------------------------------------
  /**
   * The host's feature list as the shell registered it: validated, and with every
   * dependency before its dependents. A host writing their own layout mounts these in
   * this order, so their Runners initialise the same way the shell's do.
   */
  features: readonly AnyPdfFeature[];
  store: FeatureStore;
  shellApi: PdfViewerShell;
  pageProps: FeaturePageProps;
  featureItems: ToolbarItem[];
  /** The host's own say over those items: hide, re-order, add. */
  controls: ToolbarControls | undefined;
  featurePanels: SidebarTabSpec[];
  activePanelFeature: AnyPdfFeature | undefined;
  ActivePanel: ComponentType | undefined;

  // ---- encrypted documents -------------------------------------------------
  /** Why `status` is `password-required`, or null when it is not — read off the load, not stored twice. */
  passwordPrompt: PasswordReason | null;
  submitPassword: (password: string | Error) => void;

  // ---- the root element ----------------------------------------------------
  rootRef: { current: HTMLDivElement | null };
  rootClassName: string;
  rootStyle?: CSSProperties;
  dragOver: boolean;
  onKeyDown: (event: KeyboardEvent<HTMLDivElement>) => void;
  onDragOver: (event: DragEvent<HTMLDivElement>) => void;
  onDragLeave: (event: DragEvent<HTMLDivElement>) => void;
  onDrop: (event: DragEvent<HTMLDivElement>) => void;

  // ---- errors --------------------------------------------------------------
  handlePageError: (error: PdfError) => void;
  /** How many times each 1-based page has been re-queued, and the one function that raises it. */
  pageRetries: Record<number, number>;
  retryPage: (page: number) => void;

  /** The same surface `PdfViewer` exposes through a ref. */
  handle: PdfViewerHandle;
}

/** Owns the shell's state, effects and handlers. Renders nothing. */
export function useViewerController({
  src,
  workerSrc,
  assetUrl,
  allowedSources,
  httpHeaders,
  withCredentials,
  rangeChunkSize,
  disableRange,
  disableStream,
  retry,
  onRetryAttempt,
  onProgress,
  signal,
  enableXfa,
  defaultScale = 'fit-width',
  gap = 16,
  defaultRotation = 0,
  defaultLayout = 'continuous',
  defaultSidebarOpen = false,
  features = NO_FEATURES,
  devicePixelRatio,
  maxRenderPixels,
  capAreaFactor,
  className,
  style,
  onPasswordRequired,
  onError,
  labels,
  onPageChange,
  onScaleChange,
  onLayoutChange,
  onCapabilities,
  onFullscreenChange,
  onAnnotationChange,
  onExternalLink,
  enableWheelZoom = true,
  enablePinchZoom = true,
  enableFullscreen = true,
  enableKeyboardNavigation = true,
  enableDrop = false,
  acceptDrop,
  onDropFile,
  defaultPageRotations,
  controls,
  find,
}: PdfViewerProps): ViewerController {
  // Memoised on identity of the override object: an inline literal from the
  // consumer would otherwise give the context a new value every render and
  // re-render every consumer of it, including each page.
  const resolvedLabels = useMemo(() => ({ ...DEFAULT_LABELS, ...labels }), [labels]);
  /*
   * The canvas ceiling moves with the display, because the budget is the screen's own pixel count scaled by
   * the density: a window going from 1× to 2× can afford four times the pixels, and a stale ceiling would
   * clamp pages the new display could have painted crisply. `0.3` read this once on purpose — a hot-plug
   * should not re-render every visible page — and `FR-07`'s rewritten clause made re-rendering them the
   * point. Keyed on the live ratio rather than read per render, so the shell holds one number and a `resize`
   * that changed nothing repaints nothing; a screen that changes size while keeping its density still
   * matches the `0.3` reading, and stays as it was.
   */
  const pixelRatio = useDevicePixelRatio();
  /*
   * FR-57 / §6.1: the effective canvas ceiling is the **minimum** of the package default, the
   * viewport working set, the probed platform ceiling and the host's own budget, so a host
   * value *constrains* the renderer rather than replacing it. Reading `maxRenderPixels ?? auto`
   * instead — which is what this line used to be — let `renderPixels: 200_000_000` raise the
   * ceiling on a device whose real limit is a fifth of that, which is the one thing a safety
   * budget must never do. `capAreaFactor` is §6.1's other host input and is clamped the same way:
   * it may lower the working set, and `renderBudget.capAreaFactor` reports the number that was
   * actually used.
   */
  const canvasEnv = useMemo(() => readCanvasEnvironment(), [pixelRatio]);
  const platformCeiling = useCanvasCeiling(canvasEnv, capAreaFactor);
  const renderBudget = useMemo(
    () =>
      resolveCanvasBudget({
        env: canvasEnv,
        hostPixels: maxRenderPixels,
        platformPixels: platformCeiling,
        capAreaFactor,
      }),
    [canvasEnv, maxRenderPixels, platformCeiling, capAreaFactor],
  );
  const renderPixels = renderBudget.maxPixels;
  const [scaleMode, setScaleMode] = useState<ScaleMode>(defaultScale);
  const [searchOpen, setSearchOpen] = useState(false);
  const [rotation, setRotation] = useState(defaultRotation);
  const [pageLayout, setPageLayout] = useState<PageLayout>(defaultLayout);
  const [sidebarOpen, setSidebarOpen] = useState(defaultSidebarOpen);
  const [sidebarTab, setSidebarTab] = useState<SidebarTab>('thumbnails');
  // Bumped to redraw every page without changing any input that would otherwise
  // rebuild it. Three things need it: a layer switched in the sidebar, a
  // `SetOCGState` action fired by an annotation — both change what the engine
  // paints while leaving the viewport, the scale and the document identical — and
  // the canvas probe answering below the ceiling pages were already painted under.
  const [contentVersion, setContentVersion] = useState(0);
  const repaint = useCallback(() => setContentVersion((version) => version + 1), []);
  /*
   * FR-57: the probe runs after the first paint, so the first pass is always under the assumed
   * ceiling. When the measured one turns out to be lower, the pages on screen are holding
   * buffers the platform may never have allocated — a blank page with a live text layer over it,
   * which is the exact failure the ceiling exists to prevent. Repaint on the way down only: the
   * probe answers once per realm, so there is nothing here to oscillate.
   */
  const appliedCeiling = useRef(renderPixels);
  useEffect(() => {
    const previous = appliedCeiling.current;
    appliedCeiling.current = renderPixels;
    if (renderPixels < previous) repaint();
  }, [renderPixels, repaint]);
  // One `OptionalContentConfig` per document, shared by the layers panel, the
  // `SetOCGState` annotation handler and every page render. It has to be one object:
  // pdf.js rebuilds a fresh config from cached worker data on each
  // `getOptionalContentConfig()` call, and `render()` does the same when it is not
  // given one, so a mutation anywhere else is invisible to the page it was meant for.
  const [optionalContentConfig, setOptionalContentConfig] =
    useState<OptionalContentConfigHandle | null>(null);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [pageRotations, setPageRotations] = useState<Record<number, number>>(
    () => defaultPageRotations ?? {},
  );
  const [droppedFile, setDroppedFile] = useState<File | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [editedFile, setEditedFile] = useState<File | null>(null);

  /*
   * A dropped or an edited document is an override, not a new prop: the host's `src` still
   * wins the moment it changes, so an app navigating elsewhere is never stuck showing a file
   * the user dragged in — or a page order a feature wrote — earlier. An edit outranks a drop
   * because it is made against what is on screen, and both are cleared by anything that
   * replaces the document outright.
   */
  const effectiveSrc = editedFile ?? droppedFile ?? src;

  useEffect(() => {
    setDroppedFile(null);
    setDragOver(false);
    setEditedFile(null);
  }, [src]);

  const {
    doc,
    status,
    numPages,
    isReady,
    error,
    capabilities,
    passwordRequest,
    reload,
  } = usePdfDocument({
    src: effectiveSrc,
    workerSrc,
    assetUrl,
    allowedSources,
    httpHeaders,
    withCredentials,
    rangeChunkSize,
    disableRange,
    disableStream,
    retry,
    onRetryAttempt,
    onProgress,
    signal,
    enableXfa,
    onPasswordRequired,
  });

  /*
   * The prompt the shell paints is the load's own state, not a copy of it: `passwordRequest` is non-null
   * exactly while `status` is `password-required`, so a wrong password that asks again re-prompts without
   * anything here remembering that it asked, and a resolved or rejected load ends the prompt by ceasing to
   * be one. The built-in dialog stands down when the host renders its own, so an encrypted document never
   * ends up with two prompts competing for the same page area.
   */
  const passwordPrompt = onPasswordRequired ? null : (passwordRequest?.reason ?? null);

  // `usePdfDocument` deliberately ignores prop changes — tracking them would
  // restart the load whenever a consumer passes an inline `{ data }` object —
  // so the shell asks for the reload itself when the source really does change,
  // whether that is the host's `src` or a dropped file.
  useChangeSignal(effectiveSrc, () => reload());

  // `onError` lives in a ref: consumers pass inline arrows, and a changing
  // identity here would re-run every page's text/annotation effects (pdf.js
  // rebuilds those layers by clearing their container, so the document would
  // visibly flash and lose selection on each parent re-render).
  const onErrorRef = useRef(onError);
  onErrorRef.current = onError;
  const handlePageError = useCallback((err: PdfError) => {
    onErrorRef.current?.(err);
  }, []);

  /*
   * FR-37's re-queue, published. A page that reached `error` has no other way back: its row stays mounted,
   * the virtualizer keeps asking for it, and none of the dependencies a repaint would need — scale,
   * rotation, which page is open — are things a reader should disturb to get one page painted again. So the
   * shell keeps one counter per 1-based page and `PdfPage` treats a change as "start this page again".
   * Monotonic rather than a boolean because a page can fail twice, and the second retry must also be a
   * change. That is FR-54's "retry and requeue transitions are deterministic" stated as state.
   */
  const [pageRetries, setPageRetries] = useState<Record<number, number>>({});
  const retryPage = useCallback((page: number) => {
    setPageRetries((current) => ({ ...current, [page]: (current[page] ?? 0) + 1 }));
  }, []);

  // Same treatment for the annotation state: a host's inline arrow must not give the
  // shell a new identity, because every feature that depends on the shell object would
  // re-run on each parent render. The engine already reports a difference only when
  // one exists, so this forwards rather than diffing a second time.
  const onAnnotationChangeRef = useRef(onAnnotationChange);
  onAnnotationChangeRef.current = onAnnotationChange;
  const handleAnnotationChange = useCallback((state: PdfAnnotationState) => {
    onAnnotationChangeRef.current?.(state);
  }, []);

  const {
    containerRef,
    virtualSlots,
    totalHeight,
    currentPage,
    pageEstimate,
    resolvedScale,
    scrollToPage,
    reportPageDims,
  } = usePdfVirtualizer({
    doc,
    numPages,
    scale: scaleMode,
    gap,
    rotation,
    pageRotations,
    layout: pageLayout,
  });

  /*
   * After the virtualizer, because FR-39 wants to know where the reader is: indexing starts on the page
   * in view and walks outward, so the first answer comes from the part of the document they can see.
   * `focusPage` is read when a search starts and never watched — a search that restarted on every scroll
   * would never finish on the documents this is for.
   *
   * Always called, even when a host supplies its own: hooks cannot be conditional,
   * and an unused built-in stays idle because nothing here calls its `search`.
   */
  const builtInSearch = usePdfSearch({
    doc,
    onError: handlePageError,
    focusPage: currentPage - 1,
  });
  const search = find ?? builtInSearch;

  const matchesByPage = useMemo(() => {
    const map = new Map<number, PageMatch[]>();
    for (const match of search.results) {
      const list = map.get(match.pageIndex);
      if (list) list.push(match);
      else map.set(match.pageIndex, [match]);
    }
    return map;
  }, [search.results]);

  const activeLocalByPage = useMemo(() => {
    const map = new Map<number, number>();
    const { results, activeIndex } = search;
    if (activeIndex < 0) return map;
    const activePage = results[activeIndex]?.pageIndex;
    if (activePage === undefined) return map;
    let local = 0;
    for (let i = 0; i < activeIndex; i++) {
      if (results[i]!.pageIndex === activePage) local++;
    }
    map.set(activePage, local);
    return map;
  }, [search.results, search.activeIndex]);

  // Scroll the active match's page into view, then let the page center the
  // mark itself (pages may still be virtualized away at this point).
  const [navigateToActiveAt, setNavigateToActiveAt] = useState(0);
  const scrollToPageRef = useRef(scrollToPage);
  scrollToPageRef.current = scrollToPage;
  useEffect(() => {
    if (search.activeIndex < 0) return;
    const match = search.results[search.activeIndex];
    if (!match) return;
    scrollToPageRef.current(match.pageIndex + 1);
    setNavigateToActiveAt(Date.now());
  }, [search.activeSeq, search.activeIndex, search.results]);

  // ---- page labels ---------------------------------------------------------
  /*
   * Read through the hook rather than here, because a host writing their own page box needs the same table
   * and the same cancellation, and the shell is the demonstration consumer — one round trip per document,
   * republished when the bytes on screen change.
   */
  const pageLabels = usePdfPageLabels(doc, signal);

  // ---- features ------------------------------------------------------------
  // Human-readable document name. `File` carries a name; a bare Blob or data URL
  // does not, so those simply omit the label. Features see it too, which is how
  // a save gets named after the file the reader is looking at.
  const docLabel = useMemo(() => {
    if (typeof effectiveSrc === 'string') {
      try {
        const url = new URL(effectiveSrc, window.location.href);
        const last = url.pathname.split('/').filter(Boolean).pop();
        return last ? decodeURIComponent(last).replace(/\.pdf$/i, '') : url.hostname;
      } catch {
        return undefined;
      }
    }
    const name = (effectiveSrc as Blob & { name?: string }).name;
    return name ? name.replace(/\.pdf$/i, '') : undefined;
  }, [effectiveSrc]);

  /*
   * Put different bytes on screen in place of the current document.
   *
   * This is the seam a document-writing feature needs: reordering pages produces a new file,
   * and the only way to show it is to load it. A bare `Uint8Array` has no name, so the label
   * is carried across here — otherwise a reader who reorganises the pages finds that the
   * download control has forgotten what the file was called.
   *
   * Per-page rotations are cleared by the swap because a caller that rewrites the document has
   * written them into it, and the page would otherwise be turned twice.
   */
  const replaceDocument = useCallback(
    (bytes: Uint8Array, name?: string) => {
      const label = name ?? docLabel;
      // Copied, because the caller's view may sit inside a larger buffer it still owns, and
      // the document about to be loaded should not alias it.
      const owned = new Uint8Array(bytes.byteLength);
      owned.set(bytes);
      setEditedFile(
        new File([owned], label ? `${label}.pdf` : 'document.pdf', { type: 'application/pdf' }),
      );
      setPageRotations({});
    },
    [docLabel],
  );

  // Declared below the shell object with the rest of the destination code; the shell reaches it the way the
  // handle reaches `rotatePage`, through a ref, so the memo can name it before it exists.
  const followDestinationRef = useRef<(pageNumber: number, position: PdfDestinationPosition | null) => void>(
    () => {},
  );

  const shellApi = useMemo<PdfViewerShell>(
    () => ({
      doc,
      numPages,
      currentPage,
      scale: resolvedScale,
      scaleMode,
      rotation,
      pageRotations,
      documentLabel: docLabel,
      replaceDocument,
      labels: resolvedLabels,
      labelsOverride: labels,
      scrollToPage,
      followDestination: (pageNumber, position) =>
        followDestinationRef.current(pageNumber - 1, position),
      setScaleMode,
      setLayout: setPageLayout,
      // Read through the ref: `rotatePage` is declared below the shell object, and calling
      // through the ref is how the handle already reaches it.
      rotatePage: (page, degrees) => rotatePageRef.current(page, degrees),
      reportError: handlePageError,
      reportAnnotationChange: handleAnnotationChange,
      repaint,
      contentVersion,
      optionalContentConfig,
      // The ref, not the node: features read it inside effects, which run after the
      // root exists, and a node here would change identity on mount and re-run
      // everything that depends on the shell.
      rootRef,
      openSidebar: (open, tab) => {
        setSidebarOpen(open);
        if (tab) setSidebarTab(tab);
      },
    }),
    [
      doc,
      numPages,
      currentPage,
      resolvedScale,
      scaleMode,
      rotation,
      pageRotations,
      docLabel,
      replaceDocument,
      resolvedLabels,
      labels,
      scrollToPage,
      handlePageError,
      handleAnnotationChange,
      repaint,
      contentVersion,
      optionalContentConfig,
    ],
  );

  // The single owner of feature state. Everything below reads through it, and
  // the shell itself imports no feature to do any of it.
  const store = useFeatureStore(shellApi);

  /*
   * FR-21/FR-56: the list the shell registers, which is the host's list validated and put
   * in dependency order. This runs before the first child renders, so a duplicate id, a
   * missing dependency or a cycle throws out of the viewer's own render rather than
   * surfacing later as a control whose state belongs to neither of two features. Every
   * place ordering is observable — Runner mount order, which page contribution wins, which
   * feature claims a chord, the toolbar's fold — reads this one value, so they cannot
   * disagree about what order the host asked for.
   */
  const registeredFeatures = useMemo(() => orderFeatures(features), [features]);

  const pageProps = useMemo(
    () => mergeFeaturePageProps(registeredFeatures, store.get),
    [registeredFeatures, store],
  );

  const featureItems = useMemo<ToolbarItem[]>(() => {
    const items: ToolbarItem[] = [];
    for (const feature of registeredFeatures) {
      const state = store.get(feature.id);
      for (const control of feature.controls ?? []) {
        if (control.available && !control.available(state, shellApi)) continue;
        items.push({
          id: control.id,
          priority: control.priority,
          label: control.label(resolvedLabels, state),
          node: (
            <FeaturePart feature={feature} store={store}>
              <control.render />
            </FeaturePart>
          ),
        });
      }
    }
    return items.sort((a, b) => a.priority - b.priority);
  }, [registeredFeatures, store, shellApi, resolvedLabels]);

  // A feature that supersedes a built-in says so in `replaces`; hiding it here is
  // what lets the shell do that without importing the feature it is hiding.
  const toolbarControls = useMemo(
    () => withReplacedControls(controls, replacedControlIds(registeredFeatures)),
    [controls, registeredFeatures],
  );

  const featurePanels = useMemo<SidebarTabSpec[]>(    () =>
      registeredFeatures
        .filter((feature) => feature.panel)
        .map((feature) => ({
          id: feature.panel!.id,
          label: feature.panel!.label(resolvedLabels, store.get(feature.id)),
        })),
    [registeredFeatures, store, resolvedLabels],
  );

  const activePanel = featurePanels.find((entry) => entry.id === sidebarTab);
  const activePanelFeature = activePanel
    ? registeredFeatures.find((feature) => feature.panel?.id === activePanel.id)
    : undefined;
  const ActivePanel = activePanelFeature?.panel?.render;

  // ---- change events -------------------------------------------------------
  useChangeSignal(currentPage, (page) => onPageChange?.(page));
  useChangeSignal(resolvedScale, (scale) => onScaleChange?.(scale));
  useChangeSignal(pageLayout, (layout) => onLayoutChange?.(layout));
  useChangeSignal(capabilities, (next) => next && onCapabilities?.(next));

  // ---- fullscreen ----------------------------------------------------------
  // Computed in an effect, not during render, so a server render never touches
  // `document`. The control hides itself where element fullscreen is absent.
  const [fsAvailable, setFsAvailable] = useState(false);
  useEffect(() => {
    setFsAvailable(enableFullscreen && fullscreenSupported(rootRef.current));
  }, [enableFullscreen]);

  // State follows the real element rather than our request: the browser may
  // refuse it, or the user may leave with Escape.
  useEffect(() => {
    const sync = () => setIsFullscreen(fullscreenElement() === rootRef.current);
    return subscribeFullscreenChange(sync);
  }, []);
  useChangeSignal(isFullscreen, (active) => onFullscreenChange?.(active));

  const toggleFullscreen = useCallback(() => {
    const el = rootRef.current;
    if (!el) return;
    if (fullscreenElement() === el) {
      void exitFullscreen().catch(() => {});
    } else {
      void enterFullscreen(el).catch(() => {});
    }
  }, []);

  // ---- keyboard ------------------------------------------------------------
  // Ctrl/Cmd+F opens the search bar, Ctrl/Cmd+P the print pipeline, plain F
  // toggles fullscreen, and the paging keys move a page at a time. All of it is
  // scoped to the viewer rather than bound to `window`: an embedded component
  // must not hijack the host app's shortcuts, and two viewers on one page must
  // not both react.
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    // Typing into a field — including an AcroForm widget rendered inside the
    // page — belongs to that field, never to the viewer.
    if (isEditableTarget(event.target)) return;

    // A mounted feature gets the chord first: Ctrl/Cmd+P belongs to print, and
    // print is only here because the application put it here.
    const claimed = findFeatureKey(registeredFeatures, store.get, shellApi, event);
    if (claimed) {
      event.preventDefault();
      claimed.binding.run(store.get(claimed.feature.id), shellApi, event);
      return;
    }

    if (event.ctrlKey || event.metaKey) {
      if (event.key.toLowerCase() === 'f') {
        event.preventDefault();
        setSearchOpen(true);
      }
      return;
    }
    if (event.altKey) return;

    if (event.key.toLowerCase() === 'f' && fsAvailable) {
      event.preventDefault();
      toggleFullscreen();
      return;
    }

    if (!enableKeyboardNavigation) return;

    const move = pageNavigationKey(event);
    if (!move) return;
    event.preventDefault();
    const target =
      move === 'first'
        ? 1
        : move === 'last'
          ? numPages
          : move === 'next'
            ? currentPage + 1
            : currentPage - 1;
    scrollToPage(clampPage(target, numPages));
  };

  // ---- wheel and pinch zoom ------------------------------------------------
  const resolvedScaleRef = useRef(resolvedScale);
  resolvedScaleRef.current = resolvedScale;

  // Registered natively with `passive: false`: React attaches its own `wheel`
  // listener passively, so `preventDefault()` from an `onWheel` prop is a no-op
  // that also logs a warning — the page would scroll while we zoomed.
  //
  // A consumed gesture is prevented but still allowed to bubble. Stopping it would
  // be the starvation FR-47 forbids: a host listening for wheel on an ancestor keeps
  // its listener, and `event.defaultPrevented` is how it learns the viewer took the
  // gesture. That is the arbitration protocol, and it is the DOM's own.
  useEffect(() => {
    const el = containerRef.current;
    if (!el || !enableWheelZoom) return;
    const onWheel = (event: globalThis.WheelEvent) => {
      // Only Ctrl/Cmd+wheel zooms. Plain wheel stays a normal scroll, and
      // browsers report trackpad pinch as a ctrl-keyed wheel anyway.
      if (!(event.ctrlKey || event.metaKey)) return;
      event.preventDefault();
      setScaleMode(wheelScale(resolvedScaleRef.current, event.deltaY));
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [containerRef, enableWheelZoom]);

  // TouchManager's published callbacks are typed as bare `Function`, so the
  // argument shapes below come from reading the engine's call site rather than
  // from the type system, and a pdf.js minor could change them silently. The
  // whole construction is guarded so an incompatible engine loses pinch zoom
  // and nothing else.
  //
  // A pinch and a two-finger pan are one physical event until the span between the
  // fingers changes, and the manager claims the `touchmove` for both: it calls
  // `preventDefault` and `stopPropagation` on the second finger's every move, before
  // it knows which gesture it is holding. So both answers are ours to give — zoom
  // when the span grows, scroll when only the midpoint travels. Without `onPanning`
  // the second one is swallowed on the way in: the gesture reaches us, we do nothing
  // with it, and the browser has been told not to, so the document stops moving
  // halfway through a two-finger scroll.
  //
  // `onPanning` is not in the engine advertised as the floor. Rather than read a version string, the
  // controller asks the installed class whether it reports panning at all (`src/lib/touch-pan.ts`) and, when
  // it does not, pans the container itself. Both halves share the engine's own span tolerance, so a gesture
  // cannot be a pinch for one of them and a pan for the other.
  useEffect(() => {
    const el = containerRef.current;
    if (!el || !enablePinchZoom) return;
    const controller = new AbortController();
    let startScale = 1;
    try {
      // eslint-disable-next-line no-new
      new TouchManager({
        container: el,
        signal: controller.signal,
        onPinchStart: () => {
          startScale = resolvedScaleRef.current;
        },
        onPinching: (
          _midpoint: [number, number],
          previousDistance: number,
          distance: number,
        ) => {
          setScaleMode(pinchScale(startScale, previousDistance, distance));
        },
        onPanning: (dx: number, dy: number) => {
          // Content follows the fingers, so a downward drag reveals what is above it.
          el.scrollLeft -= dx;
          el.scrollTop -= dy;
        },
      });
    } catch {
      // An engine whose constructor this peer range outgrew loses pinch zoom and nothing else. The abort is
      // still returned: the manager may have registered listeners on the container before it threw, and an
      // effect that cleans up nothing leaks them across every remount.
      return () => controller.abort();
    }
    // Only after the manager exists: with none, nothing prevents the browser's own two-finger pan, and a
    // handler of ours on top of it would move the document twice for one drag. A probe that could not ask the
    // engine answers `reportsPanning: true` for the same reason — an unknown engine keeps the browser's own.
    const panning = probeTouchPanning(TouchManager);
    if (!panning.reportsPanning) {
      addTwoFingerPan(el, { signal: controller.signal, spanTolerance: panning.spanTolerance });
    }
    return () => controller.abort();
  }, [containerRef, enablePinchZoom]);

  // ---- external links ------------------------------------------------------
  // Intercepted on click, because the link service's own `onExternalLink` fires
  // while attributes are being applied, i.e. once per link at render time.
  const onExternalLinkRef = useRef(onExternalLink);
  onExternalLinkRef.current = onExternalLink;
  useEffect(() => {
    const el = containerRef.current;
    if (!el || !onExternalLink) return;
    const onClick = (event: globalThis.MouseEvent) => {
      const anchor = (event.target as Element | null)?.closest?.('a');
      if (!anchor) return;
      const href = anchor.getAttribute('href');
      // Internal destinations render as a bare fragment.
      if (!href || href === '#') return;
      event.preventDefault();
      onExternalLinkRef.current?.(href);
    };
    el.addEventListener('click', onClick, true);
    return () => el.removeEventListener('click', onClick, true);
  }, [containerRef, onExternalLink]);

  // ---- per-page rotation ---------------------------------------------------
  const rotatePage = useCallback((page: number, degrees: number) => {
    const index = clampPage(page, Number.MAX_SAFE_INTEGER) - 1;
    setPageRotations((prev) => ({
      ...prev,
      [index]: normalizeRotation((prev[index] ?? 0) + degrees),
    }));
  }, []);

  // ---- drag and drop -------------------------------------------------------
  const onDragOver = (event: DragEvent<HTMLDivElement>) => {
    if (!onDropFile && !enableDrop) return;
    event.preventDefault();
    event.dataTransfer!.dropEffect = 'copy';
    if (!dragOver) setDragOver(true);
  };
  const onDragLeave = (event: DragEvent<HTMLDivElement>) => {
    // Leaving a child bubbles as a leave of the viewer; ignore those.
    if (event.currentTarget.contains(event.relatedTarget as Node | null)) return;
    setDragOver(false);
  };
  const onDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setDragOver(false);
    const file = event.dataTransfer?.files?.[0];
    if (!file) return;
    const accepted = acceptDrop
      ? acceptDrop(file)
      : file.type === 'application/pdf' || /\.pdf$/i.test(file.name);
    if (!accepted) return;
    onDropFile?.(file);
    if (enableDrop) {
      setDroppedFile(file);
      // The edit belonged to the document this drop replaces.
      setEditedFile(null);
    }
  };

  const docRef = useRef(doc);
  docRef.current = doc;

  // ---- destinations: a click lands on a page *and* at a place ----
  const rotationRef = useRef(rotation);
  rotationRef.current = rotation;
  const pageRotationsRef = useRef(pageRotations);
  pageRotationsRef.current = pageRotations;

  /**
   * The destination whose scroll is waiting for its own zoom to land.
   *
   * A `/XYZ` that names a magnification has to change the scale *first*, because its point is a distance down
   * the page as displayed: scroll to the offset measured at the old scale and the heading the author aimed at
   * arrives somewhere else in the page once the new one paints. So such a click parks its place here, and the
   * effect below follows it the render after `resolvedScale` moves.
   */
  const pendingDestination = useRef<{ pageIndex: number; position: PdfDestinationPosition } | null>(null);

  /** Scroll so the place a destination names meets the top of the viewport. */
  const scrollToPlace = useCallback(async (pageIndex: number, position: PdfDestinationPosition) => {
    const current = docRef.current;
    const page = current ? await current.getPage(pageIndex + 1).catch(() => null) : null;
    if (!page || position.top === null) {
      // No proxy to ask, or a destination that names no vertical place: the top of the page — which is also
      // what a bare `/Fit` asks for, and what every outline click did before the place was carried at all.
      scrollToPageRef.current(pageIndex + 1);
      return;
    }
    // The engine's own viewport is the only thing here that knows how a rotated page maps its user space onto
    // the box the reader sees: `convertToViewportPoint` answers with y measured down from that box's top edge
    // and already multiplied by the scale, which is exactly the offset `scrollToPage` takes.
    const viewport = page.getViewport({
      scale: resolvedScaleRef.current,
      rotation: (page.rotate + rotationRef.current + (pageRotationsRef.current[pageIndex] ?? 0)) % 360,
    });
    const [, y] = viewport.convertToViewportPoint(position.left ?? 0, position.top);
    scrollToPageRef.current(pageIndex + 1, 'auto', Math.max(0, Math.round(y)));
  }, []);

  /** Follow a resolved destination: the zoom it asks for if it asks for one, then the place. */
  const followDestination = useCallback(
    (pageIndex: number, position: PdfDestinationPosition | null) => {
      const zoom = position?.zoom ?? null;
      if (position && zoom !== null && Math.abs(zoom - resolvedScaleRef.current) > 1e-3) {
        pendingDestination.current = { pageIndex, position };
        setScaleMode(clampScale(zoom));
        return;
      }
      void scrollToPlace(
        pageIndex,
        position ?? { kind: 'Unknown', left: null, top: null, zoom: null },
      );
    },
    [scrollToPlace],
  );
  followDestinationRef.current = followDestination;

  useEffect(() => {
    const pending = pendingDestination.current;
    if (!pending) return;
    pendingDestination.current = null;
    void scrollToPlace(pending.pageIndex, pending.position);
  }, [resolvedScale, scrollToPlace]);

  // Resolve the document's one shared layer config. Fetched per document, kept in
  // state so pages re-render with it, and mirrored into a ref so the link service —
  // which is stable across renders — can mutate the same object the pages read.
  const optionalContentRef = useRef<OptionalContentConfigHandle | null>(null);
  useEffect(() => {
    optionalContentRef.current = null;
    setOptionalContentConfig(null);
    if (!doc) return;
    let cancelled = false;
    doc
      .getOptionalContentConfig()
      .then((config) => {
        if (cancelled) return;
        const handle = config as unknown as OptionalContentConfigHandle;
        optionalContentRef.current = handle;
        setOptionalContentConfig(handle);
      })
      .catch(() => {
        // No layers is the ordinary case. A document whose OCProperties cannot be
        // parsed renders with pdf.js's own defaults, which is what a reader expects
        // from a viewer that never mentions layers.
      });
    return () => {
      cancelled = true;
    };
  }, [doc]);

  // Stable per document: a new identity would re-render every page's
  // annotation layer, so navigation goes through refs.
  //
  // The link service also accepts an `onExternalLink`, deliberately unused
  // here: it fires from `addLinkAttributes`, i.e. once per link as pages
  // render, not when a link is clicked. Exposing it under that name would give
  // consumers a prop whose click semantics it does not have — external clicks
  // are intercepted on the viewport instead.
  const linkService = useMemo(
    () =>
      createPdfLinkService({
        baseUrl: typeof effectiveSrc === 'string' ? effectiveSrc : undefined,
        onDestination: async (dest) => {
          const current = docRef.current;
          if (!current) return;
          let target = dest;
          if (typeof target === 'string') {
            try {
              target = await current.getDestination(target);
            } catch {
              return;
            }
          }
          // One resolver for a bookmark and an in-page link, because a `/Dest` does not care which of the two
          // carried it: both name a page *and* a place, and the second half used to be thrown away here too.
          const found = await resolveDestination(current, target);
          if (found) followDestination(found.pageIndex, found.position);
        },
        onSetOCGState: (action) => {
          // Mutate the shared config, then ask for a redraw. Fetching a config here
          // would be the bug: pdf.js builds a new object per call, so the action
          // would land on an instance no page ever renders with, and the link would
          // highlight, repaint from something else, and change nothing.
          const config = optionalContentRef.current;
          if (!config) return;
          try {
            config.setOCGState({ state: [...action.state], preserveRB: action.preserveRB });
          } catch (reason) {
            handlePageError(toPdfError(reason));
            return;
          }
          repaint();
        },
        getAttachmentContent: async (id) => {
          const current = docRef.current as unknown as {
            getAttachmentContent?: (attachmentId: string) => Promise<Uint8Array | null>;
          } | null;
          // pdf.js 5.x has no such method — it ships the bytes with the attachment
          // list instead — so an older engine reads as "nothing to fetch" rather
          // than throwing inside pdf.js's click handler.
          if (typeof current?.getAttachmentContent !== 'function') return null;
          return (await current.getAttachmentContent(id)) ?? null;
        },
      }),
    [doc, effectiveSrc, repaint, handlePageError],
  );

  const rotate = useCallback((delta: number) => {
    setRotation((r) => normalizeRotation(r + delta));
  }, []);

  // Ensure zoomed-in rows wider than the viewport stay reachable via
  // horizontal scrolling.
  const maxRowWidth = useMemo(() => {
    let max = applyRotation(pageEstimate, rotation).width * resolvedScale;
    for (const slot of virtualSlots) max = Math.max(max, slot.width);
    return max;
  }, [virtualSlots, pageEstimate, rotation, resolvedScale]);

  // ---- imperative handle ---------------------------------------------------
  // Every member reads through a ref, so the object is created once and a
  // consumer's effects that depend on the handle never re-run on each render.
  const numPagesRef = useRef(numPages);
  numPagesRef.current = numPages;
  const searchRef = useRef(search);
  searchRef.current = search;
  const rotatePageRef = useRef(rotatePage);
  rotatePageRef.current = rotatePage;
  const fullscreenRef = useRef(toggleFullscreen);
  fullscreenRef.current = toggleFullscreen;

  const handle = useMemo<PdfViewerHandle>(
    () => ({
      goToPage: (page) => scrollToPageRef.current(clampPage(page, numPagesRef.current)),
      zoomTo: (scale) => setScaleMode(clampScale(scale)),
      zoomBy: (factor) => setScaleMode(zoomBy(resolvedScaleRef.current, factor)),
      fitTo: (mode) =>
        setScaleMode(
          mode === 'width' ? 'fit-width' : mode === 'page' ? 'fit-page' : 'automatic',
        ),
      setLayout: (layout) => setPageLayout(layout),
      rotate: (degrees) => setRotation((r) => normalizeRotation(r + degrees)),
      rotatePage: (page, degrees) => rotatePageRef.current(page, degrees),
      retryPage,
      openSidebar: (open, tab) => {
        setSidebarOpen(open);
        if (tab) setSidebarTab(tab);
      },
      toggleFullscreen: () => fullscreenRef.current(),
      search: (query, options) => {
        setSearchOpen(true);
        searchRef.current.search(query, options);
      },
      /*
       * FR-39: "Invalidation is per page and is offered to the host." The hook has had the call since
       * `0.11` and the shell has not, which left a host that composes `PdfViewer` — rather than
       * `usePdfSearch` — with no way to say a page is no longer what was indexed. Converted here,
       * because every page this handle names is 1-based and the index's pages are not.
       *
       * Optional on a host-written controller: a find strategy that keeps its own index has nothing
       * in ours to drop, so the call is answered rather than failing.
       */
      invalidatePages: (pages) => {
        if (!pages.length) return;
        searchRef.current.invalidatePages?.(pages.map((page) => page - 1));
      },
    }),
    // Every setter above is stable: the state functions are `useState` setters, and `retryPage` is a
    // `useCallback` with no dependencies, so the handle keeps one identity for the life of the viewer.
    [retryPage],
  );

  // Answers the engine's request through the load's own submit, which puts the document back to `loading`.
  // A cancel submits an `Error`, which is how a dismissed prompt fails the load instead of hanging it.
  const submitPassword = (password: string | Error) => passwordRequest?.submit(password);

  return {
    doc,
    status,
    numPages,
    isReady,
    error,
    reload,
    replaceDocument,
    containerRef,
    virtualSlots,
    totalHeight,
    currentPage,
    pageLabels,
    resolvedScale,
    scaleMode,
    setScaleMode,
    rotation,
    pageLayout,
    setPageLayout,
    pageRotations,
    gap,
    devicePixelRatio,
    renderPixels,
    renderBudget,
    maxRowWidth,
    scrollToPage,
    reportPageDims,
    linkService,
    search,
    searchOpen,
    setSearchOpen,
    matchesByPage,
    activeLocalByPage,
    navigateToActiveAt,
    sidebarOpen,
    setSidebarOpen,
    sidebarTab,
    setSidebarTab,
    contentVersion,
    repaint,
    optionalContentConfig,
    isFullscreen,
    fsAvailable,
    toggleFullscreen,
    rotate,
    rotatePage,
    docLabel,
    zoomLabel: formatLabel(resolvedLabels.zoomPercent, {
      percent: Math.round(resolvedScale * 100),
    }),
    labels: resolvedLabels,
    features: registeredFeatures,
    store,
    shellApi,
    pageProps,
    featureItems,
    controls: toolbarControls,
    featurePanels,
    activePanelFeature,
    ActivePanel,
    passwordPrompt,
    submitPassword,
    rootRef,
    rootClassName: className
      ? `pjsr-viewer ${dragOver ? 'pjsr-viewer--dragover ' : ''}${className}`
      : `pjsr-viewer${dragOver ? 'pjsr-viewer--dragover' : ''}`,
    rootStyle: style,
    dragOver,
    onKeyDown,
    onDragOver,
    onDragLeave,
    onDrop,
    handlePageError,
    pageRetries,
    retryPage,
    handle,
  };
}
