/**
 * FR-58: the release-candidate chain, guarded without a runner.
 *
 * §9's two hardest bullets are "the release candidate is built and tested on a clean runner from the packed npm
 * artifact" and that evidence "is recorded with its environment, operator and date". The chain that satisfies the
 * first is `.github/workflows/release-candidate.yml`; this file is what keeps the second honest, because the
 * failure mode of an evidence writer is a record that says more than the run measured — and a job nobody has
 * watched fail cannot be cited as a gate.
 *
 * So the cases are refusals first. The writer must reject a leg that is absent (a missing leg reads like a passing
 * one), a leg nobody runs, a green with no run id or no artifact digest to bind it to, and any attempt to write
 * the word `certified` — §9 is signed by a person. Then the wiring: the job must drive the browser leg at the
 * artifact rather than the sources, every step that produces evidence must survive a red step above it (#279's
 * finding, learned once already), and `scripts/browser-matrix.mjs` must refuse to report readings from a copy it
 * was not asked to test.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const script = join('scripts', 'rc-record.mjs');
const source = readFileSync(script, 'utf8');
const workflow = readFileSync(join('.github', 'workflows', 'release-candidate.yml'), 'utf8');
const ci = readFileSync(join('.github', 'workflows', 'ci.yml'), 'utf8');
const manifest = JSON.parse(readFileSync('package.json', 'utf8'));

const OUT = join('.spike', 'rc-record-test.json');

/** The required legs, read out of the writer so this file cannot drift from it. */
const legsBlock = /(?:const REQUIRED_LEGS = \[)([\s\S]*?)(?:\n\])/.exec(source)?.[1] ?? '';
const required: string[] = [...legsBlock.matchAll(/'([^']+)'/g)].map((m) => m[1] as string);

/*
 * The writer's `--run-id`, `--tag` and `--commit` fall back to `GITHUB_*`, which is right for the job that fills
 * them and wrong for a test that forgot to ask. Run inside GitHub Actions this file inherited a real run id, so
 * the "a green with no run id" case watched a record that was properly backed and passed — four Verify cells and
 * all four React cells went red on exactly that reading (CI run 37891973684, 2026-10-09), in the same family as
 * #262, where a guard demanded an equality the peer matrix could not satisfy. A guard's result must not depend on
 * which machine typed the command, so the ambient identity is cleared here and named by the workflow instead.
 */
const ambient: Record<string, string> = Object.fromEntries(
  Object.keys(process.env)
    .filter((name) => /^(GITHUB_|RUNNER_|CI$)/.test(name))
    .map((name) => [name, '']),
);

const run = (args: string[]) => {
  const result = spawnSync(process.execPath, [script, ...args], { encoding: 'utf8', env: { ...process.env, ...ambient } });
  return { code: result.status ?? 0, out: `${result.stdout ?? ''}${result.stderr ?? ''}` };
};

const completeLegs = required.map((leg: string) => `--leg=${leg}:success`);
const identity = ['--artifact=pdfjs-react-reader-0.12.0.tgz', `--sha256=${'0'.repeat(64)}`, '--run-id=1'];

describe('FR-58: the release-candidate record', () => {
  it('refuses a record with a leg missing, naming each one', () => {
    const r = run([...identity, ...completeLegs.slice(0, -2), `--out=${OUT}`]);
    expect(r.code, 'a record missing two legs wrote itself anyway').not.toBe(0);
    expect(r.out).toMatch(/is absent/);
    expect(r.out).toContain(required[required.length - 1]);
    expect(r.out).toContain(required[required.length - 2]);
  });

  it('refuses a leg no job runs, so the list stays the contract', () => {
    const r = run([...identity, ...completeLegs, '--leg=somehow-it-passed:success', `--out=${OUT}`]);
    expect(r.code).not.toBe(0);
    expect(r.out).toMatch(/not in the required set/);
  });

  it('refuses a green that no run and no artifact stands behind', () => {
    const noRun = run([...completeLegs, '--artifact=x.tgz', `--sha256=${'0'.repeat(64)}`, `--out=${OUT}`]);
    expect(noRun.code, 'successes with no run id were recorded as evidence').not.toBe(0);
    expect(noRun.out).toMatch(/no run id/);

    const noDigest = run([...completeLegs, '--run-id=1', `--out=${OUT}`]);
    expect(noDigest.code).not.toBe(0);
    expect(noDigest.out).toMatch(/names no artifact|its digest/);
  });

  it('refuses a conclusion a step cannot produce, and an unsigned writer', () => {
    const bad = run([...identity, ...completeLegs.slice(0, -1), '--leg=benchmarks:probably-fine', `--out=${OUT}`]);
    expect(bad.code).not.toBe(0);
    expect(bad.out).toMatch(/not a step conclusion/);

    const certified = run([...identity, ...completeLegs, '--certified=yes', `--out=${OUT}`]);
    expect(certified.code, 'a script was allowed to certify §9').not.toBe(0);
    expect(certified.out).toMatch(/§9 is signed by a person|not an option/);
  });

  it('writes a complete record, and the record cannot call itself a certification', () => {
    if (existsSync(OUT)) rmSync(OUT);
    const ok = run([...identity, ...completeLegs, '--tag=v0.12.0-rc.1', `--out=${OUT}`]);
    expect(ok.code, ok.out).toBe(0);
    const record = JSON.parse(readFileSync(OUT, 'utf8'));
    expect(record.schema).toBe('pjsr/release-candidate@1');
    expect(record.tag).toBe('v0.12.0-rc.1');
    expect(record.legs.map((l: { leg: string }) => l.leg)).toEqual(required);
    expect(record.legs.every((l: { conclusion: string }) => l.conclusion === 'success')).toBe(true);
    // Environment, date and the artifact digest are the three things §9 says evidence must carry.
    expect(record.generatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(record.environment.node).toBe(process.versions.node);
    expect(record.environment.runner).toBeTruthy();
    expect(record.artifact.sha256).toHaveLength(64);
    // and the word it is not allowed to write is still absent from what it wrote.
    expect(JSON.stringify(record)).not.toMatch(/"certification":\s*"certified/);
    expect(record.certification).toMatch(/not certified/);
  });

  it('keeps §9\u2019s React and engine axes attached to the tag', () => {
    // The candidate job does not run them and must not pretend to; CI does, on the same commit, because #272 put
    // `v*` in its triggers for exactly that reason.
    expect(ci).toMatch(/tags: \['v\*'\]/);
    expect(workflow).toMatch(/name: Release candidate/);
  });

  it('drives the browser leg at the artifact, and refuses to read from the wrong copy', () => {
    expect(workflow).toMatch(/PJSR_TARGET: dist/);
    const matrix = readFileSync(join('scripts', 'browser-matrix.mjs'), 'utf8');
    expect(matrix).toMatch(/PJSR_TARGET/);
    expect(matrix, 'the matrix may report readings from a copy it was not asked to test').toMatch(
      /was asked for and the browser got/,
    );
    const playground = readFileSync(join('playground', 'vite.config.ts'), 'utf8');
    expect(playground).toMatch(/PJSR_TARGET === 'dist'/);
  });

  it('leaves no evidence step able to be skipped by a red one above it', () => {
    // #279's finding, applied to the new job before it can make the same mistake: a step whose conclusion the
    // record carries must have an `if:` that survives an earlier failure.
    // Read per *step block*, not per line: YAML puts `if:` before `id:` in this file, and a key-order assumption
    // would make this guard pass or fail on formatting rather than on whether the step can be skipped.
    const blocks = workflow.split(/\n {6}- /);
    const ids = ['artifact', 'examples', 'upgrade', 'a11y', 'bench'];
    for (const id of ids) {
      const block = blocks.find((b) => new RegExp(`^ {8}id: ${id}$`, 'm').test(b));
      expect(block, `no step with id ${id} exists — a leg the record reads has to be produced by a step`).toBeTruthy();
      expect(block, `step ${id} can be skipped by an earlier red`).toMatch(/^\s+if: always\(\)/m);
    }
    expect(workflow).toMatch(/if-no-files-found: error/);
  });

  it('runs the artifact chain through commands that exist, not prose', () => {
    for (const command of ['check:tarball', 'check:examples', 'check:upgrade', 'test:browsers', 'a11y:browser-record', 'bench', 'verify']) {
      expect(manifest.scripts[command], `package.json has no ${command}`).toBeTruthy();
      expect(workflow, `the job does not run ${command}`).toContain(command);
    }
    expect(manifest.scripts['rc:record']).toContain('rc-record.mjs');
  });

  it('makes the upgrade check refuse its own vacuous pass', () => {
    // The first version of the reader understood only the candidate's export-map shape, so the base release looked
    // like it exposed nothing and every name comparison was true of an empty set.
    const upgrade = readFileSync(join('scripts', 'upgrade-check.mjs'), 'utf8');
    expect(upgrade).toMatch(/exposed no JS entry point/);
    expect(upgrade).toMatch(/entry\?\.default|typeof arm === 'string'/);
    expect(upgrade, 'a loss of a published name must be a failure, not a note').toMatch(/cannot disappear in a minor/);
  });
});
