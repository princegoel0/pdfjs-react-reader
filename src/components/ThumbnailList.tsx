import { useEffect, useRef, useState } from 'react';
import { PdfThumbnail } from './PdfThumbnail';
import { useViewer } from './ViewerContext';

// Mirrors the grid in viewer.css: `repeat(auto-fill, minmax(96px, 1fr))`, gap 12.
const MIN_COLUMN = 96;
const GAP = 12;
const MAX_WIDTH = 168;

/**
 * The page strip.
 *
 * What it draws is the viewer's own state — the document, its page count, the page on screen, the rotation
 * of each one, and where a click goes — so none of that is a prop: §5.3's shape is a part that reads the
 * controller it sits under, because a host who has already supplied the controller has nothing to add by
 * wiring the same numbers a second time, to each part, by hand. `width` stays: it is a layout decision the
 * controller does not own, and it is only the starting value — the list measures its own column and follows
 * what it finds.
 */
export function ThumbnailList({ width = 132 }: { width?: number } = {}) {
  const { doc, numPages, currentPage, rotation, pageRotations, scrollToPage } = useViewer();
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

  if (!doc) return null;

  return (
    <div ref={listRef} className="pjsr-thumbnail-list">
      {Array.from({ length: numPages }, (_, i) => (
        <PdfThumbnail
          key={i}
          doc={doc}
          pageNumber={i + 1}
          width={measured ?? width}
          rotation={rotation + (pageRotations?.[i] ?? 0)}
          active={currentPage === i + 1}
          onSelect={scrollToPage}
        />
      ))}
    </div>
  );
}
