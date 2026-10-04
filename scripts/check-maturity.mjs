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
 * A withdrawal is not an edit, and the file says so in `removed` rather than losing the name: §5.5 allows a
 * public name to leave only in a major version, and FR-18 requires that every removed name be listed in
 * `CHANGELOG.md` and have carried a tag first. So each entry keeps the tag it held, the version that dropped
 * it and the changelog section that announced it, and the audit checks all three — against the built surface
 * for the first, against the version's shape for the second, and against the text of the changelog for the
 * third. A removal that is only a deletion is the failure mode this exists for: nothing downstream can tell a
 * withdrawn name from a name that was never there.
 *
 * It also runs itself against synthetic violations, three of them about removals (`--no-selftest` turns that
 * off), because a check that has never seen a bad input is a check nobody has proved.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { publishedNames } from './api-names.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const STATES = ['stable', 'experimental', 'internal', 'deprecated'];

/** The shortest note worth reading. Below this the "reason" is a shrug. */
const MIN_NOTE = 40;

/** §5.5: a public name leaves in a major version, so the removed-in number has to look like one. */
const isMajorVersion = (version) =>
  typeof version === 'string' && /^\d+\.0\.0(?:-\d{4}-\d{2}-\d{2})?$/.test(version);

/**
 * The text of one `## [label]` section of `CHANGELOG.md`, or null when there is no such heading.
 *
 * Matching the heading rather than searching the whole file is the point: an entry that names a removed
 * export somewhere — in an unrelated "Fixed" line three releases down — has not announced it.
 */
function changelogSection(text, label) {
  if (typeof label !== 'string' || label === '') return null;
  const start = text.indexOf(`## [${label}]`);
  if (start === -1) return null;
  const next = text.indexOf('\n## ', start + 1);
  return text.slice(start, next === -1 ? text.length : next);
}

/**
 * Compare a manifest against a published surface. Pure, so the self-test can feed it violations the real
 * build has none of.
 *
 * @param {{entries: Record<string, {name: string}[]>, missing: string[]}} published
 * @param {{states: string[], tags: Record<string, string>, notes: Record<string, string>, removed?: Record<string, {tag: string, removedIn: string, announcedIn: string}>}} manifest
 * @param {string} changelog the text of `CHANGELOG.md`, which is where a removal has to be announced
 * @returns {string[]} one line per problem, empty when the two agree
 */
export function audit(published, manifest, changelog = '') {
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

  /*
   * FR-18's removal clause, stated as three questions about every name in `removed`: is it really gone, did
   * it hold a tag while it was there, and did the changelog say so. A deletion alone answers none of them,
   * which is why the ledger exists — a reader of the artifact cannot tell a withdrawn name from one that was
   * never published, and neither can a build check.
   */
  for (const [name, entry] of Object.entries(manifest.removed ?? {})) {
    if (names.has(name)) problems.push(`${name} is recorded as removed and is still published`);
    if (name in manifest.tags) {
      problems.push(`${name} is tagged and recorded as removed at the same time — one name, two states`);
    }
    if (!STATES.includes(entry?.tag)) {
      problems.push(`${name} was removed while tagged "${entry?.tag}", which §5.5 does not define`);
    }
    if (!isMajorVersion(entry?.removedIn)) {
      problems.push(
        `${name} is removed in "${entry?.removedIn}", and §5.5 lets a public name leave only in a major version`,
      );
    }
    const section = changelogSection(changelog, entry?.announcedIn);
    if (section === null) {
      problems.push(`${name} cites [${entry?.announcedIn}] as its announcement and CHANGELOG.md has no such section`);
    } else if (!section.includes(name)) {
      problems.push(`${name} is announced in [${entry?.announcedIn}] and that section does not name it`);
    }
  }
  return problems;
}

/** The violations the real manifest must never contain, each checked against `audit` itself. */
function selfTest() {
  const published = { entries: { 'pdfjs-react-reader': [{ name: 'A', type: false }] }, missing: [] };
  /*
   * A changelog with two sections, one of which names the withdrawn `Zed` and neither of which names `Gone`.
   * The removal rules read text, so the fixture has to be text and not an object.
   */
  const log =
    '## [Unreleased]\n\n- `Zed` is withdrawn here.\n\n## [1.2.0] — 2026-01-01\n\n- A line about something else.\n';
  const removed = (name, patch = {}) => ({
    [name]: { tag: 'stable', removedIn: '2.0.0', announcedIn: 'Unreleased', ...patch },
  });
  const manifest = (patch = {}) => ({ states: STATES, tags: {}, notes: {}, ...patch });
  const bad = [
    ['an untagged export', manifest({ tags: {} }), 'A is exported and untagged'],
    [
      'a stale tag',
      manifest({ tags: { A: 'stable', Gone: 'stable' } }),
      'Gone is tagged but no longer published',
    ],
    ['an invented state', manifest({ tags: { A: 'frozen' } }), 'the state "frozen"'],
    ['`internal` on a published name', manifest({ tags: { A: 'internal' } }), 'tagged internal but is reachable'],
    [
      'an experimental name with no reason',
      manifest({ tags: { A: 'experimental' } }),
      'is experimental with no note',
    ],
    [
      'a reason too short to be one',
      manifest({ tags: { A: 'experimental' }, notes: { A: 'new' } }),
      'under 40 characters',
    ],
    [
      'a note on a stable name',
      manifest({ tags: { A: 'stable' }, notes: { A: 'a fine reason, long enough to satisfy the check on its own' } }),
      'is stable and so must not carry a note',
    ],
    ['a missing declaration file', manifest({ tags: { A: 'stable' } }), 'declaration file missing'],
    [
      'a name removed and still published',
      manifest({ tags: { A: 'stable' }, removed: removed('A') }),
      'recorded as removed and is still published',
    ],
    [
      'a removal with no state behind it',
      manifest({ removed: removed('Gone', { tag: 'retired' }) }),
      'tagged "retired", which §5.5 does not define',
    ],
    [
      'a removal in a minor version',
      manifest({ removed: removed('Gone', { removedIn: '1.1.0' }) }),
      'only in a major version',
    ],
    [
      'a removal whose announcement does not name it',
      manifest({ removed: removed('Gone') }),
      'that section does not name it',
    ],
    [
      'a removal citing a section that does not exist',
      manifest({ removed: removed('Gone', { announcedIn: '0.0.0' }) }),
      'has no such section',
    ],
  ];
  const failures = [];
  for (const [what, input, expect] of bad) {
    const pub = what.includes('declaration file') ? { ...published, missing: ['dist/gone.d.ts'] } : published;
    const found = audit(pub, input, log).some((line) => line.includes(expect));
    if (!found) failures.push(`the audit did not catch ${what}`);
  }
  const clean = audit(
    published,
    manifest({
      tags: { A: 'experimental' },
      notes: { A: 'a reason long enough to clear the bar this check sets for itself.' },
      removed: removed('Zed', { tag: 'experimental' }),
    }),
    log,
  );
  if (clean.length) failures.push(`the audit flagged a sound manifest: ${clean.join('; ')}`);
  return failures;
}

/**
 * The CLI half, kept apart from `audit` so a test or a future script can import the rule without running
 * the report as a side effect of importing it.
 */
function main() {
  const manifest = JSON.parse(readFileSync(join(root, 'api-maturity.json'), 'utf8'));
  const changelog = readFileSync(join(root, 'CHANGELOG.md'), 'utf8');
  const published = publishedNames();
  const problems = audit(published, manifest, changelog);

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
      Object.entries(tally).map(([t, n]) => `${n} ${t}`).join(', ') +
      `, ${Object.keys(manifest.removed ?? {}).length} withdrawn and recorded`,
  );

  if (!process.argv.includes('--no-selftest')) {
    const teeth = selfTest();
    if (teeth.length) {
      for (const line of teeth) console.error(`FAIL  the check is not a check: ${line}`);
      process.exit(1);
    }
    console.log('  ok    13 synthetic violations and 1 sound manifest, all classified correctly');
  }

  if (problems.length) {
    for (const line of problems) console.error(`FAIL  ${line}`);
    console.error(`\nFR-50 is not met: ${problems.length} problem(s) between the built surface and the manifest.`);
    process.exit(1);
  }

  const movable = [...seen].filter((name) => manifest.tags[name] !== 'stable').length;
  console.log(
    `  ok    every published name tagged, no stale tags, every non-stable name with a reason, ` +
      `every withdrawal named in a changelog section and dated to a major` +
      ` (${movable} names this package may still change in a minor)`,
  );
}

// Only when run as a command, not when imported for `audit`.
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main();
