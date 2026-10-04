import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { isPdfError, type PdfError } from './errors';
import { normalizeSource, resolveSourceUrl } from './source';

const PDF_MAGIC_BASE64 = 'JVBERi0xLjQK'; // "%PDF-1.4\n"

const BASE = 'https://app.example/reports/index.html';

/**
 * A page to resolve a relative address against.
 *
 * The node project has no `document`, and FR-01 makes that matter: with no base there is nothing that turns
 * `/files/doc.pdf` into something fetchable, so the loader refuses it. Tests about relative sources install a
 * base; the base-less case is asserted on its own below rather than by leaving these to run in an
 * environment they do not describe.
 */
function withDocumentBase() {
  beforeEach(() => {
    Reflect.set(globalThis, 'document', { baseURI: BASE });
  });
  afterEach(() => {
    Reflect.deleteProperty(globalThis, 'document');
  });
}

describe('normalizeSource', () => {
  withDocumentBase();

  it('passes through http(s) URLs', async () => {
    const result = await normalizeSource('https://example.com/doc.pdf');
    expect(result).toEqual({ kind: 'url', url: 'https://example.com/doc.pdf' });
  });

  it('passes through relative and blob URLs', async () => {
    expect(await normalizeSource('/files/doc.pdf')).toEqual({ kind: 'url', url: '/files/doc.pdf' });
    expect(await normalizeSource('blob:https://example.com/uuid')).toMatchObject({ kind: 'url' });
  });

  it('treats a .pdf-suffixed string as a URL', async () => {
    expect(await normalizeSource('documents/report.pdf')).toMatchObject({ kind: 'url' });
    expect(await normalizeSource('report.pdf?token=abc')).toMatchObject({ kind: 'url' });
  });

  it('decodes data URIs into bytes', async () => {
    const result = await normalizeSource(`data:application/pdf;base64,${PDF_MAGIC_BASE64}`);
    expect(result.kind).toBe('data');
    if (result.kind === 'data') {
      expect(new TextDecoder().decode(result.data)).toBe('%PDF-1.4\n');
    }
  });

  it('decodes long base64 strings into bytes', async () => {
    const base64 = Buffer.from(`%PDF-1.4\n${'x'.repeat(200)}`).toString('base64');
    const result = await normalizeSource(base64);
    expect(result.kind).toBe('data');
    if (result.kind === 'data') {
      expect(new TextDecoder().decode(result.data.slice(0, 8))).toBe('%PDF-1.4');
    }
  });

  it('passes through Uint8Array and ArrayBuffer', async () => {
    const bytes = new Uint8Array([1, 2, 3]);
    expect(await normalizeSource(bytes)).toEqual({ kind: 'data', data: bytes });
    const result = await normalizeSource(bytes.buffer);
    expect(result.kind).toBe('data');
  });

  it('reads Blobs into bytes', async () => {
    const blob = new Blob([new Uint8Array([37, 80, 68, 70])], { type: 'application/pdf' });
    const result = await normalizeSource(blob);
    expect(result.kind).toBe('data');
    if (result.kind === 'data') {
      expect(Array.from(result.data)).toEqual([37, 80, 68, 70]);
    }
  });

  it('rejects unsupported types', async () => {
    const error = await normalizeSource(42 as unknown as string).catch((err: unknown) => err);
    expect(isPdfError(error, 'INVALID_SOURCE')).toBe(true);
  });

  // A string that is not recognisably a path used to be fetched as one, which
  // sends whatever the app's origin happens to serve there to the parser.
  it('refuses a bare word rather than fetching it', async () => {
    for (const src of ['report', 'the monthly report', 'C:\\docs\\report.pdf']) {
      const error = await normalizeSource(src).catch((err: unknown) => err);
      // FR-54: refused input carries a code as well as a sentence, so a host can react without matching
      // on wording it has no reason to trust.
      expect(isPdfError(error, 'INVALID_SOURCE')).toBe(true);
      expect((error as Error).message).toMatch(/Unrecognized PDF source/);
    }
  });

  it('still accepts paths without an extension', async () => {
    expect(await normalizeSource('./report')).toMatchObject({ kind: 'url' });
    expect(await normalizeSource('/files/1234')).toMatchObject({ kind: 'url', url: '/files/1234' });
    expect(await normalizeSource('//cdn.example.com/a.pdf')).toMatchObject({ kind: 'url' });
    expect(await normalizeSource('my-app://documents/a.pdf')).toMatchObject({ kind: 'url' });
  });
});

describe('normalizeSource with no document base (FR-01)', () => {
  /**
   * "Relative URLs resolve against the document base URL in a browser and are refused when no base URL
   * exists." A server render, a worker and a Node import are all the second half of that sentence, and the
   * honest failure is a refusal naming the missing base — not a request for `/files/doc.pdf` against whatever
   * origin the runtime happened to be standing on, which is what handing the string to the engine does.
   */
  it.each([
    '/files/doc.pdf',
    './relative/doc.pdf',
    '../up-one/doc.pdf',
    '//cdn.example.com/a.pdf',
    'documents/report.pdf',
    'report.pdf',
  ])('refuses the relative source %j', async (src) => {
    const error = await normalizeSource(src).catch((err: unknown) => err);
    expect(isPdfError(error, 'INVALID_SOURCE')).toBe(true);
    expect((error as Error).message).toMatch(/no document base URL/);
  });

  it('still accepts every source that does not need a base', async () => {
    expect(await normalizeSource('https://example.com/a.pdf')).toMatchObject({ kind: 'url' });
    expect(await normalizeSource('blob:https://example.com/uuid')).toMatchObject({ kind: 'url' });
    // A custom scheme is absolute on its own terms; nothing here resolves it against a page.
    expect(await normalizeSource('my-app://documents/a.pdf')).toMatchObject({ kind: 'url' });
    expect(await normalizeSource(new Uint8Array([1, 2, 3]))).toMatchObject({ kind: 'data' });
    expect(await normalizeSource(`data:application/pdf;base64,${PDF_MAGIC_BASE64}`)).toMatchObject({
      kind: 'data',
    });
  });
});

describe('allowedSources', () => {
  withDocumentBase();

  it('does not restrict anything when unset', async () => {
    const result = await normalizeSource('https://anyone.example/doc.pdf');
    expect(result).toMatchObject({ kind: 'url' });
  });

  it('accepts an origin or URL prefix', async () => {
    expect(
      await normalizeSource('https://cdn.example.com/a/b.pdf', {
        allowedSources: ['https://cdn.example.com'],
      }),
    ).toMatchObject({ kind: 'url' });
    expect(
      await normalizeSource('https://cdn.example.com/x/y.pdf', {
        allowedSources: ['https://cdn.example.com/x/'],
      }),
    ).toMatchObject({ kind: 'url' });
  });

  it('refuses a host that merely starts with an allowed one', async () => {
    await expect(
      normalizeSource('https://cdn.example.com.evil/a.pdf', {
        allowedSources: ['https://cdn.example.com'],
      }),
    ).rejects.toThrow(/allowedSources/);
  });

  it('binds a path entry to the page origin', async () => {
    expect(await normalizeSource('/files/a.pdf', { allowedSources: ['/files/'] })).toMatchObject({
      kind: 'url',
    });
    await expect(
      normalizeSource('https://evil.example/files/a.pdf', { allowedSources: ['/files/'] }),
    ).rejects.toThrow(/allowedSources/);
  });

  it('names the origin of a refused URL and never its signed query (FR-54)', async () => {
    const error = await normalizeSource(
      'https://cdn.example.com/pdfs/contract.pdf?st=SECRETTOKEN123&se=4100000000',
      { allowedSources: ['https://other.example'] },
    ).catch((err: unknown) => err);

    expect(isPdfError(error, 'SOURCE_NOT_ALLOWED')).toBe(true);
    // §3.6: credentials never travel in a public error. A pre-signed URL keeps its credential in the query
    // string, and this message is documented as safe to show a reader and to be logged by a host — so the
    // assertions that matter are the negative ones: the token *and* the path it authorises.
    expect((error as Error).message).toContain('https://cdn.example.com');
    expect((error as Error).message).not.toContain('SECRETTOKEN123');
    expect((error as Error).message).not.toContain('contract.pdf');
    expect((error as PdfError).details).toEqual({ origin: 'https://cdn.example.com' });
  });

  it('matches a relative source against the page, not the worker', async () => {
    expect(await normalizeSource('a.pdf', { allowedSources: ['/reports/'] })).toMatchObject({
      kind: 'url',
    });
    await expect(
      normalizeSource(resolveSourceUrl('a.pdf').replace('/reports/', '/other/'), {
        allowedSources: ['/reports/'],
      }),
    ).rejects.toThrow(/allowedSources/);
  });

  it('allows blob URLs only when asked, and anything under "*"', async () => {
    await expect(
      normalizeSource('blob:https://app.example/uuid', { allowedSources: ['/x/'] }),
    ).rejects.toThrow(/allowedSources/);
    expect(
      await normalizeSource('blob:https://app.example/uuid', { allowedSources: ['blob:'] }),
    ).toMatchObject({ kind: 'url' });
    expect(
      await normalizeSource('https://anyone.example/a.pdf', { allowedSources: ['*'] }),
    ).toMatchObject({ kind: 'url' });
  });

  it('leaves byte sources unrestricted', async () => {
    const bytes = new Uint8Array([1, 2, 3]);
    expect(await normalizeSource(bytes, { allowedSources: [] })).toEqual({
      kind: 'data',
      data: bytes,
    });
  });
});
