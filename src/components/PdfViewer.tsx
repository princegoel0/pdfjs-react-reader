import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from 'react';
import type { CSSProperties, DragEvent, KeyboardEvent } from 'react';
import { TouchManager } from 'pdfjs-dist';
import {
  usePdfDocument,
  type PasswordReason,
  type PasswordSubmit,
  type PdfCapabilities,
} from '../headless/usePdfDocument';
import type { AssetUrl } from '../lib/assets';
import { usePdfDownload } from '../headless/usePdfDownload';
import { usePdfFormValues } from '../headless/usePdfFormValues';
import { usePdfInk } from '../headless/usePdfInk';
import { usePdfOutline } from '../headless/usePdfOutline';
import { usePdfPrint } from '../headless/usePdfPrint';
import { usePdfSearch } from '../headless/usePdfSearch';
import { usePdfVirtualizer } from '../headless/usePdfVirtualizer';
import { applyRotation, type PageLayout, type ScaleMode } from '../lib/layout';
import { maxRenderPixelsFor, readCanvasEnvironment } from '../lib/canvas';
import {
  DEFAULT_LABELS,
  formatLabel,
  type PdfViewerLabelsOverride,
} from '../lib/labels';
import { LabelsContext } from './labels-context';
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
import { createPdfLinkService } from '../lib/link-service';
import type { FormValue } from '../lib/form';
import type { PageMatch } from '../lib/search';
import type { PdfSource } from '../lib/source';

import { OutlineView } from './OutlineView';
import { PasswordPrompt } from './PasswordPrompt';
import { PdfPage } from './PdfPage';
import { SearchBox } from './SearchBox';
import { Sidebar, type SidebarTab } from './Sidebar';
import { ThumbnailList } from './ThumbnailList';
import { Toolbar } from './Toolbar';

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


export interface PdfViewerProps {
  /**
   * The document to show. Changing it reloads in place, so keep the value
   * stable across renders — a URL string, or a memoised object — otherwise
   * every host re-render restarts the load.
   */
  src: PdfSource;
  workerSrc?: string;
  /**
   * Root for pdf.js's cMaps, standard fonts and wasm: `'cdn'` (the default,
   * unpkg pinned to the engine version) or your own path such as
   * `'/pdfjs-dist/'`. Set this before a CJK or JPEG 2000 document reaches the
   * viewer, since a wrong root only surfaces as a blank page.
   */
  assetUrl?: AssetUrl;
  /**
   * Restrict where a URL `src` may point: URL prefixes, bare origins, or
   * same-origin paths, e.g. `['/files/', 'https://cdn.example.com']`. Documents
   * passed as bytes are always accepted. Omit to allow any URL — which is right
   * for an app that only ever opens paths it chose, and wrong for one that
   * opens an address a visitor typed.
   */
  allowedSources?: readonly string[];
  /** Render XFA forms. Defaults to true; without it a dynamic XFA is a blank page. */
  enableXfa?: boolean;
  defaultScale?: ScaleMode;
  /** Vertical gap between pages in CSS pixels. */
  gap?: number;
  /** Initial global rotation in degrees; user can rotate via the toolbar. */
  defaultRotation?: number;
  /** Initial page layout mode. */
  defaultLayout?: PageLayout;
  /** Show the navigation sidebar (thumbnails/outline) on first render. */
  defaultSidebarOpen?: boolean;
  /** Render interactive AcroForm widgets. Defaults to true. */
  renderForms?: boolean;
  /** Show the print control and bind Ctrl/Cmd+P. Defaults to true (never on iOS). */
  enablePrint?: boolean;
  /** Canvas scale for printing; 1 = the 72 dpi PDF unit. Auto-tuned to fit memory by default. */
  printScale?: number;
  /** Device pixels per CSS pixel for page canvases. Defaults to `window.devicePixelRatio`. */
  devicePixelRatio?: number;
  /**
   * Area ceiling per page canvas, in device pixels. Defaults to the limit pdf.js's
   * own viewer uses, tightened for mobile and small screens. A canvas over the
   * ceiling renders blank rather than throwing, so this is what keeps a 500% zoom
   * on a large page on screen. `0` renders at CSS resolution.
   */
  maxRenderPixels?: number;
  /** Show the download control. Defaults to true. */
  enableDownload?: boolean;
  /** Name for the saved file; defaults to the document's own name. */
  downloadFileName?: string;
  /** Notified with the current values whenever the user edits a form field. */
  onFormValuesChange?: (values: Record<string, FormValue>) => void;
  className?: string;
  style?: CSSProperties;
  /**
   * Notified when the document is encrypted. Supplying this takes over the UI:
   * without it the viewer shows its own `PasswordPrompt` instead.
   */
  onPasswordRequired?: (submit: PasswordSubmit, reason: PasswordReason) => void;
  onError?: (error: Error) => void;
  /**
   * Override any subset of the shell's strings. Unspecified keys keep their
   * English default, so a partial catalog is always valid.
   */
  labels?: PdfViewerLabelsOverride;
  /** Fired when the topmost visible page changes. Does not fire on first load. */
  onPageChange?: (page: number) => void;
  /** Fired when the effective zoom factor changes, including fit-mode resolves. */
  onScaleChange?: (scale: number) => void;
  /** Fired when the layout mode changes. */
  onLayoutChange?: (layout: PageLayout) => void;
  /**
   * Fired once a document is open and its shape is known. `hasJSActions` means
   * the form's calculated fields and validation scripts will not run here, which
   * is worth knowing before you offer "fill this in and send it back".
   */
  onCapabilities?: (capabilities: PdfCapabilities) => void;
  /** Fired when the viewer enters or leaves fullscreen. */
  onFullscreenChange?: (active: boolean) => void;
  /**
   * Intercept clicks on external links. When provided, the browser's own
   * navigation is prevented and the URL is handed here — the viewer never
   * decides on its own whether a link is safe to follow.
   */
  onExternalLink?: (url: string) => void;
  /** Ctrl/Cmd + wheel and trackpad pinch to zoom. Defaults to true. */
  enableWheelZoom?: boolean;
  /** Two-finger pinch on touch devices. Defaults to true. */
  enablePinchZoom?: boolean;
  /** Show the fullscreen control where the platform supports it. Defaults to true. */
  enableFullscreen?: boolean;
  /** Arrow/PageUp/PageDown/Home/End page navigation. Defaults to true. */
  enableKeyboardNavigation?: boolean;
  /**
   * Accept a dropped PDF and show it in place of `src`. Off by default: a
   * viewer whose document is controlled by the host app should not swap it out
   * behind the app's back. `onDropFile` still fires when off, so an app can
   * drive the change itself.
   */
  enableDrop?: boolean;
  /** Gate which dropped files are treated as openable. Defaults to any PDF. */
  acceptDrop?: (file: File) => boolean;
  /** Notified for every dropped file that `acceptDrop` allows. */
  onDropFile?: (file: File) => void;
  /** Initial per-page rotation in degrees, keyed by 0-based page index. */
  defaultPageRotations?: Record<number, number>;
}

/** Imperative control surface, obtained with a ref on `PdfViewer`. */
export interface PdfViewerHandle {
  /** Scrolls to a 1-based page. */
  goToPage: (page: number) => void;
  /** Sets an absolute zoom factor, clamped to the supported range. */
  zoomTo: (scale: number) => void;
  /** Multiplies the zoom currently on screen by `factor`. */
  zoomBy: (factor: number) => void;
  /** Switches to an automatic fit mode. */
  fitTo: (mode: 'width' | 'page') => void;
  setLayout: (layout: PageLayout) => void;
  /** Rotates the whole document by a multiple of 90 degrees. */
  rotate: (degrees: number) => void;
  /** Rotates a single 1-based page in place. */
  rotatePage: (page: number, degrees: number) => void;
  openSidebar: (open: boolean, tab?: SidebarTab) => void;
  /** Enters fullscreen, or exits when already active. Needs a user gesture. */
  toggleFullscreen: () => void;
  /** Runs a document search and shows the search bar. */
  search: (query: string, options?: { caseSensitive?: boolean; wholeWord?: boolean }) => void;
}

export const PdfViewer = forwardRef<PdfViewerHandle, PdfViewerProps>(function PdfViewer({
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
  renderForms = true,
  enablePrint = true,
  printScale,
  devicePixelRatio,
  maxRenderPixels,
  enableDownload = true,
  downloadFileName,
  onFormValuesChange,
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
  onExternalLink,
  enableWheelZoom = true,
  enablePinchZoom = true,
  enableFullscreen = true,
  enableKeyboardNavigation = true,
  enableDrop = false,
  acceptDrop,
  onDropFile,
  defaultPageRotations,
}: PdfViewerProps, ref) {
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
  const [passwordPrompt, setPasswordPrompt] = useState<PasswordReason | null>(null);
  const submitPasswordRef = useRef<PasswordSubmit | null>(null);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [pageRotations, setPageRotations] = useState<Record<number, number>>(
    () => defaultPageRotations ?? {},
  );
  const [droppedFile, setDroppedFile] = useState<File | null>(null);
  const [dragOver, setDragOver] = useState(false);

  // A dropped document is an override, not a new prop: the host's `src` still
  // wins the moment it changes, so an app navigating elsewhere is never stuck
  // showing a file the user dragged in earlier.
  const effectiveSrc = droppedFile ?? src;
  useEffect(() => {
    setDroppedFile(null);
    setDragOver(false);
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

  const search = usePdfSearch({ doc, onError: handlePageError });
  const { entries: outlineEntries, loading: outlineLoading } = usePdfOutline({ doc });
  const form = usePdfFormValues({ doc, onError: handlePageError });
  const ink = usePdfInk({ resetKey: effectiveSrc });
  const print = usePdfPrint({
    doc,
    rotation,
    getInkStrokes: ink.strokesForPage,
    onError: handlePageError,
  });

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

  const canPrint = enablePrint && print.supported;
  const handlePrint = useCallback(() => {
    void print.print({ scale: printScale });
  }, [print, printScale]);

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
  const handleViewerKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    // Typing into a field — including an AcroForm widget rendered inside the
    // page — belongs to that field, never to the viewer.
    if (isEditableTarget(event.target)) return;

    if (event.ctrlKey || event.metaKey) {
      const key = event.key.toLowerCase();
      if (key === 'f') {
        event.preventDefault();
        setSearchOpen(true);
      } else if (key === 'p' && canPrint) {
        event.preventDefault();
        handlePrint();
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
  const handleRotatePage = useCallback((page: number, degrees: number) => {
    const index = clampPage(page, Number.MAX_SAFE_INTEGER) - 1;
    setPageRotations((prev) => ({
      ...prev,
      [index]: normalizeRotation((prev[index] ?? 0) + degrees),
    }));
  }, []);

  // ---- drag and drop -------------------------------------------------------
  const handleDragOver = (event: DragEvent<HTMLDivElement>) => {
    if (!onDropFile && !enableDrop) return;
    event.preventDefault();
    event.dataTransfer!.dropEffect = 'copy';
    if (!dragOver) setDragOver(true);
  };
  const handleDragLeave = (event: DragEvent<HTMLDivElement>) => {
    // Leaving a child bubbles as a leave of the viewer; ignore those.
    if (event.currentTarget.contains(event.relatedTarget as Node | null)) return;
    setDragOver(false);
  };
  const handleDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setDragOver(false);
    const file = event.dataTransfer?.files?.[0];
    if (!file) return;
    const accepted = acceptDrop
      ? acceptDrop(file)
      : file.type === 'application/pdf' || /\.pdf$/i.test(file.name);
    if (!accepted) return;
    onDropFile?.(file);
    if (enableDrop) setDroppedFile(file);
  };

  const docRef = useRef(doc);
  docRef.current = doc;

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
      }),
    [doc, effectiveSrc],
  );

  // Held in a ref so a consumer passing an inline arrow cannot re-trigger this
  // effect on every render (which would loop whenever it sets state).
  const onFormValuesChangeRef = useRef(onFormValuesChange);
  onFormValuesChangeRef.current = onFormValuesChange;
  useEffect(() => {
    onFormValuesChangeRef.current?.(form.values);
  }, [form.values]);

  const handleRotate = useCallback((delta: number) => {
    setRotation((r) => (((r + delta) % 360) + 360) % 360);
  }, []);

  // Ensure zoomed-in rows wider than the viewport stay reachable via
  // horizontal scrolling.
  const maxRowWidth = useMemo(() => {
    let max = applyRotation(pageEstimate, rotation).width * resolvedScale;
    for (const slot of virtualSlots) max = Math.max(max, slot.width);
    return max;
  }, [virtualSlots, pageEstimate, rotation, resolvedScale]);

  // Human-readable document name for the bar. `File` carries a name; a bare
  // Blob or data URL does not, so those simply omit the label.
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

  const download = usePdfDownload({
    doc,
    fileName: downloadFileName ?? docLabel,
    onError: handlePageError,
  });
  const handleDownload = useCallback(() => {
    // Save what the user is looking at: with edits pending, the download embeds
    // the current form values instead of the pristine file.
    void download.download({ withFormValues: form.isDirty });
  }, [download, form.isDirty]);

  // ---- imperative handle ---------------------------------------------------
  // Every member reads through a ref, so the object is created once and a
  // consumer's effects that depend on the handle never re-run on each render.
  const numPagesRef = useRef(numPages);
  numPagesRef.current = numPages;
  const searchRef = useRef(search);
  searchRef.current = search;
  const rotatePageRef = useRef(handleRotatePage);
  rotatePageRef.current = handleRotatePage;
  const fullscreenRef = useRef(toggleFullscreen);
  fullscreenRef.current = toggleFullscreen;

  useImperativeHandle(
    ref,
    (): PdfViewerHandle => ({
      goToPage: (page) => scrollToPageRef.current(clampPage(page, numPagesRef.current)),
      zoomTo: (scale) => setScaleMode(clampScale(scale)),
      zoomBy: (factor) => setScaleMode(zoomBy(resolvedScaleRef.current, factor)),
      fitTo: (mode) => setScaleMode(mode === 'width' ? 'fit-width' : 'fit-page'),
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

  return (
    <LabelsContext.Provider value={resolvedLabels}>
      <div
        ref={rootRef}
        className={
          className
            ? `pjsr-viewer ${dragOver ? 'pjsr-viewer--dragover ' : ''}${className}`
            : `pjsr-viewer${dragOver ? ' pjsr-viewer--dragover' : ''}`
        }
        style={style}
        onKeyDown={handleViewerKeyDown}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
      >
        {dragOver && (
          <div className="pjsr-drop-overlay" role="status">
            {resolvedLabels.dropToOpen}
          </div>
        )}
        <Toolbar
        currentPage={currentPage}
        numPages={numPages}
        scaleMode={scaleMode}
        resolvedScale={resolvedScale}
        onPageChange={(page) => scrollToPage(page)}
        onScaleModeChange={setScaleMode}
        searchOpen={searchOpen}
        onSearchToggle={() => setSearchOpen((open) => !open)}
        searchContent={
          <SearchBox
            state={search}
            onClose={() => {
              setSearchOpen(false);
              search.clear();
            }}
          />
        }
        sidebarOpen={sidebarOpen}
        onSidebarToggle={() => setSidebarOpen((open) => !open)}
        pageLayout={pageLayout}
        onPageLayoutChange={setPageLayout}
        onRotate={handleRotate}
        drawMode={ink.drawing}
        onDrawToggle={() => ink.setDrawing(!ink.drawing)}
        inkSettings={ink.settings}
        onInkSettingsChange={ink.updateSettings}
        onInkUndo={ink.undo}
        onInkClear={ink.clear}
        inkCanUndo={ink.strokes.length > 0}
        docLabel={docLabel}
        zoomLabel={formatLabel(resolvedLabels.zoomPercent, {
          percent: Math.round(resolvedScale * 100),
        })}
        onPrint={canPrint ? handlePrint : undefined}
        onPrintCancel={print.cancel}
        printing={print.isPrinting}
        printProgress={print.progress}
        onDownload={enableDownload ? handleDownload : undefined}
        downloading={download.isBusy}
        onFullscreenToggle={fsAvailable ? toggleFullscreen : undefined}
        fullscreenActive={isFullscreen}
        onRotatePage={handleRotatePage}
      />

      <div className="pjsr-body">
        <Sidebar
          open={sidebarOpen}
          tab={sidebarTab}
          onTabChange={setSidebarTab}
          onClose={() => setSidebarOpen(false)}
        >
          {sidebarTab === 'thumbnails' ? (
            doc && (
              <ThumbnailList
                doc={doc}
                numPages={numPages}
                currentPage={currentPage}
                rotation={rotation}
                pageRotations={pageRotations}
                onSelectPage={(page) => scrollToPage(page)}
              />
            )
          ) : (
            <OutlineView
              entries={outlineEntries}
              loading={outlineLoading}
              onSelectPage={(page) => scrollToPage(page)}
            />
          )}
        </Sidebar>

        <div
          ref={containerRef}
          className="pjsr-viewport"
          // Focusable: a scrollable region that cannot receive keyboard focus is
          // a WCAG 2.1.1 failure, and it also gates the viewer's Ctrl/Cmd+F.
          role="region"
          aria-label={resolvedLabels.pagesRegion}
          tabIndex={0}
        >
          {passwordPrompt ? (
            <PasswordPrompt
              reason={passwordPrompt}
              onSubmit={(password) => {
                submitPasswordRef.current?.(password);
                setPasswordPrompt(null);
              }}
              onCancel={() => {
                submitPasswordRef.current?.(new Error('No password provided.'));
                setPasswordPrompt(null);
              }}
            />
          ) : error ? (
            <div className="pjsr-status" role="alert">
              <span>{formatLabel(resolvedLabels.loadFailed, { message: error.message })}</span>
              <button type="button" className="pjsr-button pjsr-status-action" onClick={() => reload()}>
                {resolvedLabels.retry}
              </button>
            </div>
          ) : !isReady || !doc ? (
            <div className="pjsr-status" role="status">
              {resolvedLabels.loadingDocument}
            </div>
          ) : (
            <div
              className="pjsr-spacer"
              style={{ height: totalHeight, width: `max(100%, ${Math.ceil(maxRowWidth)}px)` }}
            >
              {virtualSlots.map((slot) => (
                <div
                  key={slot.indices[0]}
                  className="pjsr-page-slot"
                  style={{
                    width: slot.width,
                    height: slot.height,
                    transform: `translate(-50%, ${slot.offsetTop}px)`,
                  }}
                >
                  <div className="pjsr-page-row" style={{ gap }}>
                    {slot.indices.map((index) => (
                      <div key={index} className="pjsr-page">
                        <PdfPage
                          doc={doc}
                          pageNumber={index + 1}
                          scale={resolvedScale}
                          rotation={rotation + (pageRotations[index] ?? 0)}
                          devicePixelRatio={devicePixelRatio}
                          maxRenderPixels={renderPixels}
                          className="pjsr-page-canvas"
                          highlights={matchesByPage.get(index)}
                          activeHighlight={activeLocalByPage.get(index) ?? -1}
                          navigateToActiveAt={navigateToActiveAt}
                          renderForms={renderForms}
                          annotationStorage={form.storage}
                          linkService={linkService}
                          formVersion={form.version}
                          onFormChange={form.refresh}
                          inkStrokes={ink.strokesForPage(index)}
                          inkDrawing={ink.drawing}
                          inkSettings={ink.settings}
                          onInkCommit={(points) => ink.addStroke(index, points)}
                          onBaseDimensions={reportPageDims}
                          onError={handlePageError}
                        />
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
    </LabelsContext.Provider>
  );
});
