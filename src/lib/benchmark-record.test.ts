/*
 * FR-49 / §6: the committed benchmark record, and the fields that make it evidence.
 *
 * `npm run bench` prints its numbers to a console, and a console log is not release evidence — it is gone the
 * moment the job ends. So the run also writes `benchmarks/latest.json`, and §6 says what a committed baseline
 * has to carry with it: "the environment, fixture revision and engine version are recorded with the result",
 * and "where a metric is sampled repeatedly, benchmark reports record at least p50 and p95, and p99 where the
 * sample count is sufficient".
 *
 * Those two sentences are this file's whole subject, and the assertions are the kind that fail:
 *
 *  - a field is present *and non-empty*, because `"browser": "chromium"` certifies nothing about a number;
 *  - a sampled metric carries the quantiles, and a `p99` is `null` rather than a 99th percentile of five
 *    samples, which is the maximum wearing a label;
 *  - the fixture hashes match the bytes on disk **now**, which is the clause with teeth. A record whose hash
 *    has drifted is a set of numbers describing a document that no longer exists, and the only honest repair
 *    is to measure it again;
 *  - and every bar in the committed record held, because the script exits non-zero when one breaks, so a
 *    committed record with a failed bar is someone accepting a broken run rather than fixing it.
 *
 * Nothing here re-runs the benchmark — it needs a browser and takes minutes. It reads what the last run
 * claimed and checks the claim is the shape §6 requires it to be.
 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

interface Distribution {
  samples: number;
  p50: number;
  p95: number;
  p99: number | null;
  max: number;
}

interface RecordShape {
  schema: number;
  environment: Record<string, string | number>;
  caps: Record<string, number>;
  profiles: Array<{
    id: string;
    name: string;
    target: string;
    fixture: { name: string; bytes: number; sha256: string } | null;
    bars: Array<{ label: string; ok: boolean; detail: string }>;
    measures: Array<{ label: string; detail: string; distribution: Distribution | null }>;
    notes: Array<{ label: string; detail: string }>;
  }>;
}

function load(): { path: string; text: string } {
  const path = join(process.cwd(), 'benchmarks', 'latest.json');
  try {
    return { path, text: readFileSync(path, 'utf8') };
  } catch {
    throw new Error(
      `${path} is missing. It is a tracked file and the record §6 and FR-58 ask for — run \`npm run bench\` to rewrite it.`,
    );
  }
}

function record(): RecordShape {
  return JSON.parse(load().text) as RecordShape;
}

/** §6's list, in the words it uses, each paired with the key that has to hold it. */
const ENVIRONMENT_FIELDS: Array<[key: string, describe: string, pattern?: RegExp]> = [
  ['machine', 'the machine model', /\S/],
  ['platform', 'the operating system', /^(win32|darwin|linux)$/],
  ['osRelease', 'the OS release', /\d/],
  ['browser', 'the browser and its version', /^[a-z]+ \d+\.\d+/],
  ['engine', 'the pdfjs-dist version that rendered', /^\d+\.\d+\.\d+/],
  ['node', 'the Node version that drove it', /^v\d+\.\d+\.\d+/],
  ['ranAt', 'the measurement date', /^\d{4}-\d{2}-\d{2}T\d{2}:/],
];

describe('the committed benchmark record (FR-49)', () => {
  it('is readable, versioned, and holds the four §6 profiles', () => {
    const r = record();
    expect(r.schema, 'the schema tag is what a reader of an old record checks first').toBeGreaterThan(0);
    expect(r.profiles.map((p) => p.id)).toEqual(['A', 'B', 'C', 'D']);
    for (const profile of r.profiles) {
      expect(profile.name).toBeTruthy();
      // §6's table is the only source for a profile's target: a number the table does not give is a bar
      // somebody invented, and an invented bar is how a baseline becomes a promise.
      expect(profile.target.length, `profile ${profile.id} has no §6 target to report against`).toBeGreaterThan(10);
    }
  });

  it('records the environment §6 demands a baseline be reported with', () => {
    const env = record().environment;
    for (const [key, label, pattern] of ENVIRONMENT_FIELDS) {
      const value = env[key];
      expect(typeof value, `${label} (${key}) is not in the record at all`).toBe('string');
      const text = String(value ?? '');
      expect(text.trim(), `${label} (${key}) is present but empty`).toBeTruthy();
      if (pattern) expect(text, `${label} (${key}) is "${text}", which names nothing`).toMatch(pattern);
    }
    expect(Number(env.memoryGb), 'a record without the machine’s memory cannot speak for profile D').toBeGreaterThan(0);
    // The revision is how a reader finds the tree the numbers came from. It is legitimately 'unknown' only in
    // a checkout with no git, so the assertion is that the field says something rather than that it is a sha.
    expect(String(record().environment.revision)).toMatch(/^[0-9a-f]{40}$|^unknown$/);
  });

  it('gives every sampled metric its distribution, and no p99 to a five-sample run', () => {
    let sampled = 0;
    for (const profile of record().profiles) {
      for (const measure of profile.measures) {
        const d = measure.distribution;
        expect(d, `${profile.id}/${measure.label} was recorded without its samples`).not.toBeNull();
        if (!d) continue;
        expect(d.samples, `${profile.id}/${measure.label} claims a distribution over nothing`).toBeGreaterThan(0);
        for (const key of ['p50', 'p95', 'max'] as const) {
          expect(Number.isFinite(d[key]), `${profile.id}/${measure.label} has no ${key}`).toBe(true);
        }
        expect(d.max, `${profile.id}/${measure.label}: p50 above max is an unsorted array`).toBeGreaterThanOrEqual(
          d.p95,
        );
        expect(d.p95).toBeGreaterThanOrEqual(d.p50);
        /*
         * §6 asks for p99 "where the sample count is sufficient", so the record states which side of that
         * line it is on instead of dividing a five-element array by 100. Frame gaps are the one measure that
         * clears it — a scroll sweep collects hundreds.
         */
        if (d.samples >= 100) {
          sampled++;
          expect(Number.isFinite(d.p99 ?? NaN), `${profile.id}/${measure.label}: ${d.samples} samples and no p99`).toBe(
            true,
          );
        } else {
          expect(d.p99, `${profile.id}/${measure.label}: a p99 of ${d.samples} samples is the max in disguise`).toBeNull();
        }
      }
    }
    expect(sampled, 'no metric in the record has a sample count worth a p99 — the sweeps are not running').toBeGreaterThan(
      0,
    );
  });

  it('hashes the fixture bytes the numbers were measured from', () => {
    for (const profile of record().profiles) {
      if (!profile.fixture) {
        expect(
          profile.measures.length,
          `profile ${profile.id} has no fixture and still reports timings — of what?`,
        ).toBe(0);
        continue;
      }
      const onDisk = readFileSync(join(process.cwd(), 'playground', 'fixtures', profile.fixture.name));
      expect(onDisk.byteLength, `${profile.fixture.name} changed size since the record was written`).toBe(
        profile.fixture.bytes,
      );
      const sha = createHash('sha256').update(onDisk).digest('hex');
      expect(
        sha,
        `${profile.fixture.name} is not the document these baselines measured. Re-run \`npm run bench\` and commit the record it writes.`,
      ).toBe(profile.fixture.sha256);
    }
  });

  it('holds only bars that held', () => {
    for (const profile of record().profiles) {
      for (const line of profile.bars) {
        expect(line.ok, `profile ${profile.id}: "${line.label}" broke in the recorded run — ${line.detail}`).toBe(true);
        expect(line.detail, `"${line.label}" states no evidence for itself`).toBeTruthy();
      }
    }
  });

  it('says so when a profile measured nothing, rather than reporting nothing', () => {
    const quiet = record().profiles.filter((p) => p.measures.length === 0 && p.bars.length === 0);
    for (const profile of quiet) {
      expect(
        profile.notes.length,
        `profile ${profile.id} is absent from the run and the record does not say why`,
      ).toBeGreaterThan(0);
    }
  });
});
