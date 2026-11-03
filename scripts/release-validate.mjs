/**
 * FR-58 / FR-52: the gate that stands between a green local run and an irreversible publish.
 *
 * §9 asks for a candidate "built and tested on a clean runner from the packed npm artifact" and for §8's browser
 * evidence to be certified. Until now the only thing guarding `npm publish` was `prepublishOnly: npm run verify` —
 * and `verify` never runs the browser matrix, which is a CI job. Measured on 2026-11-03: `verify` exited 0 on a
 * tree whose `Browser matrix (… 6.2.108)` cell was red on `no-uncaught-errors`. A gate that cannot see the thing
 * it is supposed to refuse is not a gate, so this file reads four sources the publish cannot fake:
 *
 *   1. the CI run for the exact SHA being published — every required job `success`, and the matrix cells present;
 *   2. `release/last-candidate*.json` — a record for this version and commit whose legs are **all** `success`;
 *      a `skipped` leg is not a pass (the committed rc.1 record has `benchmarks: skipped` on its Node 24 cell);
 *   3. the registry — the version must not already be taken, because a burned number cannot be reused;
 *   4. the tag — HEAD must *be* `v<version>`, so the published bytes have a name that can be cited later.
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

export function candidateProblems(records, { version, sha }) {
  if (records.length === 0) {
    return ['no release/last-candidate*.json in the tree — §9 wants a run, not a memory of one'];
  }
  const wanted = `v${version}`;
  const matching = records.filter((r) => r.tag === wanted);
  if (matching.length === 0) {
    return [`no candidate record carries tag ${wanted} (found: ${[...new Set(records.map((r) => r.tag || 'none'))].join(', ')} — tag before publishing, per §9]`];
  }
  const problems = [];
  const bound = matching.filter((r) => r.commit === sha);
  if (bound.length === 0) {
    problems.push(`candidate records for ${wanted} are for commit ${matching.map((r) => String(r.commit).slice(0, 7)).join(', ')} — not the ${sha.slice(0, 7)} being published`);
  }
  for (const record of bound) {
    const legs = record.legs ?? [];
    if (legs.some((leg) => leg.conclusion === 'absent')) {
      problems.push(`${record.file}: a leg is absent, and an absent leg reads exactly like one that passed`);
    }
    const { passes, notPassed } = deriveCandidatePasses(legs);
    if (!passes) problems.push(`${record.file}: not green — ${notPassed.join(', ')} (a skipped leg is not a pass)`);
    if (!record.artifact?.sha256) problems.push(`${record.file}: no artifact digest, so the green is bound to nothing`);
  }
  return problems;
}

export function registryProblems(packument, name, version) {
  if (packument === null) return []; // 404 from the registry: the name has never carried this version.
  const taken = Object.keys(packument.versions ?? {}).includes(version);
  const problems = [];
  if (taken) problems.push(`${name}@${version} is already on the registry — version numbers are burned permanently`);
  if (packument['dist-tags']?.latest === version) problems.push(`dist-tags.latest is already ${version}`);
  return problems;
}

export function tagProblems(described, version) {
  const wanted = `v${version}`;
  return described === wanted ? [] : [`HEAD is ${described || '(untagged)'}, not ${wanted} — publish the tagged state, and nothing after it`];
}

/** Everything the real command consults, in one object, so the tests can hand in fakes instead of a network. */
export function realDeps() {
  return {
    headSha: () => execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repo, encoding: 'utf8' }).trim(),
    tagOfHead: () => {
      try {
        return execFileSync('git', ['describe', '--tags', '--exact-match', 'HEAD'], {
          cwd: repo,
          encoding: 'utf8',
          // An untagged HEAD is a finding this script reports in its own words; git's `fatal:` line on stderr
          // would only make the refusal look like a crash.
          stdio: ['ignore', 'pipe', 'ignore'],
        }).trim();
      } catch {
        return '';
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

  let described = '';
  try {
    described = deps.tagOfHead();
  } catch (error) {
    problems.push(`git describe failed: ${String(error).slice(0, 120)}`);
  }
  problems.push(...tagProblems(described, pkg.version));

  try {
    const jobs = await deps.jobs(sha);
    problems.push(...ciProblems(jobs, sha));
    notes.push(`CI on ${sha.slice(0, 7)}: ${jobs.filter((j) => j.conclusion === 'success').length}/${jobs.length} jobs success`);
  } catch (error) {
    problems.push(`could not read the CI run for ${sha.slice(0, 7)}: ${String(error.message ?? error).slice(0, 160)}`);
  }

  try {
    problems.push(...candidateProblems(deps.records(), { version: pkg.version, sha }));
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
  console.log(
    `release:validate green — ${pkg.name}@${pkg.version} is tagged as ${described}, every required job passed on ${sha.slice(0, 7)}, ` +
      'the candidate record is all-green with a digest, and the registry does not carry this version.',
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
