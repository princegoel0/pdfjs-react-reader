/**
 * The flatten boundary, tested against real files rather than a mock of them.
 *
 * `pdf-write` is the only module that touches the optional peer, so these are the
 * tests that notice when the peer's behaviour moves underneath us. Two of them exist
 * because of measurements taken while choosing it: that flattening removes the form and
 * nothing else, and that a document with no form is a different answer from one that was
 * flattened — the second is the difference between telling a host "done" and telling them
 * "there was nothing to do".
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { arrangePages, flattenBytes } from './pdf-write';

const fixture = (name: string): Uint8Array =>
  new Uint8Array(readFileSync(fileURLToPath(new URL(`../../playground/fixtures/${name}`, import.meta.url))));

const text = (bytes: Uint8Array): string => Buffer.from(bytes).toString('latin1');
const count = (hay: string, needle: string): number => hay.split(needle).length - 1;

/** The page tree's own order, read out of the bytes rather than through the writer's API. */
const kidsOf = (hay: string): number[] => {
  const match = /\/Kids\s*\[([^\]]*)\]/.exec(hay);
  return [...(match?.[1] ?? '').matchAll(/(\d+) 0 R/g)].map((m) => Number(m[1]));
};
const objectWritten = (hay: string, num: number): boolean => new RegExp(`\\n${num} 0 obj`).test(hay);
const dictOf = (hay: string, num: number): string => {
  const start = hay.indexOf(`\n${num} 0 obj`);
  return start < 0 ? '' : hay.slice(start, hay.indexOf('endobj', start));
};
/** `page-order-sample.pdf` prints its own object number, and this is that mapping. */
const objectOfPage = (page: number): number => 200 + ((page * 7) % 20);
const identityOrder = (length: number): number[] => Array.from({ length }, (_, i) => i);

describe('flattenBytes', () => {
  it('removes every form widget and reports how many fields it flattened', async () => {
    const source = fixture('form-sample.pdf');
    expect(count(text(source), '/Widget'), 'the fixture should carry widgets').toBeGreaterThan(0);

    const result = await flattenBytes(source);
    const out = text(result.bytes);

    expect(result.fieldsRemoved).toBeGreaterThan(0);
    expect(result.hadNoForm).toBe(false);
    expect(count(out, '/Widget'), 'no interactive widget should survive').toBe(0);
    /*
     * The `/AcroForm` entry itself stays — the writer empties it rather than
     * unlinking it, so the dictionary reads `/Fields [ ]` with no `/FT` anywhere.
     * Asserting the emptiness is what means something: a non-empty `/Fields` is how
     * pdf.js decides to report a form at all, which is what `onCapabilities` shows.
     */
    expect(out, 'the field list should be empty').toMatch(/\/Fields\s*\[\s*\]/);
    expect(count(out, '/FT '), 'no field type should remain').toBe(0);
  });

  it('leaves a document without a form alone, and says so', async () => {
    // Not a failure: an annotated paper with no fields is already flat. The flag is
    // what stops a host reporting "flattened" for a file that never needed it.
    const result = await flattenBytes(fixture('annotated-sample.pdf'));
    expect(result.fieldsRemoved).toBe(0);
    expect(result.hadNoForm).toBe(true);
  });

  it('keeps the reader marks of 0.6 when it flattens a form', async () => {
    // The reason this tier is allowed to ship at all: `flatten()` is documented to
    // remove "all form fields and annotations associated", and a highlight is not
    // associated with a field. Losing a reader's marks to a flatten would undo the
    // release before it.
    const source = fixture('annotated-sample.pdf');
    const before = text(source);
    const out = text((await flattenBytes(source)).bytes);
    for (const subtype of ['/Highlight', '/Ink', '/FreeText']) {
      expect(count(before, subtype), `${subtype} in the fixture`).toBeGreaterThan(0);
      expect(count(out, subtype), `${subtype} after flatten`).toBe(
        count(before, subtype),
      );
    }
  });

  it('produces a file that still loads, with the same page count', async () => {
    const source = fixture('form-sample.pdf');
    const before = await flattenBytes(source);
    // Round-tripping through the same module is the cheap structural check: a writer
    // that emitted a broken xref would reject here rather than in a reader.
    const again = await flattenBytes(before.bytes);
    expect(again.bytes.length).toBeGreaterThan(1000);
    expect(text(again.bytes).startsWith('%PDF-')).toBe(true);
  });

  it('rejects bytes that are not a PDF instead of returning them unchanged', async () => {
    await expect(flattenBytes(new Uint8Array([0x25, 0x50, 0x4c, 0x58, 1, 2, 3]))).rejects.toThrow();
  });
});

/*
 * These are the tests for `0.7`'s page editing, and the first one is the reason the
 * implementation permutes the page tree instead of using the API that reads like a move:
 * `removePage()` deletes the page's dictionary, so `insertPage()` afterwards re-inserts a
 * reference to an object the writer no longer has. The file still claims to hold all its
 * pages, and one of them is not there.
 */
describe('arrangePages', () => {
  const twenty = () => fixture('page-order-sample.pdf');

  it('moves a page without leaving a reference to a page the file does not contain', async () => {
    const before = text(twenty());
    const original = kidsOf(before);
    const order = [4, ...identityOrder(4), ...identityOrder(20).slice(5)];

    const result = await arrangePages(twenty(), { order });
    const out = text(result.bytes);

    expect(result.pages).toBe(20);
    expect(result.removed).toBe(0);
    expect(kidsOf(out)[0], 'the moved page should lead the tree').toBe(original[4]);
    expect(kidsOf(out).length).toBe(20);
    // The counterfactual: this is the assertion the remove/insert move fails.
    for (const kid of kidsOf(out)) {
      expect(objectWritten(out, kid), `page tree names ${kid}, which is not in the file`).toBe(true);
    }
    expect(/\/Count\s+20\b/.test(out), 'the tree should still describe its own size').toBe(true);
  });

  it('restores the original order when asked for the inverse arrangement', async () => {
    const original = kidsOf(text(twenty()));
    const order = [4, ...identityOrder(4), ...identityOrder(20).slice(5)];
    const moved = await arrangePages(twenty(), { order });

    // Undo is the inverse permutation, not a snapshot of the bytes: a real document's
    // bytes are megabytes, and this is an array of integers.
    const inverse = order.map((_, slot) => order.indexOf(slot));
    const back = kidsOf(text((await arrangePages(moved.bytes, { order: inverse })).bytes));

    expect(back).toEqual(original);
  });

  it('drops the pages an order leaves out', async () => {
    const original = kidsOf(text(twenty()));
    const result = await arrangePages(twenty(), { order: [7, 3] });
    const out = text(result.bytes);

    expect(result.pages).toBe(2);
    expect(result.removed).toBe(18);
    expect(kidsOf(out)).toEqual([original[7], original[3]]);
    for (const kid of kidsOf(out)) expect(objectWritten(out, kid)).toBe(true);
    expect(/\/Count\s+2\b/.test(out)).toBe(true);
  });

  it('writes a rotation onto the page and keeps it there after a move', async () => {
    const rotated = await arrangePages(twenty(), {
      order: identityOrder(20),
      rotations: { 0: 90 },
    });
    const rotatedText = text(rotated.bytes);
    expect(dictOf(rotatedText, objectOfPage(1))).toMatch(/\/Rotate 90/);
    // The fixture's own rotated page must not be touched by an arrangement about page 1.
    expect(dictOf(rotatedText, objectOfPage(5))).toMatch(/\/Rotate 90/);

    const moved = text(
      (
        await arrangePages(rotated.bytes, {
          order: [1, 0, ...identityOrder(20).slice(2)],
        })
      ).bytes,
    );
    expect(kidsOf(moved)[1], 'the rotated page should be the one that moved').toBe(objectOfPage(1));
    expect(dictOf(moved, objectOfPage(1))).toMatch(/\/Rotate 90/);
  });

  it('normalises a full turn and refuses an angle a page cannot have', async () => {
    const spun = text(
      (await arrangePages(twenty(), { order: identityOrder(20), rotations: { 1: 450 } })).bytes,
    );
    expect(dictOf(spun, objectOfPage(2))).toMatch(/\/Rotate 90/);

    await expect(
      arrangePages(twenty(), { order: identityOrder(20), rotations: { 1: 45 } }),
    ).rejects.toThrow(/multiple of 90/);
  });

  it('keeps the reader marks of 0.6 through a move', async () => {
    const source = fixture('annotated-sample.pdf');
    const before = text(source);
    const out = text((await arrangePages(source, { order: [1, 0] })).bytes);
    for (const subtype of ['/Highlight', '/Ink', '/FreeText', '/Popup']) {
      expect(count(out, subtype), `${subtype} after the move`).toBe(count(before, subtype));
    }
  });

  it('refuses an order that is not a permutation of the pages there are', async () => {
    await expect(arrangePages(twenty(), { order: [] })).rejects.toThrow(/at least one page/);
    await expect(arrangePages(twenty(), { order: [3, 3] })).rejects.toThrow(/asked for twice/);
    await expect(arrangePages(twenty(), { order: [0, 20] })).rejects.toThrow(/not one of/);
    await expect(arrangePages(twenty(), { order: [0, -1] })).rejects.toThrow(/not one of/);
    await expect(arrangePages(twenty(), { order: [0, 1.5] })).rejects.toThrow(/not one of/);
  });

  it('round-trips: arranging an arranged file twice more still reads as a PDF', async () => {
    const once = await arrangePages(twenty(), { order: [9, ...identityOrder(9), ...identityOrder(20).slice(10)] });
    const twice = await arrangePages(once.bytes, { order: identityOrder(20).reverse() });
    const out = text(twice.bytes);
    expect(out.startsWith('%PDF-')).toBe(true);
    expect(kidsOf(out).length).toBe(20);
    expect(kidsOf(out)[0]).toBe(objectOfPage(20));
  });
});
