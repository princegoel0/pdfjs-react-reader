/*
 * `CODE_REFERENCE.md` and `PRD.md` §8 state counts that are facts about the files in this repository — how many
 * source files there are, how many entry points a consumer can import, how many names carry a maturity tag, how
 * many checks the browser matrix runs. Every one of them has been wrong at least once, and the drift is not
 * careless editing but the shape of the problem: #203 re-ran the commands behind §2's table and *every* number
 * had fallen behind (234/187/32/9 against the inventory's 239/197/36/13, "144 strings" against the 136 the
 * catalog test asserts), and §8's browser-check count has gone twelve → thirteen → fourteen as rows landed,
 * each time corrected by whoever happened to remember. #213 is the standing fix: those figures stop being
 * quoted and start being derived. `ROADMAP.md` gets the opposite fix, in `PROHIBITED` below — the one class of
 * figure here that no checkout can re-derive may not be written there at all.
 *
 * The rule is deliberately narrow. It checks only what can be re-derived from files already in a checkout — no
 * `dist/`, no bundler, no test run, no browser — because a documentation gate that needs a build cannot run
 * where no build has happened, and the failure mode it exists to prevent is silence. Each rule holds two
 * things: a pattern that must find the figure in the document, and the value computed from the tree. A pattern
 * that stops matching is itself a failure, reported as one — a sentence reworded out of the gate's reach is
 * how a claim becomes unfalsifiable, which is the same class as a guard that asserts less than its clause.
 *
 * What it does not check, and why: the test *total* (that is `npm run test`'s answer; re-running the suite
 * inside a doc gate would double `verify` for a number the suite already prints), the PRD's code blocks
 * (`check:examples` compiles them), and any dated measurement — a CI tally or a benchmark median records one
 * run, not a property of the tree, so nothing here can re-derive it. What *is* enforced, under
 * `PROHIBITED` below, is that `ROADMAP.md` keeps no such tally: a number a rule cannot re-derive is a number
 * that goes stale silently, and this file has been caught stale twice (#240).
 *
 * **Size figures used to be on the not-checked list** on the grounds that `check-size` owns them. It does measure
 * them, and the docs still retyped the answer, which is how `annotate` read 1.86 kB in a page against 2.05
 * measured and how a whole footprint table kept a `core` from nine releases ago (#240). Now `npm run size` writes
 * `docs/src/size-figures.json` and the docs pages render that file, so the rule below can hold the two together
 * without a bundler: every feature the export map publishes must be in the figures, every key a page indexes must
 * exist, and no size cell may be typed by hand again. `README.md` is markdown and cannot import anything, so its
 * two size tables are held to the same file by row — and a row this script can no longer find is itself a failure,
 * because a table reworded out of the gate is a table that stopped being checked.
 *
 * `--selftest` perturbs each documented figure in memory and requires the perturbation to be caught, so the
 * gate cannot pass by matching nothing. It writes nothing to disk.
 *
 *   node scripts/check-docs.mjs            # the gate
 *   node scripts/check-docs.mjs --selftest # proof the gate bites, per rule
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const repo = process.cwd();
const read = (path) => readFileSync(join(repo, path), 'utf8');
const digits = (s) => Number(String(s).replace(/,/g, ''));
const commas = (n) => n.toLocaleString('en-US');

// ---------------------------------------------------------------------------
// The tree side.
// ---------------------------------------------------------------------------

function walk(dir, match, found = []) {
  for (const entry of readdirSync(join(repo, dir), { withFileTypes: true })) {
    const path = `${dir}/${entry.name}`;
    if (entry.isDirectory()) walk(path, match, found);
    else if (match(entry.name)) found.push(path);
  }
  return found.sort();
}

/** `wc -l` semantics: newlines, not lines-that-look-like-lines. */
const lineCount = (text) => text.split('\n').length - 1;
const totalLines = (files) => files.reduce((sum, path) => sum + lineCount(read(path)), 0);

const pkg = JSON.parse(read('package.json'));
const exportKeys = Object.keys(pkg.exports);
const isCss = (k) => k.endsWith('.css');
const isLocale = (k) => k.startsWith('./locales/');
const jsEntries = exportKeys.filter((k) => !isCss(k) && !isLocale(k) && k !== './package.json');

const sourceFiles = walk('src', (n) => /\.(ts|tsx)$/.test(n) && !/\.test\.(ts|tsx)$/.test(n));
const testFiles = walk('src', (n) => /\.test\.(ts|tsx)$/.test(n));
const stylesheets = walk('src/styles', (n) => n.endsWith('.css'));
const sheetLines = stylesheets.map((p) => lineCount(read(p))).sort((a, b) => a - b);
const fixtures = walk('playground/fixtures', (n) => n.endsWith('.pdf'));
const generators = walk('scripts', (n) => /^make-.+\.mjs$/.test(n));
const trackedFixtures = execFileSync('git', ['ls-files', 'playground/fixtures'], {
  cwd: repo,
  encoding: 'utf8',
})
  .split('\n')
  .filter((l) => l.endsWith('.pdf')).length;

const ciJobs = (() => {
  const ci = read('.github/workflows/ci.yml');
  const at = ci.indexOf('\njobs:\n');
  if (at < 0) throw new Error('.github/workflows/ci.yml has no `jobs:` mapping to count');
  return [...ci.slice(at).matchAll(/^ {2}([a-z][\w-]*):\s*$/gm)].map((m) => m[1]);
})();

/**
 * The engine axis the peer jobs swap in (#194), read off the workflow rather than repeated in prose.
 *
 * `consumer` builds the packed artifact against the advertised floor and the latest supported 6.x, and the
 * `browser` job now paints against the same pair. Two lists in one file, kept honest by this: the day they
 * disagree, one job is certifying a range the other never ran, and both greens read like the contract was
 * measured. The floor is not typed here either — it is `package.json`'s own peer range, so a floor that moves
 * in the contract and not in CI is a failure rather than a coincidence.
 */
const engineAxis = (ciText) => ({
  axes: [...ciText.matchAll(/^ {8}engine: \[([^\]]*)\]/gm)].map((m) =>
    m[1]
      .split(',')
      .map((s) => s.trim().replace(/^['"]|['"]$/g, ''))
      .filter(Boolean),
  ),
  bench: [...ciText.matchAll(/if: matrix\.engine == '([^']+)'/g)].map((m) => m[1]),
});

function checkEngineAxis(ciText) {
  const { axes, bench } = engineAxis(ciText);
  const problems = [];
  if (axes.length < 2) {
    problems.push(
      `the engine axis is named by ${axes.length} job(s), not the two the contract is measured across — a job ` +
        'that stops declaring it silently stops measuring that engine (#194)',
    );
    return problems;
  }
  const floor = String((pkg.peerDependencies || {})['pdfjs-dist'] || '').replace(/^[\^~]/, '');
  axes.forEach((axis, i) => {
    if (!axis.includes(floor)) {
      problems.push(`engine axis ${i + 1} [${axis.join(', ')}] does not contain the advertised floor ${floor}`);
    }
    if (axis.length !== 2) {
      problems.push(
        `engine axis ${i + 1} [${axis.join(', ')}] is not a pair: §8 asks for the published floor and the latest ` +
          'supported 6.x, so a third value is a contract change and one value is a missing cell',
      );
    }
  });
  axes.slice(1).forEach((axis, i) => {
    if (axis.join(' ') !== axes[0].join(' ')) {
      problems.push(
        `the engine axes disagree: axis 1 is [${axes[0].join(', ')}] and axis ${i + 2} is [${axis.join(', ')}] — ` +
          'one of those jobs is certifying a range the other never ran (#194)',
      );
    }
  });
  if (!bench.length) {
    problems.push(
      'no step is gated on an engine version, so the benchmark runs in every cell and §6 gets two readings of ' +
        'one machine per push',
    );
  }
  bench.forEach((want) => {
    if (!axes[0].includes(want)) {
      problems.push(`the benchmark step runs only on engine '${want}', which no cell of the matrix names`);
    }
  });
  return problems;
}

/**
 * The lockfile's root entry is a *copy* of `package.json`, and a copy is the kind of thing that goes stale:
 * `engines.node` sat at `>=20` in the lock for weeks after the Node floor moved to 22.13.0, and nothing noticed,
 * because `npm ci` installs from the lock rather than reconciling it against the manifest. The floor is an
 * FR-41/FR-48 claim that hosts read, so the comparison belongs to something that runs.
 */
function checkLockMirror(lockText = read('package-lock.json')) {
  const lock = JSON.parse(lockText);
  const root = lock.packages?.[''];
  if (!root) return ['package-lock.json has no root ("") entry to compare with package.json'];
  const problems = [];
  for (const field of ['engines', 'peerDependencies']) {
    const wanted = pkg[field] ?? {};
    const mirrored = root[field] ?? {};
    for (const [key, value] of Object.entries(wanted)) {
      if (JSON.stringify(mirrored[key]) !== JSON.stringify(value)) {
        problems.push(
          `package-lock.json's root ${field}.${key} is ${JSON.stringify(mirrored[key])} — ` +
            '`package.json` says ' + JSON.stringify(value) + ' (run `npm install` so the lock mirrors the manifest)',
        );
      }
    }
    for (const key of Object.keys(mirrored)) {
      if (!(key in wanted)) problems.push(`package-lock.json's root ${field}.${key} has no counterpart in package.json`);
    }
  }
  if (root.version !== pkg.version) {
    problems.push(`package-lock.json's root version is ${root.version}, package.json says ${pkg.version}`);
  }
  return problems;
}

const maturity = JSON.parse(read('api-maturity.json'));
const tagValues = Object.values(maturity.tags);
const byState = (state) => tagValues.filter((t) => (typeof t === 'string' ? t : t.state) === state).length;

/** The matrix's check count, read out of the array the harness actually iterates. */
const checkCount = (() => {
  const src = read('scripts/browser-matrix.mjs');
  const start = src.indexOf('const CHECKS = [');
  const end = start < 0 ? -1 : src.indexOf('\n];', start);
  if (end < 0) throw new Error('scripts/browser-matrix.mjs: no `const CHECKS = [ … ];` to count');
  return [...src.slice(start, end).matchAll(/^ {4}name: '/gm)].length;
})();

const WORD = [
  '',
  'One',
  'Two',
  'Three',
  'Four',
  'Five',
  'Six',
  'Seven',
  'Eight',
  'Nine',
  'Ten',
  'Eleven',
  'Twelve',
  'Thirteen',
  'Fourteen',
  'Fifteen',
  'Sixteen',
  'Seventeen',
  'Eighteen',
  'Nineteen',
  'Twenty',
  'Twenty-One',
];

// ---------------------------------------------------------------------------
// The document side: one rule per figure, `groups` long.
// ---------------------------------------------------------------------------

const RULES = [
  {
    id: 'subpaths',
    what: 'CODE_REFERENCE §2 "Importable subpaths"',
    file: 'CODE_REFERENCE.md',
    pattern: /\| Importable subpaths \| \*\*(\d+)\*\* \((\d+) JS entries \+ (\d+) languages \+ (\d+) stylesheets/,
    expect: () => [
      exportKeys.length,
      jsEntries.length,
      exportKeys.filter(isLocale).length,
      exportKeys.filter(isCss).length,
    ],
  },
  {
    id: 'maturity',
    what: 'CODE_REFERENCE §2 "Distinct public names, by maturity"',
    file: 'CODE_REFERENCE.md',
    pattern:
      /\| Distinct public names, by maturity \| \*\*(\d+)\*\* — (\d+) stable, (\d+) experimental, (\d+) deprecated, plus \*\*(\d+)\*\* in the `removed` ledger/,
    expect: () => [
      tagValues.length,
      byState('stable'),
      byState('experimental'),
      byState('deprecated'),
      Object.keys(maturity.removed).length,
    ],
  },
  {
    id: 'source',
    what: 'CODE_REFERENCE §2 "Source files (non-test)"',
    file: 'CODE_REFERENCE.md',
    pattern: /\| Source files \(non-test\) \| \*\*(\d+)\*\*, ([\d,]+) lines/,
    expect: () => [sourceFiles.length, totalLines(sourceFiles)],
  },
  {
    id: 'tests-table',
    what: 'CODE_REFERENCE §2 "Test files / tests"',
    file: 'CODE_REFERENCE.md',
    pattern: /\| Test files \/ tests \| \*\*(\d+) files \/ [\d,]+ tests\*\*/,
    expect: () => [testFiles.length],
  },
  {
    id: 'tests-heading',
    what: 'CODE_REFERENCE §17 heading',
    file: 'CODE_REFERENCE.md',
    pattern: /^## 17\. Tests: (\d+) files, [\d,]+ tests, three projects$/m,
    expect: () => [testFiles.length],
  },
  {
    id: 'stylesheets',
    what: 'CODE_REFERENCE §2 "Stylesheets"',
    file: 'CODE_REFERENCE.md',
    pattern: /\| Stylesheets \| (\d+), from ([\d,]+) to ([\d,]+) lines/,
    expect: () => [stylesheets.length, sheetLines[0], sheetLines.at(-1)],
  },
  {
    id: 'fixtures',
    what: 'CODE_REFERENCE §2 "Fixtures"',
    file: 'CODE_REFERENCE.md',
    pattern: /\| Fixtures \| (\d+) PDFs, produced by (\d+) generator scripts, \*\*all of them tracked\*\*/,
    expect: () => [fixtures.length, generators.length],
  },
  {
    id: 'ci',
    what: 'CODE_REFERENCE §2 "CI"',
    file: 'CODE_REFERENCE.md',
    pattern: /\| CI \| (\d+) jobs in `ci\.yml`/,
    expect: () => [ciJobs.length],
  },
  {
    id: 'checks',
    what: 'PRD §8 Chrome row',
    file: 'PRD.md',
    pattern: /([\w-]+) automated browser checks run in Chromium today/,
    expect: () => [WORD[checkCount] ?? `#${checkCount}`],
  },
  {
    id: 'version',
    what: 'the docs site’s published version',
    file: 'docs/src/pages/Compatibility.tsx',
    pattern: /The package is <code>([\d.]+)<\/code>/,
    expect: () => [pkg.version],
  },
];

// ---------------------------------------------------------------------------
// Prose the documents may not carry (#240): a figure no command in a checkout can re-derive.
// ---------------------------------------------------------------------------

/** Every page of the docs site, read off the directory rather than typed into a list that goes stale. */
const docsPages = walk('docs/src/pages', (n) => n.endsWith('.tsx'));

/**
 * The rules above compare a documented figure against the tree. These refuse a figure the tree cannot answer:
 * a count of how many times a runner woke up, and one cell's reading of one such run. `ROADMAP.md` and the docs
 * site's compatibility page carried both — "has run — thirteen times … green in five of them", where `gh api` on
 * the same day read 33 push runs carrying a `Browser matrix` job and 22 of them green, a "22 times, last green
 * on `main` and `dev`" that had stopped being true of `dev` before the week it described, and a Chromium row
 * that still said "thirteen claims … 23 ok, 1 skip" six rows after the harness grew past them. A stale tally is
 * worse than a missing one because it reads exactly like a live one. The readings themselves are not banned:
 * they belong in `fr-evidence.json`, named by run id, where a row moves only when a run moves it.
 *
 * The patterns are deliberately narrow. "<number> times" is ordinary English in ROADMAP's benchmark prose, so
 * only a count attached to a job *running* or *going green* is refused, and the generated status block is cut
 * first because its gap column quotes `fr-evidence.json`, not this file.
 */
const STATUS_BLOCK = /<!-- FR-EVIDENCE:STATUS:START -->[\s\S]*?<!-- FR-EVIDENCE:STATUS:END -->/g;
const COUNT =
  '\\d{1,3}|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|' +
  'fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty';
const PROHIBITED = [
  {
    id: 'ci-run-tally',
    files: ['ROADMAP.md'],
    pattern: new RegExp(
      `\\b(?:has|had|have)\\s+run\\b[^.]{0,140}?\\b(?:${COUNT})\\b[^.]{0,24}?\\b(?:times|runs)\\b`,
      'i',
    ),
    why:
      'counts how many times a CI job ran. Nothing in a checkout can re-derive it and every push moves it — ' +
      'record each reading with its run id in `fr-evidence.json` under the requirement instead (#240).',
  },
  {
    id: 'ci-green-tally',
    files: ['ROADMAP.md'],
    pattern: new RegExp(
      `\\b(?:gone|went|been)\\s+green\\b[^.]{0,140}?\\b(?:${COUNT})\\b[^.]{0,24}?\\b(?:times|runs)\\b`,
      'i',
    ),
    why:
      'counts how many CI runs went green, which is a sample of a flaky row rather than a verdict on it — ' +
      'name the runs in `fr-evidence.json`, where the reading and the reason it moved live (#240).',
  },
  {
    id: 'matrix-cell-reading',
    files: ['ROADMAP.md', ...docsPages],
    pattern: /\b\d+\s+(?:ok|skipped|skips?|not runnable)\b/i,
    why:
      "is one browser cell's reading of one run. It goes stale as rows land — the count of checks is " +
      "derived and printed by this script, and a run's tallies belong under `FR-48` in `fr-evidence.json` (#240).",
  },
];

function checkProhibited(textOf) {
  return PROHIBITED.flatMap((rule) =>
    rule.files
      .map((file) => {
        const text = textOf(file);
        if (text === null) return null;
        const hit = rule.pattern.exec(file === 'ROADMAP.md' ? text.replace(STATUS_BLOCK, '') : text);
        return hit ? `${file} ${rule.id}: "${hit[0].replace(/\s+/g, ' ').slice(0, 120)}" ${rule.why}` : null;
      })
      .filter(Boolean),
  );
}

/** Each case writes a banned figure back into the kind of file that carried it; the rule has to see all three. */
const PROHIBITED_SELFTESTS = [
  {
    id: 'ci-run-tally',
    file: 'ROADMAP.md',
    name: 'a count of CI runs comes back',
    sample: 'The `browser` job has run — thirteen times this month.',
  },
  {
    id: 'ci-green-tally',
    file: 'ROADMAP.md',
    name: 'a count of green runs comes back',
    sample: 'That job has gone green four times on the runner.',
  },
  {
    id: 'matrix-cell-reading',
    file: 'docs/src/pages/Compatibility.tsx',
    name: 'a cell reading comes back into a docs page',
    sample: 'Chromium x desktop returned 23 ok and 1 skip.',
  },
];

// ---------------------------------------------------------------------------
// The engine axis (#194) — perturbed the way the two peer jobs drift: one list moved, one list deleted,
// and the benchmark cell pointed at a version no cell runs.
// ---------------------------------------------------------------------------

const AXIS_LINE = "        engine: ['6.2.108', '6.4.299']";

/** The n-th exact occurrence of `line`, so a scenario can move one job's axis and leave the other alone. */
function nthOccurrence(text, line, n) {
  let at = -1;
  for (let i = 0; i <= n; i += 1) {
    at = text.indexOf(line, at + 1);
    if (at < 0) throw new Error(`self-test anchor "${line}" has no occurrence ${n + 1} in ci.yml`);
  }
  return at;
}

function replaceNth(text, line, n, replacement) {
  const at = nthOccurrence(text, line, n);
  return `${text.slice(0, at)}${replacement}${text.slice(at + line.length)}`;
}

const AXIS_SELFTESTS = [
  {
    name: 'the two peer jobs start measuring different pairs',
    expect: 'disagree',
    apply: (t) => replaceNth(t, AXIS_LINE, 1, "        engine: ['6.3.0', '6.4.299']"),
  },
  {
    name: 'the advertised floor leaves both axes',
    expect: 'does not contain the advertised floor',
    apply: (t) => t.split(AXIS_LINE).join("        engine: ['6.2.999', '6.4.299']"),
  },
  {
    name: 'one job stops declaring an axis at all',
    expect: 'not the two the contract is measured across',
    apply: (t) => replaceNth(t, AXIS_LINE, 1, '        # engine axis removed'),
  },
  {
    name: 'an axis grows past the pair §8 describes',
    expect: 'is not a pair',
    apply: (t) => replaceNth(t, AXIS_LINE, 1, "        engine: ['6.2.108', '6.3.289', '6.4.299']"),
  },
  {
    name: 'the benchmark cell points at an engine no job runs',
    expect: "which no cell of the matrix names",
    apply: (t) => t.replace("if: matrix.engine == '6.4.299'", "if: matrix.engine == '6.9.999'"),
  },
  {
    name: 'the benchmark stops being gated and runs in every cell',
    expect: 'no step is gated on an engine version',
    apply: (t) => t.replace("        if: matrix.engine == '6.4.299'\n", ''),
  },
];

// ---------------------------------------------------------------------------
// The lockfile's mirrored manifest fields — the drift this rule exists for is the one it found: `engines.node`
// at `>=20` in the lock while `package.json` had moved the Node floor to 22.13.0, invisible to `npm ci`.
// ---------------------------------------------------------------------------

function withoutLockRoot(text) {
  const lock = JSON.parse(text);
  delete lock.packages[''];
  return JSON.stringify(lock);
}

function withLockRootField(text, field, key, value) {
  const lock = JSON.parse(text);
  lock.packages[''][field] = { ...lock.packages[''][field], [key]: value };
  return JSON.stringify(lock);
}

function withLockRootVersion(text, version) {
  const lock = JSON.parse(text);
  lock.packages[''].version = version;
  return JSON.stringify(lock);
}

const LOCK_SELFTESTS = [
  {
    name: 'the lock keeps an old Node floor after the contract moves',
    expect: 'root engines.node is',
    apply: (t) => withLockRootField(t, 'engines', 'node', '>=20'),
  },
  {
    name: 'the lock keeps an old engine peer floor',
    expect: 'root peerDependencies.pdfjs-dist is',
    apply: (t) => withLockRootField(t, 'peerDependencies', 'pdfjs-dist', '^6.0.0'),
  },
  {
    name: 'the lock’s root version falls behind the manifest',
    expect: 'root version is',
    apply: (t) => withLockRootVersion(t, '0.0.1'),
  },
  {
    name: 'the lock has no root entry to compare',
    expect: 'no root',
    apply: withoutLockRoot,
  },
];

// ---------------------------------------------------------------------------
// README's two size tables (#240) — the same measurement, quoted in the file a consumer reads first.
// ---------------------------------------------------------------------------

/** The catalog figures as a range, which is how both places in README quote them. */
const catalogRange = (f) => {
  const sizes = Object.entries(f.kB)
    .filter(([label]) => label.startsWith('catalog:'))
    .map(([, kB]) => kB)
    .sort((a, b) => a - b);
  return [sizes[0], sizes.at(-1)];
};

/**
 * The docs site renders the figures file directly; README is markdown, so it is held to it instead. Each entry
 * names a row by the words around its number rather than by its position, and a row that cannot be found is
 * reported — a table reworded out of this list is a table nobody checks again, which is the failure mode the
 * whole gate exists to refuse.
 */
const README_ROWS = [
  { what: 'the core row', pattern: /no features[^|]*\| ([\d.]+) kB \| —/, want: (f) => [f.kB.core] },
  {
    what: 'the all-nine row',
    pattern: /^\| All nine \| ([\d.]+) kB \| \+([\d.]+) kB \|/m,
    want: (f) => [f.kB.all, f.overCore.all],
  },
  {
    what: 'the headless-hook row',
    pattern: /A single headless hook[^|]*\| ([\d.]+) kB/,
    want: (f) => [f.kB['headless-only']],
  },
  { what: 'the merge row', pattern: /A merge, on its own[^|]*\| ([\d.]+) kB/, want: (f) => [f.kB['merge-only']] },
  {
    what: 'the edit tier cost',
    // The row runs over four lines, so this walks from its start to the first cost cell after it.
    pattern: /^\| `edit` \|[\s\S]*?\| ([\d.]+) kB \|/m,
    want: (f) => [f.overCore.edit],
  },
  {
    what: 'the merge entry cost',
    pattern: /its own entry: ([\d.]+) kB/,
    want: (f) => [f.kB['merge-only']],
  },
  {
    what: 'the CommonJS shipped paths',
    pattern: /as CommonJS[^|]*\| ([\d.]+) \/ ([\d.]+) kB/,
    want: (f) => [f.kB['shell (cjs)'], f.kB['headless (cjs)']],
  },
  { what: 'the catalog row', pattern: /locale catalog[^|]*\| ([\d.]+)–([\d.]+) kB/, want: catalogRange },
  { what: 'the catalog bullet', pattern: /`\/fr` or `\/es` — ([\d.]+)–([\d.]+) kB gzipped/, want: catalogRange },
  {
    what: 'the shipped-entry sums',
    pattern: /gives\r?\n?([\d.]+) kB for `index\.js` and ([\d.]+) kB for `headless\.js`/,
    want: (f) => [f.kB.shell, f.kB.headless],
  },
  { what: 'the all-nine sentence', pattern: /All nine together cost ([\d.]+) kB/, want: (f) => [f.overCore.all] },
];

/** Every `+ xFeature` row of README's size table, read off the table rather than listed here. */
function readmeFeatureRows(text, figures) {
  const problems = [];
  for (const [, name, size, over] of text.matchAll(/^\| `\+ (\w+)Feature` \| ([\d.]+) kB \| \+([\d.]+) kB \|/gm)) {
    const key = name.toLowerCase();
    if (!(key in figures.overCore)) {
      problems.push(`README.md quotes a \`+ ${name}Feature\` row that the gate measures no figure for (key ${key}).`);
      continue;
    }
    const want = [figures.kB[`core+${key}`], figures.overCore[key]];
    for (const [i, stated] of [size, over].entries()) {
      if (Number(stated) !== want[i]) {
        problems.push(
          `README.md's \`+ ${name}Feature\` row says ${[size, over][i]} kB, the gate measured ${want[i]} (${
            i ? 'over core' : 'the path itself'
          }).`,
        );
      }
    }
  }
  return problems;
}

/** The feature table's cost column, keyed by the entry name in each row. */
function readmeCostColumn(text, figures) {
  const problems = [];
  for (const [, name, stated] of text.matchAll(/^\| `features\/(\w+)` \|.*\| ([\d.]+) kB \|/gm)) {
    if (!(name in figures.overCore)) {
      problems.push(`README.md costs \`features/${name}\` at ${stated} kB, which the gate measures no figure for.`);
      continue;
    }
    if (Number(stated) !== figures.overCore[name]) {
      problems.push(
        `README.md costs \`features/${name}\` at ${stated} kB over core; \`npm run size\` measured ${figures.overCore[name]}.`,
      );
    }
  }
  return problems;
}

function checkReadmeFigures({ figures, readme }) {
  if (!figures || typeof figures.kB !== 'object' || typeof figures.overCore !== 'object') return [];
  const problems = [];
  for (const row of README_ROWS) {
    const match = readme.match(row.pattern);
    if (!match) {
      problems.push(`README.md ${row.what}: no row matches the pattern this rule reads, so that figure is unchecked.`);
      continue;
    }
    const want = row.want(figures);
    match.slice(1, want.length + 1).forEach((stated, i) => {
      if (Number(stated) !== want[i]) {
        problems.push(`README.md ${row.what}: the file says ${stated} kB, the gate measured ${want[i]}.`);
      }
    });
  }
  return [...problems, ...readmeFeatureRows(readme, figures), ...readmeCostColumn(readme, figures)];
}

const README_SIZE_SELFTESTS = [
  {
    name: 'a size-table row falls behind the gate',
    apply: (readme) =>
      readme.replace(/\| `PdfViewer`, no features[^|]*\| ([\d.]+) kB/, (m, n) => m.replace(n, '29.09')),
    expect: 'the core row',
  },
  {
    name: 'the cost column falls behind',
    apply: (readme) =>
      readme.replace(/^\| `features\/outline` \|(.*)\| [\d.]+ kB \|/m, '| `features/outline` |$1| 0.98 kB |'),
    expect: 'features/outline',
  },
  {
    name: 'a quoted row is reworded out of the gate',
    apply: (readme) => readme.replace('A single headless hook', 'A bare headless hook'),
    expect: 'the headless-hook row',
  },
];

// ---------------------------------------------------------------------------
// The docs site's size figures (#240) — a cross-file rule, because its whole point is that two files agree.
// ---------------------------------------------------------------------------

const FIGURES_FILE = 'docs/src/size-figures.json';
const SIZE_PAGES = docsPages;

/** Every tier the docs price for a reader: each feature entry, the edit tier, and everything mounted at once. */
const pricedTiers = [
  ...exportKeys.filter((k) => k.startsWith('./features/')).map((k) => k.split('/').pop()),
  'edit',
  'all',
];

/** The peer figures the gate measures and the docs quote: the engine's two modules and the writer. */
const PEER_KEYS = ['engineMain', 'engineWorker', 'writer'];

/**
 * Five failures, each one a way the old hand-copy went wrong:
 * a published tier with no figure (the table would silently drop it), a page indexing a key nobody measures
 * (the cell would render `undefined kB`), a typed cell creeping back, a page rendering numbers it never
 * imported, and a peer measurement that stopped being taken. The file is read from disk like everything else
 * here — no bundler, so the rule runs in a checkout that has never been built.
 */
function checkSizeFigures({ figures, pages }) {
  const problems = [];
  if (
    !figures ||
    typeof figures.kB !== 'object' ||
    typeof figures.overCore !== 'object' ||
    typeof figures.peers !== 'object'
  ) {
    return [
      `${FIGURES_FILE}: missing, unreadable, or without its \`kB\`/\`overCore\`/\`peers\` maps — \`npm run size\` ` +
        'writes it and the docs render it, so a page with no file behind it is a page of typed numbers again (#240).',
    ];
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(figures.measuredOn)) || Number.isNaN(Date.parse(figures.measuredOn))) {
    problems.push(
      `${FIGURES_FILE}: "measuredOn" is ${JSON.stringify(figures.measuredOn)}, which is not a date. PRD's front ` +
        'matter rule 3: a measured figure without its date is an adjective.',
    );
  }
  // A peer that is not installed is recorded as null and the docs say so; a peer with no entry at all is a gate
  // that stopped measuring, which is the failure worth naming.
  for (const key of PEER_KEYS) {
    if (!(key in figures.peers)) {
      problems.push(
        `${FIGURES_FILE}: \`peers\` has no \`${key}\` entry. \`npm run size\` measures the engine and the writer for ` +
          'the docs pages to quote, so a missing key is a stopped measurement, not an absent peer (#240).',
      );
    }
  }
  for (const tier of pricedTiers) {
    if (!(tier in figures.overCore)) {
      problems.push(
        `${FIGURES_FILE}: \`overCore\` has no entry for \`${tier}\`, which the export map publishes and the docs ` +
          'table prices. Run `npm run size`, or take the tier out of the table.',
      );
    }
  }
  for (const [file, text] of Object.entries(pages)) {
    for (const key of [...text.matchAll(/figures\.kB\['([^']+)'\]/g)].map((m) => m[1])) {
      if (!(key in figures.kB)) problems.push(`${file}: renders figures.kB['${key}'], which the gate never measured.`);
    }
    for (const key of [...text.matchAll(/figures\.overCore\.([a-z]+)/g)].map((m) => m[1])) {
      if (!(key in figures.overCore))
        problems.push(`${file}: renders figures.overCore.${key}, which the gate never measured.`);
    }
    const typed = text.match(/<(td|strong)>\s*\+?\d+(?:\.\d+)?\s*kB\s*<\/\1>/);
    if (typed) {
      problems.push(
        `${file}: a size figure is typed by hand (${typed[0].replace(/\s+/g, ' ')}) — since #240 the docs render ` +
          `${FIGURES_FILE}, so a number written into a page is a number nobody measures again.`,
      );
    }
    if (/figures\.(kB|overCore|measuredOn)/.test(text) && !text.includes(FIGURES_FILE.split('/').pop())) {
      problems.push(`${file}: renders size figures without importing ${FIGURES_FILE}.`);
    }
  }
  return problems;
}

function readSizeFigures() {
  const pages = Object.fromEntries(SIZE_PAGES.map((file) => [file, read(file).replace(/\/\*\*[\s\S]*?\*\//g, '')]));
  let figures = null;
  try {
    figures = JSON.parse(read(FIGURES_FILE));
  } catch {
    figures = null;
  }
  return { figures, pages };
}

/**
 * Perturbations for `--selftest`: each one is a distinct way the hand-copy comes back.
 *
 * A scenario finds the page that actually contains its needle instead of naming one by position — the page list
 * is now the whole directory, sorted, so `SIZE_PAGES[0]` is whatever file happens to sort first, and a scenario
 * whose needle is not there perturbs nothing and "passes" by doing nothing. That is the same fault this repo has
 * been asked to refuse twice now: a guard that cannot fail is not a guard, so these throw rather than skip.
 */
function perturb(pages, needle, edit) {
  const file = Object.keys(pages).find((f) => needle.test(pages[f]));
  if (!file) throw new Error(`no docs page contains ${needle} — the scenario that would prove it is dead`);
  pages[file] = edit(pages[file]);
}

const SIZE_SELFTESTS = [
  {
    name: 'a published tier has no figure',
    apply: ({ figures }) => {
      delete figures.overCore.print;
    },
  },
  {
    name: 'a page indexes a key nobody measures',
    apply: ({ pages }) => {
      perturb(pages, /figures\.overCore\.print/, (text) =>
        text.replace(/figures\.overCore\.print/, 'figures.overCore.teleport'),
      );
    },
  },
  {
    name: 'a size cell is typed by hand again',
    apply: ({ pages }) => {
      perturb(pages, /<td>\{(?:kb|cost)\(figures\.kB\['core'\]\)\}<\/td>/, (text) =>
        text.replace(/<td>\{(?:kb|cost)\(figures\.kB\['core'\]\)\}<\/td>/, '<td>29.09 kB</td>'),
      );
    },
  },
  {
    name: 'a page renders figures without importing the file',
    apply: ({ pages }) => {
      perturb(pages, /import figures from /, (text) =>
        text.replace(/import figures from '[^']*size-figures\.json';/, ''),
      );
    },
  },
  {
    name: 'a peer measurement stopped being taken',
    apply: ({ figures }) => {
      delete figures.peers.writer;
    },
  },
  {
    name: 'the figures file has no date',
    apply: ({ figures }) => {
      figures.measuredOn = 'whenever';
    },
  },
  {
    name: 'the figures file is gone',
    apply: (state) => {
      state.figures = null;
    },
  },
];

// ---------------------------------------------------------------------------

/** Compare one rule against document text; return the complaints, if any. */
function checkRule(rule, text) {
  const match = text.match(rule.pattern);
  if (!match) {
    return [
      `${rule.what}: nothing in ${rule.file} matches the pattern this rule reads. The sentence was reworded or ` +
        'the figure left the document, and either way the number is no longer being checked.',
    ];
  }
  const expected = rule.expect();
  const problems = [];
  match.slice(1, expected.length + 1).forEach((stated, i) => {
    const want = String(expected[i]);
    const ok = /^\d[\d,]*$/.test(stated) ? digits(stated) === digits(want) : stated === want;
    if (!ok) problems.push(`${rule.what}: the document says "${stated}", the tree gives ${want}.`);
  });
  if (rule.id === 'fixtures' && fixtures.length !== trackedFixtures) {
    problems.push(
      `CODE_REFERENCE §2 "Fixtures": ${fixtures.length} PDFs on disk and ${trackedFixtures} in git — ` +
        '"all of them tracked" is false, and an untracked fixture is a suite a fresh clone cannot run.',
    );
  }
  return problems;
}

function audit() {
  const cache = new Map();
  const textFor = (file) => {
    if (!cache.has(file)) cache.set(file, read(file));
    return cache.get(file);
  };
  const textOrNull = (file) => {
    try {
      return textFor(file);
    } catch {
      return null;
    }
  };
  const sizeState = readSizeFigures();
  return [
    ...RULES.flatMap((rule) => checkRule(rule, textFor(rule.file))),
    ...checkProhibited(textOrNull),
    ...checkEngineAxis(textFor('.github/workflows/ci.yml')),
    ...checkLockMirror(),
    ...checkSizeFigures(sizeState),
    ...checkReadmeFigures({ figures: sizeState.figures, readme: textFor('README.md') }),
  ];
}

/**
 * Perturb every documented figure the rule reads, one at a time, in memory.
 *
 * The cases are derived from the live document rather than written out, for two reasons. Hard-coded needles go
 * stale the moment a figure legitimately moves — the first version of this self-test checked `**80**, 17,169
 * lines` and reported three MISSED cases the day the tree grew two files — and a stale needle is worse than no
 * needle, because it reads like a test that ran. And altering *each* capture, not only the first, is what
 * proves a rule compares every number in its sentence rather than the one it anchors on.
 *
 * Each case edits the document string at the capture's own byte offset (the regex `d` flag reports them), so
 * exactly one figure changes and nothing else in the sentence moves.
 */
function wrongValue(captured, i) {
  if (/^[\d,]+$/.test(captured)) {
    const next = digits(captured) + 1;
    return captured.includes(',') ? commas(next) : String(next);
  }
  // A dotted version is numeric too: perturbing a segment keeps the sentence matching its own pattern, so the
  // failure names the disagreement rather than only the missing figure.
  if (/^\d+(\.\d+)+$/.test(captured)) {
    const parts = captured.split('.');
    parts[parts.length - 1] = String(Number(parts.at(-1)) + 1);
    return parts.join('.');
  }
  const words = WORD.filter((w) => w && w !== captured);
  return words[i % words.length];
}

function withFlag(pattern, flag) {
  return pattern.flags.includes(flag) ? pattern : new RegExp(pattern.source, pattern.flags + flag);
}

function selfTest() {
  const safeRead = (file) => {
    try {
      return read(file);
    } catch {
      return null;
    }
  };
  let expected = 0;
  let caught = 0;
  for (const rule of RULES) {
    const text = read(rule.file);
    const match = text.match(withFlag(rule.pattern, 'd'));
    if (!match) {
      console.log(`  BROKEN  ${rule.id}: the live document does not match its own pattern`);
      expected += 1;
      continue;
    }
    match.slice(1).forEach((captured, i) => {
      expected += 1;
      const [from, to] = match.indices[i + 1];
      const wrong = wrongValue(captured, i);
      const perturbed = `${text.slice(0, from)}${wrong}${text.slice(to)}`;
      const problems = checkRule(rule, perturbed);
      if (problems.length) {
        caught += 1;
        console.log(`  caught  ${rule.id}[${i}] "${captured}" → "${wrong}": ${problems[0].slice(0, 100)}`);
      } else {
        console.log(`  MISSED  ${rule.id}[${i}] "${captured}" → "${wrong}" still passes — that figure is not checked`);
      }
    });
  }
  // A figure that leaves the document must fail too, rather than quietly removing itself from the gate's reach.
  const ci = RULES.find((r) => r.id === 'ci');
  const ciText = read(ci.file);
  expected += 1;
  const reworded = checkRule(ci, ciText.replace(ci.pattern.exec(ciText)[0], '| CI | jobs in `ci.yml`'));
  if (reworded.length) {
    caught += 1;
    console.log(`  caught  reworded: the CI row with its number deleted — ${reworded[0].slice(0, 80)}`);
  } else {
    console.log('  MISSED  reworded: a row with no number still passes');
  }
  // A prohibition has no figure to perturb: its live state is "matches nothing", so the test writes the banned
  // sentence back in and requires the named rule to see it. Without this, a typo in one of these patterns turns
  // the rule into a comment that says it is a check.
  for (const scenario of PROHIBITED_SELFTESTS) {
    expected += 1;
    const textOf = (file) => (file === scenario.file ? `${read(file)}\n${scenario.sample}\n` : safeRead(file));
    const found = checkProhibited(textOf);
    const hit = found.find((p) => p.startsWith(`${scenario.file} ${scenario.id}:`));
    if (hit) {
      caught += 1;
      console.log(`  caught  prose: ${scenario.name} — ${hit.slice(0, 110)}`);
    } else {
      console.log(`  MISSED  prose: ${scenario.name} — ${scenario.id} did not see it in ${scenario.file}`);
    }
  }
  // The engine axis, which has no figure either: its live state is "both jobs say the same pair", so the test
  // moves one job's list, deletes one, and points the benchmark at a version no cell runs.
  for (const scenario of AXIS_SELFTESTS) {
    expected += 1;
    const found = checkEngineAxis(scenario.apply(read('.github/workflows/ci.yml')));
    const hit = found.find((p) => p.includes(scenario.expect));
    if (hit) {
      caught += 1;
      console.log(`  caught  axis: ${scenario.name} — ${hit.slice(0, 110)}`);
    } else {
      console.log(`  MISSED  axis: ${scenario.name} — the rule saw ${found.length ? `"${found[0].slice(0, 60)}"` : 'nothing'}`);
    }
  }
  // The lockfile mirror, perturbed the way a manifest edit drifts: one field left behind, and the root removed
  // so the comparison has nothing to read.
  for (const scenario of LOCK_SELFTESTS) {
    expected += 1;
    const found = checkLockMirror(scenario.apply(read('package-lock.json')));
    const hit = found.find((p) => p.includes(scenario.expect));
    if (hit) {
      caught += 1;
      console.log(`  caught  lock: ${scenario.name} — ${hit.slice(0, 110)}`);
    } else {
      console.log(`  MISSED  lock: ${scenario.name} — the rule saw ${found.length ? `"${found[0].slice(0, 60)}"` : 'nothing'}`);
    }
  }
  // README's tables, perturbed the way they drift: a number left behind, and a row reworded out of reach.
  const readmeText = read('README.md');
  const readmeFigures = readSizeFigures().figures;
  for (const scenario of README_SIZE_SELFTESTS) {
    expected += 1;
    const found = checkReadmeFigures({ figures: readmeFigures, readme: scenario.apply(readmeText) });
    const hit = found.find((p) => p.includes(scenario.expect));
    if (hit) {
      caught += 1;
      console.log(`  caught  readme: ${scenario.name} — ${hit.slice(0, 100)}`);
    } else {
      console.log(`  MISSED  readme: ${scenario.name} — no problem named "${scenario.expect}"`);
    }
  }
  // The size-figure rule, perturbed one way at a time — each case is a distinct return of the hand-copy.
  for (const scenario of SIZE_SELFTESTS) {
    expected += 1;
    const state = readSizeFigures();
    scenario.apply(state);
    const sizeProblems = checkSizeFigures(state);
    if (sizeProblems.length) {
      caught += 1;
      console.log(`  caught  size: ${scenario.name} — ${sizeProblems[0].slice(0, 90)}`);
    } else {
      console.log(`  MISSED  size: ${scenario.name} still passes — the rule cannot see it`);
    }
  }
  console.log(`\nself-test: ${caught}/${expected} perturbations caught`);
  process.exit(caught === expected ? 0 : 1);
}

if (process.argv.includes('--selftest')) selfTest();

const problems = audit();
if (problems.length) {
  console.error('The documented figures disagree with the tree, or a figure no tool derives is back in ROADMAP:\n');
  for (const p of problems) console.error(`  ${p}`);
  console.error(
    '\nFix the document from these numbers — `node scripts/check-docs.mjs` is the derivation, so re-run it\n' +
      'after editing. Change this script only when it is measuring the wrong thing, and say so in the changelog.',
  );
  process.exit(1);
}

console.log(
  `docs consistent — ${exportKeys.length} subpaths (${jsEntries.length} JS, ` +
    `${exportKeys.filter(isLocale).length} locales, ${exportKeys.filter(isCss).length} stylesheets), ` +
    `${tagValues.length} public names (${byState('stable')} stable / ${byState('experimental')} experimental / ` +
    `${byState('deprecated')} deprecated, ${Object.keys(maturity.removed).length} removed), ` +
    `${sourceFiles.length} source files (${commas(totalLines(sourceFiles))} lines), ${testFiles.length} test files, ` +
    `${stylesheets.length} stylesheets (${commas(sheetLines[0])}–${commas(sheetLines.at(-1))} lines), ` +
    `${fixtures.length} fixtures tracked ${trackedFixtures}/${fixtures.length} from ${generators.length} generators, ` +
    `${ciJobs.length} CI jobs, ${checkCount} browser checks`,
);
