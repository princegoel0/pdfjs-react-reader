/*
 * FR-02's "when it is absent, leave pdf.js's own fallback reachable", against the engine rather than a mock.
 *
 * Two realms start in two different states and pdf.js picks which one you are in: measured on 6.3,
 * `GlobalWorkerOptions.workerSrc` is `''` in a browser and `'./pdf.worker.mjs'` in Node, because the engine
 * assigns it from its own `isNodeJS`. So "absent" is not one configuration, and the clause means something
 * different in each:
 *
 * | realm   | field at start         | what `ensureWorker` does           | why                                                    |
 * | :---    | :---                 | :---                             | :---                                                   |
 * | Node    | `'./pdf.worker.mjs'` | nothing — no probe, no write      | the default *is* the fallback: the fake worker is that module |
 * | browser | `''`                 | probes its two candidate URLs     | an empty field is the engine having configured nothing  |
 *
 * This file can only assert the first row, because vitest's `dom` project still runs on Node's module
 * resolution — which is the point of the `toBeTruthy()` below: it fails loudly if the entry ever stops
 * resolving the way this premise assumes, rather than quietly testing a state no realm has. The second row
 * is what the rest of the suite drives by hand: `worker.test.ts` mocks the field empty to exercise the
 * probe, and `usePdfDocument.worker.test.tsx` is the browser-shaped failure where the probe found nothing.
 *
 * Why the first row needs a guard at all: `worker.fallback.deadurl.test.ts` measures what writing a
 * plausible-but-dead URL costs — the load then dies reporting a failed import of a path the reader never
 * wrote, instead of naming `workerSrc`. Nothing failed while the package honoured that default by accident,
 * and a mock whose field starts empty cannot notice the short-circuit being removed.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GlobalWorkerOptions } from 'pdfjs-dist';
import {
  __resetWorkerForTests,
  configuredWorkerSrc,
  ensureWorker,
  workerAutoDetectionFailed,
} from './worker';

/** What pdf.js itself shipped into this realm, captured before this file's reset can rewrite it. */
const ENGINE_DEFAULT = GlobalWorkerOptions.workerSrc;

/** Records every probed URL, the way `worker.test.ts` does, against the un-mocked engine. */
function recordProbes(): string[] {
  const probed: string[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      probed.push(String(input));
      return { ok: false, status: 404, headers: new Headers() } as Response;
    }),
  );
  return probed;
}

beforeEach(() => __resetWorkerForTests());
afterEach(() => vi.unstubAllGlobals());

describe('FR-02 with nothing configured, where pdf.js supplies its own default', () => {
  it('starts from a non-empty engine default, which is what makes this the Node row', () => {
    // The premise of every assertion below. In a browser this same read gives `''` and the probe runs,
    // so if the entry ever stops resolving the way this file assumes, the premise fails rather than the
    // fiction surviving into a green run.
    expect(ENGINE_DEFAULT).toBeTruthy();
  });

  it('leaves the default alone and probes nothing, so the fallback stays reachable', async () => {
    const probed = recordProbes();

    await ensureWorker();

    expect(configuredWorkerSrc()).toBe(ENGINE_DEFAULT);
    expect(probed).toEqual([]);
  });

  it('does not report an auto-detection failure it never ran', async () => {
    recordProbes();
    await ensureWorker();
    // The advice "pin it with `workerSrc`" is only ever appended when detection ran and found nothing
    // (`usePdfDocument.worker.test.tsx` covers that state). Silencing it here is what keeps that message
    // meaning "we looked", which is the whole reason the browser row can trust it.
    expect(workerAutoDetectionFailed()).toBe(false);
  });

  it('takes a host URL over the engine default, which is what makes the option worth having', async () => {
    const probed = recordProbes();
    await ensureWorker('/worker/from-host.mjs');
    expect(configuredWorkerSrc()).toBe('/worker/from-host.mjs');
    expect(probed).toEqual([]);
  });
});
