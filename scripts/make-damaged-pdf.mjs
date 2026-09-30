// Generates the two damaged fixtures `PRD.md` §"Error handling" promises tests for:
//
//   damaged-truncated.pdf — the first 45 % of `outline-sample.pdf`, cut mid-object.
//   damaged-xref.pdf      — the same file whole, with `startxref` pointing past the end.
//
// They are here because the two behave differently and the difference is the point. pdf.js refuses the
// truncated one (`InvalidPDFException: Invalid PDF structure.`) and *recovers* from the broken xref by
// re-indexing every object, with a console warning about it. A single "damaged file" fixture could have
// been written to look like either outcome, so both exist and the tests name which is which.
//
// Run: node scripts/make-damaged-pdf.mjs
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const fixtures = join(root, 'playground', 'fixtures');

// `outline-sample.pdf` is the source: three pages, a real outline, and an xref table at the end, so
// taking its head off or lying about where the table starts are both meaningful damage.
const source = new Uint8Array(readFileSync(join(fixtures, 'outline-sample.pdf')));
const text = Buffer.from(source).toString('latin1');

if (!text.startsWith('%PDF-')) throw new Error('the source fixture is not a PDF');
if (!/startxref\s+\d+/.test(text)) throw new Error('the source fixture has no startxref to corrupt');

// 1. Truncated mid-file. 45 % keeps the header and the catalog — so the parser commits to reading it —
//    and loses the xref table entirely, which is the case a reader is most likely to hit (a download
//    that stopped early).
const truncated = source.slice(0, Math.floor(source.length * 0.45));
if (Buffer.from(truncated).toString('latin1').indexOf('startxref') !== -1) {
  throw new Error('the "truncated" fixture still contains its xref, so it would not read as incomplete');
}

// 2. Whole file, wrong offset. The byte count must not change, or a reader could blame truncation
//    instead of the pointer — so the wrong offset is written with exactly as many digits as the real
//    one, which `9`s guarantee: the largest number that width can hold is above the end of this file.
const at = text.lastIndexOf('startxref');
if (at < 0) throw new Error('no startxref found in the source fixture');
const afterKeyword = text.slice(at + 'startxref'.length);
const offsetMatch = /^\s+(\d+)/.exec(afterKeyword);
if (!offsetMatch) throw new Error('startxref is not followed by a numeric offset');
const digits = offsetMatch[1];
const wrong = '9'.repeat(digits.length);
if (Number(wrong) <= source.length) {
  throw new Error(`a ${digits}-digit offset cannot point past a ${source.length}-byte file`);
}
const replaceAt = at + 'startxref'.length + offsetMatch[0].indexOf(digits);
const broken = `${text.slice(0, replaceAt)}${wrong}${text.slice(replaceAt + digits.length)}`;
const xrefBytes = new Uint8Array(Buffer.from(broken, 'latin1'));

if (xrefBytes.length !== source.length) {
  throw new Error('the xref fixture changed length, so a reader could blame truncation instead');
}
if (Buffer.from(xrefBytes).toString('latin1').indexOf(`${digits}\n`, at) === replaceAt) {
  throw new Error('the original startxref offset survived, so nothing was actually corrupted');
}

mkdirSync(fixtures, { recursive: true });
const write = (name, bytes) => {
  const out = join(fixtures, name);
  writeFileSync(out, bytes);
  console.log(`wrote ${out} (${bytes.length} bytes)`);
};
write('damaged-truncated.pdf', truncated);
write('damaged-xref.pdf', xrefBytes);

// What the tests will assert, stated here so a future re-generation that silently changes the damage is
// caught by this script rather than by a confusing red suite. `src/lib/damaged.test.ts` checks the same
// two outcomes through pdf.js itself.
console.log(
  'expected: damaged-truncated rejects with InvalidPDFException; ' +
    'damaged-xref loads after re-indexing (pdf.js warns, the viewer shows pages)',
);
