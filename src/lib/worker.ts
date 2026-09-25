import { GlobalWorkerOptions, PDFWorker } from 'pdfjs-dist';

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
 * Points pdf.js at its worker before the first document load. Each candidate is
 * probed because a bundler that cannot rewrite the specifier still hands back a
 * plausible-looking URL; assigning that would break pdf.js's own fake-worker
 * fallback, which fetches the same URL. When every candidate fails we leave
 * `workerSrc` unset rather than pointing it at something known to be wrong.
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
    throw new Error(
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
  GlobalWorkerOptions.workerSrc = '';
}
