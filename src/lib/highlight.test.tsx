/*
 * The marks a search leaves in the text layer, and the two channels that say which one the reader is on.
 *
 * `PRD.md`'s FR-44 names the active match as a distinction carried by colour alone, so this file pins the
 * fix where it is made: one statement in `splitDiv` sets the class, the ring's hook and `aria-current`
 * together, which is the only reason the three can never disagree. A stylesheet test can say the rule
 * exists; only a test against the DOM says the element it targets is the element that was built.
 */
import { describe, expect, it } from 'vitest';
import { applyHighlights, unwrapMarks } from './highlight';
import type { PageMatch } from './search';

const div = (text: string) => {
  const el = document.createElement('div');
  el.textContent = text;
  return el;
};

const match = (beginIdx: number, endIdx: number, beginOffset: number, endOffset: number): PageMatch => ({
  pageIndex: 0,
  beginIdx,
  endIdx,
  beginOffset,
  endOffset,
});

describe('the marks a search leaves behind', () => {
  it('wraps each matched range and leaves the rest of the div alone', () => {
    const one = div('Revenue rose 12 percent');
    applyHighlights([one], [match(0, 0, 13, 23)], -1, []);

    expect([...one.querySelectorAll('mark')].map((mark) => mark.textContent)).toEqual(['12 percent']);
    expect(one.textContent).toBe('Revenue rose 12 percent');
  });

  it('marks the active match with the attribute the ring keys off, and no other', () => {
    const one = div('revenue and revenue again');
    applyHighlights([one], [match(0, 0, 0, 7), match(0, 0, 12, 19)], 1, []);

    const marks = [...one.querySelectorAll('mark')];
    expect(marks.map((mark) => mark.className)).toEqual([
      'pjsr-mark',
      'pjsr-mark pjsr-mark--active',
    ]);
    // FR-44: which match this is has to survive a palette that flattens the tint, and survive it in the
    // tree rather than only on the screen.
    expect(marks.map((mark) => mark.getAttribute('aria-current'))).toEqual([null, 'true']);
  });

  it('spans two divs when the phrase breaks across them', () => {
    const first = div('net income of');
    const second = div('the quarter');
    applyHighlights([first, second], [match(0, 1, 4, 3)], -1, []);

    expect([...first.querySelectorAll('mark')].map((mark) => mark.textContent)).toEqual(['income of']);
    expect([...second.querySelectorAll('mark')].map((mark) => mark.textContent)).toEqual(['the']);
  });

  it('comes back to a single text node when the search is cleared', () => {
    const one = div('revenue');
    const touched: HTMLElement[] = [];
    applyHighlights([one], [match(0, 0, 0, 7)], 0, touched);
    expect(one.childNodes.length).toBe(1);
    unwrapMarks(touched);

    expect(one.childNodes.length).toBe(1);
    expect(one.firstChild?.nodeType).toBe(Node.TEXT_NODE);
    expect(one.textContent).toBe('revenue');
  });
});
