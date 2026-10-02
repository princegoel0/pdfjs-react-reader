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
 * Four of the six rows are re-established here against the real engine, in this process. Two are not, and
 * the reason is a property of the harness rather than an excuse:
 *
 *  - **a wrong password** cannot be loaded beside the others. The engine re-asks inside the same microtask
 *    chain, and a case that answers every ask from inside the callback loops at ~27,000 asks a second and
 *    starves everything after it — which is why `encrypted.reprompt.test.ts` is its own file.
 *  - **an over-large page** has no fixture. The ceilings are arithmetic (`canvas.test.ts` measures them
 *    against a 3060×3960 and a 40,000×1000 box), and inventing a giant page here would assert the same
 *    numbers with extra steps rather than the thing arithmetic cannot reach: what the engine reports for a
 *    page that big. That needs a generated fixture, and the task is open.
 *
 * What the guard tests are for: a table a reader can delete rows from is a table that quietly stops being
 * evidence. So the six row keys are pinned against the requirement's own list, every cited test must still
 * exist with the title cited (a rename breaks the suite on purpose), and the four in-process rows record
 * that they actually ran — which an `it.skip` cannot hide.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PasswordResponses, getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { describe, expect, it } from 'vitest';
import { classifyLoadError } from './retry.js';

/** The three things a reader can be told, and the only three this suite admits. */
type Outcome = 'recovers' | 'refuses' | 'parks';

interface Case {
  /** The shape as `FR-51` words it, so the table reads against the requirement. */
  key: string;
  outcome: Outcome;
  /** Where the mechanism is proved. Every row cites a file and a test title; four also run here. */
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
    proof: { file: 'src/lib/canvas.test.ts', title: 'clamps to the area ceiling before the canvas can go blank' },
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

  it('runs the four rows that can run in this process', () => {
    const inProcess = CASES.filter((c) => c.key !== 'wrong password' && c.key !== 'over-large page');
    expect(inProcess).toHaveLength(4);
    expect([...ran].sort()).toEqual(inProcess.map((c) => c.key).sort());
  });
});
