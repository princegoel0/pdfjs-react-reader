/**
 * FR-52 / PRD §5.6: every example that documents a shipped surface compiles against the packed artifact.
 *
 * Nothing else in this repository resolves `pdfjs-react-reader` the way a host does. `tsconfig.json` maps the
 * specifier onto `src/` with `paths`, the playground aliases it, the docs build renders `../src` — so an
 * example that only works from source passes every check except this one, and that is exactly the defect
 * class §5.6 names ("an example that resolves only from source is exactly the defect rule #4 exists to
 * catch"; `0.1.0` shipped a worker URL no bundler could rewrite, which is the same shape of mistake).
 *
 * So: `npm pack`, extract the tarball into a throwaway project's `node_modules`, and type-check with **no
 * `paths` mapping at all**. Two things come free from that construction, which is why there is no separate
 * assertion for them: a name that is not exported cannot resolve, and a subpath the export map does not
 * publish cannot resolve either — Node's `exports` matching rejects it before TypeScript sees a file.
 *
 * What is extracted:
 *  - every fenced `tsx`/`ts` block in `PRD.md`, `README.md` and any markdown under `docs/`;
 *  - the docs site's live example components (`docs/src/examples/*.tsx`), copied with the two files they
 *    import, because those are what a reader actually takes off the page and they are the only place the
 *    `/features/*` and `/locales/*` subpaths appear as consumer code.
 *
 * What is skipped, and said out loud: a block whose prose carries the literal marker **Target API shape**
 * (§5.3 today, waiting on FR-28), and nothing else. There is deliberately no second exemption: an example
 * that documents a shipped surface is a module a host could paste, so a block that is only one line of JSX
 * is fixed — imports and a component around it — rather than marked. The six that needed that treatment
 * were found by the first run of this script, not by reading, and one of them was a real documentation
 * defect: it imported `PdfPage` from `/headless`, which exports no components.
 *
 * The React-major half of §5.6 is reported rather than assumed: the pass runs against whichever
 * `@types/react` this project resolves, and a second major that is not installed prints as a skip naming
 * the CI `react` job that has both. A check that quietly compiled one React version while the document
 * promised two would be worse than the eye it replaces.
 *
 * `npm run check:examples`. Needs `npm run build` first — it checks `dist/`, so a missing build is an error
 * rather than a silently old one.
 */
import { spawnSync } from 'node:child_process';
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gunzipSync } from 'node:zlib';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const work = join(root, '.spike', 'examples');
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));

const FAIL = [];
const SKIPS = [];
const COMPILED = [];

/**
 * Read the ustar archive `npm pack` wrote, without a shell `tar`.
 *
 * Two reasons not to shell out: the check has to run identically on Windows and the CI images, and on this
 * host the `tar` a spawned shell finds is GNU tar, which reads `C:/path/x.tgz` as "copy from host C:" and
 * fails. npm's own packer emits plain ustar, so the format is: 512-byte header, `name` at 0, octal `size`
 * at 124, `typeflag` at 156, and file bytes in the blocks after it. The two header kinds that change a
 * name — a PAX `path=` record and a GNU long-link block — are handled, because a declaration path long
 * enough to need one is exactly the case a naive reader would silently drop.
 */
function extractTarball(file, into) {
  const bytes = gunzipSync(readFileSync(file));
  const written = [];
  let offset = 0;
  let pendingName = null;
  while (offset + 512 <= bytes.length) {
    const header = bytes.subarray(offset, offset + 512);
    offset += 512;
    if (header.every((byte) => byte === 0)) break;
    const cstring = (at, len) => {
      const end = header.indexOf(0, at);
      return header.subarray(at, end === -1 ? at + len : end).toString('utf8');
    };
    const size = parseInt(cstring(124, 12).trim() || '0', 8);
    const blocks = Math.ceil(size / 512);
    const payload = () => {
      const out = bytes.subarray(offset, offset + size);
      offset += blocks * 512;
      return out;
    };
    const typeflag = String.fromCharCode(header[156] || 0x30);
    if (typeflag === 'x' || typeflag === 'g') {
      // A PAX extended header: the record that matters is `N path=...`, whose length prefix is the byte
      // count of the whole record, so it cannot be split on `=` alone and trusted.
      const text = payload().toString('utf8');
      const match = /\d+ path=([^\n]+)\n/.exec(text);
      if (match) pendingName = match[1];
      continue;
    }
    if (typeflag === 'L') {
      pendingName = payload().toString('utf8').replace(/\0+$/, '');
      continue;
    }
    const raw = pendingName ?? cstring(0, 100);
    pendingName = null;
    if (typeflag !== '0' && typeflag !== '\0' && typeflag !== '7') {
      if (size) payload();
      continue;
    }
    // npm always packs under a `package/` root; the throwaway project wants its contents at
    // `node_modules/pdfjs-react-reader`, which is what a host's install would produce.
    const relativePath = raw.replace(/^package\//, '');
    if (!relativePath || relativePath.includes('..')) continue;
    const target = join(into, relativePath);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, payload());
    written.push(relativePath);
  }
  return written;
}

const step = (command, args, cwd, label) => {
  // Through a shell, for one reason: `npm` is a `.cmd` shim on Windows and Node refuses to spawn one
  // directly. Every argument here is a fixed string or a path this script wrote itself.
  const result = spawnSync([command, ...args].join(' '), {
    cwd,
    encoding: 'utf8',
    shell: true,
    maxBuffer: 32 * 1024 * 1024,
  });
  if (result.status === 0) return result.stdout ?? '';
  FAIL.push(`${label}\n${(result.stdout ?? '') + (result.stderr ?? '')}`.trim());
  return null;
};

/** The nearest `###`/`##` heading above a line, so a skip can name what it is waiting on. */
const headingAbove = (lines, index) => {
  for (let i = index - 1; i >= 0; i -= 1) {
    if (/^#{2,4} /.test(lines[i])) return lines[i].replace(/^#+\s*/, '').trim();
  }
  return '(no heading above it)';
};

/**
 * The prose between a block's fence and the heading above it. §5.3 states its exemption there — "**Target
 * API shape.** This block is the contract for FR-28's composed parts" — so the requirement a skip waits on
 * is read from where a reader would read it, rather than duplicated into a side file that can drift.
 */
const proseAbove = (lines, index) => {
  const out = [];
  for (let i = index - 1; i >= 0; i -= 1) {
    if (/^#{2,4} /.test(lines[i]) || /^```/.test(lines[i])) break;
    out.unshift(lines[i]);
  }
  return out.join('\n');
};

/** The requirement id a marked block is waiting on, from the prose that marks it. */
const awaitedRequirement = (prose) => {
  const match = /\b(FR-\d{2})\b/.exec(prose);
  return match?.[1] ?? null;
};

/**
 * Every fenced `tsx`/`ts` block in a markdown file, with the line it opened on and the language token that
 * followed it (` ```tsx fragment ` is a marked block; ` ```tsx ` is not).
 */
function blocksIn(file) {
  const text = readFileSync(join(root, file), 'utf8');
  const lines = text.split(/\r?\n/);
  const found = [];
  for (let i = 0; i < lines.length; i += 1) {
    const open = /^```(tsx|ts)(\s+[a-z-]+)?\s*$/.exec(lines[i]);
    if (!open) continue;
    const body = [];
    let j = i + 1;
    while (j < lines.length && !/^```\s*$/.test(lines[j])) {
      body.push(lines[j]);
      j += 1;
    }
    found.push({
      file,
      line: i + 1,
      lang: open[1],
      tag: open[2]?.trim() ?? '',
      heading: headingAbove(lines, i),
      prose: proseAbove(lines, i),
      code: body.join('\n'),
    });
  }
  return found;
}

const markdownFiles = [];
for (const candidate of ['PRD.md', 'README.md']) {
  if (existsSync(join(root, candidate))) markdownFiles.push(candidate);
}
const docsDir = join(root, 'docs');
if (existsSync(docsDir)) {
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) walk(path);
      else if(/\.md$/.test(entry.name)) markdownFiles.push(relative(root, path).replace(/\\/g, '/'));
    }
  };
  walk(docsDir);
}

const blocks = markdownFiles.flatMap(blocksIn);

/*
 * The docs site's live components. `Example.tsx` and `fixtures.ts` come with them because the examples
 * import both, and a copy that fails for a missing sibling would report a defect the reader cannot see.
 */
const docsFiles = [];
const examplesDir = join(docsDir, 'src', 'examples');
if (existsSync(examplesDir)) {
  for (const name of readdirSync(examplesDir).filter((file) => file.endsWith('.tsx'))) {
    docsFiles.push(join('docs', 'src', 'examples', name));
  }
  for (const name of [join('docs', 'src', 'components', 'Example.tsx'), join('docs', 'src', 'fixtures.ts')]) {
    if (existsSync(join(root, name))) docsFiles.push(name);
  }
}

if (!existsSync(join(root, 'dist', 'index.js'))) {
  console.error('FAIL  dist/ has no build to check against — run `npm run build` first');
  process.exit(1);
}

rmSync(work, { recursive: true, force: true });
mkdirSync(join(work, 'pack'), { recursive: true });
mkdirSync(join(work, 'node_modules'), { recursive: true });

console.log(`examples: ${blocks.length} fenced blocks in ${markdownFiles.join(', ')}; ${docsFiles.length} docs components`);

console.log('packing');
if (step('npm', ['pack', '--pack-destination', join(work, 'pack')], root, 'npm pack failed')) {
  const tarball = readdirSync(join(work, 'pack')).find((file) => file.endsWith('.tgz'));
  if (!tarball) FAIL.push('npm pack produced no tarball');
  else {
    const into = join(work, 'node_modules', 'pdfjs-react-reader');
    const files = extractTarball(join(work, 'pack', tarball), into);
    console.log(`extracted ${tarball}: ${files.length} files, ${files.filter((f) => f.endsWith('.d.ts')).length} of them .d.ts`);
    if (!files.some((f) => f === 'dist/index.d.ts')) {
      FAIL.push(`the packed artifact has no dist/index.d.ts — a host could import the root and get no types`);
    }
  }
}

if (FAIL.length) {
  for (const failure of FAIL) console.error(`FAIL  ${failure}`);
  process.exit(1);
}

/*
 * One project, two file sets: markdown blocks at the root, docs components under their own directory so
 * their relative imports keep working. No `paths` anywhere — that omission *is* the check.
 */
const tsconfig = {
  compilerOptions: {
    target: 'ES2022',
    lib: ['ES2022', 'DOM', 'DOM.Iterable'],
    module: 'ESNext',
    moduleResolution: 'bundler',
    jsx: 'react-jsx',
    strict: true,
    noUncheckedIndexedAccess: true,
    noEmit: true,
    skipLibCheck: true,
    esModuleInterop: true,
    allowImportingTsExtensions: false,
    types: ['node', 'vite/client'],
  },
  include: ['shims.d.ts', 'blocks', 'docs/src'],
};

mkdirSync(join(work, 'blocks'), { recursive: true });
mkdirSync(join(work, 'docs', 'src', 'examples'), { recursive: true });
mkdirSync(join(work, 'docs', 'src', 'components'), { recursive: true });

writeFileSync(
  join(work, 'shims.d.ts'),
  `// Generated by scripts/check-examples.mjs — the ambient modules a bundler supplies, declared here so the
// examples compile for the same reasons they compile in a host's app and not for reasons of our own config.
declare module '*.css';
declare module '*.module.css' { const classes: Record<string, string>; export default classes; }
`,
);

let written = 0;
blocks.forEach((block, index) => {
  if (/Target API shape/.test(block.prose)) {
    SKIPS.push({
      where: `${block.file}:${block.line}`,
      what: block.heading,
      why: `marked **Target API shape**, waiting on ${awaitedRequirement(block.prose) ?? 'an unnamed requirement'}`,
    });
    return;
  }
  const name = `block-${String(index).padStart(2, '0')}-${block.file.replace(/[^\w]/g, '-')}.${block.lang === 'ts' ? 'ts' : 'tsx'}`;
  writeFileSync(
    join(work, 'blocks', name),
    `// From ${block.file}:${block.line} — [${block.heading}]\n${block.code}\n`,
  );
  COMPILED.push(`${block.file}:${block.line} [${block.heading}]`);
  written += 1;
});

for (const file of docsFiles) {
  const dest = join(work, file);
  mkdirSync(dirname(dest), { recursive: true });
  copyFileSync(join(root, file), dest);
  if (file.includes('/examples/')) COMPILED.push(file);
}

writeFileSync(join(work, 'tsconfig.json'), `${JSON.stringify(tsconfig, null, 2)}\n`);

const reactTypes = JSON.parse(
  readFileSync(join(root, 'node_modules', '@types', 'react', 'package.json'), 'utf8'),
).version;
const majors = [pkg.peerDependencies.react, reactTypes];
console.log(`\ntype-checking against dist/ extracted from the tarball, with react types ${reactTypes}`);
console.log(`  peer range advertised: ${majors[0]}`);

const output = (() => {
  // Not through `step`: tsc's exit code means "the examples did not type-check", which is this check's own
  // finding, and its output is the report a reader needs — file, line, and the document the block came from.
  const result = spawnSync(
    'node ' +
      [join('..', '..', 'node_modules', 'typescript', 'bin', 'tsc'), '-p', 'tsconfig.json'].join(' '),
    { cwd: work, encoding: 'utf8', shell: true, maxBuffer: 32 * 1024 * 1024 },
  );
  return (result.stdout ?? '') + (result.stderr ?? '');
})();

/** `block-07-README-md.tsx` → the document and heading it was cut from, so a failure names its source. */
const labelOf = (generated) => {
  const index = Number(/^block-(\d+)/.exec(generated)?.[1]);
  const block = blocks[index];
  return block ? `${block.file}:${block.line} [${block.heading}]` : generated;
};

const seen = new Set();
for (const line of output.split(/\r?\n/)) {
  const match = /^([\w./@-]+)\((\d+),\d+\):\s*error\b/.exec(line.replace(/\\/g, '/'));
  if (!match) continue;
  const path = match[1];
  const origin = path.startsWith('blocks/') ? labelOf(path.slice('blocks/'.length)) : path;
  if (!seen.has(origin)) {
    seen.add(origin);
    FAIL.push(`${origin}\n         ${line.trim()}`);
  } else {
    FAIL[seen.size - 1] += `\n         ${line.trim()}`;
  }
}
if (output.trim() !== '' && seen.size === 0) FAIL.push(`tsc reported no per-file errors:\n${output.trim()}`);

const reactMajor = Number(String(reactTypes).split('.')[0]);
const advertised = /18/.test(pkg.peerDependencies.react) ? [18, 19] : [reactMajor];
const missing = advertised.filter((major) => major !== reactMajor);
for (const major of missing) {
  SKIPS.push({
    where: 'every block',
    what: `React ${major} type contract`,
    why: `only @types/react ${reactTypes} is installed here; §5.6's second major is compiled by the CI \`react\` job`,
  });
}

console.log(`\ncompile set: ${COMPILED.length} examples against the packed artifact`);
for (const line of COMPILED) console.log(`  ${seen.has(line) ? 'FAIL' : '  ok'}  ${line}`);
if (SKIPS.length) {
  console.log(`\nskipped: ${SKIPS.length}`);
  for (const skip of SKIPS) {
    console.log(`  skip  ${skip.where} — ${skip.what}: ${skip.why}`);
  }
}
if (FAIL.length) {
  console.log(`\n${FAIL.length} example(s) did not compile:`);
  for (const failure of FAIL) console.error(`  FAIL  ${failure}`);
  console.error('\nAn example that does not compile against the packed artifact is a documented surface that');
  console.error('does not exist, or a declaration file that is incomplete. Either way the reader hits it, not us.');
  process.exit(1);
}

console.log(
  `\n§5.6 satisfied: ${COMPILED.length} examples compiled against the packed artifact, ${SKIPS.length} skipped and named above.`,
);
