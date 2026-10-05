/*
 * FR-36 on the indexing path — the one operation whose cancellation takes seconds rather than frames.
 *
 * `extractAllText` is also the only long loop in the package with no test of its own before this, which is
 * worth saying: the requirement to stop it is worth less than a test proving the stop is honoured per page
 * rather than checked once before a thousand-page walk.
 *
 * FR-54 adds the second half: the rejection carries `SEARCH_CANCELLED`, so a host that aborts the index and
 * the load at the same moment can tell the two rejections apart. `LOAD_CANCELLED` on this path would be the
 * collapse the code set exists to prevent.
 */
import { describe, expect, it, vi } from 'vitest';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import { extractAllText } from './search';
import { isAbortError } from './abort';
import { isPdfError } from './errors';

/** A document whose pages each contribute one word, so a partial index is observable. */
function fakeDoc(numPages: number, onPage?: (n: number) => void) {
  const items = (n: number) => [
    { str: `word${n}`, dir: 'ltr', transform: [1, 0, 0, 1, 0, 0], width: 40, height: 10 },
  ];
  return {
    numPages,
    getPage: async (n: number) => {
      onPage?.(n);
      return { getTextContent: async () => ({ items: items(n), styles: {} }) };
    },
  } as unknown as PDFDocumentProxy;
}

describe('extractAllText with a signal', () => {
  it('reads every page when nothing aborts it', async () => {
    const seen: number[] = [];
    const pages = await extractAllText(fakeDoc(3, (n) => seen.push(n)));
    expect(seen).toEqual([1, 2, 3]);
    expect(pages).toHaveLength(3);
  });

  it('stops at the page boundary after an abort, rather than finishing the document', async () => {
    const seen: number[] = [];
    const controller = new AbortController();
    // Aborted partway: the loop checks before each page, so it must not read past the abort.
    const doc = fakeDoc(50, (n) => {
      if (n === 4) controller.abort();
      seen.push(n);
    });

    let thrown: unknown = null;
    try {
      await extractAllText(doc, undefined, controller.signal);
      expect.unreachable('an aborted signal must stop the walk');
    } catch (error) {
      thrown = error;
    }
    expect(isAbortError(thrown)).toBe(true);
    // FR-54: the same error, carrying which operation was stopped.
    expect(isPdfError(thrown, 'SEARCH_CANCELLED')).toBe(true);
    expect(seen.length, 'no more than one page beyond the abort').toBeLessThanOrEqual(5);
    expect(seen.length, 'it must have done some work to prove the check is inside the loop').toBeGreaterThan(1);
  });

  it('refuses to start for a signal that already fired', async () => {
    const getPage = vi.fn();
    const doc = { numPages: 10, getPage } as unknown as PDFDocumentProxy;
    const controller = new AbortController();
    controller.abort();

    await expect(extractAllText(doc, undefined, controller.signal)).rejects.toSatisfy(isAbortError);
    expect(getPage, 'an aborted caller must not touch the worker').not.toHaveBeenCalled();
  });

  it('reports progress as it goes, which the abort must not erase', async () => {
    const fractions: number[] = [];
    const pages = await extractAllText(fakeDoc(4), (f) => fractions.push(f));
    expect(pages).toHaveLength(4);
    expect(fractions.at(-1)).toBe(1);
  });
});

/*
 * FR-04's last clause, at the one call site that had it backwards: "preserve the `AbortSignal` reason where
 * the platform provides one". A host that aborts with a reason has said something — why it stopped — and a
 * cancellation that arrives as our generic sentence has thrown that away on the way past the boundary. The
 * name still has to be `AbortError`, because that is what every cancellation filter in the package and in
 * hosts reads, and the code still has to say which operation stopped.
 */
describe('the reason a host aborted with survives (FR-04)', () => {
  const refused = () => {
    const controller = new AbortController();
    controller.abort(new Error('reader navigated away'));
    return controller.signal;
  };

  it('carries the host’s own message, its cause, and the code of the operation that stopped', async () => {
    const getPage = vi.fn();
    const doc = { numPages: 10, getPage } as unknown as PDFDocumentProxy;
    const thrown = await extractAllText(doc, undefined, refused()).catch((error: unknown) => error);

    expect(isPdfError(thrown)).toBe(true);
    const error = thrown as { message: string; code: string; cause: unknown; name: string };
    expect(error.message).toBe('reader navigated away');
    expect(error.code).toBe('SEARCH_CANCELLED');
    expect(error.cause).toBeInstanceOf(Error);
    expect((error.cause as Error).message).toBe('reader navigated away');
    expect(
      error.name,
      'a reason that survives must not arrive wearing a name no filter looks for',
    ).toBe('AbortError');
    expect(isAbortError(error)).toBe(true);
    expect(getPage).not.toHaveBeenCalled();
  });

  it('takes a bare string reason too, and keeps the generic sentence for no reason at all', async () => {
    const stringed = new AbortController();
    stringed.abort('indexing is not needed any more');
    const silent = new AbortController();
    silent.abort();
    const doc = { numPages: 2, getPage: vi.fn() } as unknown as PDFDocumentProxy;

    const withReason = await extractAllText(doc, undefined, stringed.signal).catch((e: unknown) => e);
    expect((withReason as Error).message).toBe('indexing is not needed any more');

    const without = await extractAllText(doc, undefined, silent.signal).catch((e: unknown) => e);
    expect(
      (without as Error).message,
      'a platform reason with nothing in it is not a message worth forwarding',
    ).toBe('Text indexing was aborted.');
    expect((without as { code: string }).code).toBe('SEARCH_CANCELLED');
  });

  it('does not mistake the platform’s own AbortError for a host’s reason', async () => {
    // `abort()` with no argument yields a DOMException named AbortError; re-wrapping its message would
    // put the platform's sentence where the operation's own sentence belongs.
    const doc = { numPages: 2, getPage: vi.fn() } as unknown as PDFDocumentProxy;
    const controller = new AbortController();
    controller.abort(new DOMException('The operation was aborted.', 'AbortError'));

    const thrown = await extractAllText(doc, undefined, controller.signal).catch((e: unknown) => e);
    expect((thrown as Error).message).toBe('Text indexing was aborted.');
    expect((thrown as { code: string }).code).toBe('SEARCH_CANCELLED');
  });
});
