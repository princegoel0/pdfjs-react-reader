/*
 * FR-12's two directions, and the ambiguity the requirement actually asks us to settle.
 *
 * The table these tests use is not invented: it is what pdf.js reports for
 * `playground/fixtures/labelled-sample.pdf`, and `src/lib/labelled.test.ts` pins that against the engine.
 * Keeping the fixture's shape here — roman front matter, a decimal body that restarts at 1, an appendix
 * whose label is a prefix plus a numeral — is what makes the interesting case exist at all: page 6 of this
 * document is labelled "2", so "2" is a value the reader could mean two ways, and the file has to say
 * which one it picked and why.
 */
import { describe, expect, it } from 'vitest';

import {
  formatPageLabel,
  labelsDifferFromNumbers,
  pageLabelForIndex,
  resolvePageInput,
  type PdfPageLabels,
} from './page-labels';

/** Ten pages: `i ii iii` then `1…5` then `A-1 A-2`. */
const LABELS: readonly string[] = ['i', 'ii', 'iii', '1', '2', '3', '4', '5', 'A-1', 'A-2'];
const PAGES = LABELS.length;

describe('naming a page', () => {
  it('reads the label off the table', () => {
    expect(pageLabelForIndex(LABELS, 0)).toBe('i');
    expect(pageLabelForIndex(LABELS, 7)).toBe('5');
    expect(formatPageLabel(LABELS, 8)).toBe('A-1');
  });

  it('falls back to the page number when the document labels nothing', () => {
    for (const absent of [null, undefined, []] satisfies PdfPageLabels[]) {
      expect(pageLabelForIndex(absent, 4)).toBeNull();
      expect(formatPageLabel(absent, 4)).toBe('5');
    }
  });

  it('treats a blank entry and a short table as no label rather than as a name', () => {
    expect(pageLabelForIndex(['1', '   ', '3'], 1)).toBeNull();
    expect(formatPageLabel(['1', '   ', '3'], 1)).toBe('2');
    expect(pageLabelForIndex(['i', 'ii'], 40)).toBeNull();
    expect(pageLabelForIndex(LABELS, -1)).toBeNull();
  });
});

describe('knowing when labels are worth a different control', () => {
  it('says no for a document that labels nothing, or labels pages 1…N', () => {
    expect(labelsDifferFromNumbers(null, PAGES)).toBe(false);
    expect(labelsDifferFromNumbers(undefined, PAGES)).toBe(false);
    expect(labelsDifferFromNumbers([], PAGES)).toBe(false);
    expect(labelsDifferFromNumbers(['1', '2', '3'], 3)).toBe(false);
  });

  /*
   * The counterfactual that keeps `numPages` in the signature honest. A table that stops short of the
   * document is not a difference: pages past its end fall back to their numbers, which is what the number
   * box would have shown. The temptation is to call any length mismatch "labelled" and hand the reader a
   * text box for a document that says 1, 2, 3 — so this is pinned the other way.
   */
  it('still says no when the table runs short of the document', () => {
    expect(labelsDifferFromNumbers(['1', '2', '3'], 7)).toBe(false);
    expect(labelsDifferFromNumbers(['1', '2', 'iii'], 7)).toBe(true);
  });

  it('says yes for the fixture, for zero-padded decimals, and for a prefixed range', () => {
    expect(labelsDifferFromNumbers(LABELS, PAGES)).toBe(true);
    expect(labelsDifferFromNumbers(['01', '02'], 2)).toBe(true);
    expect(labelsDifferFromNumbers(['A-1', 'A-2'], 2)).toBe(true);
  });
});

describe('resolving what a reader typed', () => {
  it('names the page wearing the label, which is not the page with that number', () => {
    expect(resolvePageInput('iii', LABELS, PAGES)).toBe(3);
    expect(resolvePageInput('A-1', LABELS, PAGES)).toBe(9);
    expect(resolvePageInput('A-2', LABELS, PAGES)).toBe(10);
    /*
     * The case the rule exists for. Page 6 of this document is labelled "2", so a reader typing "2" who
     * means the *number* would land on a page whose box says "ii" — and the label reading is the one that
     * matches what they were looking at. Both answers are recorded here so the choice is visible rather
     * than implied.
     */
    expect(resolvePageInput('2', LABELS, PAGES)).toBe(5);
    expect(resolvePageInput('5', LABELS, PAGES)).toBe(8);
    expect(resolvePageInput('2', null, PAGES)).toBe(2);
  });

  it('ignores case and stray spaces, which are typing not meaning', () => {
    expect(resolvePageInput('III', LABELS, PAGES)).toBe(3);
    expect(resolvePageInput('  a-1 ', LABELS, PAGES)).toBe(9);
    expect(resolvePageInput(' 1 ', LABELS, PAGES)).toBe(4);
  });

  it('keeps numeric clamping as the fallback for a value no label answers', () => {
    expect(resolvePageInput('999', LABELS, PAGES)).toBe(10);
    expect(resolvePageInput('-2', LABELS, PAGES)).toBe(1);
    expect(resolvePageInput('7', LABELS, PAGES)).toBe(7);
    expect(resolvePageInput('0', null, PAGES)).toBe(1);
  });

  /*
   * `Number.parseInt('3a')` is 3, and the old box never saw such a value because `type="number"` would not
   * hold it. A label box is `type="text"`, so the strictness has to be written down here or a stray letter
   * moves the document.
   */
  it('refuses a value that names nothing instead of reading the digits out of it', () => {
    expect(resolvePageInput('3a', LABELS, PAGES)).toBeNull();
    expect(resolvePageInput('xii', LABELS, PAGES)).toBeNull();
    expect(resolvePageInput('1.5', LABELS, PAGES)).toBeNull();
    expect(resolvePageInput('', LABELS, PAGES)).toBeNull();
    expect(resolvePageInput('   ', LABELS, PAGES)).toBeNull();
  });

  it('resolves nothing while the document has no pages to resolve to', () => {
    expect(resolvePageInput('1', LABELS, 0)).toBeNull();
    expect(resolvePageInput('iii', LABELS, Number.NaN)).toBeNull();
  });

  it('still finds a label whose table entry carries padding of its own', () => {
    expect(resolvePageInput('i', [' i ', 'ii'], 2)).toBe(1);
  });
});
