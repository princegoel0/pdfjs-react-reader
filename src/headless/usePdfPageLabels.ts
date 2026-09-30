import { useEffect, useState } from 'react';
import type { PDFDocumentProxy } from 'pdfjs-dist';

import { onAbort } from '../lib/abort';
import type { PdfPageLabels } from '../lib/page-labels';

/**
 * What the pages of a document are called — its `/PageLabels` table, or `null`.
 *
 * The shape of the answer is the interesting part, and it is the engine's, not ours: `null` means the
 * document declares no numbering, which is nearly every PDF in existence, so `null` is the ordinary result
 * rather than a failure. A document that declares a table gets one entry per page, with a range's `/P`
 * prefix already composed onto the numeral and numbering restarting where the ranges restart — measured on
 * `playground/fixtures/labelled-sample.pdf`, which answers `i ii iii 1 2 3 4 5 A-1 A-2` for ten pages.
 *
 * Read once per document handle, and republished when the handle changes, because replacing the bytes on
 * screen replaces the numbering with them. A rejected read leaves the previous answer cleared rather than
 * stale: a page that cannot say its label keeps its number, and the toolbar's box is the only thing that
 * notices the difference.
 *
 * `signal` ends the read the way it ends every other operation here (FR-36) — an abort is a cancellation,
 * not an error, and nothing is published after it.
 *
 * The answer is `null` rather than the engine's `undefined`-or-empty possibilities, because the two things
 * a caller branches on are "there is a table and it says something" and "there is not", and a type with
 * three ways to spell the second one invites a `labels?.length` check in every consumer.
 */
export function usePdfPageLabels(
  doc: PDFDocumentProxy | null,
  signal?: AbortSignal,
): readonly string[] | null {
  const [labels, setLabels] = useState<readonly string[] | null>(null);

  useEffect(() => {
    if (!doc) {
      setLabels(null);
      return;
    }
    let cancelled = false;
    // An already-stopped caller gets no round trip at all, rather than one whose answer is thrown away.
    if (signal?.aborted) return;
    const publish = (value: PdfPageLabels) => {
      if (!cancelled) setLabels(value?.length ? value : null);
    };
    doc.getPageLabels().then(
      (found) => publish(found),
      // The engine's own rejection paths — a document too damaged to read its catalog — are the same
      // outcome as no table at all, and the reader is not owed an error for a cosmetic absence.
      () => publish(null),
    );
    const offAbort = onAbort(signal, () => {
      cancelled = true;
    });
    return () => {
      cancelled = true;
      offAbort();
    };
  }, [doc, signal]);

  return labels;
}
