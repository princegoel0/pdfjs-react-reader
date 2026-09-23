import { GlobalWorkerOptions } from 'pdfjs-dist';

let userConfigured = false;

/**
 * Points pdf.js at its worker. An explicit `workerSrc` (local asset or CDN)
 * always wins. Without one we try the bundler-friendly
 * `new URL(..., import.meta.url)` pattern; if that fails (e.g. CJS consumers,
 * unsupported bundlers) we leave workerSrc unset and pdf.js transparently
 * falls back to its main-thread "fake worker".
 */
export function configureWorker(workerSrc?: string): void {
  if (workerSrc) {
    GlobalWorkerOptions.workerSrc = workerSrc;
    userConfigured = true;
    return;
  }
  if (userConfigured || GlobalWorkerOptions.workerSrc) return;
  try {
    GlobalWorkerOptions.workerSrc = new URL(
      'pdfjs-dist/build/pdf.worker.min.mjs',
      import.meta.url,
    ).toString();
  } catch {
    // import.meta.url unavailable — stay on the fake-worker fallback.
  }
}
