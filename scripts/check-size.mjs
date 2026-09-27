/**
 * Measures what a consumer actually downloads, per tier, and fails the build on
 * two different mistakes.
 *
 * **The ratchet.** Every number is compared against `size-baseline.json`, and
 * growth of more than 2 % (plus 256 bytes of minifier noise) fails. A library
 * that grows with features cannot honestly promise a fixed size — `pdfjs-dist`
 * alone is 128.6 kB gzipped on the main thread and 366.5 kB in its worker — so
 * what is promised instead is that bytes never
 * arrive quietly: accepting growth means running `npm run size:update`, which
 * changes a committed file in the same diff as the code that caused it.
 * Shrinking is always free.
 *
 * **The tier boundary (FR-23).** `scripts/size-consumers/` holds one file per
 * import an application can make. Each is bundled twice, by esbuild and by
 * Rollup, and the larger result is the one reported — two independent
 * tree-shakers have to agree that a feature you did not name is not in your
 * bundle. The same bundles are grepped for a marker that only exists inside each
 * feature: absent from the core bundle and present in its own, so a marker that
 * matches nothing cannot pass vacuously. That is what catches the failure this
 * release exists to fix — before `0.4`, `PdfViewer` with every feature prop
 * switched off measured the same bytes as with them all on.
 *
 * kB in the output is decimal (1 kB = 1000 B); the baseline stores bytes.
 *
 * Run after `npm run build`: `npm run size`. Accept new numbers: `size:update`.
 */
import { gzipSync } from 'node:zlib';
import { readFileSync, readdirSync, existsSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, posix } from 'node:path';
import { build, transformSync } from 'esbuild';
import { rollup } from 'rollup';

const KB = 1000;
const TOLERANCE = 0.02;
const SLACK_BYTES = 256;
/** Each feature's cost over the core bundle, per PRD §5.3. */
const FEATURE_TARGET_BYTES = 4 * KB;

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

/* ------------------------------------------------------------------ *
 * Shipped-file paths: what an unpkg-style consumer is served.
 * ------------------------------------------------------------------ */

/**
 * The dist files reachable from one entry, following tsup's `./chunk-*.js`
 * hoisting. Six entries share chunks now, so attributing every chunk to every
 * path would report a shell that contains features nobody imported.
 */
function reachableFrom(entry) {
  const found = new Set();
  const queue = [entry];
  while (queue.length) {
    const file = queue.pop();
    if (!file || found.has(file) || !existsSync(join(dist, file))) continue;
    found.add(file);
    const code = readFileSync(join(dist, file), 'utf8');
    for (const match of code.matchAll(/from\s+['"](\.[^'"]+\.js)['"]/g)) {
      queue.push(posix.normalize(posix.join(posix.dirname(file), match[1])));
    }
  }
  return [...found].sort();
}

const styleSheet = existsSync(join(dist, 'styles.css')) ? ['styles.css'] : [];
const filePaths = [
  { label: 'shell', files: [...reachableFrom('index.js'), ...styleSheet] },
  { label: 'headless', files: [...reachableFrom('headless.js'), ...styleSheet] },
];

/* ------------------------------------------------------------------ *
 * Consumer paths: what a bundling application is served.
 * ------------------------------------------------------------------ */

const EXTERNAL_RE = [/^react($|\/|-)/, /^react-dom/, /^pdfjs-dist/, /^@cantoo\/pdf-lib/];
const ESBUILD_EXTERNAL = [
  'react',
  'react/*',
  'react-dom',
  'react-dom/*',
  'pdfjs-dist',
  'pdfjs-dist/*',
  '@cantoo/pdf-lib',
];

const FEATURES = [
  { name: 'print', marker: 'usePdfPrint' },
  { name: 'download', marker: 'usePdfDownload' },
  { name: 'forms', marker: 'usePdfFormValues' },
  { name: 'outline', marker: 'usePdfOutline' },
  { name: 'layers', marker: 'usePdfOptionalContent' },
  { name: 'annotate', marker: 'createEditorEventBus' },
  { name: 'attachments', marker: 'usePdfAttachments' },
  /*
   * The edit tier's marker is the optional peer's own specifier, not one of our
   * symbols, because the failure worth catching here is the writer arriving in a
   * bundle that never asked for it. It stays an import rather than inlined code, so
   * the string is present in the tier and impossible to mistake for our own.
   */
  { name: 'edit', marker: '@cantoo/pdf-lib' },
];

const consumerPaths = [
  { label: 'core', fixture: 'core.mjs' },
  ...FEATURES.map((feature) => ({
    label: `core+${feature.name}`,
    fixture: `${feature.name}.mjs`,
  })),
  { label: 'all', fixture: 'all.mjs' },
  { label: 'headless-only', fixture: 'headless.mjs' },
];

async function bundleEsbuild(entry, minify) {
  const result = await build({
    entryPoints: [entry],
    bundle: true,
    format: 'esm',
    minify,
    write: false,
    external: ESBUILD_EXTERNAL,
    target: 'es2022',
    /* tsup emits a bare chunk import alongside its named re-exports. The
       package's sideEffects list exempts only CSS, so esbuild drops the bare
       one — correct, because nothing in this package has a side effect but CSS
       — and repeating that nine times per run would only teach everyone to
       ignore the output. Any other warning still surfaces. */
    logOverride: { 'ignored-bare-import': 'silent' },
  });
  return result.outputFiles[0].text;
}

async function bundleRollup(entry, minify) {
  const bundle = await rollup({
    input: entry,
    external: (id) => EXTERNAL_RE.some((re) => re.test(id)),
  });
  const { output } = await bundle.generate({ format: 'esm' });
  await bundle.close();
  const code = output.map((chunk) => chunk.code).join('\n');
  return minify ? transformSync(code, { loader: 'js', minify: true, format: 'esm' }).code : code;
}

const BUNDLERS = {
  esbuild: bundleEsbuild,
  rollup: bundleRollup,
};

const fixtureDir = join(root, 'scripts', 'size-consumers');
const measuredConsumer = new Map();
const sourceOf = new Map();
let markerFailures = 0;

for (const path of consumerPaths) {
  const entry = join(fixtureDir, path.fixture);
  if (!existsSync(entry)) {
    console.error(`scripts/size-consumers/${path.fixture} is missing.`);
    process.exit(1);
  }
  let largest = 0;
  const sources = {};
  for (const [name, bundle] of Object.entries(BUNDLERS)) {
    const pretty = await bundle(entry, false);
    const small = await bundle(entry, true);
    sources[name] = pretty;
    largest = Math.max(largest, gzipSync(Buffer.from(small), { level: 9 }).length);
  }
  measuredConsumer.set(path.label, largest);
  sourceOf.set(path.label, sources);
}

/**
 * Every feature marker must be absent from the core bundle and present in the
 * bundle that imports its feature, in both bundlers. The second half matters:
 * a marker nothing ever prints would pass the first half for free.
 */
for (const feature of FEATURES) {
  for (const bundler of Object.keys(BUNDLERS)) {
    const core = sourceOf.get('core')[bundler];
    const own = sourceOf.get(`core+${feature.name}`)[bundler];
    const absentFromCore = !core.includes(feature.marker);
    const presentInOwn = own.includes(feature.marker);
    if (!absentFromCore) {
      console.error(
        `FAIL  ${feature.marker} is in the core ${bundler} bundle: the shell imports ${feature.name} again.`,
      );
      markerFailures += 1;
    }
    if (!presentInOwn) {
      console.error(
        `FAIL  ${feature.marker} is missing from core+${feature.name} in ${bundler}: the marker no longer measures anything.`,
      );
      markerFailures += 1;
    }
  }
}

const coreSize = measuredConsumer.get('core');
const tierTargets = FEATURES.map((feature) => ({
  label: feature.name,
  bytes: measuredConsumer.get(`core+${feature.name}`) - coreSize,
  limit: FEATURE_TARGET_BYTES,
}));

/* ------------------------------------------------------------------ *
 * Report and verdict
 * ------------------------------------------------------------------ */

const baseline = update ? {} : JSON.parse(readFileSync(baselinePath, 'utf8'));
const measured = {};
let failed = markerFailures > 0;

function report(label, bytes, detail) {
  const allowed = (baseline[label] ?? bytes) * (1 + TOLERANCE) + SLACK_BYTES;
  const over = bytes > allowed;
  if (over) failed = true;
  const delta = bytes - (baseline[label] ?? bytes);
  const flag = over ? 'FAIL' : 'ok  ';
  const change =
    baseline[label] === undefined
      ? 'new   '
      : `${delta >= 0 ? '+' : ''}${(delta / KB).toFixed(2)} kB`.padEnd(8);
  console.log(
    `${flag}  ${label.padEnd(15)} ${(bytes / KB).toFixed(2).padStart(7)} kB gz   ${change}  ${detail}`,
  );
  measured[label] = bytes;
}

console.log('shipped files, per entry point');
for (const path of filePaths) report(path.label, path.files.reduce((sum, file) => sum + gzipSync(readFileSync(join(dist, file)), { level: 9 }).length, 0), path.files.join(' + '));

console.log('\nbundled per consumer import, worst of esbuild and Rollup');
for (const path of consumerPaths) {
  const bytes = measuredConsumer.get(path.label);
  const increment =
    path.label === 'core' || path.label === 'headless-only'
      ? ''
      : `(${((bytes - coreSize) / KB).toFixed(2)} kB over core)`;
  report(path.label, bytes, path.fixture.replace(/\.mjs$/, ' · ') + increment);
}

console.log('\nwhat each feature costs over core');
for (const tier of tierTargets) {
  const over = tier.bytes > tier.limit;
  if (over) failed = true;
  console.log(
    `  ${(over ? 'FAIL' : 'ok  ')}  ${tier.label.padEnd(9)} ${(tier.bytes / KB).toFixed(2).padStart(6)} kB gz of ${(tier.limit / KB).toFixed(0)} kB`,
  );
}

if (update) {
  const body = `${JSON.stringify(
    {
      '//': 'Gzipped bytes per measured path, accepted by `npm run size:update`. See scripts/check-size.mjs.',
      ...measured,
    },
    null,
    2,
  )}\n`;
  writeFileSync(baselinePath, body);
  console.log(`\nwrote ${baselinePath}`);
  process.exit(0);
}

if (failed) {
  console.error(
    `\nSomething grew past its baseline, or a feature leaked into the core bundle.\n` +
      `A size growth: look at the diff, then accept it with \`npm run size:update\` — that\n` +
      `edit is the record that someone decided the bytes were worth it.\n` +
      `A marker failure: the shell imported a feature statically again, which is the one\n` +
      `regression this gate exists to catch, and no amount of golfing fixes it.`,
  );
  process.exit(1);
}
