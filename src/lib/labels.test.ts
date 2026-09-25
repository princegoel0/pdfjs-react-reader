import { describe, expect, it } from 'vitest';
import { DEFAULT_LABELS, formatLabel, type PdfViewerLabels } from './labels';

describe('formatLabel', () => {
  it('substitutes named slots', () => {
    expect(formatLabel(DEFAULT_LABELS.pageOf, { page: 3, total: 14 })).toBe('Page 3 of 14');
  });

  it('coerces numbers', () => {
    expect(formatLabel(DEFAULT_LABELS.zoomPercent, { percent: 125 })).toBe('125%');
  });

  it('substitutes a repeated slot everywhere it appears', () => {
    expect(formatLabel('{a}+{a}', { a: 'x' })).toBe('x+x');
  });

  it('leaves an unfilled slot visible rather than blanking it', () => {
    // A partial catalog is a real mistake; swallowing it would render a control
    // with no label at all.
    expect(formatLabel('Go to page {page}', {})).toBe('Go to page {page}');
  });

  it('ignores braces that are not identifiers', () => {
    expect(formatLabel('not {a-b} here', { a: 1 })).toBe('not {a-b} here');
  });

  it('returns the template unchanged when it has no slots', () => {
    expect(formatLabel(DEFAULT_LABELS.zoomIn, { page: 1 })).toBe('Zoom in');
  });
});

describe('DEFAULT_LABELS', () => {
  const entries = Object.entries(DEFAULT_LABELS);

  it('is fully populated', () => {
    expect(entries.length).toBeGreaterThan(50);
  });

  it('has no empty or non-string values', () => {
    for (const [key, value] of entries) {
      expect(typeof value, key).toBe('string');
      expect(value.trim(), key).not.toBe('');
    }
  });

  it('declares every slot it substitutes at its own use site as a placeholder', () => {
    // Guards against a template whose braces are typo'd, e.g. "{page}" written
    // as "{page }", which would never match and would surface as raw braces.
    for (const [key, value] of entries) {
      for (const match of value.matchAll(/\{([^}]*)\}/g)) {
        expect(match[1], `${key} has a malformed slot`).toMatch(/^\w+$/);
      }
    }
  });

  it('accepts a partial override without losing type checking', () => {
    const override: Partial<PdfViewerLabels> = { zoomIn: 'Vergrößern' };
    const merged: PdfViewerLabels = { ...DEFAULT_LABELS, ...override };
    expect(merged.zoomIn).toBe('Vergrößern');
    expect(merged.zoomOut).toBe('Zoom out');
  });
});
