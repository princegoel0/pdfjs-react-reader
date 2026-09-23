/**
 * Writes playground/fixtures/encrypted-sample.pdf: a one-page document
 * encrypted with 40-bit RC4 (security handler /V 1 /R 2), opened with the user
 * password "secret". Used to exercise FR-03 (password prompt) in the playground.
 *
 * The key derivation follows pdf.js's `CipherTransformFactory` (the file key
 * hashes the padded password, the /O entry, /P and the first /ID bytes, and the
 * per-object key takes min(n + 5, 16) hash bytes) rather than the letter of
 * ISO 32000-1's revision-2 recipe, because pdf.js is the engine that has to
 * read this file.
 */
import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PASSWORD = 'secret';

/** The 32 bytes every PDF security handler pads short passwords with. */
const PAD = Uint8Array.from([
  0x28, 0xbf, 0x4e, 0x5e, 0x4e, 0x75, 0x8a, 0x41, 0x64, 0x00, 0x4e, 0x56, 0xff, 0xfa, 0x01, 0x08,
  0x2e, 0x2e, 0x00, 0xb6, 0xd0, 0x68, 0x3e, 0x80, 0x2f, 0x0c, 0xa9, 0xfe, 0x64, 0x53, 0x69, 0x7a,
]);

/** The trailer /ID; its bytes feed the file key, so it must stay in sync. */
const ID = Uint8Array.from(
  { length: 16 },
  (_, i) => (0x10 + i * 0x0d) & 0xff,
);

const md5 = (bytes) => new Uint8Array(createHash('md5').update(bytes).digest());

function padPassword(password) {
  const bytes = Uint8Array.from(password, (char) => char.charCodeAt(0) & 0xff);
  const out = new Uint8Array(32);
  const taken = Math.min(32, bytes.length);
  out.set(bytes.subarray(0, taken), 0);
  for (let i = taken; i < 32; i++) out[i] = PAD[i - taken];
  return out;
}

function rc4(key, data) {
  const state = new Uint8Array(256);
  for (let i = 0; i < 256; i++) state[i] = i;
  let j = 0;
  for (let i = 0; i < 256; i++) {
    j = (j + state[i] + key[i % key.length]) & 0xff;
    [state[i], state[j]] = [state[j], state[i]];
  }
  const out = new Uint8Array(data.length);
  let a = 0;
  let b = 0;
  for (let i = 0; i < data.length; i++) {
    a = (a + 1) & 0xff;
    b = (b + state[a]) & 0xff;
    [state[a], state[b]] = [state[b], state[a]];
    out[i] = data[i] ^ state[(state[a] + state[b]) & 0xff];
  }
  return out;
}

const hex = (bytes) => Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
const latin1 = (bytes) => String.fromCharCode(...bytes);

const PERMISSIONS = -1;

function permissionsBytes(flags) {
  return Uint8Array.from([flags & 0xff, (flags >> 8) & 0xff, (flags >> 16) & 0xff, (flags >>> 24) & 0xff]);
}

// ---- /O: RC4(MD5(padded owner password), MD5(padded user password)) ----
const ownerKey = md5(padPassword(PASSWORD)).subarray(0, 5);
const ownerEntry = rc4(ownerKey, md5(padPassword(PASSWORD)));

// ---- file key: MD5(padded password + O + P + ID), first 5 bytes ----
const keySeed = new Uint8Array(32 + ownerEntry.length + 4 + ID.length);
let at = 0;
keySeed.set(padPassword(PASSWORD), at);
at += 32;
keySeed.set(ownerEntry, at);
at += ownerEntry.length;
keySeed.set(permissionsBytes(PERMISSIONS), at);
at += 4;
keySeed.set(ID, at);
const fileKey = md5(keySeed).subarray(0, 5);

// ---- /U: RC4(fileKey, PAD) ----
const userEntry = rc4(fileKey, PAD);

function objectKey(num, gen) {
  const buf = new Uint8Array(fileKey.length + 5);
  buf.set(fileKey, 0);
  buf[fileKey.length] = num & 0xff;
  buf[fileKey.length + 1] = (num >> 8) & 0xff;
  buf[fileKey.length + 2] = (num >> 16) & 0xff;
  buf[fileKey.length + 3] = gen & 0xff;
  buf[fileKey.length + 4] = (gen >> 8) & 0xff;
  return md5(buf).subarray(0, Math.min(fileKey.length + 5, 16));
}

const CONTENT_NUM = 5;
const plainContent = Uint8Array.from(
  [
    'BT /F1 24 Tf 72 700 Td (Encrypted fixture) Tj ET',
    'BT /F1 12 Tf 72 670 Td (Password: secret) Tj ET',
    '0.5 w 72 650 m 300 650 l S',
  ].join('\n'),
  (char) => char.charCodeAt(0) & 0xff,
);
const encryptedContent = rc4(objectKey(CONTENT_NUM, 0), plainContent);

const objects = new Map([
  [1, '<< /Type /Catalog /Pages 2 0 R >>'],
  [2, '<< /Type /Pages /Kids [4 0 R] /Count 1 >>'],
  [3, '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'],
  [
    4,
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] ' +
      '/Resources << /Font << /F1 3 0 R >> >> /Contents 5 0 R >>',
  ],
  [
    6,
    `<< /Filter /Standard /V 1 /R 2 /Length 40 /P ${PERMISSIONS} ` +
      `/O <${hex(ownerEntry)}> /U <${hex(userEntry)}> >>`,
  ],
]);

let pdf = '%PDF-1.4\n';
const offsets = new Array(7).fill(0);
const write = (num, body) => {
  offsets[num] = pdf.length;
  pdf += `${num} 0 obj\n${body}\nendobj\n`;
};

for (const num of [1, 2, 3, 4]) write(num, objects.get(num));
write(
  CONTENT_NUM,
  `<< /Length ${encryptedContent.length} >>\nstream\n${latin1(encryptedContent)}\nendstream`,
);
write(6, objects.get(6));

const xrefStart = pdf.length;
pdf += 'xref\n0 7\n0000000000 65535 f \n';
for (let num = 1; num < 7; num++) {
  pdf += offsets[num]
    ? `${String(offsets[num]).padStart(10, '0')} 00000 n \n`
    : '0000000000 65535 f \n';
}
pdf += `trailer\n<< /Size 7 /Root 1 0 R /Encrypt 6 0 R /ID [<${hex(ID)}> <${hex(ID)}>] >>\nstartxref\n${xrefStart}\n%%EOF\n`;

const out = join(root, 'playground', 'fixtures', 'encrypted-sample.pdf');
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, pdf, 'latin1');
console.log(`wrote ${out} (${pdf.length} bytes, password "${PASSWORD}")`);
