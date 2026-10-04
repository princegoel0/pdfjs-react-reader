/**
 * The engine-only half of §6's profile C, driven by `playground/raw.html` and read by `scripts/benchmark.mjs`.
 *
 * Profile C's target is stated in two pieces — "viewer main-thread work attributable to our layer under 200 ms;
 * engine render time reported separately" — and one number cannot answer a question about two costs. So this
 * file draws the same page through the same engine with none of the viewer around it, and the benchmark
 * reports the pair.
 *
 * The page dimensions come in as query parameters rather than being chosen here: the benchmark asks the viewer
 * what it actually rendered at (a CSS box and a device buffer, both decided by fit, zoom, dpr and the canvas
 * ceilings) and hands those numbers to this harness, so the two runs paint the same pixels. What is left on
 * the table is stated in the report rather than hidden: they are two page loads, and the difference between
 * their long-task totals is an arithmetic result, not an instrumented split.
 *
 * Nothing in the product imports this file, and nothing here imports the product.
 */
import { getDocument, GlobalWorkerOptions } from 'pdfjs-dist';

GlobalWorkerOptions.workerSrc = new URL(
  'pdfjs-dist/build/pdf.worker.min.mjs',
  import.meta.url,
).toString();

interface RawEngineReport {
  /** `getDocument` to a usable proxy, in milliseconds. */
  openMs: number;
  /** `getPage` on its own. */
  pageMs: number;
  /** `render()` to a resolved task: the engine's main-thread drawing time. */
  renderMs: number;
  /** Longest single `longtask` entry over the whole run, including the first paint. */
  longTaskMs: number;
  /** The box the harness was asked to draw, and the buffer it drew into. */
  cssWidth: number;
  cssHeight: number;
  deviceWidth: number;
  deviceHeight: number;
  /** Non-white pixel fraction, so "the engine painted" is an observation and not an assumption. */
  ink: number;
  error: string | null;
}

declare global {
  interface Window {
    __rawEngine?: RawEngineReport;
  }
}

async function main(): Promise<void> {
  const params = new URLSearchParams(window.location.search);
  const fixture = params.get('fixture');
  const pageNumber = Number(params.get('page') ?? '1');
  const cssWidth = Number(params.get('cssWidth') ?? '0');
  const deviceWidth = Number(params.get('deviceWidth') ?? '0');
  let longest = 0;
  const observe = new PerformanceObserver((list) => {
    for (const entry of list.getEntries()) longest = Math.max(longest, entry.duration);
  });
  observe.observe({ type: 'longtask', buffered: true });

  const report: Partial<RawEngineReport> = {};
  try {
    if (!fixture) throw new Error('the raw harness needs ?fixture=');
    const opened = performance.now();
    const doc = await getDocument({ data: await (await fetch(fixture)).arrayBuffer(), verbosity: 0 }).promise;
    report.openMs = performance.now() - opened;

    const pageStart = performance.now();
    const page = await doc.getPage(pageNumber);
    report.pageMs = performance.now() - pageStart;

    const natural = page.getViewport({ scale: 1 });
    if (!(cssWidth > 0)) throw new Error('cssWidth must be the box the viewer drew, not zero');
    const dpr = deviceWidth > 0 ? deviceWidth / cssWidth : 1;
    const viewport = page.getViewport({ scale: cssWidth / natural.width });
    const cssHeight = viewport.height;

    const canvas = document.getElementById('sheet') as HTMLCanvasElement | null;
    if (!canvas) throw new Error('raw.html lost its canvas');
    canvas.width = Math.floor(viewport.width * dpr);
    canvas.height = Math.floor(viewport.height * dpr);
    canvas.style.width = `${Math.floor(viewport.width)}px`;
    canvas.style.height = `${Math.floor(viewport.height)}px`;
    report.cssWidth = Math.floor(viewport.width);
    report.cssHeight = Math.floor(cssHeight);
    report.deviceWidth = canvas.width;
    report.deviceHeight = canvas.height;

    // pdf.js 6.x takes the canvas and resolves the context itself, which is what `PdfPage` passes too —
    // asking for a `canvasContext` here would be a parameter the engine ignores.
    const started = performance.now();
    await page.render({
      canvas,
      viewport,
      transform: dpr !== 1 ? [dpr, 0, 0, dpr, 0, 0] : undefined,
      background: '#ffffff',
    }).promise;
    report.renderMs = performance.now() - started;

    const scratch = document.createElement('canvas');
    scratch.width = 240;
    scratch.height = 240;
    const probe = scratch.getContext('2d', { willReadFrequently: true });
    let marks = 0;
    if (probe) {
      probe.drawImage(canvas, 0, 0, 240, 240);
      const data = probe.getImageData(0, 0, 240, 240).data;
      for (let i = 0; i < data.length; i += 4) {
        const r = data[i] ?? 255;
        const g = data[i + 1] ?? 255;
        const b = data[i + 2] ?? 255;
        if (Math.abs(255 - r) + Math.abs(255 - g) + Math.abs(255 - b) > 60) marks += 1;
      }
    }
    report.ink = marks / (240 * 240);
    await doc.cleanup();
  } catch (error) {
    report.error = String((error as Error)?.message ?? error);
  }
  observe.disconnect();
  window.__rawEngine = {
    openMs: 0,
    pageMs: 0,
    renderMs: 0,
    longTaskMs: longest,
    cssWidth: 0,
    cssHeight: 0,
    deviceWidth: 0,
    deviceHeight: 0,
    ink: 0,
    error: null,
    ...report,
  } as RawEngineReport;
}

void main();
