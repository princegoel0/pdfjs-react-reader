/**
 * FR-31, the flatten boundary, tested against real files rather than a mock of them.
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
import type { PdfError } from './errors';
import { isPdfError, isCancellationCode } from './errors';
import type { PdfSignatureField } from './pdf-write';
import { arrangePages, findSignatureFields, flattenBytes, signFields } from './pdf-write';

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

/*
 * A mark relative to its box, which is the shape `signFields` takes: one mark, scaled to
 * whatever box it lands in. In `sigPlain`'s [72 660 272 720] these become `82 681` and
 * `262 699`, and one test reads those page coordinates back out of the bytes.
 */
const MARK = [
  { x: 0.05, y: 0.35 },
  { x: 0.95, y: 0.65 },
];
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

/*
 * The signature half of the writer, measured against `signature-sample.pdf` — a form whose
 * four `/Sig` fields are the four shapes a reader's file arrives in, and which starts with
 * three boxes carrying no appearance at all. That last detail is what makes the second test
 * below mean something: with no `/AP` in the source file, a mark found afterwards can only
 * have come from `signFields`.
 */
describe('signatures', () => {
  /** The object that declares a field name, which is where its `/AP` or its `/Kids` lives. */
  const objectOf = (hay: string, name: string): string => {
    const at = hay.indexOf(`(${name})`);
    if (at < 0) return '';
    const start = hay.lastIndexOf(' obj', at);
    return hay.slice(start, hay.indexOf('endobj', at));
  };
  const objectNumbered = (hay: string, num: number): string => {
    const start = hay.indexOf(`\n${num} 0 obj`);
    return start < 0 ? '' : hay.slice(start, hay.indexOf('endobj', start));
  };

  it('lists every signature widget with the box and the page the file gives it', async () => {
    const fields = await findSignatureFields(fixture('signature-sample.pdf'));
    expect(fields.map((f) => f.name)).toEqual([
      'sigPlain',
      'sigKid',
      'sigNoRotate',
      'sigAlreadySigned',
      // One field, two boxes: the list is per widget, because those are two rectangles a
      // reader has to see and choose between.
      'sigTwoBoxes',
      'sigTwoBoxes',
    ]);
    expect(fields.map((f) => f.page)).toEqual([0, 0, 1, 1, 0, 1]);
    expect(fields.map((f) => f.rect)).toEqual([
      [72, 660, 272, 720],
      [72, 570, 222, 610],
      [72, 660, 272, 720],
      [72, 560, 272, 620],
      [300, 560, 500, 620],
      [72, 460, 172, 490],
    ]);
    // The fixture gives only the boxes that start empty an absent appearance: sigPlain and
    // the two widgets of sigTwoBoxes.
    expect(fields.map((f) => f.hasAppearance)).toEqual([false, true, true, true, false, false]);
    expect(fields.map((f) => f.noRotate)).toEqual([false, false, true, false, false, false]);
    // One field arrives with a signature value, and it is the only one that does.
    expect(fields.map((f) => f.alreadySigned)).toEqual([false, false, false, true, false, false]);
  });

  /*
   * FR-32's plural: "scaled into each widget box that field declares". `signature-sample.pdf`
   * grew a fifth field for this — a parent whose `/Kids` name two widgets, on two pages, at two
   * sizes — because every earlier fixture had one box per field, and a writer that stopped after
   * the first box passed all of it. The two marks have to land as four different page numbers:
   * the same relative pair resolved into a 200x60 rectangle and a 100x30 one.
   */
  it('writes one mark into both boxes of a field that declares two, scaled to each', async () => {
    const source = fixture('signature-sample.pdf');
    const boxes = (await findSignatureFields(source)).filter((f) => f.name === 'sigTwoBoxes');
    expect(boxes.map((b) => b.rect)).toEqual([
      [300, 560, 500, 620],
      [72, 460, 172, 490],
    ]);
    expect(new Set(boxes.map((b) => b.page)).size, 'one box on each page').toBe(2);

    const result = await signFields(source, [{ field: 'sigTwoBoxes', points: MARK }]);
    // Two entries for one call: `signed` counts widgets, which is what the panel says out loud.
    expect(result.signed).toEqual(['sigTwoBoxes', 'sigTwoBoxes']);
    const out = text(result.bytes);
    expect(out).toContain('310 581 m 490 599 l');
    expect(out).toContain('77 470.5 m 167 479.5 l');
    expect(count(out, 'S Q'), 'one appearance stream per box').toBe(2);
    // The parent that reaches both boxes holds no appearance of its own.
    expect(objectOf(out, 'sigTwoBoxes')).toContain('/Kids');
    expect(objectOf(out, 'sigTwoBoxes')).not.toContain('/AP');

    const after = await findSignatureFields(result.bytes);
    expect(after.filter((f) => f.name === 'sigTwoBoxes').map((f) => f.hasAppearance)).toEqual([
      true,
      true,
    ]);
    expect(
      after.filter((f) => f.name !== 'sigTwoBoxes').map((f) => f.hasAppearance),
      'signing one field leaves every other box as it was',
    ).toEqual([false, true, true, true]);
  });

  it('writes the marks into the fields that are unsigned, and refuses a list that includes a signed one', async () => {
    const source = fixture('signature-sample.pdf');
    const fields = await findSignatureFields(source);
    const names = unsignedFields(fields);
    const result = await signFields(source, names.map((field) => ({ field, points: MARK })));
    const out = text(result.bytes);

    // One of the five is a field with two boxes, so six widgets carry a mark from four calls.
    expect(result.signed).toEqual(['sigPlain', 'sigKid', 'sigNoRotate', 'sigTwoBoxes', 'sigTwoBoxes']);
    expect(result.refused).toEqual([]);
    expect(out.startsWith('%PDF-')).toBe(true);
    expect(count(out, 'S Q')).toBe(5);
    expect(count(out, '/FT /Sig')).toBe(5);
    // One mark, two boxes, two different sets of page coordinates — the difference between
    // storing a mark relative to its box and storing it in one rectangle's space.
    expect(out).toContain('82 681 m 262 699 l');
    expect(out).toContain('79.5 584 m 214.5 596 l');
    // A `/V` on a `/Sig` field is a cryptographic claim, and every reader that sees one
    // without a matching `/ByteRange` calls the document damaged. So the count of `/V` in
    // the file has to be exactly what it was: the text field's value, and nothing else.
    expect(count(out, '/V ')).toBe(count(text(source), '/V '));
    for (const field of await findSignatureFields(result.bytes)) {
      expect(field.hasAppearance, field.name).toBe(true);
    }
  });

  it('puts the appearance on the widget kid, never on the parent field', async () => {
    const source = fixture('signature-sample.pdf');
    const target = (await findSignatureFields(source)).find((f) => f.name === 'sigKid')!;
    const { bytes } = await signFields(source, [{ field: 'sigKid', points: MARK }]);
    const out = text(bytes);

    expect(objectOf(out, 'sigKid')).toContain('/Kids');
    expect(objectOf(out, 'sigKid')).not.toContain('/AP');
    expect(objectNumbered(out, 13)).toContain('/AP');
  });

  it('refuses a field the document does not hold and returns the bytes it was given', async () => {
    const source = fixture('signature-sample.pdf');
    const result = await signFields(source, [{ field: 'noSuchField', points: MARK }]);
    expect(result.signed).toEqual([]);
    expect(result.refused).toEqual(['noSuchField']);
    expect(result.bytes).toBe(source);
  });

  /*
   * The refusal that matters most: a `/V` on a `/Sig` field is a claim over the bytes — who
    signed, when, over what range. Covering it with a picture leaves the file still claiming
    to be signed, and nothing in it says the claim is now false.
   */
  it('will not draw over a field that already holds a signature value', async () => {
    const source = fixture('signature-sample.pdf');
    const fields = await findSignatureFields(source);
    const signed = fields.find((f) => f.alreadySigned)!;
    expect(signed.name).toBe('sigAlreadySigned');

    // FR-54: `ALREADY_SIGNED` is §3.6's code for this refusal, so a host can branch on the reason
    // instead of joining `refused` against `findSignatureFields` and guessing which of the two it was.
    let thrown: unknown = null;
    try {
      await signFields(source, [{ field: signed.name, points: MARK }]);
      expect.unreachable('a field carrying a /V must refuse the write');
    } catch (error) {
      thrown = error;
    }
    expect(isPdfError(thrown, 'ALREADY_SIGNED')).toBe(true);
    expect((thrown as PdfError).details).toEqual({ field: 'sigAlreadySigned' });

    /*
     * The call that *could* have written three of the four is refused in full, which is the part a
     * per-mark `refused` list got wrong: a document signed in three of the boxes you asked for still
     * reads as signed, and nothing in it says the fourth is missing.
     */
    await expect(
      signFields(source, [
        { field: 'sigPlain', points: MARK },
        { field: signed.name, points: MARK },
      ]),
    ).rejects.toSatisfy((error: unknown) => isPdfError(error, 'ALREADY_SIGNED'));

    // And the claim itself is untouched, so a validator still reads what it did before.
    expect(objectOf(text(source), 'sigAlreadySigned')).toContain('/V << /Type /Sig');
    const stillThere = await findSignatureFields(source);
    expect(stillThere.filter((f) => f.alreadySigned).map((f) => f.name)).toEqual(['sigAlreadySigned']);
  });

  it('writes nothing for a mark too short to be a signature', async () => {
    const source = fixture('signature-sample.pdf');
    const result = await signFields(source, [{ field: 'sigPlain', points: [MARK[0]!] }]);
    expect(result.signed).toEqual([]);
    // `refused` means "nothing was written for this", which covers a path with no line in it
    // as well as a field the file does not hold — one answer, because the caller's action is
    // the same either way: say so, rather than report a signature that is not in the file.
    expect(result.refused).toEqual(['sigPlain']);
    expect(result.bytes).toBe(source);
  });

  it('tells the truth about a document that cannot be signed anywhere', async () => {
    const source = fixture('form-sample.pdf');
    expect(await findSignatureFields(source)).toEqual([]);
    const result = await signFields(source, [{ field: 'fullName', points: MARK }]);
    expect(result.refused).toEqual(['fullName']);
    expect(result.bytes).toBe(source);
  });

  it('keeps the rest of the form alone while signing', async () => {
    const source = fixture('signature-sample.pdf');
    const target = (await findSignatureFields(source))[0]!;
    const { bytes } = await signFields(source, [
      { field: 'sigPlain', points: MARK },
    ]);
    const out = text(bytes);
    expect(out).toContain('/V (Q3 report)');
    expect(count(out, '/Subtype /Widget')).toBe(count(text(source), '/Subtype /Widget'));
  });

  /*
   * `findSignatureFields` answers one entry per *widget* and a mark addresses one *field*, so a
   * file with a two-box field needs this to be said: handing the list straight to `signFields`
   * would ask for the same field twice and write its boxes twice over.
   */
  const unsignedFields = (fields: PdfSignatureField[]): string[] => [
    ...new Set(fields.filter((field) => !field.alreadySigned).map((field) => field.name)),
  ];

  it('flattens a signed field into the page without losing the mark', async () => {
    const source = fixture('signature-sample.pdf');
    const fields = await findSignatureFields(source);
    const { bytes } = await signFields(
      source,
      unsignedFields(fields).map((field) => ({ field, points: MARK })),
    );
    const flat = await flattenBytes(bytes);
    const out = text(flat.bytes);

    // The form is gone — that is what a flatten is — and with it every /Sig field.
    // Four signature fields and the text field: everything the form held.
    expect(flat.fieldsRemoved).toBe(6);
    expect(count(out, '/FT /Sig')).toBe(0);
    expect(count(out, '/Subtype /Widget')).toBe(0);
    // And the marks are page content now, which is the answer to "will it still read as
    // signed in a viewer with no form layer at all". Five because the field with two boxes
    // contributed two page-marked rectangles.
    expect(count(out, 'S Q')).toBe(5);
    // The text field's value is baked into the page as well, but it cannot be read off these
    // bytes as a string: the writer compresses the content streams it composes, which is why
    // the mark — written uncompressed, by us — is countable and the value is not. What can
    // be checked is that the form is really gone, by asking the flatten again.
    const twice = await flattenBytes(flat.bytes);
    expect(twice.fieldsRemoved).toBe(0);
    expect(twice.hadNoForm).toBe(true);
  });

  /*
   * The defect the 1,000-page stress pass found, reproduced on a two-page fixture: an
   * ordinary unsigned form has a signature box with no appearance, the writer's flatten
   * asks every widget for one, and `Unexpected N type: undefined` came back. So before
   * this, **Flatten failed on any form with a blank signature field** — which is every
   * form waiting to be signed.
   */
  it('flattens a form whose signature box was never signed', async () => {
    const unsigned = await flattenBytes(fixture('signature-sample.pdf'));
    const out = text(unsigned.bytes);

    expect(unsigned.fieldsRemoved).toBe(6);
    expect(unsigned.hadNoForm).toBe(false);
    expect(count(out, '/FT /Sig')).toBe(0);
    expect(count(out, '/Subtype /Widget')).toBe(0);
    // The blank box contributed nothing to draw, and no stray mark appeared for it.
    expect(count(out, 'S Q')).toBe(0);
    const after = await flattenBytes(unsigned.bytes);
    expect(after.fieldsRemoved).toBe(0);
    expect(after.hadNoForm).toBe(true);
  });

  it('carries a signature through a page move', async () => {
    const source = fixture('signature-sample.pdf');
    const fields = await findSignatureFields(source);
    const { bytes } = await signFields(
      source,
      unsignedFields(fields).map((field) => ({ field, points: MARK })),
    );
    const moved = await arrangePages(bytes, { order: [1, 0] });
    const after = await findSignatureFields(moved.bytes);

    expect(moved.pages).toBe(2);
    expect(after.map((f) => f.name)).toEqual([
      'sigPlain',
      'sigKid',
      'sigNoRotate',
      'sigAlreadySigned',
      'sigTwoBoxes',
      'sigTwoBoxes',
    ]);
    /*
     * Both pages' work moved with them: page 1's boxes are page 2's now, and the field
     * that carries a signature value still carries it. The last two are the one field's two
     * boxes, which land on opposite pages and must both survive the swap.
     */
    expect(after.map((f) => f.page)).toEqual([1, 1, 0, 0, 1, 0]);
    expect(after.filter((f) => f.alreadySigned).map((f) => f.name)).toEqual(['sigAlreadySigned']);
  });
});

/*
 * FR-36 on the writer. These loops are synchronous inside `@cantoo/pdf-lib`, so the honest contract is
 * narrower than "cancel a write": an abort stops the *next* step and always prevents the bytes arriving.
 * The last case below is the one that matters most — proving the guard is a guard and not a wall.
 */
describe('the writer honours an abort signal', () => {
  const aborted = () => {
    const controller = new AbortController();
    controller.abort();
    return controller.signal;
  };
  const isAbort = (error: unknown) =>
    error instanceof Error && error.name === 'AbortError' ? true : false;

  it('refuses to parse at all for arrangePages', async () => {
    await expect(
      arrangePages(fixture('page-order-sample.pdf'), { order: [2, 0, 1] }, { signal: aborted() }),
    ).rejects.toSatisfy(isAbort);
  });

  it('refuses to parse at all for findSignatureFields', async () => {
    await expect(
      findSignatureFields(fixture('signature-sample.pdf'), { signal: aborted() }),
    ).rejects.toSatisfy(isAbort);
  });

  it('refuses to parse at all for signFields', async () => {
    await expect(
      signFields(
        fixture('signature-sample.pdf'),
        [{ field: 'sigPlain', points: MARK }],
        { signal: aborted() },
      ),
    ).rejects.toSatisfy(isAbort);
  });

  it('refuses to flatten', async () => {
    await expect(flattenBytes(fixture('form-sample.pdf'), { signal: aborted() })).rejects.toSatisfy(
      isAbort,
    );
  });

  it('still does the work when nobody aborted, so the guard is not simply refusing everything', async () => {
    const controller = new AbortController();
    const result = await arrangePages(
      fixture('page-order-sample.pdf'),
      { order: [2, 0, 1] },
      { signal: controller.signal },
    );
    expect(result.bytes.length, 'a live signal must not stop the write').toBeGreaterThan(0);
    expect(result.pages).toBe(3);
  });

  it('leaves the source bytes untouched when it aborts, which is the whole point', async () => {
    const source = fixture('signature-sample.pdf');
    const before = source.slice();
    await expect(
      signFields(
        source,
        [{ field: 'sigPlain', points: MARK }],
        { signal: aborted() },
      ),
    ).rejects.toSatisfy(isAbort);
    // The caller's buffer is never mutated in place, aborted or not — a cancel that had already
    // half-written into the document would be worse than no cancellation at all.
    expect(source).toEqual(before);
  });
});

/*
 * FR-54 on the writer. Two families of failure reach a host from `/edit` — the peer faulting, and this
 * module refusing an instruction it cannot carry out — and neither is branchable while it is a bare
 * `Error`. The split between the three codes is the content of this block: a damaged file is the
 * document's fault, a bad page order is the caller's, and an abort is nobody's.
 */
describe('the writer codes its failures', () => {
  const capture = async (run: () => Promise<unknown>): Promise<unknown> => {
    try {
      await run();
    } catch (error) {
      return error;
    }
    throw new Error('the call was expected to fail');
  };

  it('names damaged bytes a parse failure, because the file is what broke', async () => {
    const error = await capture(() => flattenBytes(new Uint8Array([0x25, 0x50, 0x4c, 0x58, 1, 2, 3])));
    expect(isPdfError(error, 'PDF_PARSE_ERROR')).toBe(true);
    // The peer's own words survive: they are the diagnosis, and a support ticket needs them.
    expect((error as PdfError).message).toContain('Reading the document for writing');
    expect((error as PdfError).cause).toBeInstanceOf(Error);
  });

  it('names an impossible page order a configuration failure, with the numbers attached', async () => {
    const error = await capture(() => arrangePages(fixture('page-order-sample.pdf'), { order: [0, 20] }));
    expect(isPdfError(error, 'CONFIGURATION_ERROR')).toBe(true);
    expect((error as PdfError).details).toEqual({ page: 20, total: 20 });

    const angle = await capture(() =>
      arrangePages(fixture('page-order-sample.pdf'), { order: [0, 1], rotations: { 1: 45 } }),
    );
    expect(isPdfError(angle, 'CONFIGURATION_ERROR')).toBe(true);
    expect((angle as PdfError).details).toEqual({ angle: 45 });
  });

  it('keeps an abort an abort, whatever the writer was in the middle of', async () => {
    const controller = new AbortController();
    controller.abort();
    const error = await capture(() =>
      signFields(
        fixture('signature-sample.pdf'),
        [{ field: 'sigPlain', points: MARK }],
        { signal: controller.signal },
      ),
    );
    // A cancellation that arrived coded as `WRITER_ERROR` would be FR-04 collapsing into FR-54, and the
    // wrapper is the place it could happen: the peer is never reached, so this is all ours.
    expect(isPdfError(error, 'LOAD_CANCELLED')).toBe(true);
    expect(isCancellationCode((error as PdfError).code)).toBe(true);
  });
});
