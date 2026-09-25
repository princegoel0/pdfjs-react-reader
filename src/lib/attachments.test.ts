import { describe, expect, it } from 'vitest';
import { attachmentMimeType, normalizeAttachments } from './attachments';

const bytes = (text: string) => new TextEncoder().encode(text);

describe('normalizeAttachments', () => {
  it('reads pdf.js 6, where getAttachments() is a Map of metadata', () => {
    const map = new Map([
      ['notes.txt', { rawFilename: 'notes.txt', filename: 'notes.txt', description: 'A note' }],
      ['data.csv', { rawFilename: 'data.csv', filename: 'data.csv', description: '' }],
    ]);
    expect(normalizeAttachments(map)).toEqual([
      { id: 'data.csv', filename: 'data.csv' },
      { id: 'notes.txt', filename: 'notes.txt', description: 'A note' },
    ]);
  });

  it('reads pdf.js 5, where it is a plain object carrying the bytes inline', () => {
    // 5.x has no getAttachmentContent(), so the content only ever reaches us here.
    const content = bytes('quarter,revenue\n');
    expect(normalizeAttachments({ 'data.csv': { filename: 'data.csv', description: 'Two rows', content } })).toEqual([
      { id: 'data.csv', filename: 'data.csv', description: 'Two rows', content },
    ]);
  });

  it('falls back to rawFilename then to the key for a name', () => {
    expect(normalizeAttachments({ 'a.txt': { rawFilename: '/tmp/a.txt' } })).toEqual([
      { id: 'a.txt', filename: '/tmp/a.txt' },
    ]);
    expect(normalizeAttachments({ 'b.txt': {} })).toEqual([{ id: 'b.txt', filename: 'b.txt' }]);
  });

  it('sorts by file name without depending on the map order', () => {
    const map = new Map([
      ['z', { filename: 'zeta.txt' }],
      ['a', { filename: 'Alpha.txt' }],
      ['m', { filename: 'mid.txt' }],
    ]);
    expect(normalizeAttachments(map).map((file) => file.filename)).toEqual([
      'Alpha.txt',
      'mid.txt',
      'zeta.txt',
    ]);
  });

  it('does not claim an empty content came with the entry', () => {
    // An empty byte array is pdf.js saying "no /EF", not "here is a zero-length file".
    expect(normalizeAttachments({ 'x.txt': { filename: 'x.txt', content: new Uint8Array(0) } })).toEqual([
      { id: 'x.txt', filename: 'x.txt' },
    ]);
  });

  it('tolerates a document with no attachments and junk in the map', () => {
    expect(normalizeAttachments(undefined)).toEqual([]);
    expect(normalizeAttachments(null)).toEqual([]);
    expect(normalizeAttachments({})).toEqual([]);
    expect(normalizeAttachments(new Map([['x', null], ['y', 'not an object']]))).toEqual([
      { id: 'x', filename: 'x' },
      { id: 'y', filename: 'y' },
    ]);
  });
});

describe('attachmentMimeType', () => {
  it('maps the extensions a fixture actually carries', () => {
    expect(attachmentMimeType('report.pdf')).toBe('application/pdf');
    expect(attachmentMimeType('notes.txt')).toBe('text/plain');
    expect(attachmentMimeType('DATA.CSV')).toBe('text/csv');
  });

  it('leaves an unknown or absent extension to the browser', () => {
    expect(attachmentMimeType('archive.rar')).toBeUndefined();
    expect(attachmentMimeType('LICENSE')).toBeUndefined();
    expect(attachmentMimeType('.env')).toBeUndefined();
  });
});
