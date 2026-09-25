import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AnnotationLayer,
  RenderingCancelledException,
  TextLayer,
  type PDFDocumentProxy,
  type PDFPageProxy,
  type RenderTask,
} from 'pdfjs-dist';
import type { CSSProperties } from 'react';
import { formatLabel } from '../lib/labels';
import { resolveRenderScale } from '../lib/canvas';
import { useLabels } from './labels-context';
import { InkLayer } from './InkLayer';
import { applyHighlights, unwrapMarks } from '../lib/highlight';
import type { AnnotationValueStore } from '../lib/form';
import type { OptionalContentConfigHandle } from '../lib/optional-content';
import type { InkSettings, InkStroke, PdfPoint } from '../lib/ink';
import type { PageDims } from '../lib/layout';
import type { PdfLinkService } from '../lib/link-service';
import type { PageMatch } from '../lib/search';

/** `RenderParameters` is not exported, and the OC promise's type is only named there. */
type RenderParams = Parameters<PDFPageProxy['render']>[0];

export interface PdfPageProps {
  doc: PDFDocumentProxy;
  /** 1-based page number. */
  pageNumber: number;
  scale: number;
  /** User-applied rotation in degrees, added to the page's intrinsic rotation. */
  rotation?: number;
  /** Overrides window.devicePixelRatio for canvas resolution. */
  devicePixelRatio?: number;
  /** Device-pixel area ceiling for this page's canvas. Defaults to the pdf.js desktop limit. */
  maxRenderPixels?: number;
  /** Ceiling for either canvas side, in device pixels. */
  maxRenderSide?: number;
  className?: string;
  /** Search matches located on this page (pageIndex must equal pageNumber - 1). */
  highlights?: PageMatch[];
  /** Index into `highlights` of the active match, -1/undefined for none. */
  activeHighlight?: number;
  /**
   * Timestamp (ms) of the most recent "navigate to active match" request.
   * The active mark is scrolled into view only when the request is fresh, so
   * pages mounting later for ordinary virtualization do not yank the scroll.
   */
  navigateToActiveAt?: number;
  /**
   * Renders interactive AcroForm widgets. Off by default: the annotation layer
   * always draws links and markups, and turning widgets on means a feature
   * handing this page the storage to write into.
   */
  renderForms?: boolean;
  /** pdf.js annotation storage backing form field values. */
  annotationStorage?: AnnotationValueStore | null;
  /** Required for link annotations and internal navigation. */
  linkService?: PdfLinkService | null;
  /** Bumped by programmatic form changes to force an annotation re-render. */
  formVersion?: number;
  /**
   * Bumped when the *page* content itself changes without any input changing —
   * a switched optional-content group is the case that needs it, because pdf.js
   * decides layer visibility at paint time from a mutable config object.
   */
  contentVersion?: number;
  /**
   * The viewer's one shared `OptionalContentConfig`. Passing it is what makes a
   * layer toggle paint: left out, pdf.js fetches a fresh config per render and
   * resets every group to the document's defaults, so the pages would ignore
   * whatever the sidebar just did.
   */
  optionalContentConfig?: OptionalContentConfigHandle | null;
  /** Notified after the user edits a form field. */
  onFormChange?: () => void;
  /** Freehand strokes for this page. */
  inkStrokes?: InkStroke[];
  /** True while the freehand tool is armed for this page. */
  inkDrawing?: boolean;
  inkSettings?: InkSettings;
  onInkCommit?: (points: PdfPoint[]) => void;
  /** Called once the page's intrinsic (scale-1) dimensions are known. */
  onBaseDimensions?: (index: number, dims: PageDims) => void;
  onError?: (error: Error) => void;
}

/**
 * One page: canvas, text layer, annotation layer, ink overlay.
 *
 * Memoised, because a page is the most expensive subtree in the library and the
 * shell re-renders for reasons that cannot reach it — opening the search bar
 * changed no page prop at all, and still re-rendered every visible page. That
 * makes prop identity load-bearing for hosts too: an inline arrow or a fresh
 * object here defeats the memo, which is the same rule the layers already
 * follow, now with a cost attached.
 */
export const PdfPage = memo(function PdfPage({
  doc,
  pageNumber,
  scale,
  rotation = 0,
  devicePixelRatio,
  maxRenderPixels,
  maxRenderSide,
  className,
  highlights,
  activeHighlight = -1,
  navigateToActiveAt = 0,
  renderForms = false,
  annotationStorage = null,
  linkService = null,
  formVersion = 0,
  contentVersion = 0,
  optionalContentConfig = null,
  onFormChange,
  inkStrokes,
  inkDrawing = false,
  inkSettings,
  onInkCommit,
  onBaseDimensions,
  onError,
}: PdfPageProps) {
  const labels = useLabels();
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const textLayerRef = useRef<HTMLDivElement | null>(null);
  const annotationRef = useRef<HTMLDivElement | null>(null);
  const taskRef = useRef<RenderTask | null>(null);
  const [page, setPage] = useState<PDFPageProxy | null>(null);
  const [textLayer, setTextLayer] = useState<TextLayer | null>(null);

  // Callback props are read through refs so a consumer's inline arrow never
  // changes an effect's identity: the pdf.js layers below rebuild by clearing
  // their container, which would flash the page and drop text selection.
  const onErrorRef = useRef(onError);
  onErrorRef.current = onError;
  const onBaseDimensionsRef = useRef(onBaseDimensions);
  onBaseDimensionsRef.current = onBaseDimensions;
  const onFormChangeRef = useRef(onFormChange);
  onFormChangeRef.current = onFormChange;

  const reportError = useCallback((err: unknown) => {
    onErrorRef.current?.(err instanceof Error ? err : new Error(String(err)));
  }, []);

  const handleFormEvent = useCallback(() => {
    onFormChangeRef.current?.();
  }, []);

  const viewport = useMemo(
    () =>
      page
        ? page.getViewport({ scale, rotation: (page.rotate + rotation) % 360 })
        : null,
    [page, scale, rotation],
  );

  useEffect(() => {
    let cancelled = false;
    setPage(null);
    doc
      .getPage(pageNumber)
      .then((p) => {
        if (cancelled) return;
        setPage(p);
        const base = p.getViewport({ scale: 1 });
        onBaseDimensionsRef.current?.(pageNumber - 1, { width: base.width, height: base.height });
      })
      .catch((err: unknown) => {
        if (!cancelled) reportError(err);
      });
    return () => {
      cancelled = true;
    };
  }, [doc, pageNumber, reportError]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!page || !canvas || !viewport) return;

    // An over-large canvas does not throw: the browser allocates nothing and
    // pdf.js paints into a blank surface, so the ceiling has to be applied here.
    const { scale: dpr } = resolveRenderScale({
      width: viewport.width,
      height: viewport.height,
      devicePixelRatio: devicePixelRatio ?? window.devicePixelRatio ?? 1,
      maxPixels: maxRenderPixels,
      maxSide: maxRenderSide,
    });

    canvas.width = Math.max(1, Math.floor(viewport.width * dpr));
    canvas.height = Math.max(1, Math.floor(viewport.height * dpr));
    canvas.style.width = `${Math.floor(viewport.width)}px`;
    canvas.style.height = `${Math.floor(viewport.height)}px`;

    const transform = dpr !== 1 ? [dpr, 0, 0, dpr, 0, 0] : undefined;
    const task = page.render({
      canvas,
      viewport,
      transform,
      background: '#ffffff',
      // A new promise each render on purpose: pdf.js only reads it once, and the
      // value inside is the stable shared config. Putting this in the effect's
      // deps instead would re-render every page on every parent render.
      optionalContentConfigPromise: optionalContentConfig
        ? (Promise.resolve(optionalContentConfig) as unknown as RenderParams['optionalContentConfigPromise'])
        : undefined,
    });
    taskRef.current = task;

    task.promise.catch((err: unknown) => {
      if (err instanceof RenderingCancelledException) return;
      reportError(err);
    });

    return () => {
      taskRef.current = null;
      task.cancel();
      // Release the backing pixel buffer immediately — mobile Safari crashes
      // when too many detached canvases stay alive.
      canvas.width = 0;
      canvas.height = 0;
    };
  }, [page, viewport, devicePixelRatio, maxRenderPixels, maxRenderSide, contentVersion, optionalContentConfig, reportError]);

  // The layer is built only for page/scale/rotation changes; highlight updates
  // are layered on top by the effect below without a full rebuild.
  useEffect(() => {
    const container = textLayerRef.current;
    if (!page || !container || !viewport) return;

    let cancelled = false;
    const layer = new TextLayer({
      textContentSource: page.streamTextContent(),
      container,
      viewport,
    });

    layer
      .render()
      .then(() => {
        if (!cancelled) setTextLayer(layer);
      })
      .catch((err: unknown) => {
        // Expected when the layer is cancelled mid-render (unmount, zoom step).
        if (cancelled || (err instanceof Error && err.name === 'AbortException')) return;
        reportError(err);
      });

    return () => {
      cancelled = true;
      setTextLayer(null);
      layer.cancel();
      container.replaceChildren();
    };
  }, [page, viewport, reportError]);

  // Annotations (links, markups, form widgets). pdf.js's `AnnotationLayer.update`
  // only repositions the layer, so programmatic form writes force a re-render
  // through `formVersion` instead.
  useEffect(() => {
    const container = annotationRef.current;
    if (!page || !container || !viewport || !linkService) return;

    let cancelled = false;
    (async () => {
      const annotations = await page.getAnnotations({ intent: 'display' });
      if (cancelled) return;
      container.replaceChildren();
      // AnnotationLayer types its collaborators nominally (PDFLinkService and
      // AnnotationStorage live in the unbundled web layer), so we hand it our
      // structural implementations via a single cast.
      const layer = new AnnotationLayer({
        div: container,
        viewport,
        page,
        linkService,
        annotationStorage,
        accessibilityManager: null,
        annotationCanvasMap: null,
        annotationEditorUIManager: null,
        structTreeLayer: null,
        commentManager: null,
      } as unknown as ConstructorParameters<typeof AnnotationLayer>[0]);
      await layer.render({
        annotations,
        viewport,
        div: container,
        page,
        linkService,
        annotationStorage,
        renderForms,
        enableScripting: false,
      } as unknown as Parameters<AnnotationLayer['render']>[0]);
    })().catch((err: unknown) => {
      if (cancelled) return;
      reportError(err);
    });

    return () => {
      cancelled = true;
      container.replaceChildren();
    };
  }, [page, viewport, linkService, annotationStorage, renderForms, formVersion, reportError]);

  // Surface user edits in the form widgets; storage is written synchronously by
  // pdf.js before these bubble, so reading it here sees the new values.
  useEffect(() => {
    const container = annotationRef.current;
    if (!container) return;
    container.addEventListener('change', handleFormEvent);
    container.addEventListener('input', handleFormEvent);
    return () => {
      container.removeEventListener('change', handleFormEvent);
      container.removeEventListener('input', handleFormEvent);
    };
  }, [handleFormEvent]);

  const markedDivsRef = useRef<HTMLElement[]>([]);
  const lastNavRef = useRef(0);
  useEffect(() => {
    const container = textLayerRef.current;
    if (!textLayer || !container) return;

    unwrapMarks(markedDivsRef.current);
    markedDivsRef.current = [];
    if (highlights && highlights.length > 0) {
      applyHighlights(textLayer.textDivs, highlights, activeHighlight, markedDivsRef.current);
    }

    // Center the active mark only for fresh navigation requests; matches
    // applied long after the request belong to ordinary virtualization.
    if (
      activeHighlight >= 0 &&
      navigateToActiveAt > 0 &&
      navigateToActiveAt !== lastNavRef.current &&
      Date.now() - navigateToActiveAt < 1500
    ) {
      lastNavRef.current = navigateToActiveAt;
      container
        .querySelector('.pjsr-mark--active')
        ?.scrollIntoView({ block: 'center', behavior: 'auto' });
    }
  }, [textLayer, highlights, activeHighlight, navigateToActiveAt]);

  // pdf.js sizes text spans and layer dimensions against
  // --total-scale-factor, which its viewer CSS normally defines; we drive it
  // from the render scale instead.
  const layerStyle = { '--total-scale-factor': String(scale) } as CSSProperties;

  return (
    <>
      <canvas
        ref={canvasRef}
        className={className}
        role="img"
        aria-label={formatLabel(labels.pageLabel, { page: pageNumber })}
      />
      <div ref={textLayerRef} className="pjsr-text-layer" style={layerStyle} />
      <div
        ref={annotationRef}
        className={`pjsr-annotation-layer${inkDrawing ? ' pjsr-annotation-layer--inert' : ''}`}
        style={layerStyle}
      />
      {viewport && inkSettings && (
        <InkLayer
          strokes={inkStrokes ?? []}
          viewport={viewport}
          scale={scale}
          drawing={inkDrawing}
          settings={inkSettings}
          onCommit={(points) => onInkCommit?.(points)}
        />
      )}
    </>
  );
});
