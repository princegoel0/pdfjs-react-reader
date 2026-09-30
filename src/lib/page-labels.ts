/*
 * Page labels: what a page is *called*, when the document has decided that is not its number.
 *
 * A `/PageLabels` dictionary gives every page a label, and pdf.js hands the whole table back from
 * `doc.getPageLabels()` — measured on `playground/fixtures/labelled-sample.pdf`, which declares roman
 * front matter, a decimal body restarting at 1, and an appendix whose `/P (A-)` prefix the engine
 * composes onto the numeral: `i ii iii 1 2 3 4 5 A-1 A-2` for ten pages. An unlabelled document does not
 * get a synthesized table: the same call answers `null`, which is the case for the overwhelming majority
 * of files, so `null` is the normal path rather than a failure to handle.
 *
 * Two rules here are decisions, not facts, and both are FR-12's:
 *
 * - **Label first, number second.** A reader who sees "iii" and types "iii" means the page wearing that
 *   label, which is index 2 — not index 3. Typing "5" in a document whose fifth page is labelled "ii" is
 *   ambiguous, and the display is what the reader is copying, so the label match wins and the numeric
 *   reading is the fallback. When a document's labels *are* the plain numbers, the two rules agree, which
 *   is why there is no separate branch for that case.
 * - **Clamping survives as the fallback, not as the parser.** A value that names no label and is not a
 *   whole number resolves to nothing, and the toolbar puts its own page back in the box. A value that is a
 *   whole number clamps to the document, because "999" in a fourteen-page file is a reader reaching past
 *   the end, not a typo to refuse. The whole-number test is deliberately strict — `Number.parseInt('3a')`
 *   is 3, and a box that jumps to page 3 on "3a" is a box that jumps wherever the reader did not ask.
 */

/** What `doc.getPageLabels()` answers: a table, or nothing at all. */
export type PdfPageLabels = readonly string[] | null | undefined;

/**
 * The label for a 0-based page index, or `null` when the document does not name that page.
 *
 * A short table is treated as no label for the pages past its end rather than as a bug: the engine builds
 * the array from ranges, and a file whose `/Nums` stops early is a file that stops labelling, not one
 * that means page 40 to be called `undefined`.
 */
export function pageLabelForIndex(labels: PdfPageLabels, index: number): string | null {
  if (!labels || index < 0 || index >= labels.length) return null;
  const label = labels[index];
  return typeof label === 'string' && label.trim() !== '' ? label : null;
}

/** What the page is called on screen: its label when it has one, its 1-based number when it does not. */
export function formatPageLabel(labels: PdfPageLabels, index: number): string {
  return pageLabelForIndex(labels, index) ?? String(index + 1);
}

/**
 * Whether a document's labels differ from the plain page numbers.
 *
 * The toolbar's page box is a number input, which is the right control for a document labelled 1…N and the
 * wrong one for anything else — `type="number"` will not hold "xii", and will not show "01" either. This is
 * the test that decides which control to render, so an ordinary PDF keeps its spinner and its numeric
 * keyboard.
 *
 * A table that stops short of the document is *not* a difference: the pages past its end fall back to their
 * numbers, which is what the box would have shown anyway. Only a label that disagrees with its own position
 * changes what the reader sees, so only that changes the control.
 */
export function labelsDifferFromNumbers(
  labels: PdfPageLabels,
  numPages: number = labels?.length ?? 0,
): boolean {
  if (!labels) return false;
  const limit = numPages > 0 ? Math.min(labels.length, numPages) : labels.length;
  for (let index = 0; index < limit; index++) {
    if (formatPageLabel(labels, index) !== String(index + 1)) return true;
  }
  return false;
}

/**
 * Which page a typed value asks for, 1-based, or `null` when it names nothing.
 *
 * Case-folded, because "XII" is the same label with the shift key held; trimmed, because a box keeps a
 * stray space after a paste.
 */
export function resolvePageInput(
  value: string,
  labels: PdfPageLabels,
  numPages: number,
): number | null {
  const typed = value.trim();
  if (typed === '' || !(numPages > 0)) return null;

  if (labels) {
    const needle = typed.toLowerCase();
    const index = labels.findIndex((label) => typeof label === 'string' && label.trim().toLowerCase() === needle);
    if (index >= 0) return index + 1;
  }

  if (!/^-?\d+$/.test(typed)) return null;
  const parsed = Number.parseInt(typed, 10);
  if (!Number.isFinite(parsed)) return null;
  return Math.min(Math.max(parsed, 1), numPages);
}
