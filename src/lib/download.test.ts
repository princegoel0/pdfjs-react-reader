import { describe, expect, it } from 'vitest';
import { pdfFileName } from './download';

describe('pdfFileName', () => {
  it('falls back when there is nothing to name the file from', () => {
    expect(pdfFileName(undefined)).toBe('document.pdf');
    expect(pdfFileName('')).toBe('document.pdf');
    expect(pdfFileName('   ')).toBe('document.pdf');
    expect(pdfFileName('.pdf')).toBe('document.pdf');
    expect(pdfFileName('   ', 'report')).toBe('report.pdf');
  });

  it('adds exactly one extension', () => {
    expect(pdfFileName('invoice')).toBe('invoice.pdf');
    expect(pdfFileName('invoice.pdf')).toBe('invoice.pdf');
    expect(pdfFileName('Invoice.PDF')).toBe('Invoice.pdf');
  });

  it('replaces characters the OS rejects without eating the rest of the name', () => {
    expect(pdfFileName('a/b:c*d?e"f<g>h|i')).toBe('a b c d e f g h i.pdf');
    expect(pdfFileName('Q3\\2026')).toBe('Q3 2026.pdf');
  });

  it('leaves ordinary punctuation and non-latin titles alone', () => {
    expect(pdfFileName('  Rapport final (v2)  ')).toBe('Rapport final (v2).pdf');
    expect(pdfFileName('日本語のドキュメント')).toBe('日本語のドキュメント.pdf');
  });
});
