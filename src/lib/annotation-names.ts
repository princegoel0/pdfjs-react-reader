/*
 * FR-45's "valid ARIA tree" clause, met at the one layer of the shell the engine paints into.
 *
 * `npm run a11y:browser-record` (added with this file) runs axe inside chromium, firefox and webkit over a
 * document whose AcroForm the engine has turned into real HTML controls, and it found what the jsdom audits
 * structurally could not see: seven form controls with no accessible name, two `<select>`s with none, and one
 * `<a>` with none either. Under jsdom those nodes are never laid out and the audit tests mount the shell around
 * a hand-built layer rather than the one pdf.js writes, so the rules either did not run or had nothing to look
 * at.
 *
 * The cause is the engine's, and it is a gap in what a PDF can carry rather than a bug: pdf.js copies the
 * widget's fully qualified field name onto the control's `name` attribute (`element.name = data.fieldName`,
 * three places in `build/pdf.mjs`) and emits an `aria-label` only when the *document* supplied a field label —
 * the `/TU` entry. A form built without `/TU` is the ordinary case in the wild, so a screen reader got a
 * focusable box and nothing to say about it. The name the document does not carry is the one it does carry: the
 * field name, which is what the sighted reader sees beside the box.
 *
 * Three rules this pass follows, because a name that lies is worse than the gap it fills:
 *
 *  - **an element that already has a name is left alone** — `aria-label`, `aria-labelledby`, `title`, `alt`, an
 *    associated or wrapping `<label>`, and `aria-owns` (the structure layer's own answer for a link drawn over
 *    marked words, which FR-43 pays for) all count as a name;
 *  - a link is named from what the document says about it — `/TU`, contents, URL, destination, in that order —
 *    and the shell's own word for a link comes last, and only for a link. The alternative was measured on the
 *    fixture: `aria-hidden` plus `tabindex = -1` silences axe and takes a working `/Dest` navigation away from
 *    the keyboard reader while the mouse user keeps it, which trades a conformance number for a capability;
 *  - **an unnamed control is reported, not renamed.** "Form field" as a name tells a reader nothing about
 *    *which* field they are typing into, and a value written into the wrong field is worse than a violation the
 *    audit keeps reporting. `stillUnnamed` is that report — and the channel that carries it to a release is the
 *    record, not the shell: `PdfPage` calls the pass and discards the result, because the viewer has no surface
 *    for a per-page naming warning, while `scripts/a11y-browser-record.mjs` reads the same DOM state back into
 *    `a11y/browser.json` and `src/lib/a11y-browser-record.test.ts` fails the record on any control or link that
 *    arrives without a name.
 */

/** The parts of a pdf.js annotation object this pass can read; typed loosely so a stub in a test is enough. */
export interface WidgetAnnotation {
  id?: string;
  fieldName?: string | null;
  label?: string | null;
  title?: string | null;
  contents?: string | null;
  url?: string | null;
  dest?: unknown;
}

export interface WidgetNamingResult {
  /** Controls named from the field name the document carries. */
  named: string[];
  /** Links the document said nothing about, named with the shell's own word instead. */
  namedByDefault: string[];
  /** Focusable controls still without an accessible name — reported, not papered over. */
  stillUnnamed: string[];
}

const text = (value: unknown): string => (typeof value === 'string' ? value.trim() : '');

/**
 * Does this element already have an accessible name?
 *
 * The attribute list is the accname set axe accepts, in the order a reader would resolve it. `aria-owns` counts
 * because the structure layer gives a link the ownership of the words it is drawn over, and those words *are*
 * its name — the FR-43 path, which this pass must not overwrite.
 */
function hasAccessibleName(el: Element): boolean {
  for (const attribute of ['aria-label', 'aria-labelledby', 'aria-owns', 'title', 'alt']) {
    if (text(el.getAttribute(attribute)) !== '') return true;
  }
  const id = text(el.id);
  if (id) {
    const escaped = id.replace(/["\\]/g, '\\$&');
    if (el.ownerDocument.querySelector(`label[for="${escaped}"]`)) return true;
  }
  return el.closest('label') !== null;
}

/** The pdf.js annotation id behind an element: `data-element-id`, or the `pdfjs_internal_id_…` it also sets. */
function annotationId(el: Element): string {
  const direct = text(el.getAttribute('data-element-id'));
  if (direct) return direct;
  const id = text(el.id);
  return id.startsWith('pdfjs_internal_id_') ? id.slice('pdfjs_internal_id_'.length) : '';
}

/**
 * The readable part of a destination, if it has one.
 *
 * pdf.js hands a `/Dest` over as an array whose first entry is a page reference object and whose second is the
 * action name, so the strings in it are the only thing the document actually said. An empty answer is normal,
 * and is why the shell keeps a word of its own.
 */
function destinationLabel(dest: unknown): string {
  if (typeof dest === 'string') return dest;
  if (Array.isArray(dest)) return dest.map((part) => text(part)).filter(Boolean).join(' ');
  if (dest && typeof dest === 'object') {
    const named = dest as { name?: unknown; dest?: unknown };
    return text(named.name) || destinationLabel(named.dest);
  }
  return '';
}

/**
 * Give every unnamed control in an annotation layer the name the document already carries for it.
 *
 * Run after `AnnotationLayer.render()` resolves, over the layer's own container: the elements are the engine's,
 * and this only adds attributes it left out. The result says what changed rather than only "done" — a pass that
 * silently renamed nothing is indistinguishable from one that never reached the nodes, which is how #215's
 * guard passed vacuously on Windows path separators.
 */
export function nameUnnamedWidgets(
  container: HTMLElement,
  annotations: readonly WidgetAnnotation[],
  linkFallback: string,
): WidgetNamingResult {
  const byId = new Map<string, WidgetAnnotation>();
  for (const annotation of annotations) {
    const id = text(annotation.id);
    if (id) byId.set(id, annotation);
  }

  const named: string[] = [];
  const namedByDefault: string[] = [];
  const stillUnnamed: string[] = [];

  for (const el of container.querySelectorAll('input, select, textarea')) {
    if (hasAccessibleName(el)) continue;
    const id = annotationId(el);
    const annotation = byId.get(id);
    const label =
      text(annotation?.fieldName) ||
      text(annotation?.label) ||
      text(el.getAttribute('name')) ||
      text(annotation?.contents) ||
      text(annotation?.title);
    if (label) {
      el.setAttribute('aria-label', label);
      named.push(id || label);
    } else {
      stillUnnamed.push(id || text(el.getAttribute('type')) || 'control');
    }
  }

  for (const el of container.querySelectorAll('a')) {
    if (hasAccessibleName(el)) continue;
    if (text(el.textContent) !== '') continue;
    const id = annotationId(el);
    const annotation = byId.get(id);
    const fromDocument =
      text(annotation?.title) ||
      text(annotation?.contents) ||
      text(annotation?.url) ||
      destinationLabel(annotation?.dest);
    const label = fromDocument || text(linkFallback);
    if (!label) continue;
    el.setAttribute('aria-label', label);
    (fromDocument ? named : namedByDefault).push(id || label);
  }

  return { named, namedByDefault, stillUnnamed };
}
