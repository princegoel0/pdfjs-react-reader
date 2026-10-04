/*
 * FR-36's writer clause on the tier that owns the writer: every writer pass accepts a signal, and a pass that
 * was cancelled produces no file and no error.
 *
 * Until now the signal existed only on the primitives — `arrangePages`, `flattenBytes`, `signFields` and
 * `findSignatureFields` all check one — and the built-in edit tier called all four with nothing, so the one
 * place in the package where a write is long enough to want cancelling had no way to ask for it. The panel's
 * lifetime is the owner here: unmounting stops the pass, and a host that hands `createEditFeature({ signal })`
 * one gets the same lever without unmounting anything.
 *
 * `./lib/pdf-write` is stubbed, which narrows what this proves and is worth saying plainly: the abort check
 * inside each writer pass is the real module's behaviour and is tested in `src/lib/pdf-write.test.ts`. What
 * this file asserts is that the tier **hands a signal over at all**, that an already-aborted one produces no
 * bytes and no report, and that unmounting fires the signal it passed.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { act, cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  FeaturePart,
  FeatureRunners,
  useFeatureStore,
} from './components/FeatureHost';
import { DEFAULT_LABELS } from './lib/labels';
import { cancellationFrom } from './lib/abort';
import { createEditFeature } from './edit';
import type { FeatureStore } from './components/FeatureHost';
import type { AnyPdfFeature, PdfViewerShell } from './lib/features';

const writes = vi.hoisted(() => ({
  options: [] as { signal?: AbortSignal }[],
}));

vi.mock('./lib/pdf-write', () => ({
  arrangePages: async (_base: unknown, _plan: unknown, options?: { signal?: AbortSignal }) => {
    writes.options.push(options ?? {});
    if (options?.signal?.aborted) {
      throw cancellationFrom(options.signal, 'LOAD_CANCELLED', 'Rearranging pages was aborted.');
    }
    return { bytes: new Uint8Array([0x25, 0x50, 0x44, 0x46]), moved: [0, 1], changed: [], rotated: [] };
  },
  flattenBytes: async (_bytes: unknown, options?: { signal?: AbortSignal }) => {
    writes.options.push(options ?? {});
    if (options?.signal?.aborted) throw cancellationFrom(options.signal, 'LOAD_CANCELLED');
    return { bytes: new Uint8Array([1]), flattened: 0, annotations: 0 };
  },
  signFields: async (_bytes: unknown, _marks: unknown, options?: { signal?: AbortSignal }) => {
    writes.options.push(options ?? {});
    if (options?.signal?.aborted) throw cancellationFrom(options.signal, 'LOAD_CANCELLED');
    return { bytes: new Uint8Array([1]), signed: ['Sig1'], refused: [] };
  },
  findSignatureFields: async (_bytes: unknown, options?: { signal?: AbortSignal }) => {
    writes.options.push(options ?? {});
    if (options?.signal?.aborted) throw cancellationFrom(options.signal, 'LOAD_CANCELLED');
    return [];
  },
}));

const fixture = (): Uint8Array =>
  new Uint8Array(readFileSync(join(process.cwd(), 'playground', 'fixtures', 'page-order-sample.pdf')));

const replaced = vi.hoisted(() => vi.fn());
const reportError = vi.hoisted(() => vi.fn());

function makeShell(): PdfViewerShell {
  return {
    doc: {
      saveDocument: async () => fixture(),
      getData: async () => fixture(),
      annotationStorage: { size: 0 },
    } as unknown as PdfViewerShell['doc'],
    numPages: 20,
    pageRotations: {},
    replaceDocument: replaced,
    rotatePage: vi.fn(),
    reportError,
    labels: DEFAULT_LABELS,
    documentLabel: 'order',
  } as unknown as PdfViewerShell;
}

function Harness({
  shell,
  features,
}: {
  shell: PdfViewerShell;
  features: AnyPdfFeature[];
  store?: FeatureStore;
}) {
  const store = useFeatureStore(shell);
  return (
    <>
      <FeatureRunners features={features} store={store} />
      {features.map((feature) => (
        <FeaturePart key={feature.id} feature={feature} store={store}>
          {feature.panel ? <feature.panel.render /> : null}
        </FeaturePart>
      ))}
    </>
  );
}

const click = (element: Element | null | undefined) => {
  expect(element, 'expected the control to exist').toBeTruthy();
  act(() => {
    element?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
};

const byLabel = (text: RegExp) =>
  [...document.querySelectorAll<HTMLElement>('button')].find((b) =>
    text.test(b.getAttribute('aria-label') ?? b.textContent ?? ''),
  );

/** Move page 1 later, then apply: the one gesture that reaches `arrangePages`. */
async function applyAMove() {
  const rows = [...document.querySelectorAll('.pjsr-pages-row')];
  click(rows[0]?.querySelector('button[aria-label*="Move page later"]'));
  await act(async () => undefined);
  click(byLabel(/^Apply page changes$/));
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 60));
  });
}

afterEach(async () => {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 30));
  });
  cleanup();
  writes.options.length = 0;
  replaced.mockClear();
  reportError.mockClear();
});

describe('FR-36: the edit tier hands every writer pass a signal', () => {
  it('passes a live signal, and writes the file when nobody cancelled', async () => {
    render(<Harness shell={makeShell()} features={[createEditFeature({})]} />);
    await applyAMove();

    expect(writes.options.length, 'the panel made no writer call').toBeGreaterThan(0);
    const signal = writes.options[0]?.signal;
    expect(signal, 'the writer pass was started with no signal at all').toBeInstanceOf(AbortSignal);
    expect(signal?.aborted).toBe(false);
    expect(replaced).toHaveBeenCalledTimes(1);
    expect(reportError).not.toHaveBeenCalled();
  });

  it('aborts the signal it passed when the panel goes away mid-write', async () => {
    const { unmount } = render(
      <Harness shell={makeShell()} features={[createEditFeature({})]} />,
    );
    await applyAMove();
    const signal = writes.options[0]?.signal;
    expect(signal).toBeInstanceOf(AbortSignal);
    expect(signal?.aborted).toBe(false);

    unmount();
    // The lifetime owns the cancellation: with the panel gone there is nobody to hand the bytes to, and a
    // writer still running would be spending a second on a document no viewer will show.
    expect(signal?.aborted, 'unmounting the panel did not stop the writer').toBe(true);
  });

  it('produces no file and no error report when the host signal had already fired', async () => {
    const controller = new AbortController();
    controller.abort();
    render(
      <Harness shell={makeShell()} features={[createEditFeature({ signal: controller.signal })]} />,
    );
    await applyAMove();

    const signal = writes.options[0]?.signal;
    expect(signal).toBeInstanceOf(AbortSignal);
    expect(signal?.aborted, 'the aborted host signal never reached the writer').toBe(true);
    expect(replaced, 'a cancelled write still handed the viewer a new document').not.toHaveBeenCalled();
    expect(reportError, 'a cancellation is not a failure, so nothing is reported').not.toHaveBeenCalled();
  });
});
