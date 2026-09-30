/*
 * FR-03's open half, measured against the real engine: what a **wrong** password actually does.
 *
 * This case was recorded as unmeasurable — "neither a rejection nor a second callback within 60 s" — and
 * that reading was wrong in a way worth keeping, because the mistake is easy to repeat. The engine does
 * re-ask, about a millisecond after a wrong answer. It re-asks *synchronously*, in a microtask chain that
 * never yields: a harness that answers every ask instantly and wrongly therefore loops at roughly 27,000
 * asks a second, the event loop never gets a tick, and a watchdog timer cannot fire. What looked like
 * sixty seconds of silence was a runaway retry — and the fix is on our side of the callback, not the
 * engine's: answer when the reader answers, and the second ask simply waits.
 *
 * So this file does the two things the requirement actually claims, with one real load:
 *
 *   wrong password → a second `onPassword`, with `INCORRECT_PASSWORD`;
 *   that ask stays open until something answers it, and a correct answer then opens the document.
 *
 * The delay is a `setTimeout`, not a microtask, deliberately: it is the smallest thing that proves the
 * load is *parked* rather than spinning, and it is also what a reader does.
 *
 * Its own file because `encrypted.test.ts` established that a load left parked in the Node fake worker
 * stops every later case in the process; vitest isolates files, not tests.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PasswordResponses, getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { describe, expect, it } from 'vitest';

const encrypted = (): Uint8Array =>
  new Uint8Array(readFileSync(join(process.cwd(), 'playground', 'fixtures', 'encrypted-sample.pdf')));

/** The password `scripts/make-encrypted-pdf.mjs` builds the handler around. */
const PASSWORD = 'secret';
const WRONG = 'not-the-password';

describe('a wrong password on an encrypted document', () => {
  it('is asked again with INCORRECT_PASSWORD, waits, and then opens on the right answer', async () => {
    const asks: number[] = [];
    const answer: Array<(password: string | Error) => void> = [];

    const task = getDocument({ data: encrypted() });
    // Annotated: assigning to the nullable `onPassword` property leaves its parameters untyped.
    task.onPassword = (update: (password: string | Error) => void, reason: number) => {
      asks.push(reason);
      answer.push(update);
    };

    // Ask #1: the first prompt. Answer it wrongly, on purpose.
    await waitForAsk(() => asks.length >= 1);
    expect(asks[0]).toBe(PasswordResponses.NEED_PASSWORD);
    answer[0]?.(WRONG);

    /*
     * Ask #2: the re-prompt FR-03 requires. Measured at ~1 ms after the wrong answer, so this wait is
     * generous rather than tight — but it must be a *wait*, because the re-ask arrives in a microtask
     * chain that a synchronous assertion would race.
     */
    await waitForAsk(() => asks.length >= 2);
    expect(asks[1]).toBe(PasswordResponses.INCORRECT_PASSWORD);
    expect(asks).toHaveLength(2);

    // Nothing settled: a wrong password parks the load rather than failing it, which is the difference
    // between a second prompt and an error the reader has to dig out of a retry.
    const settled = await Promise.race([
      task.promise.then(() => 'resolved', () => 'rejected'),
      new Promise((resolve) => setTimeout(() => resolve('parked'), 50)),
    ]);
    expect(settled).toBe('parked');
    expect(asks, 'the engine waits for the answer instead of asking again on its own').toEqual([
      PasswordResponses.NEED_PASSWORD,
      PasswordResponses.INCORRECT_PASSWORD,
    ]);

    // And the second ask is answerable, which is the whole point of a prompt.
    answer[1]?.(PASSWORD);
    const doc = await task.promise;
    expect(doc.numPages).toBe(1);
    expect(asks).toEqual([PasswordResponses.NEED_PASSWORD, PasswordResponses.INCORRECT_PASSWORD]);
  }, 20_000);
});

/** Poll a predicate on a macrotask interval, so the event loop gets to run between checks. */
async function waitForAsk(done: () => boolean, limit = 100): Promise<void> {
  for (let tick = 0; tick < limit; tick++) {
    if (done()) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`the password ask never arrived within ${limit * 10} ms`);
}
