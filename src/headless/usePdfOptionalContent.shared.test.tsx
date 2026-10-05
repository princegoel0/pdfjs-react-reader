/*
 * FR-24's shared-instance clause, read from the hook that owns the layer panel.
 *
 * The requirement is one sentence long and every word in it carries: "every page redrawing from the **same**
 * configuration **instance** the render uses". The reason is in `src/lib/optional-content.ts`'s header —
 * `getOptionalContentConfig()` builds a **new** object on every call from cached worker data, so a panel that
 * fetched its own list would flip switches on an object no page ever paints with, and the document would look
 * deaf. That is why the shell resolves the config once and injects it, and why this hook's `config` option
 * exists at all. Until now nothing asked: `setVisibility` and `usePdfOptionalContent` appeared in no test, and
 * both page tests passed `optionalContentConfig: null`.
 *
 * Five claims:
 *
 *  - **an injected config is never re-fetched.** Not "fetched and discarded": the document is not asked,
 *    because asking is the bug;
 *  - **the instance the hook hands back is the instance it was given**, by identity — that is what a caller
 *    passes to `page.render`, and a copy here silently un-couples every page from every switch;
 *  - the panel's rows are **re-read from that mutable object** when the revision moves, because a mutation
 *    changes no prop and no memo input the hook can see;
 *  - a `SetOCGState` action is **copied** on its way in and its `preserveRB` defaults to the engine's own
 *    meaning, so a caller holding the array cannot rewrite what was already applied;
 *  - a config that throws is reported through `onError` and **not** followed by `onChanged`, because a redraw
 *    of a document whose layer did not move is a page that repaints for a switch that failed.
 */
import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PDFDocumentProxy } from 'pdfjs-dist';

import { usePdfOptionalContent } from './usePdfOptionalContent';
import type { OptionalContentConfigHandle } from '../lib/optional-content';

/**
 * A layer config that behaves the way pdf.js's does: mutable, and readable only through itself.
 *
 * `setVisibility` and `setOCGState` write to the same `groups` array the reader walks, so a test can tell
 * "the panel shows it off now" from "the panel was told to show it off" — the first is the clause, the second
 * is a call that may have landed on a copy.
 */
function fakeConfig(ids: string[], visible: Record<string, boolean> = {}) {
  const groups = ids.map((id) => ({ id, name: `Layer ${id}`, visible: visible[id] ?? true }));
  const calls: Array<{ method: string; args: unknown[] }> = [];
  const handle = {
    getOrder: () => ids,
    getGroup: (id: string) => groups.find((group) => group.id === id) ?? null,
    setVisibility(id: string, next: boolean) {
      calls.push({ method: 'setVisibility', args: [id, next] });
      const group = groups.find((entry) => entry.id === id);
      if (group) group.visible = next;
    },
    setOCGState(action: { state: readonly unknown[]; preserveRB?: boolean }) {
      calls.push({ method: 'setOCGState', args: [action] });
      const list = action.state;
      for (let i = 0; i + 1 < list.length; i += 2) {
        const operator = list[i];
        const id = list[i + 1];
        const group = groups.find((entry) => entry.id === id);
        if (!group || typeof id !== 'string') continue;
        if (operator === 'ON') group.visible = true;
        if (operator === 'OFF') group.visible = false;
        if (operator === 'Toggle') group.visible = !group.visible;
      }
    },
  } as unknown as OptionalContentConfigHandle & { calls: typeof calls };
  return { handle, calls, groups };
}

function docThatAnswers(getOptionalContentConfig: () => Promise<unknown>): PDFDocumentProxy {
  return {
    numPages: 1,
    getOptionalContentConfig,
  } as unknown as PDFDocumentProxy;
}

const settled = async () => {
  await act(async () => undefined);
};

afterEach(() => {
  vi.restoreAllMocks();
});

describe('FR-24: the layer panel mutates the instance the pages render with', () => {
  it('never asks the document for a config when it was handed one', async () => {
    const { handle } = fakeConfig(['1', '2']);
    const getOptionalContentConfig = vi.fn(() => Promise.resolve(fakeConfig(['9']).handle));
    const doc = docThatAnswers(getOptionalContentConfig);
    const { result } = renderHook(() => usePdfOptionalContent({ doc, config: handle }));
    await settled();

    expect(getOptionalContentConfig, 'fetching a second config is the bug the injection exists to avoid').not
      .toHaveBeenCalledWith();
    expect(result.current.config, 'the instance is handed back unchanged, by identity').toBe(handle);
    expect(result.current.loading, 'there is nothing to wait for').toBe(false);
  });

  it('fetches one for itself only when the caller has no instance to give', async () => {
    const { handle } = fakeConfig(['1']);
    const getOptionalContentConfig = vi.fn(() => Promise.resolve(handle));
    // Built outside the render callback on purpose: a fresh doc object each render is a fresh effect dep,
    // and the claim being made here is precisely that the read happens once.
    const doc = docThatAnswers(getOptionalContentConfig);
    const { result } = renderHook(() => usePdfOptionalContent({ doc }));

    expect(result.current.config, 'a read costs a round trip, so nothing is known yet').toBeNull();
    await waitFor(() => expect(result.current.config).toBe(handle));
    expect(getOptionalContentConfig).toHaveBeenCalledTimes(1);
  });

  it('switches a layer on the shared object and reads the new state back off it', async () => {
    const { handle, calls, groups } = fakeConfig(['1', '2'], { '1': true, '2': false });
    const onChanged = vi.fn();
    let revision = 0;
    const { result, rerender } = renderHook(
      ({ rev }: { rev: number }) =>
        usePdfOptionalContent({
          doc: null,
          config: handle,
          revision: rev,
          onChanged,
        }),
      { initialProps: { rev: revision } },
    );
    await settled();

    act(() => result.current.setVisibility('1', false));
    expect(calls).toEqual([{ method: 'setVisibility', args: ['1', false] }]);
    expect(groups.find((group) => group.id === '1')?.visible, 'the object moved').toBe(false);
    expect(onChanged, 'and the caller is told to redraw').toHaveBeenCalledTimes(1);
    expect(result.current.rows?.filter((row) => row.kind === 'group')[0]?.visible, 'the cached rows are stale').toBe(
      true,
    );

    revision += 1;
    rerender({ rev: revision });
    await settled();
    expect(
      result.current.rows?.map((row) => (row.kind === 'group' ? [row.id, row.visible] : [row.kind])),
      'a revision bump is the only signal a mutable object can give',
    ).toEqual([
      ['1', false],
      ['2', false],
    ]);
  });

  it('copies the action’s state list, so a caller that reuses its array cannot rewrite what was applied', async () => {
    const { handle, calls, groups } = fakeConfig(['1', '2'], { '1': true, '2': true });
    const { result } = renderHook(() => usePdfOptionalContent({ doc: null, config: handle }));
    await settled();

    const state: unknown[] = ['OFF', '1'];
    act(() => result.current.applyState({ state, preserveRB: false }));
    state.push('ON', '2');

    expect(calls[0]?.args[0]).toEqual({ state: ['OFF', '1'], preserveRB: false });
    expect(groups.map((group) => group.visible), 'the mutation that ran was the one handed in').toEqual([
      false,
      true,
    ]);
  });

  it('defaults preserveRB to the engine’s own meaning rather than to a bare undefined', async () => {
    const { handle, calls } = fakeConfig(['1']);
    const { result } = renderHook(() => usePdfOptionalContent({ doc: null, config: handle }));
    await settled();

    act(() => result.current.applyState({ state: ['Toggle', '1'] }));
    expect(calls[0]?.args[0]).toMatchObject({ preserveRB: true });
  });

  it('reports a config that throws, and does not ask for a redraw of a layer that did not move', async () => {
    const handle = {
      getOrder: () => ['1'],
      getGroup: () => ({ id: '1', name: 'Layer 1', visible: true }),
      setVisibility: () => {
        throw new Error('this group cannot be switched');
      },
      setOCGState: () => undefined,
    } as unknown as OptionalContentConfigHandle;
    const onChanged = vi.fn();
    const onError = vi.fn();
    const { result } = renderHook(() =>
      usePdfOptionalContent({ doc: null, config: handle, onChanged, onError }),
    );
    await settled();

    act(() => result.current.setVisibility('1', false));
    expect(onChanged, 'a failed switch must not repaint the document').not.toHaveBeenCalled();
    expect(onError).toHaveBeenCalledTimes(1);
    expect(result.current.error?.code).toBeTruthy();
  });
});
