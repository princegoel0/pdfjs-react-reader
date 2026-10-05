/*
 * FR-15: the bar's own controls, and whether what they change is the search.
 *
 * The clause names four things — case sensitivity, whole-word, next and previous, and a live counter — and
 * the counter has its own file (`SearchBox.counter.test.tsx`). What had no assertion at all was the other
 * three reaching anything: `nextMatch` and `prevMatch` appear in the test tree only as `vi.fn()` stubs
 * nobody clicks, and the case and whole-word buttons were never pressed, so the option's whole journey
 * from the control to the matcher was unguarded in either direction. A button that flips its own
 * `aria-pressed` and searches for the same thing again is indistinguishable from a working one until
 * someone counts the calls.
 *
 * The arithmetic the buttons drive is guarded at the hook, in `usePdfSearch.controls.test.tsx`; what this
 * file holds is the wire — the click, the pressed state, and the exact record handed to `search`.
 */
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SearchBox } from './SearchBox';
import { DEFAULT_LABELS } from '../lib/labels';
import type { PdfFindController } from '../headless/usePdfSearch';
import type { PageMatch } from '../lib/search';

const match = (pageIndex: number): PageMatch => ({
  pageIndex,
  beginIdx: 0,
  endIdx: 0,
  beginOffset: 0,
  endOffset: 4,
});

const QUERY = 'quux';
const ALL_OFF = { caseSensitive: false, wholeWord: false, regex: false };

function bar(over: Partial<PdfFindController> = {}) {
  const search = vi.fn();
  const nextMatch = vi.fn();
  const prevMatch = vi.fn();
  const state: PdfFindController = {
    status: 'ready',
    progress: 1,
    query: QUERY,
    options: { ...ALL_OFF },
    results: [match(2), match(7), match(11)],
    total: 3,
    counts: [0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 1],
    pagesWithMatches: 3,
    patternError: null,
    patternKind: null,
    activeIndex: 0,
    activeSeq: 1,
    complete: true,
    pagesIndexed: 12,
    pagesTotal: 12,
    search,
    setActiveIndex: vi.fn(),
    nextMatch,
    prevMatch,
    clear: vi.fn(),
    invalidatePages: vi.fn(),
    ...over,
  };
  const view = render(<SearchBox state={state} />);
  const button = (label: string) =>
    view.container.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`)!;
  return { ...view, search, nextMatch, prevMatch, button, input: () => view.container.querySelector('input')! };
}

const pressed = (element: HTMLButtonElement) => element.getAttribute('aria-pressed');

/** The debounce is 200 ms; the assertion is about the last call, so it is waited for rather than timed. */
const lastSearch = (search: ReturnType<typeof vi.fn>) => {
  expect(search, 'the bar searched at least once').toHaveBeenCalled();
  return search.mock.calls.at(-1)?.[1] as Partial<typeof ALL_OFF>;
};

afterEach(cleanup);

describe('the search bar’s option buttons (FR-15)', () => {
  it('asks for case sensitivity from the button, in the record the matcher reads', async () => {
    const { button, search } = bar();
    const caseButton = () => button(DEFAULT_LABELS.matchCase);
    expect(pressed(caseButton())).toBe('false');

    fireEvent.click(caseButton());
    expect(pressed(caseButton()), 'the pressed state is the option’s state').toBe('true');
    await waitFor(() => expect(lastSearch(search).caseSensitive).toBe(true));
    // The other two ride along as the matcher expects them: an absent key is not the same record as
    // `wholeWord: false`, and the hook resolves its defaults from this object.
    expect(lastSearch(search)).toEqual({ ...ALL_OFF, caseSensitive: true });
  });

  it('carries both flags when both are on, and neither when both are turned back off', async () => {
    const { button, search } = bar();
    fireEvent.click(button(DEFAULT_LABELS.matchCase));
    await waitFor(() => expect(lastSearch(search).caseSensitive).toBe(true));

    fireEvent.click(button(DEFAULT_LABELS.wholeWordsOnly));
    await waitFor(() => expect(lastSearch(search).wholeWord).toBe(true));
    expect(lastSearch(search)).toEqual({ caseSensitive: true, wholeWord: true, regex: false });

    fireEvent.click(button(DEFAULT_LABELS.matchCase));
    await waitFor(() => expect(lastSearch(search).caseSensitive).toBe(false));
    expect(lastSearch(search).wholeWord, 'one button does not unset the other').toBe(true);
  });

  it('searches for the words on screen, not the ones that were there at mount', async () => {
    const { search, input } = bar();
    fireEvent.change(input(), { target: { value: 'revenue' } });
    fireEvent.click(input(), { detail: 0 });
    await waitFor(() => expect(search.mock.calls.at(-1)?.[0]).toBe('revenue'));
  });
});

describe('the search bar’s next and previous (FR-15)', () => {
  it('steps through the controller rather than moving the cursor itself', () => {
    const { button, nextMatch, prevMatch } = bar();
    fireEvent.click(button(DEFAULT_LABELS.nextMatch));
    fireEvent.click(button(DEFAULT_LABELS.previousMatch));
    expect(nextMatch).toHaveBeenCalledTimes(1);
    expect(prevMatch).toHaveBeenCalledTimes(1);
  });

  it('sends Enter forward and Shift+Enter back, and does not search twice on the way', async () => {
    const { input, nextMatch, prevMatch, search } = bar();
    // Let the mount's own debounce land first. While a timer is outstanding Enter is *meant* to run
    // that search immediately — which is the next case; here the question is whether a bar that has
    // already searched searches again for a navigation key.
    await waitFor(() => expect(search).toHaveBeenCalled());
    const callsAtEnter = search.mock.calls.length;

    fireEvent.keyDown(input(), { key: 'Enter' });
    expect(nextMatch).toHaveBeenCalledTimes(1);
    fireEvent.keyDown(input(), { key: 'Enter', shiftKey: true });
    expect(prevMatch).toHaveBeenCalledTimes(1);
    /*
     * Enter flushes the pending search *only* when one is outstanding. A bar whose timer has already
     * fired must not re-run the same query for a reader who pressed Enter to move on — which is what
     * the counter's "3 of 3" would jump on if it did.
     */
    expect(search.mock.calls.length, 'no pending search, no second one').toBe(callsAtEnter);
  });

  it('will not make a reader wait out the debounce when they press Enter', async () => {
    const { input, search } = bar();
    await waitFor(() => expect(search).toHaveBeenCalled());
    const before = search.mock.calls.length;

    fireEvent.change(input(), { target: { value: 'revenue' } });
    // The timer has 200 ms to run; Enter is the reader saying they did not mean to wait.
    fireEvent.keyDown(input(), { key: 'Enter' });
    expect(search.mock.calls.length, 'the pending search ran now').toBe(before + 1);
    expect(search.mock.calls.at(-1)?.[0]).toBe('revenue');
  });

  it('is disabled where there is nothing to step through', () => {
    const { button } = bar({ results: [], total: 0, counts: [], activeIndex: -1, pagesWithMatches: 0 });
    expect(button(DEFAULT_LABELS.nextMatch).disabled).toBe(true);
    expect(button(DEFAULT_LABELS.previousMatch).disabled).toBe(true);
  });
});
