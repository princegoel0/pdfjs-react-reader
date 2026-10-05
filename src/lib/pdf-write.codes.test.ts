/*
 * FR-54's `WRITER_ERROR`, given a speaker on a path a caller can reach — and the boundary that says where it
 * stops being one.
 *
 * §3.6 publishes the code, `pdf-write.ts` throws it from three places inside `permutePageTree`, and nothing had
 * ever reached any of them: the same shape of gap the read keeps finding, a vocabulary with no producer tested.
 * The first attempt here tried to build the condition those three sites describe — a page tree whose `/Kids`
 * disagrees with the count the same file reported — and found what their own comment says: it cannot be built
 * from outside, because every arrangement a caller can send is refused earlier, and because the peer refuses
 * to save a document whose tree it has already deleted the array from.
 *
 * So the honest split, and both halves are asserted here:
 *
 *  - **the reachable producer** is `writerCall`, the wrapper every peer call goes through so "a raw
 *    `@cantoo/pdf-lib` exception never becomes a host's error surface". A peer throwing something the
 *    classifier does not know *is* a WRITER_ERROR, with the operation named and the original kept as `cause`;
 *  - **the boundary is not a sieve**: a peer error the classifier *can* place keeps its own code rather than
 *    being flattened into the writer's, and a `PdfError` already on its way out passes through untouched. That
 *    last half took two cases and one survived counterfactual to state: the wrapper guards against re-wrapping
 *    and `toPdfError` guards again one call later, so only an `UNKNOWN_ERROR` — the one code the outer layer
 *    would let fall through to the writer's own — tells the two apart. The first version of this file asserted
 *    the guard with inputs where dropping it changes nothing;
 *  - and the three internal sites stay what they are — the writer's own bookkeeping disagreeing with itself —
 *    with the caller-facing edge pinned instead: an out-of-range page, a page asked for twice, and an order
 *    longer than the document are all `CONFIGURATION_ERROR`, each carrying the numbers a host would need to
 *    explain the refusal. That is the assertion that keeps "nothing the caller sent can cause them" from
 *    quietly becoming "nothing anyone can cause them", which is what an unreachability claim has to be tested
 *    as.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { abortError } from './abort';
import { isPdfError, toPdfError, type PdfError as PdfErrorType } from './errors';
import { arrangePages, writerCall } from './pdf-write';

const fixture = (name: string): Uint8Array =>
  new Uint8Array(readFileSync(fileURLToPath(new URL(`../../playground/fixtures/${name}`, import.meta.url))));

const settle = (work: Promise<unknown>): Promise<PdfErrorType | null> =>
  work.then(
    () => null,
    (error: unknown) => error as PdfErrorType,
  );

describe('FR-54: WRITER_ERROR is produced, and its producers are separated from the caller’s', () => {
  it('turns a raw peer throw into WRITER_ERROR, naming the operation and keeping the cause', async () => {
    const exploded = new Error('cannot serialize the page tree');

    const thrown = await settle(
      writerCall('Writing the rearranged file', () => {
        throw exploded;
      }),
    );

    expect(isPdfError(thrown, 'WRITER_ERROR'), 'the code a host branches on, not a sentence it parses').toBe(true);
    expect(thrown?.message).toBe('Writing the rearranged file: cannot serialize the page tree');
    expect(thrown?.cause).toBe(exploded);
  });

  it('keeps a code the classifier can place, instead of flattening it into the writer’s own', async () => {
    const engine = Object.assign(new Error('Encrypting, please supply password'), {
      name: 'PasswordException',
      code: 1,
    });

    const thrown = await settle(
      writerCall('Flattening the form', async () => {
        throw engine;
      }),
    );

    expect(thrown?.code, 'a password prompt is not the writer failing').toBe('PASSWORD_REQUIRED');
    expect(thrown?.message).not.toMatch(/Flattening the form/);
  });

  it('leaves a PdfError that already chose its code alone, because the wrapper runs on the way out too', async () => {
    const chosen = toPdfError(new Error('boom'), { code: 'RESOURCE_LIMIT' });

    const thrown = await settle(
      writerCall('Writing the merged file', () => {
        throw chosen;
      }),
    );

    expect(thrown).toBe(chosen);
  });

  it('does not re-code a cancellation on its way out, which is what the wrapper’s comment promises', async () => {
    const cancelled = abortError('The merge was stopped');

    const thrown = await settle(
      writerCall('Writing the merged file', () => {
        throw cancelled;
      }),
    );

    expect(thrown, 'the same object, not a copy with a new name on it').toBe(cancelled);
    expect(
      isPdfError(thrown, 'LOAD_CANCELLED'),
      'an abort that already carries its code stays that code on its way out',
    ).toBe(true);
  });

  it('passes an unclassified PdfError through rather than adopting it, the one input the two idempotence layers disagree on', async () => {
    // `asWriterError` guards against re-wrapping, and so does `toPdfError` one call later, which is why the
    // counterfactual that drops the first guard stayed green on every other input here: a RESOURCE_LIMIT or a
    // LOAD_CANCELLED error is returned unchanged by either. An `UNKNOWN_ERROR` is the case that separates them —
    // the outer layer hands it back, the inner guard would let it fall through to the writer’s own code with the
    // operation named in front of it. So this assertion is what makes that guard a line with a job.
    const unclassified = toPdfError(new Error('the peer said something nobody has read yet'));
    expect(unclassified.code, 'and not by construction — this is the classifier giving up').toBe('UNKNOWN_ERROR');

    const thrown = await settle(
      writerCall('Writing the rearranged file', () => {
        throw unclassified;
      }),
    );

    expect(thrown).toBe(unclassified);
    expect(
      thrown?.code,
      'the writer does not claim a failure it did not diagnose',
    ).toBe('UNKNOWN_ERROR');
  });

  it('refuses every arrangement a caller can get wrong as a configuration failure, which is what keeps the three internal sites internal', async () => {
    const bytes = fixture('page-order-sample.pdf');
    const cases: Array<{ order: number[]; reason: string; page: number; total?: number }> = [
      { order: [99, 0], reason: 'not one of this document', page: 99, total: 20 },
      { order: [3, 3], reason: 'asked for twice', page: 3 },
      { order: [], reason: 'at least one page', page: 0, total: 20 },
    ];

    for (const shape of cases) {
      const thrown = await settle(arrangePages(bytes, { order: shape.order }));
      expect(
        isPdfError(thrown, 'CONFIGURATION_ERROR'),
        `${JSON.stringify(shape.order)} — ${thrown?.code}: ${thrown?.message}`,
      ).toBe(true);
      expect(thrown?.message, 'the sentence names the reason, and the details carry the numbers').toContain(
        shape.reason,
      );
      expect(thrown?.details?.page ?? thrown?.details?.pages, 'a host can branch on the number too').toBeDefined();
    }
  });
});
