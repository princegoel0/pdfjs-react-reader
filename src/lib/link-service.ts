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
  /**
   * pdf.js's annotation layer calls this when a reader double-clicks a paperclip or
   * an embedded-file link, and a missing method is a TypeError inside its handler
   * rather than a visible failure.
   */
  getAttachmentContent(id: string): Promise<Uint8Array | null>;
  eventBus: {
    dispatch(name: string, args?: unknown): void;
    on(name: string, listener: (args: unknown) => void): void;
    off(name: string, listener: (args: unknown) => void): void;
  };
}

export interface SetOCGStateAction {
  /** pdf.js's own operator list: `ON`, `OFF`, `Toggle` interleaved with group ids. */
  state: readonly unknown[];
  preserveRB?: boolean;
}

export interface CreatePdfLinkServiceOptions {
  /** Base used to resolve relative link targets; usually the document URL. */
  baseUrl?: string;
  /** Called for internal links (in-document destinations). */
  onDestination?: (dest: unknown) => void;
  /** Called when a link resolves to a safe external URL. */
  onExternalLink?: (url: string) => void;
  /**
   * Called when a link or bookmark carries a `SetOCGState` action, i.e. one that
   * switches document layers. Without a handler the click does nothing, which is
   * the failure a reader cannot diagnose: the link is there and it is inert.
   */
  onSetOCGState?: (action: SetOCGStateAction) => void;
  /**
   * Reads one attachment's bytes by the id the engine minted for it. Names come
   * from the catalog's tree; annotation-held files get an `attachmentRef:` id, and
   * only the engine knows which is which.
   */
  getAttachmentContent?: (id: string) => Promise<Uint8Array | null>;
}

const URL_OPTIONS = { addDefaultProtocol: true, tryConvertEncoding: true } as const;

export function createPdfLinkService(options: CreatePdfLinkServiceOptions = {}): PdfLinkService {
  const { baseUrl = null, onDestination, onExternalLink, onSetOCGState, getAttachmentContent } =
    options;

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
    async getAttachmentContent(id) {
      if (!getAttachmentContent) return null;
      try {
        return await getAttachmentContent(id);
      } catch {
        // A file the engine cannot read is not the reader's problem to see: the
        // click does nothing rather than rejecting inside pdf.js's own handler.
        return null;
      }
    },
    executeSetOCGState(action) {
      // pdf.js hands over exactly `{ state, preserveRB }`, the shape
      // `OptionalContentConfig.setOCGState` takes, so this is a relay: the caller
      // owns the config and the repaint that follows.
      if (!onSetOCGState) return;
      const state = (action as SetOCGStateAction | null)?.state;
      if (!Array.isArray(state)) return;
      onSetOCGState({ state, preserveRB: (action as SetOCGStateAction)?.preserveRB !== false });
    },
    eventBus: {
      dispatch() {},
      on() {},
      off() {},
    },
  };
}
