/*
 * FR-30's second undo level, and the batching the same sentence promises.
 *
 * "Undo at two levels: within the pending batch, which is a permutation of integers and costs no
 * bytes; and of the last apply, which restores the snapshot that write started from." The first
 * level has been guarded since `0.7` (edit.test.tsx's "steps back through the batch without
 * writing anything"). The second is the one that touches a file, and until this file nothing had
 * ever pressed the control: `undoApply` and its label appeared in no test.
 *
 * So the assertions read bytes rather than call counts, and the shell's document is modelled as a
 * file that changes: `getData()` hands back whatever `replaceDocument` was last given. Without
 * that, every snapshot in the suite is the same fixture and the test cannot tell "the state before
 * this apply" apart from "the state before any apply" — which is precisely the distinction the
 * clause makes. What is asserted is that the bytes coming back are the ones the write *started*
 * from, page tree included, and that the level spends itself: one undo of the last apply, not an
 * undo history.
 *
 * The second half is the load behaviour. "Writes are batched, so a document that is megabytes is
 * parsed once per apply and not once per keystroke" is a claim about a count, and a count needs a
 * tally: three edits cost no read of the document and no parse, the apply that follows costs one
 * of each. The parse is tallied on the writer's own entry point (`PDFDocument.load`), because that
 * is the load the clause is about — the bytes the engine hands over are cheap, and it is the second
 * parse of a thousand-page file that a reader would feel.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { act, cleanup, render, waitFor } from '@testing-library/react';
import { PDFDocument } from '@cantoo/pdf-lib';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MockInstance } from 'vitest';
import { FeaturePart, FeatureRunners, useFeatureStore } from './components/FeatureHost';
import { DEFAULT_LABELS } from './lib/labels';
import { editFeature } from './edit';
import type { AnyPdfFeature, PdfViewerShell } from './lib/features';

const fixture = (name: string): Uint8Array =>
  new Uint8Array(readFileSync(join(process.cwd(), 'playground', 'fixtures', name)));
const order = (): Uint8Array => fixture('page-order-sample.pdf');
const latin = (bytes: Uint8Array): string => Buffer.from(bytes).toString('latin1');

/** The page tree's own order, read out of the bytes rather than through the writer's API. */
const kidsOf = (bytes: Uint8Array): number[] => {
  const match = /\/Kids\s*\[([^\]]*)\]/.exec(latin(bytes));
  return [...(match?.[1] ?? '').matchAll(/(\d+) 0 R/g)].map((m) => Number(m[1]));
};

const replaced = vi.hoisted(() => vi.fn());
const rotatePage = vi.hoisted(() => vi.fn());
const reportError = vi.hoisted(() => vi.fn());
const loaded = vi.hoisted(() => vi.fn());

/** What the document on screen holds right now: a swap replaces it, a read reports it. */
let current = order();

function makeShell(rotations: Record<number, number> = {}): PdfViewerShell {
  return {
    // Nothing in `annotationStorage`, which is the state in which pdf.js tells a caller to read
    // the loaded bytes rather than commit an empty change.
    doc: {
      saveDocument: async () => new Uint8Array(current),
      getData: loaded,
      annotationStorage: { size: 0 },
    } as unknown as PdfViewerShell['doc'],
    numPages: 20,
    pageRotations: rotations,
    replaceDocument: replaced,
    rotatePage,
    reportError,
    labels: DEFAULT_LABELS,
    documentLabel: 'order',
  } as unknown as PdfViewerShell;
}

function Harness({ shell }: { shell: PdfViewerShell }) {
  const features: AnyPdfFeature[] = [editFeature];
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

const rowButton = (slot: number, label: string) =>
  document
    .querySelectorAll('.pjsr-pages-row')
    .item(slot)
    ?.querySelector(`button[aria-label*="${label}"]`) ?? null;

const control = (text: RegExp) =>
  [...document.querySelectorAll<HTMLElement>('button')].find((b) =>
    text.test(b.getAttribute('aria-label') ?? b.textContent ?? ''),
  ) ?? null;

const undoApplyControl = () => control(/^Undo the last apply$/);
const statusText = () => document.querySelector('.pjsr-pages-status')?.textContent?.trim();

const settle = async () => {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 20));
  });
};

/** An apply, whose promise the click handler cannot be awaited through, waited for. */
const applyOnce = async () => {
  const before = replaced.mock.calls.length;
  click(control(/^Apply page changes$/));
  await waitFor(() => expect(replaced).toHaveBeenCalledTimes(before + 1), {
    timeout: 5000,
    interval: 25,
  });
  await settle();
};

/*
 * One apply is a real `arrangePages` pass over a twenty-page fixture, and the parses the tier
 * starts are the thing being counted here, so each test gets a fresh spy over the writer's own
 * entry point rather than a tally carried in from the last one.
 */
let load: MockInstance<typeof PDFDocument.load>;

beforeEach(() => {
  current = order();
  replaced.mockImplementation((bytes: Uint8Array) => {
    current = bytes;
  });
  loaded.mockImplementation(async () => new Uint8Array(current));
  load = vi.spyOn(PDFDocument, 'load');
});

afterEach(async () => {
  await settle();
  cleanup();
  replaced.mockReset();
  rotatePage.mockClear();
  reportError.mockClear();
  loaded.mockReset();
  load.mockRestore();
});

/** How many times the peer was handed a document to parse. */
const parseCount = (): number => load.mock.calls.length;

describe('undo of an apply', () => {
  it('hands the shell back the bytes the write started from', async () => {
    const before = kidsOf(order());
    render(<Harness shell={makeShell()} />);

    click(rowButton(0, 'Move page later'));
    await applyOnce();
    const applied = replaced.mock.calls[0]?.[0] as Uint8Array;
    // The move is in the file the reader is now looking at.
    expect(kidsOf(applied)).toEqual([before[1], before[0], ...before.slice(2)]);
    expect(undoApplyControl()?.hasAttribute('disabled'), 'one apply, one level to undo').toBe(false);

    click(undoApplyControl());
    await waitFor(() => expect(replaced).toHaveBeenCalledTimes(2), { timeout: 5000, interval: 25 });
    const restored = replaced.mock.calls[1]?.[0] as Uint8Array;

    // Not "a file whose pages happen to be in the old order" — the snapshot itself, byte for byte,
    // which is what the clause says: the write started from these bytes and these are what come
    // back. A revert that re-ran the writer over the applied file would produce a different array
    // here even when the page tree matched, because the object numbers would have moved.
    expect(Buffer.compare(restored, order())).toBe(0);
    expect(kidsOf(restored)).toEqual(before);
    /*
     * Waited for, not read. The live region writes its words one timer after the notice changes — that
     * delay is the whole reason a region mounting already holding its text still announces nothing — so a
     * synchronous assertion here passes on an idle machine and fails inside the full suite. It did exactly
     * that on 2026-10-05, which is the evidence for the rule rather than a comment asking for one.
     */
    await waitFor(() => expect(statusText()).toBe(DEFAULT_LABELS.pagesApplyReverted), {
      timeout: 2000,
      interval: 20,
    });

    // One level, spent: a second press has no snapshot behind it, and the control says so rather
    // than sitting there enabled over nothing.
    expect(undoApplyControl()?.hasAttribute('disabled')).toBe(true);
    click(undoApplyControl());
    await settle();
    expect(replaced, 'nothing left to restore, so nothing was replaced').toHaveBeenCalledTimes(2);
  });

  /*
   * The distinction the clause actually turns on: `appliedRef` holds one snapshot, and it has to be
   * the one from before *this* apply. Two applies in a row leave the document in a third state, so
   * an undo that restored the first snapshot would put back a file the reader has not been looking
   * at for a whole action — and nothing in the suite could tell them apart until this test.
   */
  it('restores the state before the last apply, not before the first one', async () => {
    const original = kidsOf(order());
    render(<Harness shell={makeShell()} />);

    click(rowButton(0, 'Move page later'));
    await applyOnce();
    const afterFirst = kidsOf(replaced.mock.calls[0]?.[0] as Uint8Array);

    // A second batch on the document the first one produced: page 2 goes one slot later in it.
    click(rowButton(1, 'Move page later'));
    await applyOnce();
    const afterSecond = kidsOf(replaced.mock.calls[1]?.[0] as Uint8Array);
    expect(afterSecond).not.toEqual(afterFirst);

    click(undoApplyControl());
    await waitFor(() => expect(replaced).toHaveBeenCalledTimes(3), { timeout: 5000, interval: 25 });
    const restored = kidsOf(replaced.mock.calls[2]?.[0] as Uint8Array);
    expect(restored).toEqual(afterFirst);
    expect(restored, 'and not two steps back').not.toEqual(original);
  });

  /*
   * A page rotation the tier wrote into the file is a change to the document, so the snapshot has
   * to carry it back. The view rotations are not part of those bytes, and swapping a document
   * clears them — which is why `undoApply` re-applies them as view state, one relative turn each,
   * and why a reader who had turned page 4 before the apply should still see it turned after.
   */
  it('gives back the turns that were view state when the apply ran', async () => {
    render(<Harness shell={makeShell({ 3: 90 })} />);
    click(rowButton(0, 'Move page later'));
    await applyOnce();
    expect(rotatePage, 'the apply itself changes no view state').not.toHaveBeenCalled();

    click(undoApplyControl());
    await waitFor(() => expect(replaced).toHaveBeenCalledTimes(2), { timeout: 5000, interval: 25 });
    expect(rotatePage).toHaveBeenCalledWith(4, 90);
  });

  it('writes the rotation it was given into the file it applies', async () => {
    render(<Harness shell={makeShell({ 3: 90 })} />);
    click(rowButton(0, 'Move page later'));
    await applyOnce();
    const out = latin(replaced.mock.calls[0]?.[0] as Uint8Array);
    // Page 4 of this fixture is object 207's neighbour: the angle has to be on the page, not on
    // the slot, and the moved page keeps its own.
    expect(out).toMatch(/\/Rotate 90/);
  });
});

describe('batched writes', () => {
  it('parses once for an apply of three edits, and not for the edits', async () => {
    render(<Harness shell={makeShell()} />);

    click(rowButton(0, 'Move page later'));
    click(rowButton(1, 'Rotate clockwise'));
    click(rowButton(2, 'Remove page'));
    await settle();

    expect(loaded, 'the batch is a list of integers; no bytes were asked for').not.toHaveBeenCalled();
    expect(parseCount(), 'and nothing was parsed').toBe(0);
    expect(replaced, 'and nothing was written').not.toHaveBeenCalled();

    await applyOnce();
    expect(loaded.mock.calls.length, 'one apply reads the document once').toBe(1);
    expect(parseCount(), 'one apply parses it once, for three edits').toBe(1);
  });

  it('counts applies, not edits: a second batch costs one more parse', async () => {
    render(<Harness shell={makeShell()} />);

    click(rowButton(0, 'Move page later'));
    await applyOnce();
    expect(parseCount()).toBe(1);
    load.mockClear();
    loaded.mockClear();

    click(rowButton(1, 'Move page later'));
    click(rowButton(2, 'Move page later'));
    await applyOnce();
    expect(loaded.mock.calls.length, 'two edits, one read').toBe(1);
    expect(parseCount(), 'and one parse for this apply, on top of the last one’s').toBe(1);
  });
});
