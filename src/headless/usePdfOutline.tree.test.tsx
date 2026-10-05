/*
 * FR-10's first clause, which nothing had ever exercised: *parse the bookmark tree recursively*.
 *
 * The row's other two clauses — resolve a click to a page and a position, and keep the ARIA tree legal — have
 * had guards since W2 and #219 (`outline.test.ts` over the engine's destination forms,
 * `ViewerController.destination.test.tsx` over the scroll, `a11y.audit.test.tsx` over the tab). The recursion
 * was the odd one out: `buildTree` is called by no test, because it is private to `usePdfOutline`, and the
 * nested trees that reach the DOM in the audit are hand-built `OutlineEntry` literals — so the shape a reader
 * sees was asserted from a shape nobody parsed. Meanwhile `outline.test.ts` walks the raw `doc.getOutline()`
 * array through its *own* `resolveItem` helper, which is a second implementation of the same walk: the top
 * level of a fixture was proven twice and the levels below it once, by code that does not build the tree.
 *
 * Four things a shallow `.map` would get wrong, each with a case here:
 *
 *  - **depth** — a three-level outline has to come back three levels deep, with the leaf's page resolved;
 *  - **named destinations** — a `/Dests` name is a string, and `getDestination` must be asked *before* the
 *    destination is read. The engine's own answer is then the explicit `[page, /XYZ, left, top, zoom]` form,
 *    so a name that resolves to a place must land on that place, not at the top of the page;
 *  - **an unresolvable name must not take its level with it** — the `catch` sets `dest = null`, and the entry
 *    is still published with its children, because a bookmark that points nowhere is still a bookmark the
 *    reader can see and step back from;
 *  - **an object reference is not a page number** — `{num: 7}` means object 7, and the walk has to translate
 *    it through `cachedPageNumber`/`getPageIndex` at whatever depth it happens to sit.
 *
 * `/Count < 0` is checked per level too, since "collapsed" is a property of a node and the node it belongs to
 * is only knowable if the walk actually descended.
 */
import { renderHook, waitFor } from '@testing-library/react';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import { describe, expect, it, vi } from 'vitest';

import { usePdfOutline } from './usePdfOutline';

/**
 * A document handle that answers the four questions the outline walk asks.
 *
 * `getOutline` hands back the raw engine shape (nested `items`, `dest` either an array or a name string),
 * `getDestination` answers only the names listed, and the page-index questions are answered from a table of
 * object numbers so a reference can be checked against the page it *should* mean.
 */
function fakeDoc(options: {
  outline: unknown[] | null;
  named?: Record<string, unknown[] | null>;
  /** Object numbers that throw instead of resolving. */
  brokenNames?: string[];
  pagesByObject?: Record<string, number>;
  cachedByObject?: Record<string, number>;
} = { outline: [] }) {
  const {
    outline,
    named = {},
    brokenNames = [],
    pagesByObject = {},
    cachedByObject = {},
  } = options;
  const getOutline = vi.fn(() => Promise.resolve(outline));
  const getDestination = vi.fn((name: string) =>
    brokenNames.includes(name)
      ? Promise.reject(new Error(`no /Dests entry ${name}`))
      : Promise.resolve(named[name] ?? null),
  );
  const getPageIndex = vi.fn((ref: { num: number; gen: number }) =>
    Promise.resolve(pagesByObject[`${ref.num}/${ref.gen}`] ?? null),
  );
  const cachedPageNumber = vi.fn((ref: { num: number }) => cachedByObject[`${ref.num}`]);
  const doc = {
    numPages: 12,
    getOutline,
    getDestination,
    getPageIndex,
    cachedPageNumber,
  } as unknown as PDFDocumentProxy;
  return { doc, getOutline, getDestination, getPageIndex, cachedPageNumber };
}

/** `{ title, dest, count, items }` in the shape pdf.js returns. */
const item = (
  title: string,
  dest: unknown,
  children: unknown[] = [],
  count?: number,
): unknown => ({ title, dest, count, items: children });

const XYZ = (page: number, left: number, top: number, zoom = 0): unknown[] => [
  page,
  { name: 'XYZ' },
  left,
  top,
  zoom,
];

async function entriesOf(doc: PDFDocumentProxy) {
  const { result } = renderHook(() => usePdfOutline({ doc }));
  await waitFor(() => expect(result.current.loading).toBe(false));
  return result.current.entries;
}

describe('FR-10: the bookmark tree is parsed recursively, at every depth', () => {
  it('descends three levels and resolves the leaf, not just the branch', async () => {
    const { doc, getDestination } = fakeDoc({
      outline: [
        item('Part I', XYZ(0, 0, 700), [
          item('Chapter 1', XYZ(2, 0, 500), [item('Section 1.1', XYZ(4, 10, 300)), item('Section 1.2', XYZ(5, 0, 0))]),
          item('Chapter 2', XYZ(7, 0, 100)),
        ]),
      ],
    });
    const entries = await entriesOf(doc);
    expect(entries, 'one top-level bookmark').toHaveLength(1);
    const part = entries![0]!;
    expect(part).toMatchObject({ title: 'Part I', pageIndex: 0 });
    expect(part.children.map((child) => child.title), 'document order survives the descent').toEqual([
      'Chapter 1',
      'Chapter 2',
    ]);
    const chapter = part.children[0]!;
    expect(chapter.children.map((child) => [child.title, child.pageIndex])).toEqual([
      ['Section 1.1', 4],
      ['Section 1.2', 5],
    ]);
    expect(getDestination, 'no name to resolve in this outline').not.toHaveBeenCalled();
  });

  it('asks the document what a named destination means, then reads the place it answers', async () => {
    const { doc, getDestination } = fakeDoc({
      outline: [item('Annex', 'annex-dest', [item('A.1', 'a1-dest')])],
      named: {
        'annex-dest': XYZ(9, 0, 400),
        'a1-dest': [10, 'FitH', 250],
      },
    });
    const entries = await entriesOf(doc);
    expect(
      getDestination.mock.calls.map((call) => call[0]),
      'both names asked, in the order the tree holds them',
    ).toEqual(['annex-dest', 'a1-dest']);
    const annex = entries![0]!;
    expect(annex.pageIndex).toBe(9);
    expect(annex.position, 'a resolved /XYZ keeps its place, not just its page').toEqual({
      kind: 'XYZ',
      left: 0,
      top: 400,
      zoom: null,
    });
    expect(annex.children[0]!.pageIndex).toBe(10);
    expect(annex.children[0]!.position, '/FitH carries its one number as a vertical position').toEqual({
      kind: 'FitH',
      left: null,
      top: 250,
      zoom: null,
    });
  });

  it('publishes an entry whose name the document cannot resolve, without a page and without losing its children', async () => {
    const { doc } = fakeDoc({
      outline: [item('Missing', 'gone', [item('Found', XYZ(3, 0, 0))])],
      brokenNames: ['gone'],
    });
    const entries = await entriesOf(doc);
    const missing = entries![0]!;
    expect(missing.title).toBe('Missing');
    expect(missing.pageIndex, 'a name that throws resolves to no page rather than to page 0').toBeNull();
    expect(missing.position).toBeNull();
    expect(missing.children[0]!.pageIndex, 'the level below is still parsed').toBe(3);
  });

  it('translates an object reference to the page it means, at depth', async () => {
    const { doc, getPageIndex, cachedPageNumber } = fakeDoc({
      outline: [item('Front', XYZ(0, 0, 0), [item('Objected', [{ num: 7, gen: 0 }, 'XYZ', 0, 600, 1.5])])],
      pagesByObject: { '7/0': 6 },
    });
    const entries = await entriesOf(doc);
    const objected = entries![0]!.children[0]!;
    expect(objected.pageIndex, 'object 7 is page 6, not page 7').toBe(6);
    expect(objected.position).toEqual({ kind: 'XYZ', left: 0, top: 600, zoom: 1.5 });
    expect(cachedPageNumber).toHaveBeenCalledWith({ num: 7, gen: 0 });
    expect(getPageIndex).toHaveBeenCalledWith({ num: 7, gen: 0 });
  });

  it('reads the cached page number when the engine answers one, and skips the round trip', async () => {
    const { doc, getPageIndex } = fakeDoc({
      outline: [item('Cached', [{ num: 4, gen: 0 }, 'Fit'])],
      cachedByObject: { '4': 5 },
    });
    const entries = await entriesOf(doc);
    expect(entries![0]!.pageIndex, 'cachedPageNumber is 1-based').toBe(4);
    expect(getPageIndex).not.toHaveBeenCalled();
  });

  it('collapses the node whose /Count is negative, and only that node, whatever depth it is at', async () => {
    const { doc } = fakeDoc({
      outline: [
        item('Open', XYZ(0, 0, 0), [
          item('Shut', XYZ(1, 0, 0, 2), [item('Shut deeper', XYZ(2, 0, 0))], -1),
          item('Also open', XYZ(3, 0, 0), [], 2),
        ], -3),
      ],
    });
    const entries = await entriesOf(doc);
    expect(entries!.map((entry) => entry.collapsed), 'a negative count on the root collapses the root').toEqual([true]);
    const root = entries![0]!;
    expect(root.children.map((child) => child.collapsed)).toEqual([true, false]);
    expect(root.children[0]!.children[0]!.collapsed, 'a node with no /Count is open').toBe(false);
    expect(root.children[0]!.pageIndex, 'collapsed is a view hint, not a lost destination').toBe(1);
    expect(root.children[0]!.position!.zoom, 'a /XYZ zoom above zero is kept').toBe(2);
  });

  it('publishes an empty tree for a document with no outline, and for one whose outline throws', async () => {
    const none = await entriesOf(fakeDoc({ outline: null }).doc);
    expect(none, 'a document with no /Outlines still finishes').toEqual([]);

    const doc = {
      numPages: 1,
      getOutline: vi.fn(() => Promise.reject(new Error('damaged catalog'))),
      getDestination: vi.fn(() => Promise.resolve(null)),
      getPageIndex: vi.fn(() => Promise.resolve(null)),
      cachedPageNumber: vi.fn(() => undefined),
    } as unknown as PDFDocumentProxy;
    await expect(entriesOf(doc), 'a throw is not an error state, because there is no error to show').resolves.toEqual([]);
  });

  it('refuses to read an outline item whose title is not a string, and still resolves its page', async () => {
    const { doc } = fakeDoc({
      outline: [item(undefined as unknown as string, XYZ(8, 0, 0), [item(42 as unknown as string, XYZ(9, 0, 0))])],
    });
    const entries = await entriesOf(doc);
    expect(entries![0]!.title, 'a title that is not a text string is an empty one, not "undefined"').toBe('');
    expect(entries![0]!.pageIndex).toBe(8);
    expect(entries![0]!.children[0]!.title).toBe('');
    expect(entries![0]!.children[0]!.pageIndex).toBe(9);
  });
});
