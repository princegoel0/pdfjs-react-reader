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

/** §3.6's initial vocabulary. Extensible, and no value here is ever reused for a different meaning. */
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
  'UNSUPPORTED_FEATURE',
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
 */
const CODE_BY_ENGINE_NAME: Record<string, PdfErrorCode> = {
  InvalidPDFException: 'PDF_PARSE_ERROR',
  MissingPDFException: 'PDF_PARSE_ERROR',
  XRefException: 'PDF_PARSE_ERROR',
  PasswordException: 'PASSWORD_REQUIRED',
  ResponseException: 'NETWORK_ERROR',
  AbortException: 'LOAD_CANCELLED',
  // The platform's own name, which is also what this package's `abortError` keeps on the instance so every
  // existing cancellation filter still matches it. A caller that knows better passes the code as a hint.
  AbortError: 'LOAD_CANCELLED',
  RenderingCancelledException: 'RENDER_CANCELLED',
  UnknownException: 'WORKER_ERROR',
  InvalidCanvasContext: 'WORKER_ERROR',
  NotImplementedException: 'UNSUPPORTED_FEATURE',
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
