/*
 * FR-40, the claim that makes a published index worth publishing: the shape survives the trip.
 *
 * `buildTextIndex` and the viewer's own extraction share `buildPageText`, so this file cannot prove that two
 * implementations agree — it proves the thing the host actually needs, which is that the published
 * `{text, itemEnds}` pair is *sufficient*: nothing a mark is placed from lives in the `items` array that gets
 * left behind, and an index that has been through JSON on the way here still names the same spans the viewer
 * finds in the document it loaded. That is measured by round-tripping the index through JSON before searching
 * it, because a host that ships this format over a network gets exactly that serialisation.
 *
 * The items that make it non-trivial are the ones with nothing in them. Measured on the fixtures: the first
 * page of `tagged-sample.pdf` hands back eleven items of which five are empty strings, and asking for marked
 * content takes that to twenty-three, twelve of them `{type: 'beginMarkedContentProps'}`-style boundaries
 * with no `str` at all. Both kinds are what `buildPageText` skips, so a host that turns marked content on and
 * a host that leaves it off publish the same coordinates — which is the third test here, because the first
 * two would pass even if it didn't.
 *
 * The second block measures the other half: what extraction cannot see at all. It exists so that FR-39's
 * "invalidates only what changed" can be stated as a cache rule rather than as a promise that a value somebody
 * typed will turn up in a search.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { getDocument, type PDFDocumentProxy } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { describe, expect, it } from 'vitest';
import {
  buildTextIndex,
  extractPageText,
  findPageMatches,
  planFind,
  validateTextIndex,
  type ExternalTextIndex,
  type PageMatch,
  type TextItemLike,
} from './search';

const RESOLVED = { caseSensitive: false, wholeWord: false, regex: false };

async function open(name: string): Promise<PDFDocumentProxy> {
  const bytes = new Uint8Array(readFileSync(join(process.cwd(), 'playground', 'fixtures', name)));
  return getDocument({ data: bytes, verbosity: 0 }).promise;
}

/** What a host does: read the items, publish them, never see the viewer's cache. */
async function publishIndex(
  doc: PDFDocumentProxy,
  options: { markedContent?: boolean; naively?: boolean } = {},
): Promise<ExternalTextIndex> {
  const pages: TextItemLike[][] = [];
  for (let pageNumber = 1; pageNumber <= doc.numPages; pageNumber++) {
    const page = await doc.getPage(pageNumber);
    // The raw array, unfiltered — a host that pre-filters items here has changed the coordinate space
    // it is publishing into.
    const content = options.markedContent
      ? await page.getTextContent({ includeMarkedContent: true })
      : await page.getTextContent();
    if (options.naively) {
      // The mistake being measured: every item coerced to have a `str`, so nothing is dropped and every
      // offset after the first boundary shifts by one item.
      pages.push(
        content.items.map((item) => ({
          str: 'str' in item ? item.str : '',
          hasEOL: 'hasEOL' in item ? item.hasEOL : false,
        })),
      );
      continue;
    }
    pages.push(content.items as TextItemLike[]);
  }
  return buildTextIndex(pages);
}

/** Matches straight out of a published index, in document order. */
function matchesFromIndex(index: ExternalTextIndex, query: string): PageMatch[] {
  const plan = planFind(query, RESOLVED);
  if (plan.error) throw new Error(plan.error);
  const flat: PageMatch[] = [];
  for (const [pageIndex, page] of index.pages.entries()) {
    for (const match of findPageMatches({ items: [], text: page.text, itemEnds: page.itemEnds }, plan)) {
      match.pageIndex = pageIndex;
      flat.push(match);
    }
  }
  return flat;
}

/** Matches from the path the viewer takes: its own extraction, its own cache. */
async function matchesFromDocument(doc: PDFDocumentProxy, query: string): Promise<PageMatch[]> {
  const plan = planFind(query, RESOLVED);
  if (plan.error) throw new Error(plan.error);
  const flat: PageMatch[] = [];
  for (let pageIndex = 0; pageIndex < doc.numPages; pageIndex++) {
    const page = await extractPageText(doc, pageIndex);
    for (const match of findPageMatches(page, plan)) {
      match.pageIndex = pageIndex;
      flat.push(match);
    }
  }
  return flat;
}

describe('a published index and the viewer agree', () => {
  const cases = [
    { file: 'page-order-sample.pdf', queries: ['MARKER', 'display slot', 'of 20', 'Box 612 by 792', 'e'] },
    { file: 'tagged-sample.pdf', queries: ['report', 'Quarterly report', 'twelve per cent', 'a'] },
  ];

  for (const { file, queries } of cases) {
    it(`${file}: every query returns the same matches from both paths`, async () => {
      const doc = await open(file);
      // The host's index, on the way through the only transport that matters here: what a server can send
      // and a browser can hand to the viewer is what JSON survives.
      const index = JSON.parse(JSON.stringify(await publishIndex(doc))) as ExternalTextIndex;
      expect(validateTextIndex(index, doc.numPages).error).toBeNull();

      for (const query of queries) {
        const published = matchesFromIndex(index, query);
        const extracted = await matchesFromDocument(doc, query);
        expect(published.length, `nothing matched ${query}, so this proves nothing`).toBeGreaterThan(0);
        expect(published, `index and document disagree about ${query}`).toEqual(extracted);
      }
    });
  }

  it('does not depend on whether the host asked for marked content', async () => {
    const doc = await open('tagged-sample.pdf');
    const plain = await publishIndex(doc);
    const marked = await publishIndex(doc, { markedContent: true });
    // The boundary objects have no text of their own and no offset of their own, so publishing them
    // changes nothing the viewer will ever read.
    expect(marked.pages).toEqual(plain.pages);

    // The counterfactual, so the line above is not vacuous: a host that flattens a boundary into an empty
    // string keeps the text identical and moves every item index, which is a mark on the wrong span.
    const flattened = await publishIndex(doc, {
      markedContent: true,
      naively: true,
    });
    expect(flattened.pages).not.toEqual(plain.pages);
    const [page] = flattened.pages;
    if (!page) throw new Error('the fixture has no pages');
    expect(page.text).toBe(plain.pages[0]!.text);
    expect(page.itemEnds.length).toBeGreaterThan(plain.pages[0]!.itemEnds.length);
  });

  it('carries the offsets a mark is placed from, not just the page', async () => {
    const doc = await open('page-order-sample.pdf');
    const index = await publishIndex(doc);
    const [first] = matchesFromIndex(index, 'MARKER-03');
    if (!first) throw new Error('the fixture stopped saying MARKER-03');
    expect(first.beginOffset).toBe(0);
    expect(first.endOffset).toBe('MARKER-03'.length);
    // The item the index names really does hold the match — otherwise the highlight lands elsewhere.
    const page = await extractPageText(doc, first.pageIndex);
    expect(page.items[first.beginIdx]?.str.slice(first.beginOffset, first.endOffset)).toBe('MARKER-03');
  });
});

/*
 * The other half of the same question: what is the index *not* able to see.
 *
 * FR-39 promises that a re-index invalidates only what changed, which reads as though an edit changed
 * something. Measured here, on the fixtures the shell ships with, it does not: text extraction is the
 * content stream. A form field contributes its label and never the value a reader typed — not even after
 * that value is in `annotationStorage`, which is where the editor puts it and which `getTextContent()` is
 * not given. A sticky note's `/Contents` and a `/FreeText`'s text are likewise absent, which is measured the
 * same way — by looking for the strings the fixtures are known to carry. The consequence is stated in
 * `usePdfSearch.invalidatePages` and in the docs: nothing the reader types becomes searchable in this session,
 * and the shell does not pretend otherwise.
 */
describe('what the index cannot see', () => {
  const VALUE = 'Searchable?';

  it('reports a field label, not the value a reader typed into it', async () => {
    const doc = await open('form-sample.pdf');
    const page = await doc.getPage(1);
    const before = (await page.getTextContent()).items;
    expect(before.map((item) => ('str' in item ? item.str : '')).join(' ')).toContain('Full name:');

    const [field] = await page.getAnnotations({ intent: 'any' });
    if (!field?.id) throw new Error('the form fixture stopped carrying a widget');
    doc.annotationStorage.setValue(field.id, VALUE);

    // The value is in storage — that is where the editor puts it — and it is not in the page's text.
    expect(doc.annotationStorage.getRawValue(field.id)).toBe(VALUE);
    expect(matchesFromIndex(await publishIndex(doc), VALUE)).toEqual([]);
    expect((await extractPageText(doc, 0)).text).not.toContain(VALUE);
  });

  it('omits annotation text, which is drawn in a layer rather than set in the page', async () => {
    const doc = await open('annotated-sample.pdf');
    const first = await extractPageText(doc, 0);
    const second = await extractPageText(doc, 1);
    expect(first.text).not.toContain('Check the figures against the 2025 returns'); // /Text note, page 1
    expect(second.text).not.toContain('Inserted by a reader'); // /FreeText, page 2
    // The words really are in the file — this is a statement about extraction, not about the fixture.
    const raw = readFileSync(join(process.cwd(), 'playground', 'fixtures', 'annotated-sample.pdf'));
    const inFile = raw.toString('latin1');
    expect(inFile).toContain('/Contents (Check the figures against the 2025 returns)');
    expect(inFile).toContain('/Contents (Inserted by a reader)');
  });
});
