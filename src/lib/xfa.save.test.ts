/*
 * FR-33's save half, measured rather than inferred — because the clause as written was broader than the
 * reason in §2.5, and the difference is a reader losing a save they were promised.
 *
 * §2.5 refuses an XFA save for a stated reason: "XFA submit and save are Adobe LiveCycle behaviour with no
 * open implementation", so an attempt would corrupt rather than commit. That reason is about the *packet*.
 * FR-33's last sentence, however, said "Saving an XFA document is refused" — which reads as every document
 * declaring `/XFA`, including the mixed ones where the AcroForm is authoritative and the packet is inert.
 * The code refused only `isPureXfa`. One of the two had to move, so the engine was asked.
 *
 * What this file measures, on the real engine and the committed fixtures, with `enableXfa: true` — the
 * option the package passes by default, without which pdf.js never sets `isPureXfa` at all and the whole
 * question is answered about a configuration nobody ships:
 *
 *  - a **pure-XFA** document cannot be committed: `saveDocument()` rejects. The refusal is not a policy
 *    choice made from caution, it is what the engine does.
 *  - a **hybrid** document (both `/XFA` and `/AcroForm`/`Fields`) commits and reopens with both packets
 *    still declared. Refusing it would deny FR-20's save to a reader whose form the AcroForm actually drives.
 *
 * What is deliberately **not** claimed here: that a value typed into the hybrid's widget survives the save.
 * Writing through `annotationStorage.setValue` from Node fails on this fixture *and* on the plain AcroForm
 * one, identically, which makes it a harness limit rather than an XFA fact — so it is recorded as a gap
 * rather than asserted in either direction.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { describe, expect, it } from 'vitest';

const fixture = (name: string): Uint8Array =>
  new Uint8Array(readFileSync(join(process.cwd(), 'playground', 'fixtures', name)));

const load = (bytes: Uint8Array) =>
  getDocument({ data: bytes, enableXfa: true, isEvalSupported: false }).promise;

const flags = async (doc: { getMetadata: () => Promise<{ info: Record<string, unknown> }> }) => {
  const { info } = await doc.getMetadata();
  return {
    xfa: info.IsXFAPresent === true,
    acroform: info.IsAcroFormPresent === true,
  };
};

describe('FR-33: which XFA document the save refusal is about', () => {
  it('refuses the pure-XFA document because the engine cannot commit it', async () => {
    const doc = await load(fixture('xfa-sample.pdf'));
    const declared = await flags(doc);
    expect(declared, 'the fixture declares an XFA packet and no AcroForm').toEqual({ xfa: true, acroform: false });
    // `isPureXfa` is the discriminator the package's `renderedFromXfa` capability reports, so the refusal
    // branch in `usePdfDownload` keys on exactly the value this asserts.
    expect(doc.isPureXfa, 'pdf.js composes this document from the template').toBe(true);
    await expect(doc.saveDocument()).rejects.toThrow();
    await doc.cleanup?.();
  });

  it('commits the hybrid document, whose pages the AcroForm drives, and the bytes reopen intact', async () => {
    const doc = await load(fixture('xfa-hybrid-sample.pdf'));
    const declared = await flags(doc);
    expect(declared, 'both technologies are declared, which §3.5 reports as `mixed`').toEqual({
      xfa: true,
      acroform: true,
    });
    expect(doc.isPureXfa, 'and the template is not what is on screen').toBe(false);

    const page = await doc.getPage(1);
    const widgets = (await page.getAnnotations()).filter((annotation) => annotation.subtype === 'Widget');
    expect(widgets.length, 'the AcroForm exposes a real widget, so there is a form to save').toBeGreaterThan(0);

    const bytes = await doc.saveDocument();
    expect(bytes?.length, 'the commit produced bytes').toBeGreaterThan(0);

    const again = await load(new Uint8Array(bytes));
    expect(again.numPages, 'the saved file reopens').toBe(1);
    expect(await flags(again), 'and still declares both packets — the save did not drop the XFA it cannot rebuild').toEqual({
      xfa: true,
      acroform: true,
    });
    await doc.cleanup?.();
  });

  it('keeps the two cases distinguishable, which is the whole content of the clause', async () => {
    // The refusal and the save are not the same document wearing different hats: `isPureXfa` separates
    // them, and it is the same value `reportCapabilities` publishes as `renderedFromXfa`. If a future
    // engine stops setting it, this case fails and the clause has to be re-read rather than quietly
    // widened.
    const pure = await load(fixture('xfa-sample.pdf'));
    const hybrid = await load(fixture('xfa-hybrid-sample.pdf'));
    expect(pure.isPureXfa).not.toBe(hybrid.isPureXfa);
    expect(await flags(pure)).not.toEqual(await flags(hybrid));
    await pure.cleanup?.();
    await hybrid.cleanup?.();
  });
});
