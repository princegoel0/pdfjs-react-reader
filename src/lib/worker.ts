import { GlobalWorkerOptions, PDFWorker } from 'pdfjs-dist';
import { PdfError, describeOrigin } from './errors';

/**
 * FR-02: the worker URL is a per-realm singleton, so a second viewer that asks for a
 * different one is not adding a configuration — it is changing the first's.
 *
 * pdf.js reads `GlobalWorkerOptions.workerSrc` when it builds a worker, which means a load
 * that starts later re-points every page fetched after it. The failure therefore surfaces in
 * the wrong place and at the wrong time to attribute: viewer A scrolls a page in after viewer
 * B mounted, and A's page is parsed by B's worker. So the claim is taken at the one moment
 * where the conflict is still about the viewer that caused it, and the load that cannot have
 * the realm's worker URL is the one that says so.
 *
 * An empty `workerSrc` is not a claim: that is pdf.js's own fallback (the Node default, or a
 * host that put the handler on `globalThis`), and two viewers with no URL agree.
 */
const activeWorkerSrcs = new Map<string, number>();

export type WorkerSrcClaim = { ok: true; release: () => void } | { ok: false; error: PdfError };

/**
 * A worker URL as pdf.js will actually fetch it.
 *
 * Measured on `pdfjs-dist@6.3`: the value pdf.js ships itself is `''` in a browser and
 * `'./pdf.worker.mjs'` in Node, so what is in force can be *relative*, and pdf.js resolves a relative
 * value against the page when it builds the worker. Two viewers agreeing on `./pdf.worker.mjs` and
 * `https://app.example/pdf.worker.mjs` are therefore describing the same worker, and a conflict test on
 * the raw strings would refuse a page that has no conflict at all.
 */
function resolvedWorkerSrc(src: string): string {
  const base = (globalThis as typeof globalThis & { document?: { baseURI?: string } }).document
    ?.baseURI;
  if (!base) return src;
  try {
    return new URL(src, base).href;
  } catch {
    return src;
  }
}

/**
 * Takes the realm's worker URL for the lifetime of one load.
 *
 * On failure nothing is held — the load that was refused has not changed the count, and its
 * caller reports {@link WorkerSrcClaim.error} instead of starting.
 */
export function claimWorkerSrc(workerSrc: string): WorkerSrcClaim {
  const src = resolvedWorkerSrc(workerSrc);
  const held = activeWorkerSrcs.keys().next().value as string | undefined;
  if (held !== undefined && held !== src) {
    return { ok: false, error: conflictError(src, held) };
  }
  activeWorkerSrcs.set(src, (activeWorkerSrcs.get(src) ?? 0) + 1);
  let released = false;
  return {
    ok: true,
    release: () => {
      if (released) return;
      released = true;
      const count = (activeWorkerSrcs.get(src) ?? 1) - 1;
      if (count > 0) activeWorkerSrcs.set(src, count);
      else activeWorkerSrcs.delete(src);
    },
  };
}

/** Origins only, in both the message and the details: a signed worker URL carries its credential in its query. */
function conflictError(workerSrc: string, conflicting: string): PdfError {
  const requestedOrigin = describeOrigin(workerSrc);
  const activeOrigin = describeOrigin(conflicting);
  return new PdfError(
    'CONFIGURATION_ERROR',
    `this viewer would use a pdf.js worker from ${requestedOrigin}, but another viewer in the same realm is already using ${activeOrigin} — pdf.js holds one worker URL per realm, so the second configuration cannot be honoured`,
    {
      details: { problem: 'worker-conflict', requestedOrigin, activeOrigin },
    },
  );
}

/** The URL pdf.js would use for a load started now. Internal: a host learns it from the error, not here. */
export function configuredWorkerSrc(): string {
  return GlobalWorkerOptions.workerSrc ?? '';
}

/**
 * Two forms, tried in this order, because they fail differently:
 *
 * - Relative: correct everywhere. Vite's dev server rewrites a bare specifier at
 *   build time but not while serving modules, which is how 0.1.0 resolved the
 *   worker to `pdfjs-react-reader/dist/pdfjs-dist/...` and 404'd in dev.
 * - Bare: still needed when a consumer bundles our source directly (the docs site
 *   aliases to `src/`), where the relative form points outside the repo.
 *
 * Each needs its own literal `new URL()` call site, since bundlers only recognise
 * the pattern when the specifier is a literal inside the call.
 */
function candidates(): string[] {
  const urls: string[] = [];
  try {
    urls.push(new URL('../../pdfjs-dist/build/pdf.worker.min.mjs', import.meta.url).href);
  } catch {
    /* import.meta.url unavailable */
  }
  try {
    urls.push(new URL('pdfjs-dist/build/pdf.worker.min.mjs', import.meta.url).href);
  } catch {
    /* likewise */
  }
  return [...new Set(urls)];
}

let userConfigured = false;
let autoFailed = false;
let autoPromise: Promise<void> | null = null;

/**
 * What pdf.js ships as the default, captured before anything can overwrite it.
 *
 * Measured on 6.3 in both places it matters: `''` in a browser, where pdf.js assigns it from
 * `!isNodeJS`, and `'./pdf.worker.mjs'` in Node, where the same field carries the engine's own relative
 * default. So this line is not documenting one value — it is remembering that the value differs by
 * environment, and that `ensureWorker` treats a truthy one as "already configured", which is why a Node
 * load never probes and a browser load always does.
 */
const ENGINE_DEFAULT_WORKER_SRC = GlobalWorkerOptions.workerSrc;

/**
 * Pins the worker explicitly. A local asset import or a CDN URL both win over
 * auto-detection, and calling this disables the probe.
 */
export function configureWorker(workerSrc?: string): void {
  if (!workerSrc) return;
  GlobalWorkerOptions.workerSrc = workerSrc;
  userConfigured = true;
}

/** True when nothing could be located automatically, so the loader can say so. */
export function workerAutoDetectionFailed(): boolean {
  return autoFailed && !userConfigured;
}

/**
 * Points pdf.js at its worker before the first document load. Each candidate is probed because a bundler
 * that cannot rewrite the specifier still hands back a plausible-looking URL, and writing that in would
 * cost more than leaving the field alone: it overwrites pdf.js's own Node default, which is the one
 * fallback that needs no configuration at all, and in a browser it turns "no `workerSrc` specified" —
 * which names the option the host owns — into a failed fetch of a URL nobody recognises. An unset value
 * never buys a main-thread render by itself; the worker code has to be reachable some other way, and
 * `worker.fallback.test.ts` with its three siblings measure which states that is.
 */
export function ensureWorker(workerSrc?: string): Promise<void> {
  if (workerSrc) {
    configureWorker(workerSrc);
    return Promise.resolve();
  }
  if (userConfigured || GlobalWorkerOptions.workerSrc) return Promise.resolve();
  autoPromise ??= detectWorker();
  return autoPromise;
}

async function detectWorker(): Promise<void> {
  for (const url of candidates()) {
    if (await isServed(url)) {
      GlobalWorkerOptions.workerSrc = url;
      return;
    }
  }
  autoFailed = true;
}

const PROBE_TIMEOUT_MS = 1500;

/**
 * A bundler that cannot rewrite the specifier still hands back a plausible URL,
 * and a server with a catch-all route answers a missing file with the app shell:
 * status 200 and HTML. pdf.js would then try to run markup as a module, so the
 * content type is checked as well as the status.
 */
async function isServed(url: string): Promise<boolean> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS);
    const response = await fetch(url, { method: 'HEAD', signal: controller.signal });
    clearTimeout(timer);
    if (!response.ok) return false;
    return !(response.headers.get('content-type') ?? '').includes('text/html');
  } catch {
    return false;
  }
}

/**
 * Trusted Types, opt-in.
 *
 * A page served with `require-trusted-types-for 'script'` cannot construct a
 * `Worker` from a string, and pdf.js only accepts a string `workerSrc` — so on
 * such a page it silently falls back to parsing and rendering on the main
 * thread. Handing pdf.js a `Worker` we created through the page's own policy is
 * the one way to keep the worker, which is why this exists.
 *
 * It is never called implicitly: a policy name has to be listed in the site's
 * `trusted-types` directive, so only the page owner can pick a name that works.
 */
const DEFAULT_POLICY_NAME = 'pdfjs-react-reader#worker';

interface ScriptUrlPolicy {
  createScriptURL(url: string): string;
}

let policy: ScriptUrlPolicy | null = null;

/** Create the policy used to construct the worker. Throws if the name is not in the page's CSP. */
export function configureTrustedTypes(name: string = DEFAULT_POLICY_NAME): void {
  const g = globalThis as typeof globalThis & {
    trustedTypes?: { createPolicy(n: string, rules: ScriptUrlPolicy): ScriptUrlPolicy };
  };
  if (!g.trustedTypes) {
    // FR-54: a published function's failure is coded, and this one is a configuration statement — the page
    // asked for a policy in a browser that exposes no `trustedTypes` at all, so nothing needs one.
    throw new PdfError(
      'CONFIGURATION_ERROR',
      'configureTrustedTypes - this browser exposes no `trustedTypes` global, ' +
        'so no policy is needed. Call it only on a page that requires Trusted Types.',
    );
  }
  policy = g.trustedTypes.createPolicy(name, { createScriptURL: (url) => url });
}

/** True once `configureTrustedTypes` has run, i.e. loads own their worker. */
export function isTrustedTypesConfigured(): boolean {
  return policy !== null;
}

function sameOriginOrWrapper(src: string): string {
  const base = typeof location === 'undefined' ? null : location.href;
  if (!base) return src;
  try {
    const url = new URL(src, base);
    if (url.origin === new URL(base).origin) return url.href;
    // A worker script must be same-origin, so a CDN URL is reached through an
    // import wrapper — the same trick pdf.js uses internally.
    return URL.createObjectURL(
      new Blob([`await import(${JSON.stringify(url.href)});`], { type: 'text/javascript' }),
    );
  } catch {
    return src;
  }
}

/** A worker owned by one document load, plus how to release it. */
export interface OwnedPdfWorker {
  /** Pass to `getDocument({ worker })`. */
  worker: PDFWorker;
  /**
   * Closes both halves. pdf.js only terminates a worker it constructed itself,
   * so a port handed to it has to be closed by the caller or every reload leaks
   * a live worker.
   */
  dispose: () => void;
}

/**
 * The worker for one document load, or `null` when pdf.js should set one up from
 * `workerSrc`. Each load gets its own worker, which is what the `workerSrc` path
 * already does.
 */
export async function createPdfWorker(workerSrc?: string): Promise<OwnedPdfWorker | null> {
  if (!policy || typeof Worker === 'undefined') return null;
  await ensureWorker(workerSrc);
  const src = GlobalWorkerOptions.workerSrc;
  if (!src) return null;
  const scriptURL = policy.createScriptURL(sameOriginOrWrapper(src));
  const port = new Worker(scriptURL, { type: 'module' });
  // pdf.js declares this constructor parameter as `port?: null` in its own .d.ts
  // while accepting a `Worker` at runtime (it is the documented shared-port
  // route), so the mismatch has to be cast rather than argued.
  const worker = new PDFWorker({ port } as unknown as ConstructorParameters<typeof PDFWorker>[0]);
  return {
    worker,
    dispose: () => {
      worker.destroy();
      port.terminate();
    },
  };
}

/** Test seam: the module memoises its probe. */
export function __resetWorkerForTests(): void {
  userConfigured = false;
  autoFailed = false;
  autoPromise = null;
  policy = null;
  activeWorkerSrcs.clear();
  // Back to whatever this realm's pdf.js actually shipped, which is `''` in a browser and
  // `'./pdf.worker.mjs'` in Node. Hard-coding either one would make the auto-detection tests pass on a
  // premise the other environment does not have, and which of them a given file sees depends on how
  // `pdfjs-dist` was resolved rather than on what the file says.
  GlobalWorkerOptions.workerSrc = ENGINE_DEFAULT_WORKER_SRC;
}
