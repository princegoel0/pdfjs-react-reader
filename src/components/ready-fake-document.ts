/*
 * The stand-in document the ready-shell tests mount against, in its own module and on purpose: it must not
 * import any component.
 *
 * `vi.mock` factories run while the module graph is still being built, so a factory that reaches for a module
 * which itself imports `ViewerController` asks vitest for the mocked `usePdfDocument` in the middle of being
 * asked to produce it — a cycle that does not throw, it simply never finishes. Measured 2026-10-06: the first
 * version of `#247` moved the fake document into `ready-shell-harness.tsx` alongside the mount helper, and both
 * files that mocked through it stopped at collection with no test output at all. The mount helper and this file
 * are therefore separate, and a test file's factory imports only this one.
 *
 * Why a hand-built page proxy rather than the engine: opening real bytes under Node fails fast on two methods
 * the engine calls that V8 ships and Node does not — `Uint8Array.prototype.toHex` (measured `undefined` on Node
 * v24.21.0) in the catalog's fingerprint path, and `Map.prototype.getOrInsertComputed` behind it. Painting is
 * the browser matrix's to measure (`scripts/browser-matrix.mjs`); this is the DOM the shell builds around it.
 */
import { vi } from 'vitest';
import type { PDFDocumentProxy, PDFPageProxy } from 'pdfjs-dist';

export const NUM_PAGES = 4;
export const PAGE_HEIGHT = 792;
/** A 612×792 page at scale 1 in an 800×600 viewport, plus the gap between rows. */
export const ROW_PITCH = 808;

function fakePage(): PDFPageProxy {
  return {
    rotate: 0,
    isPureXfa: false,
    filterFactory: {},
    imageResources: {},
    getViewport: ({ scale = 1 }: { scale?: number }) => ({
      width: 612 * scale,
      height: PAGE_HEIGHT * scale,
      scale,
      rotation: 0,
      rawDims: { pageWidth: 612, pageHeight: PAGE_HEIGHT, pageX: 0, pageY: 0 },
      clone() {
        return this;
      },
      convertToViewportPoint: (x: number, y: number) => [x, PAGE_HEIGHT - y],
    }),
    render: () => ({ promise: Promise.resolve(), cancel: vi.fn() }),
    // A `ReadableStream` of `{items, styles}`, which is what the engine actually hands the text layer.
    streamTextContent: () =>
      new ReadableStream({
        start(controller) {
          controller.enqueue({ items: [], styles: {} });
          controller.close();
        },
      }),
    getAnnotations: async () => [],
    getOperatorList: async () => ({ promise: Promise.resolve() }),
    getXfa: async () => null,
    cleanup: vi.fn(),
  } as unknown as PDFPageProxy;
}

/** One document, shared: a literal built inside a mock re-runs every effect on every render. */
export const fakeReadyDocument = {
  numPages: NUM_PAGES,
  getPage: async () => fakePage(),
  getOptionalContentConfig: async () => ({}),
  getOutline: async () => null,
  getPageLabels: async () => null,
  getMetadata: async () => ({ info: {}, metadata: null }),
  cleanup: () => {},
} as unknown as PDFDocumentProxy;

/** The `usePdfDocument` result a finished load produces, for a test file's `vi.mock` to hand back. */
export function readyLoadResult() {
  return {
    status: 'ready' as const,
    doc: fakeReadyDocument,
    numPages: NUM_PAGES,
    isReady: true,
    error: null,
    capabilities: null,
    passwordRequest: null,
    reload: vi.fn(),
  };
}
