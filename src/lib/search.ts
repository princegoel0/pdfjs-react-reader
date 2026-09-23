import type { PDFDocumentProxy } from 'pdfjs-dist';

export interface SearchOptions {
  caseSensitive?: boolean;
  wholeWord?: boolean;
}

export interface ResolvedSearchOptions {
  caseSensitive: boolean;
  wholeWord: boolean;
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
 * `starts` must be sorted ascending and non-overlapping (regex exec order).
 */
export function convertMatches(
  page: PageTextIndex,
  starts: number[],
  queryLength: number,
): PageMatch[] {
  const ends = page.itemEnds;
  const out: PageMatch[] = [];
  let cursor = 0;
  for (const start of starts) {
    const matchEnd = start + queryLength;
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
 * Finds all occurrences of `query` in a page's text. Whole-word boundaries are
 * checked manually (no lookbehind, so Safari < 16.4 stays supported, and no
 * boundary characters consumed by the regex, so adjacent matches still count).
 */
export function findQueryMatches(
  page: PageTextIndex,
  query: string,
  options: ResolvedSearchOptions,
): PageMatch[] {
  if (query.length === 0) return [];
  const needle = options.caseSensitive ? query : query.toLowerCase();
  const haystack = options.caseSensitive ? page.text : page.text.toLowerCase();

  const re = new RegExp(escapeRegExp(needle), options.caseSensitive ? 'gu' : 'giu');
  const starts: number[] = [];
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
    starts.push(m.index);
  }
  return convertMatches(page, starts, needle.length);
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
): Promise<PageTextIndex[]> {
  const numPages = doc.numPages;
  const out: PageTextIndex[] = new Array(numPages);
  for (let i = 0; i < numPages; i++) {
    out[i] = await extractPageText(doc, i);
    onProgress?.((i + 1) / numPages);
    if (i % 5 === 4) await new Promise((resolve) => setTimeout(resolve, 0));
  }
  return out;
}
