// Generates playground/fixtures/scan-sample.pdf — benchmark profile B (`PRD.md` §6): a high-DPI scanned
// book, one large image per page and little or no text.
//
// What the profile is for, and so what this file makes:
//   * **a decoded bitmap far larger than the page.** Each page carries a 2550×3300 DeviceRGB image — a
//     300-dpi scan of a US-letter sheet, 25.2 MP once decoded — drawn onto a 612×792 pt box. The viewer
//     never needs 25 MP on screen; the point is that the engine has to allocate and down-scale it, which is
//     where a canvas area cap earns its keep and where an uncapped renderer dies.
//   * **one image per page, twelve pages**, so a scroll has to build and release buffers in sequence
//     rather than reuse one. §6's profile-B target is about the release path, not the first paint.
//   * **no text layer worth the name.** A scan has no text, so the fixture's pages carry no text operators
//     at all: a measurement here cannot be quietly paid for by a text run.
//   * **a small file.** The bitmap is drawn as paper with marks on it — mostly white, with a faint
//     horizontal band and a block of glyph-like rectangles — because that is what a scan is, and because a
//     tracked fixture that costs 40 MB gets deleted. The bytes are cheap; the *decoded* pixels are not,
//     and it is the decoded pixels the caps are written against.
//
// What this fixture deliberately does not model: DCT decode cost. A real JPEG scan spends time in pdf.js's
// own JPEG decoder; a Flate image spends almost none. Profile B's targets are about our caps, our canvas
// budget and our release path, so those are what this measures, and the difference is stated in the
// benchmark report rather than hidden by a fixture that looks more realistic than it behaves.
import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const COUNT = 12;
const PAGE_W = 612;
const PAGE_H = 792;
// A 300-dpi scan of a letter sheet. Deliberately not a multiple of the page box: a whole-number ratio
// would let a renderer take a nearest-neighbour shortcut that no real scan offers it.
const IMG_W = 2550;
const IMG_H = 3300;

const CATALOG = 1;
// Dense and non-overlapping, one contiguous run per kind: the xref carries an entry for every number up to
// the highest, so a gap is a wasted slot and a collision is a document whose catalog points at an image.
// Both are caught by the self-check below, which is how the first draft of this file found out.
const PAGE_BASE = CATALOG + 1;
const CONTENT_BASE = PAGE_BASE + COUNT;
const IMAGE_BASE = CONTENT_BASE + COUNT;
const PAGES = IMAGE_BASE + COUNT;

const pageObj = (page) => PAGE_BASE + page - 1;
const contentObj = (page) => CONTENT_BASE + page - 1;
const imageObj = (page) => IMAGE_BASE + page - 1;

/**
 * One scanned page, as RGB bytes: paper, a faint banding that a scanner leaves, and two columns of
 * glyph-like marks. Deterministic — a fixture that varies between runs is a baseline that cannot be
 * compared to the last one.
 */
function scanPage(page) {
  const bytes = new Uint8Array(IMG_W * IMG_H * 3);
  // Paper: a very slight vertical gradient and a warm tint, which is what a scan of real paper is.
  for (let y = 0; y < IMG_H; y += 1) {
    const paper = 244 - Math.round((y / IMG_H) * 7) - (y % 97 === 0 ? 4 : 0);
    const row = y * IMG_W * 3;
    for (let x = 0; x < IMG_W; x += 1) {
      const at = row + x * 3;
      bytes[at] = paper;
      bytes[at + 1] = paper - 1;
      bytes[at + 2] = paper - 4;
    }
  }

  /** A dark rectangle in scan coordinates. */
  const ink = (x0, y0, x1, y1, tone) => {
    for (let y = Math.max(0, y0); y < Math.min(IMG_H, y1); y += 1) {
      const row = y * IMG_W * 3;
      for (let x = Math.max(0, x0); x < Math.min(IMG_W, x1); x += 1) {
        const at = row + x * 3;
        // A little per-pixel variation, so a flat block does not compress into a run the way a synthetic
        // one would. Real glyph edges are noisy; this is the cheapest honest version of that.
        const grain = (x * 7 + y * 13 + page * 31) % 5;
        bytes[at] = tone + grain;
        bytes[at + 1] = tone + grain;
        bytes[at + 2] = tone + grain;
      }
    }
  };

  // Two columns of "text", 34 lines, each line a row of short marks with word gaps.
  const margin = 240;
  const colWidth = (IMG_W - margin * 2 - 120) / 2;
  for (let line = 0; line < 34; line += 1) {
    const y = 260 + line * 86;
    for (const col of [0, 1]) {
      const left = margin + col * (colWidth + 120);
      let x = left;
      while (x < left + colWidth - 40) {
        const word = 40 + ((x * 3 + line * 7 + page * 11) % 5) * 22;
        ink(x, y, Math.min(x + word, left + colWidth), y + 34, 46);
        x += word + 26;
      }
    }
  }
  // A plate on every third page, because a scanned book has them and they are the widest continuous tone.
  if (page % 3 === 0) ink(margin, 260 + 30 * 86, margin + colWidth * 2 + 120, 260 + 30 * 86 + 260, 120);
  // The page number, as a small mark rather than text.
  ink(IMG_W / 2 - 60, IMG_H - 180, IMG_W / 2 + 60, IMG_H - 140, 60);

  return bytes;
}

const objects = new Map();

objects.set(CATALOG, `<< /Type /Catalog /Pages ${PAGES} 0 R >>`);
objects.set(
  PAGES,
  `<< /Type /Pages /Kids [${Array.from({ length: COUNT }, (_, i) => `${pageObj(i + 1)} 0 R`).join(' ')}]` +
    ` /Count ${COUNT} >>`,
);

const streams = [];
for (let page = 1; page <= COUNT; page += 1) {
  const raw = scanPage(page);
  const packed = deflateSync(Buffer.from(raw), { level: 9 });
  streams.push(packed.length);
  objects.set(pageObj(page), 
    `<< /Type /Page /Parent ${PAGES} 0 R /MediaBox [0 0 ${PAGE_W} ${PAGE_H}]` +
      ` /Resources << /XObject << /Scan ${imageObj(page)} 0 R >> >>` +
      ` /Contents ${contentObj(page)} 0 R >>`,
  );
  // The image fills the box, which is what a scan of a full page is: no margins in the geometry, the
  // margins are in the pixels.
  objects.set(contentObj(page), {
    stream: `q ${PAGE_W} 0 0 ${PAGE_H} 0 0 cm /Scan Do Q`,
  });
  objects.set(imageObj(page), {
    dict:
      `<< /Type /XObject /Subtype /Image /Width ${IMG_W} /Height ${IMG_H}` +
      ` /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /FlateDecode /Length ${packed.length} >>`,
    binary: packed,
  });
}

// ---- assembly ----
// Binary payloads are carried as latin1 strings, where one code unit is exactly one byte. That keeps the
// offset arithmetic below honest: `pdf.length` is a byte count throughout.
const toLatin1 = (buffer) => Buffer.from(buffer).toString('latin1');

let maxNum = 0;
for (const num of objects.keys()) maxNum = Math.max(maxNum, num);
let pdf = '%PDF-1.4\n%âãÏÓ\n';
const offsets = new Array(maxNum + 1).fill(0);
for (const num of [...objects.keys()].sort((a, b) => a - b)) {
  const obj = objects.get(num);
  offsets[num] = pdf.length;
  if (typeof obj === 'string') {
    pdf += `${num} 0 obj\n${obj}\nendobj\n`;
    continue;
  }
  if (obj.binary) {
    pdf += `${num} 0 obj\n${obj.dict}\nstream\n${toLatin1(obj.binary)}\nendstream\nendobj\n`;
    continue;
  }
  pdf += `${num} 0 obj\n<< /Length ${obj.stream.length} >>\nstream\n${obj.stream}\nendstream\nendobj\n`;
}

const size = maxNum + 1;
const xrefStart = pdf.length;
pdf += `xref\n0 ${size}\n0000000000 65535 f \n`;
for (let num = 1; num < size; num += 1) {
  pdf += offsets[num]
    ? `${String(offsets[num]).padStart(10, '0')} 00000 n \n`
    : '0000000000 65535 f \n';
}
pdf += `trailer\n<< /Size ${size} /Root ${CATALOG} 0 R >>\nstartxref\n${xrefStart}\n%%EOF\n`;

// ---- self-check ----
const problems = [];

// The numbering is the one part of a hand-written PDF that can be wrong without any byte looking wrong: a
// collision silently replaces an object (a page tree that becomes an image, and a catalog that then points
// at pixels), and a gap silently wastes an xref slot. So: highest number equals object count, and every
// number in between is present.
const highest = Math.max(...objects.keys());
if (objects.size !== highest) {
  problems.push(`${objects.size} objects numbered up to ${highest} — a collision or a gap`);
}
for (let num = 1; num <= highest; num += 1) {
  if (!objects.has(num)) problems.push(`object ${num} is missing from a dense layout`);
}

for (const [num, body] of objects) {
  const text = typeof body === 'string' ? body : `${body.dict ?? ''} ${body.stream ?? ''}`;
  for (const ref of text.matchAll(/(\d+) 0 R/g)) {
    if (!objects.has(Number(ref[1]))) problems.push(`object ${num} references missing ${ref[1]} 0 R`);
  }
}

// Every page names one image, every image is a full-page scan of the declared size, and every `/Length`
// is the byte count that follows it — the three ways a hand-written image fixture goes wrong.
for (let page = 1; page <= COUNT; page += 1) {
  const body = objects.get(pageObj(page));
  if (!body?.includes(`/Scan ${imageObj(page)} 0 R`)) problems.push(`page ${page} does not name its image`);
  if (!body?.includes(`/MediaBox [0 0 ${PAGE_W} ${PAGE_H}]`)) problems.push(`page ${page} has the wrong box`);
  const image = objects.get(imageObj(page));
  if (!image?.dict?.includes(`/Width ${IMG_W} /Height ${IMG_H}`)) problems.push(`image ${page} has the wrong size`);
  const declared = Number(/\/Length (\d+)/.exec(image.dict)?.[1]);
  if (declared !== image.binary.length) problems.push(`image ${page}: /Length ${declared} but ${image.binary.length} bytes`);
  const content = objects.get(contentObj(page)).stream;
  if (!content.includes('/Scan Do')) problems.push(`page ${page} does not draw its image`);
  if (/Tj/.test(content)) problems.push(`page ${page} has text operators, and profile B has none`);
}

for (let num = 1; num < size; num += 1) {
  if (!offsets[num]) continue;
  if (!pdf.startsWith(`${num} 0 obj\n`, offsets[num])) problems.push(`xref offset for ${num} points at the wrong bytes`);
}
// The stream markers have to balance, or the engine reads a length that is not the one declared.
const opened = (pdf.match(/\nstream\n/g) ?? []).length;
const closed = (pdf.match(/\nendstream\n/g) ?? []).length;
if (opened !== closed || opened !== COUNT * 2) {
  problems.push(`${opened} streams opened and ${closed} closed, for ${COUNT * 2} expected (images + content)`);
}

const out = join(root, 'playground', 'fixtures', 'scan-sample.pdf');
mkdirSync(dirname(out), { recursive: true });
if (problems.length) {
  console.error(`refusing to write ${out}:\n  ${[...new Set(problems)].slice(0, 20).join('\n  ')}`);
  process.exit(1);
}
writeFileSync(out, pdf, 'latin1');
const decoded = IMG_W * IMG_H * 3 * COUNT;
console.log(
  `wrote ${out}: ${COUNT} pages, each a ${IMG_W}×${IMG_H} RGB scan ` +
    `(${(IMG_W * IMG_H * 3 / 1e6).toFixed(1)} MP per page, ${(decoded / 1e6).toFixed(0)} MP decoded in all), ` +
    `file ${(pdf.length / 1e6).toFixed(2)} MB, per-page stream ${Math.min(...streams) / 1024 | 0}–${Math.max(...streams) / 1024 | 0} kB`,
);
