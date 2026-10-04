/*
 * FR-35: bounded retries, and the classification that makes them safe.
 *
 * Retrying a load is only harmless if the failure is one that can heal. A 503 from a restarting origin
 * can; a 401 cannot, and retrying it turns one denied request into several — which is how a permission
 * problem becomes a rate-limit problem and then an account lockout. So the classifier is the point of
 * this module and the backoff is the easy half.
 *
 * The engine reports a failed fetch as `ResponseException`, which carries the HTTP `status` and a
 * `missing` flag it sets for 404 (and for a `file:` URL that resolved to nothing). A connection that
 * never got a response arrives as the same class with `status: 0`, which is why 0 is treated as
 * transient for http and as missing for file.
 */
/**
 * The three 4xx that mean "ask me again later". Every other 4xx is a decision the server made about
 * *this* request and will make again; every 5xx is the origin failing to answer, which can heal.
 *
 * Written as a rule rather than as two lists of numbers on purpose: a list has to be extended by whoever
 * next meets a status it does not contain, and the safe default for an unknown status is already the one
 * this falls through to. 521/522/524 (an origin a CDN cannot reach) are covered by the 5xx range without
 * being named, and 418 and 451 are refused without being named either.
 */
const RETRYABLE_4XX = new Set([408, 425, 429]);

export const DEFAULT_RETRY_POLICY = {
  attempts: 3,
  baseDelayMs: 1_000,
  maxDelayMs: 30_000,
  jitter: true,
} as const;

export interface RetryPolicy {
  /** Total attempts including the first, so `1` disables retrying. Defaults to 3. */
  attempts?: number;
  /** First backoff interval in ms, before jitter. Defaults to 1_000. */
  baseDelayMs?: number;
  /** Ceiling on any single interval in ms. Defaults to 30_000. */
  maxDelayMs?: number;
  /**
   * Spread attempts out instead of synchronising them. Defaults to true, and should stay on: a fleet of
   * browsers that all retry one second after the same origin blip is what keeps the origin down.
   */
  jitter?: boolean;
}

export interface RetryVerdict {
  retry: boolean;
  /** HTTP status when the engine reported one, otherwise null. */
  status: number | null;
  /** Why, in words a log line can carry. */
  reason: string;
}

/**
 * Reported after every failed attempt that was worth retrying, including the last, so a host can say
 * "retrying (2 of 3)" instead of showing a spinner that implies the first attempt is still running — and can
 * say "gave up" when there is no attempt left. Carries the engine's own error untouched: the status and the
 * reason are ours, the message is not, and a host logging it should log what actually happened.
 *
 * Deliberately not reported when the failure is not transient (a 401, a corrupt file). That attempt is not
 * part of a retry story, and the failure reaches the host through the error channel with its code instead.
 */
export interface RetryAttemptInfo {
  /** The attempt that just failed, 1-based. */
  attempt: number;
  /** Total attempts allowed, so a host can render "n of m". */
  attempts: number;
  /**
   * Whether another attempt is coming. `false` on the last one, which is reported for the same reason the
   * others are: a host that heard about attempt one and two and then hears nothing cannot tell an exhausted
   * retry from a hung request, and those want different things on screen.
   */
  willRetry: boolean;
  /** How long we wait before the next attempt; `0` when there is no next one. */
  delayMs: number;
  status: number | null;
  reason: string;
  error: Error;
}

/**
 * Whether a load failure is worth another attempt. Deliberately conservative: anything not positively
 * identified as transient is not retried, because the cost of an extra attempt on a permanent failure is
 * latency the reader waits through, while the cost of retrying an auth failure lands on the origin.
 *
 * Errors are matched by `name` rather than by `instanceof`. pdf.js's `BaseException` sets it, and it is
 * the part that survives the worker boundary, where the class identity does not — so a name check covers
 * both a reconstructed error and one that crossed a realm.
 */
export function classifyLoadError(error: unknown): RetryVerdict {
  const name = error instanceof Error ? error.name : '';

  // Our own cancellation, and a load superseded by a newer one. Never a failure to retry.
  if (name === 'AbortException' || name === 'RenderingCancelledException') {
    return { retry: false, status: null, reason: 'cancelled' };
  }
  // A corrupt file does not become parseable, and an encrypted one is waiting on a password rather
  // than on the network — the password path is a callback, not an error.
  if (name === 'InvalidPDFException') {
    return { retry: false, status: null, reason: 'the document is not a readable PDF' };
  }
  if (name === 'PasswordException') {
    return { retry: false, status: null, reason: 'the document is encrypted' };
  }
  if (name !== 'ResponseException') {
    return { retry: false, status: null, reason: 'an unclassified failure' };
  }

  const { status, missing } = error as { status?: unknown; missing?: unknown };
  const code = typeof status === 'number' ? status : null;
  if (missing === true) {
    return { retry: false, status: code, reason: 'the document was not found' };
  }
  // No response at all: DNS, connection refused, offline, or a preflight that never landed.
  if (code === 0 || code === null) {
    return { retry: true, status: code, reason: 'no response reached us' };
  }
  if (code === 401 || code === 403) {
    return { retry: false, status: code, reason: 'the server refused our credentials' };
  }
  if (code >= 500 || RETRYABLE_4XX.has(code)) {
    return { retry: true, status: code, reason: `the server answered ${code}` };
  }
  return { retry: false, status: code, reason: `the server answered ${code}` };
}

/**
 * Exponential backoff with full jitter: a uniform draw over `[0, min(ceiling, base × 2^n)]`. Full jitter
 * rather than equal jitter because it is what stops a thousand browsers that all failed at the same
 * instant from all arriving again at the same instant.
 *
 * `random` is injectable so a test can assert the bound instead of a sample from it.
 */
export function backoffDelay(
  attempt: number,
  policy: RetryPolicy = {},
  random: () => number = Math.random,
): number {
  const { baseDelayMs, maxDelayMs, jitter } = { ...DEFAULT_RETRY_POLICY, ...policy };
  const exponent = Math.max(0, attempt - 1);
  // `2 ** 30` caps the shift so a nonsense attempt count cannot produce Infinity.
  const grown = baseDelayMs * 2 ** Math.min(exponent, 30);
  const capped = Math.min(maxDelayMs, grown);
  if (!jitter) return capped;
  return Math.round(capped * random());
}

/** Resolve `attempts` against the default, treating 0 and negatives as "one try, no retry". */
export function resolveAttempts(policy: RetryPolicy = {}): number {
  const attempts = policy.attempts ?? DEFAULT_RETRY_POLICY.attempts;
  return Number.isFinite(attempts) ? Math.max(1, Math.floor(attempts)) : 1;
}
