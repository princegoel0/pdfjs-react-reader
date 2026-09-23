import { describe, expect, it } from 'vitest';
import { buildPageText, convertMatches, escapeRegExp, findQueryMatches, type TextItemLike } from './search';

function item(str: string, hasEOL = false): TextItemLike {
  return { str, hasEOL };
}

describe('buildPageText', () => {
  it('concatenates item strings and tracks cumulative ends', () => {
    const page = buildPageText([item('Hello'), item(' world')]);
    expect(page.text).toBe('Hello world');
    expect(page.itemEnds).toEqual([5, 11]);
    expect(page.items).toHaveLength(2);
  });

  it('appends a newline after items flagged hasEOL', () => {
    const page = buildPageText([item('first', true), item('second')]);
    expect(page.text).toBe('first\nsecond');
    expect(page.itemEnds).toEqual([6, 12]);
  });

  it('skips marked-content boundary items', () => {
    const page = buildPageText([
      { type: 'beginMarkedContent' },
      item('text'),
      { type: 'endMarkedContent' },
    ]);
    expect(page.text).toBe('text');
    expect(page.items).toHaveLength(1);
    expect(page.itemEnds).toEqual([4]);
  });
});

describe('escapeRegExp', () => {
  it('escapes regex metacharacters', () => {
    expect(escapeRegExp('a.b*c(d)')).toBe('a\\.b\\*c\\(d\\)');
    expect(escapeRegExp('[x]')).toBe('\\[x\\]');
  });
});

describe('findQueryMatches', () => {
  const opts = { caseSensitive: false, wholeWord: false };

  it('returns an empty list for an empty query', () => {
    const page = buildPageText([item('anything')]);
    expect(findQueryMatches(page, '', opts)).toEqual([]);
  });

  it('finds all occurrences with per-item coordinates', () => {
    const page = buildPageText([item('the cat'), item(' sat on the mat')]);
    const matches = findQueryMatches(page, 'the', opts);
    expect(matches).toHaveLength(2);
    expect(matches[0]).toMatchObject({ beginIdx: 0, beginOffset: 0, endIdx: 0, endOffset: 3 });
    expect(matches[1]).toMatchObject({ beginIdx: 1, beginOffset: 8, endIdx: 1, endOffset: 11 });
  });

  it('matches case-insensitively by default and honors case sensitivity', () => {
    const page = buildPageText([item('The thesis')]);
    expect(findQueryMatches(page, 'the', opts)).toHaveLength(2);
    const sensitive = findQueryMatches(page, 'the', { caseSensitive: true, wholeWord: false });
    expect(sensitive).toHaveLength(1);
    expect(sensitive[0]).toMatchObject({ beginOffset: 4 });
  });

  it('spans matches across multiple items', () => {
    const page = buildPageText([item('trac'), item('emonkey')]);
    const matches = findQueryMatches(page, 'trace', opts);
    expect(matches).toHaveLength(1);
    expect(matches[0]).toMatchObject({ beginIdx: 0, beginOffset: 0, endIdx: 1, endOffset: 1 });
  });

  it('ends a match exactly at an item boundary', () => {
    const page = buildPageText([item('abc'), item('def')]);
    const matches = findQueryMatches(page, 'abcd', opts);
    expect(matches).toHaveLength(1);
    expect(matches[0]).toMatchObject({ beginIdx: 0, beginOffset: 0, endIdx: 1, endOffset: 1 });
  });

  it('treats regex metacharacters in the query literally', () => {
    const page = buildPageText([item('a.b (c)')]);
    expect(findQueryMatches(page, 'a.b', opts)).toHaveLength(1);
    expect(findQueryMatches(page, '(c)', opts)).toHaveLength(1);
  });

  it('requires word boundaries when wholeWord is set', () => {
    const page = buildPageText([item('the theater is the best')]);
    expect(findQueryMatches(page, 'the', { caseSensitive: false, wholeWord: true })).toHaveLength(2);
  });

  it('excludes the inside larger words', () => {
    const page = buildPageText([item('them they there other')]);
    expect(findQueryMatches(page, 'the', { caseSensitive: false, wholeWord: true })).toHaveLength(0);
  });

  it('counts adjacent whole-word repeats', () => {
    const page = buildPageText([item('the the the')]);
    expect(findQueryMatches(page, 'the', { caseSensitive: false, wholeWord: true })).toHaveLength(3);
  });

  it('does not match across a line break when wholeWord is set', () => {
    const withBreak = buildPageText([item('the', true), item('ater')]);
    expect(
      findQueryMatches(withBreak, 'theater', { caseSensitive: false, wholeWord: true }),
    ).toHaveLength(0);

    const joined = buildPageText([item('the'), item('ater')]);
    expect(findQueryMatches(joined, 'theater', { caseSensitive: false, wholeWord: true })).toHaveLength(1);
  });

  it('matches a word at the start of a line after hasEOL', () => {
    const page = buildPageText([item('one', true), item('two')]);
    const matches = findQueryMatches(page, 'two', { caseSensitive: false, wholeWord: true });
    expect(matches).toHaveLength(1);
    expect(matches[0]).toMatchObject({ beginIdx: 1, beginOffset: 0 });
  });

  it('skips whole-word checks for non-word query edges', () => {
    const page = buildPageText([item('x = 1; y = 2')]);
    const matches = findQueryMatches(page, '=', { caseSensitive: false, wholeWord: true });
    expect(matches).toHaveLength(2);
  });
});

describe('convertMatches', () => {
  it('maps sorted string offsets to item ranges', () => {
    const page = buildPageText([item('aa'), item('bbb'), item('cc')]);
    const matches = convertMatches(page, [0, 5], 2);
    expect(matches[0]).toMatchObject({ beginIdx: 0, beginOffset: 0, endIdx: 0, endOffset: 2 });
    expect(matches[1]).toMatchObject({ beginIdx: 2, beginOffset: 0, endIdx: 2, endOffset: 2 });
  });
});
