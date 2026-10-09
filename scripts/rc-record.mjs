/**
 * FR-58: the release-candidate record, written from a run rather than retyped after one.
 *
 * §9 asks for two things this repository has kept failing to produce: a candidate "built and tested on a clean
 * runner from the packed npm artifact", and evidence that "is recorded with its environment, operator and date".
 * The axe and benchmark records already work that way (#252, #275) — a command writes a file, and a test reads the
 * file back and refuses it when it claims more than the run measured. This is the same shape applied to the
 * release chain: the workflow that runs the legs passes each leg's conclusion in, and this file is what a later
 * reader can cite instead of a sentence in a changelog that was true of some run.
 *
 * What it refuses, and why:
 *   - a required leg missing entirely, because an absent leg reads like a leg that passed;
 *   - a leg reported `success` with no run id or no artifact digest to bind it to, because a green with nothing
 *     behind it is the exact thing §8's execution policy was written against;
 *   - any attempt to record the candidate as *certified*: signing §9 is the owner's act, and a script that could
 *     write that word would eventually do it by accident.
 *
 * Usage (from the release-candidate workflow):
 *   node scripts/rc-record.mjs --tag=<ref> --out=release/last-candidate.json \
 *     --leg=esm-cjs-resolution:success --leg=upgrade-path:success …
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = join(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const flag = (name, fallback = '') => {
  const inline = args.find((a) => a.startsWith(`--${name}=`));
  return inline ? inline.slice(name.length + 3) : fallback;
};

/**
 * Every leg §9 requires of a candidate, in the order the workflow runs them.
 *
 * One leg per step that can actually be run, because a required leg nothing produces is worse than a short list:
 * the record would be red forever, and a permanently red gate is a gate nobody reads. `verify-chain` is the whole
 * of `npm run verify` on the checked-out tree; `packed-artifact-contract` is FR-41's proof over the tarball
 * (install, `require`/`import` parity, declarations in both module modes); `examples-compile` is §5.6's;
 * `upgrade-path` is FR-58's own clause about the previous public release; `browser-matrix-from-artifact` is §8's
 * rows driven against `dist/` rather than `src/` — the copy a consumer installs — and the last two are the
 * reproducible records.
 *
 * The React and engine axes are deliberately **not** legs here. §9 wants them covered at the candidate, and they
 * are: `ci.yml` triggers on the same tag (#272 added `tags: ['v*']` for exactly this), so `react` and `consumer`
 * run against the commit this record names, and `record.run.commit` is how a reader finds those runs. A leg that
 * this job cannot execute is not a leg to fake a conclusion for — it is a pointer and a sentence in §9.
 */
const REQUIRED_LEGS = [
  'verify-chain',
  'packed-artifact-contract',
  'examples-compile',
  'upgrade-path',
  'browser-matrix-from-artifact',
  'accessibility-audit',
  'benchmarks',
];

const legs = new Map();
for (const pair of args.filter((a) => a.startsWith('--leg=')).map((a) => a.slice(6))) {
  const at = pair.lastIndexOf(':');
  if (at === -1) {
    console.error(`FAIL  --leg=${pair} has no ':conclusion' suffix — every leg must say what its step did`);
    process.exit(2);
  }
  legs.set(pair.slice(0, at), pair.slice(at + 1));
}

/*
 * An empty environment variable and an absent one are the same thing to a record: the fields below are
 * identity, and a runner that exports GITHUB_SHA= would otherwise fill the record with a value that looks set
 * and is nothing. CI run 37894860342 made the difference observable — a test that blanked these variables read
 * `runner: ''` where a local shell read `unknown`, so the same script wrote two different records.
 */
const env = (name) => process.env[name] || '';
const runId = flag('run-id', env('GITHUB_RUN_ID'));
const artifact = flag('artifact', '');
const sha256 = flag('sha256', '');
const problems = [];

for (const leg of REQUIRED_LEGS) {
  if (!legs.has(leg)) problems.push(`leg ${leg} is absent — a missing leg reads exactly like a passing one`);
}
for (const [leg, conclusion] of legs) {
  if (!REQUIRED_LEGS.includes(leg)) problems.push(`leg ${leg} is not in the required set — fix the list, do not add legs to a record`);
  if (!['success', 'failure', 'cancelled', 'skipped'].includes(conclusion)) {
    problems.push(`leg ${leg} reports '${conclusion}', which is not a step conclusion`);
  }
  if (conclusion === 'success' && !runId) {
    problems.push('a leg is claimed success with no run id to bind it to a runner');
  }
}
if (!artifact || !sha256) {
  problems.push('the record names no artifact or its digest — FR-58 is about the packed artifact, not the working tree');
}
if (flag('certified')) problems.push('--certified is not an option: §9 is signed by a person, not by a job');

/**
 * Linux has `/proc`; a developer on Windows or macOS does not, and this file has to be runnable there too — the
 * record's shape is guarded by `npm test`, which runs on the dev machine. A missing fact is `null` in the record
 * rather than a crash, and the writer never invents one.
 */
const readOr = (file) => {
  try {
    return readFileSync(file, 'utf8');
  } catch {
    return '';
  }
};
const memoryGb = Number(
  (readOr('/proc/meminfo').match(/MemTotal:\s+(\d+)/)?.[1] ?? 0) / 1024 / 1024,
);

const record = {
  schema: 'pjsr/release-candidate@1',
  generatedAt: new Date().toISOString(),
  tag: flag('tag', env('GITHUB_REF_NAME')),
  commit: flag('commit', env('GITHUB_SHA')),
  run: { id: runId, url: env('GITHUB_SERVER_URL') ? `${env('GITHUB_SERVER_URL')}/${env('GITHUB_REPOSITORY')}/actions/runs/${runId}` : '' },
  environment: {
    runner: env('RUNNER_NAME') || 'unknown',
    platform: `${process.platform} ${process.arch}`,
    osRelease: readOr('/etc/os-release').match(/PRETTY_NAME="([^"]+)"/)?.[1] ?? '',
    cpu: (readOr('/proc/cpuinfo').match(/^model name\s*:\s*(.+)$/m)?.[1] ?? 'unknown').trim(),
    memoryGb: Number.isFinite(memoryGb) && memoryGb > 0 ? Math.round(memoryGb * 10) / 10 : null,
    node: process.versions.node,
  },
  artifact: { file: artifact, sha256 },
  // FR-58's clause (b): the candidate must cover the supported contract, so the versions it was covered *at* are
  // part of the record rather than something a reader infers from the date.
  peers: {
    react: JSON.parse(readFileSync(join(repo, 'package.json'), 'utf8')).peerDependencies.react,
    'pdfjs-dist': JSON.parse(readFileSync(join(repo, 'node_modules', 'pdfjs-dist', 'package.json'), 'utf8')).version,
  },
  legs: REQUIRED_LEGS.map((leg) => ({ leg, conclusion: legs.get(leg) ?? 'absent' })),
  // The one word this script cannot write. §9's gate is signed by the owner; a record that could say `certified`
  // would, one day, be mistaken for the signature.
  certification: 'not certified — §9 is a human gate; see PRD.md §9 and ROADMAP.md W9',
};

if (problems.length) {
  console.error('FAIL  refusing to write a release-candidate record:');
  for (const p of problems) console.error(`  - ${p}`);
  process.exit(2);
}

const out = flag('out', 'release/last-candidate.json');
mkdirSync(dirname(join(repo, out)), { recursive: true });
writeFileSync(join(repo, out), `${JSON.stringify(record, null, 2)}\n`);
const failed = record.legs.filter((l) => l.conclusion !== 'success').map((l) => `${l.leg}=${l.conclusion}`);
console.log(
  `wrote ${out}: ${record.legs.length} legs against ${record.artifact.file} (${record.artifact.sha256.slice(0, 12)}…) ` +
    `on ${record.environment.runner} · node ${record.environment.node} — ${failed.length ? `${failed.length} not green: ${failed.join(', ')}` : 'all green'}`,
);
console.log('the record is evidence about a run, not a certification; §9 stays unsigned until a person signs it.');
