/**
 * FR-41: the dual output, proved rather than assumed.
 *
 * `tsup` was told to emit both formats, which is the easy half. The part that can silently be wrong is
 * that a `require()` consumer gets *the same package* an `import` consumer gets — the same names, the same
 * declarations, the same behaviour on a machine with no DOM. Three checks, run against `dist/` after the
 * build and wired into `npm run verify`:
 *
 *  1. every JS subpath in the export map offers both conditions, each with its own declaration file, and
 *     every file named exists (the shape `copy-assets.mjs` also guards; this one is the readable failure);
 *  2. `require(path)` and `await import(path)` expose **the same set of export names** — a format whose
 *     surface has drifted is not a second format, it is a second package;
 *  3. requiring every entry with no DOM present does not throw, which is FR-46's import-safety property
 *     asked of the other half of the surface.
 *
 * The last is the one that matters most and the one a bundler will never tell you about: a CJS host in a
 * Jest test resolves `require` and runs it in Node, and nothing in the browser build path exercises that.
 */
import { createRequire } from 'node:module';
import { readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const requireCjs = createRequire(join(root, 'noop.cjs'));
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));

const jsPaths = Object.entries(pkg.exports).filter(
  ([subpath, entry]) => subpath !== './package.json' && typeof entry === 'object' && entry.import?.default,
);

let failed = false;
const fail = (message) => {
  console.error(`FAIL  ${message}`);
  failed = true;
};

/** 1. Shape: both conditions, both declaration files, every target on disk. */
console.log('export map shape');
for (const [subpath, entry] of jsPaths) {
  const expected = [
    ['import.default', entry.import?.default],
    ['import.types', entry.import?.types],
    ['require.default', entry.require?.default],
    ['require.types', entry.require?.types],
  ];
  const problems = expected.filter(([, target]) => !target).map(([key]) => `no ${key}`);
  for (const [, target] of expected) {
    if (target && !existsSync(join(root, target))) problems.push(`${target} was not emitted`);
  }
  if (problems.length) fail(`${subpath}: ${problems.join(', ')}`);
}
if (!failed) console.log(`  ok    ${jsPaths.length} JS subpaths, each with .js/.cjs and .d.ts/.d.cts`);

/** 2+3. The two formats agree, and both load without a DOM. */
console.log('\nrequire() vs import()');
for (const [subpath, entry] of jsPaths) {
  const specifier = join(root, entry.require.default);
  const esmSpecifier = join(root, entry.import.default);
  let cjsNames;
  let esmNames;
  try {
    cjsNames = Object.keys(requireCjs(specifier)).filter((name) => name !== 'default').sort();
  } catch (error) {
    fail(`${subpath} could not be required: ${error.message.split('\n')[0]}`);
    continue;
  }
  try {
    const mod = await import(pathToFileURL(esmSpecifier).href);
    esmNames = Object.keys(mod).filter((name) => name !== 'default').sort();
  } catch (error) {
    fail(`${subpath} could not be imported: ${error.message.split('\n')[0]}`);
    continue;
  }
  const onlyCjs = cjsNames.filter((name) => !esmNames.includes(name));
  const onlyEsm = esmNames.filter((name) => !cjsNames.includes(name));
  if (onlyCjs.length || onlyEsm.length) {
    fail(
      `${subpath} exports differ by format — ` +
        `cjs only: [${onlyCjs.join(', ')}] esm only: [${onlyEsm.join(', ')}]`,
    );
    continue;
  }
  console.log(`  ok    ${subpath.padEnd(34)} ${String(cjsNames.length).padStart(3)} names, both formats`);
}

/**
 * The boundary the build cannot cross: `pdfjs-dist` is ESM-only with no `exports` map, so a `require()`
 * that reaches it depends on Node's own `require(esm)` support. Reported here so the version this ran on is
 * in the log next to the verdict, and so a future failure says which side of the boundary broke.
 */
console.log(`\nran on node ${process.version}; ${jsPaths.length} JS subpaths checked`);

if (failed) {
  console.error('\nFR-41 is not met: a published path is missing a format, its types, or its names.');
  process.exit(1);
}
