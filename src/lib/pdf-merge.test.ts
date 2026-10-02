/*
 * FR-42: merging two documents, and the one property every other decision here serves.
 *
 * A merge writes a third file. That is the requirement, not a detail — a reader who is trying something
 * out must not be able to lose a document by trying it — so the assertion that matters most in this file is
 * the boring one: the sources hash the same afterwards as they did before. Everything else (the order, the
 * repeated page, the refusal of a page that is not there) is the ordinary business of a writer.
 *
 * The pages are read back through pdf.js rather than through the writer that made them, because a tool
 * that agrees with itself proves nothing: `MARKER-NN is unique to this page` in `page-order-sample.pdf` is
 * the same oracle the reorder tests use, and it says which page actually landed in which slot.
 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { describe, expect, it } from 'vitest';
import { describeMergeSources, mergeDocuments, type MergeSource } from './pdf-merge';
import type { PdfError } from './errors';
import { isPdfError } from './errors';

const fixture = (name: string): Uint8Array =>
  new Uint8Array(readFileSync(join(process.cwd(), 'playground', 'fixtures', name)));

const hash = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');

/** Two documents that differ in size, page count and text, so a mix-up cannot hide. */
function sources(): [MergeSource, MergeSource] {
  return [
    { bytes: fixture('page-order-sample.pdf'), name: 'page-order-sample.pdf' },
    { bytes: fixture('tagged-sample.pdf'), name: 'tagged-sample.pdf' },
  ];
}

/** The words on one page of the output, read from the text layer rather than from the writer. */
async function pageText(bytes: Uint8Array, pageNumber: number): Promise<string> {
  const doc = await getDocument({ data: bytes.slice(), verbosity: 0 }).promise;
  const page = await doc.getPage(pageNumber);
  const content = await page.getTextContent();
  const text = content.items
    .map((item) => ('str' in item ? item.str : ''))
    .join(' ');
  const viewport = page.getViewport({ scale: 1 });
  return `${text} [${Math.round(viewport.width)}x${Math.round(viewport.height)}]`;
}

describe('merging documents', () => {
  it('writes a third file and leaves both sources byte-identical', async () => {
    const [first, second] = sources();
    const before = [hash(first.bytes), hash(second.bytes)];

    const result = await mergeDocuments({
      sources: [first, second],
      order: [
        { source: 0, page: 0 },
        { source: 1, page: 0 },
      ],
    });

    expect(result.bytes.length).toBeGreaterThan(0);
    expect(hash(first.bytes)).toBe(before[0]);
    expect(hash(second.bytes)).toBe(before[1]);
    // And the output is neither input: it is its own document.
    expect([hash(result.bytes)]).not.toEqual(expect.arrayContaining(before));
  });

  it('takes the pages it is told to, in the order it is told', async () => {
    const { bytes } = await mergeDocuments({
      sources: sources(),
      order: [
        { source: 0, page: 0 },
        { source: 1, page: 0 },
        { source: 0, page: 2 },
      ],
    });

    expect(await pageText(bytes, 1)).toMatch(/MARKER-01/);
    // The other document's page, in the middle: its own words and its own box, not the first's.
    const middle = await pageText(bytes, 2);
    expect(middle).toMatch(/Quarterly report/);
    expect(middle).not.toMatch(/MARKER/);
    expect(await pageText(bytes, 3)).toMatch(/MARKER-03/);
    // Page 3 of the first source is one of the fixture's landscape pages, and it arrived that way.
    expect(await pageText(bytes, 3)).toMatch(/\[792x612]/);
  });

  it('copies one page twice, which arranging inside a single document refuses', async () => {
    const { bytes, pages, taken } = await mergeDocuments({
      sources: sources(),
      order: [
        { source: 0, page: 0 },
        { source: 0, page: 0 },
        { source: 1, page: 1 },
      ],
    });

    expect(pages).toBe(3);
    expect(taken).toEqual([2, 1]);
    // Two slots, two separate page objects: the same words, and both still there after the second copy.
    expect(await pageText(bytes, 1)).toMatch(/MARKER-01/);
    expect(await pageText(bytes, 2)).toMatch(/MARKER-01/);
    expect(await pageText(bytes, 3)).toMatch(/612x792/);
  });

  it('refuses a page its source does not have, before writing anything', async () => {
    await expect(
      mergeDocuments({
        sources: sources(),
        order: [
          { source: 0, page: 0 },
          { source: 1, page: 9 },
        ],
      }),
    ).rejects.toThrow(/page 9 is not one of source 2's 2 pages/);
  });

  it('refuses an empty plan and an empty source list', async () => {
    await expect(mergeDocuments({ sources: sources(), order: [] })).rejects.toThrow(/at least one page/);
    await expect(
      mergeDocuments({ sources: [], order: [{ source: 0, page: 0 }] }),
    ).rejects.toThrow(/at least one document/);
  });

  /*
   * FR-54 on the merge entry. Every one of those refusals above is a plan the sources cannot satisfy, which
   * is the caller's instruction failing rather than the writer faulting, so each carries
   * `CONFIGURATION_ERROR` and the numbers behind it — a host that wants to say "your page list is out by
   * three" reads them off `details` instead of parsing the sentence.
   */
  it('codes the refusals rather than leaving them as prose', async () => {
    const capture = async (run: () => Promise<unknown>): Promise<unknown> => {
      try {
        await run();
      } catch (error) {
        return error;
      }
      throw new Error('the plan was expected to be refused');
    };

    const pastEnd = await capture(() =>
      mergeDocuments({ sources: sources(), order: [{ source: 1, page: 9 }] }),
    );
    expect(isPdfError(pastEnd, 'CONFIGURATION_ERROR')).toBe(true);
    expect((pastEnd as PdfError).details).toEqual({ page: 9, source: 1, pages: 2 });

    const noSources = await capture(() => mergeDocuments({ sources: [], order: [{ source: 0, page: 0 }] }));
    expect(isPdfError(noSources, 'CONFIGURATION_ERROR')).toBe(true);
    expect((noSources as PdfError).details).toEqual({ sources: 0 });

    // An abort is not a bad plan: the cancellation code the caller named has to survive the trip out.
    const controller = new AbortController();
    controller.abort();
    const stopped = await capture(() =>
      mergeDocuments({ sources: sources(), order: [{ source: 0, page: 0 }] }, { signal: controller.signal }),
    );
    expect(isPdfError(stopped, 'LOAD_CANCELLED')).toBe(true);
  });

  it('produces no bytes for a caller that stopped caring', async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(
      mergeDocuments(
        { sources: sources(), order: [{ source: 0, page: 1 }] },
        { signal: controller.signal },
      ),
    ).rejects.toThrow(/aborted/i);
  });

  it('reports what each source holds, which is what a picker needs first', async () => {
    expect(await describeMergeSources(sources())).toEqual([{ pages: 20 }, { pages: 2 }]);
  });
});
