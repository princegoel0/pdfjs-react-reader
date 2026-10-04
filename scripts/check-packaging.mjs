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
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

/** Every file path an export entry names, however deep the conditions go. */
function targetsOf(entry) {
  if (typeof entry === 'string') return [entry];
  if (!entry || typeof entry !== 'object') return [];
  return Object.values(entry).flatMap(targetsOf);
}

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
 * FR-52: the export map *is* the public surface, so every key must be one of the classes the requirement
 * names, and nothing may become public by accident.
 *
 * Three ways a surface leaks that this closes, none of which the build can see:
 *  - a wildcard key (`"./*"`) makes every file in `files` reachable, which turns an internal chunk into a
 *    documented path the day a host imports it;
 *  - a `./types` entry publishes declarations as their own module, which §4.10 forbids: the type contract
 *    belongs to the JavaScript entry it describes, and a second home for a type is a second place for it
 *    to be wrong;
 *  - a key that matches no class. The requirement lists them, so an unclassified entry is either a leak or
 *    an undocumented surface, and both are found by a consumer rather than by us.
 *
 * The behavioural half of "internal modules are unreachable" is not here: `npm run check:examples` resolves
 * an unpublished subpath against the packed artifact and fails, which is what proves Node's `exports`
 * matching rather than this file's reading of it.
 */
const PUBLIC_CLASSES = [
  ['root', (subpath) => subpath === '.'],
  ['headless', (subpath) => subpath === './headless'],
  ['edit', (subpath) => subpath === './edit'],
  ['merge', (subpath) => subpath === './merge'],
  ['feature tier', (subpath) => subpath.startsWith('./features/')],
  ['locale catalog', (subpath) => subpath.startsWith('./locales/')],
  ['stylesheet', (subpath) => subpath.endsWith('.css')],
  ['package metadata', (subpath) => subpath === './package.json'],
];

console.log('\npublic surface classification (FR-52)');
const counts = new Map();
for (const [subpath, entry] of Object.entries(pkg.exports)) {
  if (subpath.includes('*')) {
    fail(`"${subpath}" is a wildcard key — it makes everything in \`files\` importable`);
    continue;
  }
  if (subpath === './types') fail('./types publishes declarations as their own module (§4.10 forbids it)');
  const classes = PUBLIC_CLASSES.filter(([, match]) => match(subpath)).map(([name]) => name);
  if (classes.length === 0) {
    fail(`"${subpath}" belongs to no class FR-52 lists — classify it there or remove it from the map`);
    continue;
  }
  if (classes.length > 1) fail(`"${subpath}" matches two classes (${classes.join(', ')}): the list is ambiguous`);
  const name = classes[0];
  // `./package.json` is the one entry that legitimately points outside `dist/` — it is npm's own convention
  // for letting a host read the version, and `files` ships it deliberately.
  if (name !== 'package metadata') {
    for (const target of targetsOf(entry)) {
      // `./dist/x.js` and `dist/x.js` are the same path to Node; the map writes the first form.
      const plain = target.replace(/^\.\//, '');
      if (!plain.startsWith('dist/')) {
        fail(`${subpath} points outside dist/ at ${target} — src/ must never be reachable from the map`);
      }
    }
  }
  counts.set(name, (counts.get(name) ?? 0) + 1);
}
for (const [name, count] of counts) console.log(`  ok    ${name.padEnd(18)} ${count}`);
const classified = [...counts.values()].reduce((a, b) => a + b, 0);
console.log(
  `  ${classified}/${Object.keys(pkg.exports).length} keys classified, shipping ${pkg.files.join(', ')} only`,
);

/**
 * FR-22's third clause, and the one the export map cannot speak for on its own: "stylesheets are exempt from
 * tree-shaking; JavaScript is not". A host writes `import 'pdfjs-react-reader/annotate.css'` for its side
 * effect and binds nothing, which is exactly the import shape a bundler drops unless the package says the
 * module has effects. The list going wrong has two directions and both are silent: an exempted JS glob keeps
 * a feature's code in every bundle, and CSS missing from the list loses a feature's styling with no error
 * anywhere. Both fail here.
 */
console.log('\nside effects (FR-22)');
const sideEffects = pkg.sideEffects;
if (!Array.isArray(sideEffects)) {
  fail(
    `sideEffects is ${JSON.stringify(sideEffects)} — \`true\` exempts the JavaScript too and an absent list ` +
      'tells a bundler that nothing is side-effect-free, which is the same trap facing the other way',
  );
} else {
  for (const entry of sideEffects) {
    if (!entry.endsWith('.css')) {
      fail(`sideEffects exempts "${entry}", and JavaScript must not be exempt (FR-22)`);
    }
  }
  if (!sideEffects.some((entry) => entry.endsWith('.css'))) {
    fail('sideEffects exempts no stylesheet, so a bare CSS import can be dropped (FR-22)');
  }
  const sheets = Object.keys(pkg.exports).filter((subpath) => subpath.endsWith('.css'));
  console.log(
    `  ok    ${sideEffects.length} exempt glob(s), CSS only (${sideEffects.join(', ')}), ` +
      `against ${sheets.length} published stylesheets`,
  );
}

/**
 * FR-41's floor, which is one number with three claims on it: §8 states it, `engines.node` publishes it to
 * npm, and the CI matrices are where it gets measured. Nothing but this check keeps them equal, and the
 * manifest has already been wider than the contract once (`>=20` against a 22.13.0 floor) while a job kept
 * running on Node 20 — which is how an unsupported runtime accumulates green checks nobody notices.
 *
 * A bare major in a matrix (`'22'`, `'24'`) is read as it is executed: the newest release of that major,
 * which cannot fall below a floor inside the same major. An exact pin is compared exactly.
 */
console.log('\nNode floor (FR-41)');
const tuple = (v) => v.split('.').map(Number);
const atLeast = (candidate, minimum) => {
  const a = tuple(candidate);
  const b = tuple(minimum);
  for (let i = 0; i < 3; i += 1) {
    if ((a[i] ?? 0) > (b[i] ?? 0)) return true;
    if ((a[i] ?? 0) < (b[i] ?? 0)) return false;
  }
  return true;
};

const prd = readFileSync(join(root, 'PRD.md'), 'utf8');
const rows = [...prd.matchAll(/^\| Node \([^)]*\) \| Yes \| \w+ \| ([\d.]+) \|/gm)].map((m) => m[1]);
if (rows.length < 2) {
  fail(
    `PRD.md §8 yielded ${rows.length} Node rows — this check compares the manifest against both of them, ` +
      'so a table that changed shape must move this line rather than pass quietly',
  );
} else if (new Set(rows).size > 1) {
  fail(`PRD.md §8's Node rows disagree with each other: ${[...new Set(rows)].join(' and ')}`);
} else {
  const floor = rows[0];
  const advertised = pkg.engines?.node;
  if (advertised !== `>=${floor}`) {
    fail(`engines.node says ${JSON.stringify(advertised)} where §8's floor is ${floor} (FR-41)`);
  }

  // The peer decides whether the floor is even loadable: our range must sit inside its own.
  const peerPath = join(root, 'node_modules', 'pdfjs-dist', 'package.json');
  if (!existsSync(peerPath)) {
    fail(`${peerPath} is not installed, so the peer's own Node floor cannot be compared with ours`);
  } else {
    const peerEngines = String(JSON.parse(readFileSync(peerPath, 'utf8')).engines?.node ?? '');
    const peerVersions = [...peerEngines.matchAll(/(\d+\.\d+\.\d+)/g)].map((m) => m[1]);
    // The peer's range is an alternation (`>=22.13.0 || >=24`), so its floor is the lowest version named.
    const byVersion = (a, b) => (atLeast(a, b) ? (a === b ? 0 : 1) : -1);
    const peerFloor = [...peerVersions].sort(byVersion)[0];
    if (!peerFloor) {
      fail(`the installed pdfjs-dist declares no X.Y.Z Node floor in ${JSON.stringify(peerEngines)}`);
    } else if (!atLeast(floor, peerFloor)) {
      fail(
        `our floor ${floor} is below the peer's own ${peerFloor} from ${peerEngines}: ` +
          'a host could install a Node we support that the engine refuses',
      );
    }
  }

  const pins = [];
  const workflowDir = join(root, '.github', 'workflows');
  if (!existsSync(workflowDir)) {
    fail('.github/workflows is missing, so no CI matrix could be compared with the floor');
  }
  for (const file of readdirSync(workflowDir).filter((f) => f.endsWith('.yml'))) {
    const text = readFileSync(join(workflowDir, file), 'utf8');
    for (const match of text.matchAll(/node:\s*\[([^\]]*)\]/g)) {
      for (const quoted of match[1].matchAll(/'([^']+)'/g)) pins.push([`${file} matrix`, quoted[1]]);
    }
    for (const match of text.matchAll(/^\s*node-version:\s*(.+)$/gm)) {
      const value = match[1].trim().replace(/^['"]|['"]$/g, '');
      // `${{ matrix.node }}` is the matrix's own entry, which the loop above already read.
      if (value && !value.includes('${{')) pins.push([`${file} node-version`, value]);
    }
  }
  const below = pins.filter(([, v]) =>
    /^\d+$/.test(v) ? Number(v) < tuple(floor)[0] : !atLeast(v, floor),
  );
  for (const [where, v] of below) {
    fail(`${where} runs Node ${v}, which FR-41 excludes (§8's floor is ${floor})`);
  }
  if (!pins.some(([, v]) => v === floor)) {
    fail(`no CI job pins Node ${floor} exactly, so the floor the contract claims is never measured`);
  }
  if (!below.length && pins.length) {
    console.log(
      `  ok    engines.node >=${floor} matches §8 and the peer's own ${floor} floor; ` +
        `${pins.length} Node pins across ${new Set(pins.map(([w]) => w.split(' ')[0])).size} workflow files, ` +
        `all at or above, floor pinned`,
    );
  }
}

/**
 * The boundary the build cannot cross: `pdfjs-dist` is ESM-only with no `exports` map, so a `require()`
 * that reaches it depends on Node's own `require(esm)` support. Reported here so the version this ran on is
 * in the log next to the verdict, and so a future failure says which side of the boundary broke.
 */
console.log(`\nran on node ${process.version}; ${jsPaths.length} JS subpaths checked`);

if (failed) {
  console.error(
    '\nA published surface is wrong: a format, its types, its names (FR-41), an export-map key that is ' +
      'not one of the classes §4.10 lists (FR-52), or a side-effects list that exempts JavaScript (FR-22).',
  );
  process.exit(1);
}
