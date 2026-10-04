/*
 * FR-45's page-change announcement, read as a policy over sequences.
 *
 * The clause is two words long — "page-change announcements" — and both failure directions are visible in a
 * screen reader: silence, which leaves a reader inside a wall of page-sized images with no idea they have
 * moved, and a sentence per scroll step, which is worse, because the queue of stale positions has to be
 * listened through before the useful one arrives. Which of those a change produces depends on what happened
 * *before* it, so this is a decision over a sequence and not a property of an element: the component that
 * renders the region is tested in `ViewerAnnouncement.test.tsx`, and the arithmetic of when it may speak is
 * here, where a sequence costs three lines.
 *
 * One rule is easy to write wrongly and is asserted on its own: the reader who scrolled out and back has not
 * changed pages. A pending sentence must not fire for a position the reader never ended up in — which is why
 * "what was last told" is only updated when the sentence is spoken, not when the page moves.
 */
import { describe, expect, it } from 'vitest';
import { DE_LABELS } from '../locales/de';
import { ES_LABELS } from '../locales/es';
import { FR_LABELS } from '../locales/fr';
import { ANNOUNCE_QUIET_MS, announcementText, observePosition, type PagePosition } from './page-announcement';
import { DEFAULT_LABELS, type PdfViewerLabels } from './labels';
import type { PdfPageLabels } from './page-labels';

const DOC = {};
const OTHER = {};
const at = (page: number, doc: object = DOC): PagePosition => ({ doc, page });

describe('what the shell does with one observation of where the reader is', () => {
  it('says nothing about the page a viewer opened on', () => {
    // A mounting viewer is not a reader who changed something. On a page with two viewers this is the
    // difference between an announcement and a lot of noise about documents nobody opened.
    expect(observePosition(null, at(1))).toBe('base');
  });

  it('treats the same page in the same document as no news at all', () => {
    expect(observePosition(at(4), at(4))).toBe('silent');
  });

  it('treats a different page as news', () => {
    expect(observePosition(at(4), at(5))).toBe('settle');
  });

  it('treats a replaced document as news even when the page number did not move', () => {
    // "Page 1 of 12" is a sentence about the file, not about the number, and the file just changed.
    expect(observePosition(at(1, DOC), at(1, OTHER))).toBe('settle');
  });

  it('falls silent again when the reader ends up where they were told to be', () => {
    // Out and back inside the quiet period. `told` is only advanced when a sentence is spoken, so the
    // position the reader left is still the position they are in, and there is nothing to say.
    const told = at(2);
    const moves = [at(3), at(4), at(3), at(2)];
    for (const move of moves) expect(observePosition(told, move)).toBe(move.page === 2 ? 'silent' : 'settle');
    expect(observePosition(told, moves.at(-1)!)).toBe('silent');
  });

  it('names the quiet period, because the burst behaviour depends on it', () => {
    // Long enough to outlast a wheel notch's page changes and a `PageDown` repeat; short enough that the
    // sentence still answers the move the reader just made. Asserted as a value so a change is a decision.
    expect(ANNOUNCE_QUIET_MS).toBe(400);
  });
});

describe('the sentence', () => {
  const text = (
    labels: PdfViewerLabels,
    page: number,
    pageLabels: PdfPageLabels = null,
    numPages = 12,
  ) => announcementText({ labels, page, numPages, pageLabels });

  it('says the page and the whole, in English', () => {
    expect(text(DEFAULT_LABELS, 3)).toBe('Page 3 of 12');
  });

  it('names a page by its label when the document has one (FR-12)', () => {
    // A reader told "Page iii of xii" by the page box and then "Page 3 of 12" by the live region has been
    // told two different things about one place, which is the failure FR-12 exists to prevent.
    const labels = ['i', 'ii', 'iii', '1', '2', '3', '4', '5', 'A-1', 'A-2', 'A-3', 'A-4'];
    expect(text(DEFAULT_LABELS, 3, labels)).toBe('Page iii of 12');
    expect(text(DEFAULT_LABELS, 9, labels)).toBe('Page A-1 of 12');
  });

  it('falls back to the number for a page past the end of a short label table', () => {
    expect(text(DEFAULT_LABELS, 12, ['i', 'ii'])).toBe('Page 12 of 12');
  });

  it('is built from the catalog in each shipped language', () => {
    expect(text(DE_LABELS, 3)).toBe('Seite 3 von 12');
    expect(text(ES_LABELS, 3)).toBe('Página 3 de 12');
    expect(text(FR_LABELS, 3)).toBe('Page 3 sur 12');
  });

  it('follows a host that overrides the label it announces with', () => {
    const host: PdfViewerLabels = { ...DEFAULT_LABELS, pageOf: '{page} / {total}' };
    expect(text(host, 7)).toBe('7 / 12');
  });
});
