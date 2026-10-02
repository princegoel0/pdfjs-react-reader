/*
 * FR-52/FR-58 support: the requirement → evidence register, and the gate that keeps it honest.
 *
 * `PRD.md` is a target specification: it says what the package must do, and deliberately says nothing about
 * whether it does it yet. `fr-evidence.json` is the other half — one row per requirement, naming the source
 * that implements it, the tests that verify it, the acceptance evidence that proves it in a browser or a build,
 * the documentation that tells a host it exists, and the guard that fails when it regresses. It is the artifact
 * `PRD.md` §5.7 (Requirement Definition of Done) asks for and nothing else produced.
 *
 * The rules exist to close the four ways a register like this becomes decoration rather than evidence:
 *
 *  1. **A citation to a file that does not exist.** Checked against the filesystem, so a rename is caught the
 *     day it happens instead of the day someone trusts the row.
 *  2. **A requirement marked done with nothing asserting it.** `met` needs source, a test, a guard, a docs page
 *     and either acceptance or a written waiver for not having one.
 *  3. **A browser check cited that the harness does not run.** `#anchor` citations are resolved against
 *     `scripts/browser-matrix.mjs`, so a row cannot claim a check that was renamed away.
 *  4. **Silent drift between the specification and the register.** The id list and each title are read out of
 *     `PRD.md` itself; a requirement renamed or renumbered there fails this gate until the register follows in
 *     the same diff.
 *
 * A `partial` or `absent` row is not a failure: this file records reality, and most of the locked PRD is
 * unwritten on purpose. What fails is a row that claims more than it can show. Run with `--selftest` to see the
 * gate break on purpose before trusting it to break on accident.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(fileURLToPath(new URL('.', import.meta.url)), '..');
const PRD = join(root, 'PRD.md');
const REGISTER = join(root, 'fr-evidence.json');
const MATRIX = join(root, 'scripts', 'browser-matrix.mjs');
const ROADMAP = join(root, 'ROADMAP.md');

const STATES = ['met', 'partial', 'absent'];
/** Evidence kinds a `met` row must fill in, per PRD §5.7. */
const REQUIRED_FOR_MET = ['implementation', 'automated', 'regressionGuard', 'documentation'];
/** Files that count as verification: a unit/integration test, or a gate script that fails on regression. */
const TEST_FILE = /(\.test\.tsx?|\.spec\.tsx?)$/;
const GATE_SCRIPT = /^scripts\/[a-z0-9-]+\.mjs$/;

/**
 * Read the requirement rows out of the specification. `PRD.md` is the only source of the id set and the titles,
 * because a register that could define its own requirement list is a register that quietly drops one.
 */
export function readPrdRows(prdText) {
  const rows = new Map();
  for (const match of prdText.matchAll(/^\|\s*\*\*FR-(\d{2})\*\*\s*\|\s*([^|]+?)\s*\|\s*([^|].*?)\s*\|\s*$/gm)) {
    const [, num, title] = match;
    const id = `FR-${num}`;
    if (rows.has(id)) rows.set(id, { duplicate: true, title: rows.get(id).title });
    else rows.set(id, { title: normalise(title), clause: match[3] });
  }
  return rows;
}

const normalise = (text) => text.replace(/\s+/g, ' ').trim().toLowerCase();

/** Anchors the browser harness actually defines, so `matrix.mjs#paints-a-page` cannot point at nothing. */
function readMatrixAnchors() {
  const anchors = new Set();
  const text = readFileSync(MATRIX, 'utf8');
  // Check names carry spaces and parentheses ("pinch-vs-pan (synthetic touch)"), so a character class that
  // stops at the first one silently drops that check from the claimable set — and a register cannot cite it.
  for (const match of text.matchAll(/(?:id|name):\s*'([a-z0-9 ()-]+)'/g)) anchors.add(match[1]);
  return anchors;
}

/** `path#anchor` → `path`; a plain path is returned unchanged. */
const pathOf = (citation) => citation.split('#')[0];
const anchorOf = (citation) => (citation.includes('#') ? citation.split('#')[1] : null);

const MARK_START = '<!-- FR-EVIDENCE:STATUS:START -->';
const MARK_END = '<!-- FR-EVIDENCE:STATUS:END -->';

/**
 * The status table `ROADMAP.md` §1 publishes. Generated rather than written, because the alternative is what
 * this project just measured: 51 hand-maintained status cells, 21 of them still saying `done` about a
 * requirement the lock had just grown a clause on. Prose in `ROADMAP.md` keeps the *reason* a row moved — the
 * generated block keeps the *state*, and `audit()` fails when the two files disagree about it.
 */
export function renderStatusTable(register) {
  const kinds = ['implementation', 'automated', 'acceptance', 'documentation', 'regressionGuard'];
  const rows = Object.entries(register.requirements)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([id, row]) => {
      const present = kinds.filter((kind) => (row[kind] ?? []).length > 0);
      const gaps = (row.gaps ?? []).length;
      const first = (row.gaps ?? [])[0];
      const detail = first ? `${first.length > 96 ? `${first.slice(0, 96)}…` : first}` : '—';
      return `| \`${id}\` | ${row.title} | **${row.state}** | ${present.length}/5 | ${gaps} | ${detail} |`;
    });
  return [
    MARK_START,
    '<!-- Generated by `node scripts/check-fr-evidence.mjs --emit`. Do not edit between the markers: the',
    '     gate compares this block against fr-evidence.json and fails the build when they disagree. -->',
    '',
    '| FR | Requirement | State | Evidence kinds | Gaps | Leading gap |',
    '| --- | --- | --- | :---: | :---: | --- |',
    ...rows,
    '',
    MARK_END,
  ].join('\n');
}

/** Replace the marked block, or report that the markers are not there to replace. */
export function emitStatusTable(register) {
  const text = readFileSync(ROADMAP, 'utf8');
  if (!text.includes(MARK_START) || !text.includes(MARK_END)) {
    console.error('ROADMAP.md has no FR-EVIDENCE status markers — add them around the block first.');
    process.exit(1);
  }
  const next = text.replace(/<!-- FR-EVIDENCE:STATUS:START -->[\s\S]*?<!-- FR-EVIDENCE:STATUS:END -->/, renderStatusTable(register));
  writeFileSync(ROADMAP, next, 'utf8');
  console.log(`wrote the status block to ROADMAP.md (${Object.keys(register.requirements).length} rows)`);
}

/** The roadmap's published block must equal what the register says. Drift here is the bug this prevents. */
function checkStatusBlock(roadmapText, register) {
  if (!roadmapText.includes(MARK_START)) {
    return ['ROADMAP.md carries no FR-EVIDENCE status block, so its status table is hand-maintained drift'];
  }
  const match = /<!-- FR-EVIDENCE:STATUS:START -->[\s\S]*?<!-- FR-EVIDENCE:STATUS:END -->/.exec(roadmapText);
  if (!match) return ['ROADMAP.md has the status block start marker without its end marker'];
  if (match[0].trim() !== renderStatusTable(register).trim()) {
    return ['ROADMAP.md\'s status block is stale against fr-evidence.json — run `node scripts/check-fr-evidence.mjs --emit`'];
  }
  return [];
}

export function audit(register, prdRows, matrixAnchors, roadmapText) {
  const problems = [];
  const seen = new Set();

  if (!Array.isArray(register.states) || register.states.join() !== STATES.join()) {
    problems.push(`the register's state list is [${register.states ?? ''}], not ${STATES.join(', ')}`);
  }

  const requirements = register.requirements ?? {};
  for (const id of Object.keys(requirements)) {
    if (!/^FR-\d{2}$/.test(id)) problems.push(`${id} is not a requirement id of the form FR-NN`);
  }

  for (const id of prdRows.keys()) {
    if (requirements[id]) continue;
    problems.push(`${id} is in PRD.md but has no row in the register`);
  }
  for (const [id, row] of Object.entries(requirements)) {
    seen.add(id);
    const prdRow = prdRows.get(id);
    if (!prdRow) {
      problems.push(`${id} is in the register but PRD.md has no such requirement row`);
      continue;
    }
    if (prdRow.duplicate) problems.push(`${id} appears more than once in PRD.md's §4 tables`);
    if (normalise(row.title) !== prdRow.title) {
      problems.push(`${id} is titled "${row.title}" here but "${prdRow.title}" in PRD.md`);
    }

    if (!STATES.includes(row.state)) {
      problems.push(`${id} has state "${row.state}", which is not one of ${STATES.join(', ')}`);
    }
    if (row.clause) {
      problems.push(`${id} carries a "clause" key — the requirement text lives in PRD.md, never copied here`);
    }

    const lists = ['implementation', 'automated', 'acceptance', 'documentation', 'regressionGuard'];
    for (const kind of lists) {
      const entries = row[kind];
      if (!Array.isArray(entries)) {
        problems.push(`${id}.${kind} is ${JSON.stringify(entries)}, expected an array (empty is allowed)`);
        continue;
      }
      for (const citation of entries) {
        if (typeof citation !== 'string' || citation.trim() === '') {
          problems.push(`${id}.${kind} has an empty or non-string entry`);
          continue;
        }
        const file = pathOf(citation);
        if (!existsSync(join(root, file))) problems.push(`${id}.${kind} cites ${file}, which does not exist`);
        const anchor = anchorOf(citation);
        if (anchor && !file.endsWith('.mjs')) {
          problems.push(`${id}.${kind} gives ${citation} an #anchor outside a script`);
        } else if (anchor && !matrixAnchors.has(anchor)) {
          problems.push(`${id}.${kind} cites ${file}#${anchor}, but that check is not defined there`);
        }
        if ((kind === 'automated' || kind === 'regressionGuard') && entries.length) {
          const isTest = TEST_FILE.test(file) || GATE_SCRIPT.test(file);
          if (!isTest) problems.push(`${id}.${kind} cites ${file}, which is neither a test file nor a gate script`);
        }
      }
    }

    const gaps = Array.isArray(row.gaps) ? row.gaps : null;
    if (!gaps) problems.push(`${id} has no "gaps" array (an empty one states there are none)`);

    if (row.state === 'met') {
      for (const kind of REQUIRED_FOR_MET) {
        if (!(row[kind] ?? []).length) problems.push(`${id} is met but ${kind} is empty`);
      }
      if ((row.acceptance ?? []).length === 0 && !row.acceptanceWaiver) {
        problems.push(`${id} is met with no acceptance evidence and no acceptanceWaiver saying why`);
      }
      if (row.acceptanceWaiver && row.acceptanceWaiver.trim().length < 40) {
        problems.push(`${id}'s acceptanceWaiver is too short to be a reason: "${row.acceptanceWaiver}"`);
      }
      if (gaps && gaps.length) problems.push(`${id} is met but lists gaps: ${gaps.join('; ')}`);
      // A guard that does not say what it guards is deleted as dead code in the next tidy-up, which is how a
      // verified requirement silently becomes unverified. One of the cited files must name the id.
      const namesId = [...(row.automated ?? []), ...(row.regressionGuard ?? [])].some((citation) => {
        const file = pathOf(citation);
        if (!existsSync(join(root, file))) return false;
        return readFileSync(join(root, file), 'utf8').includes(id);
      });
      if (!namesId) {
        problems.push(
          `${id} is met, but none of its cited tests or guards names the requirement — add "${id}" to one header above.`,
        );
      }
    }

    if (row.state === 'partial' || row.state === 'absent') {
      if (!gaps || gaps.length === 0) problems.push(`${id} is ${row.state} but lists no gap`);
      if (row.state === 'absent' && (row.implementation ?? []).length) {
        problems.push(`${id} is absent but cites implementation: ${row.implementation.join(', ')}`);
      }
      if (!row.note || row.note.trim().length < 40) {
        problems.push(`${id} is ${row.state} and needs a note of at least 40 characters saying what is missing`);
      }
    }
  }

  if (roadmapText !== undefined) problems.push(...checkStatusBlock(roadmapText, register));

  return { problems, rows: Object.keys(requirements).length, declared: prdRows.size, seen };
}

function summary(report, register) {
  const rows = Object.entries(register.requirements ?? {});
  const by = (state) => rows.filter(([, r]) => r.state === state).map(([id]) => id);
  const met = by('met');
  const partial = by('partial');
  const absent = by('absent');
  const noTest = rows
    .filter(([, r]) => (r.automated ?? []).length === 0)
    .map(([id]) => id);
  const browserOnly = rows
    .filter(([, r]) => (r.automated ?? []).length === 0 && (r.acceptance ?? []).length > 0)
    .map(([id]) => id);
  const undocumented = met.filter((id) => (register.requirements[id].documentation ?? []).length === 0);

  console.log(`\nRequirement evidence — ${report.declared} requirements in PRD.md, ${report.rows} rows in the register`);
  console.log(`  met ${met.length} · partial ${partial.length} · absent ${absent.length}`);
  console.log(`  no automated test at all: ${noTest.length ? noTest.join(' ') : 'none'}`);
  console.log(`  accepted on a browser check alone: ${browserOnly.length ? browserOnly.join(' ') : 'none'}`);
  console.log(`  met but undocumented: ${undocumented.length ? undocumented.join(' ') : 'none'}`);
  for (const [id, row] of rows.sort()) {
    if (row.state === 'met') continue;
    console.log(`  ${id} ${row.state}: ${(row.gaps ?? []).join(' | ') || row.note || ''}`);
  }
}

/** Synthetic rows, each breaking exactly one rule, to prove the gate fails for the right reason. */
export function selfTest() {
  const anchors = new Set(['paints-a-page']);
  // FR-12 is a real requirement whose cited test really names it, so the sound case exercises every rule.
  const sound = {
    title: 'Jump-to-Page',
    state: 'met',
    implementation: ['src/lib/page-labels.ts'],
    automated: ['src/lib/page-labels.test.ts'],
    acceptance: ['scripts/browser-matrix.mjs#paints-a-page'],
    documentation: ['README.md'],
    regressionGuard: ['src/lib/page-labels.test.ts'],
    gaps: [],
  };
  const base = { states: STATES, requirements: { 'FR-12': sound } };
  const prd = new Map([
    ['FR-12', { title: 'jump-to-page', clause: 'x' }],
    ['FR-13', { title: 'text indexing', clause: 'x' }],
  ]);
  /** One-row register with the given patch applied to the sound row. */
  const withRow = (patch) => ({
    ...base,
    requirements: { 'FR-12': { ...sound, ...patch } },
  });
  const cases = [
    ['a requirement with no row', base, anchors, 'has no row in the register'],
    ['a wrong title', withRow({ title: 'Page labels' }), anchors, 'is titled "Page labels"'],
    ['a nonexistent path', withRow({ implementation: ['src/lib/nope.ts'] }), anchors, 'does not exist'],
    ['an anchor the harness lacks', withRow({ acceptance: ['scripts/browser-matrix.mjs#nope'] }), anchors, 'is not defined there'],
    ['met with empty tests', withRow({ automated: [], regressionGuard: [] }), anchors, 'is met but automated is empty'],
    ['a component cited as a test', withRow({ automated: ['src/components/PdfPage.tsx'] }), anchors, 'neither a test file nor a gate script'],
    ['met with gaps listed', withRow({ gaps: ['labels unresolved'] }), anchors, 'is met but lists gaps'],
    ['met without acceptance or waiver', withRow({ acceptance: [] }), anchors, 'no acceptanceWaiver'],
    ['met with a stub waiver', withRow({ acceptance: [], acceptanceWaiver: 'not needed' }), anchors, 'too short to be a reason'],
    ['met but no test names it', withRow({ automated: ['src/lib/layout.test.ts'], regressionGuard: ['src/lib/layout.test.ts'] }), anchors, 'names the requirement'],
    ['partial with no gap', withRow({ state: 'partial', gaps: [], note: 'A long enough note about what is missing here.' }), anchors, 'partial but lists no gap'],
    ['partial with a short note', withRow({ state: 'partial', gaps: ['labels ignored'] }), anchors, 'needs a note of at least 40 characters'],
    ['absent citing source', withRow({ state: 'absent', gaps: ['nothing built at all'], note: 'There is no implementation of this requirement anywhere.' }), anchors, 'is absent but cites implementation'],
    ['a copied clause', withRow({ clause: 'restated text' }), anchors, 'carries a "clause" key'],
    ['an unknown state', withRow({ state: 'done' }), anchors, 'state "done"'],
    ['a malformed requirement key', { ...base, requirements: { 'FR-1': sound } }, anchors, 'is not a requirement id'],
    ['a roadmap block that disagrees with the register', base, anchors, 'status block is stale', `${MARK_START}\n| \`FR-12\` | Jump-to-Page | **met** | 5/5 | 0 | — |\n${MARK_END}`],
    ['a roadmap with no generated block', base, anchors, 'carries no FR-EVIDENCE status block', 'nothing here'],
  ];

  let failures = 0;
  for (const [name, register, matrixAnchors, expected, roadmapText] of cases) {
    const found = audit(register, prd, matrixAnchors, roadmapText).problems.some((p) => p.includes(expected));
    console.log(`  ${found ? 'ok  ' : 'FAIL'} ${name}`);
    if (!found) failures += 1;
  }
  const roadmapCurrent = [
    'before',
    renderStatusTable({ requirements: { 'FR-12': sound } }),
    'after',
  ].join('\n');
  const soundProblems = audit(base, new Map([['FR-12', { title: 'jump-to-page', clause: 'x' }]]), anchors, roadmapCurrent).problems;
  console.log(
    `  ${soundProblems.length === 0 ? 'ok  ' : 'FAIL'} a sound row produces no problems${soundProblems.length ? ` — got: ${soundProblems.join(' | ')}` : ''}`,
  );
  return failures + (soundProblems.length ? 1 : 0);
}

function main() {
  if (process.argv.includes('--selftest')) {
    console.log('check-fr-evidence self-test');
    const bad = selfTest();
    console.log(bad ? `\n${bad} self-test case(s) did not fail as intended` : '\nall self-test cases failed as intended');
    process.exit(bad ? 1 : 0);
  }

  const prdRows = readPrdRows(readFileSync(PRD, 'utf8'));
  const register = JSON.parse(readFileSync(REGISTER, 'utf8'));
  if (process.argv.includes('--emit')) {
    const emitted = audit(register, prdRows, readMatrixAnchors());
    if (emitted.problems.length) {
      console.error('refusing to emit a table the register itself does not pass');
      for (const problem of emitted.problems) console.error(`  - ${problem}`);
      process.exit(1);
    }
    emitStatusTable(register);
    return;
  }
  const report = audit(register, prdRows, readMatrixAnchors(), readFileSync(ROADMAP, 'utf8'));
  summary(report, register);

  if (report.problems.length) {
    console.error(`\nrefusing: ${report.problems.length} problem(s) in fr-evidence.json`);
    for (const problem of report.problems) console.error(`  - ${problem}`);
    process.exit(1);
  }
  console.log('\nregister is consistent with PRD.md and with the files on disk');
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main();
