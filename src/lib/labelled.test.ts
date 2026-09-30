/*
 * FR-12 at the engine boundary: what a labelled document actually reports.
 *
 * The fixture is hand-written in `scripts/make-labelled-pdf.mjs` because `/PageLabels` is a dictionary most
 * producers never emit, and the point of reading it from pdf.js rather than asserting the arithmetic in
 * `src/lib/page-labels.ts` is that three things here are the engine's choice and not ours: that a range
 * *restarts* numbering, that `/P (A-)` is composed onto the numeral instead of replacing it, and that a
 * document with no `/PageLabels` answers `null` rather than a table of "1", "2", "3". The last is the case
 * for nearly every file in existence, so `resolvePageInput`'s numeric path is not a fallback for the rare
 * labelled document — it is the normal one.
 *
 * Two clean loads in one process, which is fine: the fake worker only wedges after an *abandoned* load
 * (see `encrypted.test.ts`), and neither of these is abandoned.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { getDocument, type PDFDocumentProxy } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { describe, expect, it } from 'vitest';

import { labelsDifferFromNumbers, resolvePageInput } from './page-labels';

const fixture = (name: string): Uint8Array =>
  new Uint8Array(readFileSync(join(process.cwd(), 'playground', 'fixtures', name)));

async function open(name: string): Promise<PDFDocumentProxy> {
  return getDocument({ data: fixture(name) }).promise;
}

describe('a document that numbers its front matter', () => {
  it('reports one label per page, with ranges restarting and the /P prefix composed', async () => {
    const doc = await open('labelled-sample.pdf');
    expect(doc.numPages).toBe(10);
    expect(await doc.getPageLabels()).toEqual([
      'i',
      'ii',
      'iii',
      '1',
      '2',
      '3',
      '4',
      '5',
      'A-1',
      'A-2',
    ]);
  });

  /*
   * The requirement's sentence, run through the real table: a reader who sees "iii" types "iii" and lands
   * on the third page, and "A-1" is reachable at all. This is the assertion that would have been written
   * against a guessed table if the fixture had not been read from the engine first.
   */
  it('answers a typed label with the page wearing it, not the page with that number', async () => {
    const doc = await open('labelled-sample.pdf');
    const labels = await doc.getPageLabels();
    expect(labelsDifferFromNumbers(labels, doc.numPages)).toBe(true);
    expect(resolvePageInput('iii', labels, doc.numPages)).toBe(3);
    expect(resolvePageInput('A-1', labels, doc.numPages)).toBe(9);
    expect(resolvePageInput('2', labels, doc.numPages)).toBe(5);
    expect(resolvePageInput('999', labels, doc.numPages)).toBe(10);
    expect(resolvePageInput('page 5', labels, doc.numPages)).toBeNull();
  });
});

describe('a document that labels nothing', () => {
  it('answers null, and the numeric path keeps working on it', async () => {
    const doc = await open('long-sample.pdf');
    expect(await doc.getPageLabels()).toBeNull();
    const labels = await doc.getPageLabels();
    expect(labelsDifferFromNumbers(labels, doc.numPages)).toBe(false);
    expect(resolvePageInput('12', labels, doc.numPages)).toBe(12);
    expect(resolvePageInput('iii', labels, doc.numPages)).toBeNull();
  });
});
