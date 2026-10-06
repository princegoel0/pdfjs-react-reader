/**
 * Measures what a consumer actually downloads, per tier, and fails the build on
 * three different mistakes.
 *
 * **The ratchet.** Every number is compared against `size-baseline.json`. Growth
 * past 2 % (plus 256 bytes of minifier noise) is reported as `GREW`; only
 * **200 % of the accepted size fails** — the owner's ruling on #208, that a size
 * gate must not block development or a feature, and that the thing worth
 * stopping is a doubling, which is never a feature: it is a dependency arriving,
 * a static feature import, or a second copy of something. A library that grows
 * with features cannot honestly promise a fixed size — `pdfjs-dist` alone is
 * 131.7 kB gzipped on the main thread and 375.3 kB in its worker — so what is
 * promised instead is that bytes never
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
/**
 * The line above which growth is *reported*. Not a failure line — see `HARD_STOP` — but the reason a
 * diff shows `GREW`: bytes must never arrive quietly, which is the only thing a ratchet can promise.
 */
const TOLERANCE = 0.02;
const SLACK_BYTES = 256;
/**
 * The only number this gate fails on: 200 % of the accepted size for a path.
 *
 * Owner ruling on #208, 2026-10-05: "we can raise the size if any feature required but it should not block
 * the development or feature or anything unless it becomes 200% in size from the current size". So the
 * ratchet reports growth and stops gatekeeping it, and what remains forbidden is the thing a size gate was
 * never allowed to do — pressure that removes or degrades required functionality, which §6 already rules out.
 * A doubling is kept as a failure because it is the one signal that cannot be a feature: a path that grew
 * past 2× its accepted size has almost certainly gained a whole dependency, a static feature import, or a
 * second copy of something, and that is worth stopping the build for.
 */
const HARD_STOP = 2;
/*
 * Each feature's *expected* cost over the core bundle — a target, not a ceiling, since #208.
 *
 * This was 4 kB from `0.4` until the signing work, which measured 5.53 kB for `edit` and 4.73 kB
 * for the same tier with its interface removed — so the writer and the geometry it needs cost more
 * than the number, on their own and before any UI is counted. It moved because what the project
 * holds fixed moved: bytes are a ratchet that records decisions, and the requirement that does not
 * bend is behaviour under load (`PRD.md` §6). A tier that has to parse the file it is showing is
 * allowed to cost the kilobytes that doing so takes, provided the work is asked for rather than
 * volunteered, runs once, and says so while it runs — which is exactly the shape signing ended up
 * in, and exactly the case the owner ruled must not be blocked by this number.
 *
 * So the number still has a job: it is what a tier is *expected* to cost, it is what the report
 * measures each one against, and past twice it the build stops, because a tier that doubled has
 * picked up something other than its own feature. At 6 kB the largest expected tier is a quarter of
 * the core again rather than a fifth, and the next feature that reaches for the writer inherits the
 * same room without another conversation.
 */
const FEATURE_TARGET_BYTES = 6 * KB;

/* ------------------------------------------------------------------ *
 * The two decision rules, separated from the measuring so a synthetic
 * number can test them (FR-23, `selfTest` below).
 * ------------------------------------------------------------------ */

/**
 * A baselined path against the size that was accepted for it: reported past the minifier's noise,
 * stopped at 200 %. Returns the flag the report prints, never pads it.
 */
function pathVerdict(bytes, accepted) {
  if (bytes > accepted * HARD_STOP) return 'FAIL';
  // The noise line is `TOLERANCE` *plus* `SLACK_BYTES`, so a small path cannot be flagged by rounding:
  // 2 % of a 2.3 kB catalog is 46 B, which is smaller than a changed chunk name.
  if (bytes > accepted * (1 + TOLERANCE) + SLACK_BYTES) return 'GREW';
  return 'ok';
}

/**
 * A tier's cost over core against what that tier is *expected* to cost. Past the target is a report;
 * twice the target is the same stop the ratchet uses, because a tier that doubled gained something
 * that is not the feature.
 */
function tierVerdict(bytes, limit) {
  if (bytes > limit * HARD_STOP) return 'FAIL';
  if (bytes > limit) return 'GREW';
  return 'ok';
}

/**
 * Does the gate still gate? Every case below is a number a real bundle could be, and the two states the
 * owner's #208 ruling separated are the ones being tested: growth that is reported and growth that stops
 * the build. A guard nobody can prove still bites is a comment, so this runs on every `npm run size`
 * before anything is bundled — cheap, and it fails before a minute of esbuild work.
 *
 * Measured on 2026-10-05 by breaking the rule on purpose, in copies under `.spike/` (each case ran to
 * completion and exited 1): `HARD_STOP = 1.01` — the regression that silently turns the ratchet back into
 * the ceiling §6 forbids — reported 7 failures, including `HARD_STOP 1.01 is at or below the reporting line
 * 1.02, so nothing is ever reported`; `HARD_STOP = 1.5` reported 4, because three sizes that are now legal
 * were being stopped; and returning `FAIL` where the report line belongs returned 3, naming each of them.
 * A baseline at half of today's `core` still produces the other half of the proof end to end —
 * `FAIL core 31.01 kB gz +15.51 kB`, exit 1 — and one at 90 % produces
 * `GREW core 31.01 kB gz +3.10 kB`, exit 0.
 */
function selfTest() {
  const cases = [
    // A path at its accepted size, 25 B past it (inside the noise line), past the noise line, at exactly
    // 2× (still a report), and one byte past it (the stop).
    ['path, unchanged', pathVerdict(10_000, 10_000), 'ok'],
    ['path, +25 B', pathVerdict(10_025, 10_000), 'ok'],
    ['path, 1.05×', pathVerdict(10_500, 10_000), 'GREW'],
    ['path, 1.99×', pathVerdict(19_900, 10_000), 'GREW'],
    ['path, exactly 2×', pathVerdict(20_000, 10_000), 'GREW'],
    ['path, 2.01×', pathVerdict(20_100, 10_000), 'FAIL'],
    ['path, 3×', pathVerdict(30_000, 10_000), 'FAIL'],
    // Shrinking is always free (#208: the gate reports, it does not reward).
    ['path, half of accepted', pathVerdict(5_000, 10_000), 'ok'],
    // A tier against its target, including today's real `edit` number and the stop it is nowhere near.
    ['tier, at target', tierVerdict(6_000, 6_000), 'ok'],
    ['tier, 6.46 kB of 6 kB', tierVerdict(6_460, 6_000), 'GREW'],
    ['tier, exactly 2× target', tierVerdict(12_000, 6_000), 'GREW'],
    ['tier, 2.01× target', tierVerdict(12_100, 6_000), 'FAIL'],
  ];
  const failures = cases
    .filter(([, got, want]) => got !== want)
    .map(([name, got, want]) => `${name} classified as ${got}, expected ${want}`);
  // And the shape of the ruling, not just its arithmetic: if the stop ever sits at or below the noise
  // line, `GREW` is unreachable and the gate has silently become the hard ceiling §6 forbids.
  if (HARD_STOP <= 1 + TOLERANCE) {
    failures.push(
      `HARD_STOP ${HARD_STOP} is at or below the reporting line ${1 + TOLERANCE}, so nothing is ever reported`,
    );
  }
  if (HARD_STOP !== 2) failures.push(`HARD_STOP is ${HARD_STOP}, not the 200 % the #208 ruling set`);
  const lines = cases.length + 2;
  return { failures, lines };
}

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

/* Run first, because a broken decision rule makes every number below it meaningless — and it costs
   nothing, unlike the bundling. */
if (!process.argv.includes('--no-selftest')) {
  const { failures, lines } = selfTest();
  if (failures.length) {
    for (const line of failures) console.error(`FAIL  the size gate is not a gate: ${line}`);
    console.error('\nFR-23 is not met: the decision rule itself is broken, so the numbers below it mean nothing.');
    process.exit(1);
  }
  console.log(`  ok    ${lines} synthetic size cases classified as the #208 ruling requires (FR-23)\n`);
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
  const accepted = baseline[label] ?? bytes;
  const verdict = pathVerdict(bytes, accepted);
  const over = verdict === 'FAIL';
  if (over) failed = true;
  const delta = bytes - accepted;
  // Three states, because "nothing changed" and "it got bigger and somebody looked" are different facts.
  const flag = verdict.padEnd(4);
  const change =
    baseline[label] === undefined ? 'new   ' : `${delta >= 0 ? '+' : ''}${(delta / KB).toFixed(2)} kB`.padEnd(8);
  console.log(
    `${flag}  ${label.padEnd(15)} ${(bytes / KB).toFixed(2).padStart(7)} kB gz   ${change}  ${detail}` +
      // The line a doubling is judged against, so `GREW` cannot be read as "fine, keep going" forever.
      (over
        ? `\n     ${(bytes / accepted).toFixed(2)}× the accepted ${(accepted / KB).toFixed(2)} kB — the 200 % stop.`
        : ''),
  );
  measured[label] = bytes;
}

console.log('shipped files, per entry point');
for (const path of filePaths)
  report(
    path.label,
    path.files.reduce((sum, file) => sum + gzipSync(readFileSync(join(dist, file)), { level: 9 }).length, 0),
    path.files.join(' + '),
  );

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
  // The same rule as the ratchet: the target is what the tier is *expected* to cost, and only twice it is a
  // failure. A feature that needs more bytes is allowed to have them; a feature that doubled has picked up
  // something nobody meant to ship.
  const verdict = tierVerdict(tier.bytes, tier.limit);
  const over = verdict === 'FAIL';
  if (over) failed = true;
  console.log(
    `  ${verdict.padEnd(4)}  ${tier.label.padEnd(9)} ${(tier.bytes / KB).toFixed(2).padStart(6)} kB gz of ${(tier.limit / KB).toFixed(0)} kB` +
      (verdict !== 'ok'
        ? ` — ${(tier.bytes / tier.limit).toFixed(2)}× the target, ${((tier.limit * HARD_STOP) / KB).toFixed(0)} kB is the stop`
        : ''),
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
      listSource(join(root, 'src', 'features'), [join(root, 'src', 'edit.tsx'), join(root, 'src', 'merge.ts')]),
    ),
  ]
    .filter((name) => !coreRendered.has(name))
    .sort(),
];
const coreSheet = existsSync(join(dist, 'styles.css')) ? classesIn([join(dist, 'styles.css')]) : new Set();
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

/*
 * The docs site's footprint tables used to be typed by hand at each release close, which is how
 * `annotate` came to read 1.86 kB in a page while the gate measured 2.05, and how a whole table quietly
 * kept a `core` from nine releases ago. PRD's front matter rule 2 says a figure lives in one place and is
 * kept current, so this writes what the gate just measured to `docs/src/size-figures.json` and the docs
 * render from it: there is no number left in the docs to re-remember. `npm run check:docs` holds the two
 * together — every feature the export map publishes must appear here, and every row the docs tables print
 * must be answerable from it.
 */
const figuresPath = join(root, 'docs', 'src', 'size-figures.json');
const kib = (bytes) => Number((bytes / KB).toFixed(2));

/*
 * The engine and the writer are quoted beside our own numbers wherever a reader is asking how big this layer is
 * next to what it needs, and those quotes were typed by hand in five files. The digits reproduced, but a peer
 * figure without the version it was measured on is an adjective about somebody's `node_modules` - and the writer
 * had moved from 251.41 to 251.53 kB between the last hand-copy and this one. #240 re-measured every quote and
 * found its own probe wrong first: it divided by 1024 where the documents divide by 1000. So these are measured
 * here, on the version actually installed, with that version shipped beside each figure.
 */
const peerPaths = [
  ['pdfjs-dist', 'build/pdf.min.mjs', 'engineMain'],
  ['pdfjs-dist', 'build/pdf.worker.min.mjs', 'engineWorker'],
  ['@cantoo/pdf-lib', 'dist/pdf-lib.esm.min.js', 'writer'],
];
const peers = Object.fromEntries(
  peerPaths.map(([packageName, relative, key]) => {
    const base = join(root, 'node_modules', ...packageName.split('/'));
    try {
      const version = JSON.parse(readFileSync(join(base, 'package.json'), 'utf8')).version;
      return [key, { version, kB: kib(gzipSync(readFileSync(join(base, relative)), { level: 9 }).length) }];
    } catch {
      // An optional peer that is not installed is not a size claim; `null` says which, and the docs say so too.
      return [key, null];
    }
  }),
);

const docsFigures = {
  '//': 'Generated by `npm run size` (scripts/check-size.mjs) from the worst of esbuild and Rollup over the built artifact. The docs site renders its size tables from this file; edit the gate, not this file. `kB` is what a consumer import costs, `overCore` is each feature or tier apart from core, both in gzipped kilobytes, and `peers` is the engine and the writer as installed, at gzip level 9 with the version each figure came from.',
  measuredOn: new Date().toISOString().slice(0, 10),
  kB: Object.fromEntries(Object.entries(measured).map(([label, bytes]) => [label, kib(bytes)])),
  peers,
  overCore: Object.fromEntries(
    consumerPaths
      // `headless-only` and `merge-only` are their own bundles, not core plus something — the same
      // distinction the report above makes by printing no increment for them.
      .filter((path) => path.label.startsWith('core+') || path.label === 'all')
      .map((path) => [path.label.replace(/^core\+/, ''), kib(measuredConsumer.get(path.label) - coreSize)]),
  ),
};
writeFileSync(figuresPath, `${JSON.stringify(docsFigures, null, 2)}\n`);
console.log(
  `\nwrote ${figuresPath} — ${Object.keys(docsFigures.overCore).length} feature and tier figures, ` +
    `measured ${docsFigures.measuredOn}, for the docs site to render`,
);

if (update) {
  const body = `${JSON.stringify(
    {
      '//': 'Gzipped bytes per measured path, accepted by `npm run size:update`. The build stops at 200% of these; growth past 2% is reported as GREW. See scripts/check-size.mjs.',
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
    `\nA path passed 200% of its accepted size, or a feature leaked into the core bundle.\n` +
      `Ordinary growth is not this message — it prints GREW and the build carries on,\n` +
      `because #208 ruled that bytes must not block a feature. Twice the accepted size is\n` +
      `where that stops being a feature and starts being a mistake: a dependency arriving, a\n` +
      `second copy of something, or a static import of a tier. Check which, then either undo\n` +
      `it or move the line with \`npm run size:update\`, which is the record that somebody\n` +
      `decided. A marker failure is the shell importing a feature statically again, which no\n` +
      `amount of accepting fixes.`,
  );
  process.exit(1);
}
