/*
 * FR-35's classifier, tested per status rather than per category.
 *
 * The asymmetry is the whole point: retrying a transient failure costs the reader a little latency, while
 * retrying a refused credential costs the origin several requests it already said no to. So the "never"
 * column has to be exhaustive and the "retry" column has to be narrow, and a status nobody thought about
 * must land on the safe side.
 */
import { InvalidPDFException, PasswordException, ResponseException } from 'pdfjs-dist';
import { describe, expect, it } from 'vitest';
import { backoffDelay, classifyLoadError, resolveAttempts } from './retry';

const response = (status: number, missing = status === 404) =>
  new ResponseException(`Unexpected server response (${status})`, status, missing);

/** An engine error whose class identity did not survive the worker boundary — only `name` did. */
const named = (name: string, message = 'from the worker') => {
  const err = new Error(message);
  err.name = name;
  return err;
};

describe('classifyLoadError: never retried', () => {
  it.each([400, 401, 403, 404, 405, 410, 415, 422])('refuses a %i', (status) => {
    expect(classifyLoadError(response(status)).retry).toBe(false);
  });

  it('names a credential refusal specifically, because that is the one a host will log', () => {
    expect(classifyLoadError(response(401))).toMatchObject({
      retry: false,
      status: 401,
      reason: 'the server refused our credentials',
    });
    expect(classifyLoadError(response(403)).reason).toBe('the server refused our credentials');
  });

  it('treats a missing document as permanent, including a file: URL that resolved to nothing', () => {
    expect(classifyLoadError(response(404))).toMatchObject({ retry: false, reason: 'the document was not found' });
    expect(classifyLoadError(new ResponseException('not found', 0, true)).retry).toBe(false);
  });

  it('does not retry a status nobody classified, which is the safe side to fall on', () => {
    expect(classifyLoadError(response(418)).retry).toBe(false);
    expect(classifyLoadError(response(451)).retry).toBe(false);
  });

  it('does not retry a corrupt document, an encrypted one, or our own cancellation', () => {
    expect(classifyLoadError(new InvalidPDFException('bad xref')).retry).toBe(false);
    expect(classifyLoadError(new PasswordException('needs a password', 1)).retry).toBe(false);
    expect(classifyLoadError(named('AbortException')).retry).toBe(false);
    expect(classifyLoadError(named('RenderingCancelledException')).retry).toBe(false);
  });

  it('does not retry an error it cannot classify at all', () => {
    expect(classifyLoadError(new TypeError('something else entirely'))).toMatchObject({
      retry: false,
      reason: 'an unclassified failure',
    });
    expect(classifyLoadError('a string, not an error').retry).toBe(false);
  });
});

describe('classifyLoadError: retried', () => {
  it.each([408, 425, 429, 500, 502, 503, 504, 521, 522, 524])('retries a %i', (status) => {
    expect(classifyLoadError(response(status))).toMatchObject({ retry: true, status });
  });

  it('retries a request that never got a response, which is how offline and DNS failure arrive', () => {
    expect(classifyLoadError(new ResponseException('network', 0, false))).toMatchObject({
      retry: true,
      status: 0,
      reason: 'no response reached us',
    });
  });

  it('classifies by name when the class did not cross the worker boundary', () => {
    const err = named('ResponseException', 'Unexpected server response (503)');
    // No `status` survives either, so it lands on the no-response branch rather than guessing.
    expect(classifyLoadError(err)).toMatchObject({ retry: true, status: null });
  });
});

describe('backoffDelay', () => {
  it('grows exponentially and stops at the ceiling', () => {
    const noJitter = { jitter: false, baseDelayMs: 250, maxDelayMs: 5_000 };
    expect(backoffDelay(1, noJitter)).toBe(250);
    expect(backoffDelay(2, noJitter)).toBe(500);
    expect(backoffDelay(3, noJitter)).toBe(1_000);
    expect(backoffDelay(4, noJitter)).toBe(2_000);
    expect(backoffDelay(5, noJitter)).toBe(4_000);
    expect(backoffDelay(6, noJitter)).toBe(5_000);
    expect(backoffDelay(40, noJitter)).toBe(5_000);
  });

  it('applies full jitter: a draw inside the bound, never above it', () => {
    const policy = { baseDelayMs: 1_000, maxDelayMs: 5_000, jitter: true };
    expect(backoffDelay(1, policy, () => 0)).toBe(0);
    expect(backoffDelay(1, policy, () => 0.5)).toBe(500);
    expect(backoffDelay(1, policy, () => 1)).toBe(1_000);
    expect(backoffDelay(3, policy, () => 1)).toBe(4_000);
    // The bound, not a sample: over many draws nothing may exceed the capped interval.
    for (let i = 0; i < 200; i++) {
      const drawn = backoffDelay(9, policy, Math.random);
      expect(drawn).toBeGreaterThanOrEqual(0);
      expect(drawn).toBeLessThanOrEqual(5_000);
    }
  });

  it('survives a nonsense attempt count instead of producing Infinity', () => {
    expect(Number.isFinite(backoffDelay(1e9, { jitter: false }))).toBe(true);
  });
});

describe('resolveAttempts', () => {
  it('defaults to three, floors a fraction, and treats zero or less as one try', () => {
    expect(resolveAttempts()).toBe(3);
    expect(resolveAttempts({})).toBe(3);
    expect(resolveAttempts({ attempts: 5 })).toBe(5);
    expect(resolveAttempts({ attempts: 2.7 })).toBe(2);
    expect(resolveAttempts({ attempts: 0 })).toBe(1);
    expect(resolveAttempts({ attempts: -4 })).toBe(1);
    expect(resolveAttempts({ attempts: Number.NaN })).toBe(1);
  });
});
