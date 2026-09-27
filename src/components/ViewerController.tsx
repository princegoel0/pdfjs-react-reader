import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ComponentType, CSSProperties, DragEvent, KeyboardEvent } from 'react';
import { TouchManager } from 'pdfjs-dist';
import { usePdfDocument } from '../headless/usePdfDocument';
import type { PasswordReason, PasswordSubmit } from '../headless/usePdfDocument';
import { usePdfInk } from '../headless/usePdfInk';
import { usePdfSearch } from '../headless/usePdfSearch';
import { usePdfVirtualizer } from '../headless/usePdfVirtualizer';
import { applyRotation, type PageLayout, type ScaleMode } from '../lib/layout';
import { maxRenderPixelsFor, readCanvasEnvironment } from '../lib/canvas';
import { DEFAULT_LABELS, formatLabel, type PdfViewerLabels } from '../lib/labels';
import {
  findFeatureKey,
  mergeFeaturePageProps,
  NO_FEATURES,
  replacedControlIds,
  type AnyPdfFeature,
  type FeaturePageProps,
  type PdfViewerShell,
} from '../lib/features';
import { withReplacedControls } from '../lib/toolbar';
import { FeaturePart, useFeatureStore } from './FeatureHost';
import type { FeatureStore } from './FeatureHost';
import type { PdfViewerHandle, PdfViewerProps } from './PdfViewer';
import type { SidebarTab, SidebarTabSpec } from './Sidebar';
import type { ToolbarControls, ToolbarItem } from './Toolbar';
import type { PageMatch } from '../lib/search';
import type { PdfAnnotationState } from '../lib/editing-state';
import type { PdfPoint } from '../lib/ink';
import {
  enterFullscreen,
  exitFullscreen,
  fullscreenElement,
  fullscreenSupported,
  onFullscreenChange as subscribeFullscreenChange,
} from '../lib/fullscreen';
import { isEditableTarget, pageNavigationKey } from '../lib/keyboard';
import { clampScale, pinchScale, wheelScale, zoomBy } from '../lib/zoom';
import { resolveDestinationPageIndex } from '../lib/outline';
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
  numPages: number;
  isReady: boolean;
  error: Error | null;
  reload: (src?: PdfViewerProps['src']) => void;
  /** Show different bytes in place of the document on screen; see `PdfViewerShell`. */
  replaceDocument: (bytes: Uint8Array, name?: string) => void;

  // ---- geometry ------------------------------------------------------------
  /** The scrollable viewport element; also where wheel, pinch and click live. */
  containerRef: ReturnType<typeof usePdfVirtualizer>['containerRef'];
  virtualSlots: ReturnType<typeof usePdfVirtualizer>['virtualSlots'];
  totalHeight: number;
  currentPage: number;
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
  maxRowWidth: number;
  scrollToPage: ReturnType<typeof usePdfVirtualizer>['scrollToPage'];
  reportPageDims: ReturnType<typeof usePdfVirtualizer>['reportPageDims'];
  linkService: ReturnType<typeof createPdfLinkService>;

  // ---- search --------------------------------------------------------------
  search: ReturnType<typeof usePdfSearch>;
  searchOpen: boolean;
  setSearchOpen: (open: boolean) => void;
  matchesByPage: Map<number, PageMatch[]>;
  activeLocalByPage: Map<number, number>;
  navigateToActiveAt: number;

  // ---- ink -----------------------------------------------------------------
  ink: ReturnType<typeof usePdfInk>;
  /** Stable per page, because `PdfPage` is memoised. */
  commitFor: (index: number) => (points: PdfPoint[]) => void;

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
  handlePageError: (error: Error) => void;

  /** The same surface `PdfViewer` exposes through a ref. */
  handle: PdfViewerHandle;
}

/** Owns the shell's state, effects and handlers. Renders nothing. */
export function useViewerController({
  src,
  workerSrc,
  assetUrl,
  allowedSources,
  enableXfa,
  defaultScale = 'fit-width',
  gap = 16,
  defaultRotation = 0,
  defaultLayout = 'continuous',
  defaultSidebarOpen = false,
  features = NO_FEATURES,
  devicePixelRatio,
  maxRenderPixels,
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
  // Read once: the ceiling is a property of the device, and re-reading `screen`
  // per page would change canvas resolution mid-session when a monitor is
  // hot-plugged, re-rendering every visible page.
  const autoRenderPixels = useMemo(() => maxRenderPixelsFor(readCanvasEnvironment()), []);
  const renderPixels = maxRenderPixels ?? autoRenderPixels;
  const [scaleMode, setScaleMode] = useState<ScaleMode>(defaultScale);
  const [searchOpen, setSearchOpen] = useState(false);
  const [rotation, setRotation] = useState(defaultRotation);
  const [pageLayout, setPageLayout] = useState<PageLayout>(defaultLayout);
  const [sidebarOpen, setSidebarOpen] = useState(defaultSidebarOpen);
  const [sidebarTab, setSidebarTab] = useState<SidebarTab>('thumbnails');
  // Bumped to redraw every page without changing any input that would otherwise
  // rebuild it. Two things need it: a layer switched in the sidebar, and a
  // `SetOCGState` action fired by an annotation — both change what the engine
  // paints while leaving the viewport, the scale and the document identical.
  const [contentVersion, setContentVersion] = useState(0);
  const repaint = useCallback(() => setContentVersion((version) => version + 1), []);
  // One `OptionalContentConfig` per document, shared by the layers panel, the
  // `SetOCGState` annotation handler and every page render. It has to be one object:
  // pdf.js rebuilds a fresh config from cached worker data on each
  // `getOptionalContentConfig()` call, and `render()` does the same when it is not
  // given one, so a mutation anywhere else is invisible to the page it was meant for.
  const [optionalContentConfig, setOptionalContentConfig] =
    useState<OptionalContentConfigHandle | null>(null);
  const [passwordPrompt, setPasswordPrompt] = useState<PasswordReason | null>(null);
  const submitPasswordRef = useRef<PasswordSubmit | null>(null);
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

  // The built-in prompt stands down when the host renders its own, so an
  // encrypted document never gets two competing dialogs.
  const handlePasswordRequired = useCallback(
    (submit: PasswordSubmit, reason: PasswordReason) => {
      submitPasswordRef.current = submit;
      if (onPasswordRequired) {
        onPasswordRequired(submit, reason);
        return;
      }
      setPasswordPrompt(reason);
    },
    [onPasswordRequired],
  );

  const { doc, numPages, isReady, error, capabilities, reload } = usePdfDocument({
    src: effectiveSrc,
    workerSrc,
    assetUrl,
    allowedSources,
    enableXfa,
    onPasswordRequired: handlePasswordRequired,
  });

  // `usePdfDocument` deliberately ignores prop changes — tracking them would
  // restart the load whenever a consumer passes an inline `{ data }` object —
  // so the shell asks for the reload itself when the source really does change,
  // whether that is the host's `src` or a dropped file.
  useChangeSignal(effectiveSrc, () => reload());

  useEffect(() => {
    // A resolved or rejected load ends the request; drop a stale prompt.
    if (doc || error) setPasswordPrompt(null);
  }, [doc, error]);

  // `onError` lives in a ref: consumers pass inline arrows, and a changing
  // identity here would re-run every page's text/annotation effects (pdf.js
  // rebuilds those layers by clearing their container, so the document would
  // visibly flash and lose selection on each parent re-render).
  const onErrorRef = useRef(onError);
  onErrorRef.current = onError;
  const handlePageError = useCallback((err: Error) => {
    onErrorRef.current?.(err);
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

  // Always called, even when a host supplies its own: hooks cannot be conditional,
  // and an unused built-in stays idle because nothing here calls its `search`.
  const builtInSearch = usePdfSearch({ doc, onError: handlePageError });
  const search = find ?? builtInSearch;
  const ink = usePdfInk({ resetKey: effectiveSrc });

  // One commit handler per page, kept for the life of the viewer. PdfPage is
  // memoised, so an inline `(points) => ink.addStroke(index, points)` here would
  // hand every visible page a new prop identity on any chrome change — which is
  // exactly the render this avoids. The ref keeps it correct across a document
  // switch, when `ink.addStroke` itself is replaced.
  const commitCache = useRef(new Map<number, (points: PdfPoint[]) => void>());
  const addStrokeRef = useRef(ink.addStroke);
  addStrokeRef.current = ink.addStroke;
  const commitFor = useCallback((index: number) => {
    let fn = commitCache.current.get(index);
    if (!fn) {
      fn = (points: PdfPoint[]) => addStrokeRef.current(index, points);
      commitCache.current.set(index, fn);
    }
    return fn;
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
      setScaleMode,
      setLayout: setPageLayout,
      // Read through the ref: `rotatePage` is declared below the shell object, and calling
      // through the ref is how the handle already reaches it.
      rotatePage: (page, degrees) => rotatePageRef.current(page, degrees),
      reportError: handlePageError,
      reportAnnotationChange: handleAnnotationChange,
      inkStrokesForPage: ink.strokesForPage,
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
      ink.strokesForPage,
      repaint,
      contentVersion,
      optionalContentConfig,
    ],
  );

  // The single owner of feature state. Everything below reads through it, and
  // the shell itself imports no feature to do any of it.
  const store = useFeatureStore(shellApi);

  const pageProps = useMemo(
    () => mergeFeaturePageProps(features, store.get),
    [features, store],
  );

  const featureItems = useMemo<ToolbarItem[]>(() => {
    const items: ToolbarItem[] = [];
    for (const feature of features) {
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
  }, [features, store, shellApi, resolvedLabels]);

  // A feature that supersedes a built-in says so in `replaces`; hiding it here is
  // what lets the shell do that without importing the feature it is hiding.
  const toolbarControls = useMemo(
    () => withReplacedControls(controls, replacedControlIds(features)),
    [controls, features],
  );

  const featurePanels = useMemo<SidebarTabSpec[]>(    () =>
      features
        .filter((feature) => feature.panel)
        .map((feature) => ({
          id: feature.panel!.id,
          label: feature.panel!.label(resolvedLabels, store.get(feature.id)),
        })),
    [features, store, resolvedLabels],
  );

  const activePanel = featurePanels.find((entry) => entry.id === sidebarTab);
  const activePanelFeature = activePanel
    ? features.find((feature) => feature.panel?.id === activePanel.id)
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
    const claimed = findFeatureKey(features, store.get, shellApi, event);
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
      });
    } catch {
      return;
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
          const index = await resolveDestinationPageIndex(current, target);
          if (index !== null) scrollToPageRef.current(index + 1);
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
            handlePageError(reason instanceof Error ? reason : new Error(String(reason)));
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
    setRotation((r) => (((r + delta) % 360) + 360) % 360);
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
      openSidebar: (open, tab) => {
        setSidebarOpen(open);
        if (tab) setSidebarTab(tab);
      },
      toggleFullscreen: () => fullscreenRef.current(),
      search: (query, options) => {
        setSearchOpen(true);
        searchRef.current.search(query, options);
      },
    }),
    [],
  );

  const submitPassword = useCallback((password: string | Error) => {
    submitPasswordRef.current?.(password);
    setPasswordPrompt(null);
  }, []);

  return {
    doc,
    numPages,
    isReady,
    error,
    reload,
    replaceDocument,
    containerRef,
    virtualSlots,
    totalHeight,
    currentPage,
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
    ink,
    commitFor,
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
    features,
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
    handle,
  };
}
