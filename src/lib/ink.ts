import type { PageViewport } from 'pdfjs-dist';

/** A point in PDF user space (unscaled, origin bottom-left). */
export interface PdfPoint {
  x: number;
  y: number;
}

/** A point in CSS pixels within the rendered page box. */
export interface ViewportPoint {
  x: number;
  y: number;
}

export interface InkStroke {
  id: string;
  /** 0-based page index the stroke belongs to. */
  pageIndex: number;
  points: PdfPoint[];
  color: string;
  /** Stroke width in CSS pixels at scale 1, so it grows with zoom. */
  width: number;
}

export interface InkSettings {
  color: string;
  /** Width in CSS pixels at scale 1. */
  width: number;
}

let nextStrokeId = 0;

export function createStrokeId(): string {
  nextStrokeId += 1;
  return `ink-${nextStrokeId}`;
}

/**
 * Drops points closer than `minDistance` to the previous kept point, always
 * keeping the first and last. Keeps stored paths small during fast drawing.
 */
export function simplifyPoints(
  points: ReadonlyArray<PdfPoint>,
  minDistance: number,
): PdfPoint[] {
  if (points.length < 3) return points.map((point) => ({ ...point }));
  const out: PdfPoint[] = [{ ...points[0]! }];
  for (let i = 1; i < points.length - 1; i++) {
    const prev = out[out.length - 1]!;
    const current = points[i]!;
    if (Math.hypot(current.x - prev.x, current.y - prev.y) >= minDistance) {
      out.push({ ...current });
    }
  }
  const last = points[points.length - 1]!;
  const prev = out[out.length - 1]!;
  if (prev !== last && Math.hypot(last.x - prev.x, last.y - prev.y) > 0) {
    out.push({ ...last });
  }
  return out;
}

/**
 * Builds an SVG path `d` from viewport-space points, smoothing with quadratic
 * curves through segment midpoints. A single point renders a dot.
 */
export function strokePathD(points: ReadonlyArray<ViewportPoint>): string {
  if (points.length === 0) return '';
  const first = points[0]!;
  if (points.length === 1) {
    // Degenerate path; callers render a circle for single taps instead.
    return `M ${first.x} ${first.y}`;
  }
  if (points.length === 2) {
    const second = points[1]!;
    return `M ${first.x} ${first.y} L ${second.x} ${second.y}`;
  }
  let d = `M ${first.x} ${first.y}`;
  for (let i = 1; i < points.length - 2; i++) {
    const current = points[i]!;
    const next = points[i + 1]!;
    const midX = (current.x + next.x) / 2;
    const midY = (current.y + next.y) / 2;
    d += ` Q ${current.x} ${current.y} ${midX} ${midY}`;
  }
  const penultimate = points[points.length - 2]!;
  const last = points[points.length - 1]!;
  d += ` Q ${penultimate.x} ${penultimate.y} ${last.x} ${last.y}`;
  return d;
}

export interface PointBounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export function pointsBounds(points: ReadonlyArray<PdfPoint>): PointBounds | null {
  if (points.length === 0) return null;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const point of points) {
    if (point.x < minX) minX = point.x;
    if (point.y < minY) minY = point.y;
    if (point.x > maxX) maxX = point.x;
    if (point.y > maxY) maxY = point.y;
  }
  return { minX, minY, maxX, maxY };
}

/** Axis-aligned bounds of a stroke, padded by its own width. */
export function strokeBounds(stroke: InkStroke): (PointBounds & { width: number; height: number }) | null {
  const bounds = pointsBounds(stroke.points);
  if (!bounds) return null;
  const pad = stroke.width / 2;
  return {
    minX: bounds.minX - pad,
    minY: bounds.minY - pad,
    maxX: bounds.maxX + pad,
    maxY: bounds.maxY + pad,
    width: bounds.maxX - bounds.minX + stroke.width,
    height: bounds.maxY - bounds.minY + stroke.width,
  };
}

/**
 * Paints strokes onto a canvas that was rendered with `viewport`.
 *
 * The path data comes from the same `strokePathD` the SVG layer uses (through
 * `Path2D`), so a signature cannot look different on paper than on screen.
 * Ink lives in React state rather than in the PDF, so printing has to draw it
 * itself.
 */
export function drawInkStrokes(
  ctx: CanvasRenderingContext2D,
  strokes: ReadonlyArray<InkStroke>,
  viewport: PageViewport,
  scale: number,
): void {
  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  for (const stroke of strokes) {
    if (stroke.points.length === 0) continue;
    const points = stroke.points.map((point) => {
      const [x, y] = viewport.convertToViewportPoint(point.x, point.y);
      return { x, y };
    });
    const width = stroke.width * scale;
    ctx.strokeStyle = stroke.color;
    ctx.fillStyle = stroke.color;
    ctx.lineWidth = width;
    if (points.length === 1) {
      ctx.beginPath();
      ctx.arc(points[0]!.x, points[0]!.y, Math.max(0.5, width / 2), 0, Math.PI * 2);
      ctx.fill();
      continue;
    }
    ctx.stroke(new Path2D(strokePathD(points)));
  }
  ctx.restore();
}
