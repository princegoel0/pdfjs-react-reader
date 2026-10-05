/*
 * FR-24's second sentence: *a `SetOCGState` action inside the document must move the same state a panel shows,
 * not a copy of it*.
 *
 * The first half of that chain is guarded elsewhere (`src/lib/link-service.test.ts` proves the engine's action
 * reaches `onSetOCGState` with its state list and `preserveRB`; `usePdfOptionalContent.shared.test.tsx` proves
 * the panel switches the instance it was handed). What sat between them unasserted was the shell's own relay —
 * `ViewerController`'s handler, whose comment says fetching a config there *is* the bug, because pdf.js builds
 * a new object per call and the action would land on something no page renders with. A relay that fetched,
 * that copied the instance, or that muted the action entirely would have passed every test in the repository.
 *
 * So this drives the relay the way the engine does — through the options object the shell gives
 * `createPdfLinkService` — and reads the consequences back off the shell: the instance the controller
 * publishes is the one that moved, a redraw was asked for, and no second config was ever fetched.
 *
 * The link service is mocked at our own factory rather than at pdf.js: the assertion is about what the shell
 * does with the callback it hands in, and a fake engine would put the wiring under test in somebody else's
 * code instead.
 */
import { act, cleanup, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PDFDocumentProxy } from 'pdfjs-dist';

import { useViewerController } from './ViewerController';

class ObserverStub {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}
globalThis.ResizeObserver = ObserverStub as unknown as typeof ResizeObserver;

/** The options the shell handed to the link-service factory, which is where the relay lives. */
const seen = vi.hoisted(() => ({ options: null as Record<string, unknown> | null }));

vi.mock('../lib/link-service', () => ({
  createPdfLinkService: (options: Record<string, unknown>) => {
    seen.options = options;
    // A service the pages would use; this file never renders a page, and the two callbacks are the contract.
    return { setDocument: () => undefined, setActivePage: () => undefined };
  },
}));

function fakeConfig(ids: string[]) {
  const groups = ids.map((id) => ({ id, name: `Layer ${id}`, visible: true }));
  const calls: Array<{ method: string; args: unknown[] }> = [];
  const handle = {
    getOrder: () => ids,
    getGroup: (id: string) => groups.find((group) => group.id === id) ?? null,
    setVisibility(id: string, visible: boolean) {
      calls.push({ method: 'setVisibility', args: [id, visible] });
      const group = groups.find((entry) => entry.id === id);
      if (group) group.visible = visible;
    },
    setOCGState(action: { state: readonly unknown[]; preserveRB?: boolean }) {
      calls.push({ method: 'setOCGState', args: [action] });
      for (let i = 0; i + 1 < action.state.length; i += 2) {
        const group = groups.find((entry) => entry.id === action.state[i + 1]);
        if (!group) continue;
        if (action.state[i] === 'OFF') group.visible = false;
        if (action.state[i] === 'ON') group.visible = true;
      }
    },
  };
  return { handle, calls, groups };
}

/**
 * The document the mocked load hook answers with, set per test.
 *
 * A module-level factory cannot read a test's local, and a `doMock` after import rewires nothing — so the
 * shimmed hook reads this, and a test hands it a document before mounting the probe.
 */
const state = vi.hoisted(() => ({ doc: null as unknown, onError: null as ((error: unknown) => void) | null }));

vi.mock('../headless/usePdfDocument', () => ({
  usePdfDocument: () => ({
    status: 'ready',
    doc: state.doc as PDFDocumentProxy | null,
    numPages: 2,
    isReady: true,
    error: null,
    capabilities: null,
    passwordRequest: null,
    reload: () => undefined,
  }),
}));

/**
 * A document the whole shell can mount on.
 *
 * The controller reads labels, metadata and the outline as soon as a document arrives, so a fake missing one
 * of those answers fails in a hook this file is not testing. `getPage` hands back a plain unrotated page box.
 */
function baseDoc(overrides: Record<string, unknown> = {}) {
  return {
    numPages: 2,
    getPage: async () => ({
      rotate: 0,
      getViewport: ({ scale = 1 }: { scale?: number } = {}) => ({ width: 612 * scale, height: 792 * scale }),
      cleanup: () => {},
    }),
    getOptionalContentConfig: () => Promise.reject(new Error('no /OCProperties')),
    getOutline: async () => null,
    getPageLabels: async () => null,
    getMetadata: async () => ({ info: {}, metadata: null }),
    cleanup: () => {},
    ...overrides,
  } as unknown as PDFDocumentProxy;
}

const probe: { controller: ReturnType<typeof useViewerController> | null } = { controller: null };

function Probe() {
  const controller = useViewerController({
    src: '/fixtures/attachments-ocg-sample.pdf',
    defaultScale: 1,
    // The shell's only door for "something in here went wrong", which is what a relay that runs with no config
    // would trip. A dropped action has to be silent, not merely non-fatal.
    ...(state.onError ? { onError: state.onError as (error: Error) => void } : null),
  });
  probe.controller = controller;
  return <div ref={controller.containerRef as { current: HTMLDivElement | null }} />;
}

async function mount(doc: PDFDocumentProxy | null, onError?: (error: unknown) => void) {
  state.doc = doc;
  state.onError = onError ?? null;
  await act(async () => {
    render(<Probe />);
  });
  await act(async () => undefined);
  if (!probe.controller) throw new Error('the probe never published its controller');
  // Read through the probe rather than holding the object: every repaint replaces the controller value, so a
  // captured one is a snapshot of the render it came from and cannot show a later bump.
  return { live: () => probe.controller as ReturnType<typeof useViewerController> };
}

/** The relay, called the way pdf.js's annotation layer calls it. */
async function fire(action: { state: readonly unknown[]; preserveRB?: boolean }) {
  const options = seen.options;
  if (!options) throw new Error('the shell never built a link service');
  const onSetOCGState = options.onSetOCGState as (a: typeof action) => void;
  await act(async () => {
    onSetOCGState(action);
  });
  await act(async () => undefined);
}

beforeEach(() => {
  seen.options = null;
  probe.controller = null;
});

afterEach(() => {
  cleanup();
  vi.resetModules();
  vi.resetAllMocks();
});

describe('FR-24: a SetOCGState action moves the instance the shell renders with', () => {
  it('applies the action to the shared config, asks for a redraw, and fetches no second one', async () => {
    const { handle, calls, groups } = fakeConfig(['4', '5']);
    const fetched = vi.fn(() => Promise.resolve(handle));
    const { live } = await mount(baseDoc({ getOptionalContentConfig: fetched }));

    expect(live().optionalContentConfig, 'the shell resolved the document’s one config').toBe(handle);
    const before = live().contentVersion;

    await fire({ state: ['OFF', '4'], preserveRB: true });

    expect(calls).toEqual([{ method: 'setOCGState', args: [{ state: ['OFF', '4'], preserveRB: true }] }]);
    expect(groups.find((group) => group.id === '4')?.visible, 'the state a panel would now show').toBe(false);
    expect(live().contentVersion, 'and every page was asked to draw again').toBe(before + 1);
    expect(fetched, 'fetching a config in the relay is the bug the shell’s comment names').toHaveBeenCalledTimes(1);
    expect(live().optionalContentConfig, 'the instance the pages render with is the one that moved').toBe(handle);
  });

  it('copies the state list, so an engine that reuses its array cannot change what was applied', async () => {
    const { handle, calls } = fakeConfig(['4']);
    await mount(baseDoc({ getOptionalContentConfig: () => Promise.resolve(handle) }));

    const state: unknown[] = ['OFF', '4'];
    await fire({ state, preserveRB: false });
    state.push('ON', '4');

    expect(calls[0]?.args[0], 'what ran was the action as it arrived').toEqual({
      state: ['OFF', '4'],
      preserveRB: false,
    });
  });

  it('drops the action when the document has no layers, without repainting and without an error', async () => {
    // No optional content is the ordinary case: pdf.js rejects rather than answering with an empty tree.
    const onError = vi.fn();
    const { live } = await mount(baseDoc(), onError);
    const before = live().contentVersion;

    await fire({ state: ['OFF', '4'], preserveRB: true });

    expect(live().optionalContentConfig).toBeNull();
    expect(live().contentVersion, 'a redraw of a document with nothing to switch').toBe(before);
    expect(
      onError,
      'running the relay against a config that is not there is a failure the host would have to be told about',
    ).not.toHaveBeenCalled();
  });
});
