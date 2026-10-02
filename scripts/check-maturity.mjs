/**
 * FR-50: every public name carries a maturity tag, and a name that is exported and untagged fails the
 * build.
 *
 * The requirement's whole content is the second half of that sentence. A stability policy written as prose
 * describes the surface it was written against and then rots, because the surface moves and the prose does
 * not; the promise a consumer reads ("this name will not break in a minor") is only worth anything if the
 * set of names making it is recomputed from the artifact on every build. So `api-maturity.json` is the
 * published surface, `api-names.mjs` reads the published surface out of `dist/`, and this file is the
 * difference between them — which is the thing that would otherwise be discovered by a consumer.
 *
 * Four states, from `PRD.md` §5.5: `stable`, `experimental`, `internal`, `deprecated`. Two of the rules are
 * worth stating because they are not obvious and each one caught something during the first pass:
 *
 *  - `internal` is rejected on a name that *is* reachable. Internal is the state for what a published entry
 *    point does not expose, so a file listing it under a published name is a contradiction, not a tag.
 *  - a non-`stable` name must carry a note, and a `stable` name must not. The note is the reason a consumer
 *    would need before relying on the name; an untagged-by-omission "experimental" with nothing behind it
 *    is how a temporary state becomes permanent.
 *
 * It also runs itself against six synthetic violations (`--no-selftest` turns that off), because a check
 * that has never seen a bad input is a check nobody has proved.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { publishedNames } from './api-names.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const STATES = ['stable', 'experimental', 'internal', 'deprecated'];

/** The shortest note worth reading. Below this the "reason" is a shrug. */
const MIN_NOTE = 40;

/**
 * Compare a manifest against a published surface. Pure, so the self-test can feed it violations the real
 * build has none of.
 *
 * @param {{entries: Record<string, {name: string}[]>, missing: string[]}} published
 * @param {{states: string[], tags: Record<string, string>, notes: Record<string, string>}} manifest
 * @returns {string[]} one line per problem, empty when the two agree
 */
export function audit(published, manifest) {
  const problems = [];
  const names = new Set();
  for (const [entry, list] of Object.entries(published.entries)) {
    for (const { name } of list) names.add(name);
    if (list.length === 0) problems.push(`${entry} published no names at all — was the build run?`);
  }
  for (const file of published.missing) problems.push(`declaration file missing from the build: ${file}`);

  if (JSON.stringify([...manifest.states].sort()) !== JSON.stringify([...STATES].sort())) {
    problems.push(`the manifest's state list is [${manifest.states.join(', ')}], not the four of §5.5`);
  }

  for (const name of names) {
    const tag = manifest.tags[name];
    if (tag === undefined) {
      problems.push(`${name} is exported and untagged`);
      continue;
    }
    if (!STATES.includes(tag)) problems.push(`${name} has the state "${tag}", which §5.5 does not define`);
    if (tag === 'internal') problems.push(`${name} is tagged internal but is reachable from a published entry`);
    const note = manifest.notes[name];
    // `internal` is rejected above, so it is not also asked for a reason: the contradiction is the finding.
    if (tag !== 'stable' && tag !== 'internal' && !(note ?? '').trim()) {
      problems.push(`${name} is ${tag} with no note saying why`);
    }
    if (tag !== 'stable' && tag !== 'internal' && (note ?? '').trim().length < MIN_NOTE) {
      problems.push(`${name} is ${tag} and its note is under ${MIN_NOTE} characters — a reason, not a label`);
    }
  }

  for (const name of Object.keys(manifest.tags)) {
    if (!names.has(name)) problems.push(`${name} is tagged but no longer published (stale manifest)`);
  }
  for (const name of Object.keys(manifest.notes)) {
    if (manifest.tags[name] === 'stable') problems.push(`${name} is stable and so must not carry a note`);
    if (!names.has(name)) problems.push(`${name} has a note but is not published`);
  }
  return problems;
}

/** The violations the real manifest must never contain, each checked against `audit` itself. */
function selfTest() {
  const published = { entries: { 'pdfjs-react-reader': [{ name: 'A', type: false }] }, missing: [] };
  const bad = [
    ['an untagged export', { states: STATES, tags: {}, notes: {} }, 'A is exported and untagged'],
    ['a stale tag', { states: STATES, tags: { A: 'stable', Gone: 'stable' }, notes: {} }, 'Gone is tagged but no longer published'],
    ['an invented state', { states: STATES, tags: { A: 'frozen' }, notes: {} }, 'the state "frozen"'],
    ['`internal` on a published name', { states: STATES, tags: { A: 'internal' }, notes: {} }, 'tagged internal but is reachable'],
    ['an experimental name with no reason', { states: STATES, tags: { A: 'experimental' }, notes: {} }, 'is experimental with no note'],
    ['a reason too short to be one', { states: STATES, tags: { A: 'experimental' }, notes: { A: 'new' } }, 'under 40 characters'],
    ['a note on a stable name', { states: STATES, tags: { A: 'stable' }, notes: { A: 'a fine reason, long enough to satisfy the check on its own' } }, 'is stable and so must not carry a note'],
    ['a missing declaration file', { states: STATES, tags: { A: 'stable' }, notes: {} }, 'declaration file missing'],
  ];
  const failures = [];
  for (const [what, manifest, expect] of bad) {
    const input = what.includes('declaration file') ? { ...published, missing: ['dist/gone.d.ts'] } : published;
    const found = audit(input, manifest).some((line) => line.includes(expect));
    if (!found) failures.push(`the audit did not catch ${what}`);
  }
  const clean = audit(published, {
    states: STATES,
    tags: { A: 'experimental' },
    notes: { A: 'a reason long enough to clear the bar this check sets for itself.' },
  });
  if (clean.length) failures.push(`the audit flagged a sound manifest: ${clean.join('; ')}`);
  return failures;
}

/**
 * The CLI half, kept apart from `audit` so a test or a future script can import the rule without running
 * the report as a side effect of importing it.
 */
function main() {
  const manifest = JSON.parse(readFileSync(join(root, 'api-maturity.json'), 'utf8'));
  const published = publishedNames();
  const problems = audit(published, manifest);

  const tally = {};
  const seen = new Set();
  for (const list of Object.values(published.entries)) {
    for (const { name } of list) {
      if (seen.has(name)) continue;
      seen.add(name);
      const tag = manifest.tags[name] ?? 'UNTAGGED';
      tally[tag] = (tally[tag] ?? 0) + 1;
    }
  }

  console.log(
    `api-maturity.json: ${seen.size} published names — ` +
      Object.entries(tally).map(([t, n]) => `${n} ${t}`).join(', '),
  );

  if (!process.argv.includes('--no-selftest')) {
    const teeth = selfTest();
    if (teeth.length) {
      for (const line of teeth) console.error(`FAIL  the check is not a check: ${line}`);
      process.exit(1);
    }
    console.log('  ok    9 synthetic violations and 1 sound manifest, all classified correctly');
  }

  if (problems.length) {
    for (const line of problems) console.error(`FAIL  ${line}`);
    console.error(`\nFR-50 is not met: ${problems.length} problem(s) between the built surface and the manifest.`);
    process.exit(1);
  }

  const movable = [...seen].filter((name) => manifest.tags[name] !== 'stable').length;
  console.log(
    `  ok    every published name tagged, no stale tags, every non-stable name with a reason` +
      ` (${movable} names this package may still change in a minor)`,
  );
}

// Only when run as a command, not when imported for `audit`.
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main();
