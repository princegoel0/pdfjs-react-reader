/*
 * FR-49's regression gate, run against numbers this file makes up.
 *
 * The clause is the second half of the row: "Each profile's target is measured against its fixture in CI and
 * reported, **so a regression is a failing job rather than a slower feeling**." `scripts/benchmark.mjs` has
 * always done the measuring and the reporting; its `measure` lines were the ones that could never fail, and
 * that is the gap `scripts/benchmark-baseline.mjs` closes.
 *
 * A gate like this has two ways to be wrong, and they are opposite. It can fail on noise — which is what §6's
 * own sentence is about ("a maximum observed on one device does not become a promise that a slower reader's
 * machine will break"), and what makes a team start ignoring a red job. Or it can compare nothing and report
 * green — which is the failure PRD §8 already has words for: "a browser, React major or engine that cannot
 * start is an unverified row, not a pass". So most of what follows is the second failure class: an
 * environment with no accepted baseline, a leg measured once, a fixture that changed under the baseline, an
 * environment too noisy to compare in. Each has to read `n/a` out loud, and each is falsified here by
 * asserting it is *not* a pass.
 *
 * The numbers are fabricated on purpose. Waiting for a machine to actually get slower is not a test, and the
 * tolerance is arithmetic over readings a person accepted, so arithmetic is what gets checked — including
 * against the committed `benchmarks/baseline.json`, whose stored `reference` and `tolerance` this file re-derives
 * from its own readings and refuses if they disagree. A baseline somebody hand-edited to a wider number is the
 * raised ceiling this repository is not supposed to be able to produce.
 *
 * Nothing here starts a browser. `npm run bench` does that, and its own record is guarded by
 * `src/lib/benchmark-record.test.ts`.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  BASELINE_HEADER,
  GATE,
  compareRun,
  entryState,
  fingerprint,
  mergeRecord,
  summarise,
  type Baseline,
  type BenchmarkEnvironment,
  type BenchmarkRunRecord,
  type Entry,
  type GateLine,
  type Reading,
} from '../../scripts/benchmark-baseline.mjs';

const SHA_A = 'a'.repeat(64);
const SHA_B = 'b'.repeat(64);

const ENVIRONMENT = (over: Partial<BenchmarkEnvironment> = {}): BenchmarkEnvironment => ({
  machine: 'Test CPU',
  arch: 'x86_64',
  platform: 'linux',
  osRelease: '5.15.0-generic',
  memoryGb: 16,
  node: 'v22.13.0',
  browser: 'chromium 153.0.8010.12',
  engine: '6.4.299',
  revision: 'c'.repeat(40),
  ranAt: '2026-10-08T00:00:00.000Z',
  ...over,
});

const FIXTURE = (sha256 = SHA_A) => ({ name: 'long-sample.pdf', bytes: 375178, sha256 });

const MEASURE = (label: string, values: number[]) => {
  const sorted = [...values].sort((x, y) => x - y);
  const at = (q: number): number => sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))] ?? 0;
  return {
    label,
    detail: `${label} (fabricated)`,
    distribution: {
      samples: sorted.length,
      p50: Number(at(0.5).toFixed(1)),
      p95: Number(at(0.95).toFixed(1)),
      p99: null,
      max: Number((sorted[sorted.length - 1] ?? 0).toFixed(1)),
    },
  };
};

/**
 * A run record with one profile and the named timings, which is all the gate needs to read. The fixture sits
 * on the profile, the same place `scripts/benchmark.mjs` puts it, because "is this the same document" is a
 * question about the profile's bytes rather than about one of its numbers.
 */
const RUN = (
  environment: BenchmarkEnvironment,
  measures: Array<ReturnType<typeof MEASURE>>,
  fixture = FIXTURE(),
): BenchmarkRunRecord => ({
  schema: 1,
  environment,
  caps: { maxPixels: 33_600_000, maxPixelsMobile: 5_240_000, maxSide: 8192, capAreaFactor: 300 },
  profiles: [
    {
      id: 'A',
      name: 'text-heavy',
      target: 'cold page under 100 ms',
      fixture,
      bars: [],
      measures,
      notes: [],
    },
  ],
});

const measure = MEASURE;

/** Accept `runs` into a fresh baseline, the way `npm run bench:update-baseline` does, one run at a time. */
function accepted(...runs: BenchmarkRunRecord[]): Baseline {
  let baseline = BASELINE_HEADER();
  for (const record of runs) baseline = mergeRecord({ baseline, record }).baseline;
  return baseline;
}

function legOf(baseline: Baseline, environment: BenchmarkEnvironment, label: string): Entry | undefined {
  return baseline.environments[fingerprint(environment)]?.entries[label];
}

const lineFor = (lines: GateLine[], label: string): GateLine => {
  const found = lines.find((l) => l.label === label);
  if (!found) throw new Error(`the gate reported no line for ${label}; it printed ${lines.map((l) => l.label).join(', ')}`);
  return found;
};

/** Unwrap the live shape, or fail the test with what the gate actually said. */
function live(baseline: Baseline, environment: BenchmarkEnvironment, label: string) {
  const entry = legOf(baseline, environment, label);
  if (!entry) throw new Error(`no entry for ${label} in ${fingerprint(environment)}`);
  const state = entryState(entry);
  if (!state.live) throw new Error(`${label} is not live: ${JSON.stringify(state)}`);
  return state;
}

const READING = (p50: number, over: Partial<Reading> = {}): Reading => ({
  p50,
  p95: p50 * 1.2,
  max: p50 * 1.2,
  samples: 5,
  at: '2026-10-08T00:00:00.000Z',
  revision: 'd'.repeat(40),
  browser: 'chromium 153.0.8010.12',
  osRelease: '5.15.0-generic',
  ...over,
});

describe("FR-49's regression gate", () => {
  it('keys a baseline on the fields a person decides and the ones that define the machine', () => {
    const base = ENVIRONMENT();
    // The two fields a runner image changes on its own schedule must not decide the key, or every leg would go
    // blind every few weeks without anyone doing anything — and a silent n/a is how a gate stops protecting.
    expect(fingerprint(ENVIRONMENT({ browser: 'chromium 199.0.0.1' }))).toBe(fingerprint(ENVIRONMENT()));
    expect(fingerprint(ENVIRONMENT({ osRelease: '6.1.0' }))).toBe(fingerprint(base));
    expect(fingerprint(ENVIRONMENT({ engine: '6.2.108' }))).not.toBe(fingerprint(base));
    expect(fingerprint(ENVIRONMENT({ memoryGb: 8 }))).not.toBe(fingerprint(base));
    expect(fingerprint(ENVIRONMENT({ node: 'v20.19.0' }))).not.toBe(fingerprint(base));
    expect(fingerprint(base)).toContain('Test CPU');
  });

  it('reports an environment with no accepted baseline as unverified, never as a pass', () => {
    const baseline = accepted(RUN(ENVIRONMENT(), [measure('cold page', [200, 202, 205, 208, 210])]));
    // A run from a machine nobody has accepted a baseline for. The numbers are perfectly good numbers; there
    // is simply nothing to compare them with, and PRD §8's own rule is that an unverified row is not a pass.
    const other = ENVIRONMENT({ machine: 'A different box' });
    const run = RUN(other, [measure('cold page', [180, 182, 184, 186, 188])]);
    const report = compareRun({ baseline, environment: other, profiles: run.profiles });
    const line = lineFor(report.lines, 'A|cold page');
    expect(line.status).toBe('na');
    expect(line.detail).toContain('no baseline for this environment');
    expect(report.lines.some((l) => l.status === 'pass')).toBe(false);
    const summary = summarise(report.lines);
    expect(summary.compared).toBe(0);
    expect(summary.failed).toBe(0);
    expect(summary.na).toBe(1);
    expect(summary.text).toMatch(/never counted as a pass/);
  });

  it('fails a leg that ran past its own environment’s tolerance, naming the quantile and the ratio', () => {
    const environment = ENVIRONMENT();
    const baseline = accepted(
      RUN(environment, [measure('cold page', [200, 202, 204, 206, 208])]),
      RUN(environment, [measure('cold page', [195, 200, 205, 208, 210])]),
    );
    const state = live(baseline, environment, 'A|cold page');
    expect(state.readings).toBe(2);
    const slow = RUN(environment, [measure('cold page', [900, 910, 920, 930, 940])]);
    const line = lineFor(compareRun({ baseline, environment, profiles: slow.profiles }).lines, 'A|cold page');
    expect(line.status, `a 920 ms cold page against a ${state.reference} ms reference must be a failing job`).toBe('fail');
    expect(line.detail).toContain('p50 920');
    expect(line.detail).toMatch(/×\d\.\d+/);
    expect(summarise(compareRun({ baseline, environment, profiles: slow.profiles }).lines).failed).toBe(1);
  });

  it('lets the same leg pass while the number is inside the tolerance it derived from its own noise', () => {
    const environment = ENVIRONMENT();
    const baseline = accepted(
      RUN(environment, [measure('cold page', [200, 202, 204, 206, 208])]),
      RUN(environment, [measure('cold page', [195, 200, 205, 208, 210])]),
    );
    const state = live(baseline, environment, 'A|cold page');
    const ok = RUN(environment, [measure('cold page', [250, 255, 260, 262, 264])]);
    const line = lineFor(compareRun({ baseline, environment, profiles: ok.profiles }).lines, 'A|cold page');
    expect(line.status, `p50 260 against a reference of ${state.reference} is ${260 / state.reference}×, inside ×${state.tolerance}`).toBe('pass');
  });

  it('will not compare a leg that has only been accepted once', () => {
    const environment = ENVIRONMENT();
    const baseline = accepted(RUN(environment, [measure('cold page', [200, 202, 204, 206, 208])]));
    const run = RUN(environment, [measure('cold page', [900, 910, 920, 930, 940])]);
    const line = lineFor(compareRun({ baseline, environment, profiles: run.profiles }).lines, 'A|cold page');
    expect(line.status).toBe('na');
    expect(line.detail).toMatch(/provisional/);
    expect(line.detail).toMatch(/needs 2/);
  });

  it('will not compare a leg whose run sampled too few times to have a median', () => {
    const environment = ENVIRONMENT();
    const baseline = accepted(
      RUN(environment, [measure('cold page', [200, 202, 204, 206, 208])]),
      RUN(environment, [measure('cold page', [195, 200, 205, 208, 210])]),
    );
    // One sample, which is exactly what profile D's harness leg produces on every run.
    const run = RUN(environment, [measure('cold page', [4000])]);
    const line = lineFor(compareRun({ baseline, environment, profiles: run.profiles }).lines, 'A|cold page');
    expect(line.status).toBe('na');
    expect(line.detail).toMatch(/1 sample/);
    expect(line.detail).toMatch(/needs 3/);
  });

  it('treats a fixture that changed under the baseline as a new measurement, not a regression', () => {
    const environment = ENVIRONMENT();
    const baseline = accepted(
      RUN(environment, [measure('cold page', [200, 202, 204, 206, 208])]),
      RUN(environment, [measure('cold page', [195, 200, 205, 208, 210])]),
    );
    const run = RUN(environment, [measure('cold page', [900, 910, 920, 930, 940])], FIXTURE(SHA_B));
    const line = lineFor(compareRun({ baseline, environment, profiles: run.profiles }).lines, 'A|cold page');
    expect(line.status).toBe('na');
    expect(line.detail).toMatch(/not the document the baseline was accepted against/);
    expect(line.detail).toMatch(/new measurement, never a regression/);
  });

  it('goes blind rather than carrying a tolerance wider than the ceiling', () => {
    const entry: Entry = { fixture: FIXTURE(), readings: [READING(100), READING(500)], reference: null, tolerance: null, status: 'provisional' };
    const state = entryState(entry);
    if (state.live) throw new Error(`expected blind, got a live tolerance of ×${state.tolerance}`);
    expect(state.blind).toBe(true);
    expect(state.reason).toMatch(/ceiling/);
    const environment = ENVIRONMENT();
    const baseline = accepted(
      RUN(environment, [measure('cold page', [100, 101, 102, 103, 104])]),
      RUN(environment, [measure('cold page', [500, 501, 502, 503, 504])]),
    );
    const run = RUN(environment, [measure('cold page', [9000, 9001, 9002, 9003, 9004])]);
    const line = lineFor(compareRun({ baseline, environment, profiles: run.profiles }).lines, 'A|cold page');
    expect(line.status).toBe('blind');
    expect(summarise(compareRun({ baseline, environment, profiles: run.profiles }).lines).blind).toBe(1);
  });

  it('holds the tolerance at the measured floor so two quiet runs cannot make a gate that cries wolf', () => {
    const entry: Entry = { fixture: FIXTURE(), readings: [READING(200), READING(204)], reference: null, tolerance: null, status: 'provisional' };
    const state = entryState(entry);
    if (!state.live) throw new Error('expected a live entry');
    // 204/202 = 1.01× of spread, ×1.25 is 1.26 — under the 1.5 floor, because two runs of the same tree are
    // never the noise a later run actually meets.
    expect(state.floored).toBe(true);
    expect(state.tolerance).toBe(GATE.toleranceFloor);
    expect(state.reference).toBeCloseTo(202, 5);
  });

  it('refuses to absorb a reading the gate just called a regression, unless a person forces it', () => {
    const environment = ENVIRONMENT();
    const baseline = accepted(
      RUN(environment, [measure('cold page', [200, 202, 204, 206, 208])]),
      RUN(environment, [measure('cold page', [195, 200, 205, 208, 210])]),
    );
    const before = live(baseline, environment, 'A|cold page');
    const slow = RUN(environment, [measure('cold page', [900, 910, 920, 930, 940])]);
    const guarded = mergeRecord({ baseline, record: slow });
    expect(guarded.refused.map((r) => r.label)).toEqual(['A|cold page']);
    expect(guarded.refused[0]?.why).toMatch(/move the goalposts/);
    expect(guarded.refused[0]?.why, 'the refusal has to name the tolerance it would have had to move').toContain(
      `×${before.tolerance}`,
    );
    expect(legOf(guarded.baseline, environment, 'A|cold page')?.readings).toHaveLength(2);
    const forced = mergeRecord({ baseline, record: slow, force: true });
    expect(forced.refused).toEqual([]);
    expect(legOf(forced.baseline, environment, 'A|cold page')?.readings).toHaveLength(3);
    // And forcing is self-limiting rather than a way to widen a ceiling quietly: [204, 205, 920] disagree by
    // more than the ceiling allows, so the leg stops claiming to see anything at all. `--force` buys a
    // re-baseline, never a gate that has been talked into silence — it goes louder, and the run prints BLIND.
    const after = entryState(legOf(forced.baseline, environment, 'A|cold page'));
    expect(after.live).toBe(false);
    if (after.live) throw new Error('expected the forced leg to be blind');
    expect(after.blind).toBe(true);
    const verdict = lineFor(compareRun({ baseline: forced.baseline, environment, profiles: slow.profiles }).lines, 'A|cold page');
    expect(verdict.status).toBe('blind');
  });

  it('skips a leg with no median to accept without blocking the legs that have one', () => {
    const environment = ENVIRONMENT();
    const run = RUN(environment, [measure('cold page', [4000]), measure('document open to first ink', [500, 505, 510, 515, 520])]);
    const merged = mergeRecord({ baseline: BASELINE_HEADER(), record: run });
    expect(merged.skipped.map((s) => s.label)).toEqual(['A|cold page']);
    expect(merged.refused).toEqual([]);
    expect(merged.added.map((a) => a.label)).toEqual(['A|document open to first ink']);
    expect(legOf(merged.baseline, environment, 'A|cold page')).toBeUndefined();
  });

  it('is wired into the run that produces the numbers, so the comparison is not documentation', () => {
    const source = readFileSync(join(process.cwd(), 'scripts', 'benchmark.mjs'), 'utf8');
    expect(source).toContain('FR-49');
    expect(source).toMatch(/from '\.\/benchmark-baseline\.mjs'/);
    expect(source).toMatch(/compareRun\(\{[\s\S]*baseline: baselineFile/);
    // The exit code is the clause. A gate that prints a verdict and exits 0 is a slower feeling.
    expect(source).toMatch(/process\.exit\(broke\.length \|\| regressed\.length \? 1 : 0\)/);
    expect(source).toMatch(/benchmarks\/baseline\.json is missing/);
    // And the header sentence that used to claim timings could never fail has to have been rewritten, not left.
    expect(source).not.toMatch(/never failed on/);
  });

  it('keeps every step that writes evidence alive when the row above it is red (FR-49, #279)', () => {
    // A record that is skipped because something else failed is not evidence, and CI run 37822702432 is the
    // measurement: the webkit row failed, the upload step was the last one in the job still written without
    // `always()`, and the two benchmark records that runner had produced never left it. So the gate is not
    // "the bench step has an always()" — it is that every step whose output a later reading depends on has one.
    const workflow = readFileSync(join(process.cwd(), '.github', 'workflows', 'ci.yml'), 'utf8');
    const evidence = [
      'Accessibility audit in a real browser',
      'Run the benchmarks twice and keep both records',
      'Upload the records this machine measured',
    ];
    for (const name of evidence) {
      const started = workflow.indexOf(`- name: ${name}`);
      expect(started, `no ${name} step in ci.yml`).toBeGreaterThan(-1);
      const rest = workflow.slice(started);
      const ends = rest.search(/\n {6}- name: /);
      const step = ends < 0 ? rest : rest.slice(0, ends);
      const condition = step.match(/^\s*if: (.+)$/m)?.[1];
      expect(condition, `${name} has no if: line, so the first red step skips it`).toBeTruthy();
      expect(
        condition,
        `${name} would be skipped by a red row above it — the evidence of a run is not optional`,
      )?.toMatch(/always\(\)/);
    }
  });

  it('keeps the committed baseline honest about the arithmetic that wrote it', () => {
    const text = readFileSync(join(process.cwd(), 'benchmarks', 'baseline.json'), 'utf8');
    const baseline = JSON.parse(text) as Baseline;
    expect(baseline.schema).toBe(1);
    // The constants travel with the file, and the file may not carry a different set from the code's.
    expect(baseline.gate).toEqual(GATE);
    const keys = Object.keys(baseline.environments);
    expect(keys.length, 'no environment has been accepted yet, so the gate has nothing to compare').toBeGreaterThan(0);
    for (const [key, environmentEntry] of Object.entries(baseline.environments)) {
      expect(key, 'an environment key was edited by hand: it must be the fingerprint of its own recorded fields').toBe(
        fingerprint(environmentEntry.environment as BenchmarkEnvironment),
      );
      for (const [label, entry] of Object.entries(environmentEntry.entries)) {
        for (const reading of entry.readings) {
          expect(reading.samples, `${label}: a reading sampled ${reading.samples} times cannot carry a median`).toBeGreaterThanOrEqual(
            GATE.minimumSamples,
          );
          expect(reading.revision, `${label}: a reading with no revision cannot be found again`).toMatch(/^[0-9a-f]{40}$|^unknown$/);
        }
        const state = entryState(entry);
        expect(entry.status, `${label}: the stored status disagrees with what its readings produce`).toBe(
          state.live ? 'live' : state.blind ? 'blind' : 'provisional',
        );
        if (state.live) {
          expect(entry.reference, `${label}: the stored reference is not the median of its readings`).toBe(state.reference);
          expect(entry.tolerance, `${label}: the stored tolerance is not the one its readings derive`).toBe(state.tolerance);
          expect(state.tolerance).toBeLessThanOrEqual(GATE.toleranceCeiling);
        } else {
          expect(entry.tolerance, `${label} is not live, so it must not store a tolerance`).toBeNull();
        }
      }
    }
  });

  it('names the §6 rule that decides the shape of the gate, in the file that enforces it', () => {
    const module = readFileSync(join(process.cwd(), 'scripts', 'benchmark-baseline.mjs'), 'utf8');
    expect(module).toMatch(/a maximum observed on one device does not become a promise/i);
    expect(module).toMatch(/FR-49/);
    // The tolerance is justified by a measurement or it is a guess; the file has to carry the measurement.
    expect(module).toMatch(/1\.32×/);
    expect(module).toMatch(/37655557527/);
  });
});
