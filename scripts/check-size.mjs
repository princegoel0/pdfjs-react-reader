/**
 * Enforces the PRD's non-functional budget: under 45 kB gzipped for everything
 * this package ships, excluding `pdfjs-dist` itself.
 *
 * Measured per *consumer path*, because the two entry points share a chunk: a
 * host importing only `/headless` downloads a different set of files than one
 * importing the shell. kB here is decimal (1 kB = 1000 B), the convention every
 * bundle-size tool reports in.
 *
 * Run after `npm run build`: `npm run size`.
 */
import { gzipSync } from 'node:zlib';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const KB = 1000;
/** Override for experiments and CI canaries: `SIZE_BUDGET_KB=30 npm run size`. */
const BUDGET_KB = Number(process.env.SIZE_BUDGET_KB) || 45;

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dist = join(root, 'dist');

if (!existsSync(dist)) {
  console.error('dist/ is missing — run `npm run build` before `npm run size`.');
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

let failed = false;
const rows = [];

for (const path of consumerPaths) {
  const perFile = path.files.map((file) => ({ file, gz: gzippedSize(file) }));
  const total = perFile.reduce((sum, entry) => sum + entry.gz, 0);
  const over = total > BUDGET_KB * KB;
  if (over) failed = true;
  rows.push({ ...path, perFile, total, over });
}

for (const row of rows) {
  const kb = (row.total / KB).toFixed(2);
  const mark = row.over ? 'FAIL' : 'ok  ';
  console.log(`${mark}  ${row.label.padEnd(9)} ${kb.padStart(7)} kB gz   budget ${BUDGET_KB} kB`);
  for (const entry of row.perFile) {
    console.log(`        - ${(entry.file + ' ').padEnd(24, ' ')} ${(entry.gz / KB).toFixed(2).padStart(6)} kB`);
  }
}

if (failed) {
  console.error(`\nOver the ${BUDGET_KB} kB gzipped budget. Trim it or update the NFR deliberately.`);
  process.exit(1);
}
