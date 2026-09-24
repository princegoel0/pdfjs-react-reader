import { GlobalWorkerOptions } from 'pdfjs-dist';

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

const PROBE_TIMEOUT_MS = 1500;

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
    if (await isReachable(url)) {
      GlobalWorkerOptions.workerSrc = url;
      return;
    }
  }
  autoFailed = true;
}

async function isReachable(url: string): Promise<boolean> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS);
    const response = await fetch(url, { method: 'HEAD', signal: controller.signal });
    clearTimeout(timer);
    return response.ok;
  } catch {
    return false;
  }
}

/** Test seam: the module memoises its probe. */
export function __resetWorkerForTests(): void {
  userConfigured = false;
  autoFailed = false;
  autoPromise = null;
  GlobalWorkerOptions.workerSrc = '';
}
