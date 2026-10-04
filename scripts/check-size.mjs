/**
 * Measures what a consumer actually downloads, per tier, and fails the build on
 * three different mistakes.
 *
 * **The ratchet.** Every number is compared against `size-baseline.json`, and
 * growth of more than 2 % (plus 256 bytes of minifier noise) fails. A library
 * that grows with features cannot honestly promise a fixed size — `pdfjs-dist`
 * alone is 131.7 kB gzipped on the main thread and 375.3 kB in its worker — so
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
/*
 * Each feature's cost over the core bundle.
 *
 * This was 4 kB from `0.4` until the signing work, which measured 5.53 kB for `edit` and 4.73 kB
 * for the same tier with its interface removed — so the writer and the geometry it needs cost more
 * than the ceiling, on their own and before any UI is counted. Bending a ceiling to fit a feature
 * is how a ceiling stops meaning anything, so the number moved because what the project holds fixed
 * moved: bytes are a ratchet that records decisions, and the requirement that does not bend is
 * behaviour under load (`PRD.md` §6). A tier that has to parse the file it is showing is allowed to
 * cost the kilobytes that doing so takes, provided the work is asked for rather than volunteered,
 * runs once, and says so while it runs — which is exactly the shape signing ended up in.
 *
 * What this number is *for* has not changed: it stops one capability swallowing the viewer. At
 * 6 kB the largest tier is a quarter of the core again rather than a fifth, and the next feature
 * that reaches for the writer inherits the same room without another conversation.
 */
const FEATURE_TARGET_BYTES = 6 * KB;

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
 * The dist files reachable from one entry, following tsup's chunk hoisting. Six entries share chunks now,
 * so attributing every chunk to every path would report a shell that contains features nobody imported.
 *
 * The pattern is per format, because FR-41's two halves are not built the same way: the ESM output hoists
 * shared code into `chunk-*.js` reached by static `import`, and the CJS output is one self-contained
 * `*.cjs` per entry — which is worth measuring precisely because it means a CJS host that names two entries
 * downloads the shared code twice, where an ESM host pays for it once.
 */
function reachableFrom(entry, pattern) {
  const found = new Set();
  const queue = [entry];
  while (queue.length) {
    const file = queue.pop();
    if (!file || found.has(file) || !existsSync(join(dist, file))) continue;
    found.add(file);
    const code = readFileSync(join(dist, file), 'utf8');
    for (const match of code.matchAll(pattern)) {
      queue.push(posix.normalize(posix.join(posix.dirname(file), match[1])));
    }
  }
  return [...found].sort();
}

const ESM_REF = /from\s+['"](\.[^'"]+\.js)['"]/g;
const CJS_REF = /require\(['"](\.[^'"]+\.cjs)['"]\)/g;

const styleSheet = existsSync(join(dist, 'styles.css')) ? ['styles.css'] : [];
const filePaths = [
  { label: 'shell', files: [...reachableFrom('index.js', ESM_REF), ...styleSheet] },
  { label: 'headless', files: [...reachableFrom('headless.js', ESM_REF), ...styleSheet] },
  /*
   * The CommonJS half of FR-41, measured the same way so the two are comparable. `styles.css` is included
   * because a CJS consumer imports it identically — CSS has no second format.
   */
  { label: 'shell (cjs)', files: [...reachableFrom('index.cjs', CJS_REF), ...styleSheet] },
  { label: 'headless (cjs)', files: [...reachableFrom('headless.cjs', CJS_REF), ...styleSheet] },
  /*
   * The shipped catalogs, measured as the files a consumer is served rather than as a
   * bundle: a catalog imports nothing, so the only question about it is how many bytes
   * of words it carries, and ratcheting that is what keeps a 134-string file from
   * quietly turning into a 400-string one.
   */
  { label: 'catalog:de', files: reachableFrom('locales/de.js', ESM_REF) },
  { label: 'catalog:es', files: reachableFrom('locales/es.js', ESM_REF) },
  { label: 'catalog:fr', files: reachableFrom('locales/fr.js', ESM_REF) },
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
   * The structure tier's marker is the peer specifier it lazily imports, for the same reason `edit`'s is
   * `@cantoo/pdf-lib`: the failure worth catching is that specifier appearing in a bundle that never asked
   * for the tier — about 50 kB gzipped of pdf.js viewer, since `web/pdf_viewer.mjs` does not tree-shake.
   * It also catches the subtler version, where core itself starts naming the module and every consumer
   * pays a chunk they cannot see.
   */
  { name: 'structure', marker: 'pdfjs-dist/web/pdf_viewer.mjs' },
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
  /*
   * Merge is measured alone rather than as `core+merge`, because it is not a feature: nothing mounts it
   * on a viewer, and a host that only assembles files never loads the shell. The number that matters for
   * it is the cost of the entry, which is what the writer costs when nothing else is asked for.
   */
  { label: 'merge-only', fixture: 'merge.mjs' },
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
    // A standalone entry is not a core plus something, so there is no increment to state: `headless`
    // and `merge` are each their own bundle, and the number a reader wants from them is the whole figure.
    path.label === 'core' || path.label === 'headless-only' || path.label === 'merge-only'
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

/*
 * FR-22's second clause, which no gate held before: the core stylesheet carries no rules for a feature the
 * application did not request. JavaScript is tree-shaken and CSS is not, so one stray rule is bytes every
 * consumer downloads whether or not they mounted the feature whose DOM it styles.
 *
 * The two sets come from the source that owns them. A class is *feature-only* when a module under
 * `src/features/`, or the `edit`/`merge` entries, writes its name and no core module does — the shell's
 * components, the lib, the headless hooks or either barrel. Shared primitives are not offenders by
 * construction and that is deliberate: `pjsr-button` and `pjsr-canvas-wrapper` are the core's own vocabulary,
 * and a feature extending one of them styles a node the core rendered, which is the clause permitting the
 * rule rather than forbidding it.
 *
 * The count is printed rather than asserted alone, because an empty feature-only set would pass every rule
 * below it for the wrong reason — a scanner that found nothing to check.
 */
const CSS_CLASS = /pjsr-[a-z][a-z0-9-]*/g;

function listSource(dir, singles = []) {
  const found = [];
  if (existsSync(dir)) {
    for (const item of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, item.name);
      if (item.isDirectory()) found.push(...listSource(path));
      else if (/\.tsx?$/.test(item.name) && !/\.test\.tsx?$/.test(item.name)) found.push(path);
    }
  }
  return found.concat(singles);
}

function classesIn(files) {
  const out = new Set();
  for (const file of files) {
    for (const match of readFileSync(file, 'utf8').matchAll(CSS_CLASS)) out.add(match[0]);
  }
  return out;
}

const coreRendered = classesIn(
  listSource(join(root, 'src', 'components')).concat(
    listSource(join(root, 'src', 'lib')),
    listSource(join(root, 'src', 'headless')),
    [join(root, 'src', 'index.ts'), join(root, 'src', 'headless.ts')],
  ),
);
const featureOnly = [
  ...[
    ...classesIn(
      listSource(join(root, 'src', 'features'), [
        join(root, 'src', 'edit.tsx'),
        join(root, 'src', 'merge.ts'),
      ]),
    ),
  ]
    .filter((name) => !coreRendered.has(name))
    .sort(),
];
const coreSheet = existsSync(join(dist, 'styles.css'))
  ? classesIn([join(dist, 'styles.css')])
  : new Set();
const leaked = featureOnly.filter((name) => coreSheet.has(name));

if (featureOnly.length === 0) {
  console.error('FAIL  no class is rendered only by a feature, so the core-sheet rule proved nothing');
  failed = true;
}
for (const name of leaked) {
  console.error(`FAIL  styles.css carries a rule for .${name}, which only a feature renders (FR-22)`);
  failed = true;
}
if (!leaked.length && featureOnly.length) {
  console.log(
    `\nthe core stylesheet, FR-22\n` +
      `  ok    styles.css carries none of the ${featureOnly.length} classes only a feature renders ` +
      `(${featureOnly.slice(0, 4).join(', ')}, …)`,
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
