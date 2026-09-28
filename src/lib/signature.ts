import type { PdfPoint } from './ink';

/**
 * The geometry between a drawing pad and a signature field.
 *
 * Deliberately free of the writer and of the DOM: the pad a reader draws on knows
 * nothing about the page, and the file knows nothing about a pad, so the mapping
 * between them is the piece worth testing on its own.
 *
 * A mark is held **relative to its box** — x and y from 0 to 1, y up, the way a page
 * counts — rather than in the coordinates of one particular rectangle. That is not
 * decoration: one signature field may be displayed in two places in one document,
 * each with its own box and its own size, and a mark recorded in page coordinates can
 * only ever be right in one of them. Relative to the box, the same mark fills both.
 */

/** A widget's `/Rect`, in PDF user space: `[x0, y0, x1, y1]`, y up. */
export type PageRect = readonly [number, number, number, number];

/** One point of a mark: 0–1 across the box, y up. */
export interface BoxPoint {
  /** 0 at the box's left edge, 1 at its right. */
  x: number;
  /** 0 at the bottom, 1 at the top — a screen's y runs the other way. */
  y: number;
}

export interface PadSize {
  /** CSS pixels. */
  width: number;
  height: number;
}

/**
 * Turn what a pad recorded into a mark.
 *
 * The y axis flips because a pad is a screen (0 at the top) and a page is a PDF (0 at the
 * bottom), which is the only part of this that is not a matter of taste. A point outside
 * the pad is kept where it falls rather than clamped: the appearance is clipped to the box
 * by the format itself, so a stroke that ran off the edge of the pad simply stops at the
 * edge of the signature, which is what a reader who dragged too far expects to see.
 */
export function padToBox(points: ReadonlyArray<PdfPoint>, pad: PadSize): BoxPoint[] {
  if (pad.width <= 0 || pad.height <= 0) return [];
  return points.map((point) => ({
    x: point.x / pad.width,
    y: 1 - point.y / pad.height,
  }));
}

/** Place a mark inside one box, which is what the bytes of an appearance need. */
export function boxToPage(points: ReadonlyArray<BoxPoint>, rect: PageRect): PdfPoint[] {
  const [x0, y0, x1, y1] = rect;
  const width = x1 - x0;
  const height = y1 - y0;
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    return [];
  }
  return points.map((point) => ({ x: x0 + point.x * width, y: y0 + point.y * height }));
}

/** A mark of fewer than two points is a dot, and a dot is not a signature. */
export function isSignable(points: ReadonlyArray<unknown>): boolean {
  return points.length > 1;
}

export interface SignatureStyle {
  /** Stroke width in PDF units, so it is the same physical weight in every field. */
  width?: number;
  /** Each channel 0–1, the way a PDF colour operator takes them. */
  color?: readonly [number, number, number];
}

/**
 * The appearance stream's operators: one stroked polyline through `points`.
 *
 * A path and nothing else — no `/Resources`, no font, no text operator. That is what makes
 * the mark portable: vectors depend on nothing the reader's viewer has to provide, whereas
 * a name rendered as text would need a font embedded and subset here.
 */
export function signatureContent(
  points: ReadonlyArray<PdfPoint>,
  style: SignatureStyle = {},
): string {
  const width = Number.isFinite(style.width) && (style.width as number) > 0 ? (style.width as number) : 2;
  const [r, g, b] = style.color ?? [0, 0, 0];
  const round = (n: number): string => String(Math.round(n * 100) / 100);
  /*
   * A non-finite coordinate would serialise as the literal `NaN` inside the content stream,
   * and the parser then fails on the whole page rather than on the mark. These points come
   * from pointer events here and from a host's own code through the public API, so the
   * filter is a boundary rather than paranoia.
   */
  const usable = points.filter((point) => Number.isFinite(point.x) && Number.isFinite(point.y));
  if (usable.length < 2) return '';
  const path = usable
    .map((point, index) => `${round(point.x)} ${round(point.y)} ${index === 0 ? 'm' : 'l'}`)
    .join(' ');
  // 1 J and 1 j are round caps and round joins, so a fast stroke does not end in a knife.
  return `q ${round(r)} ${round(g)} ${round(b)} RG ${round(width)} w 1 J 1 j ${path} S Q`;
}
