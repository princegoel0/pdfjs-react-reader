import { useCallback, useMemo, useRef, useState } from 'react';
import {
  AnnotationMode,
  RenderingCancelledException,
  type PDFDocumentProxy,
  type PDFPageProxy,
  type RenderTask,
} from 'pdfjs-dist';
import type { InkStroke } from '../lib/ink';
import { drawInkStrokes } from '../lib/ink';
import {
  PRINT_MEMORY_BUDGET,
  PRINT_SCALES,
  estimatePrintBytes,
  formatBytes,
  maxPrintablePages,
  planPrintPages,
  planPrintScale,
} from '../lib/print';

type RenderParameters = Parameters<PDFPageProxy['render']>[0];

export interface UsePdfPrintOptions {
  doc: PDFDocumentProxy | null;
  /** User rotation in degrees, so the sheets match what is on screen. */
  rotation?: number;
  /**
   * Returns the freehand strokes drawn on a page (0-based index). Ink is React
   * state rather than PDF content, so the only way it reaches paper is if the
   * caller hands it over here.
   */
  getInkStrokes?: (pageIndex: number) => InkStroke[];
  onError?: (error: Error) => void;
}

export interface PrintOptions {
  /** 1-based inclusive page range. Defaults to the whole document. */
  range?: [number, number];
  /** Canvas scale (1 = the 72 dpi PDF unit). Defaults to the best that fits memory. */
  scale?: number;
}

export interface UsePdfPrintResult {
  /** Resolves once the print dialog has been dismissed (or the job was cancelled). */
  print: (options?: PrintOptions) => Promise<void>;
  cancel: () => void;
  isPrinting: boolean;
  /** 0..1 across the pages rendered so far. */
  progress: number;
  error: Error | null;
  /** False on iOS Safari, where printing script-rendered canvases is broken. */
  supported: boolean;
}

/** Class the pipeline tags `<body>` with while a job is active; see viewer.css. */
export const PRINT_CONTAINER_CLASS = 'pjsr-print';
const PRINTING_BODY_CLASS = 'pjsr-printing';

export function isPrintSupported(): boolean {
  if (typeof window === 'undefined') return false;
  const ua = navigator.userAgent;
  // iOS hands the print sheet over to the top document and ignores canvases an
  // iframe or off-screen container added, so the job silently prints blanks.
  if (/iPad|iPhone|iPod/.test(ua)) return false;
  return !(navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
}

const nextTick = () => new Promise<void>((resolve) => setTimeout(resolve, 0));
const nextFrame = () =>
  new Promise<void>((resolve) => window.requestAnimationFrame(() => resolve()));
const delay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

function afterPrintOnce(): Promise<void> {
  return new Promise((resolve) => {
    const finish = () => {
      window.removeEventListener('afterprint', finish);
      resolve();
    };
    window.addEventListener('afterprint', finish);
  });
}

/**
 * FR-19: render the document into an off-screen container and print that.
 *
 * pdf.js ships no printer in the npm bundle (`web/printutils.js` is not part of
 * `pdf_viewer.mjs`), so this is the loop its own viewer would have run: one
 * canvas per page at `intent: 'print'`, then a single `window.print()`.
 */
export function usePdfPrint({
  doc,
  rotation = 0,
  getInkStrokes,
  onError,
}: UsePdfPrintOptions): UsePdfPrintResult {
  const [isPrinting, setIsPrinting] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<Error | null>(null);

  // Refs keep `print` stable and let `cancel` reach the running task.
  const docRef = useRef(doc);
  docRef.current = doc;
  const rotationRef = useRef(rotation);
  rotationRef.current = rotation;
  const onErrorRef = useRef(onError);
  onErrorRef.current = onError;
  const getInkStrokesRef = useRef(getInkStrokes);
  getInkStrokesRef.current = getInkStrokes;
  const taskRef = useRef<RenderTask | null>(null);
  const busyRef = useRef(false);
  const cancelledRef = useRef(false);

  const supported = useMemo(isPrintSupported, []);

  const cancel = useCallback(() => {
    if (!busyRef.current) return;
    cancelledRef.current = true;
    taskRef.current?.cancel();
  }, []);

  const print = useCallback(
    async (options: PrintOptions = {}) => {
      const current = docRef.current;
      if (!current || busyRef.current || !isPrintSupported()) return;

      busyRef.current = true;
      cancelledRef.current = false;
      setError(null);
      setIsPrinting(true);
      setProgress(0);

      const container = document.createElement('div');
      container.className = PRINT_CONTAINER_CLASS;
      container.setAttribute('aria-hidden', 'true');
      let attached = false;

      try {
        const pages = planPrintPages(current.numPages, options.range);
        if (pages.length === 0) throw new Error('There is nothing to print.');

        const first = await current.getPage(pages[0]!);
        const firstViewport = first.getViewport({
          scale: 1,
          rotation: (first.rotate + rotationRef.current) % 360,
        });
        first.cleanup();
        const base = { width: firstViewport.width, height: firstViewport.height };

        const scale = options.scale ?? planPrintScale(base, pages.length);
        if (!scale) {
          const fits = maxPrintablePages(base, PRINT_SCALES[1] ?? 1.5);
          throw new Error(
            `Printing ${pages.length} pages needs ${formatBytes(
              estimatePrintBytes(base, PRINT_SCALES[PRINT_SCALES.length - 1] ?? 1, pages.length),
            )} of canvas memory, more than the ${formatBytes(
              PRINT_MEMORY_BUDGET,
            )} budget allows. Print a shorter range (about ${fits} pages at a time), or pass a lower scale.`,
          );
        }

        document.body.append(container);
        document.body.classList.add(PRINTING_BODY_CLASS);
        attached = true;

        // Snapshot taken now, so values typed after mount are on the sheet.
        // pdf.js only honours `printAnnotationStorage` for the print intent.
        const printAnnotationStorage = (
          current.annotationStorage as unknown as {
            print?: RenderParameters['printAnnotationStorage'];
          } | null
        )?.print;

        for (let i = 0; i < pages.length; i++) {
          if (cancelledRef.current) return;
          const page = await current.getPage(pages[i]!);
          if (cancelledRef.current) {
            page.cleanup();
            return;
          }
          const viewport = page.getViewport({
            scale,
            rotation: (page.rotate + rotationRef.current) % 360,
          });
          const canvas = document.createElement('canvas');
          canvas.width = Math.max(1, Math.floor(viewport.width));
          canvas.height = Math.max(1, Math.floor(viewport.height));
          container.append(canvas);

          const task = page.render({
            canvas,
            viewport,
            background: '#ffffff',
            intent: 'print',
            annotationMode: AnnotationMode.ENABLE_STORAGE,
            printAnnotationStorage,
          });
          taskRef.current = task;
          try {
            await task.promise;
            const strokes = getInkStrokesRef.current?.(pages[i]! - 1);
            if (strokes?.length) {
              const ctx = canvas.getContext('2d');
              if (ctx) drawInkStrokes(ctx, strokes, viewport, scale);
            }
          } catch (err) {
            if (cancelledRef.current || err instanceof RenderingCancelledException) return;
            throw err;
          } finally {
            taskRef.current = null;
            page.cleanup();
          }

          setProgress((i + 1) / pages.length);
          // Yield so the progress label paints and the tab stays responsive.
          await nextTick();
        }
        if (cancelledRef.current) return;

        // Layout needs one frame to commit every canvas before the snapshot.
        await nextFrame();
        const printed = afterPrintOnce();
        window.print();
        // `window.print()` blocks and `afterprint` fires during the block in
        // Chrome/Firefox/Safari; the race covers a browser that never fires it.
        await Promise.race([printed, delay(250)]);
      } catch (err) {
        if (!cancelledRef.current) {
          const next = err instanceof Error ? err : new Error(String(err));
          setError(next);
          onErrorRef.current?.(next);
        }
      } finally {
        // Detached canvases keep their pixel buffers until GC, which is what
        // crashes mobile Safari on long documents.
        for (const child of Array.from(container.children)) {
          if (child instanceof HTMLCanvasElement) {
            child.width = 0;
            child.height = 0;
          }
        }
        container.remove();
        if (attached) document.body.classList.remove(PRINTING_BODY_CLASS);
        busyRef.current = false;
        cancelledRef.current = false;
        setIsPrinting(false);
        setProgress(0);
      }
    },
    [],
  );

  return { print, cancel, isPrinting, progress, error, supported };
}
