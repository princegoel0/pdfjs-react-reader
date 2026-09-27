/*
 * Extract and split, tested where the difference between them is the whole point.
 *
 * Both produce bytes with the same writer pass as Apply, so a test that only checked "a file
 * came out" would not notice them clobbering the document on screen — which is exactly what a
 * reader asking for "these five pages" does not want. So each of these asserts twice: what went
 * out, and that `replaceDocument` stayed untouched.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, waitFor } from '@testing-library/react';
import { FeaturePart, FeatureRunners, useFeatureStore } from './components/FeatureHost';
import { DEFAULT_LABELS } from './lib/labels';
import { editFeature } from './edit';
import type { FeatureStore } from './components/FeatureHost';
import type { AnyPdfFeature, PdfViewerShell } from './lib/features';

const saved = vi.hoisted(() => vi.fn());

vi.mock('./lib/download', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./lib/download')>()),
  downloadBytes: (bytes: Uint8Array, name: string) => saved(bytes, name),
}));

const fixture = (name: string): Uint8Array =>
  // From the working directory, because vitest's dom project reports `import.meta.url`
  // without a directory to resolve against.
  new Uint8Array(readFileSync(join(process.cwd(), 'playground', 'fixtures', name)));

const kidsOf = (bytes: Uint8Array): number[] => {
  const text = Buffer.from(bytes).toString('latin1');
  const match = /\/Kids\s*\[([^\]]*)\]/.exec(text);
  return [...(match?.[1] ?? '').matchAll(/(\d+) 0 R/g)].map((m) => Number(m[1]));
};

const order = () => fixture('page-order-sample.pdf');
const replaced = vi.hoisted(() => vi.fn());

function makeShell(): PdfViewerShell {
  return {
    doc: {
      saveDocument: async () => order(),
      getData: async () => order(),
      annotationStorage: { size: 0 },
    } as unknown as PdfViewerShell['doc'],
    numPages: 20,
    pageRotations: {},
    replaceDocument: replaced,
    rotatePage: vi.fn(),
    reportError: vi.fn(),
    labels: DEFAULT_LABELS,
    documentLabel: 'statement',
  } as unknown as PdfViewerShell;
}

function Harness({ shell }: { shell: PdfViewerShell }) {
  const store = useFeatureStore(shell);
  const features: AnyPdfFeature[] = [editFeature];
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

const byLabel = (match: RegExp) =>
  [...document.querySelectorAll<HTMLElement>('button')].find((b) =>
    match.test(b.getAttribute('aria-label') ?? b.textContent ?? ''),
  );

const click = (element: Element | null | undefined) => {
  expect(element, 'expected the control to exist').toBeTruthy();
  act(() => {
    element?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
};

/**
 * The write is `void`ed by the handler, so a settle has to happen before the assert. The live
 * region is not waited for here: it writes its text a frame after the notice changes, so those
 * assertions use `waitFor`.
 */
const settle = async () => {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 30));
  });
};

/** A control from one row, so an assertion cannot land on a neighbour's button. */
const rowButton = (row: number, match: RegExp) => {
  const element = document.querySelectorAll<HTMLElement>('.pjsr-pages-row')[row];
  return element
    ? [...element.querySelectorAll<HTMLButtonElement>('button')].find((b) =>
        match.test(b.getAttribute('aria-label') ?? ''),
      )
    : undefined;
};

afterEach(() => {
  cleanup();
  replaced.mockClear();
  saved.mockClear();
});

describe('extract and split', () => {
  it('saves the planned pages without touching the document on screen', async () => {
    render(<Harness shell={makeShell()} />);
    click(rowButton(0, /Move page later/));
    click(byLabel(/^Save these pages as a new file$/));
    await settle();

    expect(saved).toHaveBeenCalledTimes(1);
    expect(replaced, 'extract must not replace what the reader is looking at').not.toHaveBeenCalled();
    const [bytes, name] = saved.mock.calls[0]!;
    expect(name).toBe('statement.pdf');
    // The moved page leads the extracted file, and nothing was dropped from it.
    expect(kidsOf(bytes)).toHaveLength(20);
    expect(kidsOf(bytes)[0]).toBe(214);
    await waitFor(() =>
      expect(document.querySelector('.pjsr-pages-status')?.textContent).toMatch(/Saved 20 pages/),
    );
  });

  it('keeps the plan after an extract, because nothing was written to the document', async () => {
    render(<Harness shell={makeShell()} />);
    click(rowButton(0, /Move page later/));
    click(byLabel(/^Save these pages as a new file$/));
    await settle();
    expect(byLabel(/^Apply page changes$/)?.hasAttribute('disabled')).toBe(false);
    expect(document.querySelector('.pjsr-pages-summary')?.textContent).toMatch(/not applied/);
  });

  it('splits the list into two files from one save, leaving the document alone', async () => {
    render(<Harness shell={makeShell()} />);
    const before = kidsOf(order());

    click(rowButton(4, /Split the list here/));
    await settle();

    expect(saved).toHaveBeenCalledTimes(2);
    expect(replaced).not.toHaveBeenCalled();
    const [first, firstPart] = saved.mock.calls[0]!;
    const [second, secondPart] = saved.mock.calls[1]!;
    expect(firstPart).toBe('statement-part-1.pdf');
    expect(secondPart).toBe('statement-part-2.pdf');
    // The plan is untouched, so part one is the file's first four pages and part two the rest.
    expect(kidsOf(first)).toEqual(before.slice(0, 4));
    expect(kidsOf(second)).toEqual(before.slice(4));
    await waitFor(() =>
      expect(document.querySelector('.pjsr-pages-status')?.textContent).toMatch(
        /Saved 2 files: 4 pages, then 16/,
      ),
    );
  });

  it('offers a split only where both sides would hold pages', () => {
    render(<Harness shell={makeShell()} />);
    const splitRows = [...document.querySelectorAll('.pjsr-pages-row')].filter((row) =>
      [...row.querySelectorAll('button')].some((b) =>
        /Split the list here/.test(b.getAttribute('aria-label') ?? ''),
      ),
    );
    // Twenty rows: the first has nothing before it, the last has nothing after it.
    expect(splitRows).toHaveLength(19);
    expect(rowButton(0, /Split the list here/)).toBeUndefined();
  });

  it('reports a failed write once, not once per part', async () => {
    const shell = makeShell();
    const doc = shell.doc as unknown as {
      saveDocument: () => Promise<Uint8Array>;
      annotationStorage: { size: number };
    };
    doc.annotationStorage = { size: 2 };
    doc.saveDocument = async () => {
      throw new Error('unreadable');
    };
    const report = vi.fn();
    (shell as unknown as { reportError: typeof report }).reportError = report;
    render(<Harness shell={shell} />);
    click(rowButton(4, /Split the list here/));
    await settle();

    expect(saved).not.toHaveBeenCalled();
    expect(report).toHaveBeenCalledTimes(1);
  });
});
