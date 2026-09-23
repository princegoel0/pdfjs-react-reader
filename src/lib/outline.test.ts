import { describe, expect, it, vi } from 'vitest';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import { parseDestination, resolveDestinationPageIndex } from './outline';

describe('parseDestination', () => {
  it('treats an integer first element as a 0-based page index', () => {
    expect(parseDestination([2, 'XYZ', null, null])).toEqual({ kind: 'index', index: 2 });
    expect(parseDestination([0])).toEqual({ kind: 'index', index: 0 });
  });
  it('reads a { num, gen } object reference', () => {
    expect(parseDestination([{ num: 17, gen: 0 }, 'Fit'])).toEqual({
      kind: 'proxy',
      num: 17,
      gen: 0,
    });
    expect(parseDestination([{ num: 17 }])).toEqual({ kind: 'proxy', num: 17, gen: 0 });
  });
  it('returns null for missing or invalid destinations', () => {
    expect(parseDestination(null)).toBeNull();
    expect(parseDestination(undefined)).toBeNull();
    expect(parseDestination([])).toBeNull();
    expect(parseDestination('named')).toBeNull();
    expect(parseDestination([{ gen: 0 }])).toBeNull();
    expect(parseDestination([-1])).toBeNull();
    expect(parseDestination([1.5])).toBeNull();
  });
});

describe('resolveDestinationPageIndex', () => {
  it('passes through a numeric index', async () => {
    const doc = { cachedPageNumber: vi.fn(), getPageIndex: vi.fn() } as unknown as PDFDocumentProxy;
    expect(await resolveDestinationPageIndex(doc, [3])).toBe(3);
    expect(doc.cachedPageNumber).not.toHaveBeenCalled();
  });
  it('prefers the cached page number (1-based) for object refs', async () => {
    const doc = {
      cachedPageNumber: vi.fn().mockReturnValue(5),
      getPageIndex: vi.fn(),
    } as unknown as PDFDocumentProxy;
    expect(await resolveDestinationPageIndex(doc, [{ num: 42, gen: 0 }])).toBe(4);
    expect(doc.cachedPageNumber).toHaveBeenCalledWith({ num: 42, gen: 0 });
    expect(doc.getPageIndex).not.toHaveBeenCalled();
  });
  it('falls back to getPageIndex (0-based) when not cached', async () => {
    const doc = {
      cachedPageNumber: vi.fn().mockReturnValue(null),
      getPageIndex: vi.fn().mockResolvedValue(7),
    } as unknown as PDFDocumentProxy;
    expect(await resolveDestinationPageIndex(doc, [{ num: 42, gen: 0 }])).toBe(7);
    expect(doc.getPageIndex).toHaveBeenCalledWith({ num: 42, gen: 0 });
  });
  it('returns null when the reference cannot be resolved', async () => {
    const doc = {
      cachedPageNumber: vi.fn().mockReturnValue(null),
      getPageIndex: vi.fn().mockRejectedValue(new Error('bad ref')),
    } as unknown as PDFDocumentProxy;
    expect(await resolveDestinationPageIndex(doc, [{ num: 42 }])).toBeNull();
  });
});
