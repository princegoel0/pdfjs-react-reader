/*
 * FR-02, third state: a pinned URL that is not a worker.
 *
 * This is what `ensureWorker` refuses to write. A bundler that cannot rewrite the worker specifier still
 * hands back a plausible-looking URL, and a server with a catch-all route answers a missing file with the
 * app shell — status 200, HTML — which is why the probe checks the content type as well as the status. Two
 * measurable things go wrong if that URL is pinned anyway. It overwrites pdf.js's own Node default, which is
 * the fallback that needs no configuration at all. And in a browser it changes the sentence: pdf.js tries
 * the real worker, fails, and its fake worker then fetches *the same* URL, so the load dies reporting a
 * failed import of a path the reader never wrote — instead of naming `workerSrc`, the option they do own.
 * What it does not close is the `pdfjsWorker` route: a handler already on the page is consulted before any
 * URL is read, so a host that has put one there is unaffected either way, and was measured so.
 *
 * The measurable difference is the message. Here it is a failed dynamic import of a path the reader never
 * wrote and cannot recognise; in the unset state it names `workerSrc`, the option they own. Same outcome,
 * and the unset one is actionable — which is the whole argument for leaving it alone.
 */
import { describe, expect, it } from 'vitest';
import { open, rejection } from './worker.fallback.harness';

describe('FR-02 with a plausible but dead worker URL', () => {
  it('fails without naming the option the reader could act on', async () => {
    const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
    pdfjs.GlobalWorkerOptions.workerSrc = './not-a-worker.worker.mjs';

    const message = await rejection(open(pdfjs));
    expect(message).toMatch(/Setting up fake worker failed/);
    expect(message).not.toContain('workerSrc');
  });
});
