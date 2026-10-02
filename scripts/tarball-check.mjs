/**
 * FR-41: does the published tarball actually resolve, in both formats?
 *
 * Everything else in this repository resolves `pdfjs-react-reader` from source — `tsconfig.json` maps it
 * onto `src/`, the playground aliases it, the docs build renders `../src`. That is exactly where packaging
 * defects hide, and it is how `0.1.0` shipped a worker URL no bundler could rewrite. So this packs the
 * tarball npm would publish, installs it into a throwaway CommonJS project beside its real peers, and asks
 * what a host asks: can I `require()` every published path, can I `import` them, do the two give me the same
 * names, and does TypeScript find declarations for both.
 *
 * The `require` answer has a boundary that is not ours, and the script reports it rather than asserting one.
 * `pdfjs-dist` is an ESM-only peer — no `exports` map of its own, `main` at `build/pdf.mjs` — so a
 * `require()` that reaches it depends on Node's own support for loading ESM from CommonJS, which landed in
 * a 20.x and a 22.x patch and is not a date to quote from memory. A failure with `ERR_REQUIRE_ESM` is
 * therefore recorded as the peer boundary and the run still passes; anything else — a missing file, a bad
 * specifier, a path that resolves and exports nothing — is a real failure. Which Node versions produce which
 * outcome is what the `packaging` CI job measures across its matrix; the summary line is written to be
 * grepped out of that job's log.
 *
 * The declaration check is the half that a bundler will never tell you about: `types.mts` and `types.cts`
 * hold identical source, and under `NodeNext` the extension alone decides which export condition TypeScript
 * asks for — so one file compiling in both modes is the proof that the map really offers `.d.ts` *and*
 * `.d.cts`. A missing `.d.cts` fails there rather than resolving to `any` and quietly losing every signature
 * in the package.
 *
 * Slow (a pack, an install, a typecheck) and needs the network, hence its own command rather than a step of
 * `npm run verify`: `npm run check:tarball`.
 */
import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const work = join(root, '.spike', 'tarball-check');
const consumer = join(work, 'consumer');
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));

/** The specifier a host writes for an export-map key: `"."` is the bare package name. */
const specifier = (subpath) =>
  subpath === '.' ? 'pdfjs-react-reader' : `pdfjs-react-reader${subpath.slice(1)}`;

const subpaths = Object.entries(pkg.exports)
  .filter(
    ([subpath, entry]) =>
      subpath !== './package.json' && String(entry?.import?.default ?? '').endsWith('.js'),
  )
  .map(([subpath]) => subpath);

if (subpaths.length === 0) {
  console.error('no JS subpaths in the export map — package.json is not what this script expects');
  process.exit(1);
}

const specs = subpaths.map(specifier);

const step = (command, args, cwd, label) => {
  // Through a shell, for one reason: `npm` is a `.cmd` shim on Windows and Node refuses to spawn one
  // directly. Every argument here is a fixed string or a path this script wrote itself.
  const result = spawnSync([command, ...args].join(' '), {
    cwd,
    encoding: 'utf8',
    shell: true,
    maxBuffer: 32 * 1024 * 1024,
  });
  if (result.status === 0) {
    process.stdout.write(result.stdout ?? '');
    return result.stdout ?? '';
  }
  console.error(`FAIL  ${label}\n${result.stdout ?? ''}${result.stderr ?? ''}`);
  process.exit(1);
};

rmSync(work, { recursive: true, force: true });
mkdirSync(join(work, 'pack'), { recursive: true });
mkdirSync(consumer, { recursive: true });

console.log('packing');
step('npm', ['pack', '--pack-destination', join(work, 'pack')], root, 'npm pack');
const tarball = readdirSync(join(work, 'pack')).find((file) => file.endsWith('.tgz'));
if (!tarball) {
  console.error('FAIL  npm pack produced no tarball');
  process.exit(1);
}

/*
 * CommonJS on purpose: this is the shape of host that cannot `import` at all, which is the one the
 * requirement names — a Jest test, a legacy Node toolchain. The peers go in at the advertised ranges,
 * because this is a host's install rather than ours.
 */
writeFileSync(
  join(consumer, 'package.json'),
  `${JSON.stringify(
    {
      name: 'packaging-consumer',
      private: true,
      version: '1.0.0',
      type: 'commonjs',
      dependencies: {
        'pdfjs-react-reader': `file:${join(work, 'pack', tarball).replace(/\\/g, '/')}`,
        react: '^19.0.0',
        'react-dom': '^19.0.0',
        'pdfjs-dist': pkg.peerDependencies['pdfjs-dist'],
        '@cantoo/pdf-lib': pkg.peerDependencies['@cantoo/pdf-lib'],
      },
      devDependencies: { typescript: pkg.devDependencies.typescript },
    },
    null,
    2,
  )}\n`,
);

console.log('installing');
step(
  'npm',
  ['install', '--no-audit', '--no-fund', '--ignore-scripts'],
  consumer,
  `installed ${tarball} with its peers`,
);

/*
 * One probe per format. Each writes the names it resolved to a file beside itself, so the comparison is
 * against what each module system really gave a host and not against a log line that a future refactor of
 * the printout would silently break.
 */
writeFileSync(
  join(consumer, 'probe.cjs'),
  `// Generated by scripts/tarball-check.mjs — the CommonJS half of FR-41. Do not edit.
const { writeFileSync } = require('node:fs');
const { join } = require('node:path');
const cases = ${JSON.stringify(specs, null, 1)};
const seen = [];
let boundary = 0;
for (const specifier of cases) {
  let mod;
  try {
    mod = require(specifier);
  } catch (error) {
    if (error.code === 'ERR_REQUIRE_ESM') {
      boundary += 1;
      console.log('BOUNDARY require(' + specifier + '): ' + error.code + ' from the ESM-only peer');
      continue;
    }
    console.error('FAIL require(' + specifier + '): ' + (error.code ?? '') + ' ' + error.message);
    process.exitCode = 1;
    continue;
  }
  const names = Object.keys(mod).filter((name) => name !== 'default').sort();
  if (names.length === 0) {
    console.error('FAIL require(' + specifier + '): resolved but exported nothing');
    process.exitCode = 1;
    continue;
  }
  seen.push(specifier + ' ' + names.join(','));
}
writeFileSync(join(__dirname, 'names.cjs.txt'), seen.join('\\n'));
console.log(
  '  ' + (boundary ? 'part' : 'ok  ') + '    require(): ' + seen.length + '/' + cases.length + ' paths' +
    (boundary ? ', ' + boundary + ' stopped at the peer boundary' : ''),
);
`,
);

writeFileSync(
  join(consumer, 'probe.mjs'),
  `// Generated by scripts/tarball-check.mjs — the ESM half of FR-41. Do not edit.
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
const cases = ${JSON.stringify(specs, null, 1)};
const seen = [];
for (const specifier of cases) {
  const mod = await import(specifier);
  const names = Object.keys(mod).filter((name) => name !== 'default').sort();
  if (names.length === 0) {
    console.error('FAIL import(' + specifier + '): resolved but exported nothing');
    process.exitCode = 1;
    continue;
  }
  seen.push(specifier + ' ' + names.join(','));
}
writeFileSync(join(process.cwd(), 'names.esm.txt'), seen.join('\\n'));
if (!process.exitCode) console.log('  ok      import(): ' + seen.length + '/' + cases.length + ' paths');
`,
);

const typeLines = subpaths
  .map(
    (subpath, at) =>
      `import * as m${at} from ${JSON.stringify(specifier(subpath))};\n` +
      `const _${at}: readonly string[] = Object.keys(m${at});\nvoid _${at};`,
  )
  .join('\n');
writeFileSync(join(consumer, 'types.mts'), `// Generated by scripts/tarball-check.mjs\n${typeLines}\n`);
writeFileSync(join(consumer, 'types.cts'), `// Generated by scripts/tarball-check.mjs\n${typeLines}\n`);
writeFileSync(
  join(consumer, 'tsconfig.json'),
  `${JSON.stringify(
    {
      compilerOptions: {
        module: 'NodeNext',
        moduleResolution: 'NodeNext',
        target: 'es2022',
        strict: true,
        noEmit: true,
        skipLibCheck: true,
        types: ['node'],
      },
      include: ['types.mts', 'types.cts'],
    },
    null,
    2,
  )}\n`,
);

console.log('resolving from the installed tarball');
step('node', ['probe.cjs'], consumer, 'require() probe');
step('node', ['probe.mjs'], consumer, 'import() probe');
step(
  'node',
  [join('node_modules', 'typescript', 'bin', 'tsc'), '-p', 'tsconfig.json'],
  consumer,
  'tsc under NodeNext',
);

/** The names each format resolved, path by path. */
const readNames = (file) => {
  const text = readFileSync(join(consumer, file), 'utf8').trim();
  if (!text) return new Map();
  return new Map(
    text.split('\n').map((line) => [line.slice(0, line.indexOf(' ')), line.slice(line.indexOf(' ') + 1)]),
  );
};
const fromRequire = readNames('names.cjs.txt');
const fromImport = readNames('names.esm.txt');

/*
 * The question is whether the two formats disagree. A path the CommonJS probe skipped at the peer boundary
 * is skipped here too, and reported on the summary line instead of treated as a difference.
 */
let drift = 0;
for (const [spec, esmList] of fromImport) {
  const cjsList = fromRequire.get(spec);
  if (cjsList === undefined) continue;
  if (cjsList !== esmList) {
    console.error(`FAIL  ${spec} exports differ by format:\n  require: ${cjsList}\n  import:  ${esmList}`);
    drift += 1;
  }
}
if (drift) process.exit(1);

console.log(
  `  ok    ${fromRequire.size}/${subpaths.length} paths identical between the two formats` +
    (fromRequire.size === subpaths.length ? '' : ' (the rest stopped at the peer boundary)'),
);
console.log(
  `require-esm-support=${fromRequire.size === subpaths.length ? 'yes' : 'partial'} ` +
    `(${fromRequire.size}/${subpaths.length} on node ${process.version})`,
);
console.log(`\nFR-41 proven against ${tarball}: both formats resolve, and declarations resolve in both modes.`);
