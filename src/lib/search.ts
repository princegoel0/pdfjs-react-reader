import type { PDFDocumentProxy } from 'pdfjs-dist';
import { abortError } from './abort';

export interface SearchOptions {
  caseSensitive?: boolean;
  wholeWord?: boolean;
  /**
   * Treat the query as a JavaScript regular expression instead of a list of words.
   * Implies no word-splitting: `^` and `$` mean what the reader wrote.
   */
  regex?: boolean;
}

export interface ResolvedSearchOptions {
  caseSensitive: boolean;
  wholeWord: boolean;
  regex: boolean;
}

/** A match on a single page, expressed in text-item coordinates. */
export interface PageMatch {
  /** 0-based page index. */
  pageIndex: number;
  /** Index into the page's TextItem array where the match starts. */
  beginIdx: number;
  /** Character offset within that item. */
  beginOffset: number;
  /** Item index where the match ends (inclusive). */
  endIdx: number;
  /** Character offset (exclusive) within the end item. */
  endOffset: number;
}

/** Per-page extracted text, kept for fast repeated searches. */
export interface PageTextIndex {
  items: TextItemLike[];
  /** All item strings concatenated, '\n' after items with hasEOL. */
  text: string;
  /** itemEnds[i] = offset in `text` just past item i. */
  itemEnds: number[];
}

/**
 * Structural subset of pdf.js TextItem (not re-exported from the pdfjs-dist
 * root, and the internal path differs between v4 and v5).
 */
export interface TextItemLike {
  str: string;
  hasEOL?: boolean;
}

const WORD_CHAR = /^[\p{L}\p{N}_]$/u;

export function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Flattens pdf.js text content items into a single searchable string. */
export function buildPageText(
  items: ReadonlyArray<TextItemLike | { type: string }>,
): PageTextIndex {
  let text = '';
  const itemEnds: number[] = [];
  const textItems: TextItemLike[] = [];
  for (const item of items) {
    if (!('str' in item)) continue; // marked-content boundary, no text of its own
    textItems.push(item);
    text += item.str;
    if (item.hasEOL) text += '\n';
    itemEnds.push(text.length);
  }
  return { items: textItems, text, itemEnds };
}

/**
 * Maps string offsets in the concatenated page text to text-item ranges.
 * `starts` must be sorted ascending and non-overlapping (regex exec order), and all
 * matches must be `queryLength` long — see `convertMatchRanges` when they differ.
 */
export function convertMatches(
  page: PageTextIndex,
  starts: number[],
  queryLength: number,
): PageMatch[] {
  return convertMatchRanges(page, starts.map((start) => ({ start, length: queryLength })));
}

/** The general form: each match knows its own extent, which an expression needs. */
export function convertMatchRanges(
  page: PageTextIndex,
  ranges: readonly { start: number; length: number }[],
): PageMatch[] {
  const ends = page.itemEnds;
  const out: PageMatch[] = [];
  let cursor = 0;
  for (const { start, length } of ranges) {
    const matchEnd = start + length;
    while (cursor < ends.length && start >= ends[cursor]!) cursor++;
    const beginIdx = cursor;
    const beginOffset = start - (cursor === 0 ? 0 : ends[cursor - 1]!);
    while (cursor < ends.length && matchEnd > ends[cursor]!) cursor++;
    const endIdx = cursor;
    const endOffset = matchEnd - (cursor === 0 ? 0 : ends[cursor - 1]!);
    out.push({ pageIndex: -1, beginIdx, beginOffset, endIdx, endOffset });
  }
  return out;
}

/**
 * A query turned into the matchers a page is scanned with.
 *
 * Splitting happens once per search, not once per page: a twelve-page document
 * would otherwise rebuild the same expression twelve times, and an invalid regular
 * expression has to be reported to the reader rather than thrown inside a loop that
 * has no idea what the user typed.
 */
export interface FindPlan {
  /**
   * The query's words, empty in regex mode. A page only counts when **every** word
   * appears on it, which is the rule pdf.js's own viewer uses — "trace license"
   * means a page holding both, not a page holding either.
   */
  terms: string[];
  /** The compiled expression, regex mode only. */
  pattern: RegExp | null;
  /** Set when `pattern` could not be compiled: the one error a search can produce. */
  error: string | null;
  /** Carried so a page scan honours case and word settings without re-deriving them. */
  options: ResolvedSearchOptions;
}

export function planFind(query: string, options: ResolvedSearchOptions): FindPlan {
  if (query.length === 0) return { terms: [], pattern: null, error: null, options };

  if (options.regex) {
    const flags = options.caseSensitive ? 'g' : 'gi';
    try {
      // No `u` flag: it rejects escapes readers legitimately write, such as an
      // unbraced `{|`, and a search box is not the place to relitigate Annex B.
      return { terms: [], pattern: new RegExp(query, flags), error: null, options };
    } catch (reason) {
      return {
        terms: [],
        pattern: null,
        error: reason instanceof Error ? reason.message : String(reason),
        options,
      };
    }
  }

  const terms = query.split(/\s+/).filter((term) => term.length > 0);
  return { terms, pattern: null, error: null, options };
}

/** All extents of `needle` in `haystack`, with whole-word edges checked by hand. */
function findRanges(
  haystack: string,
  needle: string,
  options: ResolvedSearchOptions,
): { start: number; length: number }[] {
  const re = new RegExp(escapeRegExp(needle), options.caseSensitive ? 'g' : 'gi');
  const found: { start: number; length: number }[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(haystack)) !== null) {
    if (m[0].length === 0) {
      re.lastIndex++;
      continue;
    }
    if (options.wholeWord) {
      const before = m.index === 0 ? '' : haystack[m.index - 1]!;
      const after = haystack.charAt(m.index + m[0].length);
      if (WORD_CHAR.test(before) || WORD_CHAR.test(after)) continue;
    }
    found.push({ start: m.index, length: m[0].length });
  }
  return found;
}

/**
 * Finds every match of `plan` on one page, in reading order.
 *
 * Whole-word boundaries are checked manually rather than with `\b`: no lookbehind is
 * needed (so Safari before 16.4 stays supported) and no boundary characters are
 * consumed by the expression, so adjacent repeats still count.
 */
export function findPageMatches(page: PageTextIndex, plan: FindPlan): PageMatch[] {
  if (plan.error) return [];

  if (plan.pattern) {
    const expression = plan.pattern;
    const found: { start: number; length: number }[] = [];
    let m: RegExpExecArray | null;
    expression.lastIndex = 0;
    while ((m = expression.exec(page.text)) !== null) {
      if (m[0].length === 0) {
        expression.lastIndex++;
        continue;
      }
      found.push({ start: m.index, length: m[0].length });
    }
    return convertMatchRanges(page, found);
  }

  if (plan.terms.length === 0) return [];

  const perTerm = plan.terms.map((term) => findRanges(page.text, term, plan.options));
  if (perTerm.some((found) => found.length === 0)) {
    // One word absent is the whole page excluded, so nothing further is scanned: this
    // is the difference between "and" and "or", and readers expect the search box to
    // behave like every other PDF viewer's.
    return [];
  }

  // Terms can match inside one another ("the" within "there"), and the offset mapper
  // takes each span as the next in a non-overlapping run. Longest-first, then
  // dropping anything that starts before the previous span ended, keeps one visible
  // mark per hit instead of a stack of half-covered ones.
  const merged: { start: number; length: number }[] = [];
  let end = -1;
  for (const range of perTerm.flat().sort((a, b) => a.start - b.start || b.length - a.length)) {
    if (range.start < end) continue;
    merged.push(range);
    end = range.start + range.length;
  }
  return convertMatchRanges(page, merged);
}

/** Matches per page, index 0 being page 1 — the shape a results list groups by. */
export function countPerPage(matches: readonly PageMatch[], numPages: number): number[] {
  const counts = new Array<number>(numPages).fill(0);
  for (const match of matches) {
    if (match.pageIndex >= 0 && match.pageIndex < numPages) counts[match.pageIndex] = (counts[match.pageIndex] ?? 0) + 1;
  }
  return counts;
}

/* ------------------------------------------------------------------ *
 * An index somebody else built (FR-40).
 * ------------------------------------------------------------------ */

/**
 * One page of a published index: the concatenated text, and where each text item ends inside it.
 *
 * `itemEnds` is the part a host cannot skip or summarise. A match is reported as a span of *text items*,
 * because that is what the viewer paints a mark into, and the boundaries between items are exactly these
 * offsets. They come from the same `getTextContent()` call the viewer would have made, in the same order,
 * with the items that carry no text of their own left out — which is what `buildTextIndex` does, and why a
 * hand-rolled index that splits paragraphs differently marks the wrong words.
 */
export interface ExternalPageText {
  text: string;
  itemEnds: number[];
}

/** The published shape. `version` is checked, not read: a v2 index must fail loudly, not half-work. */
export interface ExternalTextIndex {
  version: 1;
  pages: ExternalPageText[];
}

/**
 * Turns text items into the published shape — the same walk `buildPageText` does for a live page, so an
 * index built with this on a server and a document read in a browser agree by construction rather than by
 * two implementations being kept in step.
 */
export function buildTextIndex(pages: ReadonlyArray<ReadonlyArray<TextItemLike>>): ExternalTextIndex {
  return {
    version: 1,
    pages: pages.map((items) => {
      const { text, itemEnds } = buildPageText(items);
      return { text, itemEnds };
    }),
  };
}

/**
 * Why an index cannot be trusted, or `null` when it can.
 *
 * The whole page count is the one thing that cannot be papered over: an index for a different revision of
 * a document has the right shape and the wrong pages, and every mark it produces would land on words that
 * are not there. A page that is merely missing is not an error — that page is read from the document.
 */
export function validateTextIndex(
  index: unknown,
  numPages: number,
): { error: string } | { error: null; index: ExternalTextIndex } {
  if (index === null || typeof index !== 'object') return { error: 'The index is not an object.' };
  const candidate = index as Partial<ExternalTextIndex>;
  if (candidate.version !== 1) return { error: `Unsupported index version ${String(candidate.version)}.` };
  if (!Array.isArray(candidate.pages)) return { error: 'The index has no page list.' };
  if (candidate.pages.length !== numPages) {
    return { error: `The index describes ${candidate.pages.length} pages; the document has ${numPages}.` };
  }
  for (const [at, page] of candidate.pages.entries()) {
    if (page === null || typeof page !== 'object') continue; // a missing page is read from the document
    const { text, itemEnds } = page as Partial<ExternalPageText>;
    if (typeof text !== 'string' || !Array.isArray(itemEnds)) {
      return { error: `Page ${at + 1} of the index is not a text/itemEnds pair.` };
    }
    let previous = 0;
    for (const end of itemEnds) {
      if (!Number.isInteger(end) || end < previous || end > text.length) {
        return { error: `Page ${at + 1} of the index has item boundaries that do not walk its text.` };
      }
      previous = end;
    }
  }
  return { error: null, index: candidate as ExternalTextIndex };
}

// ---- document-level extraction with a per-document cache ----

const pageTextCache = new WeakMap<PDFDocumentProxy, Array<PageTextIndex | undefined>>();

/**
 * The order a document is read in when the answer must start before the file is finished (FR-39).
 *
 * Nearest-first from the page the reader is looking at, forward before backward at an equal distance —
 * a reader who searches from page 40 expects the next hit to be ahead of them, and a hit 300 pages back
 * is worth less than one 300 pages on. Not sorted by page number: the whole point is that the pages
 * arrive out of order so the first one can arrive first, and `usePdfSearch` re-sorts the matches into
 * reading order when it publishes them.
 */
export function outwardPageOrder(numPages: number, focus = 0): number[] {
  if (numPages <= 0) return [];
  const start = Math.min(Math.max(0, Math.trunc(focus)), numPages - 1);
  const order: number[] = [start];
  for (let step = 1; step < numPages; step++) {
    if (start + step < numPages) order.push(start + step);
    if (start - step >= 0) order.push(start - step);
  }
  return order;
}

/** Extracts (or returns cached) text for a single 0-based page. */
export async function extractPageText(
  doc: PDFDocumentProxy,
  pageIndex: number,
): Promise<PageTextIndex> {
  let cache = pageTextCache.get(doc);
  const cached = cache?.[pageIndex];
  if (cached) return cached;
  const page = await doc.getPage(pageIndex + 1);
  const content = await page.getTextContent();
  const index = buildPageText(content.items);
  if (!cache) {
    cache = [];
    pageTextCache.set(doc, cache);
  }
  cache[pageIndex] = index;
  return index;
}

/**
 * Drops the cached text for the given pages, or the whole document when called with no argument.
 *
 * FR-39's second clause is that a re-index invalidates only what changed, and this is the half of that which
 * lives in the cache: on a thousand-page document throwing away every page is the longest thing the package
 * does, and one page is a frame.
 *
 * What counts as "changed" is narrower than it sounds, and the measurement is in `search.parity.test.ts`:
 * `getTextContent()` reads the page's content stream, so a form field's typed value (the fixture reports its
 * labels, never its values) and an annotation's text are not in what comes back — before an edit or after
 * one. Invalidation is for a host that knows a page's *text* is no longer the text it indexed, not for making
 * an edit searchable.
 */
export function invalidatePageText(doc: PDFDocumentProxy, pages?: readonly number[]): void {
  const cache = pageTextCache.get(doc);
  if (!cache) return;
  if (pages === undefined) {
    pageTextCache.set(doc, []);
    return;
  }
  for (const page of pages) {
    if (page >= 0 && page < cache.length) cache[page] = undefined;
  }
}

/**
 * Extracts text for every page, reporting progress (0..1) and yielding to the
 * event loop periodically so the UI can paint progress updates.
 */
export async function extractAllText(
  doc: PDFDocumentProxy,
  onProgress?: (fraction: number) => void,
  signal?: AbortSignal,
): Promise<PageTextIndex[]> {
  const numPages = doc.numPages;
  const out: PageTextIndex[] = new Array(numPages);
  for (let i = 0; i < numPages; i++) {
    // Checked per page rather than up front: this loop is the longest thing the package does on the main
    // thread, and a host that cancels a thousand-page index should wait at most one page, not the file.
    // FR-54's cancellation codes name the operation that stopped, so a host that aborts the index and the
    // load at the same moment can tell the two rejections apart without a flag of its own.
    if (signal?.aborted) throw abortError('Text indexing was aborted.', 'SEARCH_CANCELLED');
    out[i] = await extractPageText(doc, i);
    onProgress?.((i + 1) / numPages);
    if (i % 5 === 4) await new Promise((resolve) => setTimeout(resolve, 0));
  }
  return out;
}
