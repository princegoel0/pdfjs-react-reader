import type { PDFDocumentProxy } from 'pdfjs-dist';

export interface OutlineEntry {
  title: string;
  /** 0-based target page, or null when the item has no local destination. */
  pageIndex: number | null;
  children: OutlineEntry[];
  /** PDF /Count < 0 means the viewer should start with this node collapsed. */
  collapsed: boolean;
}

/**
 * The page target extracted from a resolved destination array. Mirrors pdf.js's
 * own link handling (web/pdf_viewer.mjs): a plain integer is a 0-based page
 * index, while a `{ num, gen }` object is a PDF *object reference* that must be
 * translated — object numbers are not page numbers.
 */
export type DestinationRef =
  | { kind: 'index'; index: number }
  | { kind: 'proxy'; num: number; gen: number };

export function parseDestination(dest: unknown): DestinationRef | null {
  if (!Array.isArray(dest) || dest.length === 0) return null;
  const ref = dest[0];
  if (Number.isInteger(ref) && (ref as number) >= 0) {
    return { kind: 'index', index: ref as number };
  }
  if (
    ref !== null &&
    typeof ref === 'object' &&
    'num' in ref &&
    typeof (ref as { num: unknown }).num === 'number'
  ) {
    const gen = (ref as { gen?: unknown }).gen;
    return {
      kind: 'proxy',
      num: (ref as { num: number }).num,
      gen: typeof gen === 'number' ? gen : 0,
    };
  }
  return null;
}

/** Resolves a destination to a 0-based page index, or null when unresolvable. */
export async function resolveDestinationPageIndex(
  doc: PDFDocumentProxy,
  dest: unknown,
): Promise<number | null> {
  const parsed = parseDestination(dest);
  if (!parsed) return null;
  if (parsed.kind === 'index') return parsed.index;
  const proxy = { num: parsed.num, gen: parsed.gen };
  const cached = doc.cachedPageNumber(proxy);
  if (typeof cached === 'number') return cached - 1; // cachedPageNumber is 1-based
  try {
    return await doc.getPageIndex(proxy); // getPageIndex is 0-based
  } catch {
    return null;
  }
}
