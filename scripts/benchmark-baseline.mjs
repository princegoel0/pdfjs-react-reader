/**
 * FR-49's regression gate: the committed baseline, and the comparison that can fail a job.
 *
 * The clause is short and it is not about fixtures: "Each profile's target is measured against its fixture in
 * CI and reported, **so a regression is a failing job rather than a slower feeling**." `scripts/benchmark.mjs`
 * already measures and reports, and its `bar` lines fail the run when a *structural* property breaks. Its
 * `measure` lines — every timing — have never been able to fail anything, so a slow-down that mounts the same
 * canvases and paints the same ink reaches no gate at all. That is the half of FR-49 this file exists to close.
 *
 * The other half of FR-49 is §6's rule about how a timing may be used, and it is the reason this is not simply
 * `if (p50 > 100) fail`:
 *
 *   "A target is not a measurement… The *requirement* is the bar; the baseline is evidence the bar is
 *    reachable, and it is never promoted into the requirement. A maximum observed on one device does not
 *    become a promise that a slower reader's machine will break."
 *
 * So the gate compares a run against **the accepted baseline for the environment it ran in, and for no other
 * environment**. This laptop's profile A number is never checked against a runner's, and a machine with no
 * accepted entry here is reported as `n/a` rather than as a pass. The environment key is the fingerprint
 * (`fingerprint` below): CPU model, OS, arch, memory, Node major and the engine version — the fields §6 names
 * as the things a baseline must be reported with, minus the two that change without anybody deciding
 * (`osRelease` and the Chromium build, which the runner image updates on its own schedule). Those two are
 * still recorded with every reading, so a reader can see what produced a number.
 *
 * Tolerance comes from measured spread, not from a mood:
 *
 *  - the reference point is the median of the accepted p50 readings for that leg;
 *  - the spread is the largest accepted p50 divided by that median — the noise this environment has actually
 *    demonstrated;
 *  - the tolerance is that spread × 1.25, held at no lower than 1.5 and no higher than 2.0.
 *
 * The floor of 1.5 is the measured runner spread plus headroom, not a guess: three CI runs of the same tree
 * gave profile A's cold-page p50 as 195/236/264 ms (max over median 1.12×), profile C's as 213/288/380 ms
 * (1.32×), C's engine-only render as 106.5/146.1/148.0 ms (1.01×) and the profile-D harness as
 * 1527/1774/2028 ms (1.14×). A gate that fired below 1.32× would be reporting the runner, not the code. The
 * ceiling of 2.0 is the honesty half: on a machine whose own noise exceeds twice its median, a p50 comparison
 * cannot distinguish a regression from a Tuesday, so the leg is marked **blind** and says so in every report
 * instead of carrying a 3× tolerance that would always pass.
 *
 * Nothing here is allowed to quietly widen itself. `scripts/bench-update-baseline.mjs` refuses to absorb a
 * reading the current gate reports as a regression unless a person passes `--force`, it prints the tolerance
 * each accepted reading moves, and once the computed tolerance crosses the ceiling the leg goes blind — which
 * is visible, rather than a ceiling somebody raised to hide a fact.
 */

export const GATE = {
  // The margin over the demonstrated spread, so a leg is not failing on the exact noise that produced its own
  // tolerance.
  safetyMargin: 1.25,
  // 1.5 because the largest run-to-run p50 spread measured anywhere in this repository's CI history is 1.32×
  // (profile C's cold page across runs 37655557527, 37537133179 and 37681492748). See the header.
  toleranceFloor: 1.5,
  // Past this the comparison proves nothing and the leg must say it cannot see a regression.
  toleranceCeiling: 2.0,
  // One accepted reading has no spread in it. Two is the minimum that can show a range.
  minimumReadings: 2,
  // A single sample has no p50 to compare: the median of one number is that number.
  minimumSamples: 3,
  // Readings older than this stop counting: an environment that has drifted is not the environment the gate
  // was tuned for, and the newest readings are the ones that describe it now.
  maximumReadings: 8,
};

const median = (values) => {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
};

/** The largest over the middle: how far this environment's own accepted numbers disagree. */
const spreadOf = (values) => {
  const middle = median(values);
  return middle > 0 ? Math.max(...values) / middle : 0;
};

const major = (version) => String(version ?? '').replace(/^v/, '').split('.')[0];

/**
 * The environment a baseline belongs to. Everything in here is a field a human would have to *decide* to
 * change; the two deliberately absent (OS build, Chromium build) are fields that change by themselves, and a
 * key including them would make every leg go blind on someone else's schedule.
 */
export function fingerprint(environment) {
  return [
    environment.machine,
    `${environment.platform} ${environment.arch}`,
    `${environment.memoryGb} GB`,
    `node ${major(environment.node)}`,
    `pdfjs-dist ${environment.engine}`,
  ].join(' · ');
}

/**
 * Whether this leg can be compared at all, and against what.
 *
 * Returns one of three shapes: `{live: true, …}` with a reference and a tolerance, `{live: false, provisional:
 * true}` when the environment has too few accepted readings, or `{live: false, blind: true}` when its own
 * demonstrated noise is wider than the ceiling allows. `provisional` and `blind` both print, and neither one
 * is a pass.
 */
export function entryState(entry) {
  const readings = entry?.readings ?? [];
  if (readings.length < GATE.minimumReadings) {
    return {
      live: false,
      provisional: true,
      blind: false,
      readings: readings.length,
      reason: `${readings.length} accepted reading${readings.length === 1 ? '' : 's'}; the gate needs ${GATE.minimumReadings} before it can tell this environment's noise from a regression`,
    };
  }
  const p50s = readings.map((r) => r.p50);
  const spread = spreadOf(p50s);
  const wanted = spread * GATE.safetyMargin;
  if (wanted > GATE.toleranceCeiling) {
    return {
      live: false,
      blind: true,
      provisional: false,
      readings: readings.length,
      spread,
      reason: `this environment's accepted p50 readings disagree by ${spread.toFixed(2)}×, past the ${GATE.toleranceCeiling}× ceiling at which a timing comparison means anything`,
    };
  }
  return {
    live: true,
    blind: false,
    provisional: false,
    readings: readings.length,
    spread,
    reference: Number(median(p50s).toFixed(1)),
    referenceP95: Number(median(readings.map((r) => r.p95)).toFixed(1)),
    tolerance: Number(Math.max(GATE.toleranceFloor, wanted).toFixed(3)),
    floored: wanted < GATE.toleranceFloor,
  };
}

/**
 * Compare one run against the accepted baseline, and return a line per measured timing.
 *
 * `profiles` is the record's `profiles` array (the same objects that go into `benchmarks/latest.json`), so the
 * gate reads exactly the numbers the run published rather than a second copy of them that could disagree.
 */
export function compareRun({ baseline, environment, profiles }) {
  const key = fingerprint(environment);
  const stored = baseline.environments?.[key];
  const lines = [];
  for (const profile of profiles) {
    for (const measure of profile.measures) {
      const label = `${profile.id}|${measure.label}`;
      const distribution = measure.distribution;
      // Checked before anything about the baseline, because it is the reason that does not depend on what was
      // accepted: profile D's harness leg is sampled once on every run, so "never been accepted into the
      // baseline" would read like somebody forgot rather than like an instrument that cannot produce a median.
      if (!distribution || distribution.samples < GATE.minimumSamples) {
        lines.push(
          line(
            label,
            'na',
            `${distribution?.samples ?? 0} sample${distribution?.samples === 1 ? '' : 's'} in this run; the gate needs ${GATE.minimumSamples} before a median means anything (§6 reports a baseline only with its distribution)`,
          ),
        );
        continue;
      }
      if (!stored) {
        lines.push(line(label, 'na', `no baseline for this environment (${key}). The number is measured and reported; nothing compares it, and an unmeasured leg is not a passing leg`));
        continue;
      }
      const entry = stored.entries?.[label];
      if (!entry) {
        lines.push(line(label, 'na', 'this timing has never been accepted into the baseline, so it is reported and not gated'));
        continue;
      }
      if (entry.fixture?.sha256 !== profile.fixture?.sha256) {
        lines.push(
          line(
            label,
            'na',
            `${profile.fixture?.name ?? 'no fixture'} is not the document the baseline was accepted against (${entry.fixture?.name ?? 'unknown'} ${String(entry.fixture?.sha256 ?? '').slice(0, 12)}…). A new fixture is a new measurement, never a regression`,
          ),
        );
        continue;
      }
      const state = entryState(entry);
      if (!state.live) {
        lines.push(line(label, state.blind ? 'blind' : 'na', `${state.provisional ? 'provisional' : 'BLIND'}: ${state.reason}`));
        continue;
      }
      if (state.reference <= 0) {
        // A median of zero is not a small number, it is an instrument that measured nothing — and dividing the
        // current run by it would either pass every leg or fail every leg depending on the sign.
        lines.push(line(label, 'na', `the accepted reference for this leg is ${state.reference} ms, which is not a number a timing can be compared against — check what the run measured before re-accepting it`));
        continue;
      }
      const over = (value, reference) => (reference > 0 ? value / reference : 0);
      const p50Ratio = over(distribution.p50, state.reference);
      const p95Ratio = over(distribution.p95, state.referenceP95);
      const worst = Math.max(p50Ratio, p95Ratio);
      const detail =
        `p50 ${distribution.p50} ms against ${state.reference} ms (${p50Ratio.toFixed(2)}×) and p95 ${distribution.p95} against ${state.referenceP95} (${p95Ratio.toFixed(2)}×), ` +
        `against a tolerance of ×${state.tolerance} from ${state.readings} readings whose own spread was ${state.spread.toFixed(2)}×${state.floored ? " (the floor, not the spread — this baseline has been quieter than the runner readings §6's spread was measured from)" : ''}`;
      lines.push(worst > state.tolerance ? line(label, 'fail', detail) : line(label, 'pass', detail));
    }
  }
  return { key, lines };
}

const line = (label, status, detail) => ({ label, status, detail });

/** What a report of the gate has to say about itself, in one line a reader can act on. */
export function summarise(lines) {
  const count = (status) => lines.filter((l) => l.status === status).length;
  const compared = count('pass') + count('fail');
  return {
    compared,
    failed: count('fail'),
    na: count('na'),
    blind: count('blind'),
    total: lines.length,
    text:
      `${compared}/${lines.length} legs compared, ${count('fail')} regressed; ` +
      `${count('na')} unaccepted and ${count('blind')} blind could not compare — ` +
      'a leg that cannot compare is reported, never counted as a pass',
  };
}

/**
 * Fold one run's record into the baseline.
 *
 * Called only by `npm run bench:update-baseline`, which is a deliberate act, not a side effect of measuring:
 * the readings this appends are what the gate will compare every later run against. A leg that measures fewer
 * than `GATE.minimumSamples` times is *skipped* and reported (profile D's cold page is sampled once, so it has
 * no median to accept), and it refuses to absorb a reading the current gate reports as a regression unless
 * `force` is set — it prints the tolerance each accepted reading moves, and once the computed tolerance
 * crosses the ceiling the leg goes blind, which is visible rather than a ceiling somebody raised to hide a
 * fact.
 */
export function mergeRecord({ baseline, record, force = false }) {
  const key = fingerprint(record.environment);
  const next = { ...baseline, environments: { ...(baseline.environments ?? {}) } };
  const environment = next.environments[key] ?? { describe: key, entries: {} };
  environment.environment = {
    // §6's fields, kept with the entry so a reader does not have to trust the key's spelling.
    machine: record.environment.machine,
    platform: record.environment.platform,
    arch: record.environment.arch,
    memoryGb: record.environment.memoryGb,
    node: record.environment.node,
    engine: record.environment.engine,
  };
  const added = [];
  const refused = [];
  const skipped = [];
  for (const profile of record.profiles) {
    for (const measure of profile.measures) {
      const label = `${profile.id}|${measure.label}`;
      const distribution = measure.distribution;
      if (!distribution || distribution.samples < GATE.minimumSamples) {
        // Not an error and not something `--force` can buy: profile D measures its cold page once, so there is
        // no median to accept. The leg stays out of the baseline and every run prints why it cannot compare,
        // which is the instrument's own limit rather than a passing row.
        skipped.push({
          label,
          why: `${distribution?.samples ?? 0} sample${distribution?.samples === 1 ? '' : 's'}: a median of one is not a median, so this leg has nothing to accept`,
        });
        continue;
      }
      if (!added.some((a) => a.label === label) && !force) {
        const before = entryState(environment.entries?.[label]);
        if (before.live) {
          const over = (value, reference) => (reference > 0 ? value / reference : 0);
          if (
            over(distribution.p50, before.reference) > before.tolerance ||
            over(distribution.p95, before.referenceP95) > before.tolerance
          ) {
            refused.push({
              label,
              why: `this run reads p50 ${distribution.p50} ms against a live reference of ${before.reference} ms at ×${before.tolerance} — accepting it would move the goalposts the gate just missed`,
            });
            continue;
          }
        }
      }
      const entry = environment.entries[label] ?? { fixture: profile.fixture, readings: [] };
      entry.fixture = profile.fixture;
      entry.readings = [
        ...entry.readings,
        {
          p50: distribution.p50,
          p95: distribution.p95,
          max: distribution.max,
          samples: distribution.samples,
          at: record.environment.ranAt,
          revision: record.environment.revision,
          browser: record.environment.browser,
          osRelease: record.environment.osRelease,
        },
      ].slice(-GATE.maximumReadings);
      const state = entryState(entry);
      entry.reference = state.live ? state.reference : null;
      entry.tolerance = state.live ? state.tolerance : null;
      entry.status = state.live ? 'live' : state.blind ? 'blind' : 'provisional';
      environment.entries[label] = entry;
      added.push({ label, state, readings: entry.readings.length });
    }
  }
  next.environments[key] = environment;
  return { baseline: next, key, added, refused, skipped };
}

export const BASELINE_HEADER = () => ({
  schema: 1,
  about:
    'FR-49\'s regression gate: the timings `npm run bench` has been accepted as a baseline for, per environment. ' +
    'A run compares its own medians against the entry for its own fingerprint and fails the job past the tolerance; ' +
    'an environment with no entry is reported as n/a and never as a pass. Written by `npm run bench:update-baseline`.',
  rule:
    'PRD §6: "A target is not a measurement… A maximum observed on one device does not become a promise that a slower ' +
    "reader's machine will break.\" This file is the measurement side of FR-49\'s " +
    '"a regression is a failing job"; the bar stays where §6 put it, and no number here is promoted into it.',
  gate: GATE,
  spreadEvidence:
    'The floor of 1.5× comes from three CI runs of the same tree: profile A cold page 195/236/264 ms (1.12×), ' +
    'profile C cold page 213/288/380 ms (1.32×), profile C engine-only render 106.5/146.1/148.0 ms (1.01×), ' +
    'profile D harness 1527/1774/2028 ms (1.14×) — runs 37655557527, 37537133179, 37681492748. ' +
    'The ceiling of 2× is where a timing comparison stops meaning anything, and a leg past it is marked blind.',
  environments: {},
});
