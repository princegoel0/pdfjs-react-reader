import { describe, expect, it } from 'vitest';
import { normalizeSource } from './source';

const PDF_MAGIC_BASE64 = 'JVBERi0xLjQK'; // "%PDF-1.4\n"

describe('normalizeSource', () => {
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
    await expect(normalizeSource(42 as unknown as string)).rejects.toThrow(TypeError);
  });
});
