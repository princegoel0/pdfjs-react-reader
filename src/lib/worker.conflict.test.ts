/**
 * FR-02 / FR-55: one worker configuration per JavaScript realm, and the conflict that happens
 * when a page asks for two.
 *
 * pdf.js keeps the worker URL in `GlobalWorkerOptions.workerSrc`, which is process-global by
 * design, so a second viewer configured with a different URL does not get its own worker — it
 * re-points the first one, and the page that pays is whichever scrolls in afterwards. The
 * requirement's answer is a `PdfError` coded `CONFIGURATION_ERROR` naming both origins; this
 * file measures the claim that decides it, and the hook test beside it measures who is told.
 *
 * The credential assertions are the ones to keep. A pre-signed worker URL carries its token in
 * the query string, and an error that quotes the URL puts that token into whatever log, banner
 * or support ticket the host has — which is §3.6's rule, applied to the one configuration value
 * most likely to be signed.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { isPdfError } from './errors';
import {
  __resetWorkerForTests,
  claimWorkerSrc,
  configuredWorkerSrc,
  configureWorker,
} from './worker';

const A = 'https://cdn.example.com/pdf.worker.min.mjs';
const B = 'https://files.other.example/pdf.worker.min.mjs';

afterEach(__resetWorkerForTests);

describe('the per-realm worker claim (FR-02)', () => {
  it('lets the first viewer have the realm', () => {
    const claim = claimWorkerSrc(A);
    expect(claim.ok).toBe(true);
  });

  it('reports the value pdf.js would use, which is this realm’s own engine default', () => {
    // Measured, because the design depends on it, and the value differs by realm: pdf.js ships
    // `'./pdf.worker.mjs'` in Node and `''` in a browser, assigning it from its own `isNodeJS`
    // (`worker.default.test.tsx` holds the Node row). The *relative* one is the interesting case for a
    // claim, because pdf.js resolves it against the page — so a conflict test on raw strings would see a
    // conflict where there is none. This file runs where the relative default is in force.
    expect(configuredWorkerSrc()).toBe('./pdf.worker.mjs');
    configureWorker(A);
    expect(configuredWorkerSrc()).toBe(A);
  });

  it('refuses a second URL and names both origins', () => {
    claimWorkerSrc(A);
    const second = claimWorkerSrc(B);
    expect(second.ok).toBe(false);
    const error = (second as { error: unknown }).error;
    expect(isPdfError(error, 'CONFIGURATION_ERROR')).toBe(true);
    const message = (error as { message: string }).message;
    expect(message).toContain('https://cdn.example.com');
    expect(message).toContain('https://files.other.example');
    expect((error as { details: Record<string, unknown> }).details).toEqual({
      problem: 'worker-conflict',
      requestedOrigin: 'https://files.other.example',
      activeOrigin: 'https://cdn.example.com',
    });
  });

  it('holds nothing when it refuses, so a rejected viewer cannot block the next one', () => {
    const first = claimWorkerSrc(A);
    expect(claimWorkerSrc(B).ok).toBe(false);
    expect(claimWorkerSrc(B).ok).toBe(false);
    // Releasing the first viewer's claim makes the second URL available — the refusal was a
    // refusal of *this moment*, not a quarantine.
    if (first.ok) first.release();
    expect(claimWorkerSrc(B).ok).toBe(true);
  });

  it('lets two viewers share one URL, and counts them', () => {
    const first = claimWorkerSrc(A);
    const second = claimWorkerSrc(A);
    expect(first.ok && second.ok).toBe(true);
    if (first.ok) first.release();
    // One of two holders has gone; the realm is still this URL's.
    expect(claimWorkerSrc(B).ok).toBe(false);
    if (second.ok) second.release();
    expect(claimWorkerSrc(B).ok).toBe(true);
  });

  it('releases once, so a double teardown cannot under-count the realm', () => {
    const claim = claimWorkerSrc(A);
    const other = claimWorkerSrc(A);
    expect(claim.ok && other.ok).toBe(true);
    if (claim.ok) {
      claim.release();
      claim.release();
    }
    expect(claimWorkerSrc(B).ok).toBe(false);
    if (other.ok) other.release();
    expect(claimWorkerSrc(B).ok).toBe(true);
  });

  it('keeps a signed worker URL’s token out of the error', () => {
    const signed = 'https://cdn.example.com/pdf.worker.min.mjs?sig=super-secret-token&exp=1';
    claimWorkerSrc(signed);
    const error = (claimWorkerSrc(B) as { error: { message: string; details: unknown } }).error;
    expect(error.message).not.toContain('super-secret-token');
    expect(error.message).not.toContain('pdf.worker.min.mjs');
    expect(JSON.stringify(error.details)).not.toContain('super-secret-token');
    // The origin is what identifies a worker configuration; everything past it is the credential.
    expect(error.message).toContain('https://cdn.example.com');
  });
});
