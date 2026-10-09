/*
 * FR-45's fourth evidence leg: the screen-reader pass, as a file that cannot flatter itself.
 *
 * FR-45 splits its evidence four ways — automated axe and DOM assertions, browser keyboard and forced-colour
 * checks, geometry checks for touch targets, and a documented screen-reader pass — and says in its own last
 * sentence that "automated audit alone is not treated as proof of full conformance". Three of the four legs are
 * now records something writes (`a11y/latest.json`, `a11y/browser.json`, the browser matrix's rows). The fourth
 * existed only as a gap: NVDA+Firefox, JAWS+Chromium and VoiceOver+Safari had no environment, no job, no
 * operator log and no dated record.
 *
 * So the *container* is built here and the sessions are not, because a session cannot be scripted on a host
 * that has none of the three readers, and an evidence file that invents one is worse than no file: it turns a
 * missing test into a documented pass. The rules this script keeps to itself are all refusals:
 *
 *  - **a pairing comes from `PRD.md`, not from a list typed here.** The three pairings and the six tasks are
 *    read out of FR-45's own clause, and a wording the script cannot parse is an error rather than a silent
 *    narrower record. If the clause changes, this script has to be told — that is the point.
 *  - **a `pass` is unrecordable without a person, a date, a named environment, and all six tasks ticked.** An
 *    operator called "qa", a date in the future, or a pass that exercised four of six things is refused.
 *  - **every `pass` names an artifact that exists.** A pass with an `--evidence` path that is not on disk is a
 *    sentence, not a witness, so `--check` fails it too, on a checkout, years later.
 *  - **`not-run` carries the blocker.** The status is only honest next to the reason, so a row without one is
 *    refused, and the reason names the missing thing (an AT install, a macOS runner, a real device) rather
 *    than "not yet".
 *  - **nothing here certifies the release.** §9 is signed by a person. This file is the log the signature is
 *    written against, and `--check` is what a guard runs.
 *
 * Usage:
 *   node scripts/a11y-certify.mjs                      # print the required pairings and today's statuses
 *   node scripts/a11y-certify.mjs --check               # validate a11y/certifications.json (what the test calls)
 *   node scripts/a11y-certify.mjs --pairing=NVDA+Firefox --status=pass \
 *     --operator="…" --date=2026-11-02 --environment="…" --tasks=loading,navigation,search,forms,annotations,tagged-structure \
 *     --evidence=path/to/log
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
/*
 * `--file=` exists so the refusals can be driven against a scratch copy. A guard that can only be demonstrated
 * by editing the committed record is a guard that has never been demonstrated, and this repository has been
 * fooled often enough by a check that passed while its input was untouched.
 */
const arg0 = flags(process.argv.slice(2));
const OUT =
  typeof arg0.file === 'string' && isAbsolute(arg0.file)
    ? arg0.file
    : arg0.file
      ? join(root, String(arg0.file))
      : join(root, 'a11y', 'certifications.json');
const PRD = join(root, 'PRD.md');
const STATUSES = ['pass', 'fail', 'not-run'];

/**
 * FR-45's clause is the only source for what a "release pass" means. Read from the row's table cell so a PRD
 * edit that changes the pairings or the tasks moves this script's requirements with it — and a wording it can
 * no longer parse stops the run rather than quietly recording a shorter list.
 */
export function requiredPass(prdText = readFileSync(PRD, 'utf8')) {
  const row = prdText.split('\n').find((line) => line.startsWith('| **FR-45** |'));
  if (!row) throw new Error('FR-45 is not a table row in PRD.md — refusing to guess what the pass covers');
  const pairingSentence = /The required release pass covers ([^;]+);/.exec(row)?.[1];
  const taskSentence = /each pair must exercise ([^;.]+)/.exec(row)?.[1];
  if (!pairingSentence || !taskSentence) {
    throw new Error(
      `FR-45's clause no longer says what the pass covers ("${(pairingSentence ?? '(none)').slice(0, 40)}") ` +
        'or what each pair must exercise — update this script in the same change as the clause',
    );
  }
  const pairings = pairingSentence
    // "NVDA with Firefox, JAWS with Chromium, and VoiceOver with Safari" -> three "reader with browser" pairs.
    .split(/,\s*(?:and\s+)?/)
    .map((part) => /^(\S+)\s+with\s+(.+)$/.exec(part.trim()))
    .filter(Boolean)
    .map((m) => ({ screenReader: m[1], browser: m[2].replace(/\.$/, '') }));
  if (pairings.length < 3) {
    throw new Error(`derived ${pairings.length} pairing(s) from FR-45 and the clause names three — the reading is wrong`);
  }
  const tasks = taskSentence
    // The clause has no Oxford comma before the last item, so a comma-only split reads "annotations and tagged
    // structure" as one task and the record silently checks five of six.
    .split(/,|\s+and\s+/)
    .map((t) => t.trim().replace(/ where applicable$/, '').replace(/\.$/, ''))
    .filter(Boolean);
  if (!tasks.length) throw new Error('FR-45 names no tasks for the pass');
  return { pairings, tasks };
}

/** Read `--flag=value` arguments. */
function flags(argv) {
  const out = {};
  for (const a of argv) {
    const m = /^--([^=]+)(?:=(.*))?$/.exec(a);
    if (m) out[m[1]] = m[2] === undefined ? true : m[2];
  }
  return out;
}

const key = (p) => `${p.screenReader}+${p.browser}`;

function load() {
  if (!existsSync(OUT)) return null;
  try {
    return JSON.parse(readFileSync(OUT, 'utf8'));
  } catch (error) {
    throw new Error(`a11y/certifications.json does not parse: ${error.message}`);
  }
}

/** The rules one row has to satisfy on its own, whether it is being written or read back. */
function rowErrors(p, tasks) {
  const errors = [];
  if (!STATUSES.includes(p.status)) errors.push(`${key(p)}: status "${p.status}" is not one of ${STATUSES.join('/')}`);
  if (!Array.isArray(p.tasks) || p.tasks.map((t) => t.name).join(',') !== tasks.join(',')) {
    errors.push(`${key(p)}: its task list is not the six FR-45 names (${tasks.join(', ')})`);
  }
  const done = (p.tasks ?? []).filter((t) => t.done).map((t) => t.name);
  if (p.status === 'not-run' && !p.blocker) {
    errors.push(`${key(p)}: a not-run row has to name the thing that is missing, not just the absence`);
  }
  if (p.status !== 'not-run') {
    if (!p.operator || /(^qa$|^team$|unknown|tbd)/i.test(p.operator ?? '')) {
      errors.push(`${key(p)}: a ${p.status} needs a person's name, and "${p.operator ?? '(none)'}" is not one`);
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(p.date ?? '')) {
      errors.push(`${key(p)}: date "${p.date ?? '(none)'}" is not an ISO day`);
    } else if (new Date(p.date) > new Date(Date.now() + 86_400_000)) {
      errors.push(`${key(p)}: ${p.date} is in the future`);
    }
    if (!p.environment || String(p.environment).length < 12) {
      errors.push(`${key(p)}: a ${p.status} has to name the environment — OS, its version, and the reader's version`);
    }
    if (done.length !== (p.tasks ?? []).length) {
      errors.push(`${key(p)}: status is ${p.status} but only ${done.length}/${(p.tasks ?? []).length} tasks were done`);
    }
    for (const e of p.evidence ?? []) {
      if (!existsSync(join(root, e))) errors.push(`${key(p)}: evidence names ${e}, which is not in the tree`);
    }
    if (!(p.evidence ?? []).length) {
      errors.push(`${key(p)}: a ${p.status} with no artifact behind it is a sentence, not a witness`);
    }
  }
  return errors;
}

/** Every refusal, in one place, so the guard can drive each of them. */
export function validate(record, { pairings, tasks }) {
  const errors = [];
  if (record?.schema !== 'pjsr/a11y-certification@1') errors.push(`schema is ${JSON.stringify(record?.schema)}`);
  const want = pairings.map(key).join(', ');
  const got = (record?.pairings ?? []).map((p) => key(p));
  if (got.join(', ') !== want) {
    errors.push(`the record's pairings are [${got.join(', ')}] and FR-45 requires [${want}]`);
  }
  for (const p of record?.pairings ?? []) errors.push(...rowErrors(p, tasks));
  return errors;
}

function print(record, required) {
  for (const p of record.pairings) {
    const detail =
      p.status === 'not-run' ? `blocked by: ${p.blocker}` : `${p.operator} on ${p.date} in ${p.environment}`;
    console.log(`  ${key(p).padEnd(20)} ${String(p.status).padEnd(8)} ${detail}`);
  }
  console.log(
    `  FR-45 requires ${required.pairings.length} pairings over ${required.tasks.length} tasks ` +
      `(${required.tasks.join(', ')}) — ${record.pairings.filter((p) => p.status === 'pass').length} recorded as pass`,
  );
}

const arg = flags(process.argv.slice(2));

if (arg.record) {
  const required = requiredPass();
  const pairing = required.pairings.find((p) => key(p) === arg.record);
  if (!pairing) {
    console.error(`--record=${arg.record} is not one of FR-45's pairings (${required.pairings.map(key).join(', ')})`);
    process.exit(2);
  }
  if (!STATUSES.includes(arg.status ?? '')) {
    console.error(`--status must be one of ${STATUSES.join('/')}, got "${arg.status ?? '(none)'}"`);
    process.exit(2);
  }
  const record = load() ?? { schema: 'pjsr/a11y-certification@1', pairings: [] };
  const tasks = required.tasks.map((name) => ({
    name,
    done: (arg.tasks ?? '').split(',').map((t) => t.trim()).includes(name),
  }));
  const row = {
    ...pairing,
    status: arg.status,
    operator: arg.operator ?? null,
    date: arg.date ?? null,
    environment: arg.environment ?? null,
    blocker: arg.blocker ?? null,
    tasks,
    evidence: (arg.evidence ?? '').split(',').map((s) => s.trim()).filter(Boolean),
  };
  record.pairings = [
    ...record.pairings.filter((p) => key(p) !== key(pairing)),
    row,
  ].sort((a, b) => required.pairings.findIndex((p) => key(p) === key(a)) - required.pairings.findIndex((p) => key(p) === key(b)));
  /*
   * Only the row being written is judged here. The set-level rule — all three pairings present — belongs to
   * `--check`, which is what the guard and a release run; refusing to write a first row would make the file
   * unbuildable, and a half-written record is caught loudly by the gate that reads it.
   */
  const errors = rowErrors(row, required.tasks);
  if (errors.length) {
    console.error('refusing to write the record:');
    for (const e of errors) console.error(`  - ${e}`);
    process.exit(2);
  }
  record.updatedBy = 'node scripts/a11y-certify.mjs --record';
  mkdirSync(dirname(OUT), { recursive: true });
  writeFileSync(OUT, `${JSON.stringify(record, null, 2)}\n`);
  console.log(`wrote ${key(row)} as ${row.status} to ${relative(root, OUT)}`);
  process.exit(0);
}

const required = requiredPass();
const record = load();
if (!record) {
  console.error(
    `no a11y/certifications.json. FR-45's pass needs ${required.pairings.length} rows (${required.pairings.map(key).join(', ')})`,
  );
  process.exit(2);
}
const errors = validate(record, required);
if (arg.check && errors.length) {
  console.error('a11y/certifications.json does not hold together:');
  for (const e of errors) console.error(`  - ${e}`);
  process.exit(1);
}
if (!arg.check) console.log(`screen-reader pass, per FR-45 (${errors.length ? 'INVALID' : 'valid'}):`);
if (!arg.check) print(record, required);
if (arg.check) console.log(`certification record is consistent with FR-45: ${record.pairings.length} pairings`);
process.exit(errors.length ? 1 : 0);
