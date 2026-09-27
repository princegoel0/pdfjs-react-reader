// Generates the array-form XFA fixtures, which exist because pdf.js reads two
// container shapes for `AcroForm /XFA` and this repository has only ever exercised one:
//
//   /XFA <stream>                  the whole XDP packet in one stream — `xfa-sample.pdf`
//   /XFA [ (key) <stream> … ]      named fragments — what LiveCycle writes for most real
//                                  forms, and unmeasured here
//
// The array matters because `_xfaStreams` does not simply parse it. It pre-seeds a map of
// the eight packet names pdf.js knows, then keys the **first** pair `xdp:xdp` whatever its
// string says, keys the **last** pair `/xdp:xdp`, and takes the middle pairs by name.
// `XFAFactory._createDocument` then returns the `xdp:xdp` stream alone *unless* a
// `/xdp:xdp` entry also exists, in which case it concatenates **every** stream in seeded
// key order. So an array is read as either "the first stream is the packet" or "the
// streams joined are the packet", and which one a file means is invisible from its
// metadata — only what renders can say.
//
// Three documents, one per reading, plus the case where the packet must be ignored:
//   xfa-array-sample.pdf          three pairs whose concatenation is the working packet
//   xfa-array-packet-sample.pdf   one pair holding the complete packet
//   xfa-hybrid-sample.pdf         the array *and* AcroForm /Fields, which per `xfaFactory`
//                                 (`needsRendering && hasXfa && !hasAcroForm`) must fall to
//                                 the AcroForm path with the XFA packet inert
//
// The packets come from `./xfa-packet.mjs` and are byte-for-byte the ones `xfa-sample.pdf`
// uses, so a difference between these files and that one can only be the container.
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  packetProblems,
  xfaDatasetsFragment,
  xfaFullPacket,
  xfaTemplateFragment,
  xfaXdpPrologue,
} from './xfa-packet.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

const CATALOG = 1;
const PAGES = 2;
const FONT = 3;
const PAGE = 4;
const CONTENTS = 5;
const ACROFORM = 30;
const XFA_FIRST = 31;
const FIELD = 40;

/**
 * The split that makes the "joined" reading true: the prologue and opening `<xdp:xdp>`
 * ride with the template, the datasets island is bare, and the closing tag rides with the
 * last pair — which is the position `_xfaStreams` labels `/xdp:xdp`.
 */
const JOINED_PAIRS = [
  { key: 'template', xml: `${xfaXdpPrologue()}${xfaTemplateFragment()}` },
  { key: 'datasets', xml: `\n${xfaDatasetsFragment()}` },
  { key: 'xmlData', xml: '\n</xdp:xdp>' },
];

/**
 * The PDF side. `withFields` is the third fixture: an AcroForm `/Fields` entry makes
 * `formInfo.hasAcroForm` true, and `xfaFactory` refuses to build when it is, so the same
 * packet is present and inert. `/NeedAppearances true` is what a LiveCycle export writes
 * alongside `/XFA`, and it is why the widget renders with no /AP of its own — the
 * appearance is generated, which is also the thing a save has to preserve.
 */
function build({ pairs, withFields }) {
  const objects = new Map();
  objects.set(
    CATALOG,
    `<< /Type /Catalog /Pages ${PAGES} 0 R /AcroForm ${ACROFORM} 0 R /NeedsRendering true >>`,
  );
  objects.set(PAGES, `<< /Type /Pages /Kids [${PAGE} 0 R] /Count 1 >>`);
  objects.set(FONT, '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');
  objects.set(
    PAGE,
    `<< /Type /Page /Parent ${PAGES} 0 R /MediaBox [0 0 612 792] ` +
      `/Resources << /Font << /F1 ${FONT} 0 R >> >> /Contents ${CONTENTS} 0 R` +
      `${withFields ? ` /Annots [${FIELD} 0 R]` : ''} >>`,
  );
  // The marker sentence: if the canvas paints it, the XFA layer never took the page.
  objects.set(CONTENTS, {
    dict: '/Type /XObject /Subtype /Form /BBox [0 0 612 792]',
    stream: [
      'BT /F1 16 Tf 72 700 Td (Painted by the PDF canvas, not the XFA layer) Tj ET',
      'BT /F1 11 Tf 72 676 Td (If this line is visible, the array packet was not laid out.) Tj ET',
    ].join('\n'),
  });

  const flat = pairs.flatMap((pair, i) => `(${pair.key}) ${XFA_FIRST + i} 0 R`);
  const acroForm = [
    `/XFA [${flat.join(' ')}]`,
    '/DR << /Font << /Helv 3 0 R >> >>',
    withFields ? '/DA (/Helv 12 Tf 0 g)' : '',
    withFields ? '/FT /Tx' : '',
    withFields ? '/Fields [40 0 R]' : '',
    withFields ? '/NeedAppearances true' : '',
  ]
    .filter(Boolean)
    .join(' ');
  objects.set(ACROFORM, `<< ${acroForm} >>`);
  pairs.forEach((pair, i) => {
    objects.set(XFA_FIRST + i, { dict: '/Type /EmbeddedFile', stream: pair.xml });
  });

  if (withFields) {
    // One field that is also its own widget, named to match the XFA datasets island so a
    // reader can see which of the two the value came from.
    objects.set(
      FIELD,
      `<< /Type /Annot /Subtype /Widget /FT /Tx /T (applicantName) /V (Canvas value, not the XFA one) ` +
        `/Rect [72 640 312 660] /F 4 /P ${PAGE} 0 R >>`,
    );
  }
  return objects;
}

/** Assembly plus the same reference and xref validation `make-xfa-pdf.mjs` does. */
function assemble(objects) {
  const maxNum = objects.size ? Math.max(...objects.keys()) : 0;
  let pdf = '%PDF-1.7\n';
  const offsets = new Array(maxNum + 1).fill(0);
  for (const num of [...objects.keys()].sort((a, b) => a - b)) {
    const obj = objects.get(num);
    offsets[num] = pdf.length;
    if (typeof obj === 'string') {
      pdf += `${num} 0 obj\n${obj}\nendobj\n`;
    } else {
      const head = `/Length ${Buffer.byteLength(obj.stream, 'latin1')}`;
      pdf += `${num} 0 obj\n<< ${obj.dict} ${head} >>\nstream\n${obj.stream}\nendstream\nendobj\n`;
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
  pdf += `trailer\n<< /Size ${size} /Root ${CATALOG} 0 R >>\nstartxref\n${xrefStart}\n%%EOF\n`;

  const problems = [];
  for (const num of objects.keys()) {
    const body = objects.get(num);
    const text = typeof body === 'string' ? body : `${body.dict} ${body.stream}`;
    for (const ref of text.matchAll(/(\d+) 0 R/g)) {
      if (!objects.has(Number(ref[1]))) problems.push(`object ${num} references missing ${ref[1]} 0 R`);
    }
  }
  for (let num = 1; num < size; num++) {
    if (!objects.has(num)) continue;
    if (!new RegExp(`^${num} 0 obj\\n`).test(pdf.substr(offsets[num], 12))) {
      problems.push(`xref offset ${offsets[num]} for object ${num} does not point at it`);
    }
  }
  return { pdf, problems };
}

const packet = xfaFullPacket();
const FIXTURES = [
  { name: 'xfa-array-sample.pdf', pairs: JOINED_PAIRS, withFields: false },
  { name: 'xfa-array-packet-sample.pdf', pairs: [{ key: 'template', xml: packet }], withFields: false },
  { name: 'xfa-hybrid-sample.pdf', pairs: JOINED_PAIRS, withFields: true },
];

const problems = packetProblems(packet);

// The claim the "joined" fixture is built on: concatenated in the order `_xfaStreams`
// seeds them, these three streams are the packet that is known to render. If this is
// false, the fixture is not testing what it says it tests.
if (JOINED_PAIRS.map((p) => p.xml).join('') !== packet) {
  problems.push('the joined array streams are not byte-identical to xfa-sample.pdf\'s packet');
}

for (const fixture of FIXTURES) {
  const built = assemble(build(fixture));
  problems.push(...built.problems.map((p) => `${fixture.name}: ${p}`));
  // `/Fields` is the one thing that must not appear in the two pure fixtures: with it the
  // document is an AcroForm wearing an XFA hat, and every measurement on it would be of
  // the wrong path.
  const hasFields = /\/Fields/.test(built.pdf);
  if (fixture.withFields !== hasFields) {
    problems.push(`${fixture.name}: /Fields present=${hasFields} but the fixture asked for ${fixture.withFields}`);
  }
  if (!/\/NeedsRendering true/.test(built.pdf)) problems.push(`${fixture.name}: catalog lost /NeedsRendering`);
  fixture.pdf = built.pdf;
}

if (problems.length) {
  for (const problem of problems) console.error(`fixture invalid: ${problem}`);
  process.exit(1);
}

for (const fixture of FIXTURES) {
  const out = join(root, 'playground', 'fixtures', fixture.name);
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, fixture.pdf, 'latin1');
  console.log(`wrote ${out} (${fixture.pdf.length} bytes, ${fixture.pairs.length} /XFA pair(s))`);
}
