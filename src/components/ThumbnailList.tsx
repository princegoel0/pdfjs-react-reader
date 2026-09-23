import { useEffect, useRef, useState } from 'react';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import { PdfThumbnail } from './PdfThumbnail';

export interface ThumbnailListProps {
  doc: PDFDocumentProxy;
  numPages: number;
  /** 1-based page highlighted as current. */
  currentPage: number;
  rotation?: number;
  /** Fallback thumbnail width in CSS pixels before the list has measured. */
  width?: number;
  onSelectPage: (pageNumber: number) => void;
}

// Mirrors the grid in viewer.css: `repeat(auto-fill, minmax(96px, 1fr))`, gap 12.
const MIN_COLUMN = 96;
const GAP = 12;
const MAX_WIDTH = 168;

export function ThumbnailList({
  doc,
  numPages,
  currentPage,
  rotation = 0,
  width = 132,
  onSelectPage,
}: ThumbnailListProps) {
  const listRef = useRef<HTMLDivElement | null>(null);
  const [measured, setMeasured] = useState<number | null>(null);

  // The canvas renders at a pixel size chosen from this width, so it has to
  // match the CSS column rather than be stretched by it.
  useEffect(() => {
    const el = listRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) return;
      const available = entry.contentRect.width;
      const columns = Math.max(1, Math.floor((available + GAP) / (MIN_COLUMN + GAP)));
      setMeasured(Math.floor(Math.min(MAX_WIDTH, (available - GAP * (columns - 1)) / columns)));
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // Keep the active thumbnail in view as pages scroll by (nearest-anchored so
  // it doesn't yank the sidebar when the user is browsing thumbnails).
  useEffect(() => {
    const el = listRef.current?.querySelector(`[data-page="${currentPage}"]`);
    el?.scrollIntoView({ block: 'nearest' });
  }, [currentPage]);

  return (
    <div ref={listRef} className="pjsr-thumbnail-list">
      {Array.from({ length: numPages }, (_, i) => (
        <PdfThumbnail
          key={i}
          doc={doc}
          pageNumber={i + 1}
          width={measured ?? width}
          rotation={rotation}
          active={currentPage === i + 1}
          onSelect={onSelectPage}
        />
      ))}
    </div>
  );
}
