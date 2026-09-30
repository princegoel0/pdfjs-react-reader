/*
 * FR-02, second state: no worker URL anywhere, but the worker code is on the page.
 *
 * This is the configuration the requirement's "fall back to a main-thread worker" clause actually
 * describes, and the only one in a browser where an unset `workerSrc` still paints: pdf.js reads
 * `globalThis.pdfjsWorker` before it looks at any URL, so the parser runs in-process and no worker thread
 * is started. A host reaches it by importing the worker module itself, and that is a host decision: it puts
 * the engine's other half — 375.3 kB gzipped in `pdfjs-dist` 6.3.289 — on the main chunk, so this package
 * does not make it on anyone's behalf.
 *
 * Measured in a real browser too, which is where the mechanism matters: the same fixture painted 1,728
 * non-white pixels on a 400x518 canvas with zero `Worker` constructed. See `worker.fallback.test.ts` for
 * the table and for why this scenario needs its own process.
 */
import { describe, expect, it } from 'vitest';
import { open, paint } from './worker.fallback.harness';

describe('FR-02 with the worker code already on the page', () => {
  it('paints without any worker URL at all', async () => {
    const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
    // The worker module is not part of pdf.js's public type surface — no declaration file beside it — so the
    // one import this test needs has to be excused rather than typed.
    // @ts-expect-error the worker module ships no types
    const { WorkerMessageHandler } = await import('pdfjs-dist/legacy/build/pdf.worker.mjs');
    Reflect.set(globalThis, 'pdfjsWorker', { WorkerMessageHandler });
    // The state `ensureWorker` leaves when every candidate 404s, written by hand because the browser
    // entry cannot be imported in Node.
    pdfjs.GlobalWorkerOptions.workerSrc = '';

    const doc = await open(pdfjs);
    expect(doc.numPages).toBe(3);

    const rendered = await paint(pdfjs, doc);
    expect(rendered.showTextOps).toBe(2);
    expect(rendered.text).toContain('pdfjs-react-reader Phase 4 fixture');
  });
});
