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

// ---- document-level extraction with a per-document cache ----

const pageTextCache = new WeakMap<PDFDocumentProxy, Array<PageTextIndex | undefined>>();

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
    if (signal?.aborted) throw abortError('Text indexing was aborted.');
    out[i] = await extractPageText(doc, i);
    onProgress?.((i + 1) / numPages);
    if (i % 5 === 4) await new Promise((resolve) => setTimeout(resolve, 0));
  }
  return out;
}
