import type { PageMatch } from './search';

interface DivRange {
  start: number;
  /** null = to the end of the div's text. */
  end: number | null;
  local: number;
}

/**
 * Wraps matched character ranges of the text layer's divs in <mark> elements.
 * Matches never overlap, so each div can be rebuilt in a single pass. Callers
 * must first unwrap marks from the previous call (replacing children with the
 * div's own textContent is enough) — see `unwrapMarks`.
 *
 * `touched` collects the divs that received marks so the caller can unwrap
 * them on the next update.
 */
export function applyHighlights(
  divs: HTMLElement[],
  matches: PageMatch[],
  activeLocal: number,
  touched: HTMLElement[],
): void {
  if (matches.length === 0) return;

  const rangesByDiv = new Map<number, DivRange[]>();
  for (let local = 0; local < matches.length; local++) {
    const match = matches[local]!;
    for (let i = match.beginIdx; i <= match.endIdx && i < divs.length; i++) {
      let ranges = rangesByDiv.get(i);
      if (!ranges) {
        ranges = [];
        rangesByDiv.set(i, ranges);
      }
      ranges.push({
        start: i === match.beginIdx ? match.beginOffset : 0,
        end: i === match.endIdx ? match.endOffset : null,
        local,
      });
    }
  }

  for (const [divIdx, ranges] of rangesByDiv) {
    const div = divs[divIdx];
    if (!div) continue;
    if (splitDiv(div, ranges, activeLocal)) touched.push(div);
  }
}

/** Collapses any <mark> children back into plain text nodes. */
export function unwrapMarks(divs: Iterable<HTMLElement>): void {
  for (const div of divs) {
    // A text-layer div holds only text and our marks, so reassigning
    // textContent restores the original single-text-node shape.
    if (div.textContent !== null) div.textContent = div.textContent;
  }
}

function splitDiv(div: HTMLElement, ranges: DivRange[], activeLocal: number): boolean {
  const text = div.textContent ?? '';
  ranges.sort((a, b) => a.start - b.start);

  const frag = document.createDocumentFragment();
  let cursor = 0;
  let marked = false;
  for (const range of ranges) {
    const start = Math.max(cursor, Math.min(range.start, text.length));
    const end = Math.max(start, Math.min(range.end ?? text.length, text.length));
    if (end <= start) continue;
    if (start > cursor) frag.append(document.createTextNode(text.slice(cursor, start)));
    const mark = document.createElement('mark');
    mark.className = range.local === activeLocal ? 'pjsr-mark pjsr-mark--active' : 'pjsr-mark';
    mark.textContent = text.slice(start, end);
    frag.append(mark);
    cursor = end;
    marked = true;
  }
  if (!marked) return false;

  if (cursor < text.length) frag.append(document.createTextNode(text.slice(cursor)));
  div.replaceChildren(frag);
  return true;
}
