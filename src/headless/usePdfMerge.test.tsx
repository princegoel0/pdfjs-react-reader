/*
 * The state a merge picker needs, and the trap a picker can fall into without noticing.
 *
 * Most of this file is the ordinary business of a plan: add, move, remove, and a write that produces a new
 * file. The case worth the words is the last one — a host that writes `usePdfMerge({ sources: [a, b] })`
 * inline hands the hook a new array every render, and an effect keyed on that array does not read the
 * documents once per change, it reads them once per render, forever. `0.9` measured that loop at 2,666
 * loads in a single test; the signature the hook keys on instead is what stops it, and the assertion is
 * that the count stays at one across re-renders.
 *
 * Real fixtures, because the thing under test is a page count and a written file, and a fake would prove
 * the plumbing while saying nothing about either.
 */
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { usePdfMerge } from './usePdfMerge';
import type { MergeSource } from '../lib/pdf-merge';

/** How many times the page counts were read, which is the number the last case is about. */
const reads = vi.hoisted(() => ({ n: 0 }));

vi.mock('../lib/pdf-merge', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/pdf-merge')>();
  return {
    ...actual,
    describeMergeSources: (
      ...args: Parameters<typeof actual.describeMergeSources>
    ) => {
      reads.n += 1;
      return actual.describeMergeSources(...args);
    },
  };
});

const fixture = (name: string): Uint8Array =>
  new Uint8Array(readFileSync(join(process.cwd(), 'playground', 'fixtures', name)));

function sources(): [MergeSource, MergeSource] {
  return [
    { bytes: fixture('page-order-sample.pdf'), name: 'page-order-sample.pdf' },
    { bytes: fixture('tagged-sample.pdf'), name: 'tagged-sample.pdf' },
  ];
}

afterEach(() => {
  cleanup();
  reads.n = 0;
});

describe('planning a merge', () => {
  it('reads how many pages each source has', async () => {
    const { result } = renderHook(() => usePdfMerge({ sources: sources() }));
    expect(result.current.available).toEqual([null, null]);

    await waitFor(() => expect(result.current.available).toEqual([20, 2]));
  });

  it('keeps the plan as data, in the order the reader will get it', async () => {
    const { result } = renderHook(() => usePdfMerge({ sources: sources() }));
    await waitFor(() => expect(result.current.available[0]).toBe(20));

    act(() => {
      result.current.add(0, 0);
      result.current.add(1, 1);
      result.current.add(0, 3);
    });
    expect(result.current.order).toEqual([
      { source: 0, page: 0 },
      { source: 1, page: 1 },
      { source: 0, page: 3 },
    ]);
    expect(result.current.taken).toEqual([2, 1]);

    act(() => {
      result.current.move(2, 0);
    });
    expect(result.current.order.map((ref) => `${ref.source}:${ref.page}`)).toEqual([
      '0:3',
      '0:0',
      '1:1',
    ]);

    act(() => {
      result.current.remove(1);
    });
    expect(result.current.order.map((ref) => `${ref.source}:${ref.page}`)).toEqual(['0:3', '1:1']);

    act(() => {
      result.current.clear();
    });
    expect(result.current.order).toEqual([]);
  });

  it('writes a third file and reports what went into it', async () => {
    const [first, second] = sources();
    const before = [first.bytes.length, second.bytes.length];
    const { result } = renderHook(() => usePdfMerge({ sources: [first, second] }));
    await waitFor(() => expect(result.current.available[1]).toBe(2));

    act(() => {
      result.current.add(1, 0);
      result.current.add(0, 4);
    });
    const written = await result.current.merge();

    expect(written?.pages).toBe(2);
    expect(written?.taken).toEqual([1, 1]);
    expect(written?.available).toEqual([20, 2]);
    // The sources are the same buffers, the same length, still readable.
    expect([first.bytes.length, second.bytes.length]).toEqual(before);
  });

  it('writes nothing when the plan is empty', async () => {
    const onError = vi.fn();
    const { result } = renderHook(() => usePdfMerge({ sources: sources(), onError }));
    await waitFor(() => expect(result.current.available[0]).toBe(20));

    await expect(result.current.merge()).resolves.toBeNull();
    expect(onError).not.toHaveBeenCalled();
  });

  it('gives a caller that stopped no bytes and no error', async () => {
    const onError = vi.fn();
    const { result } = renderHook(() => usePdfMerge({ sources: sources(), onError }));
    await waitFor(() => expect(result.current.available[0]).toBe(20));

    act(() => {
      result.current.add(0, 1);
    });
    // Stopped at the write, not at the read: the counts arrived, and the file still does not.
    const controller = new AbortController();
    controller.abort();
    await expect(result.current.merge({ signal: controller.signal })).resolves.toBeNull();
    expect(onError).not.toHaveBeenCalled();
  });

  /*
   * The regression this exists to keep: an inline array is a new array every render, and a read that
   * restarts on identity reads the same two documents once per render until something stops it.
   */
  it('reads the documents once when the host hands a fresh array each render', async () => {
    const [first, second] = sources();
    const view = renderHook(() => usePdfMerge({ sources: [first, second] }));
    await waitFor(() => expect(view.result.current.available[0]).toBe(20));
    expect(reads.n).toBe(1);

    for (let render = 0; render < 5; render++) {
      act(() => {
        view.rerender();
      });
    }
    await act(async () => undefined);
    expect(reads.n).toBe(1);
  });
});
