/** Discrete zoom steps offered by the toolbar select. */
export const ZOOM_LEVELS = [
  0.25, 0.33, 0.5, 0.66, 0.75, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2, 2.5, 3, 4, 5,
];

export const MIN_SCALE = ZOOM_LEVELS[0]!;
export const MAX_SCALE = ZOOM_LEVELS[ZOOM_LEVELS.length - 1]!;

/** Next discrete step above `scale`, or `scale` itself when already at the top. */
export function nextZoomUp(scale: number): number {
  return ZOOM_LEVELS.find((z) => z > scale + 0.001) ?? MAX_SCALE;
}

/** Next discrete step below `scale`, or `scale` itself when already at the bottom. */
export function nextZoomDown(scale: number): number {
  return [...ZOOM_LEVELS].reverse().find((z) => z < scale - 0.001) ?? MIN_SCALE;
}

export function clampScale(scale: number): number {
  // Only NaN needs a special case: an infinite request still means "as far as
  // it goes", so let the min/max clamps resolve it to an end of the ladder.
  if (Number.isNaN(scale)) return MIN_SCALE;
  return Math.min(MAX_SCALE, Math.max(MIN_SCALE, scale));
}

/**
 * Multiplies the *effective* scale, so zooming while in a fit mode starts from
 * what is on screen rather than from an invisible 1.0.
 */
export function zoomBy(resolvedScale: number, factor: number): number {
  return clampScale(resolvedScale * factor);
}

/**
 * Parses free-text zoom as a percentage, matching the label the toolbar already
 * shows: `150` and `150%` both mean 1.5. Returns `null` for anything that is
 * not a number, so the caller can reject the edit instead of silently snapping.
 */
export function parseZoomPercent(text: string): number | null {
  const trimmed = text.trim().replace(/%$/, '');
  if (trimmed === '') return null;
  const value = Number(trimmed);
  if (!Number.isFinite(value) || value <= 0) return null;
  return clampScale(value / 100);
}

export function formatZoomPercent(scale: number): string {
  return String(Math.round(scale * 100));
}

/**
 * Scale factor for a pinch gesture: the ratio of the current to the previous
 * finger distance, applied to the scale the gesture started from. Guards the
 * divide-by-zero and non-finite cases that a stray single-touch event can cause.
 */
export function pinchScale(
  startScale: number,
  previousDistance: number,
  currentDistance: number,
): number {
  if (!Number.isFinite(previousDistance) || previousDistance <= 0) return startScale;
  if (!Number.isFinite(currentDistance) || currentDistance <= 0) return startScale;
  return clampScale(startScale * (currentDistance / previousDistance));
}

/**
 * Scale delta from a wheel event. `ctrlKey` is set by every mainstream browser
 * for trackpad pinch, so this covers pinch-to-zoom on laptops as well as
 * Ctrl+wheel on a mouse.
 */
export function wheelScale(
  startScale: number,
  deltaY: number,
  sensitivity = 0.0015,
): number {
  return clampScale(startScale * Math.exp(-deltaY * sensitivity));
}
