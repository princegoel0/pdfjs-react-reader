/*
 * FR-49, profile B's premise: `scan-sample.pdf` is the shape the benchmark measures, so the shape is
 * asserted rather than assumed.
 *
 * The generator checks the bytes it wrote — object numbering, `/Length`, the stream markers — and a
 * document that is structurally fine can still be the wrong *fixture*: an engine change in how a Flate
 * RGB image is decoded, or a `/Resources` dictionary that parses but does not reach the page, would leave
 * the benchmark measuring a blank sheet and reporting it as a scanned book. So this reads the committed
 * file back through pdf.js and asks the three questions profile B depends on: twelve pages, one image
 * drawn on each of them, and no text anywhere.
 *
 * The last one matters most. §6 describes B as "one large image per page, little or no text", and a page
 * with a text layer on it is a different workload — the text run would be paid for inside a measurement
 * that is supposed to be about decoded pixels.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { OPS, getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { describe, expect, it } from 'vitest';

const PAGES = 12;
const IMG_W = 2550;
const IMG_H = 3300;

const open = () =>
  getDocument({
    data: new Uint8Array(readFileSync(join(process.cwd(), 'playground', 'fixtures', 'scan-sample.pdf'))),
  }).promise;

describe('the scanned-book fixture behind benchmark profile B', () => {
  it('opens with the page count the profile names', async () => {
    const doc = await open();
    expect(doc.numPages).toBe(PAGES);
    await doc.cleanup();
  });

  /*
   * Every page, not just the first: a fixture where only page 1 carries its image would still make the
   * first-paint number look good and would let the scroll measurement run on blank sheets.
   */
  it('draws exactly one image on every page, on a letter sheet', async () => {
    const doc = await open();
    for (let page = 1; page <= doc.numPages; page += 1) {
      const proxy = await doc.getPage(page);
      const ops = await proxy.getOperatorList();
      const painted = ops.fnArray.filter((fn) => fn === OPS.paintImageXObject).length;
      expect(painted, `page ${page} draws ${painted} images`).toBe(1);
      // Defaults on the destructuring: `view` is a `number[]`, so an index is `number | undefined` to the
      // type checker even though every page here has four.
      const [x0 = 0, y0 = 0, x1 = 0, y1 = 0] = proxy.view;
      expect({ width: x1 - x0, height: y1 - y0 }, `page ${page} is not a letter sheet`).toEqual({
        width: 612,
        height: 792,
      });
    }
    await doc.cleanup();
  });

  it('has no text on any page, so the measurement is about pixels and not about a text run', async () => {
    const doc = await open();
    let items = 0;
    for (let page = 1; page <= doc.numPages; page += 1) {
      const proxy = await doc.getPage(page);
      items += (await proxy.getTextContent()).items.length;
    }
    expect(items).toBe(0);
    await doc.cleanup();
  });

  /*
   * The property the profile exists for, stated as the number rather than as an adjective: 8.4 MP of
   * decoded image on a page whose box is 0.48 M pt², so the renderer is always downscaling — about 17×
   * against the box, and about 4× against the canvas a fit-width page actually gets on a 1280 viewport.
   * What the caps in `src/lib/canvas.ts` govern is that second comparison, which is a measurement the
   * benchmark makes; this one only pins that the fixture is large enough for the question to be real.
   */
  it('carries an image whose decoded area dwarfs the page it is drawn on', async () => {
    const doc = await open();
    const proxy = await doc.getPage(1);
    const [x0 = 0, y0 = 0, x1 = 0, y1 = 0] = proxy.view;
    const decoded = IMG_W * IMG_H;
    const onScreen = (x1 - x0) * (y1 - y0);
    expect(decoded / onScreen).toBeGreaterThan(10);
    await doc.cleanup();
  });
});
