/*
 * FR-45: "page-change announcements", decided as a policy rather than as markup.
 *
 * The clause has two failure directions and they pull against each other. A shell that never says where the
 * reader has gone is a wall of canvas for a screen reader: the document's own pages are images, and the only
 * thing that moved was a number in a box nobody focused. A shell that announces every scroll step is worse,
 * because a polite live region during a fast scroll becomes a queue of stale sentences the reader has to
 * listen through to find out where they now are — and "where they now are" is the only useful news. So this
 * is a debounce, and the debounce is the requirement rather than an optimisation of it.
 *
 * The policy is separated from the DOM for the reason every other pure module here exists: the interesting
 * cases are sequences — a burst of changes, a change back to where the reader started, a new document that
 * happens to land on the same page number — and a sequence is easier to assert than to stage.
 */
import { formatLabel, type PdfViewerLabels } from './labels';
import { formatPageLabel, type PdfPageLabels } from './page-labels';

/**
 * How long the reader's position has to stop moving before it is spoken.
 *
 * Long enough to outlast a wheel notch's worth of page changes and a keyboard `PageDown` repeat, short
 * enough that the sentence arrives while the reader still thinks of the move as the one they just made. It
 * is a quiet period, not a rate limit: each change restarts it, so a burst produces one announcement of the
 * place the reader ended up, which is the only answer that is true when it is read.
 */
export const ANNOUNCE_QUIET_MS = 400;

/** Where the reader is, with the document's identity beside the page — the pair that decides an announcement. */
export interface PagePosition {
  doc: object;
  page: number;
}

/**
 * What the shell does with one observation of that pair.
 *
 * - `base` — the first position since this viewer mounted. Remembered, never spoken: a viewer appearing on
 *   page 1 is not a page change, and announcing it makes every reader on a page of two viewers hear a
 *   sentence about a document they had not opened.
 * - `silent` — nothing new happened, including the case the naive version gets wrong: the reader moved out
 *   and back, so the pending sentence would announce a place they never left.
 * - `settle` — the reader is somewhere they have not been told about, or in a different document. A replaced
 *   document counts even when both are on page 1, because "Page 1 of 12" of the new file is news about the
 *   file, not about the number.
 */
export type AnnouncementStep = 'base' | 'silent' | 'settle';

export function observePosition(last: PagePosition | null, here: PagePosition): AnnouncementStep {
  if (last === null) return 'base';
  if (last.doc === here.doc && last.page === here.page) return 'silent';
  return 'settle';
}

/**
 * The sentence, in the host's language.
 *
 * `pageOf` is the same catalog entry the visible counter is built from, so the announcement cannot drift
 * into a wording the page area does not show, and a host that overrides the label table overrides this with
 * it. The page is named by its *label* when the document has one (FR-12): a reader who was told "Page iii of
 * xii" and then hears "Page 3 of 12" has been told two different things about one place.
 */
export function announcementText(options: {
  labels: PdfViewerLabels;
  page: number;
  numPages: number;
  pageLabels: PdfPageLabels;
}): string {
  return formatLabel(options.labels.pageOf, {
    page: formatPageLabel(options.pageLabels, options.page - 1),
    total: String(options.numPages),
  });
}
