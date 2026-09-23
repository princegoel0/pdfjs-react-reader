import { useEffect, useMemo, useRef, useCallback } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import type { PageViewport } from 'pdfjs-dist';
import type { InkSettings, InkStroke, PdfPoint } from '../lib/ink';
import { simplifyPoints, strokePathD } from '../lib/ink';

export interface InkLayerProps {
  /** Strokes belonging to this page. */
  strokes: InkStroke[];
  /** Current page viewport, used to map PDF space onto the screen. */
  viewport: PageViewport;
  scale: number;
  drawing: boolean;
  settings: InkSettings;
  onCommit: (points: PdfPoint[]) => void;
}

interface Line {
  key: string;
  d: string;
  color: string;
  width: number;
  dot: { x: number; y: number; r: number } | null;
}

function toViewport(viewport: PageViewport, point: PdfPoint) {
  const [x, y] = viewport.convertToViewportPoint(point.x, point.y);
  return { x, y };
}

export function InkLayer({
  strokes,
  viewport,
  scale,
  drawing,
  settings,
  onCommit,
}: InkLayerProps) {
  const svgRef = useRef<SVGSVGElement | null>(null);
  const liveRef = useRef<SVGPathElement | null>(null);
  const livePointsRef = useRef<{ x: number; y: number }[]>([]);
  const livePdfRef = useRef<PdfPoint[]>([]);
  const activePointerRef = useRef<number | null>(null);

  const lines = useMemo<Line[]>(() => {
    return strokes.map((stroke) => {
      const points = stroke.points.map((point) => toViewport(viewport, point));
      return {
        key: stroke.id,
        d: strokePathD(points),
        color: stroke.color,
        width: stroke.width * scale,
        dot:
          points.length === 1
            ? { x: points[0]!.x, y: points[0]!.y, r: (stroke.width * scale) / 2 }
            : null,
      };
    });
  }, [strokes, viewport, scale]);

  // A rotation or zoom change while a stroke is in flight would otherwise leave
  // the live path in stale coordinates; drop it.
  useEffect(() => {
    livePointsRef.current = [];
    livePdfRef.current = [];
    if (liveRef.current) liveRef.current.setAttribute('d', '');
  }, [viewport]);

  const paintLive = useCallback(() => {
    const path = liveRef.current;
    if (!path) return;
    path.setAttribute('d', strokePathD(livePointsRef.current));
  }, []);

  const handlePointerDown = useCallback(
    (event: ReactPointerEvent<SVGSVGElement>) => {
      if (!drawing || activePointerRef.current !== null) return;
      if (event.button !== 0 && event.pointerType === 'mouse') return;
      event.preventDefault();
      // Capture keeps the stroke alive when the pointer leaves the page box.
      // It throws if the pointer already ended, which must not abort the stroke.
      try {
        event.currentTarget.setPointerCapture(event.pointerId);
      } catch {
        /* fall back to plain move handling */
      }
      activePointerRef.current = event.pointerId;
      const rect = event.currentTarget.getBoundingClientRect();
      const x = event.clientX - rect.left;
      const y = event.clientY - rect.top;
      const [pdfX, pdfY] = viewport.convertToPdfPoint(x, y);
      livePointsRef.current = [{ x, y }];
      livePdfRef.current = [{ x: pdfX, y: pdfY }];
      paintLive();
    },
    [drawing, viewport, paintLive],
  );

  const handlePointerMove = useCallback(
    (event: ReactPointerEvent<SVGSVGElement>) => {
      if (activePointerRef.current !== event.pointerId) return;
      const rect = event.currentTarget.getBoundingClientRect();
      const x = event.clientX - rect.left;
      const y = event.clientY - rect.top;
      const last = livePointsRef.current[livePointsRef.current.length - 1];
      if (last && Math.hypot(x - last.x, y - last.y) < 1.5) return;
      const [pdfX, pdfY] = viewport.convertToPdfPoint(x, y);
      livePointsRef.current.push({ x, y });
      livePdfRef.current.push({ x: pdfX, y: pdfY });
      paintLive();
    },
    [viewport, paintLive],
  );

  const finish = useCallback(
    (event: ReactPointerEvent<SVGSVGElement>) => {
      if (activePointerRef.current !== event.pointerId) return;
      activePointerRef.current = null;
      const points = livePdfRef.current;
      livePointsRef.current = [];
      livePdfRef.current = [];
      if (liveRef.current) liveRef.current.setAttribute('d', '');
      if (points.length === 0) return;
      // 1 CSS px at the current scale, expressed in PDF units.
      onCommit(simplifyPoints(points, 1 / scale));
    },
    [onCommit, scale],
  );

  return (
    <svg
      ref={svgRef}
      className="pjsr-ink-layer"
      data-drawing={drawing || undefined}
      width={Math.max(1, Math.floor(viewport.width))}
      height={Math.max(1, Math.floor(viewport.height))}
      viewBox={`0 0 ${Math.max(1, Math.floor(viewport.width))} ${Math.max(1, Math.floor(viewport.height))}`}
      aria-hidden="true"
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={finish}
      onPointerCancel={finish}
    >
      {lines.map((line) =>
        line.dot ? (
          <circle
            key={line.key}
            cx={line.dot.x}
            cy={line.dot.y}
            r={line.dot.r}
            fill={line.color}
          />
        ) : (
          <path
            key={line.key}
            d={line.d}
            stroke={line.color}
            strokeWidth={line.width}
            fill="none"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        ),
      )}
      <path
        ref={liveRef}
        d=""
        stroke={settings.color}
        strokeWidth={settings.width * scale}
        fill="none"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
