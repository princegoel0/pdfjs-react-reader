/*
 * FR-02's counterfactual: an unset `workerSrc` with no worker code anywhere is a failure, not a fallback.
 *
 * The requirement's clause read "fall back to a main-thread worker rather than failing when neither
 * resolves", which is the state where it does not hold. Main-thread parsing is the same parser the worker
 * runs, so it needs the worker module from somewhere; with nothing pinned and nothing on the page there is
 * nowhere for it to come from. In a browser the engine throws that answer synchronously, from the
 * `getDocument` call itself, before a single page is asked for; in Node the same sentence arrives as a
 * rejected load, which is what this file asserts. `PRD.md`'s FR-02 is now scoped to the states where a
 * fallback really does exist.
 *
 * What this state does *is* still useful to the reader, which is the point of the assertion: the failure
 * names `workerSrc`, the option they own, rather than an internal path. `worker.fallback.deadurl.test.ts`
 * is the version where that sentence is missing, and `usePdfDocument.worker.test.tsx` shows the package
 * adding its own advice to this one.
 */
import { describe, expect, it } from 'vitest';
import { open, rejection } from './worker.fallback.harness';

describe('FR-02 with no worker code anywhere', () => {
  it('fails naming the option the host owns, instead of rendering on the main thread', async () => {
    const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
    pdfjs.GlobalWorkerOptions.workerSrc = '';

    const message = await rejection(open(pdfjs));
    expect(message).toMatch(/Setting up fake worker failed/);
    expect(message).toContain('workerSrc');
  });
});
