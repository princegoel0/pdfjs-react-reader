/*
 * FR-43 at the engine boundary: what a tagged document actually reports, and the keys that decide whether
 * the answer means anything.
 *
 * `tagged-sample.pdf` is the first file in `playground/fixtures/` that declares a structure tree — every
 * other one answers `null`, which is why the requirement could be argued about for two releases without
 * being measured. The roles come back as authored, the `Figure` carries its `/Alt`, and each leaf binds to
 * the mark it was drawn with.
 *
 * Two of those bindings are asserted separately, on purpose, because a file can pass either alone while
 * testing nothing. The tree half says `H1 → mc0` and is built from `/StructParents`, `/ParentTree` and each
 * element's `/Pg`; the content half says the page's stream opened a marked section with `MCID 0`, and is
 * built from the `BDC` operands. A `/StructElem` whose kid is an integer MCID is only paired with that mark
 * when the element also carries `/Pg` — strip it and the roles all still read back, the content bindings
 * simply vanish, and the tree looks like a tree (pdf.js's `parseKid` compares the element's page against the
 * page it is walking and returns `null` when it cannot tell; the spec lets a reader infer the page from
 * `/ParentTree`, this one does not). And a `BDC` with one operand instead of two is skipped with a console
 * warning while every other byte of the file keeps working, which is what the second test below now pins:
 * it was the browser pass, and not this file, that found the fixture had been written that way.
 *
 * A fixture that quietly lost either key would prove nothing while passing every assertion above it, so the
 * generator refuses to write one.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { getDocument, type PDFDocumentProxy, type PDFPageProxy } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { describe, expect, it } from 'vitest';

const fixture = (name: string): Uint8Array =>
  new Uint8Array(readFileSync(join(process.cwd(), 'playground', 'fixtures', name)));

function open(data: Uint8Array): Promise<PDFDocumentProxy> {
  return getDocument({ data, verbosity: 0 }).promise;
}

/**
 * Flatten the tree to `role/role/…` paths with the marks each leaf binds. The content ids pdf.js returns
 * are `p<object id>_mc<n>`, and the object number is the generator's allocation order rather than anything
 * about tagging, so only the `mc<n>` part is asserted.
 */
function walk(node: any, prefix = ''): string[] {
  const path = prefix ? `${prefix}/${node.role}` : String(node.role);
  const marks = node.children
    .filter((child: any) => child.type === 'content')
    .map((child: any) => String(child.id).replace(/^p\d+R_/, ''));
  const own = marks.length ? [`${path} → ${marks.join(',')}${node.alt ? ` (alt: ${node.alt})` : ''}`] : [];
  return [
    ...own,
    ...node.children
      .filter((child: any) => child.type === undefined)
      .flatMap((child: any) => walk(child, path)),
  ];
}

/** The mark ids the structure tree binds, in the order a walk from the root meets them. */
function treeMarks(node: any, ids: string[] = []): string[] {
  if (!node) return ids;
  for (const child of node.children ?? []) {
    if (child.type === 'content') ids.push(String(child.id).replace(/^p\d+R_/, ''));
    ids.push(...treeMarks(child));
  }
  return ids;
}

/**
 * The mark ids the page's own content stream opens, read the way a text layer reads them.
 *
 * `includeMarkedContent` is what makes the worker emit the section markers at all; without it the stream is
 * only the text runs, and a page built that way has no element for a tree to own.
 */
async function contentMarks(page: PDFPageProxy): Promise<string[]> {
  // The shipped type is a `ReadableStream` from the DOM lib, which has no async iterator on it; Node's does,
  // and this file runs in Node.
  const chunks = page.streamTextContent({ includeMarkedContent: true }) as unknown as AsyncIterable<{
    items: Array<{ str?: string; id?: string | number | null }>;
  }>;
  const ids: string[] = [];
  for await (const chunk of chunks) {
    for (const item of chunk.items) {
      if (item.id !== undefined && item.id !== null) {
        ids.push(String(item.id).replace(/^p\d+R_/, ''));
      }
    }
  }
  return ids;
}

/** The annotation ids the tree claims, wherever they sit in it. */
function treeAnnotations(node: any, ids: string[] = []): string[] {
  if (!node) return ids;
  for (const child of node.children ?? []) {
    if (child.type === 'annotation') ids.push(String(child.id));
    ids.push(...treeAnnotations(child));
  }
  return ids;
}

describe('a document that declares its structure', () => {
  it('reports the roles as authored, with every mark bound to its element', async () => {
    const doc = await open(fixture('tagged-sample.pdf'));
    expect(doc.numPages).toBe(2);

    const first = walk((await (await doc.getPage(1)).getStructTree()) as never);
    expect(first).toEqual([
      'Root/Document/H1 → mc0',
      'Root/Document/P → mc1',
      'Root/Document/L/LI → mc2',
      'Root/Document/L/LI → mc3',
      'Root/Document/L/LI → mc4',
      'Root/Document/P/Link → mc5',
    ]);

    const second = walk((await (await doc.getPage(2)).getStructTree()) as never);
    expect(second).toEqual([
      'Root/Document/Figure → mc0 (alt: A bar chart of revenue by region, north highest)',
      'Root/Document/Table/TR/TH → mc1',
      'Root/Document/Table/TR/TH → mc2',
      'Root/Document/Table/TR/TD → mc3',
      'Root/Document/Table/TR/TD → mc4',
    ]);
  });

  /*
   * The other half of the binding, and the half this file did not have: everything above is answered from
   * the structure tree alone, which never reads a content stream. A `BDC` written with one operand rather
   * than two is skipped with a console warning, the marks are never opened, and the tree still says exactly
   * what it said — so this is the assertion that fails on such a file, and it was the browser pass, not
   * this test, that found the fixture had been written that way.
   */
  it('opens the same marks in its content as its tree binds', async () => {
    const doc = await open(fixture('tagged-sample.pdf'));

    for (const pageNumber of [1, 2]) {
      const page = await doc.getPage(pageNumber);
      const bound = treeMarks((await page.getStructTree()) as never);
      expect(await contentMarks(page)).toEqual(bound);
    }
    // Both non-empty, because two ways of finding nothing agree just as readily as two ways of finding the
    // same thing.
    expect(treeMarks((await (await doc.getPage(1)).getStructTree()) as never)).toEqual([
      'mc0',
      'mc1',
      'mc2',
      'mc3',
      'mc4',
      'mc5',
    ]);
  });

  /*
   * What the document says about itself, as the engine actually answers.
   *
   * `getMarkInfo()` is declared to resolve with an object and resolves with a `Map` — and `null`, not an
   * empty object, for the ordinary file that declares nothing. Both are pinned here because the structure
   * feature reads this to decide whether to fetch anything at all, and reading `.Marked` off a `Map` is
   * `undefined`, which looks exactly like an untagged document: silently, for every tagged file in the
   * world.
   */
  it('declares itself tagged as a Map of the three MarkInfo flags', async () => {
    const doc = await open(fixture('tagged-sample.pdf'));
    const info = await doc.getMarkInfo();
    expect(info instanceof Map).toBe(true);
    expect([...(info as unknown as Map<string, unknown>)]).toEqual([
      ['Marked', true],
      ['UserProperties', false],
      ['Suspects', false],
    ]);
  });

  /*
   * The id agreement the annotation half of `FR-43` stands on.
   *
   * The annotation layer builds each element with `id = 'pdfjs_internal_id_' + data.id` and asks the
   * structure tree for that string; the tree answers from the annotation's `/StructParent` through the
   * `/ParentTree`, and serialises the kid as the same prefix plus the annotation's object id. Both sides
   * are written by pdf.js, so they agree — but nothing in the layer's own types says they must, and a
   * fixture that bound its link any other way would leave the wiring looking fine while the lookup missed.
   * Asserting equality against `getAnnotations()` rather than a literal keeps the object numbering of the
   * generator out of the test.
   */
  it('binds its link annotation into the tree under the id the layer will ask with', async () => {
    const doc = await open(fixture('tagged-sample.pdf'));
    const page = await doc.getPage(1);
    const [link] = await page.getAnnotations({ intent: 'display' });
    expect(link.subtype).toBe('Link');

    const claimed = treeAnnotations((await page.getStructTree()) as never);
    expect(claimed).toEqual([`pdfjs_internal_id_${link.id}`]);
  });

  /*
   * The ordinary case, stated next to the unusual one: seventeen of the eighteen other fixtures answer
   * `null` — for the tree and for `getMarkInfo()` alike, so a structure layer is a feature for the
   * documents that opt into tagging and a no-op for the rest. Which is the fact behind the decision
   * recorded in `ROADMAP.md`, and the reason `null` is asserted rather than treated as falsy-by-luck: an
   * implementation that asked `info.Marked` would answer the same way for the two very different cases.
   */
  it('is the exception among our fixtures, which answer null', async () => {
    const doc = await open(fixture('outline-sample.pdf'));
    const page = await doc.getPage(1);
    expect(await page.getStructTree()).toBeNull();
    expect(await doc.getMarkInfo()).toBeNull();
  });
});

describe('what silently breaks the tree', () => {
  /*
   * The counterfactual: rename the key and nothing complains. The roles are all still there — so a test
   * that only checked roles would pass on a file whose marks had come unbound. The substitution is
   * deliberately the same length: a shorter file would move every xref offset and turn this into a test of
   * pdf.js's re-indexing instead of of `/Pg`.
   */
  it('keeps its roles but loses every mark when /Pg is renamed', async () => {
    const text = Buffer.from(fixture('tagged-sample.pdf')).toString('latin1');
    expect(text).toMatch(/\/Pg \d+ 0 R/);
    const stripped = Buffer.from(text.replace(/\/Pg(?= \d+ 0 R)/g, '/Pz'), 'latin1');
    expect(stripped.length).toBe(fixture('tagged-sample.pdf').length);

    const doc = await open(new Uint8Array(stripped));
    const tree: any = await (await doc.getPage(1)).getStructTree();
    expect(walk(tree)).toEqual([]);
    expect(tree.children[0].children.map((node: any) => node.role)).toEqual(['H1', 'P', 'L', 'P']);
  });

  /*
   * The same shape of silent failure on the other side of the pairing, reproduced at the same byte length:
   * a `BDC` whose property list has been blanked is the one-operand form the first version of this fixture
   * was written with, and pdf.js answers it by skipping the marked section. The tree is untouched by that —
   * it never reads the content stream — so every assertion above keeps passing while the text layer loses
   * each element the tree could have owned. This is what the pairing test is for, and what the browser pass
   * found before it existed.
   */
  it('keeps its tree but loses its marks when a BDC loses its property list', async () => {
    const bytes = fixture('tagged-sample.pdf');
    const text = Buffer.from(bytes).toString('latin1');
    expect(text).toMatch(/BX \/MC0 << \/MCID 0 >> BDC/);
    const stripped = Buffer.from(
      text.replace(/(?<=BX \/MC\d )<< \/MCID \d >>(?= BDC)/g, (match) => ' '.repeat(match.length)),
      'latin1',
    );
    expect(stripped.length).toBe(bytes.length);

    const doc = await open(new Uint8Array(stripped));
    const page = await doc.getPage(1);
    expect(treeMarks((await page.getStructTree()) as never)).toEqual([
      'mc0',
      'mc1',
      'mc2',
      'mc3',
      'mc4',
      'mc5',
    ]);
    expect(await contentMarks(page)).toEqual([]);
  });
});
