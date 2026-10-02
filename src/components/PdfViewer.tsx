import { forwardRef, useImperativeHandle } from 'react';
import type { CSSProperties } from 'react';
import type { PdfError } from '../lib/errors';
import type { AssetUrl } from '../lib/assets';
import type { PdfViewerLabelsOverride } from '../lib/labels';
import type { PdfAnnotationState } from '../lib/editing-state';
import type { PageLayout, ScaleMode } from '../lib/layout';
import type { PdfCapabilities, UsePdfDocumentOptions } from '../headless/usePdfDocument';
import type { PasswordReason, PasswordSubmit } from '../lib/status';
import type { PdfFindController } from '../headless/usePdfSearch';
import type { SearchOptions } from '../lib/search';
import type { AnyPdfFeature } from '../lib/features';
import type { PdfSource } from '../lib/source';
import type { RetryAttemptInfo, RetryPolicy } from '../lib/retry';
import type { SidebarTab } from './Sidebar';
import type { ToolbarControls } from './Toolbar';
import { useViewerController } from './ViewerController';
import { ViewerLayout } from './ViewerLayout';

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
  /**
   * Request headers for a URL `src` — an `Authorization` bearer, a signed-URL
   * token, a tenant id. Forwarded to the engine's fetch verbatim, never logged
   * and never echoed into an error. Read when a load starts, so an inline
   * literal does not restart the load on every render; reload to apply new ones.
   */
  httpHeaders?: Record<string, string>;
  /** Send cookies and HTTP auth for a cross-origin URL `src`. */
  withCredentials?: boolean;
  /** Bytes per range request; the engine's default applies when omitted. */
  rangeChunkSize?: number;
  /** Fetch the whole file in one request instead of by byte range. */
  disableRange?: boolean;
  /** Turn off progressive streaming as the file arrives. */
  disableStream?: boolean;
  /**
   * Bounded retries for a load failure that can heal — three attempts with full-jitter backoff by
   * default, `false` to fail on the first error. A 401, a 403, a 404, a corrupt file and an encrypted
   * document are never retried.
   */
  retry?: RetryPolicy | false;
  /** Called before each retry wait, so the UI can say "retrying (2 of 3)" instead of spinning. */
  onRetryAttempt?: (info: RetryAttemptInfo) => void;
  /**
   * Bytes as they arrive, for a bar that says how far. The shell does not draw one — this is the host's
   * channel, and it forwards to the same option on `usePdfDocument`.
   */
  onProgress?: UsePdfDocumentOptions['onProgress'];
  /** Stop the load from outside. Aborting is an unmount's exact equivalent and reports no error. */
  signal?: AbortSignal;
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
  /**
   * The features this viewer has: print, download, forms, an outline panel, or
   * one you wrote. Each is a value you import, so a feature you leave out never
   * enters the bundle — which is the whole reason these are not booleans.
   *
   * Defaults to none. `<PdfViewer src={src} />` shows pages, text, search, ink,
   * thumbnails and rotation, and nothing that can print, save or edit.
   */
  features?: readonly AnyPdfFeature[];
  /**
   * Device pixels per CSS pixel for page canvases. Unset, this is the live
   * `window.devicePixelRatio`, re-read when the display changes; passing a number
   * pins it, and a monitor switch then repaints nothing here.
   */
  devicePixelRatio?: number;
  /**
   * Area ceiling per page canvas, in device pixels. Defaults to the limit pdf.js's
   * own viewer uses, tightened for mobile and small screens. A canvas over the
   * ceiling renders blank rather than throwing, so this is what keeps a 500% zoom
   * on a large page on screen. `0` renders at CSS resolution.
   */
  maxRenderPixels?: number;
  className?: string;
  style?: CSSProperties;
  /**
   * Notified when the document is encrypted. Supplying this takes over the UI:
   * without it the viewer shows its own `PasswordPrompt` instead.
   */
  onPasswordRequired?: (submit: PasswordSubmit, reason: PasswordReason) => void;
  onError?: (error: PdfError) => void;
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
   * Fired when an annotation editor reports a change, with what it says about itself.
   *
   * Only the annotate feature can produce one, and the engine fires the underlying
   * event only when something actually differs — so this is a change signal rather
   * than a mode signal, and it covers the paths no toolbar button is on: a keyboard
   * delete, an undo, a mark moved by hand. `state.canUndo` is the field to gate a
   * Save button on; `state.isEmpty` is not, because undoing everything leaves the
   * storage holding the deltas.
   */
  onAnnotationChange?: (state: PdfAnnotationState) => void;
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
  /**
   * Remove, re-order or add toolbar controls by id — `{ hide: ['draw'],
   * priorities: { layout: 2 }, add: [myControl] }`. The bar's contents are the
   * last thing a host has to take as given, and this is the seam for it.
   * See {@link ToolbarControls}.
   */
  controls?: ToolbarControls;
  /**
   * Replace the finding strategy while keeping the find bar, the marks and the
   * page counts. The built-in `usePdfSearch` result is the contract
   * ({@link PdfFindController}), so anything shaped like it works: a stemmed or
   * fuzzy matcher, a server-side index, a synonym expansion. When supplied, the
   * viewer calls into it instead of searching the text layer itself.
   */
  find?: PdfFindController;
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
  /** `'automatic'` picks width-fit or page-fit from the page's shape. */
  fitTo: (mode: 'width' | 'page' | 'automatic') => void;
  setLayout: (layout: PageLayout) => void;
  /** Rotates the whole document by a multiple of 90 degrees. */
  rotate: (degrees: number) => void;
  /** Rotates a single 1-based page in place. */
  rotatePage: (page: number, degrees: number) => void;
  /**
   * Re-queues a single 1-based page: its proxy is fetched again and it paints again. This is the way back
   * out of `error` for one page without disturbing the reader's zoom or position — §3.5's "an explicit
   * retry re-queues the page", and the page-side half of FR-54's deterministic retry transitions.
   */
  retryPage: (page: number) => void;
  openSidebar: (open: boolean, tab?: SidebarTab) => void;
  /** Enters fullscreen, or exits when already active. Needs a user gesture. */
  toggleFullscreen: () => void;
  /** Runs a document search and shows the search bar. */
  search: (query: string, options?: SearchOptions) => void;
}

/**
 * The whole viewer in one element.
 *
 * Two things, both exported: `useViewerController` owns every piece of state and
 * every handler, and `ViewerLayout` places the parts. A host that wants a
 * different arrangement writes their own layout against the controller instead
 * of rebuilding the wiring, and the default layout is the reference for what
 * that takes.
 */
export const PdfViewer = forwardRef<PdfViewerHandle, PdfViewerProps>(function PdfViewer(
  props,
  ref,
) {
  const controller = useViewerController(props);
  useImperativeHandle(ref, () => controller.handle, [controller.handle]);

  return <ViewerLayout controller={controller} />;
});
