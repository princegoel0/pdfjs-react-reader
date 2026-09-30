/*
 * Shared plumbing for the four FR-02 no-worker tests.
 *
 * Each of them lives in its own file for one reason: pdf.js resolves its main-thread worker exactly once
 * per module instance — `PDFWorker._setupFakeWorkerGlobal` memoises the promise on the class, and caches a
 * rejection as readily as a resolution. A scenario's configuration therefore only counts on the first load
 * in a process, and one pdf.js per process is what vitest's file isolation gives. Four scenarios, four
 * files, no shared instance.
 *
 * Provenance of the set, because the two halves of FR-02 meet in a shared *state* rather than a shared
 * object: `ensureWorker` writes the browser entry's `GlobalWorkerOptions`, and that entry cannot be
 * imported in Node at all. These files therefore start from the `workerSrc` our resolver leaves behind —
 * unset, or a URL it would never have written — on the legacy entry. `worker.test.ts` pins the resolver
 * half that produces it.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { PDFDocumentProxy, PDFPageProxy } from 'pdfjs-dist';

export type Engine = typeof import('pdfjs-dist/legacy/build/pdf.mjs');

/** Three pages, page 1 set in Helvetica, written by `scripts/make-outline-pdf.mjs`. */
export function fixture(): Uint8Array {
  return new Uint8Array(
    readFileSync(join(process.cwd(), 'playground', 'fixtures', 'outline-sample.pdf')),
  );
}

/**
 * The shape of the call `usePdfDocument` makes on the no-worker path: the same source, the same two engine
 * switches, no `worker`, because there is none. The asset URLs the hook also passes are left out — this
 * fixture is Latin-only and needs no cmaps, and Node cannot serve the standard-font data whichever way it is
 * spelled. `verbosity: 0` hides the warning that omission raises, which changes neither the operator count
 * nor the extracted text.
 */
export function open(pdfjs: Engine): Promise<PDFDocumentProxy> {
  return pdfjs.getDocument({
    data: fixture(),
    cMapPacked: true,
    enableXfa: true,
    verbosity: 0,
  }).promise;
}

/**
 * Page 1 read the way a paint would read it: the box, the operator stream a canvas consumes, and the
 * glyphs that stream resolved to. Pixels are not available in this harness — see the browser pass recorded
 * in `worker.fallback.test.ts`.
 */
export async function paint(pdfjs: Engine, doc: PDFDocumentProxy) {
  const page: PDFPageProxy = await doc.getPage(1);
  const ops = await page.getOperatorList();
  const text = (await page.getTextContent()).items
    .map((item) => ('str' in item ? item.str : ''))
    .join(' ');
  return {
    viewportWidth: page.getViewport({ scale: 1 }).width,
    showTextOps: ops.fnArray.filter((fn) => fn === pdfjs.OPS.showText).length,
    text,
  };
}

/** The engine's failure sentence, so a test can assert on the words a reader would actually see. */
export async function rejection(load: Promise<unknown>): Promise<string> {
  return load.then(
    () => '',
    (error: unknown) => String((error as Error).message),
  );
}
