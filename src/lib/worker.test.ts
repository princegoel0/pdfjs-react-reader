import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// pdf.js touches DOM globals at import time, which the node test environment
// does not provide. Only the pieces we assign to and construct are stubbed.
const mocks = vi.hoisted(() => {
  const constructed: Array<Record<string, unknown>> = [];
  const destroyed: unknown[] = [];
  class PDFWorkerStub {
    constructor(params: Record<string, unknown>) {
      constructed.push(params);
    }
    destroy() {
      destroyed.push(this);
    }
  }
  return {
    workerOptions: { workerSrc: '' as string, workerPort: null as unknown },
    PDFWorker: PDFWorkerStub,
    constructed,
    destroyed,
    workers: [] as Array<{ url: string; options: unknown; terminated: boolean }>,
  };
});

vi.mock('pdfjs-dist', () => ({
  GlobalWorkerOptions: mocks.workerOptions,
  PDFWorker: mocks.PDFWorker,
}));

const {
  configureTrustedTypes,
  configureWorker,
  createPdfWorker,
  ensureWorker,
  isTrustedTypesConfigured,
  workerAutoDetectionFailed,
  __resetWorkerForTests,
} = await import('./worker');

beforeEach(() => {
  mocks.constructed.length = 0;
  mocks.destroyed.length = 0;
  mocks.workers.length = 0;
});

/** Stands in for `new Worker()`, recording what the policy produced. */
function stubWorker() {
  vi.stubGlobal(
    'Worker',
    class {
      record: { url: string; options: unknown; terminated: boolean };
      constructor(
        url: string,
        options: unknown,
      ) {
        this.record = { url: String(url), options, terminated: false };
        mocks.workers.push(this.record);
      }
      terminate() {
        this.record.terminated = true;
      }
    },
  );
}

/** Records every probed URL and answers with the statuses supplied. */
function stubFetch(statuses: number[], contentType = 'text/javascript') {
  const probed: string[] = [];
  let i = 0;
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      probed.push(url);
      const status = statuses[Math.min(i++, statuses.length - 1)] ?? 404;
      return {
        ok: status >= 200 && status < 300,
        status,
        headers: new Headers({ 'content-type': contentType }),
      } as Response;
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
    expect(mocks.workerOptions.workerSrc).toBe('https://cdn.example/pdf.worker.min.mjs');
    expect(probed).toEqual([]);
  });

  it('honours a workerSrc the app set on GlobalWorkerOptions itself', async () => {
    configureWorker('/pre/pinned.worker.mjs');
    __resetWorkerForTests();
    mocks.workerOptions.workerSrc = '/pre/pinned.worker.mjs';
    const probed = stubFetch([200]);
    await ensureWorker();
    expect(probed).toEqual([]);
    expect(mocks.workerOptions.workerSrc).toBe('/pre/pinned.worker.mjs');
  });

  it('takes the first candidate that answers', async () => {
    const probed = stubFetch([404, 200]);
    await ensureWorker();
    expect(probed).toHaveLength(2);
    expect(mocks.workerOptions.workerSrc).toContain('pdfjs-dist/build/pdf.worker.min.mjs');
    expect(workerAutoDetectionFailed()).toBe(false);
  });

  it('prefers the relative candidate, which bundlers can rewrite', async () => {
    const probed = stubFetch([200]);
    await ensureWorker();
    expect(probed).toHaveLength(1);
    expect(probed[0]).toContain('/pdfjs-dist/build/pdf.worker.min.mjs');
  });

  // A server with a catch-all route answers a missing file with the app shell,
  // so status alone cannot tell a worker from `index.html`.
  it('skips a candidate that answers 200 with HTML', async () => {
    const probed = stubFetch([200, 200], 'text/html');
    await ensureWorker();
    expect(probed).toHaveLength(2);
    expect(mocks.workerOptions.workerSrc).toBe('');
    expect(workerAutoDetectionFailed()).toBe(true);
  });

  it('leaves workerSrc unset rather than pointing at a dead URL', async () => {
    stubFetch([404]);
    await ensureWorker();
    expect(mocks.workerOptions.workerSrc).toBe('');
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

/** Stub of `trustedTypes`; the policy it hands out tags every URL it signs. */
function stubTrustedTypes() {
  const created: string[] = [];
  vi.stubGlobal('trustedTypes', {
    createPolicy(policyName: string) {
      created.push(policyName);
      return { createScriptURL: (url: string) => `signed(${url})` };
    },
  });
  return created;
}

describe('Trusted Types', () => {
  beforeEach(() => __resetWorkerForTests());
  afterEach(() => vi.unstubAllGlobals());

  it('refuses when the browser has no trustedTypes global', () => {
    expect(isTrustedTypesConfigured()).toBe(false);
    expect(() => configureTrustedTypes()).toThrow(/trustedTypes/);
  });

  it('creates the policy the page names', () => {
    const created = stubTrustedTypes();
    configureTrustedTypes('app#worker');
    expect(created).toEqual(['app#worker']);
    expect(isTrustedTypesConfigured()).toBe(true);
  });

  it('leaves pdf.js to build its own worker while no policy exists', async () => {
    stubFetch([200]);
    stubWorker();
    expect(await createPdfWorker()).toBeNull();
    expect(mocks.workers).toHaveLength(0);
  });

  it('signs the worker URL and owns the worker it constructs', async () => {
    stubTrustedTypes();
    configureTrustedTypes('app#worker');
    const probed = stubFetch([200]);
    stubWorker();

    const owned = await createPdfWorker();
    expect(probed).toHaveLength(1);
    expect(mocks.workers).toHaveLength(1);
    // The URL reaches `new Worker` only through the policy.
    expect(mocks.workers[0]?.url).toBe(`signed(${mocks.workerOptions.workerSrc})`);
    expect(mocks.workers[0]?.options).toEqual({ type: 'module' });
    expect(mocks.constructed).toHaveLength(1);

    owned?.dispose();
    expect(mocks.workers[0]?.terminated).toBe(true);
    expect(mocks.destroyed).toHaveLength(1);
  });

  it('wraps a cross-origin worker URL the way pdf.js does', async () => {
    stubTrustedTypes();
    configureTrustedTypes('app#worker');
    stubFetch([200]);
    stubWorker();
    Reflect.set(globalThis, 'location', { href: 'https://app.example/index.html' });
    try {
      const owned = await createPdfWorker();
      expect(mocks.workers[0]?.url.startsWith('signed(blob:')).toBe(true);
      owned?.dispose();
    } finally {
      Reflect.deleteProperty(globalThis, 'location');
    }
  });
});
