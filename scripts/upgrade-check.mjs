/**
 * FR-58, §9: the documented upgrade path, exercised rather than described.
 *
 * §9's bullet asks for "the documented upgrade path from `0.1.2` to `1.0.0` … exercised, including
 * lockfile/dependency migration and public API checks", and FR-58's own clause says the candidate must
 * "validate upgrade from the previous public release". Until this script nothing did: `check:packaging` and
 * `check:tarball` both install the candidate into an *empty* project, so they prove the artifact resolves
 * from scratch and say nothing about the consumer who already has `0.1.2` in `node_modules` and a lockfile
 * that names it. That is the population the CVE in §6.2 is about — a host that installed 0.1.x and is being
 * told to move.
 *
 * So this does the move. It installs the registry's current release, records what a host could reach at that
 * version, installs the packed candidate over it the way an upgrade does, and compares. Three things can fail:
 * the installed version does not move (the lockfile did not migrate), the peer ranges the manifest declares are
 * no longer satisfied (dependency migration broke the host's own choices), or a name that resolved before does
 * not resolve now — which is only allowed if `api-maturity.json`'s `removed` ledger already announced it,
 * because §5.5 says a withdrawal is a documented thing or it is a defect.
 *
 * Slow and network-bound, like `check:tarball`: `npm run check:upgrade`, run by the release-candidate job
 * rather than by `verify`.
 */
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const work = join(root, '.spike', 'upgrade-check');
const consumer = join(work, 'consumer');
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));

/** `--name=value`, falling back to the shipped default when the flag is absent. */
const flag = (name, fallback) => {
  const inline = process.argv.slice(2).find((a) => a.startsWith(`--${name}=`));
  return inline ? inline.slice(name.length + 3) : fallback;
};
const ledger = JSON.parse(readFileSync(join(root, 'api-maturity.json'), 'utf8')).removed ?? {};

/** The same engine refusal `check:tarball` makes: a result from an unsupported runtime is not evidence. */
const floor = /(\d+)\.(\d+)\.(\d+)/.exec(pkg.engines?.node ?? '');
if (!floor) {
  console.error('FAIL  package.json declares no `engines.node` for this script to check against');
  process.exit(1);
}
const asTuple = (v) => v.split('.').map(Number);
const [fMaj, fMin, fPat] = asTuple(floor[0]);
const [nMaj, nMin, nPat] = asTuple(process.versions.node);
if (nMaj < fMaj || (nMaj === fMaj && (nMin < fMin || (nMin === fMin && nPat < fPat)))) {
  console.error(
    `FAIL  node ${process.versions.node} is below the ${floor[0]} floor the contract advertises, so an upgrade ` +
      'result from here says nothing about a supported host.',
  );
  process.exit(1);
}

/**
 * npm through node, never through a shell.
 *
 * `spawnSync('npm', …, { shell: true })` is what the registry-write attempt on 2026-10-09 did, and bash read the
 * `>=6.2.108` in an argument as a redirection: the command arrived as twenty words and an empty file named
 * `22.13.0` appeared in the repository. Node's own `npm-cli.js` takes argv literally, so a range in a message or
 * an argument stays one argument.
 */
const npmCli = join(process.execPath, '..', 'node_modules', 'npm', 'bin', 'npm-cli.js');
const step = (args, cwd, label, { echo = true } = {}) => {
  const result = spawnSync(process.execPath, [npmCli, ...args], {
    cwd,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
  if (echo) process.stdout.write(`${result.stdout ?? ''}`);
  if (result.status === 0) return result.stdout ?? '';
  console.error(`FAIL  ${label}\n${result.stdout ?? ''}${result.stderr ?? ''}`);
  process.exit(1);
};

/** A generated probe is run with node, not npm — the two were conflated once already and the message is clearer apart. */
const runNode = (file, cwd, label) => {
  const result = spawnSync(process.execPath, [join(cwd, file)], { cwd, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
  if (result.status === 0) return;
  console.error(`FAIL  ${label}\n${result.stdout ?? ''}${result.stderr ?? ''}`);
  process.exit(1);
};

const FAILS = [];
const NOTES = [];

/**
 * The JS subpaths an installed copy of this package offers, read from the manifest the install wrote.
 *
 * Both shapes the export map has ever used are walked: 0.1.2 wrote `{ "import": "./dist/index.js" }` and the
 * candidate writes `{ "import": { "types": …, "default": … } }`. The first version of this reader only understood
 * the second, so the base release appeared to expose nothing, the name comparison had nothing to compare, and the
 * check went green on an empty premise — which is the one outcome worse than a failure. An empty base is now a
 * refusal, below.
 */
function importTarget(entry) {
  if (typeof entry === 'string') return entry;
  const arm = entry?.import ?? entry?.default;
  if (typeof arm === 'string') return arm;
  if (arm && typeof arm.default === 'string') return arm.default;
  return null;
}

function jsSubpaths(dir) {
  const manifest = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'));
  const subpaths = Object.entries(manifest.exports ?? {})
    .filter(
      ([subpath, entry]) =>
        subpath !== './package.json' &&
        !subpath.endsWith('.css') &&
        String(importTarget(entry) ?? '').endsWith('.js'),
    )
    .map(([subpath]) => (subpath === '.' ? 'pdfjs-react-reader' : `pdfjs-react-reader${subpath.slice(1)}`));
  return { manifest, subpaths };
}

/**
 * What a host can actually reach: every export name of every published JS entry, through both module systems.
 *
 * Written as a generated probe rather than a `node -e` one-liner for the same reason `check:tarball` does it —
 * the two formats can disagree, and the only way to see that is to ask each one and keep the answers.
 */
function snapshot(tag) {
  const { manifest, subpaths } = jsSubpaths(join(consumer, 'node_modules', 'pdfjs-react-reader'));
  writeFileSync(
    join(consumer, `probe-${tag}.cjs`),
    `const cases = ${JSON.stringify(subpaths)};
const out = {};
for (const s of cases) { try { out[s] = Object.keys(require(s)).filter((n) => n !== 'default').sort(); } catch (e) { out[s] = { error: String(e.code || e.message) }; } }
require('node:fs').writeFileSync(__dirname + '/names-${tag}.cjs.json', JSON.stringify(out, null, 1));
`,
  );
  writeFileSync(
    join(consumer, `probe-${tag}.mjs`),
    `import { writeFileSync } from 'node:fs';
const cases = ${JSON.stringify(subpaths)};
const out = {};
for (const s of cases) {
  try { const m = await import(s); out[s] = Object.keys(m).filter((n) => n !== 'default').sort(); }
  catch (e) { out[s] = { error: String(e.code || e.message) }; }
}
// Relative: the probe is run with this project as its cwd, so no absolute path has to survive the trip.
writeFileSync('names-${tag}.esm.json', JSON.stringify(out, null, 1));
`,
  );
  runNode(`probe-${tag}.cjs`, consumer, `the CommonJS probe at ${tag}`);
  runNode(`probe-${tag}.mjs`, consumer, `the ESM probe at ${tag}`);
  const readNames = (ext) => JSON.parse(readFileSync(join(consumer, `names-${tag}.${ext}.json`), 'utf8'));
  return {
    manifest,
    version: manifest.version,
    subpaths,
    cjs: readNames('cjs'),
    esm: readNames('esm'),
  };
}

rmSync(work, { recursive: true, force: true });
mkdirSync(join(work, 'pack'), { recursive: true });
mkdirSync(consumer, { recursive: true });

console.log('packing the candidate');
step(['pack', '--pack-destination', join(work, 'pack')], root, 'npm pack');
const tarball = readdirSync(join(work, 'pack')).find((file) => file.endsWith('.tgz'));
if (!tarball) {
  console.error('FAIL  npm pack produced no tarball');
  process.exit(1);
}
const tarballPath = join(work, 'pack', tarball).replace(/\\/g, '/');
const sha256 = createHash('sha256').update(readFileSync(tarballPath)).digest('hex');
console.log(`  ${tarball} — sha256 ${sha256.slice(0, 16)}…`);

/*
 * The base is the registry's current release, read from the packument rather than typed here: the day 0.1.2
 * stops being what consumers install, a hard-coded base would quietly test an upgrade nobody performs.
 */
const packument = step(
  ['view', 'pdfjs-react-reader', '--json'],
  root,
  'the registry did not answer for pdfjs-react-reader',
  { echo: false },
);
const latest = flag('from', JSON.parse(packument)['dist-tags']?.latest);
if (!latest) {
  console.error('FAIL  npm view returned no `dist-tags.latest` — there is no published release to upgrade from');
  process.exit(1);
}
/*
 * `--to` exists for one reason: to prove this check can see a broken upgrade. Run against the packed candidate it
 * is green; run it backwards (`--from=0.11.0 --to=0.1.2`) and the same comparison reports the hundreds of names
 * that vanished, which is the evidence that clause 3 is not decoration. A check nobody has watched fail on purpose
 * is a check whose green means nothing yet.
 */
const targetSpec = flag('to', `file:${tarballPath}`);
const targetVersion = /^\d+\.\d+/.test(targetSpec) ? targetSpec : pkg.version;
console.log(`upgrading from the published release ${latest} to ${targetSpec} (expected ${targetVersion})`);

writeFileSync(
  join(consumer, 'package.json'),
  `${JSON.stringify(
    {
      name: 'upgrade-consumer',
      private: true,
      version: '1.0.0',
      type: 'commonjs',
      dependencies: {
        'pdfjs-react-reader': latest,
        react: '^19.0.0',
        'react-dom': '^19.0.0',
        'pdfjs-dist': '>=6.2.108',
      },
      devDependencies: { typescript: pkg.devDependencies.typescript },
    },
    null,
    2,
  )}\n`,
);

console.log('installing the published release');
step(['install', '--no-audit', '--no-fund', '--ignore-scripts'], consumer, `installed ${latest} with its peers`);
const before = snapshot('before');
if (before.subpaths.length === 0) {
  console.error(
    `FAIL  ${latest} exposed no JS entry point to this script, which is not a fact about the release — it is this\n` +
      '      reader failing to parse an export-map shape. Refusing to go on: with an empty base every name\n' +
      '      comparison below is vacuously true, and a green that compares nothing is the outcome to fear most.',
  );
  process.exit(1);
}
const lockBefore = JSON.parse(readFileSync(join(consumer, 'package-lock.json'), 'utf8'));
const lockedBefore = lockBefore.packages?.['node_modules/pdfjs-react-reader']?.version;

console.log(`applying the move the way a host does: npm install ${targetSpec}`);
step(
  ['install', '--no-audit', '--no-fund', '--ignore-scripts', /^\d/.test(targetSpec) ? `pdfjs-react-reader@${targetSpec}` : targetSpec],
  consumer,
  'the upgrade install failed',
);
const after = snapshot('after');
const lockAfter = JSON.parse(readFileSync(join(consumer, 'package-lock.json'), 'utf8'));
const lockedAfter = lockAfter.packages?.['node_modules/pdfjs-react-reader']?.version;

/* Clause 1: the move actually happened, in the manifest and in the lockfile. */
if (after.version !== targetVersion) {
  FAILS.push(`the installed version after the move is ${after.version}, not the ${targetVersion} the run asked for`);
}
if (lockedBefore !== latest) {
  FAILS.push(`the lockfile recorded ${lockedBefore} before the upgrade while the install asked for ${latest}`);
}
if (lockedAfter !== targetVersion) {
  FAILS.push(`the lockfile still records ${lockedAfter} after the upgrade — the dependency migration did not land`);
}
if (before.version !== latest) {
  FAILS.push(`the base install produced ${before.version} while the registry names ${latest}`);
}

/* Clause 2: the peers a host already chose still satisfy what the candidate declares. */
const optionalPeers = Object.keys(after.manifest.peerDependenciesMeta ?? {});
for (const [peer, range] of Object.entries(after.manifest.peerDependencies ?? {})) {
  const manifestPath = join(consumer, 'node_modules', peer, 'package.json');
  // existsSync on the manifest itself, not a name lookup in node_modules: a scoped peer lives one level deeper,
  // so `readdirSync('node_modules').includes('@cantoo/pdf-lib')` would answer "not installed" about a package
  // that is sitting right there.
  if (!existsSync(manifestPath)) {
    // An optional peer a host never installed is a host that does not use the tier, not a broken upgrade.
    if (optionalPeers.includes(peer)) {
      NOTES.push(`optional peer ${peer} is not installed here — the tier it gates stays unavailable, as declared`);
      continue;
    }
    FAILS.push(`required peer ${peer} is absent after the upgrade, though the candidate declares it ${range}`);
    continue;
  }
  const installed = JSON.parse(readFileSync(manifestPath, 'utf8')).version;
  /*
   * A range matcher narrow enough to be trusted, and loud about what it cannot read.
   *
   * `semver` would be a runtime dependency of a check script, which is its own undeclared-import problem. The
   * shapes this package actually declares are `^x.y.z` and `>=x.y.z`, joined by `||`, and the first version of
   * this code read only the first clause — so `^18.0.0 || ^19.0.0` stranded a perfectly good React 19.3.0 host.
   * That is a false red from the instrument, which is the one thing a check must never produce, so: each
   * `||` alternative is tried, and an unrecognised clause fails the run rather than passing quietly.
   */
  const tuple = (v) => String(v).split('.').map(Number);
  const atLeast = (have, want) => {
    const [hMaj, hMin = 0, hPat = 0] = tuple(have);
    const [wMaj, wMin = 0, wPat = 0] = tuple(want);
    return hMaj > wMaj || (hMaj === wMaj && (hMin > wMin || (hMin === wMin && hPat >= wPat)));
  };
  const satisfies = (range) => {
    const clauses = String(range).split('||').map((c) => c.trim()).filter(Boolean);
    // `some`, not `every`: `^18.0.0 || ^19.0.0` is an alternative, and a host on React 19 satisfies the second
    // arm of it. The first version of this matcher used `every` and anchored its version pattern to the bare
    // form, so both `^…` and `>=…` clauses failed to parse at all — three false "strands the host" findings on a
    // tree where nothing was stranded. A range check that reports a defect the contract does not have is worse
    // than no range check, because the next reader believes it.
    return clauses.some((clause) => {
      const version = /(\d+\.\d+(?:\.\d+)?)/.exec(clause)?.[1];
      if (!version) return false;
      if (clause === `^${version}`) return atLeast(installed, version) && tuple(installed)[0] === tuple(version)[0];
      if (clause === `>=${version}`) return atLeast(installed, version);
      if (clause === version) return installed === version;
      return false;
    });
  };
  const unparsable = String(range)
    .split('||')
    .map((c) => c.trim())
    .filter((clause) => !/^(\^|>=)?\d+\.\d+(?:\.\d+)?$/.test(clause));
  if (unparsable.length) {
    FAILS.push(`peer ${peer} declares a range this check cannot read (${unparsable.join(', ')}) — refusing to guess whether ${installed} satisfies it`);
    continue;
  }
  if (!satisfies(range)) {
    FAILS.push(`the candidate declares peer ${peer} ${range} while the host has ${installed} — the upgrade strands it`);
  } else {
    NOTES.push(`peer ${peer} ${installed} satisfies ${range}`);
  }
}

/* Clause 3: no name a 0.1.x consumer could reach disappears without the ledger having announced it. */
const removedNames = new Set(Object.keys(ledger));
for (const format of ['cjs', 'esm']) {
  for (const [specifier, names] of Object.entries(before[format])) {
    if (names?.error) {
      NOTES.push(`at ${before.version}: ${format} could not resolve ${specifier} (${names.error}) — recorded, not failed, because the base release is not this contract's artifact`);
      continue;
    }
    const now = after[format][specifier];
    if (!now) {
      FAILS.push(`${format}: ${specifier} resolved at ${before.version} and is gone at ${after.version} — a published entry point cannot disappear in a minor`);
      continue;
    }
    if (now.error) {
      FAILS.push(`${format}: ${specifier} threw on resolve after the upgrade (${now.error})`);
      continue;
    }
    const lost = names.filter((n) => !now.includes(n));
    const unannounced = lost.filter((n) => !removedNames.has(n));
    if (unannounced.length) {
      FAILS.push(
        `${format}: ${specifier} lost ${unannounced.length} published name(s) with no entry in api-maturity.json's removed ledger: ${unannounced.join(', ')}`,
      );
    }
    for (const n of lost.filter((x) => removedNames.has(x))) {
      NOTES.push(`${format}: ${specifier}'s ${n} is gone, announced by the ledger (tag ${ledger[n].tag}, removedIn ${ledger[n].removedIn}, supersededBy ${ledger[n].supersededBy})`);
    }
    const gained = now.filter((n) => !names.includes(n));
    if (gained.length) NOTES.push(`${format}: ${specifier} gained ${gained.length} name(s) (${gained.slice(0, 8).join(', ')}${gained.length > 8 ? ', …' : ''})`);
  }
}

/*
 * Clause 4: the declarations still typecheck for the code a 0.1.x host already wrote.
 *
 * ESM only, on purpose. The CommonJS declaration path is FR-41's ground and `check:tarball` already compiles one
 * identical file as `.mts` and `.cts` under `NodeNext`; what no script has ever done is ask whether *the names a
 * 0.1.2 consumer imported* still resolve to declarations. The named imports below are exactly those names, so a
 * type that became `any` or a member that moved off the barrel is an error here rather than a lost signature
 * nobody noticed. One import per name: the first version collected `[specifier, name]` pairs into a Set, which
 * dedupes nothing because each pair is a fresh array, so a name exported by both the root and `/headless` was
 * imported twice and tsc answered `Duplicate identifier` — a red about this generator, not about the package.
 */
const namesForTypes = new Map();
for (const [specifier, names] of Object.entries(before.esm)) {
  if (!Array.isArray(names)) continue;
  for (const n of names) if (!removedNames.has(n) && !namesForTypes.has(n)) namesForTypes.set(n, specifier);
}
const importLines = [...namesForTypes]
  .map(([name, specifier]) => `import { ${name} } from '${specifier}';`)
  .join('\n');
writeFileSync(
  join(consumer, 'host-code.mts'),
  `// Generated by scripts/upgrade-check.mjs — the names a ${before.version} host imported, against the candidate's declarations.\n${importLines}\n`,
);
writeFileSync(
  join(consumer, 'tsconfig.json'),
  `${JSON.stringify(
    {
      compilerOptions: {
        target: 'ES2022',
        module: 'NodeNext',
        moduleResolution: 'NodeNext',
        jsx: 'react-jsx',
        strict: true,
        skipLibCheck: false,
        noEmit: true,
        types: ['react'],
      },
      include: ['host-code.mts'],
    },
    null,
    2,
  )}\n`,
);
const tscOut = step(['--version'], consumer, 'typescript is not installed in the consumer');
const typecheck = spawnSync(process.execPath, [join(consumer, 'node_modules', 'typescript', 'bin', 'tsc'), '-p', 'tsconfig.json'], {
  cwd: consumer,
  encoding: 'utf8',
  maxBuffer: 32 * 1024 * 1024,
});
process.stdout.write(typecheck.stdout ?? '');
if (typecheck.status !== 0) {
  FAILS.push(
    `an existing host's imports no longer typecheck against the candidate (${tscOut.trim()}): ${String(typecheck.stdout ?? '')
      .split('\n')
      .filter((l) => l.includes('error'))
      .slice(0, 3)
      .join(' | ')}`,
  );
}

console.log(`\n${NOTES.map((n) => `  note  ${n}`).join('\n') || '  (no notes)'}`);
writeFileSync(
  join(root, '.spike', 'upgrade-check.json'),
  `${JSON.stringify({ from: before.version, to: after.version, tarball, sha256, lockBefore: lockedBefore, lockAfter: lockedAfter, subpathsBefore: before.subpaths.length, subpathsAfter: after.subpaths.length, fails: FAILS }, null, 2)}\n`,
);
if (FAILS.length) {
  console.error(`\nFAIL  the upgrade from ${before.version} to ${after.version} is not clean:`);
  for (const f of FAILS) console.error(`  - ${f}`);
  process.exit(1);
}
console.log(
  `\nFR-58's upgrade path exercised: ${before.version} → ${after.version}, lockfile migrated (${lockedBefore} → ${lockedAfter}), ` +
    `${before.subpaths.length} published entry(ies) before and ${after.subpaths.length} after, and every name a ${before.version} host could reach ` +
    'still resolves or is announced withdrawn by the maturity ledger.',
);
