/**
 * FR-58: the publish gate refuses, and every refusal is produced here rather than asserted in prose.
 *
 * `scripts/release-validate.mjs` is the thing standing between a green local run and `npm publish`, because
 * `prepublishOnly` used to be `npm run verify` alone — and `verify` never runs the browser matrix. Measured
 * 2026-11-03: `verify` exited 0 while `Browser matrix (… 6.2.108)` was red on `no-uncaught-errors` on the same
 * tree. A gate that cannot see the failure it is meant to block is not a gate, so this file feeds it the four
 * bad states and reads back the reason it named.
 *
 * Two house rules shape the cases:
 *   - a derived reader throws rather than defaults, so an empty CI response or a missing `release/` directory is
 *     asserted as a refusal, never as a pass;
 *   - the runner's own identity must not leak in. `rc-record`'s guard passed at home and failed in eight CI
 *     cells once because Actions exports `GITHUB_RUN_ID` (#272's lesson), so every `GITHUB_*` variable is
 *     scrubbed below before any case runs, and one case proves the gate asks *git* for the SHA rather than
 *     trusting an environment it did not set.
 */
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  REQUIRED_JOBS,
  candidateProblems,
  ciProblems,
  deriveCandidatePasses,
  main,
  registryProblems,
  requiredLegsFrom,
  tagProblems,
} from '../../scripts/release-validate.mjs';

const repo = process.cwd();
const SHA = '0123456789abcdef0123456789abcdef01234567';
const VERSION: string = JSON.parse(readFileSync(`${repo}/package.json`, 'utf8')).version;
const NAME: string = JSON.parse(readFileSync(`${repo}/package.json`, 'utf8')).name;

for (const key of Object.keys(process.env)) {
  if (/^(GITHUB_|RUNNER_|INPUT_|CI$)/.test(key)) delete process.env[key];
}

const job = (name: string, conclusion = 'success') => ({ name, status: 'completed', conclusion });
const greenRun = () => [
  job('Verify (Node 22.13.0)'),
  job('Verify (Node 22)'),
  job('Verify (Node 24)'),
  job('Packaging (Node 22.13.0)'),
  job('Packaging (Node 22)'),
  job('Packaging (Node 24)'),
  job('Consumer build (Vite, pdfjs-dist 6.2.108)'),
  job('Consumer build (Vite, pdfjs-dist 6.4.299)'),
  job('Browser matrix (Chromium, Firefox, WebKit, pdfjs-dist 6.2.108)'),
  job('Browser matrix (Chromium, Firefox, WebKit, pdfjs-dist 6.4.299)'),
];

const leg = (name: string, conclusion = 'success') => ({ leg: name, conclusion });
const greenRecord = (over = {}) => ({
  tag: `v${VERSION}`,
  commit: SHA,
  artifact: { file: `${NAME}-${VERSION}.tgz`, sha256: 'a'.repeat(64) },
  legs: requiredLegsFrom(readFileSync(`${repo}/scripts/rc-record.mjs`, 'utf8')).map((l) => leg(l)),
  ...over,
});

/** The whole gate satisfied, one knob per case. */
const deps = (over: Record<string, unknown> = {}) => ({
  headSha: () => SHA,
  tagOfHead: () => `v${VERSION}`,
  jobs: async () => greenRun(),
  packument: async () => null,
  records: () => [greenRecord({ file: 'release/last-candidate.json' })],
  ...over,
});

describe('FR-58: a candidate record passes only when every leg ran', () => {
  it('derives passes from the legs rather than trusting a field someone typed', () => {
    expect(deriveCandidatePasses([leg('verify-chain'), leg('benchmarks')]).passes).toBe(true);
    expect(deriveCandidatePasses([leg('verify-chain'), leg('benchmarks', 'skipped')])).toEqual({
      passes: false,
      notPassed: ['benchmarks=skipped'],
    });
    expect(deriveCandidatePasses([]).passes, 'an empty leg list is not a green candidate').toBe(false);
  });

  it('names today’s committed records exactly as they are', () => {
    const records = ['release/last-candidate.json', 'release/last-candidate-node22.13.0.json', 'release/last-candidate-node24.json'].map(
      (file) => ({ file, ...JSON.parse(readFileSync(`${repo}/${file}`, 'utf8')) }),
    );
    const verdicts = records.map((r) => `${r.file}:${deriveCandidatePasses(r.legs ?? []).passes ? 'pass' : 'fail'}`);
    // The merged rc.1 record skipped `benchmarks` on its Node 24 cell, so no v1.0.0 may be published against it.
    expect(verdicts, verdicts.join(' ')).toContain('release/last-candidate-node22.13.0.json:pass');
    expect(verdicts, verdicts.join(' ')).toContain('release/last-candidate.json:fail');
    expect(
      deriveCandidatePasses(records.find((r) => r.file === 'release/last-candidate.json')!.legs).notPassed,
    ).toEqual(['benchmarks=skipped']);
  });

  it('refuses a record whose legs are absent or whose run has no digest', () => {
    expect(candidateProblems([greenRecord({ legs: [leg('verify-chain', 'absent')] })], { version: VERSION, sha: SHA }).join(' '))
      .toMatch(/an absent leg reads exactly like one that passed/);
    expect(candidateProblems([greenRecord({ artifact: { file: 'x.tgz', sha256: '' } })], { version: VERSION, sha: SHA })).toEqual([
      expect.stringContaining('no artifact digest'),
    ]);
    expect(candidateProblems([greenRecord({ tag: 'v0.0.0-rc.9' })], { version: VERSION, sha: SHA })).toEqual([
      expect.stringContaining('no candidate record carries tag'),
    ]);
    expect(candidateProblems([], { version: VERSION, sha: SHA })).toEqual([expect.stringContaining('no release/last-candidate')]);
  });
});

describe('FR-58: the CI reading cannot be misread as green', () => {
  it('refuses the exact shape measured on 2026-11-03 — one matrix cell red beside a passing verify', () => {
    const run = greenRun().map((j) =>
      j.name.startsWith('Browser matrix (Chromium, Firefox, WebKit, pdfjs-dist 6.2') ? job(j.name, 'failure') : j,
    );
    expect(ciProblems(run, SHA)).toEqual([
      expect.stringContaining('Browser matrix (Chromium, Firefox, WebKit, pdfjs-dist 6.2.108): failure'),
    ]);
  });

  it('counts the cells, so a workflow edit that drops one cannot shrink the gate', () => {
    const oneCell = greenRun().filter((j) => !j.name.includes('6.4.299') || !j.name.startsWith('Browser'));
    expect(ciProblems(oneCell, SHA).join(' ')).toMatch(/Browser matrix: the run has 1 job\(s\); this gate needs at least 2/);
  });

  it('treats a job that is still running, or absent, as not-green', () => {
    expect(
      ciProblems([{ name: 'Verify (Node 22.13.0)', status: 'in_progress', conclusion: 'none' }, ...greenRun().slice(1)], SHA).join(' '),
    ).toMatch(/Verify \(Node 22\.13\.0\): status is in_progress/);
    expect(ciProblems(greenRun().filter((j) => !j.name.startsWith('Packaging')), SHA).join(' ')).toMatch(/Packaging: the run has 0 job/);
  });

  it('throws on an empty run rather than reading it as a pass', () => {
    expect(() => ciProblems([], SHA)).toThrow(/refusing to read an empty run as a green one/);
  });

  /**
   * The gate's `atLeast` numbers are the workflow's matrix sizes. Without this case the gate could quietly demand
   * fewer cells than ci.yml runs — which is the same mistake as the floor rule that fell back to its own defaults
   * when §8's row was renamed (#322), just pointed at the runner instead of the document.
   */
  it('requires exactly as many jobs as the workflow runs', () => {
    const ci = readFileSync(`${repo}/.github/workflows/ci.yml`, 'utf8');
    const jobBlock = (key: string) => {
      const lines = ci.split('\n');
      const start = lines.findIndex((line) => line.startsWith(`  ${key}:`));
      if (start < 0) throw new Error(`ci.yml has no job "${key}"`);
      const end = lines.findIndex((line, i) => i > start && /^ {2}\w[\w-]*:$/.test(line));
      return lines.slice(start, end < 0 ? undefined : end).join('\n');
    };
    const matrixSize = (job: string, axis: string) => {
      const block = jobBlock(job);
      const values = new RegExp(`^\\s+${axis}: \\[([^\\]]+)\\]`, 'm').exec(block)?.[1];
      if (!values) throw new Error(`ci.yml's "${job}" job has no inline ${axis}: [...] matrix to count`);
      return new Set(values.split(',').map((v) => v.trim().replace(/^['"]|['"]$/g, ''))).size;
    };

    const jobKeys: Record<string, string> = { Verify: 'verify', Packaging: 'packaging', 'Browser matrix': 'browser', 'Consumer build': 'consumer' };
    for (const { prefix, label, matrix, atLeast } of REQUIRED_JOBS) {
      const key = jobKeys[label];
      if (!key) throw new Error(`the test does not know which ci.yml job backs the "${label}" requirement`);
      expect(matrixSize(key, matrix), `${label} must require as many jobs as ci.yml runs (${matrix})`).toBe(atLeast);
      expect(ci).toContain(`name: ${prefix}`);
    }
  });
});

describe('FR-58: the registry and the tag are consulted, not assumed', () => {
  it('refuses a version that is already taken, because a burned number cannot be reused', () => {
    expect(registryProblems({ versions: { [VERSION]: {} }, 'dist-tags': { latest: '0.9.0' } }, NAME, VERSION)).toEqual([
      expect.stringContaining('already on the registry'),
    ]);
    expect(registryProblems({ versions: {}, 'dist-tags': { latest: VERSION } }, NAME, VERSION)).toEqual([
      expect.stringContaining('dist-tags.latest is already'),
    ]);
    expect(registryProblems(null, NAME, VERSION)).toEqual([]);
  });

  it('refuses an untagged HEAD, which is the publish-before-tag order this pipeline exists to stop', () => {
    expect(tagProblems('', VERSION)).toEqual([expect.stringContaining('HEAD is (untagged)')]);
    expect(tagProblems('v1.0.0-rc.1', VERSION)).toEqual([expect.stringContaining(`not v${VERSION}`)]);
    expect(tagProblems(`v${VERSION}`, VERSION)).toEqual([]);
  });

  it('surfaces a registry or CI error as a refusal rather than an absence of evidence', async () => {
    const code = await main(deps({ packument: async () => { throw new Error('registry answered 500 for pdfjs-react-reader'); } }), ['--sha=' + SHA]);
    expect(code).toBe(1);
  });

  it('refuses --offline, because a gate with its sources disconnected is not a gate', async () => {
    expect(await main(deps(), ['--offline'])).toBe(1);
  });

  /**
   * The bug this case exists for: the first version compared `fileURLToPath(import.meta.url)` against a
   * separator-normalised `argv[1]`, which on Windows never matches — so `node scripts/release-validate.mjs`
   * imported the module, ran nothing at all, and exited **0**. A publish gate that silently declines to run is
   * worse than one that refuses, so the CLI is spawned here and required to speak.
   */
  it('actually runs when invoked from the command line, and says so', () => {
    const result = spawnSync(process.execPath, [join(repo, 'scripts/release-validate.mjs'), '--offline'], {
      encoding: 'utf8',
      cwd: repo,
    });
    expect(result.status, `stdout: ${result.stdout}\nstderr: ${result.stderr}`).toBe(1);
    expect(result.stderr).toMatch(/ran --offline/);
    expect(result.stderr).toMatch(/not a publish path/);
  });

  it('passes the whole gate when all four sources agree, and asks git for the SHA it did not pin', async () => {
    let asked = false;
    const code = await main(
      deps({
        headSha: () => {
          asked = true;
          return SHA;
        },
      }),
      [],
    );
    expect(code).toBe(0);
    expect(asked, 'the SHA must come from git when --sha is absent, never from an inherited CI variable').toBe(true);
  });

  it('refuses when the tag, the run, the record and the registry are checked on the version being published', async () => {
    const code = await main(deps({ jobs: async () => [job('Verify (Node 22.13.0)', 'failure'), ...greenRun().slice(1)] }), ['--sha=' + SHA]);
    expect(code).toBe(1);
  });

  /**
   * The wiring, not just the file. A gate that exists but is not named by the hook is the same hole as a claim
   * whose cited file never measures anything (#320, and the `packaging` row #306 was written for) — so the
   * assertion is on the manifest a publisher actually runs.
   */
  it('is the thing npm runs before it publishes, and is runnable by name', () => {
    const pkg = JSON.parse(readFileSync(`${repo}/package.json`, 'utf8'));
    expect(pkg.scripts.prepublishOnly).toContain('npm run release:validate');
    expect(pkg.scripts['release:validate']).toBe('node scripts/release-validate.mjs');
    expect(pkg.scripts.verify).toMatch(/check:fr-evidence$/);
  });
});
