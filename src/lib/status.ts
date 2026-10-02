/*
 * FR-37: the two state models of `PRD.md` §3.5, published as types.
 *
 * The package used to hand back the fields — `doc`, `isReady`, `error`, `page` — and leave a consumer to
 * assemble them into a state machine by hand, which is how "is it loading or did it fail quietly?" becomes
 * three nullable checks that can disagree. These unions make the machine the public surface. The earlier
 * revision of the PRD declined them on the grounds that an enum would restate the fields; the target spec
 * asks for them anyway, and the fields are now *derived from* the state rather than sitting beside it, so
 * they still cannot disagree — `PdfDocumentLoad` below is that state, and `doc`, `isReady` and `error` are
 * read off it.
 *
 * Types only, no runtime: importing this module emits nothing, so publishing the models costs no bytes.
 */
import type { PDFDocumentProxy } from 'pdfjs-dist';
import type { PdfError } from './errors';

/**
 * Why the engine is asking for a credential. `incorrect-password` is the re-prompt: the first request is
 * `need-password`, and a wrong answer asks again with this reason (FR-03).
 */
export type PasswordReason = 'need-password' | 'incorrect-password';

/**
 * Resolves the pending password request: pass the password, or an `Error` to abort loading — pdf.js
 * rejects the loading task with it, which is how a cancel fails the load cleanly instead of hanging it.
 */
export type PasswordSubmit = (password: string | Error) => void;

/** The document lifecycle, exactly as §3.5 names it. */
export type PdfDocumentStatus =
  | 'idle'
  | 'loading'
  | 'password-required'
  | 'ready'
  | 'cancelled'
  | 'error'
  | 'destroyed';

/**
 * One page's render lifecycle, exactly as §3.5 names it.
 *
 * `unrequested` is the one state a page never reports, because a page that has not been asked for is not
 * mounted: it is what `usePdfVirtualizer`'s `virtualSlots` say it *isn't*. Everything from `queued` onward
 * comes from `PdfPage`'s `onStatusChange`. A zoom step produces `released → rendering → rendered`, and a
 * cancellation is never an error — that is FR-04's rule, restated as a state rather than as a callback
 * contract.
 */
export type PdfPageStatus =
  | 'unrequested'
  | 'queued'
  | 'rendering'
  | 'rendered'
  | 'cancelled'
  | 'released'
  | 'error';

/** A pending credential request, as the document state carries it. */
export interface PdfPasswordRequest {
  reason: PasswordReason;
  /**
   * Answers the request and moves the load back to `loading`. Submitting an `Error` fails the load, which
   * is what a dismissed prompt should do — leaving the request open would hang the document.
   *
   * Answer it from a decision a person made. The engine re-asks as soon as it is given a wrong password,
   * in the same microtask chain: measured at ~27,000 `incorrect-password` asks a second when the answer is
   * supplied synchronously from the callback itself, because nothing ever yields to the event loop. A
   * prompt waiting for a keystroke cannot do that; an automated retry of a stored credential can.
   */
  submit: PasswordSubmit;
}

/** The document handle plus the status that owns it, as one tagged value. */
export type PdfDocumentLoad =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'password-required'; request: PdfPasswordRequest }
  | { status: 'ready'; doc: PDFDocumentProxy }
  /**
   * The consumer stopped it — an `AbortSignal` they hold, or the password prompt dismissed. Terminal, and
   * deliberately **not** an error: nothing reached `onError`, because the reader asked for this. That
   * distinction is FR-04's, and this arm is where it stops being a comment and becomes a type — a host
   * cannot render a failure banner out of a state that carries no error.
   */
  | { status: 'cancelled' }
  | { status: 'error'; error: PdfError }
  | { status: 'destroyed' };
