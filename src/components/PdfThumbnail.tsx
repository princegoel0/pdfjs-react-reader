import { useEffect, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import {
  RenderingCancelledException,
  XfaLayer,
  type PDFDocumentProxy,
  type PDFPageProxy,
  type RenderTask,
} from 'pdfjs-dist';
import { formatLabel } from '../lib/labels';
import { onAbort } from '../lib/abort';
import { useLabels } from './labels-context';
import { useDevicePixelRatio } from './useDevicePixelRatio';

/** What `page.getXfa()` hands back: the template's tree, already merged with the datasets. */
type XfaTree = NonNullable<Awaited<ReturnType<PDFPageProxy['getXfa']>>>;

export interface PdfThumbnailProps {
  doc: PDFDocumentProxy;
  /** 1-based page number. */
  pageNumber: number;
  /** Thumbnail width in CSS pixels. */
  width: number;
  /** User-applied rotation in degrees, added to the page's intrinsic rotation. */
  rotation?: number;
  active?: boolean;
  onSelect?: (pageNumber: number) => void;
  /**
   * Cancel this card's work — the proxy fetch, the canvas render and the form composition. A sidebar of
   * forty thumbnails is where an abort saves the most, and an abort runs exactly what scrolling the card
   * out of view runs.
   */
  signal?: AbortSignal;
}

export function PdfThumbnail({
  doc,
  pageNumber,
  width,
  rotation = 0,
  active = false,
  onSelect,
  signal,
}: PdfThumbnailProps) {
  const labels = useLabels();
  // The card's buffer is sized by the display density too, so a window moving to another screen re-paints
  // it at the new one rather than leaving a 1× thumbnail on a 2× panel (FR-07).
  const pixelRatio = useDevicePixelRatio();
  // Read by ref so a host rebuilding its controller cannot re-run the render effects.
  const signalRef = useRef(signal);
  signalRef.current = signal;
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const xfaRef = useRef<HTMLDivElement | null>(null);
  const [visible, setVisible] = useState(false);
  // Height/width ratio once measured, so the placeholder doesn't jump.
  const [ratio, setRatio] = useState<number | null>(null);
  /*
   * The page's XFA tree and the CSS scale it is to be drawn at, held together because
   * the two must agree: `XfaLayer.render` lays the template out against the viewport it
   * is given, so a tree painted at one scale in a box sized for another is a form with
   * its widgets in the wrong place.
   *
   * It is state rather than a direct render from the effect below because the div the
   * layer writes into has to be in the document first, and this one only exists for a
   * page composed from a template. Such a page has no painted page at all — its canvas
   * measures zero operators, which is what made every thumbnail of an XFA form a blank
   * card.
   */
  const [xfa, setXfa] = useState<{ html: XfaTree; scale: number } | null>(null);

  useEffect(() => {
    const el = buttonRef.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      (entries) => setVisible(entries.some((entry) => entry.isIntersecting)),
      { rootMargin: '300px 0px' },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!visible || !canvas) return;
    // FR-36: a token that is already aborted performs no work. The subscription below is what turns an abort
    // into this effect's own teardown, but it is registered after the fetch starts, so on a card built into a
    // sidebar the host already cancelled the first page fetch would still have been asked for.
    if (signalRef.current?.aborted) return;
    let cancelled = false;
    let task: RenderTask | null = null;

    (async () => {
      const page = await doc.getPage(pageNumber);
      if (cancelled) return;
      const intrinsicRotation = (page.rotate + rotation) % 360;
      const base = page.getViewport({ scale: 1, rotation: intrinsicRotation });
      setRatio((prev) => {
        const next = base.height / base.width;
        return prev !== next ? next : prev;
      });
      const scale = (width / base.width) * pixelRatio;
      const viewport = page.getViewport({ scale, rotation: intrinsicRotation });
      // The layer is DOM, so it is sized in CSS pixels: the device ratio that grows the
      // canvas buffer to keep the bitmap crisp would only blow the form out of the card.
      const tree = page.isPureXfa === true ? await page.getXfa() : null;
      if (cancelled) return;
      setXfa(tree ? { html: tree, scale: width / base.width } : null);
      canvas.width = Math.max(1, Math.floor(viewport.width));
      canvas.height = Math.max(1, Math.floor(viewport.height));
      task = page.render({ canvas, viewport, background: '#ffffff' });
      try {
        await task.promise;
      } catch (err) {
        if (!cancelled && !(err instanceof RenderingCancelledException)) {
          console.error(err);
        }
      }
    })().catch(() => {
      // A failed thumbnail must not break the sidebar.
    });

    const stop = () => {
      cancelled = true;
      task?.cancel();
      canvas.width = 0;
      canvas.height = 0;
      setXfa(null);
    };
    const offAbort = onAbort(signalRef.current, stop);

    return () => {
      offAbort();
      stop();
    };
  }, [visible, doc, pageNumber, width, rotation, pixelRatio]);

  // The form itself, composed over the blank canvas the loop above painted. What the
  // page shows is what the thumbnail shows, at the thumbnail's scale — which is the same
  // call `PdfPage` makes, with the same `dontFlip` viewport and the document's own
  // storage, so a name typed into the form reads in the sidebar too.
  useEffect(() => {
    const host = xfaRef.current;
    if (!host || !xfa) return;
    // The same rule as the canvas effect: the second half of this component's abort is not started either when
    // the host has already stopped caring. The tree it would compose is DOM the card no longer shows.
    if (signalRef.current?.aborted) return;
    let cancelled = false;

    (async () => {
      const page = await doc.getPage(pageNumber);
      if (cancelled || !page || !host.isConnected) return;
      const viewport = page.getViewport({
        scale: xfa.scale,
        rotation: (page.rotate + rotation) % 360,
      });
      const div = document.createElement('div');
      // `XfaLayer.render` appends, so a container that already holds a form would gain
      // a second one. The tree is thrown away with the thumbnail either way.
      host.replaceChildren(div);
      XfaLayer.render({
        div,
        viewport: viewport.clone({ dontFlip: true }),
        xfaHtml: xfa.html,
        annotationStorage: doc.annotationStorage ?? null,
        linkService: null,
        intent: 'display',
      } as unknown as Parameters<typeof XfaLayer.render>[0]);
      /*
       * A composed form is live DOM, and this one sits inside a button, so its fields
       * would be tabbable, focusable and read out — nine times over on a nine-page
       * document, none of it reachable by eye. `inert` says that on every browser that
       * knows it (iOS 14 and 15 do not), and the walk says it on the ones that don't.
       * The host carries the flag, which is also the node `aria-hidden` is on.
       */
      host.inert = true;
      for (const field of div.querySelectorAll<HTMLElement>('input, select, textarea, button, a[href]')) {
        field.tabIndex = -1;
      }
    })().catch(() => {
      // A thumbnail that cannot compose its form leaves the card blank, as it was.
    });

    const stop = () => {
      cancelled = true;
      xfaRef.current?.replaceChildren();
    };
    const offAbort = onAbort(signalRef.current, stop);

    return () => {
      offAbort();
      stop();
    };
  }, [xfa, doc, pageNumber, rotation]);

  return (
    <button
      ref={buttonRef}
      type="button"
      className={`pjsr-thumbnail${active ? ' pjsr-thumbnail--active' : ''}`}
      data-page={pageNumber}
      aria-label={formatLabel(labels.goToPage, { page: pageNumber })}
      aria-current={active ? 'true' : undefined}
      onClick={() => onSelect?.(pageNumber)}
    >
      <span
        className="pjsr-thumbnail-frame"
        style={{ aspectRatio: ratio ? `1 / ${ratio}` : undefined }}
      >
        <canvas ref={canvasRef} className="pjsr-thumbnail-canvas" />
        {/* The sheet the form is composed onto, only for a page that has one. The class
            is the page's own, so the widget styling that makes a form legible on the
            page carries into the card, and the scale is the one the tree was fetched
            with — `setLayerDimensions` writes the layer's size in terms of it. */}
        {xfa && (
          <div
            ref={xfaRef}
            className="pjsr-xfa-layer pjsr-thumbnail-xfa"
            aria-hidden="true"
            style={{ '--total-scale-factor': String(xfa.scale) } as CSSProperties}
          />
        )}
      </span>
      <span className="pjsr-thumbnail-label">{pageNumber}</span>
    </button>
  );
}
