/*
 * FR-54: `PRD.md` §3.6's error contract, and the rule that keeps it a contract.
 *
 * The point of a stable code is that a host may branch on it forever, which makes the *list* part of the
 * published surface. So the first test here reads the vocabulary out of `PRD.md` itself rather than
 * restating it: a code added to the module and not the specification, or renamed in either, fails here with
 * the two sides named. That is the only way a list like this stays honest — an in-test copy of the same
 * eleven words proves nothing except that someone typed them twice.
 *
 * The rest of the file is the two things that make the code usable rather than decorative: the mapping from
 * what the engine actually throws (which is where every failure in this package begins) to the code a host
 * sees, and the guarantee that wrapping never destroys the engine's own diagnosis — `cause` and `message`
 * both survive, because a support ticket needs "byte 4193 of object 27 is not a dictionary", not
 * "PDF_PARSE_ERROR".
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  describeOrigin,
  isCancellationCode,
  isPdfError,
  isPdfErrorCode,
  PDF_ERROR_CODES,
  PdfError,
  toPdfError,
} from './errors';
import { ABORT_ERROR_NAME, abortError, cancellationFrom, throwIfAborted } from './abort';

/** The §3.6 block, parsed from the specification rather than from memory of it. */
function codesInPrd(): string[] {
  const text = readFileSync(join(process.cwd(), 'PRD.md'), 'utf8');
  const block = /### 3\.6 Error contract[\s\S]*?```text\n([\s\S]*?)```/.exec(text)?.[1];
  if (block === undefined) {
    throw new Error('PRD.md no longer has a §3.6 error-code block in the shape this test reads');
  }
  return block.split('\n').map((line) => line.trim()).filter(Boolean);
}

/** A stand-in for pdf.js's `ResponseException`, which carries `status` and `missing` beside the name. */
function engineError(name: string, extra: Record<string, unknown> = {}): Error {
  const error = new Error(`${name} from the engine`);
  error.name = name;
  return Object.assign(error, extra);
}

describe('the published vocabulary', () => {
  it('is exactly the list PRD.md §3.6 prints, in the order it prints it', () => {
    expect(codesInPrd()).toEqual([...PDF_ERROR_CODES]);
  });

  it('names each code once, because a reused code is a broken promise, not a shorter list', () => {
    expect(new Set(PDF_ERROR_CODES).size).toBe(PDF_ERROR_CODES.length);
  });

  it('rejects a code from outside itself rather than inventing a sixth state', () => {
    expect(isPdfErrorCode('NETWORK_ERROR')).toBe(true);
    expect(isPdfErrorCode('TIMEOUT')).toBe(false);
    expect(isPdfErrorCode(undefined)).toBe(false);
  });

  it('carries a code, a message, details and the original error, and is an Error', () => {
    const cause = engineError('InvalidPDFException');
    const error = new PdfError('PDF_PARSE_ERROR', 'the file is not a PDF', {
      cause,
      details: { page: 3 },
    });
    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe('PdfError');
    expect(error.code).toBe('PDF_PARSE_ERROR');
    expect(error.details).toEqual({ page: 3 });
    expect(error.cause).toBe(cause);
    // The engine's sentence is not lost behind ours: it is one property deeper, where a host that wants the
    // diagnosis can reach it and a host that wants the code never has to look.
    expect(error.message).toBe('the file is not a PDF');
  });
});

describe('isPdfError', () => {
  it('recognises the shape rather than the instance, because errors cross realms in this package', () => {
    // A worker-reconstructed or second-copy error is still exactly what the host is asking about, and
    // `instanceof` would say otherwise. This object was not built by the class anywhere in this module.
    const reconstructed = Object.create(Error.prototype) as Error & { code: string };
    reconstructed.name = 'PdfError';
    reconstructed.message = 'crossed a boundary';
    reconstructed.code = 'SOURCE_NOT_ALLOWED';
    expect(isPdfError(reconstructed, 'SOURCE_NOT_ALLOWED')).toBe(true);
    expect(reconstructed).not.toBeInstanceOf(PdfError);
  });

  it('refuses a plain Error, a wrong code, and an object that only looks the part', () => {
    expect(isPdfError(new Error('nope'))).toBe(false);
    expect(isPdfError(new PdfError('AUTH_ERROR', 'no'), 'NETWORK_ERROR')).toBe(false);
    expect(isPdfError({ name: 'PdfError', code: 'NOT_A_CODE' })).toBe(false);
    expect(isPdfError(null)).toBe(false);
    expect(isPdfError('AUTH_ERROR')).toBe(false);
    // A §3.6 code alone is not enough: Node's own errors carry a `code`, and a bare option bag carrying one
    // of our words is a coincidence, not a failure we published.
    expect(isPdfError({ code: 'NETWORK_ERROR' })).toBe(false);
    const nodeStyle = Object.assign(new Error('getaddrinfo failed'), { code: 'ENOTFOUND' });
    expect(isPdfError(nodeStyle)).toBe(false);
  });

  it('reads an abort by its code even though its name is the platform\'s', () => {
    // The case the name check used to fail: FR-04 wants a cancellation identifiable by type *and* still
    // wearing `AbortError`, so the name cannot be what marks one of ours as ours.
    const platformShaped = Object.assign(new Error('The operation was aborted.'), { name: 'AbortError' });
    expect(isPdfError(platformShaped)).toBe(false);
    expect(isPdfError(abortError('stopped by scroll-out'))).toBe(true);
  });
});

describe('cancellation is a code, not a failure', () => {
  it('names exactly the three codes the lifecycle produces', () => {
    expect(PDF_ERROR_CODES.filter(isCancellationCode)).toEqual([
      'LOAD_CANCELLED',
      'RENDER_CANCELLED',
      'SEARCH_CANCELLED',
    ]);
    expect(isCancellationCode('UNKNOWN_ERROR')).toBe(false);
  });

  it('keeps the platform name on an abort, because every cancellation filter here and in hosts reads it', () => {
    const error = abortError('stopped by scroll-out', 'RENDER_CANCELLED');
    expect(error.name).toBe(ABORT_ERROR_NAME);
    expect(isPdfError(error, 'RENDER_CANCELLED')).toBe(true);
    expect(error.code).toBe('RENDER_CANCELLED');
  });

  it('preserves the reason a host aborted with, which is the clause FR-04 asks for', () => {
    const controller = new AbortController();
    controller.abort(new Error('the reader navigated away'));
    const error = cancellationFrom(controller.signal, 'LOAD_CANCELLED');
    expect(error.message).toBe('the reader navigated away');
    expect((error.cause as Error).message).toBe('the reader navigated away');
    expect(isPdfError(error, 'LOAD_CANCELLED')).toBe(true);
  });

  it('accepts a string reason too, and falls back to the generic sentence when there is nothing to carry', () => {
    const withText = new AbortController();
    withText.abort('cancelled by test harness');
    expect(cancellationFrom(withText.signal, 'SEARCH_CANCELLED').message).toBe('cancelled by test harness');

    const plain = new AbortController();
    plain.abort();
    const fallback = cancellationFrom(plain.signal, 'LOAD_CANCELLED', 'the load was superseded');
    expect(fallback.message).toBe('the load was superseded');
    expect(cancellationFrom(undefined, 'LOAD_CANCELLED').message).toBe('The operation was aborted.');
  });

  it('throws from throwIfAborted with the code the caller named', () => {
    const controller = new AbortController();
    controller.abort();
    expect(() => throwIfAborted(controller.signal, undefined, 'SEARCH_CANCELLED')).toThrow(
      /The operation was aborted/,
    );
    try {
      throwIfAborted(controller.signal, undefined, 'SEARCH_CANCELLED');
      expect.unreachable('an aborted signal must throw');
    } catch (error) {
      expect(isPdfError(error, 'SEARCH_CANCELLED')).toBe(true);
    }
    expect(() => throwIfAborted(new AbortController().signal)).not.toThrow();
    expect(() => throwIfAborted(undefined)).not.toThrow();
  });
});

describe('toPdfError: the engine vocabulary mapped onto ours', () => {
  it('codes a corrupt file and a parse failure alike, keeping the byte-level message reachable', () => {
    const parsed = toPdfError(engineError('InvalidPDFException'));
    expect(parsed.code).toBe('PDF_PARSE_ERROR');
    expect((parsed.cause as Error).message).toBe('InvalidPDFException from the engine');
  });

  it('tells a first password request from a wrong one, which is the pair FR-03 turns into UI', () => {
    expect(toPdfError(engineError('PasswordException', { code: 1 })).code).toBe('PASSWORD_REQUIRED');
    expect(toPdfError(engineError('PasswordException', { code: 2 })).code).toBe('PASSWORD_INVALID');
  });

  it('separates no-response from refused-credentials from an origin that answered badly', () => {
    expect(toPdfError(engineError('ResponseException', { status: 0, missing: false })).code).toBe(
      'NETWORK_ERROR',
    );
    expect(toPdfError(engineError('ResponseException', { status: 401 })).code).toBe('AUTH_ERROR');
    expect(toPdfError(engineError('ResponseException', { status: 403 })).code).toBe('AUTH_ERROR');
    expect(toPdfError(engineError('ResponseException', { status: 503 })).code).toBe('HTTP_ERROR');
    // `missing` is how the engine reports 404, and a 404 answered is not a connection that never answered.
    expect(toPdfError(engineError('ResponseException', { status: 404, missing: true })).code).toBe(
      'HTTP_ERROR',
    );
    expect(toPdfError(engineError('ResponseException', { status: 404 })).details).toEqual({ status: 404 });
  });

  it('reads a worker that cannot start as a worker failure, and anything unrecognised as unknown', () => {
    // The engine's own catch-all: `wrapReason` folds any reason it does not model into this one, so a worker
    // that says something unexpected arrives named, and #242 is the reason it now reads as WORKER_ERROR rather
    // than as the wrapper's shrug.
    expect(toPdfError(engineError('UnknownErrorException')).code).toBe('WORKER_ERROR');
    expect(toPdfError(new Error('something with no name at all')).code).toBe('UNKNOWN_ERROR');
    expect(toPdfError('a thrown string').message).toBe('a thrown string');
  });

  it('refuses to invent a code for a name the engine does not stamp', () => {
    // The five names here are the ones this table used to carry keys for. None of them is stamped by any
    // shipped `pdfjs-dist` bundle in the peer range — measured over 6.2.108, 6.3.289 and 6.4.299 — so a row
    // for one is a branch that can only be exercised by a test that makes the object up. `NotImplemented` was
    // the case that mattered: it was the *only* claimed producer of a published code, and §3.6 advertised
    // that code to every host on the strength of it.
    for (const name of [
      'NotImplementedException',
      'MissingPDFException',
      'XRefException',
      'UnknownException',
      'InvalidCanvasContext',
    ]) {
      expect(toPdfError(engineError(name)).code, `${name} is not an engine name`).toBe('UNKNOWN_ERROR');
    }
  });

  it('never re-wraps a PdfError, so a precise code chosen deep down survives the trip out', () => {
    const specific = new PdfError('RESOURCE_LIMIT', 'the print job needs 41 pages fewer');
    expect(toPdfError(specific)).toBe(specific);
    expect(toPdfError(specific, { code: 'UNKNOWN_ERROR' })).toBe(specific);
  });

  it('lets a caller name the code when the engine could not say which operation stopped', () => {
    expect(toPdfError(engineError('AbortException'), { code: 'LOAD_CANCELLED' }).code).toBe('LOAD_CANCELLED');
    expect(toPdfError(new Error('worker missing'), { code: 'WORKER_ERROR' }).code).toBe('WORKER_ERROR');
  });
});

describe('describeOrigin', () => {
  it('returns the origin of a signed URL and none of its credential', () => {
    const signed = 'https://cdn.example.com/pdfs/contract.pdf?st=SECRETTOKEN123&se=4100000000';
    expect(describeOrigin(signed)).toBe('https://cdn.example.com');
    expect(describeOrigin(signed)).not.toContain('SECRETTOKEN123');
  });

  it('says so when there is no origin to name, rather than echoing the input it could not parse', () => {
    expect(describeOrigin('report')).toBe('an unparseable URL');
    expect(describeOrigin('')).toBe('an unparseable URL');
  });
});
