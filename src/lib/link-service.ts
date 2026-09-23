import { createValidAbsoluteUrl } from 'pdfjs-dist';

/**
 * The subset of `PDFLinkService` that pdf.js's AnnotationLayer calls into.
 * Providing our own keeps the annotation layer functional (links render and
 * internal destinations navigate) without pulling in the full viewer.
 */
export interface PdfLinkService {
  addLinkAttributes(element: HTMLAnchorElement, url: string | null, newWindow?: boolean): void;
  getAnchorUrl(url: string): string;
  getDestinationHash(dest: unknown): string;
  goToDestination(dest: unknown): void;
  executeNamedAction(action: unknown): void;
  executeSetOCGState(action: unknown): void;
  eventBus: {
    dispatch(name: string, args?: unknown): void;
    on(name: string, listener: (args: unknown) => void): void;
    off(name: string, listener: (args: unknown) => void): void;
  };
}

export interface CreatePdfLinkServiceOptions {
  /** Base used to resolve relative link targets; usually the document URL. */
  baseUrl?: string;
  /** Called for internal links (in-document destinations). */
  onDestination?: (dest: unknown) => void;
  /** Called when a link resolves to a safe external URL. */
  onExternalLink?: (url: string) => void;
}

const URL_OPTIONS = { addDefaultProtocol: true, tryConvertEncoding: true } as const;

export function createPdfLinkService(options: CreatePdfLinkServiceOptions = {}): PdfLinkService {
  const { baseUrl = null, onDestination, onExternalLink } = options;

  const resolve = (url: string | null): URL | null => {
    if (!url) return null;
    return createValidAbsoluteUrl(url, baseUrl ?? undefined, URL_OPTIONS) ?? null;
  };

  return {
    addLinkAttributes(element, url, newWindow = false) {
      const valid = resolve(url);
      if (!valid) {
        // Unparseable or disallowed scheme: render inert rather than risky.
        element.href = '#';
        element.rel = 'noopener noreferrer';
        return;
      }
      element.href = valid.href;
      // External targets always get a fresh browsing context with no opener.
      element.target = newWindow ? '_blank' : '_self';
      element.rel = 'noopener noreferrer';
      element.title = valid.href;
      onExternalLink?.(valid.href);
    },
    getAnchorUrl(url) {
      // pdf.js assigns the result straight to `link.href`; an empty string
      // would resolve to the host page and reload the app if a click ever
      // slipped past its own handler, so fall back to a neutral fragment.
      return resolve(url)?.href ?? '#';
    },
    getDestinationHash() {
      // No hash-based routing in the headless layer; see `getAnchorUrl`.
      return '#';
    },
    goToDestination(dest) {
      onDestination?.(dest);
    },
    executeNamedAction() {
      // Named actions (PrintPage, NextPage, …) are a no-op without scripting.
    },
    executeSetOCGState() {
      // Optional-content-group toggling is out of scope for v1.
    },
    eventBus: {
      dispatch() {},
      on() {},
      off() {},
    },
  };
}
