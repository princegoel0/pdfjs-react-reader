/*
 * FR-51: the six ways a document can be wrong, and which of three outcomes each one produces.
 *
 * Every row of this table already had a committed test, scattered across four files a reader has to know to
 * look for. That is not the same as the requirement being met: `FR-51` asks for the *distinction* to be
 * asserted — which damaged files recover, which refuse, and which park on a callback — because a viewer
 * that shows a blank page for all six has not failed six times, it has failed to say anything at all. So
 * this file is the matrix, in one place, with its rows named after the shapes in the requirement rather
 * than after the modules that happen to hold the code.
 *
 * Five of the six rows are re-established here against the real engine, in this process. One is not, and the
 * reason is a property of the harness rather than an excuse:
 *
 *  - **a wrong password** cannot be loaded beside the others. The engine re-asks inside the same microtask
 *    chain, and a case that answers every ask from inside the callback loops at ~27,000 asks a second and
 *    starves everything after it — which is why `encrypted.reprompt.test.ts` is its own file.
 *
 * **An over-large page** used to be the second exception, and it is the one this pass closed: the row was
 * proved by arithmetic (`canvas.test.ts` measures the ceilings against a box typed into a test), which
 * establishes the formula and leaves open the only thing a formula cannot invent — what the engine reports
 * for a page that size. `oversize-sample.pdf` now answers that, with three pages whose boxes land on the
 * three different verdicts §6.1 admits, so the row states a distinction it measured.
 *
 * What the guard tests are for: a table a reader can delete rows from is a table that quietly stops being
 * evidence. So the six row keys are pinned against the requirement's own list, every cited test must still
 * exist with the title cited (a rename breaks the suite on purpose), and the five in-process rows record
 * that they actually ran — which an `it.skip` cannot hide.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PasswordResponses, getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { describe, expect, it } from 'vitest';
import {
  MAX_RENDER_PIXELS,
  MAX_RENDER_SIDE,
  MIN_RENDER_SCALE,
  resolveRenderScale,
} from './canvas.js';
import { classifyLoadError } from './retry.js';

/** The three things a reader can be told, and the only three this suite admits. */
type Outcome = 'recovers' | 'refuses' | 'parks';

interface Case {
  /** The shape as `FR-51` words it, so the table reads against the requirement. */
  key: string;
  outcome: Outcome;
  /** Where the mechanism is proved. Every row cites a file and a test title; five also run here. */
  proof: { file: string; title: string };
  ran?: boolean;
}

const CASES: Case[] = [
  {
    key: 'truncated mid object',
    outcome: 'refuses',
    proof: { file: 'src/lib/damaged.test.ts', title: 'refuses a file that stops mid-stream' },
  },
  {
    key: 'xref points past the end',
    outcome: 'recovers',
    proof: { file: 'src/lib/damaged.test.ts', title: 'recovers from a broken xref and still reports its pages' },
  },
  {
    key: 'encrypted',
    outcome: 'parks',
    proof: { file: 'src/lib/encrypted.test.ts', title: 'parks the load and asks for a password instead of rejecting outright' },
  },
  {
    key: 'wrong password',
    outcome: 'parks',
    proof: {
      file: 'src/lib/encrypted.reprompt.test.ts',
      title: 'is asked again with INCORRECT_PASSWORD, waits, and then opens on the right answer',
    },
  },
  {
    key: 'rotated page',
    outcome: 'recovers',
    proof: { file: 'src/lib/layout.test.ts', title: 'follows the shape the reader sees, so rotation is applied first' },
  },
  {
    key: 'over-large page',
    outcome: 'recovers',
    // The mechanism is `canvas.test.ts`'s clamp-and-refuse arithmetic; what was missing was a page the engine
    // itself reports at that size, and that is what the cited test in this file now reads out of the fixture.
    proof: {
      file: 'src/lib/edge-cases.test.ts',
      title: 'reads the over-large page off the engine, and gets the two verdicts apart',
    },
  },
];

const fixture = (name: string): Uint8Array =>
  new Uint8Array(readFileSync(join(process.cwd(), 'playground', 'fixtures', name)));

const load = (bytes: Uint8Array) => getDocument({ data: bytes }).promise;

/** The published verdict for a rejection, so the row says what the shell is told and not just what threw. */
const verdict = async (bytes: Uint8Array) =>
  load(bytes).then(
    () => null,
    (error: unknown) => classifyLoadError(error),
  );

const ran = new Set<string>();

describe('the six ways a document can be wrong', () => {
  it('refuses a file that stops mid-object, and says the file is not readable', async () => {
    const outcome = await verdict(fixture('damaged-truncated.pdf'));
    expect(outcome).toEqual({ retry: false, status: null, reason: 'the document is not a readable PDF' });
    ran.add('truncated mid object');
  });

  it('recovers from an xref that points past the end, with its page count intact', async () => {
    const doc = await load(fixture('damaged-xref.pdf'));
    expect(doc.numPages).toBe(3);
    await doc.cleanup();
    ran.add('xref points past the end');
  });

  it('parks an encrypted document on the password callback rather than on the error path', async () => {
    const task = getDocument({ data: fixture('encrypted-sample.pdf') });
    const reasons: number[] = [];
    // Annotated because `onPassword` is a nullable property, so assigning to it infers nothing.
    task.onPassword = (update: (password: string | Error) => void, reason: number) => {
      reasons.push(reason);
      update(new Error('abandoned by the test'));
    };
    const outcome = await task.promise.then(
      () => null,
      (error: unknown) => classifyLoadError(error),
    );
    expect(reasons).toEqual([PasswordResponses.NEED_PASSWORD]);
    expect(outcome).toEqual({ retry: false, status: null, reason: 'the document is encrypted' });
    ran.add('encrypted');
  });

  /*
   * The engine half of the rotation row, which no other test in this repository establishes: that `/Rotate`
   * arrives on the page object at all, and that `getViewport` swaps the box to match. `layout.test.ts`
   * proves the layout math honours a rotation it is *given*; this proves the rotation is there to be had,
   * from the fixture that carries it — page 5 of `page-order-sample.pdf`, landscape pages notwithstanding.
   */
  it('recovers a rotated page with the box the reader sees, not the box the file stores', async () => {
    const doc = await load(fixture('page-order-sample.pdf'));
    const rotated: number[] = [];
    for (let page = 1; page <= doc.numPages; page += 1) {
      const proxy = await doc.getPage(page);
      if (proxy.rotate !== 0) rotated.push(page);
    }
    expect(rotated, '/Rotate belongs to exactly one page of this fixture').toEqual([5]);
    const proxy = await doc.getPage(5);
    // Defaults on the destructuring rather than assertions: `view` is a `number[]`, so an index is
    // `number | undefined` to the type checker even though every page in this fixture has four entries.
    const [x0 = 0, y0 = 0, x1 = 0, y1 = 0] = proxy.view;
    const box = { width: x1 - x0, height: y1 - y0 };
    expect(box).toEqual({ width: 612, height: 792 });
    const viewport = proxy.getViewport({ scale: 1 });
    expect({ width: viewport.width, height: viewport.height }).toEqual({ width: 792, height: 612 });
    // The counterfactual, and the reason this fixture has a landscape page too: page 8 is wide because its
    // MediaBox is, with no rotation at all. Without this line the assertion above could be satisfied by a
    // `getViewport` that merely reported the longer side first.
    const plain = await doc.getPage(8);
    expect(plain.rotate).toBe(0);
    const [px0 = 0, py0 = 0, px1 = 0, py1 = 0] = plain.view;
    const plainBox = { width: px1 - px0, height: py1 - py0 };
    const plainViewport = plain.getViewport({ scale: 1 });
    expect(plainBox).toEqual({ width: plainViewport.width, height: plainViewport.height });
    await doc.cleanup();
    ran.add('rotated page');
  });

  /*
   * The row that used to be arithmetic. `oversize-sample.pdf` carries three boxes chosen against the shipped
   * ceilings, and the point of reading them from the engine is that a test which types a box in can type in a
   * box that no parser would ever hand it: a 200 000-point page is a real thing a real file can declare, and
   * whether pdf.js reports it, truncates it or refuses the document at all is not knowable from here.
   *
   * The three boxes produce the three verdicts §6.1 admits, and the distinction between them is what FR-51
   * asks this suite to assert: an ordinary page paints, a 108-megapixel page paints *softer*, and a page that
   * cannot be represented even at the 0.25 minimum is refused rather than painted as a blank strip.
   */
  it('reads the over-large page off the engine, and gets the two verdicts apart', async () => {
    const doc = await load(fixture('oversize-sample.pdf'));
    expect(doc.numPages).toBe(3);

    const boxes: Array<{ width: number; height: number }> = [];
    for (let page = 1; page <= doc.numPages; page += 1) {
      const proxy = await doc.getPage(page);
      const viewport = proxy.getViewport({ scale: 1 });
      boxes.push({ width: viewport.width, height: viewport.height });
    }
    expect(
      boxes,
      'the fixture no longer reports the three boxes it was generated to carry, so the verdicts below are unfixed',
    ).toEqual([
      { width: 612, height: 792 },
      { width: 12_000, height: 9_000 },
      { width: 200_000, height: 600 },
    ]);

    // The same call `PdfPage` makes before it allocates a canvas, at a display ratio of 1 and the shipped
    // ceilings: what changes between the three rows is the box, and the box came out of a file.
    const budget = (box: { width: number; height: number }) =>
      resolveRenderScale({ ...box, devicePixelRatio: 1, maxPixels: MAX_RENDER_PIXELS, maxSide: MAX_RENDER_SIDE });
    const [letter, drawing, banner] = boxes.map(budget);

    expect(letter).toMatchObject({ capped: false, refused: false, scale: 1 });

    expect(drawing?.refused, 'a 108 MP page was refused, which §6 forbids while it fits above the floor').toBe(false);
    expect(drawing?.capped).toBe(true);
    expect(drawing?.limitedBy).toBe('pixels');
    expect(drawing!.scale).toBeLessThan(1);
    expect(drawing!.scale).toBeGreaterThanOrEqual(MIN_RENDER_SCALE);
    // The clause in one line: the result fits inside the ceiling it was clamped by.
    const drawingBox = boxes[1]!;
    expect(drawingBox.width * drawingBox.height * drawing!.scale ** 2).toBeLessThanOrEqual(MAX_RENDER_PIXELS + 1);

    expect(banner?.refused, 'a page wider than 32 767/0.25 points can be painted at nothing').toBe(true);
    expect(banner?.limitedBy).toBe('side');
    expect(banner!.scale, 'a refusal reports the floor, never a scale to paint at').toBe(MIN_RENDER_SCALE);
    // Why it refuses, in the fixture’s own number: no side this long fits the ceiling at the minimum scale.
    const bannerBox = boxes[2]!;
    expect(bannerBox.width).toBeGreaterThan(MAX_RENDER_SIDE / MIN_RENDER_SCALE);

    // And the two are genuinely different documents to a reader: one paints softly, one is not painted.
    expect(drawing?.refused).not.toBe(banner?.refused);
    await doc.cleanup();
    ran.add('over-large page');
  });

  /* --- the guards. They are tests because a table with no teeth is documentation. --- */

  it('covers exactly the six shapes the requirement names', () => {
    expect(CASES.map((c) => c.key)).toEqual([
      'truncated mid object',
      'xref points past the end',
      'encrypted',
      'wrong password',
      'rotated page',
      'over-large page',
    ]);
    const outcomes = new Set(CASES.map((c) => c.outcome));
    for (const outcome of outcomes) expect(['recovers', 'refuses', 'parks']).toContain(outcome);
    // Both halves of the distinction the requirement is actually about.
    expect([...outcomes].sort()).toEqual(['parks', 'recovers', 'refuses']);
  });

  it('points every row at a committed test that still carries the cited title', () => {
    for (const c of CASES) {
      const path = join(process.cwd(), c.proof.file);
      expect(existsSync(path), `${c.key}: ${c.proof.file} is gone`).toBe(true);
      const source = readFileSync(path, 'utf8');
      // Anchored on the call, not on the phrase: a file that mentions the words in a comment while the test
      // itself was renamed or deleted would otherwise pass, and the citation would mean nothing.
      const cited = source.includes(`it('${c.proof.title}`) || source.includes(`it("${c.proof.title}`);
      expect(cited, `${c.key}: ${c.proof.file} has no it() titled "${c.proof.title}…"`).toBe(true);
    }
  });

  it('runs the five rows that can run in this process', () => {
    const inProcess = CASES.filter((c) => c.key !== 'wrong password');
    expect(inProcess).toHaveLength(5);
    expect([...ran].sort()).toEqual(inProcess.map((c) => c.key).sort());
  });
});
