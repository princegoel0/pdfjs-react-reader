import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// pdf.js touches DOM globals at import time, which the node test environment
// does not provide. Only the object we assign to is needed here.
const workerOptions = vi.hoisted(() => ({ workerSrc: '' }));
vi.mock('pdfjs-dist', () => ({ GlobalWorkerOptions: workerOptions }));

const { configureWorker, ensureWorker, workerAutoDetectionFailed, __resetWorkerForTests } =
  await import('./worker');

/** Records every probed URL and answers with the statuses supplied. */
function stubFetch(statuses: number[]) {
  const probed: string[] = [];
  let i = 0;
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      probed.push(url);
      const status = statuses[Math.min(i++, statuses.length - 1)] ?? 404;
      return { ok: status >= 200 && status < 300, status } as Response;
    }),
  );
  return probed;
}

describe('worker resolution', () => {
  beforeEach(() => __resetWorkerForTests());
  afterEach(() => vi.unstubAllGlobals());

  it('uses an explicit workerSrc and never probes', async () => {
    const probed = stubFetch([404]);
    await ensureWorker('https://cdn.example/pdf.worker.min.mjs');
    expect(workerOptions.workerSrc).toBe('https://cdn.example/pdf.worker.min.mjs');
    expect(probed).toEqual([]);
  });

  it('honours a workerSrc the app set on GlobalWorkerOptions itself', async () => {
    configureWorker('/pre/pinned.worker.mjs');
    __resetWorkerForTests();
    workerOptions.workerSrc = '/pre/pinned.worker.mjs';
    const probed = stubFetch([200]);
    await ensureWorker();
    expect(probed).toEqual([]);
    expect(workerOptions.workerSrc).toBe('/pre/pinned.worker.mjs');
  });

  it('takes the first candidate that answers', async () => {
    const probed = stubFetch([404, 200]);
    await ensureWorker();
    expect(probed).toHaveLength(2);
    expect(workerOptions.workerSrc).toContain('pdfjs-dist/build/pdf.worker.min.mjs');
    expect(workerAutoDetectionFailed()).toBe(false);
  });

  it('prefers the relative candidate, which bundlers can rewrite', async () => {
    const probed = stubFetch([200]);
    await ensureWorker();
    expect(probed).toHaveLength(1);
    expect(probed[0]).toContain('/pdfjs-dist/build/pdf.worker.min.mjs');
  });

  it('leaves workerSrc unset rather than pointing at a dead URL', async () => {
    stubFetch([404]);
    await ensureWorker();
    expect(workerOptions.workerSrc).toBe('');
    expect(workerAutoDetectionFailed()).toBe(true);
  });

  it('treats a thrown fetch as unreachable and keeps trying', async () => {
    const probed: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        probed.push(String(input));
        throw new TypeError('network blocked');
      }),
    );
    await ensureWorker();
    expect(probed).toHaveLength(2);
    expect(workerAutoDetectionFailed()).toBe(true);
  });

  it('probes once, however many documents load', async () => {
    const probed = stubFetch([200]);
    await ensureWorker();
    await ensureWorker();
    expect(probed).toHaveLength(1);
  });
});
