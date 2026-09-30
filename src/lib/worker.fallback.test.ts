/*
 * FR-02: what pdf.js does with the state our resolver leaves behind when nothing resolves.
 *
 * `ensureWorker` probes its candidates and, when every one of them fails, deliberately leaves
 * `GlobalWorkerOptions.workerSrc` unset instead of pinning a plausible-looking dead URL; `worker.test.ts`
 * proves that, and proves `createPdfWorker` then returns `null` having built no worker. What was never
 * proved was the consequence the requirement claims from it — "fall back to a main-thread worker rather
 * than failing". Measured against pdf.js 6.3.289, in a real browser and here, the clause is true with a
 * scope the wording did not carry:
 *
 * | state on a browser                                  | worker threads | outcome                      |
 * | :---                                                | :---           | :---                         |
 * | real `workerSrc`, nothing on the page               | 1 started      | loads, paints                |
 * | `workerSrc` unset, nothing on the page              | 0              | fails naming `workerSrc`     |
 * | `workerSrc` unset, handler on `globalThis.pdfjsWorker` | 0           | loads, paints                |
 * | `workerSrc` pinned to a dead URL                    | 1 attempted    | fails naming a failed fetch  |
 * | `workerSrc` dead, handler on the page               | 0              | loads, paints — the handler is read first |
 *
 * So the fallback is real, but it is conditional: main-thread parsing *is* the worker's own parser, so it
 * needs the worker *code* somewhere the engine can reach without a URL. That is the case in Node, where pdf.js supplies its own
 * `./pdf.worker.mjs` default the moment nothing has pinned one — this test — and the case for a host that
 * has put the handler on the page — `worker.fallback.onpage.test.ts`. An ordinary page with neither gets a
 * clear failure, not a silent main-thread render: `worker.fallback.nocode.test.ts`, whose sibling
 * `worker.fallback.deadurl.test.ts` explains why leaving the value unset is better than guessing at it.
 *
 * What no harness here can reproduce is the pixel half, so it was measured in a browser: a 2D canvas render
 * of this fixture at 400x518 painted 1,728 non-white pixels with zero `Worker` constructed, against the
 * control's 1 worker and the same page painted — the control being what makes a zero mean anything. In Node,
 * paint is asserted as the operator stream instead.
 */
import { describe, expect, it } from 'vitest';
import { open, paint } from './worker.fallback.harness';

describe('FR-02 with no worker pinned', () => {
  it('loads and paints on the main thread, because pdf.js supplies its own worker in Node', async () => {
    const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
    // Not a value this test wrote: it is pdf.js's `isNodeJS` default, which only applies because nothing
    // else pinned a source. Had our resolver's candidate list been written into it instead, this is the
    // default that would have been overwritten.
    expect(pdfjs.GlobalWorkerOptions.workerSrc).toBe('./pdf.worker.mjs');
    // And nothing in this harness could have started a thread worker in the first place.
    expect(typeof Worker).toBe('undefined');

    const doc = await open(pdfjs);
    expect(doc.numPages).toBe(3);

    const rendered = await paint(pdfjs, doc);
    expect(rendered.viewportWidth).toBe(612);
    expect(rendered.showTextOps).toBe(2);
    expect(rendered.text).toContain('Page 1: Introduction');
  });
});
