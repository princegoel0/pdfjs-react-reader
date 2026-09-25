/**
 * Measures every consumer path this package ships, gzipped and excluding
 * `pdfjs-dist`, and fails the build when a path has grown past the committed
 * baseline in `size-baseline.json`.
 *
 * A ratchet, not a ceiling. A library that grows with features cannot honestly
 * promise a fixed size — and `pdfjs-dist` itself costs ~532 kB, so our layer is
 * not what decides a bundle's weight. What still matters is that bytes cannot
 * arrive quietly: every growth has to be looked at, and accepting it means
 * running `npm run size:update`, which changes a committed file in the same diff
 * as the code that caused it. Shrinking is always allowed and reported.
 *
 * Tolerance exists because minifiers and bundler hoisting move a few hundred
 * bytes between runs without anyone adding a feature; it is not slack to grow
 * into.
 *
 * Measured per *consumer path*, because the two entry points share a chunk: a
 * host importing only `/headless` downloads a different set of files than one
 * importing the shell. kB in the output is decimal (1 kB = 1000 B), the
 * convention every bundle-size tool reports in; the baseline stores bytes.
 *
 * Run after `npm run build`: `npm run size`. Accept new numbers: `size:update`.
 */
import { gzipSync } from 'node:zlib';
import { readFileSync, readdirSync, existsSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const KB = 1000;
const TOLERANCE = 0.02;
const SLACK_BYTES = 256;

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dist = join(root, 'dist');
const baselinePath = process.env.SIZE_BASELINE_FILE ?? join(root, 'size-baseline.json');
const update = process.argv.includes('--update');

if (!existsSync(dist)) {
  console.error('dist/ is missing — run `npm run build` before `npm run size`.');
  process.exit(1);
}
if (!existsSync(baselinePath) && !update) {
  console.error(`${baselinePath} is missing — run \`npm run size:update\` to create it.`);
  process.exit(1);
}

const sharedChunks = readdirSync(dist).filter((file) => /^chunk-.*\.js$/.test(file));
const styleSheet = existsSync(join(dist, 'styles.css')) ? ['styles.css'] : [];

const consumerPaths = [
  { label: 'shell', files: ['index.js', ...sharedChunks, ...styleSheet] },
  { label: 'headless', files: ['headless.js', ...sharedChunks, ...styleSheet] },
];

function gzippedSize(file) {
  return gzipSync(readFileSync(join(dist, file)), { level: 9 }).length;
}

const baseline = update ? {} : JSON.parse(readFileSync(baselinePath, 'utf8'));
const measured = {};
let failed = false;

for (const path of consumerPaths) {
  const perFile = path.files.map((file) => ({ file, gz: gzippedSize(file) }));
  const total = perFile.reduce((sum, entry) => sum + entry.gz, 0);
  measured[path.label] = total;

  const allowed = (baseline[path.label] ?? total) * (1 + TOLERANCE) + SLACK_BYTES;
  const over = total > allowed;
  if (over) failed = true;
  const delta = total - (baseline[path.label] ?? total);
  const flag = over ? 'FAIL' : 'ok  ';
  const change =
    baseline[path.label] === undefined ? 'new' : `${delta >= 0 ? '+' : ''}${(delta / KB).toFixed(2)} kB`;

  console.log(`${flag}  ${path.label.padEnd(9)} ${(total / KB).toFixed(2).padStart(7)} kB gz   ${change}`);
  for (const entry of perFile) {
    console.log(`        - ${(entry.file + ' ').padEnd(24, ' ')} ${(entry.gz / KB).toFixed(2).padStart(6)} kB`);
  }
}

if (update) {
  const body = `${JSON.stringify({
    '//': 'Gzipped bytes per consumer path, accepted by `npm run size:update`. See scripts/check-size.mjs.',
    ...measured,
  }, null, 2)}\n`;
  writeFileSync(baselinePath, body);
  console.log(`\nwrote ${baselinePath}`);
  process.exit(0);
}

if (failed) {
  console.error(
    `\nA consumer path grew more than ${(TOLERANCE * 100).toFixed(0)}% over the baseline.\n` +
      'Look at the diff, then accept the new numbers with `npm run size:update` — that edit is\n' +
      'the record that someone decided the growth was worth it.',
  );
  process.exit(1);
}
