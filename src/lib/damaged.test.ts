/*
 * The load-failure half of `PRD.md`'s error-handling promise.
 *
 * Nothing in this suite had ever asked pdf.js to open a broken file: the fixtures were generated, the
 * UI states were written, and the behaviour was assumed. So this file loads the two damaged fixtures
 * through the real engine and asserts what it actually does — including the case where it does *not*
 * fail, because a reader deserves to know that a corrupted xref still shows pages while a short file
 * shows an error.
 *
 * The good fixture is loaded first on purpose. A test that only ever sees rejections cannot tell a
 * damaged file apart from a harness that cannot load anything at all.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { describe, expect, it } from 'vitest';

const fixture = (name: string): Uint8Array =>
  new Uint8Array(readFileSync(join(process.cwd(), 'playground', 'fixtures', name)));

// Only the bytes are passed: the extra options the spike used are not part of the typed
// `DocumentInitParameters` in this engine version, and none of them decide whether a damaged file is
// rejected — which is the question this file asks.
const load = (bytes: Uint8Array) => getDocument({ data: bytes }).promise;

describe('damaged documents', () => {
  it('loads the whole fixture, so a rejection below means damage and not a broken harness', async () => {
    const doc = await load(fixture('outline-sample.pdf'));
    expect(doc.numPages).toBe(3);
    const page = await doc.getPage(1);
    expect(page.view[2]).toBeGreaterThan(0);
    await doc.cleanup();
  });

  it('refuses a file that stops mid-stream, with the message the viewer shows', async () => {
    await expect(load(fixture('damaged-truncated.pdf'))).rejects.toThrow(/Invalid PDF structure/);
  });

  it('names the failure the way pdf.js names it, so the UI does not invent a category', async () => {
    const error = await load(fixture('damaged-truncated.pdf')).then(
      () => null,
      (caught: unknown) => caught,
    );
    expect(error).toBeInstanceOf(Error);
    expect((error as { name: string }).name).toBe('InvalidPDFException');
  });

  /*
   * The counterfactual, and the reason both fixtures exist. A wrong `startxref` in an otherwise complete
   * file is *recoverable*: pdf.js re-indexes the objects, warns about it, and hands back the pages.
   * Asserting only the rejecting case would let a change that made every damaged file fatal pass as
   * "error handling works".
   */
  it('recovers from a broken xref and still reports its pages', async () => {
    const doc = await load(fixture('damaged-xref.pdf'));
    expect(doc.numPages).toBe(3);
    await doc.cleanup();
  });

  it('keeps the two damage kinds distinguishable at the byte level', () => {
    const whole = fixture('outline-sample.pdf');
    const truncated = fixture('damaged-truncated.pdf');
    const badXref = fixture('damaged-xref.pdf');
    expect(truncated.length).toBeLessThan(whole.length);
    expect(badXref.length).toBe(whole.length);
    expect(Buffer.from(truncated).toString('latin1')).not.toContain('startxref');
    expect(Buffer.from(badXref).toString('latin1')).toContain('startxref');
  });

  /*
  /*
   * `normalizeSource` hands a `Uint8Array` straight to pdf.js, and a Node `Buffer` is one — so it passes
   * the boundary check and pdf.js then refuses it outright. Recorded here rather than fixed: a browser
   * host rarely holds a Buffer, no document promises one, and silently copying every byte array to
   * satisfy an engine preference is not a trade to make without the owner. What this test does is stop
   * anyone claiming "bytes just work".
   *
   * It throws on the call rather than rejecting the promise, which matters for the hook: the rejection
   * path in `usePdfDocument` is what an `await` sees, so a synchronous throw has to be inside the same
   * `try` — which it is (`usePdfDocument.ts:154`).
   */
  it('is refused by the engine when the bytes arrive as a Buffer, and refuses on the call', () => {
    const asBuffer = Buffer.from(fixture('outline-sample.pdf'));
    expect(() => load(asBuffer as unknown as Uint8Array)).toThrow(/Uint8Array/);
  });
});
