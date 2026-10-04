/*
 * FR-25 at the engine boundary: the file a document hides in an annotation.
 *
 * The requirement's last sentence is the one that is easy to satisfy by accident — "a file carried by an
 * annotation rather than named in the name tree is listed and saved the same way". This package enumerates
 * `getAttachments()` and stops there, so on a document where the engine has already folded both kinds into that
 * one map, the clause reads as met while nothing in the repository has looked at such a file. `attachments-
 * ocg-sample.pdf` has carried one since `0.5` and was wired into no test, which is the whole of the gap.
 *
 * So the assertions are made against the real file, through the real engine, in the entry point Node can
 * actually load — and they are made in the order the requirement lists them:
 *
 * - the annotation's file is **listed**, beside the three the catalog names;
 * - its description comes with it, because the clause says *with their descriptions* and a paperclip's `/Desc`
 *   is the only thing telling a reader what the file is;
 * - it is **saved the same way** as the others: one call, one id, the bytes the author put in;
 * - and nothing is prefetched: listing four files must read zero contents, which is the difference between a
 *   4 KB attachment list and a document that holds its whole payload in memory to label one.
 *
 * The premise itself is pinned last, at the byte level. If somebody later moves that filespec into the catalog's
 * `/EmbeddedFiles` tree — a perfectly reasonable edit to a fixture — the test would go on passing while
 * measuring nothing, so it also asserts that the name tree does *not* name this file.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { getDocument, type PDFDocumentProxy } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { describe, expect, it, vi } from 'vitest';
import {
  collectAnnotationAttachments,
  mergeAttachments,
  normalizeAttachments,
  type AttachmentInfo,
} from './attachments';

const FIXTURE = 'attachments-ocg-sample.pdf';
/** The file that hangs off the `FileAttachment` annotation rather than the catalog's name tree. */
const CARRIED = 'note-from-page-2.txt';
const CARRIED_BODY = 'This file hangs off a FileAttachment annotation, not the catalog.';
/** The three the catalog does name, so "listed as well as" has something to be listed beside. */
const NAMED = ['data.csv', 'notes.txt', 'report.pdf'];

function bytes(): Uint8Array {
  return new Uint8Array(readFileSync(join(process.cwd(), 'playground', 'fixtures', FIXTURE)));
}

function source(): string {
  return latin(bytes());
}

const latin = (data: Uint8Array): string => String.fromCharCode(...data);

async function open(): Promise<PDFDocumentProxy> {
  return getDocument({ data: bytes(), verbosity: 0 }).promise;
}

/** What the product lists: the catalog's files and the pages' files, merged the way `usePdfAttachments` does. */
async function listFiles(doc: PDFDocumentProxy): Promise<AttachmentInfo[]> {
  return mergeAttachments(
    normalizeAttachments(await doc.getAttachments()),
    await collectAnnotationAttachments(doc),
  );
}

describe('a file carried by an annotation (FR-25)', () => {
  it('is listed, with its description, in the same list as the catalog’s own', async () => {
    const doc = await open();
    const files = await listFiles(doc);
    const names = files.map((file) => file.filename);

    // All four, in one list: the three named files and the one the page carries.
    expect(names).toEqual(expect.arrayContaining([...NAMED, CARRIED]));
    expect(files).toHaveLength(4);

    const carried = files.find((file) => file.filename === CARRIED);
    expect(carried?.description, 'the annotation’s /Desc did not survive the list').toBe(
      'Carried by an annotation, not the name tree',
    );
    // The id is what `getAttachmentContent` takes, so a carried file has to be addressable by name like any
    // other — a list entry a host cannot ask the content for is a row that cannot be saved.
    expect(carried?.id).toBeTruthy();
    await doc.cleanup();
  });

  it('is saved the same way: the same call, and the bytes the author put in', async () => {
    const doc = await open();
    const files = await listFiles(doc);
    const carried = files.find((file) => file.filename === CARRIED);
    if (!carried) throw new Error('the carried file left the list, so there is nothing to save');

    const content = await doc.getAttachmentContent(carried.id);
    if (!content) throw new Error('the engine answered with nothing for a file the document lists');
    expect(latin(new Uint8Array(content))).toBe(CARRIED_BODY);

    // And a named file answers identically: one code path, no per-kind branch.
    const named = files.find((file) => file.filename === 'notes.txt');
    if (!named) throw new Error('the name-tree files left the list');
    const namedBytes = await doc.getAttachmentContent(named.id);
    expect(namedBytes?.byteLength ?? 0).toBeGreaterThan(0);
    await doc.cleanup();
  });

  it('lists without reading: no content is fetched to label the set', async () => {
    const doc = await open();
    const content = vi.spyOn(doc, 'getAttachmentContent');

    const files = await listFiles(doc);
    expect(files).toHaveLength(4);
    expect(content, 'listing the attachments read their bytes, which is the prefetch the clause forbids').not
      .toHaveBeenCalled();
    // 6.x hands back metadata only; a `content` field on a listed entry would mean the whole payload arrived.
    for (const file of files) expect(file.content).toBeUndefined();

    content.mockRestore();
    await doc.cleanup();
  });

  it('and the premise holds: the name tree does not name that file', () => {
    /*
     * Read off the bytes rather than the engine, because this is the assertion that keeps the three above
     * honest: it is what says the file is *annotation-carried* at all. The catalog's `/EmbeddedFiles` array
     * names three specs; the fourth lives inside the `FileAttachment` annotation's inline `/FS`.
     */
    const text = source();
    const embedded = /\/EmbeddedFiles\s*<<\s*\/Names\s*\[([^\]]*)\]/.exec(text);
    expect(embedded, 'the fixture lost its /EmbeddedFiles name tree').not.toBeNull();
    expect(embedded?.[1]).toContain('notes.txt');
    expect(embedded?.[1]).not.toContain(CARRIED);
    expect(text).toContain('/Subtype /FileAttachment');
    expect(text).toContain(CARRIED);
  });
});
