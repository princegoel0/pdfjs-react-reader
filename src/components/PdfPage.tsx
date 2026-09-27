import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AnnotationEditorLayer,
  AnnotationLayer,
  DrawLayer,
  RenderingCancelledException,
  TextLayer,
  XfaLayer,
  type AnnotationEditorUIManager,
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
import { attachmentMimeType } from '../lib/attachments';
import { downloadBytes } from '../lib/download';
import type { AnnotationValueStore } from '../lib/form';
import type { OptionalContentConfigHandle } from '../lib/optional-content';
import type { InkSettings, InkStroke, PdfPoint } from '../lib/ink';
import type { PageDims } from '../lib/layout';
import type { PdfLinkService } from '../lib/link-service';
import type { PageMatch } from '../lib/search';

/** `RenderParameters` is not exported, and the OC promise's type is only named there. */
type RenderParams = Parameters<PDFPageProxy['render']>[0];

/**
 * The one `DownloadManager` method pdf.js's annotation layer ever calls: double-clicking
 * a paperclip (or `Ctrl/Cmd + Enter` on it) saves the file it carries. Created once
 * because it holds no state, and a fresh object per render would rebuild the whole layer.
 */
const annotationDownloadManager = {
  openOrDownloadData(data: Uint8Array, filename: string): void {
    downloadBytes(data, filename, attachmentMimeType(filename) ?? 'application/octet-stream');
  },
};

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
  /**
   * The document-wide editor manager, published by the annotate feature through
   * its page props. Present means this page builds an editor layer of its own,
   * with a draw layer and the text layer the editors draw against.
   */
  annotationEditorUIManager?: AnnotationEditorUIManager | null;
  /**
   * A tool is armed, so the canvas must leave the editable annotations out —
   * their editors draw them. See {@link FeaturePageProps.annotationEditorEditing}.
   */
  annotationEditorEditing?: boolean;
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
/**
 * Give each of the XFA layer's text runs an element of its own.
 *
 * `XfaLayer.render` hands back bare text nodes, and a search mark cannot wrap one without
 * replacing it, which would leave every reference the next update holds detached. Putting each
 * node in a span is the shape the highlighter already works on, and the span is what survives a
 * mark being added and removed, so re-marking on the next keystroke is not chasing stale DOM.
 */
function wrapXfaText(nodes: Node[] | undefined): HTMLElement[] {
  if (!nodes?.length) return [];
  const spans: HTMLElement[] = [];
  for (const node of nodes) {
    const parent = node.parentNode;
    if (!parent || node.nodeType !== 3) continue;
    const span = document.createElement('span');
    span.dataset.pjsrXfaText = '';
    parent.replaceChild(span, node);
    span.append(node);
    spans.push(span);
  }
  return spans;
}

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
  annotationEditorUIManager = null,
  annotationEditorEditing = false,
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
  const canvasWrapperRef = useRef<HTMLDivElement | null>(null);
  const textLayerRef = useRef<HTMLDivElement | null>(null);
  const annotationRef = useRef<HTMLDivElement | null>(null);
  const editorRef = useRef<HTMLDivElement | null>(null);
  const annotationLayerRef = useRef<AnnotationLayer | null>(null);
  /*
   * Whether this page holds an annotation an editor can take over, read off the fetch the
   * annotation layer already makes.
   *
   * Arming a tool is a document-wide signal, and without this gate every mounted page repaints
   * to drop its editable annotations from the canvas — including the pages that hold none, whose
   * render was pure cost. pdf.js's own viewer guards the same way: `PageView.toggleEditingMode()`
   * returns early unless `hasEditableAnnotations()`.
   *
   * State rather than a ref, because the value has to be part of the render effect's identity for
   * the repaint to be skipped at all — and because a tool armed before the fetch resolves then
   * re-runs the effect once the answer arrives, instead of painting the canvas a copy of an
   * editor. Setting it costs a React render, not a canvas paint: the annotation layer has just
   * been rebuilt in the same tick anyway, and an unchanged value bails out.
   */
  const [hasEditable, setHasEditable] = useState(false);
  const xfaRef = useRef<HTMLDivElement | null>(null);
  const xfaDivRef = useRef<HTMLDivElement | null>(null);
  const taskRef = useRef<RenderTask | null>(null);
  const [page, setPage] = useState<PDFPageProxy | null>(null);
  const [textLayer, setTextLayer] = useState<TextLayer | null>(null);
  // The XFA layer's markable divs, held as state because the highlight effect has to know
  // the moment the layer is built.
  const [xfaDivs, setXfaDivs] = useState<HTMLElement[]>([]);

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

  const editingOnThisPage = annotationEditorEditing && hasEditable;

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
      // While a tool is armed the editors draw the annotations they hold, so the
      // canvas has to stop drawing them too. pdf.js skips exactly the annotations
      // whose `isEditable` the worker reports true, so links, markups and notes
      // that no editor can hold keep painting. Gated on this page actually holding
      // one, because `annotationEditorEditing` is document-wide and a page with
      // nothing editable has no reason to repaint at all — and the gate is part of
      // the effect's identity, not just the parameter, so it skips the repaint
      // rather than repeating it with the same answer.
      isEditing: editingOnThisPage,
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
  }, [
    page,
    viewport,
    devicePixelRatio,
    maxRenderPixels,
    maxRenderSide,
    contentVersion,
    optionalContentConfig,
    editingOnThisPage,
    reportError,
  ]);

  // The layer is built for a page and a turn of it, and re-laid-out for a change of
  // scale; highlight updates are layered on top by the effect below without a rebuild.
  //
  // A pure-XFA page is skipped, as it is in pdf.js's own viewer
  // (`web/pdf_viewer.mjs`: `!pdfPage.isPureXfa`): the XFA layer underneath carries
  // the form's text as real elements, so a text layer over it would be a second
  // copy of every word for selection and for a screen reader to find.
  //
  // `viewport` is deliberately *not* a dependency. It is a new object for a new scale
  // as much as for a new page, and rebuilding on it re-ran the worker's text
  // extraction for the page: measured on the tracemonkey title page, 163 spans cost
  // 39.8 ms to rebuild at 150 % against 1 ms to re-lay out, and the rebuild also tore
  // the search marks out with it, so a zoom step flashed the highlights off and back on.
  // The viewport is read through a ref so the build still sees the one this render
  // laid the page out at, without a scale change pulling the effect back in.
  const viewportRef = useRef(viewport);
  viewportRef.current = viewport;
  useEffect(() => {
    const container = textLayerRef.current;
    const at = viewportRef.current;
    if (!page || !container || !at || page.isPureXfa === true) return;

    let cancelled = false;
    const layer = new TextLayer({
      textContentSource: page.streamTextContent(),
      container,
      viewport: at,
    });

    layer
      .render()
      .then(() => {
        if (!cancelled) setTextLayer(layer);
      })
      .catch((err: unknown) => {
        // Expected when the layer is cancelled mid-render (unmount, page change).
        if (cancelled || (err instanceof Error && err.name === 'AbortException')) return;
        reportError(err);
      });

    return () => {
      cancelled = true;
      setTextLayer(null);
      layer.cancel();
      container.replaceChildren();
    };
  }, [page, rotation, reportError]);

  // The spans pdf.js lays out are positioned in percentages and sized from
  // `--total-scale-factor`, so a scale change needs only `--scale-x` recomputed for
  // each one — which is what `update()` does, synchronously, over the divs already in
  // the layer. It is a no-op when the scale has not moved, so the effect that follows
  // a build costs nothing.
  useEffect(() => {
    if (!textLayer || !viewport) return;
    textLayer.update({ viewport });
  }, [textLayer, viewport]);

  // Annotations (links, markups, form widgets). pdf.js's `AnnotationLayer.update`
  // only repositions the layer, so programmatic form writes force a re-render
  // through `formVersion` instead.
  useEffect(() => {
    const container = annotationRef.current;
    if (!page || !container || !viewport || !linkService) return;

    // Built before the annotations are fetched so that the editor layer, whose
    // effect runs later in the same commit, has the instance to link to. The
    // layer only reads the editable elements when a mode is armed, which is
    // always after the render below has resolved.
    //
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
      // With a manager the layer records which elements an editor can take
      // over, and hands each one to it. Without it, editing an existing
      // annotation would add a second copy instead of moving that one.
      annotationEditorUIManager,
      structTreeLayer: null,
      commentManager: null,
    } as unknown as ConstructorParameters<typeof AnnotationLayer>[0]);
    annotationLayerRef.current = layer;

    let cancelled = false;
    (async () => {
      const annotations = await page.getAnnotations({ intent: 'display' });
      if (cancelled) return;
      // Read here rather than in another effect: this fetch already happens for the layer,
      // and the answer is what the canvas render below needs to know.
      setHasEditable(annotations.some((a) => a.isEditable === true));
      container.replaceChildren();
      await layer.render({
        annotations,
        viewport,
        div: container,
        page,
        linkService,
        annotationStorage,
        // pdf.js reads this off the render params, not the constructor, so a
        // download manager placed on the layer itself is silently ignored.
        downloadManager: annotationDownloadManager,
        renderForms,
        enableScripting: false,
      } as unknown as Parameters<AnnotationLayer['render']>[0]);
    })().catch((err: unknown) => {
      if (cancelled) return;
      reportError(err);
    });

    return () => {
      cancelled = true;
      if (annotationLayerRef.current === layer) {
        annotationLayerRef.current = null;
      }
      container.replaceChildren();
    };
  }, [
    page,
    viewport,
    linkService,
    annotationStorage,
    annotationEditorUIManager,
    renderForms,
    formVersion,
    reportError,
  ]);

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

  // A pure-XFA page has no painted page at all: the canvas for `xfa-sample.pdf`
  // measures zero operators, and the form exists as a DOM tree the worker laid out
  // from the template. `XfaLayer` is what turns that tree into the page, so this is
  // the difference between a document and a blank sheet.
  //
  // The engine's classes (`xfaLayer`, `xfaPage`, `xfaTextfield`, ...) are what the
  // stylesheet keys off, because `XfaLayer.render` overwrites the container's own
  // `class` attribute — which is also why the layer is a child of ours rather than
  // our div itself.
  useEffect(() => {
    const host = xfaRef.current;
    if (!page || !host) return;
    if (page.isPureXfa !== true) {
      if (host.firstChild) host.replaceChildren();
      return;
    }
    if (!viewport) return;

    let cancelled = false;
    (async () => {
      const xfaHtml = await page.getXfa();
      if (cancelled || !xfaHtml) return;
      // Kept across viewport changes: `XfaLayer.render` *appends* a whole tree to the
      // container it is given, so rendering twice into one div doubles the page
      // (measured 20 elements then 40). `update` is the re-render path — it re-applies
      // the transform and nothing else — and rebuilding here would also cost the
      // field that is currently focused.
      let div = xfaDivRef.current;
      if (!div || !div.isConnected) {
        div = document.createElement('div');
        xfaDivRef.current = div;
        host.replaceChildren(div);
      }
      const params = {
        div,
        viewport: viewport.clone({ dontFlip: true }),
        xfaHtml,
        annotationStorage,
        linkService,
        intent: 'display',
      } as unknown as Parameters<typeof XfaLayer.render>[0];
      if (div.childElementCount > 0) {
        XfaLayer.update(params);
      } else {
        const rendered = XfaLayer.render(params) as unknown as { textDivs?: Node[] };
        setXfaDivs(wrapXfaText(rendered?.textDivs));
      }
    })().catch((err: unknown) => {
      if (cancelled) return;
      reportError(err);
    });

    return () => {
      cancelled = true;
    };
  }, [page, viewport, annotationStorage, linkService, reportError]);

  // Annotation editors, when a feature has published a manager. The manager is
  // document-wide and the feature owns it; the draw layer and the editor layer are
  // per page, so this is where they are built. `layer.destroy()` unregisters the
  // layer from the manager, and `render()` re-adopts any editors the manager holds
  // for this page index — which is what lets an edit survive the page being
  // scrolled out of the viewport and back.
  useEffect(() => {
    const container = editorRef.current;
    const textContainer = textLayerRef.current;
    if (!annotationEditorUIManager || !container || !textContainer || !page || !viewport) return;

    // `AnnotationEditorLayer` reads `textLayer.div` while `DrawLayer` observes the
    // node, so the two collaborators take opposite things. Swapping them throws
    // inside the manager's `addLayer` before a single editor exists.
    //
    // The draw layer needs three things pdf.js's own page view gives it and a
    // bare `new DrawLayer` does not: the page's `filterFactory` (highlight and ink
    // editors set CSS filters through it), a `parent` to append its SVG roots to
    // (`setParent` is never called from inside the library, so without it the very
    // first editor throws on `null.append`), and that parent *below* the text layer
    // so a highlight tints the page image without dimming the selectable text.
    const drawLayer = new DrawLayer({
      pageIndex: pageNumber - 1,
      textLayer: textContainer,
      filterFactory: page.filterFactory,
      pageColors: null,
    });
    const canvasWrapper = canvasWrapperRef.current;
    if (canvasWrapper) drawLayer.setParent(canvasWrapper);
    const layer = new AnnotationEditorLayer({
      uiManager: annotationEditorUIManager,
      pageIndex: pageNumber - 1,
      div: container,
      structTreeLayer: null,
      accessibilityManager: null,
      // The link the other way: `layer.enable()` asks this annotation layer for
      // the elements an editor can take over, so leaving it null would make
      // every existing annotation invisible to the editors and let a new one
      // stack on top of it.
      annotationLayer: annotationLayerRef.current,
      drawLayer,
      textLayer: { div: textContainer },
      viewport,
      l10n: null,
    } as unknown as ConstructorParameters<typeof AnnotationEditorLayer>[0]);

    layer.render({ viewport }).catch((err: unknown) => {
      if (err instanceof RenderingCancelledException) return;
      reportError(err);
    });

    return () => {
      layer.destroy();
      drawLayer.destroy();
      container.replaceChildren();
    };
  }, [annotationEditorUIManager, page, viewport, pageNumber, reportError]);

  /*
   * The divs a search mark wraps: the text layer's when there is one, and the XFA layer's
   * when the page was composed from a template. Without the second, searching an XFA form
   * reports "1 of 1" and paints nothing — the index comes from `getTextContent()`, which the
   * engine short-circuits to the XFA tree, while the marks had nowhere to go.
   */
  const markedDivsRef = useRef<HTMLElement[]>([]);
  const lastNavRef = useRef(0);
  useEffect(() => {
    const textContainer = textLayerRef.current;
    const divs = textLayer?.textDivs ?? xfaDivs;
    const container = textLayer ? textContainer : divs.length ? xfaRef.current : null;
    if (!container || !divs.length) return;

    unwrapMarks(markedDivsRef.current);
    markedDivsRef.current = [];
    if (highlights && highlights.length > 0) {
      applyHighlights(divs, highlights, activeHighlight, markedDivsRef.current);
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
  }, [textLayer, xfaDivs, highlights, activeHighlight, navigateToActiveAt]);

  // pdf.js sizes text spans and layer dimensions against
  // --total-scale-factor, which its viewer CSS normally defines; we drive it
  // from the render scale instead.
  const layerStyle = { '--total-scale-factor': String(scale) } as CSSProperties;

  return (
    <>
      {/* The canvas's own box, and the draw layer's parent — pdf.js's page view
          appends its editor SVGs to the canvas wrapper, not to the page, so that
          they paint over the image and under the text. */}
      <div ref={canvasWrapperRef} className="pjsr-canvas-wrapper">
        <canvas
          ref={canvasRef}
          className={className}
          role="img"
          aria-label={formatLabel(labels.pageLabel, { page: pageNumber })}
        />
      </div>
      {/*
       * `textLayer` is not our naming, and it is not cosmetic: pdf.js's editors
       * find the layer a selection lives in with `target.closest('.textLayer')`,
       * six times over, so without that exact class a text selection can never
       * become a highlight. Our own sheet styles `.pjsr-text-layer`.
       */}
      <div ref={textLayerRef} className="pjsr-text-layer textLayer" style={layerStyle} />
      <div
        ref={annotationRef}
        className={`pjsr-annotation-layer${inkDrawing ? ' pjsr-annotation-layer--inert' : ''}`}
        style={layerStyle}
      />
      {annotationEditorUIManager && (
        <div ref={editorRef} className="pjsr-editor-layer" style={layerStyle} />
      )}
      {/* XFA composes at the editor layer's level, which is pdf.js's own ordering
          (`LAYERS_ORDER` puts `xfaLayer` and `annotationEditorLayer` together). */}
      <div ref={xfaRef} className="pjsr-xfa-layer" />
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
