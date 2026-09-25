type FullscreenDoc = Document & {
  webkitFullscreenElement?: Element | null;
  webkitExitFullscreen?: (() => Promise<void> | void) | undefined;
};

type FullscreenEl = HTMLElement & {
  webkitRequestFullscreen?: (() => Promise<void> | void) | undefined;
};

/** The element currently presented fullscreen, across both spellings. */
export function fullscreenElement(): Element | null {
  const doc = globalThis.document as FullscreenDoc | undefined;
  if (!doc) return null;
  return doc.fullscreenElement ?? doc.webkitFullscreenElement ?? null;
}

/**
 * False on iPhone and iPad Safari, which expose no element-fullscreen method at
 * all — the toolbar uses this to hide the control rather than show one that
 * throws.
 */
export function fullscreenSupported(el?: Element | null): boolean {
  if (typeof document === 'undefined') return false;
  const target = el ?? document.documentElement;
  const candidate = target as FullscreenEl;
  return typeof candidate.requestFullscreen === 'function'
    || typeof candidate.webkitRequestFullscreen === 'function';
}

/**
 * Resolves once the request has been accepted. A request outside a user gesture
 * rejects, which is reported as a rejection rather than swallowed, so the caller
 * can leave its own state untouched.
 *
 * The prefixed path resolves immediately: `webkitRequestFullscreen` fires the
 * request but returns nothing, so callers that need the real state — like the
 * viewer shell — should follow `onFullscreenChange` instead of this promise.
 */
export function enterFullscreen(el: HTMLElement): Promise<void> {
  const candidate = el as FullscreenEl;
  if (typeof candidate.requestFullscreen === 'function') {
    return thenVoid(candidate.requestFullscreen.call(candidate));
  }
  if (typeof candidate.webkitRequestFullscreen === 'function') {
    candidate.webkitRequestFullscreen.call(candidate);
    return Promise.resolve();
  }
  return Promise.reject(new Error('Fullscreen is not supported'));
}

export function exitFullscreen(): Promise<void> {
  const doc = globalThis.document as FullscreenDoc | undefined;
  if (!doc) return Promise.reject(new Error('Fullscreen is not supported'));
  if (typeof doc.exitFullscreen === 'function') {
    return thenVoid(doc.exitFullscreen.call(doc));
  }
  if (typeof doc.webkitExitFullscreen === 'function') {
    doc.webkitExitFullscreen.call(doc);
    return Promise.resolve();
  }
  return Promise.reject(new Error('Fullscreen is not supported'));
}

/** Normalises a method that may return a promise or nothing at all. */
function thenVoid(result: Promise<void> | void): Promise<void> {
  return Promise.resolve(result).then(() => undefined);
}

/** Subscribes to both spellings of the change event; returns an unsubscribe. */
export function onFullscreenChange(callback: () => void, target?: EventTarget): () => void {
  const node = target ?? globalThis.document;
  if (!node) return () => {};
  const names = ['fullscreenchange', 'webkitfullscreenchange'];
  for (const name of names) node.addEventListener(name, callback);
  return () => {
    for (const name of names) node.removeEventListener(name, callback);
  };
}
