/*
 * FR-45's ARIA clause at the layer the engine paints: every control a PDF puts on the page has to reach an
 * assistive technology with a name.
 *
 * This is the code half of what `npm run a11y:browser-record` (#267) found. Under jsdom the audit tests mount
 * the shell around a hand-built annotation layer, so the nine nodes axe counted in a real browser — seven
 * `label`, two `select-name`, one `link-name` — had never been the engine's own output in a test. The engine
 * writes `element.name = data.fieldName` and an `aria-label` only when the PDF supplied a `/TU` field label;
 * the fixture's AcroForm has none, which is the ordinary case in the wild, so a screen reader got a focusable
 * box and nothing to say about it.
 *
 * Seven claims:
 *
 *  - the field name is used as the name when nothing else supplies one, on a text input (whose `name` the
 *    engine sets) and on a checkbox (whose it is not — the annotation is then the only source);
 *  - **a name that exists is never overwritten**, from whichever of the accname sources it came;
 *  - a link is named from what the document says about it — `/TU`, contents, URL, destination, in that order;
 *  - a link the document says nothing about gets the shell's own word for what a link is, and **stays in the
 *    tab order**: the alternative was `aria-hidden`, which silences the audit and takes a working `/Dest`
 *    navigation from the keyboard reader while the mouse user keeps it;
 *  - a control with no name anywhere is **reported, not renamed** — `stillUnnamed` is the honest answer, and a
 *    placeholder on a text field would let a reader type into the wrong one believing they had not;
 *  - the pass says what it did (`named` / `namedByDefault` / `stillUnnamed`), because a silent pass is
 *    indistinguishable from one that never reached the nodes;
 *  - the pass is wired into the page's own annotation render, asserted against the source: a shell that stopped
 *    calling it would leave these tests green and the widgets unnamed.
 */
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeEach, describe, expect, it } from 'vitest';

import { nameUnnamedWidgets } from './annotation-names';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const LINK = 'Link';

function layer(markup: string): HTMLElement {
  const div = document.createElement('div');
  div.className = 'pjsr-annotation-layer';
  div.innerHTML = markup;
  document.body.append(div);
  return div;
}

const widget = (id: string) => `id="pdfjs_internal_id_${id}" data-element-id="${id}"`;

beforeEach(() => {
  document.body.replaceChildren();
});

describe('FR-45: a widget the PDF never labelled still has to arrive with a name', () => {
  it('names a text input from the field name the engine already put on it', () => {
    const container = layer(`<input type="text" ${widget('10R')} name="fullName" value="Ada Lovelace">`);
    const result = nameUnnamedWidgets(container, [{ id: '10R', fieldName: 'fullName' }], LINK);

    expect(container.querySelector('input')?.getAttribute('aria-label'), 'the name a reader hears').toBe('fullName');
    expect(result.named, 'the pass reports what it named, or a silent pass looks like a working one').toEqual(['10R']);
    expect(result.stillUnnamed).toEqual([]);
    expect(result.namedByDefault, 'the document had this name, not the shell').toEqual([]);
  });

  it('reaches into the annotation for a checkbox, which carries no name attribute', () => {
    const container = layer(`<input type="checkbox" ${widget('12R')} exportvalue="Yes">`);
    const result = nameUnnamedWidgets(container, [{ id: '12R', fieldName: 'subscribe' }], LINK);

    expect(container.querySelector('input')?.getAttribute('aria-label')).toBe('subscribe');
    expect(result.named).toEqual(['12R']);
  });

  it('leaves alone a control the document, the author or the structure layer already named', () => {
    const container = layer(
      [
        `<input type="text" ${widget('1R')} name="a" aria-label="Already labelled">`,
        `<input type="text" ${widget('2R')} name="b" title="A title is a name">`,
        `<label for="pdfjs_internal_id_3R">Written beside it</label><input type="text" ${widget('3R')} name="c">`,
        `<label><input type="text" name="d"></label>`,
        `<select ${widget('4R')} name="e" aria-labelledby="heading"></select>`,
        `<span id="heading">Choice</span>`,
      ].join(''),
    );
    const before = [...container.querySelectorAll('input, select')].map((el) => el.outerHTML);
    const result = nameUnnamedWidgets(
      container,
      [
        { id: '1R', fieldName: 'x' },
        { id: '2R', fieldName: 'y' },
        { id: '3R', fieldName: 'z' },
        { id: '4R', fieldName: 'w' },
      ],
      LINK,
    );

    expect([...container.querySelectorAll('input, select')].map((el) => el.outerHTML), 'untouched').toEqual(before);
    expect(result.named, 'nothing to name, so nothing named').toEqual([]);
  });

  it('names a link from what the document says about it, in the order a reader would trust', () => {
    const container = layer(
      [
        `<a ${widget('20R')} href="#"></a>`,
        `<a ${widget('21R')} href="#"></a>`,
        `<a ${widget('22R')} href="#"></a>`,
        `<a ${widget('23R')} href="#">Read this text</a>`,
      ].join(''),
    );
    const result = nameUnnamedWidgets(
      container,
      [
        { id: '20R', title: 'Annual report', url: 'https://example.com/annual.pdf' },
        { id: '21R', contents: 'A comment on the link' },
        { id: '22R', dest: 'Cover' },
        { id: '23R', url: 'https://example.com/ignored' },
      ],
      LINK,
    );

    const [title, contents, dest, textLink] = [...container.querySelectorAll('a')];
    expect(title?.getAttribute('aria-label'), 'the /TU wins over the URL').toBe('Annual report');
    expect(contents?.getAttribute('aria-label')).toBe('A comment on the link');
    expect(dest?.getAttribute('aria-label'), 'a named destination is text the document wrote').toBe('Cover');
    expect(textLink?.hasAttribute('aria-label'), 'a link with text needs no label').toBe(false);
    expect(result.namedByDefault, 'every one of these names came from the document').toEqual([]);
  });

  it('lends a link the shell’s own word when the document has none, and leaves it focusable', () => {
    // The shape pdf.js actually hands over for `form-sample.pdf`'s one link annotation: a `/Dest` array of
    // reference and action objects, none of which is text. That is the case the real-browser audit caught —
    // the fixture's GoTo link, named by nothing in the document.
    const container = layer(`<a ${widget('26R')} href="#"></a>`);
    const result = nameUnnamedWidgets(
      container,
      [{ id: '26R', dest: [{ name: '4 R' }, { name: 'XYZ' }, null, null, null] }],
      LINK,
    );

    const link = container.querySelector('a');
    expect(link?.getAttribute('aria-label'), 'named as what it is, not as what it goes to').toBe(LINK);
    expect(link?.hasAttribute('aria-hidden'), 'it stays in the tree').toBe(false);
    expect(link?.tabIndex, 'and in the tab order, so the keyboard reader can still follow it').toBeGreaterThanOrEqual(
      0,
    );
    expect(result.namedByDefault).toEqual(['26R']);
  });

  it('reports a control it cannot name instead of inventing a label for it', () => {
    const container = layer('<input type="text" data-element-id="99R">');
    const result = nameUnnamedWidgets(container, [{ id: '99R' }], LINK);

    expect(result.stillUnnamed, 'the browser audit has to keep seeing this one').toEqual(['99R']);
    expect(container.querySelector('input')?.hasAttribute('aria-label'), 'no placeholder name').toBe(false);
  });

  it('is called by the page right after the engine renders the layer', () => {
    /*
     * The function is only half the fix: a shell that stopped calling it would leave every test above green and
     * the widgets unnamed, and the next browser audit is the thing that would notice — which is a report, not a
     * guard. Read off the source, because the ordering (after `layer.render`, before the `end('annotations')`
     * mark) is the claim: naming before the engine has written the elements is naming nothing.
     */
    const source = readFileSync(join(repo, 'src/components/PdfPage.tsx'), 'utf8');
    const call = 'nameUnnamedWidgets(container, annotations, labels.linkAnnotation)';
    const rendered = source.indexOf('await layer.render(');
    const named = source.indexOf(call);
    const ended = source.indexOf("if (!cancelled) end('annotations')", rendered);
    /*
     * Every message below carries the three indices, because `expected -1 to be greater than -1` is the shape of
     * a failure that indicts the reader rather than the page: the first run of this case said the call was
     * missing, which is true, and did not say that `await layer.render(` had also moved out of the file.
     */
    const where = `in src/components/PdfPage.tsx: await layer.render( at ${rendered}, ${call} at ${named}, end('annotations') at ${ended} (-1 means not found)`;

    expect(rendered, `the page renders the annotation layer. ${where}`).toBeGreaterThan(-1);
    expect(ended, `and marks the layer done, which is the ordering this case is about. ${where}`).toBeGreaterThan(rendered);
    expect(named, `then names the widgets the engine left unnamed. ${where}`).toBeGreaterThan(-1);
    expect(named, `after the render resolves. ${where}`).toBeGreaterThan(rendered);
    expect(named, `before the layer is marked done, so a reader never sees the unnamed state. ${where}`).toBeLessThan(ended);
  });
});
