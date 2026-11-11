/**
 * FR-58 / FR-52: the gate that stands between a green local run and an irreversible publish.
 *
 * §9 asks for a candidate "built and tested on a clean runner from the packed npm artifact" and for §8's browser
 * evidence to be certified. Until now the only thing guarding `npm publish` was `prepublishOnly: npm run verify` —
 * and `verify` never runs the browser matrix, which is a CI job. Measured on 2026-11-03: `verify` exited 0 on a
 * tree whose `Browser matrix (… 6.2.108)` cell was red on `no-uncaught-errors`. A gate that cannot see the thing
 * it is supposed to refuse is not a gate, so this file reads four sources the publish cannot fake:
 *
 *   1. the CI run for the commit the tag names — every required job `success`, and the matrix cells present;
 *   2. `release/last-candidate*.json` — records for this version and that commit, of which **at least one must
 *      have every leg `success`** and carry an artifact digest. A `skipped` leg is never a pass: it is allowed
 *      only on a record that is not the certifying one, only when a green record on the same commit certifies
 *      that same leg, and it is printed with the file that does. A leg that `failure`d or was `cancelled` on any
 *      bound record is a refusal, because the artifact was tested on that runner class and broke there.
 *      This is the shape §9 asks for ("built and tested on a clean runner", singular) and the shape
 *      `publish-preflight.mjs`'s `expectedDigest` already assumed when it took the green record's digest out of
 *      rc.1's three. Requiring *every* bound record to be all-green asked for something the workflow cannot
 *      produce: `release-candidate.yml` runs the benchmark leg only on Node 22.13.0, the one CI class with an
 *      accepted entry in `benchmarks/baseline.json`, so the Node 24 record is `benchmarks: skipped` by design and
 *      no release could ever have passed. Measured 2026-11-11 with this file's own functions against the two
 *      records the workflow writes;
 *   3. the registry — the version must not already be taken, because a burned number cannot be reused;
 *   4. the tag — `v<version>` must resolve, HEAD must be that commit or a descendant of it, and between the two
 *      only `CHANGELOG.md` and `release/last-candidate*.json` may differ, because the candidate ran on the tagged
 *      commit and the record it produced can only be committed afterwards. Requiring HEAD to be exactly the tagged
 *      commit *and* the record to name HEAD asks for a commit that carries a record naming a different commit
 *      while being it; nothing satisfies both, and the gate would have refused every publish forever.
 *
 * Every reader throws rather than defaulting. A check that assumes success when its source is missing is how
 * `check:docs`' floor rule stayed green after §8's row was renamed (#322, same day).
 *
 * Usage: npm run release:validate   (or: node scripts/release-validate.mjs [--sha=<sha>] [--offline])
 * `--offline` prints what would be consulted and exits 1 — it exists for the counterfactuals in
 * `src/lib/release-gate.test.ts`, never as a publish path.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = join(dirname(fileURLToPath(import.meta.url)), '..');
const REGISTRY = 'https://registry.npmjs.org';

/**
 * The jobs a publish may not proceed without, by name prefix, with the minimum count of each. The counts are the
 * matrix sizes, so a workflow edit that drops an engine cell reddens the test that ties them together rather than
 * quietly weakening this gate.
 */
export const REQUIRED_JOBS = [
  { prefix: 'Verify (Node ', label: 'Verify', matrix: 'node', atLeast: 3 },
  { prefix: 'Browser matrix (', label: 'Browser matrix', matrix: 'engine', atLeast: 2 },
  { prefix: 'Consumer build (', label: 'Consumer build', matrix: 'engine', atLeast: 2 },
  { prefix: 'Packaging (Node ', label: 'Packaging', matrix: 'node', atLeast: 3 },
];

/** The candidate record's own verdict: every leg `success`, or the run did not produce a passing candidate. */
export function deriveCandidatePasses(legs) {
  const notPassed = legs.filter((leg) => leg.conclusion !== 'success').map((leg) => `${leg.leg}=${leg.conclusion}`);
  return { passes: legs.length > 0 && notPassed.length === 0, notPassed };
}

/** Reads the leg list out of this repository's own writer, so the gate and the record cannot disagree. */
export function requiredLegsFrom(rcRecordSource) {
  const block = /const REQUIRED_LEGS = \[([\s\S]*?)\n\]/.exec(rcRecordSource)?.[1];
  if (!block) throw new Error('scripts/rc-record.mjs: no `const REQUIRED_LEGS = […]` to read the legs from');
  return [...block.matchAll(/'([^']+)'/g)].map((m) => m[1]);
}

export function ciProblems(jobs, sha) {
  if (!Array.isArray(jobs) || jobs.length === 0) {
    throw new Error(`no jobs returned for ${sha} — refusing to read an empty run as a green one`);
  }
  const problems = [];
  for (const { prefix, label, atLeast } of REQUIRED_JOBS) {
    const matched = jobs.filter((job) => String(job.name).startsWith(prefix));
    if (matched.length < atLeast) {
      problems.push(`${label}: the run has ${matched.length} job(s); this gate needs at least ${atLeast} — a cell that is not in the run is not a cell that passed`);
    }
    for (const job of matched) {
      if (job.status !== 'completed') problems.push(`${job.name}: status is ${job.status}, not completed`);
      else if (job.conclusion !== 'success') problems.push(`${job.name}: ${job.conclusion}`);
    }
  }
  return problems;
}

/**
 * FR-58: is this release certified by a candidate run on the tagged commit?
 *
 * One bound record must certify every leg. The others are evidence about their own runner class, and they are
 * refused for anything that means the artifact broke there — not for a leg that class was never able to run.
 */
export function candidateProblems(records, { version, sha }) {
  if (records.length === 0) {
    return ['no release/last-candidate*.json in the tree — §9 wants a run, not a memory of one'];
  }
  const wanted = `v${version}`;
  const matching = records.filter((r) => r.tag === wanted);
  if (matching.length === 0) {
    return [`no candidate record carries tag ${wanted} (found: ${[...new Set(records.map((r) => r.tag || 'none'))].join(', ')} — tag before publishing, per §9)`];
  }
  const bound = matching.filter((r) => r.commit === sha);
  if (bound.length === 0) {
    return [
      `candidate records for ${wanted} are for commit ${matching.map((r) => String(r.commit).slice(0, 7)).join(', ')} ` +
        `— not the tagged commit ${sha.slice(0, 7)} whose artifact the published bytes must be`,
    ];
  }

  const problems = [];
  const certifying = [];
  for (const record of bound) {
    const legs = record.legs ?? [];
    const absent = legs.filter((leg) => leg.conclusion === 'absent');
    const broke = legs.filter((leg) => leg.conclusion === 'failure' || leg.conclusion === 'cancelled');
    if (absent.length) {
      problems.push(`${record.file}: a leg is absent, and an absent leg reads exactly like one that passed`);
    }
    if (broke.length) {
      problems.push(
        `${record.file}: ${broke.map((leg) => `${leg.leg}=${leg.conclusion}`).join(', ')} — the artifact was tested ` +
          'on this runner class and broke there, which is not a class the release may ignore',
      );
    }
    if (!record.artifact?.sha256) problems.push(`${record.file}: no artifact digest, so the green is bound to nothing`);
    if (deriveCandidatePasses(legs).passes) certifying.push(record);
  }

  if (certifying.length === 0) {
    problems.push(
      `no candidate record for ${wanted} on ${sha.slice(0, 7)} certifies every leg — a skipped leg is not a pass, ` +
        'and §9 wants a run that passed rather than a set of runs that each declined part of it',
    );
  }
  const digests = [...new Set(certifying.map((r) => r.artifact.sha256))];
  if (digests.length > 1) {
    problems.push(`the green candidate records bind ${digests.length} different artifact digests — they are not one candidate`);
  }
  // A leg no class ran is not a leg that passed, so a skip is only lawful when a green record covers it.
  for (const { record, skipped } of skippedLegs(bound)) {
    const covered = certifying.some((c) =>
      skipped.every((name) => (c.legs ?? []).some((leg) => leg.leg === name && leg.conclusion === 'success')),
    );
    if (!covered) {
      problems.push(
        `${record.file}: ${skipped.join(', ')} skipped, and no green record on this commit certifies it — ` +
          'a leg no runner class ran is not a leg that passed',
      );
    }
  }
  return problems;
}

/** The legs each bound record declined to run, so the gate can name them and check someone else ran them. */
function skippedLegs(bound) {
  return bound
    .map((record) => ({
      record,
      skipped: (record.legs ?? []).filter((leg) => leg.conclusion === 'skipped').map((leg) => leg.leg),
    }))
    .filter((entry) => entry.skipped.length > 0);
}

/**
 * FR-58: what the green message must not let a reader assume. A class that skipped a leg is named here with the
 * record that certifies it, so "the candidate is green" never reads as "every runner class measured everything".
 */
export function candidateNotes(records, { version, sha }) {
  const bound = records.filter((r) => r.tag === `v${version}` && r.commit === sha);
  const certifying = bound.filter((r) => deriveCandidatePasses(r.legs ?? []).passes);
  return skippedLegs(bound).map(({ record, skipped }) => {
    const by = certifying.filter((c) =>
      skipped.every((name) => (c.legs ?? []).some((leg) => leg.leg === name && leg.conclusion === 'success')),
    );
    return (
      `${record.file}: ${skipped.join(', ')} not run on this class` +
      (by.length ? ` — certified by ${by.map((c) => c.file).join(', ')}` : ' — certified by no record')
    );
  });
}

export function registryProblems(packument, name, version) {
  if (packument === null) return []; // 404 from the registry: the name has never carried this version.
  const taken = Object.keys(packument.versions ?? {}).includes(version);
  const problems = [];
  if (taken) problems.push(`${name}@${version} is already on the registry — version numbers are burned permanently`);
  if (packument['dist-tags']?.latest === version) problems.push(`dist-tags.latest is already ${version}`);
  return problems;
}

/**
 * The one order the release can actually happen in — found by walking it, not by testing the rules one at a time.
 *
 * A candidate record is produced by a run, so it can only be committed *after* the commit that run tested; and
 * the tag has to name the tested commit, because that is the state whose artifact digest the record carries. The
 * published tree is therefore the tagged commit plus the record. Requiring HEAD to be exactly the tagged commit
 * *and* the record to name HEAD asks for a commit that contains a record naming a different commit while also
 * being that other commit — nothing satisfies both, and the suite missed it while each rule passed alone.
 *
 * So: the tag must resolve, HEAD must be that commit or a descendant of it, and what may differ between the two
 * is the release evidence and nothing else. `changed === null` means git could not name the range at all, which is
 * a refusal, not an empty diff.
 */
export function releaseOrderProblems({ tagName, taggedSha, headSha, changed }) {
  if (!taggedSha) {
    return [`no tag ${tagName} resolves in this repository — tag the tested candidate first (§9: tag, then publish, never the reverse)`];
  }
  if (changed === null) {
    return [
      `HEAD (${headSha.slice(0, 7)}) is not the tagged commit (${taggedSha.slice(0, 7)}) or a descendant of it, ` +
        'so nothing can say the tree being published is the tree that was tested',
    ];
  }
  const beyond = changed.filter((path) => !RELEASE_EVIDENCE.test(path));
  if (beyond.length) {
    return [
      `${tagName} (${taggedSha.slice(0, 7)})..HEAD changes ${beyond.length} file(s) beyond the release evidence ` +
        `(${beyond.slice(0, 4).join(', ')}${beyond.length > 4 ? ', …' : ''}) — the candidate ran on the tagged commit, ` +
        'so either re-run it or tag the commit this tree is',
    ];
  }
  return [];
}

/** The only paths a commit after the tag may touch: the record the candidate produced, and the release notes. */
export const RELEASE_EVIDENCE = /^(CHANGELOG\.md|release\/last-candidate[^/]*\.json)$/;

/** Everything the real command consults, in one object, so the tests can hand in fakes instead of a network. */
export function realDeps() {
  return {
    headSha: () => execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repo, encoding: 'utf8' }).trim(),
    /** Where the tag actually points. An absent tag is `''`, which the release-order rule refuses. */
    tagCommit: (tagName) => {
      try {
        return execFileSync('git', ['rev-parse', '--verify', '--quiet', `${tagName}^{commit}`], {
          cwd: repo,
          encoding: 'utf8',
          stdio: ['ignore', 'pipe', 'ignore'],
        }).trim();
      } catch {
        return '';
      }
    },
    /**
     * What changed between the tagged commit and HEAD. `git diff --name-only A..B` fails when B is not a
     * descendant of A, and that failure *is* the finding, so it returns null rather than an empty list — an
     * unreadable range must never be read as "nothing changed".
     */
    changedBetween: (from, to) => {
      try {
        return execFileSync('git', ['diff', '--name-only', `${from}..${to}`], {
          cwd: repo,
          encoding: 'utf8',
          stdio: ['ignore', 'pipe', 'ignore'],
        })
          .split('\n')
          .filter(Boolean);
      } catch {
        return null;
      }
    },
    jobs: async (sha) => {
      const owner = JSON.parse(readFileSync(join(repo, 'package.json'), 'utf8')).repository?.url
        ?.match(/github\.com\/([^/]+\/[^/.]+)/)?.[1];
      if (!owner) throw new Error('package.json has no github repository url to ask about runs');
      const out = execFileSync('gh', ['api', `repos/${owner}/commits/${sha}/check-runs`, '--jq', '.check_runs'], {
        cwd: repo,
        encoding: 'utf8',
        maxBuffer: 8 * 1024 * 1024,
      });
      return JSON.parse(out).map((run) => ({ name: run.name, status: run.status, conclusion: run.conclusion ?? 'none' }));
    },
    packument: async (name) => {
      const res = await fetch(`${REGISTRY}/${name.replace('/', '%2f')}`);
      if (res.status === 404) return null;
      if (!res.ok) throw new Error(`registry answered ${res.status} for ${name} — not read as "free"`);
      return res.json();
    },
    records: () =>
      readdirSync(join(repo, 'release'))
        .filter((f) => /^last-candidate.*\.json$/.test(f))
        .map((f) => ({ file: `release/${f}`, ...JSON.parse(readFileSync(join(repo, 'release', f), 'utf8')) })),
  };
}

export async function main(deps, argv = []) {
  const pkg = JSON.parse(readFileSync(join(repo, 'package.json'), 'utf8'));
  const shaArg = argv.find((a) => a.startsWith('--sha='))?.slice(6);
  const sha = shaArg || deps.headSha();
  const problems = [];
  const notes = [];

  if (argv.includes('--offline')) {
    console.error('FAIL  release:validate ran --offline: the CI run, the candidate record and the registry were not consulted.');
    console.error('      --offline exists to prove this gate refuses without its sources; it is not a publish path.');
    return 1;
  }

  const tagName = `v${pkg.version}`;
  let taggedSha = '';
  let changed = null;
  try {
    taggedSha = deps.tagCommit(tagName);
    changed = taggedSha ? deps.changedBetween(taggedSha, sha) : [];
  } catch (error) {
    problems.push(`git could not answer where ${tagName} points: ${String(error.message ?? error).slice(0, 120)}`);
  }
  problems.push(...releaseOrderProblems({ tagName, taggedSha, headSha: sha, changed }));

  // Everything below is read from the commit that was actually built and tested — the tagged one, not the commit
  // that carries the record of that run.
  const tested = taggedSha || sha;

  try {
    const jobs = await deps.jobs(tested);
    problems.push(...ciProblems(jobs, tested));
    notes.push(`CI on ${tested.slice(0, 7)} (${tested === sha ? 'HEAD' : tagName}): ${jobs.filter((j) => j.conclusion === 'success').length}/${jobs.length} jobs success`);
  } catch (error) {
    problems.push(`could not read the CI run for ${tested.slice(0, 7)}: ${String(error.message ?? error).slice(0, 160)}`);
  }

  try {
    const records = deps.records();
    problems.push(...candidateProblems(records, { version: pkg.version, sha: tested }));
    notes.push(...candidateNotes(records, { version: pkg.version, sha: tested }));
  } catch (error) {
    problems.push(`could not read release/last-candidate*.json: ${String(error.message ?? error).slice(0, 160)}`);
  }

  try {
    problems.push(...registryProblems(await deps.packument(pkg.name), pkg.name, pkg.version));
  } catch (error) {
    problems.push(`could not read the registry for ${pkg.name}: ${String(error.message ?? error).slice(0, 160)}`);
  }

  for (const note of notes) console.log(`  ok    ${note}`);
  if (problems.length) {
    console.error(`FAIL  release:validate refused ${pkg.name}@${pkg.version}:`);
    for (const problem of problems) console.error(`  - ${problem}`);
    console.error('Refusing means the publish did not happen; nothing was written anywhere.');
    return 1;
  }
  const where = tested === sha ? `tagged at ${sha.slice(0, 7)} (HEAD)` : `tagged at ${tested.slice(0, 7)}, with HEAD adding only the release evidence`;
  console.log(
    `release:validate green — ${pkg.name}@${pkg.version} is ${where}; every required job passed on the tested ` +
      'commit, a candidate record certifies every leg there with a digest, and the registry does not carry this version.',
  );
  console.log('This validates the state. It does not sign §9, and it does not publish: both stay a person’s act.');
  return 0;
}

// Measured the hard way on 2026-11-03: the first version normalised separators here, and on Windows
// `fileURLToPath` keeps backslashes — so the comparison never matched, `node scripts/release-validate.mjs`
// imported the module, ran nothing, and exited 0. A publish gate that silently declines to run is worse than
// one that refuses, so this is the house idiom (`check-maturity.mjs`, `check-fr-evidence.mjs`) and
// `src/lib/release-gate.test.ts` spawns the real CLI to prove it speaks.
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  process.exitCode = await main(realDeps(), process.argv.slice(2));
}
