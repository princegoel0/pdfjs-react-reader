/*
 * FR-03 at the engine boundary: what an encrypted document actually does.
 *
 * The prompt component is tested in `PasswordPrompt.test.tsx` and the retry UI in
 * `ViewerLayout.failure.test.tsx`. Neither answers the question the PRD's edge-case list is really
 * pointing at — whether a protected file parks the load, asks for a password, and opens when it gets
 * the right one. That is only answerable against the real engine, and it is what this file does.
 *
 * One load per test, deliberately. A spike that ran the abandon / wrong / right cases in sequence in
 * one process printed only its first result: after an abandoned encrypted load the Node fake worker
 * never came back, and everything after it hung. Vitest isolates files, not cases, so each case here
 * gets its own file-level structure rather than sharing one wedged worker.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PasswordResponses, getDocument, type PDFDocumentLoadingTask } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { describe, expect, it } from 'vitest';

const encrypted = (): Uint8Array =>
  new Uint8Array(readFileSync(join(process.cwd(), 'playground', 'fixtures', 'encrypted-sample.pdf')));

/** The password `scripts/make-encrypted-pdf.mjs` builds the handler around. */
const PASSWORD = 'secret';

/** Start the load with the password answer already wired in, and keep the reasons that arrived. */
function withPassword(password: string | Error): { task: PDFDocumentLoadingTask; reasons: number[] } {
  const task = getDocument({ data: encrypted() });
  const reasons: number[] = [];
  // Annotated because `onPassword` is a nullable property: assigning to it does not give the
  // parameters a type to be inferred from.
  task.onPassword = (update: (password: string | Error) => void, reason: number) => {
    reasons.push(reason);
    update(password);
  };
  return { task, reasons };
}

describe('an encrypted document', () => {
  it('parks the load and asks for a password instead of rejecting outright', async () => {
    const { task, reasons } = withPassword(new Error('No password provided.'));
    const outcome = await task.promise.then(
      (doc) => ({ kind: 'loaded' as const, pages: doc.numPages }),
      (error: unknown) => ({ kind: 'rejected' as const, error: error as Error }),
    );

    // The reason arrives before anything settles: this is the callback the shell turns into the prompt.
    expect(reasons).toEqual([PasswordResponses.NEED_PASSWORD]);
    expect(outcome.kind).toBe('rejected');
  });

  /*
   * The message the reader would see if the cancel path surfaced it. Asserted as text because it is
   * pdf.js's own wording, and a change there is something the shell should notice rather than absorb.
   */
  it('names an abandoned password request the way pdf.js names it', async () => {
    const { task } = withPassword(new Error('No password provided.'));
    const error = await task.promise.then(
      () => null,
      (caught: unknown) => caught as { name: string; code?: number; message: string },
    );
    expect(error?.name).toBe('PasswordException');
    expect(error?.code).toBe(PasswordResponses.NEED_PASSWORD);
    expect(error?.message).toBe('No password given');
  });

  it('opens when the right password comes back', async () => {
    const { task, reasons } = withPassword(PASSWORD);
    const doc = await task.promise;
    expect(reasons).toEqual([PasswordResponses.NEED_PASSWORD]);
    expect(doc.numPages).toBe(1);
    const page = await doc.getPage(1);
    expect(page.view[2]).toBeGreaterThan(0);
  });

  /*
   * The wrong-password case is covered in `encrypted.reprompt.test.ts`, which is where it belongs: one
   * load per file, because a load left parked in this Node fake worker stops every case after it. When
   * this file was written the re-prompt had been recorded as unmeasurable — "neither a rejection nor a
   * second callback within 60 s" — which turned out to be an artefact of answering every ask from inside
   * the callback: the engine re-asks in the same microtask chain, so that loops at about 27,000 asks a
   * second and starves the timer that was supposed to notice.
   */
});
