import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AnnotationLayer,
  RenderingCancelledException,
  TextLayer,
  type PDFDocumentProxy,
  type PDFPageProxy,
  type RenderTask,
} from 'pdfjs-dist';
import type { CSSProperties } from 'react';
import { InkLayer } from './InkLayer';
import { applyHighlights, unwrapMarks } from '../lib/highlight';
import type { AnnotationValueStore } from '../lib/form';
import type { InkSettings, InkStroke, PdfPoint } from '../lib/ink';
import type { PageDims } from '../lib/layout';
import type { PdfLinkService } from '../lib/link-service';
import type { PageMatch } from '../lib/search';

export interface PdfPageProps {
  doc: PDFDocumentProxy;
  /** 1-based page number. */
  pageNumber: number;
  scale: number;
  /** User-applied rotation in degrees, added to the page's intrinsic rotation. */
  rotation?: number;
  /** Overrides window.devicePixelRatio for canvas resolution. */
  devicePixelRatio?: number;
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
  /** Renders interactive AcroForm widgets on the annotation layer. */
  renderForms?: boolean;
  /** pdf.js annotation storage backing form field values. */
  annotationStorage?: AnnotationValueStore | null;
  /** Required for link annotations and internal navigation. */
  linkService?: PdfLinkService | null;
  /** Bumped by programmatic form changes to force an annotation re-render. */
  formVersion?: number;
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

export function PdfPage({
  doc,
  pageNumber,
  scale,
  rotation = 0,
  devicePixelRatio,
  className,
  highlights,
  activeHighlight = -1,
  navigateToActiveAt = 0,
  renderForms = true,
  annotationStorage = null,
  linkService = null,
  formVersion = 0,
  onFormChange,
  inkStrokes,
  inkDrawing = false,
  inkSettings,
  onInkCommit,
  onBaseDimensions,
  onError,
}: PdfPageProps) {
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

    const dpr = devicePixelRatio ?? window.devicePixelRatio ?? 1;

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
  }, [page, viewport, devicePixelRatio, reportError]);

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
      <canvas ref={canvasRef} className={className} role="img" aria-label={`Page ${pageNumber}`} />
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
}
