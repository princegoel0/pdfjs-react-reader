/*
 * FR-54's mapping table, applied to the engine's own classes rather than to stand-ins.
 *
 * `errors.test.ts` has always asserted the table — and it has always done it with `engineError()`, a plain
 * `Error` with `name` assigned. That is the right *key* (the map reads `name`, because `name` is the one part
 * of these objects that survives a worker hop) and it is not the engine: nothing in the suite proved that a
 * class pdf.js actually throws carries the name the table expects, or that the extra fields the codes depend
 * on — `PasswordException#code`, `ResponseException#status` and `#missing` — are where the map looks.
 *
 * So this file builds the real objects, from the legacy build the engine ships (the module-scope `DOMMatrix`
 * reference in the modern build is why Node needs `legacy`), and asks the table what a consumer would be told.
 * Three of these are the reason it is worth the round trip:
 *
 *  - `PasswordException` with code 1 is `PASSWORD_REQUIRED` and with code 2 `PASSWORD_INVALID` — the two
 *    branches a password UI has to look different, and the discriminator is a number on the engine's object
 *    that a stand-in could get wrong silently;
 *  - `ResponseException` carries `missing: true` for a `file:` path that resolved to nothing and a `status`
 *    for an HTTP failure, which is what separates `HTTP_ERROR` from `AUTH_ERROR` from `NETWORK_ERROR`;
 *  - `RenderingCancelledException` is `RENDER_CANCELLED` — and it is the code no consumer of this package can
 *    currently observe, because every site that catches it returns before reaching the wrapper (FR-36's rule
 *    that a cancellation is not an ordinary failure). The mapping is now proven; the reachability is a question
 *    for §3.6's published list rather than something to code around here.
 */
import { describe, expect, it } from 'vitest';

import { isPdfError, toPdfError } from './errors';

// The legacy build is the only one Node can import: the modern entry reads `DOMMatrix` at module scope.
const engine = await import('pdfjs-dist/legacy/build/pdf.mjs');

/**
 * The engine's classes, built the way the runtime builds them.
 *
 * The published `.d.ts` gives these constructors the engine's internal arity — `ResponseException` wants three
 * arguments and `RenderingCancelledException` types its second as a number — while what the map under test reads
 * is the runtime object: `name`, `status`, `missing`, `code`. So the classes are taken as plain constructors,
 * which keeps this file honest about the thing it is actually asserting (a real engine throw, not a stand-in).
 */
type EngineError = Error & { status?: number; missing?: boolean; code?: number };
const raise = (Constructor: unknown, ...args: unknown[]): EngineError =>
  new (Constructor as new (...constructors: unknown[]) => EngineError)(...args);

describe('FR-54: the engine’s own exceptions map to the published codes', () => {
  it('routes a real InvalidPDFException to PDF_PARSE_ERROR, keeping the engine’s object as the cause', () => {
    const thrown = new engine.InvalidPDFException('damaged header');
    const wrapped = toPdfError(thrown);

    expect(thrown.name).toBe('InvalidPDFException');
    expect(isPdfError(wrapped, 'PDF_PARSE_ERROR')).toBe(true);
    expect(wrapped.message).toBe('damaged header');
    expect(wrapped.cause).toBe(thrown);
  });

  it('tells a password that was never given apart from the wrong one, off the engine’s own code field', () => {
    const needed = toPdfError(new engine.PasswordException('encrypt me', 1));
    const wrong = toPdfError(new engine.PasswordException('encrypt me again', 2));

    expect(needed.code).toBe('PASSWORD_REQUIRED');
    expect(wrong.code, 'the second prompt is a different UI state, so it is a different code').toBe('PASSWORD_INVALID');
    expect(needed.details).toEqual({ engineCode: 1 });
  });

  it('reads the HTTP answer off ResponseException: missing file, 401, 500, nothing at all', () => {
    const cases: Array<[unknown, string]> = [
      [Object.assign(raise(engine.ResponseException, 'gone'), { missing: true }), 'HTTP_ERROR'],
      [Object.assign(raise(engine.ResponseException, 'no token'), { status: 401 }), 'AUTH_ERROR'],
      [Object.assign(raise(engine.ResponseException, 'forbidden'), { status: 403 }), 'AUTH_ERROR'],
      [Object.assign(raise(engine.ResponseException, 'server'), { status: 500 }), 'HTTP_ERROR'],
      [raise(engine.ResponseException, 'unreachable'), 'NETWORK_ERROR'],
    ];
    for (const [thrown, code] of cases) {
      expect(toPdfError(thrown).code, `${(thrown as Error).message} — status ${
        (thrown as { status?: number }).status
      }, missing ${Boolean((thrown as { missing?: boolean }).missing)}`).toBe(code);
    }
  });

  it('maps the two cancellations the engine throws, and names the render one for what it is', () => {
    expect(toPdfError(new engine.AbortException('stopped')).code).toBe('LOAD_CANCELLED');
    const render = toPdfError(raise(engine.RenderingCancelledException, 'cancelled', 'rendering'));
    expect(render.code).toBe('RENDER_CANCELLED');
    expect(isPdfError(render, 'RENDER_CANCELLED')).toBe(true);
  });

  it('keeps a code a path already chose, because the wrapper is idempotent', () => {
    const chosen = toPdfError(raise(engine.RenderingCancelledException, 'cancelled', 'rendering'));
    const again = toPdfError(chosen);

    expect(again).toBe(chosen);
    expect(again.code, 'a general wrapper must not downgrade a precise code on the way out').toBe(
      'RENDER_CANCELLED',
    );
  });
});
