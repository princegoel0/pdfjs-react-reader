/*
 * FR-54: `PRD.md` §3.6's error contract, as a published type.
 *
 * The package already distinguished its failure kinds — a cancelled load never reached `onError`, a corrupt
 * file classified differently from an auth refusal — but it did so with `error.name` strings and prose
 * reasons inside `RetryVerdict`. That is behaviour, not a contract: a host cannot branch on it without
 * matching on wording, and wording is the part a library is allowed to improve. A message that reads well in
 * an English release becomes a broken UI in the next one, and the host finds out at runtime.
 *
 * So the machine-readable half becomes the interface and the human half stays free to change. `code` is
 * what a host switches on; `message` is what a reader reads.
 *
 * Two decisions in here that are not obvious from the requirement:
 *
 *  - **The engine's error is preserved as `cause`, never replaced.** pdf.js's own messages name the byte
 *    offset, the missing object and the malformed dictionary, and a host's support ticket needs them. The
 *    wrapper adds a code; it does not edit the diagnosis.
 *  - **`isPdfError` matches §3.6's shape, not `instanceof` and not `name`.** An error that crossed a worker
 *    boundary or came from a second copy of this package in a monorepo fails `instanceof` while being exactly
 *    the thing the host asked about. And `name` cannot be the discriminator: FR-04 requires a cancellation to
 *    be identifiable by type *and* to keep carrying the platform's `AbortError` name, because every
 *    cancellation filter in this package and in hosts reads that name — so `abortError()` returns a
 *    `PdfError` named `AbortError`, and a guard requiring the class name would call it a non-error.
 *    A code from §3.6's list beside a message is the whole of what makes one of ours.
 */

/**
 * §3.6's vocabulary. Extensible, and no value here is ever reused for a different meaning.
 *
 * A name belongs here because something *produces* it: a call site in this package, or a class the installed
 * engine can deliver (see `CODE_BY_ENGINE_NAME`). `src/lib/error-codes.coverage.test.ts` holds that rule, which
 * is what took `UNSUPPORTED_FEATURE` out in #242 — its only claimed producer was a table row for an exception
 * class that exists in no shipped `pdfjs-dist`, so the name advertised a branch no object could ever reach.
 */
export const PDF_ERROR_CODES = [
  'INVALID_SOURCE',
  'NETWORK_ERROR',
  'HTTP_ERROR',
  'AUTH_ERROR',
  'PASSWORD_REQUIRED',
  'PASSWORD_INVALID',
  'LOAD_CANCELLED',
  'RENDER_CANCELLED',
  'SEARCH_CANCELLED',
  'WORKER_ERROR',
  'CONFIGURATION_ERROR',
  'RESOURCE_LIMIT',
  'SOURCE_NOT_ALLOWED',
  'ALREADY_SIGNED',
  'PDF_PARSE_ERROR',
  'WRITER_ERROR',
  'UNKNOWN_ERROR',
] as const;

export type PdfErrorCode = (typeof PDF_ERROR_CODES)[number];

/** The codes a host must not treat as a failure: the reader or the lifecycle asked for them. */
const CANCELLATION_CODES: readonly PdfErrorCode[] = ['LOAD_CANCELLED', 'RENDER_CANCELLED', 'SEARCH_CANCELLED'];

/**
 * A consumer-visible failure: a stable code, a message safe to put in front of a reader, the origin's own
 * diagnosis as `cause`, and structured details a host can render without parsing prose.
 *
 * Credentials never belong in any of the three. A signed URL's query string is a credential, so a source
 * refusal names the origin it rejected and nothing else — see `describeOrigin`.
 */
export class PdfError extends Error {
  readonly code: PdfErrorCode;
  readonly details: Record<string, unknown> | undefined;

  constructor(
    code: PdfErrorCode,
    message: string,
    options?: { cause?: unknown; details?: Record<string, unknown> },
  ) {
    super(message, 'cause' in (options ?? {}) ? { cause: options?.cause } : undefined);
    this.name = 'PdfError';
    this.code = code;
    this.details = options?.details;
  }
}

/**
 * Shape test rather than `instanceof`, for the reason in the header.
 *
 * A §3.6 code is the discriminator, and a string `message` is required alongside it: the pair is what
 * distinguishes one of ours from a plain `Error` that happens to carry a `code` (Node's do, and their values
 * are `ENOENT`-style names from outside this vocabulary). A host that rethrows with its own `name` and keeps
 * the code still matches, which is the point — the code is the contract.
 */
export function isPdfError(value: unknown, code?: PdfErrorCode): value is PdfError {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as { code?: unknown; message?: unknown };
  if (typeof candidate.message !== 'string') return false;
  if (!isPdfErrorCode(candidate.code)) return false;
  return code === undefined || candidate.code === code;
}

export function isPdfErrorCode(value: unknown): value is PdfErrorCode {
  return typeof value === 'string' && (PDF_ERROR_CODES as readonly string[]).includes(value);
}

/** Cancellation is the mechanism, not a defect: a fast scroller would otherwise see one error per frame. */
export function isCancellationCode(code: PdfErrorCode): boolean {
  return CANCELLATION_CODES.includes(code);
}

/**
 * Origin only, never the path or the query. A pre-signed URL carries its credential in the query string, so
 * `new URL(href).origin` is the whole of what is safe to say about a source that was refused — and when the
 * href will not parse there is no origin to name, which is itself the useful fact.
 */
export function describeOrigin(href: string): string {
  try {
    return new URL(href).origin;
  } catch {
    return 'an unparseable URL';
  }
}

/**
 * Name → code, for the errors pdf.js throws across its own boundary.
 *
 * Matched on `name` because that is the part that survives a worker hop: pdf.js rebuilds these from a
 * serialized payload, so the class identity is gone while `name` and the extra fields (`status`, `missing`,
 * `code`) are not. Anything not in here is `UNKNOWN_ERROR` — never a guess at something nearby.
 *
 * **The keys are the engine's own list, not a guess at it.** `wrapReason` in `build/pdf.mjs` is the function
 * that decides what crosses the boundary, and measured across 6.2.108, 6.3.289 and 6.4.299 it passes through
 * exactly five classes and rebuilds five names, folding *anything else* into `UnknownErrorException`:
 * `AbortException`, `InvalidPDFException`, `PasswordException`, `ResponseException`, `UnknownErrorException`.
 * Two more are stamped in the build but thrown on this side of it — `RenderingCancelledException` by
 * `RenderTask.cancel()`, and the platform's own `AbortError`, which this package keeps on the instance its
 * `abortError()` returns. That is the whole set, and `src/lib/error-codes.coverage.test.ts` reads the installed
 * engine and refuses a key outside it.
 *
 * What that gate removed is worth keeping in mind, because five of the eleven keys in this table's previous
 * shape could never have fired: `MissingPDFException`, `XRefException`, `UnknownException`,
 * `InvalidCanvasContext` and `NotImplementedException` are names no shipped bundle stamps (the first two and
 * the third are pdf.js 4/5 vocabulary that 6 replaced with `UnknownErrorException` and the `XRef*Exception`
 * family, which `wrapReason` rebuilds as `UnknownErrorException` anyway; the fourth was never thrown here at
 * all). Each was a branch that read like a diagnosis and was a comment. The fourth row down here is the one
 * they should have been: the engine's own catch-all, which reaches a host as `WORKER_ERROR` rather than as
 * `UNKNOWN_ERROR`, because "the worker said something the engine did not model" is exactly what that code
 * means.
 */
export const CODE_BY_ENGINE_NAME: Record<string, PdfErrorCode> = {
  InvalidPDFException: 'PDF_PARSE_ERROR',
  PasswordException: 'PASSWORD_REQUIRED',
  ResponseException: 'NETWORK_ERROR',
  AbortException: 'LOAD_CANCELLED',
  UnknownErrorException: 'WORKER_ERROR',
  // The platform's own name, which is also what this package's `abortError` keeps on the instance so every
  // existing cancellation filter still matches it. A caller that knows better passes the code as a hint.
  AbortError: 'LOAD_CANCELLED',
  /*
   * Real, stamped, and never produced by this package today: every call site that catches it returns before
   * reaching the wrapper, because FR-36 says a cancellation is not an ordinary failure and a page whose paint
   * was stopped by our own teardown reports `cancelled` through `onStatusChange` instead. It stays because the
   * engine *can* raise it — measured in Chromium, `task.cancel()` is the only way a render is cancelled, and
   * this is the code for the day that stops being true.
   */
  RenderingCancelledException: 'RENDER_CANCELLED',
};

/**
 * `PasswordResponses.INCORRECT_PASSWORD`, as the engine defines it. Inlined rather than imported so this
 * module stays dependency-free on purpose: the error vocabulary is the one thing that has to load before
 * anything else does, including on a server.
 */
const INCORRECT_PASSWORD = 2;

/**
 * Wrap whatever failed into the published shape. Idempotent: a `PdfError` that arrives here is returned
 * unchanged, so a path that already chose a precise code is never downgraded by a wrapper further out.
 */
export function toPdfError(cause: unknown, hint?: { code?: PdfErrorCode; message?: string }): PdfError {
  if (isPdfError(cause)) return cause;

  const error = cause instanceof Error ? cause : new Error(String(cause));
  const named = (error as { name?: string; code?: unknown; status?: unknown; missing?: unknown }).name ?? '';
  let code = CODE_BY_ENGINE_NAME[named];

  if (code === 'PASSWORD_REQUIRED' && (error as { code?: unknown }).code === INCORRECT_PASSWORD) {
    code = 'PASSWORD_INVALID';
  }
  if (code === 'NETWORK_ERROR') {
    const { status, missing } = error as { status?: unknown; missing?: unknown };
    // `missing` is the engine's own no-resource answer, including a `file:` path that resolved to nothing.
    if (missing === true) code = 'HTTP_ERROR';
    else if (status === 401 || status === 403) code = 'AUTH_ERROR';
    else if (typeof status === 'number' && status > 0) code = 'HTTP_ERROR';
    else code = 'NETWORK_ERROR';
  }

  const details: Record<string, unknown> = {};
  const status = (error as { status?: unknown }).status;
  if (typeof status === 'number') details.status = status;
  const engineCode = (error as { code?: unknown }).code;
  if (typeof engineCode === 'number') details.engineCode = engineCode;

  return new PdfError(hint?.code ?? code ?? 'UNKNOWN_ERROR', hint?.message ?? error.message, {
    cause: error,
    details: Object.keys(details).length ? details : undefined,
  });
}
