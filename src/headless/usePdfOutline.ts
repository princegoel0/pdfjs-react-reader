import { useEffect, useState } from 'react';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import { resolveDestinationPageIndex, type OutlineEntry } from '../lib/outline';

export interface UsePdfOutlineOptions {
  doc: PDFDocumentProxy | null;
}

export interface UsePdfOutlineResult {
  /** Bookmark tree, or null while loading / when no document is set. */
  entries: OutlineEntry[] | null;
  loading: boolean;
}

interface RawOutlineItem {
  title?: unknown;
  dest?: unknown;
  count?: unknown;
  items?: unknown;
}

async function buildTree(doc: PDFDocumentProxy, items: RawOutlineItem[]): Promise<OutlineEntry[]> {
  const out: OutlineEntry[] = [];
  for (const item of items) {
    let dest = item.dest;
    if (typeof dest === 'string') {
      // Named destination — resolve to its explicit form.
      try {
        dest = await doc.getDestination(dest);
      } catch {
        dest = null;
      }
    }
    const pageIndex = await resolveDestinationPageIndex(doc, dest);
    const children = Array.isArray(item.items)
      ? await buildTree(doc, item.items as RawOutlineItem[])
      : [];
    out.push({
      title: typeof item.title === 'string' ? item.title : '',
      pageIndex,
      children,
      collapsed: typeof item.count === 'number' && item.count < 0,
    });
  }
  return out;
}

export function usePdfOutline(options: UsePdfOutlineOptions): UsePdfOutlineResult {
  const { doc } = options;
  const [entries, setEntries] = useState<OutlineEntry[] | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    setEntries(null);
    if (!doc) return;
    let cancelled = false;
    setLoading(true);

    (async () => {
      const raw = await doc.getOutline();
      if (cancelled) return;
      const tree = raw && raw.length > 0 ? await buildTree(doc, raw as RawOutlineItem[]) : [];
      if (cancelled) return;
      setEntries(tree);
      setLoading(false);
    })().catch(() => {
      // A malformed outline is not worth surfacing as an error.
      if (!cancelled) {
        setEntries([]);
        setLoading(false);
      }
    });

    return () => {
      cancelled = true;
    };
  }, [doc]);

  return { entries, loading };
}
