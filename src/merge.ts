/*
 * The merge surface — the one place a reader puts two documents together and gets a third.
 *
 * Its own entry point rather than more of `pdfjs-react-reader/edit` for one reason: `edit` is at the edge of
 * the per-feature budget — 5.89 kB of 6 kB when this entry was cut, 6.25 kB now that the writer reports
 * coded failures — so anything added there either comes out of something else or moves the ceiling, and a
 * ceiling that moves twice in two releases is not a ceiling. A host that wants merge imports merge.
 *
 * What is shared with the editing tier is the writer and the optional peer that comes with it: importing
 * this file pulls in `@cantoo/pdf-lib`, and importing nothing pulls in neither.
 */
export { usePdfMerge } from './headless/usePdfMerge';
export type { UsePdfMergeOptions, UsePdfMergeResult } from './headless/usePdfMerge';
export { describeMergeSources, mergeDocuments } from './lib/pdf-merge';
/* §3.6: a plan that names a page its sources do not have is this entry's failure to code, so the contract
 * is reachable from here as well as from the root. Same module, same identities — no duplicate vocabulary. */
export { isCancellationCode, isPdfError, PdfError } from './lib/errors';
export type { PdfErrorCode } from './lib/errors';
export type {
  MergePageRef,
  MergePlan,
  MergeResult,
  MergeSource,
} from './lib/pdf-merge';
