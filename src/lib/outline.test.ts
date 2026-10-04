import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { describe, expect, it, vi } from 'vitest';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import {
  parseDestination,
  parseDestinationPosition,
  resolveDestination,
  resolveDestinationPageIndex,
} from './outline';

const noPlace = { kind: 'Unknown', left: null, top: null, zoom: null } as const;

describe('parseDestination', () => {
  it('treats an integer first element as a 0-based page index', () => {
    expect(parseDestination([2, 'XYZ', null, null])).toEqual({
      kind: 'index',
      index: 2,
      position: { kind: 'XYZ', left: null, top: null, zoom: null },
    });
    expect(parseDestination([0])).toEqual({ kind: 'index', index: 0, position: noPlace });
  });
  it('reads a { num, gen } object reference', () => {
    expect(parseDestination([{ num: 17, gen: 0 }, 'Fit'])).toEqual({
      kind: 'proxy',
      num: 17,
      gen: 0,
      position: { kind: 'Fit', left: null, top: null, zoom: null },
    });
    expect(parseDestination([{ num: 17 }])).toEqual({
      kind: 'proxy',
      num: 17,
      gen: 0,
      position: noPlace,
    });
  });
  it('returns null for missing or invalid destinations', () => {
    expect(parseDestination(null)).toBeNull();
    expect(parseDestination(undefined)).toBeNull();
    expect(parseDestination([])).toBeNull();
    expect(parseDestination('named')).toBeNull();
    expect(parseDestination([{ gen: 0 }])).toBeNull();
    expect(parseDestination([-1])).toBeNull();
    expect(parseDestination([1.5])).toBeNull();
  });
});

describe('resolveDestinationPageIndex', () => {
  it('passes through a numeric index', async () => {
    const doc = { cachedPageNumber: vi.fn(), getPageIndex: vi.fn() } as unknown as PDFDocumentProxy;
    expect(await resolveDestinationPageIndex(doc, [3])).toBe(3);
    expect(doc.cachedPageNumber).not.toHaveBeenCalled();
  });
  it('prefers the cached page number (1-based) for object refs', async () => {
    const doc = {
      cachedPageNumber: vi.fn().mockReturnValue(5),
      getPageIndex: vi.fn(),
    } as unknown as PDFDocumentProxy;
    expect(await resolveDestinationPageIndex(doc, [{ num: 42, gen: 0 }])).toBe(4);
    expect(doc.cachedPageNumber).toHaveBeenCalledWith({ num: 42, gen: 0 });
    expect(doc.getPageIndex).not.toHaveBeenCalled();
  });
  it('falls back to getPageIndex (0-based) when not cached', async () => {
    const doc = {
      cachedPageNumber: vi.fn().mockReturnValue(null),
      getPageIndex: vi.fn().mockResolvedValue(7),
    } as unknown as PDFDocumentProxy;
    expect(await resolveDestinationPageIndex(doc, [{ num: 42, gen: 0 }])).toBe(7);
    expect(doc.getPageIndex).toHaveBeenCalledWith({ num: 42, gen: 0 });
  });
  it('returns null when the reference cannot be resolved', async () => {
    const doc = {
      cachedPageNumber: vi.fn().mockReturnValue(null),
      getPageIndex: vi.fn().mockRejectedValue(new Error('bad ref')),
    } as unknown as PDFDocumentProxy;
    expect(await resolveDestinationPageIndex(doc, [{ num: 42 }])).toBeNull();
  });
});

/*
 * FR-10's "resolve a click to a page and a position", which the page index alone did not answer.
 *
 * The position is the last three of `[page, /XYZ, left, top, zoom]`, and each display mode puts its numbers
 * somewhere different — `/FitH` carries a vertical position in the slot `/XYZ` calls left, `/FitR` carries a
 * rectangle whose *fourth* value is the top. So the reading is per kind rather than positional, and the table
 * below is the whole of it.
 *
 * A `null` is a value, not a gap: the specification spells it "keep what the reader has", and a `/XYZ` zoom of
 * 0 means "keep the magnification" rather than "draw nothing". Both have to survive as nulls so a viewer can
 * tell "the document said the top" from "the document said nothing".
 */
describe('parseDestinationPosition: what each display mode means', () => {
  it('reads /XYZ as left, top and an optional magnification', () => {
    expect(parseDestinationPosition([0, { name: 'XYZ' }, 72, 660, null])).toEqual({
      kind: 'XYZ',
      left: 72,
      top: 660,
      zoom: null,
    });
    expect(parseDestinationPosition([0, { name: 'XYZ' }, 72, 660, 1.5]).zoom).toBe(1.5);
    // The specification's "leave the zoom alone", which is not a request to draw the page at zero scale.
    expect(parseDestinationPosition([0, { name: 'XYZ' }, 0, 0, 0]).zoom).toBeNull();
    // A writer that names the mode as a bare name rather than a dictionary still reads.
    expect(parseDestinationPosition([0, 'XYZ', 10, 20, null]).top).toBe(20);
  });

  it('puts the one number where the mode says it belongs', () => {
    expect(parseDestinationPosition([0, { name: 'FitH' }, 400])).toEqual({
      kind: 'FitH',
      left: null,
      top: 400,
      zoom: null,
    });
    expect(parseDestinationPosition([0, { name: 'FitV' }, 400]).left).toBe(400);
    expect(parseDestinationPosition([0, { name: 'FitBH' }, 400]).top).toBe(400);
    expect(parseDestinationPosition([0, { name: 'FitBV' }, 400]).left).toBe(400);
    // /FitR is [left, bottom, right, top]: the top is the fourth number, not the second.
    expect(parseDestinationPosition([0, { name: 'FitR' }, 50, 10, 300, 700])).toEqual({
      kind: 'FitR',
      left: 50,
      top: 700,
      zoom: null,
    });
  });

  it('says "whole page" for the fit modes that carry no number, and unknown for anything else', () => {
    for (const kind of ['Fit', 'FitB']) {
      expect(parseDestinationPosition([0, { name: kind }])).toEqual({
        kind,
        left: null,
        top: null,
        zoom: null,
      });
    }
    expect(parseDestinationPosition([0, { name: 'GoToSomeDay' }]).kind).toBe('Unknown');
    expect(parseDestinationPosition([0]).kind).toBe('Unknown');
  });
});

/*
 * The same rule against a real file, because every fixture in this repository used to write
 * `/XYZ null null null` — a destination that names a page and no place, which is why the clause could be
 * implemented and still not be measured. `outline-sample.pdf` now points at lines it actually draws: the
 * title at user-space y 700 and the subtitle at 660 on a 792-high page.
 *
 * The last test asks the *engine* the question the shell will ask it at click time — what is 660 in points,
 * on a page at scale 1, measured from the top edge the reader sees — because that conversion is pdf.js's, and
 * a viewer that invented its own would be wrong on a rotated page.
 */
describe('FR-10 on the fixture that carries places, not just pages', () => {
  const file = join(process.cwd(), 'playground', 'fixtures', 'outline-sample.pdf');
  // A fresh copy of the bytes per load: the engine takes the buffer it is handed, and a second document over
  // the same array is a document over a detached one.
  const load = () => getDocument({ data: new Uint8Array(readFileSync(file)) }).promise;

  /** The tree `usePdfOutline` walks, spelled out here so the resolver is what is under test. */
  const resolveItem = async (
    doc: Awaited<ReturnType<typeof load>>,
    item: { dest?: unknown },
  ): Promise<{ pageIndex: number | null; position: unknown } | null> => {
    let dest = item.dest;
    if (typeof dest === 'string') dest = await doc.getDestination(dest);
    const found = await resolveDestination(doc as unknown as PDFDocumentProxy, dest);
    return found ? { pageIndex: found.pageIndex, position: found.position } : null;
  };

  it('keeps the place an inline /XYZ names, and translates the object reference to a page', async () => {
    const doc = await load();
    const outline = (await doc.getOutline()) as { dest?: unknown }[];
    const first = await resolveItem(doc, outline[0]!);
    expect(first).toEqual({
      pageIndex: 0,
      position: { kind: 'XYZ', left: 72, top: 660, zoom: null },
    });
    await doc.cleanup();
  });

  it('resolves a named destination through the name tree and keeps its position and zoom', async () => {
    const doc = await load();
    const outline = (await doc.getOutline()) as { dest?: unknown }[];
    // "3. Conclusion" carries `/concl`, and the name tree answers with object 7 — the third page, not object
    // number 7 of 19.
    const named = await resolveItem(doc, outline[2]!);
    expect(named).toEqual({
      pageIndex: 2,
      position: { kind: 'XYZ', left: null, top: 620, zoom: 2 },
    });
    await doc.cleanup();
  });

  it('reads a /FitH number as a vertical place, and a bare /Fit as none', async () => {
    const doc = await load();
    const outline = (await doc.getOutline()) as { dest?: unknown; items?: unknown }[];
    const sections = outline[1]!;
    expect((await resolveItem(doc, sections))?.position).toEqual({
      kind: 'Fit',
      left: null,
      top: null,
      zoom: null,
    });
    const child = (sections.items as { dest?: unknown }[])[0]!;
    expect((await resolveItem(doc, child))?.position).toEqual({
      kind: 'FitH',
      left: null,
      top: 400,
      zoom: null,
    });
    await doc.cleanup();
  });

  it('asks the engine the same question the click will ask, and records what it answers', async () => {
    const doc = await load();
    const page = await doc.getPage(1);
    const viewport = page.getViewport({ scale: 1, rotation: (page.rotate + 0) % 360 });
    // 660 pt from the bottom of a 792 pt page is 132 px from the top of what the reader scrolls — the number
    // the shell hands to `scrollToPage` as the offset within the page. Measured rather than derived, because
    // the axis flip and the rotation are the engine's business.
    expect(viewport.convertToViewportPoint(72, 660)[1]).toBeCloseTo(132, 6);
    // And a page turned for reading moves the same point: this is why the offset is computed at click time
    // from the live rotation instead of once when the outline was parsed.
    const turned = page.getViewport({ scale: 1, rotation: 90 });
    expect(turned.convertToViewportPoint(72, 660)[1]).not.toBeCloseTo(132, 6);
    await doc.cleanup();
  });
});
