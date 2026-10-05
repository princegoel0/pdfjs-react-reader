/*
 * FR-32, visual signing: the signature panel, and the two things only a component test can prove — that a field
 * already carrying a signature value is refused rather than covered over, and that the mark lands in every
 * widget box that field declares.
 *
 * The first is the seam: a mark drawn in the pad's CSS pixels has to arrive in the file as a path
 * inside the rectangle of the box that was clicked. `pdf-write.test.ts` covers what happens to
 * bytes, `signature.test.ts` covers the arithmetic; neither can see a missing axis flip or a mark
 * written into the neighbour's box, which is what a reader would notice.
 *
 * The second is who pays for what. Opening the tab asks the engine one cheap question, and the
 * parse that lists the boxes — 150–200 ms of main thread on a thousand-page document — waits for
 * a finished stroke and runs once. Both halves are asserted through `getData`, because handing the
 * file to the writer is the expensive act, and a test can watch whether it happened.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { FeaturePart, FeatureRunners, useFeatureStore } from './components/FeatureHost';
import { DEFAULT_LABELS } from './lib/labels';
import { editFeature } from './edit';
import type { AnyPdfFeature, PdfViewerShell } from './lib/features';

const fixture = (name: string): Uint8Array =>
  new Uint8Array(readFileSync(join(process.cwd(), 'playground', 'fixtures', name)));
const latin = (bytes: Uint8Array): string => Buffer.from(bytes).toString('latin1');
const sample = () => fixture('signature-sample.pdf');

/** The object that declares a field name, so an assertion cannot land on a neighbour. */
const objectOf = (text: string, name: string): string => {
  const at = text.indexOf(`(${name})`);
  if (at < 0) return '';
  return text.slice(text.lastIndexOf(' obj', at), text.indexOf('endobj', at));
};

const replaced = vi.hoisted(() => vi.fn());
const reportError = vi.hoisted(() => vi.fn());
/** The bytes the panel is shown, and how many times it asked — the load behaviour, counted. */
const loaded = vi.hoisted(() => vi.fn(async (): Promise<Uint8Array> => sample()));
const declaresForm = vi.hoisted(() => ({ value: true }));

function sigShell(): PdfViewerShell {
  return {
    doc: {
      getData: loaded,
      saveDocument: async () => sample(),
      annotationStorage: { size: 0 },
      // What the real fixture's /AcroForm makes pdf.js report, and the only thing read on open.
      getMetadata: async () => ({ info: { IsAcroFormPresent: declaresForm.value } }),
    } as unknown as PdfViewerShell['doc'],
    numPages: 2,
    pageRotations: {},
    replaceDocument: replaced,
    rotatePage: vi.fn(),
    reportError,
    labels: DEFAULT_LABELS,
    documentLabel: 'signature-sample',
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

/*
 * A scan parses a real file and a write is a promise the click handler cannot be awaited through,
 * so both are waited for rather than timed. A fixed timer that is long enough on an idle machine is
 * how this suite starts failing with nothing broken.
 */
const settle = async () => {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 20));
  });
};

const click = (element: Element | null | undefined) => {
  expect(element, 'expected the control to exist').toBeTruthy();
  act(() => {
    element?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
};

/**
 * One stroke across the pad. jsdom reports a zero-sized box, which would scale every pointer
 * coordinate by the canvas's own width, so the test gives the pad the 240 by 64 the stylesheet does.
 *
 * A tenth and nine-tenths of the way across at half the height is 0.1 and 0.9, and 0.5 down — in
 * sigPlain's box [72 660 272 720] that is `92 690` and `252 690`, page points and right way up.
 * Half the height is the middle of every box this file signs, so an assertion never has to settle
 * which way the y axis went to know where the mark landed.
 */
function strokeThePad(): HTMLCanvasElement | null {
  const pad = document.querySelector<HTMLCanvasElement>('.pjsr-sign-pad');
  if (!pad) return null;
  pad.getBoundingClientRect = () => ({
    left: 0,
    top: 0,
    width: 240,
    height: 64,
    right: 240,
    bottom: 64,
    x: 0,
    y: 0,
    toJSON: () => ({}),
  });
  fireEvent.pointerDown(pad, { clientX: 24, clientY: 32, pointerId: 1 });
  fireEvent.pointerMove(pad, { clientX: 120, clientY: 32, pointerId: 1 });
  fireEvent.pointerMove(pad, { clientX: 216, clientY: 32, pointerId: 1 });
  fireEvent.pointerUp(pad, { clientX: 216, clientY: 32, pointerId: 1 });
  return pad;
}

/** A stroke, and the rows the scan it triggers is expected to produce: one per widget box. */
async function drawUntilBoxesAppear(rows = 6) {
  strokeThePad();
  await waitFor(() => expect(document.querySelectorAll('.pjsr-sign-row')).toHaveLength(rows), {
    timeout: 4000,
    interval: 25,
  });
}

const rowButton = (field: string) =>
  [...document.querySelectorAll('.pjsr-sign-row')]
    .find((row) => row.querySelector('.pjsr-sign-field')?.textContent?.trim() === field)
    ?.querySelector('button') ?? null;

const noticeText = () => document.querySelector('.pjsr-pages-status')?.textContent;
const sectionText = () => document.querySelector('.pjsr-sign-status')?.textContent;

afterEach(async () => {
  /*
   * Let a write still in flight land before the spies are cleared. A handler `void`s its promise,
   * so a test can end with its own save on the way to `replaceDocument`, and clearing first hands
   * that call to whichever test runs next.
   */
  await settle();
  cleanup();
  replaced.mockClear();
  reportError.mockClear();
  // `mockReset`, not `mockClear`: the scan test hands `getData` a deferred, and an unconsumed
  // `mockImplementationOnce` would ride into whichever test runs after it.
  loaded.mockReset();
  loaded.mockImplementation(async () => sample());
  declaresForm.value = true;
});

describe('signature panel', () => {
  it('asks only the cheap question until there is a mark to place', async () => {
    render(<Harness shell={sigShell()} />);
    await settle();
    // The pad is there, because a document that claims a form might hold a box for it.
    expect(document.querySelector('.pjsr-sign-pad')).toBeTruthy();
    // And nothing has been parsed to find out: the file was never asked for, and there are no
    // rows, because nothing has been read past the metadata.
    expect(loaded).not.toHaveBeenCalled();
    expect(document.querySelector('.pjsr-sign-row')).toBeNull();

    await drawUntilBoxesAppear();
    expect(loaded, 'one stroke, one scan').toHaveBeenCalledTimes(1);

    strokeThePad();
    await settle();
    expect(loaded, 'a second stroke must not parse the same document again').toHaveBeenCalledTimes(1);
  });

  /*
   * FR-32: "reported while it runs". The scan that lists the boxes is a parse of the whole file —
   * measured at 150–200 ms of main thread on a thousand-page document — and it starts the moment
   * the reader lifts the pen. A panel that says nothing for a fifth of a second and then changes
   * underneath a reader is what that clause exists to forbid, so the sentence has to be on screen
   * *during* the parse. The bytes are held behind a deferred so this test can look while it runs.
   */
  it('says the boxes are being looked for while the parse is running', async () => {
    let release: (bytes: Uint8Array) => void = () => {};
    loaded.mockImplementationOnce(
      () =>
        new Promise<Uint8Array>((resolve) => {
          release = resolve;
        }),
    );
    render(<Harness shell={sigShell()} />);
    await settle();
    // Nothing is claimed to be running before there is a mark to place.
    expect(sectionText()).toBe('');

    strokeThePad();
    await settle();
    expect(sectionText(), 'the reader is told the list is coming').toBe(
      DEFAULT_LABELS.signatureScanning,
    );
    expect(document.querySelector('.pjsr-sign-row'), 'and the answer has not arrived yet').toBeNull();

    await act(async () => {
      release(sample());
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
    await waitFor(() => expect(document.querySelectorAll('.pjsr-sign-row')).toHaveLength(6), {
      timeout: 4000,
      interval: 25,
    });
    // The sentence does not linger: with the rows on screen the status paragraph is gone rather
    // than emptied, which is the same shape as the "no boxes" answer below it.
    expect(document.querySelector('.pjsr-sign-status'), 'the sentence goes when the rows arrive').toBeNull();
  });

  it('shows no section at all to a document that declares no form', async () => {
    declaresForm.value = false;
    render(<Harness shell={sigShell()} />);
    await settle();
    expect(document.querySelector('.pjsr-sign')).toBeNull();
    // The page list is still there — the difference between "nothing to sign" and "the panel did
    // not load" — and the writer was never handed the file to work out which it is.
    expect(document.querySelector('.pjsr-pages')).toBeTruthy();
    expect(loaded).not.toHaveBeenCalled();
  });

  it('names each box and the page it sits on', async () => {
    render(<Harness shell={sigShell()} />);
    await settle();
    await drawUntilBoxesAppear();
    expect([...document.querySelectorAll('.pjsr-sign-field')].map((n) => n.textContent)).toEqual([
      'sigPlain',
      'sigKid',
      'sigNoRotate',
      'sigAlreadySigned',
      // Five fields, six rows: a field displayed twice is offered twice, because the reader
      // has to see both rectangles to know what signing one does.
      'sigTwoBoxes',
      'sigTwoBoxes',
    ]);
    /*
     * Only the box holding a `/V` is called signed. Two of the others have an appearance
     * stream — an empty one, which is what an unsigned form often carries — and a reader told
     * "already signed" about those would leave a box they were meant to sign alone.
     */
    expect([...document.querySelectorAll('.pjsr-sign-meta')].map((n) => n.textContent)).toEqual([
      'Page 1',
      'Page 1',
      'Page 2',
      'Page 2 · Already signed',
      'Page 1',
      'Page 2',
    ]);
  });

  it('says so when the document claims a form but holds no signature box', async () => {
    loaded.mockImplementationOnce(async () => fixture('form-sample.pdf'));
    render(<Harness shell={sigShell()} />);
    await settle();
    strokeThePad();
    await waitFor(() => expect(sectionText()).toBe(DEFAULT_LABELS.signatureNone), {
      timeout: 4000,
      interval: 25,
    });
    // The pad does not vanish under someone who has just drawn: the answer is said instead.
    expect(document.querySelector('.pjsr-sign-pad')).toBeTruthy();
  });

  /*
   * The one box the tier will not write into, shown as such. `/V` on a `/Sig` field is a claim over
   * the bytes, so that control is absent rather than pressed and then refused.
   */
  it('does not offer to draw over a field that already holds a signature value', async () => {
    render(<Harness shell={sigShell()} />);
    await settle();
    await drawUntilBoxesAppear();
    expect(rowButton('sigAlreadySigned')?.disabled).toBe(true);
    expect(rowButton('sigAlreadySigned')?.title).toBe(DEFAULT_LABELS.signedAlready);
    // The boxes that hold an appearance but no value are offered, now that a mark exists.
    expect(rowButton('sigKid')?.disabled).toBe(false);
  });

  it('writes the drawn mark into the box that was clicked, in that box’s coordinates', async () => {
    render(<Harness shell={sigShell()} />);
    await settle();
    await drawUntilBoxesAppear();
    click(rowButton('sigPlain'));
    await waitFor(() => expect(replaced).toHaveBeenCalled(), { timeout: 4000, interval: 25 });

    expect(replaced).toHaveBeenCalledTimes(1);
    const out = latin(replaced.mock.calls[0]![0] as Uint8Array);
    // Pad pixels arrived as page points, right way up, inside the box that was chosen — and only
    // in it: sigKid's box is 150 by 40 at [72 570], so the same stroke there reads `79.5 584`.
    expect(out).toContain('92 690 m');
    expect(out).toContain('252 690 l');
    expect(out).not.toContain('79.5 584 m');
    // The mark is in sigPlain's own object, and the parent that reaches its widget through /Kids
    // still holds no appearance of its own.
    expect(objectOf(out, 'sigPlain')).toContain('/AP');
    expect(objectOf(out, 'sigKid')).not.toContain('/AP');
  });

  /*
   * FR-32's plural from the pad's side: one field displayed in two places takes the mark twice, and
   * the panel has to say so. A reader who signs the first box and is told only that it was placed
   * will look at the second and conclude it failed — so the count is in the announcement, and both
   * rectangles are in the bytes.
   */
  it('counts the boxes when one field has two, and writes the mark into both', async () => {
    render(<Harness shell={sigShell()} />);
    await settle();
    await drawUntilBoxesAppear();
    click(rowButton('sigTwoBoxes'));
    await waitFor(() => expect(noticeText()).toBe('Signature placed on sigTwoBoxes · 2'), {
      timeout: 4000,
      interval: 25,
    });

    const out = latin(replaced.mock.calls.at(-1)?.[0] as Uint8Array);
    // The same stroke, resolved into two different boxes: 0.1 and 0.9 across a 200-wide rectangle
    // on page 1, across a 100-wide one on page 2. One writer pass, four numbers that differ.
    expect(out).toContain('320 590 m');
    expect(out).toContain('480 590 l');
    expect(out).toContain('82 475 m');
    expect(out).toContain('162 475 l');
    expect(reportError).not.toHaveBeenCalled();
  });

  it('says which field the signature went into', async () => {
    render(<Harness shell={sigShell()} />);
    await settle();
    await drawUntilBoxesAppear();
    click(rowButton('sigNoRotate'));
    await waitFor(() => expect(noticeText()).toBe('Signature placed on sigNoRotate'), {
      timeout: 4000,
      interval: 25,
    });
    expect(reportError).not.toHaveBeenCalled();
  });

  it('states that the mark is not a digital signature, where the mark is placed', async () => {
    render(<Harness shell={sigShell()} />);
    await settle();
    expect(document.querySelector('.pjsr-sign-note')?.textContent).toBe(
      DEFAULT_LABELS.signatureNotCryptographic,
    );
  });
});
