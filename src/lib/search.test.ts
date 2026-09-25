import { describe, expect, it } from 'vitest';
import {
  buildPageText,
  convertMatches,
  countPerPage,
  escapeRegExp,
  findPageMatches,
  planFind,
  type PageTextIndex,
  type ResolvedSearchOptions,
  type TextItemLike,
} from './search';

function item(str: string, hasEOL = false): TextItemLike {
  return { str, hasEOL };
}

const BASE: ResolvedSearchOptions = { caseSensitive: false, wholeWord: false, regex: false };

/** The way the hook uses it: plan once, then scan each page. */
function find(page: PageTextIndex, query: string, options: Partial<ResolvedSearchOptions> = {}) {
  return findPageMatches(page, planFind(query, { ...BASE, ...options }));
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

describe('findPageMatches', () => {
  const opts = { caseSensitive: false, wholeWord: false, regex: false };

  it('returns an empty list for an empty query', () => {
    const page = buildPageText([item('anything')]);
    expect(find(page, '', opts)).toEqual([]);
  });

  it('finds all occurrences with per-item coordinates', () => {
    const page = buildPageText([item('the cat'), item(' sat on the mat')]);
    const matches = find(page, 'the', opts);
    expect(matches).toHaveLength(2);
    expect(matches[0]).toMatchObject({ beginIdx: 0, beginOffset: 0, endIdx: 0, endOffset: 3 });
    expect(matches[1]).toMatchObject({ beginIdx: 1, beginOffset: 8, endIdx: 1, endOffset: 11 });
  });

  it('matches case-insensitively by default and honors case sensitivity', () => {
    const page = buildPageText([item('The thesis')]);
    expect(find(page, 'the', opts)).toHaveLength(2);
    const sensitive = find(page, 'the', { caseSensitive: true, wholeWord: false });
    expect(sensitive).toHaveLength(1);
    expect(sensitive[0]).toMatchObject({ beginOffset: 4 });
  });

  it('spans matches across multiple items', () => {
    const page = buildPageText([item('trac'), item('emonkey')]);
    const matches = find(page, 'trace', opts);
    expect(matches).toHaveLength(1);
    expect(matches[0]).toMatchObject({ beginIdx: 0, beginOffset: 0, endIdx: 1, endOffset: 1 });
  });

  it('ends a match exactly at an item boundary', () => {
    const page = buildPageText([item('abc'), item('def')]);
    const matches = find(page, 'abcd', opts);
    expect(matches).toHaveLength(1);
    expect(matches[0]).toMatchObject({ beginIdx: 0, beginOffset: 0, endIdx: 1, endOffset: 1 });
  });

  it('treats regex metacharacters in the query literally', () => {
    const page = buildPageText([item('a.b (c)')]);
    expect(find(page, 'a.b', opts)).toHaveLength(1);
    expect(find(page, '(c)', opts)).toHaveLength(1);
  });

  it('requires word boundaries when wholeWord is set', () => {
    const page = buildPageText([item('the theater is the best')]);
    expect(find(page, 'the', { caseSensitive: false, wholeWord: true })).toHaveLength(2);
  });

  it('excludes the inside larger words', () => {
    const page = buildPageText([item('them they there other')]);
    expect(find(page, 'the', { caseSensitive: false, wholeWord: true })).toHaveLength(0);
  });

  it('counts adjacent whole-word repeats', () => {
    const page = buildPageText([item('the the the')]);
    expect(find(page, 'the', { caseSensitive: false, wholeWord: true })).toHaveLength(3);
  });

  it('does not match across a line break when wholeWord is set', () => {
    const withBreak = buildPageText([item('the', true), item('ater')]);
    expect(
      find(withBreak, 'theater', { caseSensitive: false, wholeWord: true }),
    ).toHaveLength(0);

    const joined = buildPageText([item('the'), item('ater')]);
    expect(find(joined, 'theater', { caseSensitive: false, wholeWord: true })).toHaveLength(1);
  });

  it('matches a word at the start of a line after hasEOL', () => {
    const page = buildPageText([item('one', true), item('two')]);
    const matches = find(page, 'two', { caseSensitive: false, wholeWord: true });
    expect(matches).toHaveLength(1);
    expect(matches[0]).toMatchObject({ beginIdx: 1, beginOffset: 0 });
  });

  it('skips whole-word checks for non-word query edges', () => {
    const page = buildPageText([item('x = 1; y = 2')]);
    const matches = find(page, '=', { caseSensitive: false, wholeWord: true });
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

describe('planFind', () => {
  it('splits a plain query into words and drops runs of whitespace', () => {
    const plan = planFind('  trace   monkey ', BASE);
    expect(plan.terms).toEqual(['trace', 'monkey']);
    expect(plan.pattern).toBeNull();
    expect(plan.error).toBeNull();
  });

  it('does not split a regex query, where a space is part of the pattern', () => {
    const plan = planFind('a b|c d', { ...BASE, regex: true });
    expect(plan.terms).toEqual([]);
    expect(plan.pattern?.source).toBe('a b|c d');
  });

  it('reports an uncompilable pattern instead of throwing', () => {
    const plan = planFind('trace(', { ...BASE, regex: true });
    expect(plan.pattern).toBeNull();
    expect(plan.error).toBeTruthy();
  });

  it('honours case sensitivity in the flags it compiles with', () => {
    expect(planFind('Trace', { ...BASE, regex: true, caseSensitive: true }).pattern?.flags).toBe('g');
    expect(planFind('Trace', { ...BASE, regex: true }).pattern?.flags).toBe('gi');
  });

  it('plans nothing for an empty query', () => {
    const plan = planFind('', BASE);
    expect(plan.terms).toEqual([]);
    expect(plan.pattern).toBeNull();
  });
});

describe('multi-term search', () => {
  it('keeps a page that holds every word', () => {
    const page = buildPageText([item('Trace-based compilation of Monkey JavaScript')]);
    expect(find(page, 'trace monkey')).toHaveLength(2);
  });

  it('drops a page that holds only one of them', () => {
    const page = buildPageText([item('Trace-based compilation of dynamic languages')]);
    expect(find(page, 'trace monkey')).toEqual([]);
  });

  it('reports matches in reading order, not in the order the words were typed', () => {
    const page = buildPageText([item('monkey said trace, and the monkey left')]);
    const matches = find(page, 'trace monkey');
    expect(matches.map((match) => match.beginOffset)).toEqual([0, 12, 27]);
  });

  it('counts every repeat of every word', () => {
    const page = buildPageText([item('trace a trace and monkey a monkey')]);
    expect(find(page, 'trace monkey')).toHaveLength(4);
  });

  it('keeps the longer of two spans that start in the same place', () => {
    // "the" sits inside "theory" at offset 4, so both start there and one mark is right.
    const page = buildPageText([item('the theory of the thing')]);
    const matches = find(page, 'the theory');
    expect(matches).toHaveLength(3);
    expect(matches.map((match) => match.beginOffset)).toEqual([0, 4, 14]);
  });
});

describe('regex search', () => {
  it('matches a character class the literal path would treat as text', () => {
    const page = buildPageText([item('q1 q2 q9')]);
    expect(find(page, 'q[0-9]', { regex: true })).toHaveLength(3);
    expect(find(page, 'q[0-9]')).toEqual([]);
  });

  it('anchors, which the word-splitting path cannot express', () => {
    const page = buildPageText([item('TraceMonkey and trace trees')]);
    expect(find(page, '^Trace', { regex: true })).toHaveLength(1);
    expect(find(page, 'trees$', { regex: true })).toHaveLength(1);
    expect(find(page, '^trees', { regex: true })).toHaveLength(0);
  });

  it('respects case sensitivity', () => {
    const page = buildPageText([item('Trace trace')]);
    expect(find(page, 'trace', { regex: true })).toHaveLength(2);
    expect(find(page, 'trace', { regex: true, caseSensitive: true })).toHaveLength(1);
  });

  it('produces nothing when the pattern fails to compile', () => {
    const page = buildPageText([item('anything')]);
    expect(find(page, '(unclosed', { regex: true })).toEqual([]);
  });

  it('skips a zero-width match instead of looping on it', () => {
    const page = buildPageText([item('abc')]);
    expect(find(page, 'd*', { regex: true })).toEqual([]);
  });

  it('maps a variable-length match across items', () => {
    const page = buildPageText([item('trac'), item('emonkey')]);
    const matches = find(page, 'trace+', { regex: true });
    expect(matches).toHaveLength(1);
    expect(matches[0]).toMatchObject({ beginIdx: 0, beginOffset: 0, endIdx: 1 });
  });
});

describe('countPerPage', () => {
  it('counts by page and keeps the empty pages as slots', () => {
    const matches = [
      { pageIndex: 0, beginIdx: 0, beginOffset: 0, endIdx: 0, endOffset: 1 },
      { pageIndex: 0, beginIdx: 0, beginOffset: 2, endIdx: 0, endOffset: 3 },
      { pageIndex: 2, beginIdx: 1, beginOffset: 0, endIdx: 1, endOffset: 4 },
    ];
    expect(countPerPage(matches, 4)).toEqual([2, 0, 1, 0]);
  });

  it('ignores unassigned matches rather than indexing past the end', () => {
    const matches = [
      { pageIndex: -1, beginIdx: 0, beginOffset: 0, endIdx: 0, endOffset: 1 },
      { pageIndex: 9, beginIdx: 0, beginOffset: 0, endIdx: 0, endOffset: 1 },
    ];
    expect(countPerPage(matches, 3)).toEqual([0, 0, 0]);
  });
});
