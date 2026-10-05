/*
 * `CODE_REFERENCE.md` and `PRD.md` §8 state counts that are facts about the files in this repository — how many
 * source files there are, how many entry points a consumer can import, how many names carry a maturity tag, how
 * many checks the browser matrix runs. Every one of them has been wrong at least once, and the drift is not
 * careless editing but the shape of the problem: #203 re-ran the commands behind §2's table and *every* number
 * had fallen behind (234/187/32/9 against the inventory's 239/197/36/13, "144 strings" against the 136 the
 * catalog test asserts), and §8's browser-check count has gone twelve → thirteen → fourteen as rows landed,
 * each time corrected by whoever happened to remember. #213 is the standing fix: those figures stop being
 * quoted and start being derived.
 *
 * The rule is deliberately narrow. It checks only what can be re-derived from files already in a checkout — no
 * `dist/`, no bundler, no test run, no browser — because a documentation gate that needs a build cannot run
 * where no build has happened, and the failure mode it exists to prevent is silence. Each rule holds two
 * things: a pattern that must find the figure in the document, and the value computed from the tree. A pattern
 * that stops matching is itself a failure, reported as one — a sentence reworded out of the gate's reach is
 * how a claim becomes unfalsifiable, which is the same class as a guard that asserts less than its clause.
 *
 * What it does not check, and why: the test *total* (that is `npm run test`'s answer; re-running the suite
 * inside a doc gate would double `verify` for a number the suite already prints), every size figure (`check-size`
 * owns those), the PRD's code blocks (`check:examples` compiles them), and any dated measurement — a CI tally
 * or a benchmark median records one run, not a property of the tree, so those stay prose on purpose.
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

const WORD = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Eleven',
  'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen', 'Twenty'];

// ---------------------------------------------------------------------------
// The document side: one rule per figure, `groups` long.
// ---------------------------------------------------------------------------

const RULES = [
  {
    id: 'subpaths',
    what: 'CODE_REFERENCE §2 "Importable subpaths"',
    file: 'CODE_REFERENCE.md',
    pattern: /\| Importable subpaths \| \*\*(\d+)\*\* \((\d+) JS entries \+ (\d+) languages \+ (\d+) stylesheets/,
    expect: () => [exportKeys.length, jsEntries.length, exportKeys.filter(isLocale).length, exportKeys.filter(isCss).length],
  },
  {
    id: 'maturity',
    what: 'CODE_REFERENCE §2 "Distinct public names, by maturity"',
    file: 'CODE_REFERENCE.md',
    pattern:
      /\| Distinct public names, by maturity \| \*\*(\d+)\*\* — (\d+) stable, (\d+) experimental, (\d+) deprecated, plus \*\*(\d+)\*\* in the `removed` ledger/,
    expect: () => [tagValues.length, byState('stable'), byState('experimental'), byState('deprecated'), Object.keys(maturity.removed).length],
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
    pattern: /(\w+) automated browser checks run in Chromium today/,
    expect: () => [WORD[checkCount] ?? `#${checkCount}`],
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
  return RULES.flatMap((rule) => checkRule(rule, textFor(rule.file)));
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
  const words = WORD.filter((w) => w && w !== captured);
  return words[i % words.length];
}

function withFlag(pattern, flag) {
  return pattern.flags.includes(flag) ? pattern : new RegExp(pattern.source, pattern.flags + flag);
}

function selfTest() {
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
  console.log(`\nself-test: ${caught}/${expected} perturbations caught`);
  process.exit(caught === expected ? 0 : 1);
}

if (process.argv.includes('--selftest')) selfTest();

const problems = audit();
if (problems.length) {
  console.error('CODE_REFERENCE.md / PRD.md disagree with the tree:\n');
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
