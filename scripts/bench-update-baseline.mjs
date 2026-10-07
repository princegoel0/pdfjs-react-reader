/**
 * FR-49: accept a benchmark run into the regression baseline.
 *
 * `npm run bench` measures and compares. This is the other half, and it is deliberately a separate command:
 * the readings in `benchmarks/baseline.json` are what every later run — locally and in CI — is checked against,
 * so writing one is a decision, not a side effect of having run something.
 *
 * It takes the record `npm run bench` last wrote (`benchmarks/latest.json`), folds it into the entry for *that
 * run's* environment, and prints what each leg's tolerance became. Legs that sample fewer times than
 * `GATE.minimumSamples` are skipped and named — profile D measures its cold page once, so there is no median
 * to accept and no number in the baseline that can be raised to hide that. It refuses, and writes nothing,
 * when:
 *
 *  - the recorded run has a broken bar — a run that failed a structural property is not evidence of a timing;
 *  - a leg's own gate reports this run as a regression — absorbing the number that just missed the tolerance
 *    would be raising the ceiling to hide a fact, which is exactly what §6's rule forbids. `--force` overrides
 *    both and prints what it moved, because sometimes the change is the point (a fixture got bigger, an engine
 *    got faster) and a human should be able to say so out loud.
 *
 * Usage: `npm run bench` then `npm run bench:update-baseline [--force] [--record <path>]`.
 *
 * `--record` folds a record other than the file on disk — the one thing that makes a *runner's* baseline
 * acceptable from here, since `mergeRecord` keys the entry on the record's own environment block, not on the
 * machine running the command. The runner uploads `benchmarks/latest.json` as an artifact (`.github/workflows/
 * ci.yml`), and downloading it and folding it is the deliberate act; CI never writes the file itself.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { BASELINE_HEADER, GATE, entryState, fingerprint, mergeRecord } from './benchmark-baseline.mjs';

const repo = join(dirname(fileURLToPath(import.meta.url)), '..');
const flag = (name) => {
  const at = process.argv.indexOf(name);
  return at < 0 ? null : process.argv[at + 1];
};
const recordPath = flag('--record') ? resolve(flag('--record')) : join(repo, 'benchmarks', 'latest.json');
const baselinePath = join(repo, 'benchmarks', 'baseline.json');

const record = JSON.parse(readFileSync(recordPath, 'utf8'));
const broken = record.profiles.flatMap((p) => p.bars.filter((b) => !b.ok).map((b) => `${p.id}: ${b.label} — ${b.detail}`));
if (broken.length && !process.argv.includes('--force')) {
  console.error(
    `the recorded run has ${broken.length} broken bar(s), and a run that failed a structural property is not evidence about a timing:\n  ${broken.join('\n  ')}`,
  );
  process.exit(1);
}

let baseline = BASELINE_HEADER();
try {
  baseline = JSON.parse(readFileSync(baselinePath, 'utf8'));
} catch {
  console.log(`benchmarks/baseline.json does not exist yet — starting it from the header, with ${GATE.minimumReadings} readings required before any leg can fail a job.`);
}

const before = new Map(
  Object.entries(baseline.environments?.[fingerprint(record.environment)]?.entries ?? {}).map(([k, v]) => [k, entryState(v)]),
);
const { baseline: next, key, added, refused, skipped } = mergeRecord({
  baseline,
  record,
  force: process.argv.includes('--force'),
});

console.log(`environment: ${key}`);
for (const { label, state, readings } of added) {
  const was = before.get(label);
  const moved = was?.live && state.live && was.tolerance !== state.tolerance ? ` (tolerance ×${was.tolerance} → ×${state.tolerance})` : '';
  console.log(`  accepted  ${label.padEnd(52)} ${readings} reading(s)  status ${state.live ? 'live' : state.blind ? 'BLIND' : 'provisional'}  reference ${state.reference ?? '—'}  tolerance ${state.tolerance ?? '—'}${moved}`);
}
for (const { label, why } of skipped) console.log(`  skipped   ${label.padEnd(52)} ${why}`);
for (const { label, why } of refused) console.log(`  REFUSED   ${label.padEnd(52)} ${why}`);

if (refused.length && !process.argv.includes('--force')) {
  console.error(
    `\nnothing was written: ${refused.length} leg(s) refused. Fix the regression, or run with --force to accept it and say so in the commit message.`,
  );
  process.exit(1);
}

writeFileSync(baselinePath, `${JSON.stringify(next, null, 2)}\n`);
const legs = Object.values(next.environments?.[key]?.entries ?? {});
console.log(
  `\nwrote benchmarks/baseline.json — ${Object.keys(next.environments ?? {}).length} environment(s), ${legs.length} leg(s) for this one, ` +
    `${legs.filter((e) => e.status === 'live').length} of them able to fail a job. Committing that change is the decision.`,
);
