/*
 * The page panel, tested against the real writer.
 *
 * The unit tests for `pdf-write` prove the primitives, and the playground proves that a browser
 * renders the result; what this file holds is the part in between, which is where a page editor
 * goes wrong quietly — a plan that does not reset when the document changes, a move that writes
 * the file the reader did not ask for, a control that stays enabled past the point where it would
 * produce a document with no pages. `applyPageEdits` therefore runs the genuine `arrangePages`
 * over a real fixture, and the assertion reads the page tree out of the bytes handed to the shell:
 * a test that only checked "replaceDocument was called" would pass on a rewrite that undid the
 * reader's move.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  FeaturePart,
  FeatureRunners,
  useFeatureStore,
} from './components/FeatureHost';
import { DEFAULT_LABELS } from './lib/labels';
import { editFeature } from './edit';
import type { FeatureStore } from './components/FeatureHost';
import type { AnyPdfFeature, PdfViewerShell } from './lib/features';

// From the working directory rather than `import.meta.url`, which vitest's dom project reports
// without a directory to be relative to.
const fixture = (name: string): Uint8Array =>
  new Uint8Array(readFileSync(join(process.cwd(), 'playground', 'fixtures', name)));

/** The 20-page fixture's page objects, in the order the file lists them. */
const kidsOf = (bytes: Uint8Array): number[] => {
  const text = Buffer.from(bytes).toString('latin1');
  const match = /\/Kids\s*\[([^\]]*)\]/.exec(text);
  return [...(match?.[1] ?? '').matchAll(/(\d+) 0 R/g)].map((m) => Number(m[1]));
};

const order = () => fixture('page-order-sample.pdf');
/** One object's dictionary, so an assertion cannot land on a neighbour's key. */
const dictOf = (text: string, num: number): string => {
  const start = text.indexOf(`
${num} 0 obj`);
  return start < 0 ? '' : text.slice(start, text.indexOf('endobj', start));
};
const replaced = vi.hoisted(() => vi.fn());
const rotatePage = vi.hoisted(() => vi.fn());
const reportError = vi.hoisted(() => vi.fn());

function makeShell(name: string, pages = 20): PdfViewerShell {
  return {
    // A document with nothing in `annotationStorage`, which is the state in which pdf.js tells
    // a caller to use `getData()` rather than commit an empty change.
    doc: {
      saveDocument: async () => order(),
      getData: async () => order(),
      annotationStorage: { size: 0 },
    } as unknown as PdfViewerShell['doc'],
    numPages: pages,
    pageRotations: {},
    replaceDocument: replaced,
    rotatePage,
    reportError,
    labels: DEFAULT_LABELS,
    documentLabel: name,
  } as unknown as PdfViewerShell;
}

function Harness({ shell, features }: { shell: PdfViewerShell; features: AnyPdfFeature[] }) {
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

afterEach(async () => {
  /*
   * Let any write still in flight land before the spies are cleared. A handler `void`s the
   * promise because a click may not await, so a test can end with its own save on its way to
    * `replaceDocument`; clearing the mocks first hands that call to the next test, which then
   * sees a write it never asked for — the shape these two files took several rounds to name.
   */
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 60));
  });
  cleanup();
  replaced.mockClear();
  rotatePage.mockClear();
  reportError.mockClear();
});

/*
 * Apply is a write whose promise the click handler cannot be awaited through (`void`d, because a
 * button's onClick may not return a promise), so a test that asserts the moment the click returns
 * races it. Settling on a timer is the blunt instrument; the assertion that matters is what the
 * bytes say, not when they arrived.
 */
const flush = async () => {
  click(byLabel(/^Apply page changes$/));
  /*
   * Waited for rather than timed. One apply is a save through pdf.js plus a full pass by the
   * writer over a twenty-page fixture, and the panel reading the same file for its signature
   * boxes shares that window; a timer long enough on an idle machine is why a suite starts
   * failing with nothing broken.
   */
  await waitFor(() => expect(replaced).toHaveBeenCalled(), { timeout: 5000, interval: 25 });
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 10));
  });
};

const click = (element: Element | null | undefined) => {
  expect(element, 'expected the control to exist').toBeTruthy();
  act(() => {
    element?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
};

/*
 * The live region writes its text one task after the notice changes — see `PagesPanel` — so an
 * assertion about what a reader hears has to let that task run first.
 */
const settle = async () => {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 20));
  });
};

const statusText = () => document.querySelector('.pjsr-pages-status')?.textContent?.trim();

const byLabel = (text: RegExp) =>
  [...document.querySelectorAll<HTMLElement>('button')].find((b) =>
    text.test(b.getAttribute('aria-label') ?? b.textContent ?? ''),
  );

describe('Pages panel', () => {
  it('lists every page of the document', () => {
    render(<Harness shell={makeShell('order')} features={[editFeature]} />);
    expect(document.querySelectorAll('.pjsr-pages-row')).toHaveLength(20);
    expect(document.querySelector('.pjsr-pages-page')?.textContent).toContain('Page 1 of 20');
  });

  it('writes the move the reader made, and only that', async () => {
    render(<Harness shell={makeShell('order')} features={[editFeature]} />);
    const rows = [...document.querySelectorAll('.pjsr-pages-row')];
    const before = kidsOf(order());

    click(rows[0]?.querySelector('button[aria-label*="Move page later"]'));
    await flush();
    expect(replaced).toHaveBeenCalledTimes(1);
    const written = replaced.mock.calls[0]?.[0] as Uint8Array;
    expect(kidsOf(written)).toEqual([before[1], before[0], ...before.slice(2)]);
  });

  it('applies a rotation to the page it was set on, after that page moved', async () => {
    render(<Harness shell={makeShell('order')} features={[editFeature]} />);
    const rows = [...document.querySelectorAll('.pjsr-pages-row')];
    const before = kidsOf(order());

    // Turn page 1, then move it later: the angle has to travel with the page, not the slot.
    click(rows[0]?.querySelector('button[aria-label*="Rotate clockwise"]'));
    click(rows[0]?.querySelector('button[aria-label*="Move page later"]'));
    await flush();

    const bytes = replaced.mock.calls[0]?.[0] as Uint8Array;
    // Page 1 is object 207 in this fixture, and it should be the second page of the result.
    expect(kidsOf(bytes)[1]).toBe(before[0]);
    expect(dictOf(Buffer.from(bytes).toString('latin1'), 207)).toMatch(/\/Rotate 90/);
  });

  it('refuses to remove the last page standing', async () => {
    // A two-page document, so one removal leaves a file with a page in it and no second
    // removal is offered.
    render(<Harness shell={makeShell('annotated', 2)} features={[editFeature]} />);
    const removes = () => [
      ...document.querySelectorAll<HTMLButtonElement>(
        '.pjsr-pages-row button[aria-label*="Remove page"]',
      ),
    ];

    click(removes()[0]);
    await flush();
    expect(replaced).toHaveBeenCalledTimes(1);
    expect(kidsOf(replaced.mock.calls[0]?.[0] as Uint8Array)).toHaveLength(1);

    // A one-page document has nothing to remove, so the control says so rather than
    // offering to write a file with no pages in it.
    cleanup();
    render(<Harness shell={makeShell('annotated', 1)} features={[editFeature]} />);
    expect(document.querySelectorAll('.pjsr-pages-row')).toHaveLength(1);
    expect(removes()[0]?.hasAttribute('disabled')).toBe(true);
  });

  it('steps back through the batch without writing anything', () => {
    render(<Harness shell={makeShell('order')} features={[editFeature]} />);
    const rows = [...document.querySelectorAll('.pjsr-pages-row')];

    click(rows[0]?.querySelector('button[aria-label*="Move page later"]'));
    click(rows[0]?.querySelector('button[aria-label*="Rotate clockwise"]'));
    click(byLabel(/^Undo$/));

    expect(replaced).not.toHaveBeenCalled();
    // The turn is gone and the move is still pending: page 2 leads, unrotated.
    expect(document.querySelector('.pjsr-pages-page')?.textContent).toContain('Page 2');
    expect(document.querySelector('.pjsr-pages-angle')).toBeNull();
    expect(byLabel(/^Undo$/)?.hasAttribute('disabled')).toBe(false);
  });

  it('announces what happened in the reader’s own page numbering', async () => {
    render(<Harness shell={makeShell('order')} features={[editFeature]} />);
    const rows = [...document.querySelectorAll('.pjsr-pages-row')];
    click(rows[1]?.querySelector('button[aria-label*="Move page earlier"]'));
    await settle();
    expect(statusText()).toMatch(/Page 2 moved to position 1/);
  });

  it('drops the plan when the document changes underneath it', async () => {
    const first = makeShell('order');
    const { rerender } = render(<Harness shell={first} features={[editFeature]} />);
    const rows = [...document.querySelectorAll('.pjsr-pages-row')];
    click(rows[0]?.querySelector('button[aria-label*="Move page later"]'));
    await settle();
    expect(byLabel(/^Apply page changes$/)?.hasAttribute('disabled')).toBe(false);

    rerender(<Harness shell={makeShell('other')} features={[editFeature]} />);
    // A pending plan named pages of the document that is gone; the list is its own again.
    expect(document.querySelector('.pjsr-pages-page')?.textContent).toContain('Page 1 of 20');
    expect(byLabel(/^Apply page changes$/)?.hasAttribute('disabled')).toBe(true);
    // And so is the announcement: what happened to the old document is not news about this one.
    await settle();
    expect(statusText()).toBe('');
  });

  /*
   * The apply announcement survives the swap it caused. `applyPageEdits` sets the notice and the
   * new document arrives a moment later, and the effect that voids a plan on any document change
   * used to unsay the announcement in the same pass — measured in a browser, where the live region
   * read empty two seconds after an apply. The test above is the counterfactual: a document change
   * this tier did not cause still clears it.
   */
  it('keeps saying what the apply did when the document it wrote arrives', async () => {
    const shell = makeShell('order');
    const { rerender } = render(<Harness shell={shell} features={[editFeature]} />);
    click(
      document
        .querySelectorAll('.pjsr-pages-row')[0]
        ?.querySelector('button[aria-label*="Move page later"]'),
    );
    await flush();
    await settle();
    expect(statusText()).toMatch(/Page changes applied/);

    /*
     * A replacement reaches a feature as two changes: the old document going away while the new one
     * loads — during which this panel is not mounted at all — then the new one arriving. Modelling
     * only the second is how the first version of this fix passed here and failed in a browser.
     */
    const loading = makeShell('order');
    (loading as { doc: unknown }).doc = null;
    rerender(<Harness shell={loading} features={[editFeature]} />);
    expect(document.querySelector('.pjsr-pages-status')).toBeNull();

    rerender(<Harness shell={makeShell('order')} features={[editFeature]} />);
    // Not pre-rendered. A region that mounts already holding its words has not announced them,
    // which is why the write waits a task rather than reading straight off the notice.
    expect(statusText()).toBe('');
    await settle();
    expect(statusText()).toMatch(/Page changes applied/);

    // The grace is spent with the swap: a document that is not ours unsays it again.
    rerender(<Harness shell={makeShell('other')} features={[editFeature]} />);
    await settle();
    expect(statusText()).toBe('');
  });

  /*
   * pdf.js warns in the console when `saveDocument()` is called with an empty
   * `annotationStorage` and says to use `getData()` instead. A reader who only reordered pages
   * has changed nothing the engine is tracking, so three writes in a row would log three
   * warnings they did not cause — which is how this was caught in a browser.
   */
  it('takes the loaded bytes when there is nothing to commit, and the commit when there is', async () => {
    const shell = makeShell('order');
    const doc = shell.doc as unknown as {
      saveDocument: () => Promise<Uint8Array>;
      getData: () => Promise<Uint8Array>;
      annotationStorage: { size: number };
    };
    const commit = vi.fn(async () => order());
    const loaded = vi.fn(async () => order());
    doc.saveDocument = commit;
    doc.getData = loaded;

    render(<Harness shell={shell} features={[editFeature]} />);
    await settle();
    /*
     * The panel reads the document once on its own, to list the boxes a reader could sign, so
     * the count starts here: what this test holds the tier to is the source of a *write*.
     */
    const loadsBefore = loaded.mock.calls.length;
    click([...document.querySelectorAll('.pjsr-pages-row')][0]?.querySelector('button[aria-label*="Move page later"]'));
    await flush();
    expect(commit, 'nothing was pending in storage, so no commit should be asked for').not.toHaveBeenCalled();
    expect(loaded.mock.calls.length - loadsBefore, 'one apply, one read of the loaded bytes').toBe(1);

    // Now with an edit in storage, the same write must go through the commit or the reader's
    // marks would be missing from the file they saved.
    cleanup();
    const edited = makeShell('order');
    const editedDoc = edited.doc as unknown as typeof doc;
    const editCommit = vi.fn(async () => order());
    editedDoc.annotationStorage = { size: 1 };
    editedDoc.saveDocument = editCommit;
    render(<Harness shell={edited} features={[editFeature]} />);
    click([...document.querySelectorAll('.pjsr-pages-row')][0]?.querySelector('button[aria-label*="Move page later"]'));
    await flush();
    expect(editCommit).toHaveBeenCalledTimes(1);
  });

  /*
   * The engine rejects `saveDocument()` outright for a document whose pages were composed from
   * an XFA template, so every write the tier offers — apply, extract, split, flatten — would
   * fail on it. The byte source has to know before asking.
   */
  it('never asks an XFA document to commit', async () => {
    const shell = makeShell('xfa');
    const doc = shell.doc as unknown as {
      saveDocument: () => Promise<Uint8Array>;
      getData: () => Promise<Uint8Array>;
      annotationStorage: { size: number };
      isPureXfa: boolean;
    };
    const commit = vi.fn(async () => order());
    doc.annotationStorage = { size: 4 };
    doc.isPureXfa = true;
    doc.saveDocument = commit;
    render(<Harness shell={shell} features={[editFeature]} />);
    click([...document.querySelectorAll('.pjsr-pages-row')][0]?.querySelector('button[aria-label*="Move page later"]'));
    await flush();

    expect(commit, 'a pure-XFA document cannot be committed').not.toHaveBeenCalled();
    // This test's claim is about the commit, not about how many writes happened: the tier
    // writes once from the loaded bytes, and an earlier test's promise can land in this window.
    expect(replaced, 'the write still happens, from the loaded bytes').toHaveBeenCalled();
  });

  it('reports a writer failure through the viewer rather than swallowing it', async () => {
    const shell = makeShell('order');
    // Something in storage, so the write takes the commit path — and that commit is what fails.
    const doc = shell.doc as unknown as {
      saveDocument: () => Promise<Uint8Array>;
      annotationStorage: { size: number };
    };
    doc.annotationStorage = { size: 1 };
    doc.saveDocument = async () => {
      throw new Error('no bytes for you');
    };
    render(<Harness shell={shell} features={[editFeature]} />);
    const rows = [...document.querySelectorAll('.pjsr-pages-row')];
    click(rows[0]?.querySelector('button[aria-label*="Move page later"]'));
    /*
     * Not `flush()`: that helper waits for a write to land, and this test is about the one
     * that must not. The timer is the assertion's own — a missing write is proven by waiting
     * and seeing nothing, which is the weakest thing a test can do, so the error report is
     * what the test actually keys on.
     */
    click(byLabel(/^Apply page changes$/));
    await settle();
    expect(replaced).not.toHaveBeenCalled();
    expect(reportError).toHaveBeenCalled();
  });
});
