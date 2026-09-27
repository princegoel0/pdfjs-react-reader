import { describe, expect, it } from 'vitest';
import { DEFAULT_LABELS, type PdfViewerLabels } from '../lib/labels';
import { DE_LABELS } from './de';
import { ES_LABELS } from './es';
import { FR_LABELS } from './fr';

/*
 * What a shipped catalog has to satisfy, in the terms a machine can check.
 *
 * The typing does half of it already — each catalog is `PdfViewerLabels`, the complete
 * shape, so a key added to the English source stops the build until every language has
 * answered it. These are the two things a type cannot say: that a `{page}` slot survived
 * the translation, and that the file is in fact translated.
 */

const CATALOGS: Record<string, PdfViewerLabels> = {
  de: DE_LABELS,
  es: ES_LABELS,
  fr: FR_LABELS,
};

const KEYS = Object.keys(DEFAULT_LABELS) as (keyof PdfViewerLabels)[];

/** The slots a template carries, in a stable order. */
const slots = (template: string): string[] =>
  [...template.matchAll(/\{(\w+)\}/g)].map((match) => match[1] ?? '').sort();

describe.each(Object.entries(CATALOGS))('%s catalog', (code, catalog) => {
  it('answers every key the default has, and no others', () => {
    expect(Object.keys(catalog).sort()).toEqual([...KEYS].sort());
  });

  it('holds a non-empty string for every key, trimmed', () => {
    for (const key of KEYS) {
      const value = catalog[key];
      expect(typeof value, `${code}.${key}`).toBe('string');
      expect(value.length, `${code}.${key}`).toBeGreaterThan(0);
      expect(value, `${code}.${key} has stray whitespace`).toBe(value.trim());
    }
  });

  // A slot lost in translation does not throw: `formatLabel` leaves `{page}` intact, so
  // the reader gets a button named "Seite {page}" and nothing ever reports it as wrong.
  it('carries exactly the slots the English template does', () => {
    for (const key of KEYS) {
      expect(slots(catalog[key]), `${code}.${key}`).toEqual(slots(DEFAULT_LABELS[key]));
    }
  });

  /*
   * Catches a key nobody got round to, without pretending a language cannot share a word
   * with English. French writes "Page" and "Document"; `{label} ({shortcut})` is nothing
   * but punctuation around two slots in any of them. A new echo has to be listed here,
   * which is the point: it makes the decision visible in the diff.
   */
  const SHARED: Record<string, string[]> = {
    de: ['withShortcut'],
    es: ['withShortcut'],
    fr: ['pageLabel', 'pagesTab', 'overflowDocument', 'withShortcut'],
  };

  it('translates rather than echoing', () => {
    const echoed = KEYS.filter((key) => catalog[key] === DEFAULT_LABELS[key]);
    expect(echoed.sort()).toEqual([...(SHARED[code] ?? [])].sort());
  });

  // One object per language, shared by every viewer on the page. A host that wrote to it
  // would rename the control for everybody else, which is the failure the freeze prevents
  // — and the reason these three are frozen while `DEFAULT_LABELS`, which has been
  // published mutable since `0.2`, waits on the freeze review.
  it('cannot be mutated by the application that imports it', () => {
    expect(Object.isFrozen(catalog)).toBe(true);
  });
});

it('has a key list the catalogs were written against', () => {
  expect(KEYS.length).toBe(134);
});
