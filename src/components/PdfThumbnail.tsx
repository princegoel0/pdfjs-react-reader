import { useEffect, useRef, useState } from 'react';
import {
  RenderingCancelledException,
  type PDFDocumentProxy,
  type RenderTask,
} from 'pdfjs-dist';

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
}

export function PdfThumbnail({
  doc,
  pageNumber,
  width,
  rotation = 0,
  active = false,
  onSelect,
}: PdfThumbnailProps) {
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [visible, setVisible] = useState(false);
  // Height/width ratio once measured, so the placeholder doesn't jump.
  const [ratio, setRatio] = useState<number | null>(null);

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
      const dpr = window.devicePixelRatio ?? 1;
      const scale = (width / base.width) * dpr;
      const viewport = page.getViewport({ scale, rotation: intrinsicRotation });
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

    return () => {
      cancelled = true;
      task?.cancel();
      canvas.width = 0;
      canvas.height = 0;
    };
  }, [visible, doc, pageNumber, width, rotation]);

  return (
    <button
      ref={buttonRef}
      type="button"
      className={`pjsr-thumbnail${active ? ' pjsr-thumbnail--active' : ''}`}
      data-page={pageNumber}
      aria-label={`Go to page ${pageNumber}`}
      aria-current={active ? 'true' : undefined}
      onClick={() => onSelect?.(pageNumber)}
    >
      <span
        className="pjsr-thumbnail-frame"
        style={{ aspectRatio: ratio ? `1 / ${ratio}` : undefined }}
      >
        <canvas ref={canvasRef} className="pjsr-thumbnail-canvas" />
      </span>
      <span className="pjsr-thumbnail-label">{pageNumber}</span>
    </button>
  );
}
