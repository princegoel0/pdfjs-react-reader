/*
 * The one capability the editing tier was missing: putting two documents together.
 *
 * `arrangePages` moves pages *inside* a file. This composes pages *from* files, and the difference is not
 * the argument list, it is what a page means: inside one document a page is an object to be permuted, and
 * across documents it is a thing to be copied — which is why the same page may be asked for twice here and
 * never is there, and why the output is always a new file rather than one of the inputs rewritten.
 *
 * That last sentence is the requirement. A reader experimenting with a merge must not be able to destroy a
 * document by trying it, so the only bytes this function writes are bytes of a document it created, and
 * every source is loaded from a copy of the caller's buffer (`toArrayBuffer` in `pdf-write`). The test
 * suite asserts that by hashing the sources before and after.
 *
 * What a merge does not carry is the interactive form. `copyPages` brings a page's widget annotations
 * across but not the `AcroForm` that binds them, which is the same rule `flattenBytes` documents from the
 * other direction: on a merged file the values are visible and the fields are not live. It is stated here
 * because a reader who merges two tax forms will otherwise discover it by typing into one.
 */
import { PDFDocument } from '@cantoo/pdf-lib';
import { throwIfAborted } from './abort';
import { loadForWriting, type PdfBytes, type WriteOptions } from './pdf-write';

/** One page of one source, addressed the way the picker sees it. */
export interface MergePageRef {
  /** Index into `MergePlan.sources`, in the order they were offered. */
  source: number;
  /** 0-based page within that source. */
  page: number;
}

/** A document offered to the merge. Its bytes are never written back. */
export interface MergeSource {
  bytes: PdfBytes;
  /**
   * What to call it in the preview — a filename, a tab label, whatever the host has. Absent, the picker
   * says "Document 1", which is worse but legal.
   */
  name?: string;
}

export interface MergePlan {
  sources: MergeSource[];
  /** The pages the output should hold, in order. The same page may appear twice. */
  order: MergePageRef[];
}

export interface MergeResult {
  bytes: PdfBytes;
  pages: number;
  /** Per source, in `sources` order: how many of its pages the plan took. */
  taken: number[];
  /** Per source: how many pages it has, so a preview can say "2 of 14 taken". */
  available: number[];
}

/**
 * How many pages each source has, and what it is called — everything a page picker needs before the
 * reader has chosen anything.
 *
 * Separate from `mergeDocuments` because a viewer cannot show a preview without it, and because loading a
 * document to count its pages should not be a thing a caller has to write: it is the same load with the
 * same encryption flag, and two ways of doing it is two ways to disagree about an encrypted file.
 */
export async function describeMergeSources(
  sources: readonly MergeSource[],
  options: WriteOptions = {},
): Promise<{ pages: number }[]> {
  const described: { pages: number }[] = [];
  for (const [at, source] of sources.entries()) {
    throwIfAborted(options.signal, `Reading source ${at + 1} was aborted.`);
    const doc = await loadForWriting(source.bytes);
    described.push({ pages: doc.getPageCount() });
  }
  return described;
}

/**
 * Write a new document out of the pages the plan names.
 *
 * Every page is copied into a document that starts empty, in plan order, one `copyPages` per page: a
 * repeated page needs a fresh object each time, which is also what makes "put the cover page at the back
 * too" a legal instruction. The abort contract is the tier's — checked before each page and before the
 * save, so a caller that stops never receives bytes to discard.
 */
export async function mergeDocuments(
  plan: MergePlan,
  options: WriteOptions = {},
): Promise<MergeResult> {
  const { sources, order } = plan;
  if (sources.length === 0) throw new Error('a merge needs at least one document to take pages from');
  if (order.length === 0) throw new Error('a merge needs at least one page in it');

  throwIfAborted(options.signal, 'Merging was aborted.');
  const loaded: PDFDocument[] = [];
  for (const [at, source] of sources.entries()) {
    throwIfAborted(options.signal, `Reading source ${at + 1} was aborted.`);
    loaded.push(await loadForWriting(source.bytes));
  }
  const available = loaded.map((doc) => doc.getPageCount());

  // Validated in full before anything is copied: a plan that runs out at page nine of ten should fail
  // before it has built a document, not part-way through one the caller then has to throw away.
  for (const ref of order) {
    if (!Number.isInteger(ref.source) || ref.source < 0 || ref.source >= sources.length) {
      throw new Error(`source ${ref.source} is not one of the ${sources.length} documents offered`);
    }
    const pages = available[ref.source]!;
    if (!Number.isInteger(ref.page) || ref.page < 0 || ref.page >= pages) {
      throw new Error(
        `page ${ref.page} is not one of source ${ref.source + 1}'s ${pages} pages`,
      );
    }
  }

  const out = await PDFDocument.create();
  const taken = new Array<number>(sources.length).fill(0);
  for (const ref of order) {
    throwIfAborted(options.signal, 'Merging was aborted.');
    const [copied] = await out.copyPages(loaded[ref.source]!, [ref.page]);
    out.addPage(copied);
    taken[ref.source] = (taken[ref.source] ?? 0) + 1;
  }

  throwIfAborted(options.signal, 'Merging was aborted.');
  const bytes = await out.save({ useObjectStreams: false });
  return { bytes, pages: order.length, taken, available };
}
