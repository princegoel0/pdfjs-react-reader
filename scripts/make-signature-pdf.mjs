// Generates playground/fixtures/signature-sample.pdf — the document that makes
// FR-16's last unproven half measurable: a form whose signature fields are real
// `/FT /Sig` widgets, in the three shapes a reader's file actually arrives in:
//   page 1: sigPlain    — the field *is* the widget, and it carries no /AP, so any
//                          mark that shows up there was written by us
//   page 1: sigKid      — a parent field node with the widget in /Kids and the /AP on
//                          the kid, which is the shape Acrobat produces for a form
//                          signed in more than one place
//   page 2: sigNoRotate — the widget sets /F 20 (PRINT|NOROTATE). pdf.js's
//                          SignatureWidgetAnnotation derives `hasOwnCanvas` from that
//                          flag, which routes the appearance into a separate canvas
//                          rather than into the page — so this row measures the other
//                          rendering path rather than repeating the first
// The three /Sig fields deliberately carry no /V: a value there would tell every
// reader in the world that the document holds a cryptographic signature, and this
// fixture proves only that a drawn mark can be written.
//
// Two files come out of this: `signature-sample.pdf`, the empty form the tests and the panel read,
// and `signature-signed-sample.pdf`, the same file with a mark already in each unsigned box, which
// is what a browser needs in order to look at a signed page rather than produce one.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PDFArray, PDFDict, PDFDocument, PDFName, PDFSignature } from '@cantoo/pdf-lib';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const PAGE1 = 4;
const PAGE2 = 5;
const SIG_PLAIN = 10;
const SIG_NOROTATE = 11;
const SIG_PARENT = 12;
const SIG_KID = 13;
const TEXT_FIELD = 14;
const AP_KID = 50;
const AP_NOROTATE = 51;
// A field that arrives already signed, which is the case `signFields` must refuse: a `/V` on
// a `/Sig` field is somebody's claim over the bytes, and a picture drawn into the same box
// leaves the file still making that claim while no longer keeping it.
const SIG_SIGNED = 15;
const AP_SIGNED = 52;

// Rects are page coordinates, and the appearance /BBox values below match them
// exactly. Declaring the appearances in page space rather than in a 0-anchored
// local space with a /Matrix is what lets a mark drawn in PDF user space be
// written into the appearance without any coordinate translation at all.
const RECT_PLAIN = [72, 660, 272, 720];
// Deliberately a different size from the other two boxes: one mark scaled into a box of
// 150x40 and another into 200x60 is the claim that the mark is stored relative to its box.
const RECT_KID = [72, 570, 222, 610];
const RECT_NOROTATE = [72, 660, 272, 720];
const RECT_SIGNED = [72, 560, 272, 620];

const rect = (r) => `[${r.join(' ')}]`;
const objects = new Map();

objects.set(1, '<< /Type /Catalog /Pages 2 0 R /AcroForm 30 0 R >>');
objects.set(2, '<< /Type /Pages /Kids [4 0 R 5 0 R] /Count 2 >>');
objects.set(3, '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');
objects.set(
  PAGE1,
  '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] ' +
    `/Resources << /Font << /F1 3 0 R >> >> /Contents 60 0 R ` +
    `/Annots [${TEXT_FIELD} 0 R ${SIG_PLAIN} 0 R ${SIG_PARENT} 0 R ${SIG_KID} 0 R] >>`,
);
objects.set(
  PAGE2,
  '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] ' +
    `/Resources << /Font << /F1 3 0 R >> >> /Contents 61 0 R ` +
    `/Annots [${SIG_NOROTATE} 0 R ${SIG_SIGNED} 0 R] >>`,
);

/*
 * /F 4 is the PRINT flag; /F 20 adds NOROTATE (0x10), which is the bit pdf.js reads
 * as `noRotate` and turns into `hasOwnCanvas` for a signature widget. Nothing else in
 * the fixture sets it, so the two shapes isolate the two code paths.
 */
objects.set(
  SIG_PLAIN,
  `<< /Type /Annot /Subtype /Widget /F 4 /Rect ${rect(RECT_PLAIN)} /P ${PAGE1} 0 R ` +
    '/FT /Sig /T (sigPlain) >>',
);
objects.set(
  SIG_NOROTATE,
  `<< /Type /Annot /Subtype /Widget /F 20 /Rect ${rect(RECT_NOROTATE)} /P ${PAGE2} 0 R ` +
    `/FT /Sig /T (sigNoRotate) /AP << /N ${AP_NOROTATE} 0 R >> >>`,
);
objects.set(
  SIG_PARENT,
  `<< /FT /Sig /T (sigKid) /Kids [${SIG_KID} 0 R] >>`,
);
objects.set(
  SIG_KID,
  `<< /Type /Annot /Subtype /Widget /F 4 /Rect ${rect(RECT_KID)} /P ${PAGE1} 0 R ` +
    `/Parent ${SIG_PARENT} 0 R /AP << /N ${AP_KID} 0 R >> >>`,
);
/*
 * The signed field's `/V` is a signature dictionary with a name and a date and no
 * `/ByteRange`, which is what a detached or damaged signature looks like: readers will call it
 * invalid, and that is the right answer to it. What matters to this fixture is that the key is
 * there, because that is the key `signFields` refuses to touch.
 */
objects.set(
  SIG_SIGNED,
  `<< /Type /Annot /Subtype /Widget /F 4 /Rect ${rect(RECT_SIGNED)} /P ${PAGE2} 0 R ` +
    `/FT /Sig /T (sigAlreadySigned) /V << /Type /Sig /Name (Test Signer) /M (D:20260927120000Z) >> ` +
    `/AP << /N ${AP_SIGNED} 0 R >> >>`,
);
objects.set(
  TEXT_FIELD,
  `<< /Type /Annot /Subtype /Widget /F 4 /Rect [72 730 272 746] /P ${PAGE1} 0 R ` +
    '/FT /Tx /T (title) /V (Q3 report) /DA (/F1 10 Tf 0 g) >>',
);

objects.set(
  30,
  `<< /Fields [${TEXT_FIELD} 0 R ${SIG_PLAIN} 0 R ${SIG_PARENT} 0 R ${SIG_NOROTATE} 0 R ${SIG_SIGNED} 0 R] ` +
    '/DR << /Font << /F1 3 0 R >> >> /DA (/F1 0 Tf 0 g) >>',
);

const emptyAppearance = (num, r) =>
  objects.set(num, {
    dict: `/Type /XObject /Subtype /Form /BBox ${rect(r)} /Resources << >>`,
    stream: '',
  });
emptyAppearance(AP_KID, RECT_KID);
emptyAppearance(AP_NOROTATE, RECT_NOROTATE);
// Not empty: a field that has been signed shows something, and `hasAppearance` says true.
objects.set(AP_SIGNED, {
  dict: `/Type /XObject /Subtype /Form /BBox ${rect(RECT_SIGNED)} /Resources << >>`,
  // A filled band, so the fixture carries no stroke operator for a test to mistake for its
  // own: `S Q` is the count the signature tests read, and it has to start at zero.
  stream: '0.35 0.38 0.45 rg 82 588 160 3 re f',
});

const text = (body, x, y, size) => `BT /F1 ${size} Tf ${x} ${y} Td (${body}) Tj ET`;
const stream = (lines) => ({ dict: '', stream: lines.join('\n') });

objects.set(
  60,
  stream([
    text('Signature fixture', 72, 762, 16),
    text('title (a text field, to prove the others survive a write):', 72, 750, 9),
    text('sigPlain - a /Sig widget with no /AP:', 72, 726, 9),
    text('sigKid - a parent field, the /AP on its widget kid:', 72, 630, 9),
  ]),
);
objects.set(
  61,
  stream([
    text('Page two', 72, 762, 16),
    text('sigNoRotate - /F 20, so pdf.js gives it its own canvas:', 72, 726, 9),
  ]),
);

/*
 * The self-checks, in the house style: every one of these was violated by an earlier
 * draft of this file, and each violation fails later as an opaque "nothing rendered"
 * rather than as a message. A fixture that exists to make a claim measurable has to
 * refuse to write a wrong one.
 */
const dict = (num) => {
  const value = objects.get(num);
  if (value === undefined) throw new Error(`object ${num} is not written at all`);
  return typeof value === 'string' ? value : `<< ${value.dict} >>`;
};
const refsIn = (source) => [...source.matchAll(/(\d+) 0 R/g)].map((m) => Number(m[1]));

const bodies = [...objects.keys()].map(dict).join('\n');
for (const num of new Set(refsIn(bodies))) {
  if (!objects.has(num)) throw new Error(`a dictionary names ${num} 0 R, which this file does not hold`);
}

// Three signature fields, and exactly one of them reached through /Kids.
const sigs = [SIG_PLAIN, SIG_NOROTATE, SIG_PARENT].filter((n) => dict(n).includes('/FT /Sig'));
if (sigs.length !== 3) throw new Error(`expected 3 /FT /Sig fields, found ${sigs.length}`);
if (!dict(SIG_PARENT).includes('/Kids')) throw new Error('sigKid must reach its widget through /Kids');
if (!dict(SIG_KID).includes(`/Parent ${SIG_PARENT}`)) throw new Error('the widget kid must name its parent');
if (dict(SIG_KID).includes('/FT')) throw new Error('/FT belongs on the parent, not on the kid');

// Three of the four are unsigned: no `/V` anywhere a reader could mistake for a value. The
// fourth is the refusal case, and it is the only object in the file with one.
for (const num of [SIG_PLAIN, SIG_NOROTATE, SIG_PARENT, SIG_KID]) {
  if (dict(num).includes('/V ')) throw new Error(`object ${num} carries a /V, so it would read as signed`);
}
if (!dict(SIG_SIGNED).includes('/V << /Type /Sig')) throw new Error('the signed field lost its /V');
if (bodies.split('/V << /Type /Sig').length - 1 !== 1) {
  throw new Error('exactly one field in this file is signed, and the count is the point');
}

// sigPlain must be the only one without an appearance, or "a mark appeared" proves nothing.
if (dict(SIG_PLAIN).includes('/AP')) throw new Error('sigPlain must start with no /AP');
for (const [num, ap, r] of [
  [SIG_KID, AP_KID, RECT_KID],
  [SIG_NOROTATE, AP_NOROTATE, RECT_NOROTATE],
]) {
  if (!dict(num).includes(`/AP << /N ${ap} 0 R >>`)) throw new Error(`object ${num} does not name its appearance`);
  if (!dict(ap).includes(rect(r))) {
    throw new Error(`appearance ${ap} has a /BBox that is not its widget's /Rect ${rect(r)}`);
  }
  if (objects.get(ap).stream !== '') throw new Error(`appearance ${ap} is not empty, so the before-state would paint`);
}

// Every widget the form lists must be reachable, and the kid must not be listed twice.
const fields = dict(30);
for (const num of [TEXT_FIELD, SIG_PLAIN, SIG_PARENT, SIG_NOROTATE]) {
  if (!fields.includes(`${num} 0 R`)) throw new Error(`/Fields omits ${num}, so the form would not hold it`);
}
if (fields.includes(`${SIG_KID} 0 R`)) throw new Error('/Fields must name the parent, never the widget kid');
if (!fields.includes(`${SIG_SIGNED} 0 R`)) throw new Error('/Fields must list the signed field, or nothing would refuse it');

// ---- assembly ----
const maxNum = Math.max(...objects.keys());
let pdf = '%PDF-1.4\n';
const offsets = new Array(maxNum + 1).fill(0);
for (const num of [...objects.keys()].sort((a, b) => a - b)) {
  const obj = objects.get(num);
  offsets[num] = pdf.length;
  if (typeof obj === 'string') {
    pdf += `${num} 0 obj\n${obj}\nendobj\n`;
  } else {
    pdf += `${num} 0 obj\n<< ${obj.dict} /Length ${obj.stream.length} >>\nstream\n${obj.stream}\nendstream\nendobj\n`;
  }
}

const size = maxNum + 1;
const xrefStart = pdf.length;
pdf += `xref\n0 ${size}\n0000000000 65535 f \n`;
for (let num = 1; num < size; num++) {
  pdf += offsets[num]
    ? `${String(offsets[num]).padStart(10, '0')} 00000 n \n`
    : '0000000000 65535 f \n';
}
pdf += `trailer\n<< /Size ${size} /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF\n`;

const out = join(root, 'playground', 'fixtures', 'signature-sample.pdf');
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, pdf, 'latin1');
console.log(`wrote ${out} (${pdf.length} bytes)`);

// The second output, which exists so `#144` can be answered in a browser by someone who opens
// a file rather than writes one: the same document with a mark already in each of the three
// unsigned boxes. `signature-sample.pdf` cannot stand in for it, because the question is what a
// reader sees on a page that was signed before it was loaded, and an empty box and a filled one
// are not the same measurement.
//
// This mirrors `signFields` — widget resolution through `/Kids`, an `/XObject /Form` whose `/BBox`
// is the widget's own `/Rect`, registered through `doc.context` — rather than calling it: the
// shipped writer lives in TypeScript and a fixture generator has to run with `node scripts/…`
// alone. The bytes it produces are checked against the same rules below, and `pdf-write.test.ts`
// holds the equivalent assertions for the product path.
const SHAPES = { sigPlain: 'wave', sigKid: 'loop', sigNoRotate: 'zig' };

/**
 * Three different silhouettes, deliberately. If every box got the same mark, an appearance that
 * landed in the wrong rectangle would still be a non-zero pixel count and the browser check would
 * report a pass for the file being wrong.
 */
function mark([x0, y0, x1, y1], shape) {
  const pad = 8;
  const left = x0 + pad;
  const right = x1 - pad;
  const mid = (y0 + y1) / 2;
  const amp = (y1 - y0) / 2 - pad;
  const steps = 30;
  const pts = [];
  for (let i = 0; i <= steps; i += 1) {
    const t = i / steps;
    const x = left + (right - left) * t;
    let y;
    if (shape === 'wave') y = mid + amp * 0.7 * Math.sin(t * Math.PI * 3);
    else if (shape === 'loop') y = mid + amp * 0.8 * Math.sin(t * Math.PI * 2) * Math.cos(t * Math.PI);
    else y = mid + amp * 0.9 * (t < 0.5 ? -1 : 1) * Math.sin(t * Math.PI * 4);
    pts.push(`${x.toFixed(2)} ${y.toFixed(2)} ${i === 0 ? 'm' : 'l'}`);
  }
  return `q 0.05 0.08 0.2 RG 2.2 w 1 J 1 j ${pts.join(' ')} S Q`;
}

/**
 * The widget dictionaries a field draws its boxes from — its own, or the ones in `/Kids`. Both the
 * write and the read-back use this, because a field whose `/AP` lives on the kid is exactly the
 * shape that a check written against the parent would call a failure.
 */
function widgetsOf(doc, field) {
  const dict = field.acroField.dict;
  const kids = dict.get(PDFName.of('Kids'));
  if (!kids) return [dict];
  const resolved = (doc.context.lookup(kids, PDFArray)?.asArray() ?? [])
    .map((ref) => doc.context.lookup(ref, PDFDict))
    .filter((kid) => kid !== undefined);
  return resolved.length > 0 ? resolved : [dict];
}

const unsigned = new Uint8Array(readFileSync(out));
const arrayBuffer = new ArrayBuffer(unsigned.byteLength);
new Uint8Array(arrayBuffer).set(unsigned);
const signedDoc = await PDFDocument.load(arrayBuffer, { ignoreEncryption: true });

const written = [];
const skipped = [];
for (const field of signedDoc.getForm().getFields()) {
  if (!(field instanceof PDFSignature)) continue;
  // The product rule, mirrored: a field carrying a signature value is left alone.
  if (field.acroField.dict.get(PDFName.of('V'))) {
    skipped.push(field.getName());
    continue;
  }
  for (const widget of widgetsOf(signedDoc, field)) {
    const rect = widget.get(PDFName.of('Rect')).asArray().map((n) => Number(String(n)));
    const stream = signedDoc.context.stream(mark(rect, SHAPES[field.getName()] ?? 'wave'), {
      Type: 'XObject',
      Subtype: 'Form',
      BBox: signedDoc.context.obj(rect),
      Resources: {},
    });
    widget.set(PDFName.of('AP'), signedDoc.context.obj({ N: signedDoc.context.register(stream) }));
    written.push({ name: field.getName(), rect });
  }
}

const signedBytes = await signedDoc.save({ useObjectStreams: false });
const signedOut = join(root, 'playground', 'fixtures', 'signature-signed-sample.pdf');
writeFileSync(signedOut, Buffer.from(signedBytes));

// Re-read what was written, because "the script ran" is not "the file is what the browser needs".
const check = await PDFDocument.load(signedBytes, { ignoreEncryption: true });
const byName = new Map(check.getForm().getFields().map((f) => [f.getName(), f]));
if (written.length !== 3) throw new Error(`three boxes should have taken a mark, got ${written.length}`);
if (skipped.join() !== 'sigAlreadySigned') throw new Error('the signed field must be the one skipped');
for (const { name, rect } of written) {
  const field = byName.get(name);
  if (!field) throw new Error(`${name} disappeared when the appearances were written`);
  const same = (widget) =>
    widget.get(PDFName.of('Rect'))?.asArray().map((n) => Number(String(n))).join() === rect.join();
  const widget = widgetsOf(check, field).find(same);
  if (!widget) throw new Error(`${name} no longer has a widget at ${rect}`);
  const ap = check.context.lookup(widget.get(PDFName.of('AP')), PDFDict);
  if (!ap) throw new Error(`${name} has no /AP, so nothing was written into it`);
  // An appearance is a stream, and a stream's dictionary is reached through `.dict` rather than by
  // looking the reference up as a PDFDict — the type-guarded lookup throws on exactly that.
  const stream = check.context.lookup(ap.get(PDFName.of('N')));
  const bbox = (stream?.dict ?? stream)?.get?.(PDFName.of('BBox'));
  const values = bbox?.asArray().map((n) => Number(String(n))) ?? [];
  if (values.length !== 4 || values.some((n, i) => Math.abs(n - rect[i]) > 0.01)) {
    throw new Error(`${name}'s appearance /BBox is ${values}, not its own /Rect ${rect}`);
  }
}
if (!byName.get('sigAlreadySigned')?.acroField.dict.get(PDFName.of('V'))) {
  throw new Error('the already-signed field lost its /V, so the refusal case is no longer in the file');
}

console.log(`wrote ${signedOut} (${signedBytes.length} bytes, marks in ${written.map((w) => w.name).join(', ')})`);
