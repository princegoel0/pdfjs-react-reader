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
  candidateNotes,
  candidateProblems,
  ciProblems,
  deriveCandidatePasses,
  main,
  registryProblems,
  releaseOrderProblems,
  requiredLegsFrom,
} from '../../scripts/release-validate.mjs';
import { expectedDigest, preflightProblems, readbackProblems } from '../../scripts/publish-preflight.mjs';

const repo = process.cwd();
const SHA = '0123456789abcdef0123456789abcdef01234567';
/** The commit the release candidate runs on, and the one the tag names. */
const TAGGED = 'ffffffffffffffffffffffffffffffffffffffff';
/** The commit that carries the record the candidate produced, so it is necessarily later than `TAGGED`. */
const RELEASE_COMMIT = 'eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee';
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
  tagCommit: () => SHA,
  changedBetween: () => [],
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

/**
 * FR-58: the gate must be satisfiable by the workflow that feeds it.
 *
 * The first version required *every* bound record to be all-green, and `release-candidate.yml` runs the benchmark
 * leg on one runner class only — the one with an accepted entry in `benchmarks/baseline.json`. So the other
 * class's record was `benchmarks: skipped` by design and no release could ever have passed. Measured 2026-11-11
 * against the two records the workflow writes. Nothing here relaxes "a skipped leg is not a pass": a skip is
 * lawful only on a record that is not the certifying one, and only when a green record on the same commit ran
 * that leg. The classes and the gated leg are read out of the workflow rather than typed, so a change to either
 * moves these cases instead of leaving them asserting a shape the runner no longer produces.
 */
describe('FR-58: a candidate the workflow can produce is one the gate can pass', () => {
  const names = requiredLegsFrom(readFileSync(`${repo}/scripts/rc-record.mjs`, 'utf8'));
  const yml = readFileSync(`${repo}/.github/workflows/release-candidate.yml`, 'utf8');
  /** A reader of the runner's own shape throws rather than defaults, so a moved step is a failure, not a `''`. */
  const capture = (text: string, pattern: RegExp, what: string): string => {
    const found = pattern.exec(text)?.[1];
    if (!found) throw new Error(`release-candidate.yml no longer writes ${what} where these cases read it`);
    return found;
  };
  const classes = capture(yml, /node: \[([^\]]+)\]/, 'the node matrix')
    .split(',')
    .map((entry) => capture(entry.trim(), /^'([^']+)'$/, `a quoted node version (${entry.trim()})`));
  const benchClass = capture(
    yml,
    /- name: Run the benchmarks[\s\S]*?if:[^\n]*matrix\.node == '([^']+)'/,
    'the class the benchmark leg is gated to',
  );
  const otherClass = capture(classes.filter((c) => c !== benchClass).join(','), /^([^,]+)$/, 'exactly one other class');
  const fileFor = (node: string) => `release/last-candidate-node${node}.json`;
  const record = (file: string, over: Record<string, string> = {}) => ({
    file,
    tag: `v${VERSION}`,
    commit: SHA,
    artifact: { file: `${NAME}-${VERSION}.tgz`, sha256: 'a'.repeat(64) },
    legs: names.map((n) => leg(n, over[n] ?? 'success')),
  });
  /** Exactly what the workflow writes: the gated class green, every other class skipping the gated leg. */
  const asWritten = () =>
    classes.map((node) => record(fileFor(node), node === benchClass ? {} : { benchmarks: 'skipped' }));

  it('reads the workflow rather than assuming its shape', () => {
    expect(classes.length, 'the candidate matrix must have more than one class for this trap to exist').toBeGreaterThan(1);
    expect(classes, 'the benchmark leg must be gated to a class named in the matrix').toContain(benchClass);
    expect(otherClass).not.toBe(benchClass);
    expect(names, 'the gated leg must be one rc-record requires').toContain('benchmarks');
  });

  /**
   * A digest nobody can retrieve is a promise, not evidence. `publish:readback` compares the registry's tarball
   * against the record's sha256, and a laptop's `npm pack` is not those bytes — this tree checks out CRLF on
   * Windows while the runner packs the LF blobs — so the run must keep the artifact it digested.
   */
  it('keeps the bytes its digest names, so the artifact published can be the artifact tested', () => {
    const upload = capture(
      yml,
      /- name: Upload the packed artifact the record binds\r?\n([\s\S]*?)(?=\r?\n {6}- name: |\s*$)/,
      'the packed-artifact upload step',
    );
    expect(upload, 'the upload must wait for a pack that produced a file').toMatch(/steps\.pack\.outcome == 'success'/);
    expect(upload, 'the uploaded file must be the one the record digests').toMatch(
      /path: \$\{\{ steps\.pack\.outputs\.tarball \}\}/,
    );
    expect(upload, 'a missing tarball must fail the run rather than upload nothing').toMatch(/if-no-files-found: error/);
    expect(yml, 'the digest must come from the same pack step as the uploaded file').toMatch(
      /--sha256="\$\{\{ steps\.pack\.outputs\.sha256 \}\}"/,
    );
  });

  it('passes the records the workflow writes, and names the class that did not measure', () => {
    const records = asWritten();
    expect(candidateProblems(records, { version: VERSION, sha: SHA })).toEqual([]);
    const skipped = records.filter((r) => r.legs.some((l) => l.conclusion === 'skipped'));
    expect(candidateNotes(records, { version: VERSION, sha: SHA })).toEqual(
      skipped.map((r) => `${r.file}: benchmarks not run on this class — certified by ${fileFor(benchClass)}`),
    );
  });

  it('still refuses every way a skip could be laundered into a pass', () => {
    const onlySkipped = [record(fileFor(otherClass), { benchmarks: 'skipped' })];
    expect(candidateProblems(onlySkipped, { version: VERSION, sha: SHA }).join(' ')).toMatch(
      /no candidate record .* certifies every leg/,
    );
    expect(candidateProblems(onlySkipped, { version: VERSION, sha: SHA }).join(' ')).toMatch(
      /no green record on this commit certifies it/,
    );
    const allSkipped = classes.map((c) => record(fileFor(c), { benchmarks: 'skipped' }));
    expect(candidateProblems(allSkipped, { version: VERSION, sha: SHA }).join(' ')).toMatch(/certifies every leg/);
    // A leg no class ran is not a leg that passed, even when every other leg is green somewhere.
    const nobodyRanIt = classes.map((c) => record(fileFor(c), { 'upgrade-path': 'skipped' }));
    expect(candidateProblems(nobodyRanIt, { version: VERSION, sha: SHA }).join(' ')).toMatch(
      /upgrade-path skipped, and no green record/,
    );
  });

  it('refuses a leg that ran and broke on any class, not only on the certifying one', () => {
    for (const conclusion of ['failure', 'cancelled']) {
      const records = [record(fileFor(benchClass)), record(fileFor(otherClass), { 'verify-chain': conclusion })];
      expect(candidateProblems(records, { version: VERSION, sha: SHA }).join(' ')).toMatch(
        new RegExp(`verify-chain=${conclusion}.*tested on this runner class and broke there`),
      );
    }
    const absent = [record(fileFor(benchClass)), record(fileFor(otherClass), { benchmarks: 'absent' })];
    expect(candidateProblems(absent, { version: VERSION, sha: SHA }).join(' ')).toMatch(
      /an absent leg reads exactly like one that passed/,
    );
  });

  it('refuses two green records that bind different artifacts', () => {
    const records = classes.map((c, i) => {
      const one = record(fileFor(c));
      return i === 1 ? { ...one, artifact: { ...one.artifact, sha256: 'c'.repeat(64) } } : one;
    });
    expect(candidateProblems(records, { version: VERSION, sha: SHA })).toEqual([
      expect.stringContaining('bind 2 different artifact digests'),
    ]);
  });

  it('keeps the record’s own verdict strict, so a skipped leg never reads as a pass in the file', () => {
    expect(deriveCandidatePasses(record(fileFor(otherClass), { benchmarks: 'skipped' }).legs)).toEqual({
      passes: false,
      notPassed: ['benchmarks=skipped'],
    });
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

  it('refuses when the version has no tag at all, which is the publish-before-tag order this gate exists to stop', () => {
    expect(releaseOrderProblems({ tagName: `v${VERSION}`, taggedSha: '', headSha: SHA, changed: [] })).toEqual([
      expect.stringContaining(`no tag v${VERSION}`),
    ]);
    // The tag exists and names another commit; HEAD is neither it nor a descendant, so nothing can say the
    // published tree is the tested tree. `changed: null` is what `git diff` reports when the range is invalid.
    expect(
      releaseOrderProblems({ tagName: `v${VERSION}`, taggedSha: TAGGED, headSha: SHA, changed: null }),
    ).toEqual([expect.stringContaining('not the tagged commit')]);
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
    expect(pkg.scripts['publish:preflight']).toBe('node scripts/publish-preflight.mjs');
    expect(pkg.scripts['publish:readback']).toBe('node scripts/publish-preflight.mjs --readback');
    expect(pkg.scripts.verify).toMatch(/check:fr-evidence$/);
  });
});

describe('FR-58: the release order the gate must be able to satisfy', () => {
  /*
   * The trap this case was written to catch, found by walking the publish order rather than by testing one rule
   * at a time. A candidate record can only be produced by a run, so it is committed *after* the commit that run
   * tested; and the tag has to name the tested commit, because that is the state whose artifact digest the record
   * carries. So the published tree is the tagged commit **plus** the record file. A gate that requires
   * `record.commit === HEAD` *and* an exactly-tagged HEAD asks for a commit that contains a record naming a
   * different commit while also being that other commit — nothing can satisfy both arms, and the suite missed it
   * because each rule was falsified in isolation.
   */
  it('accepts the tagged candidate with only the record and the changelog committed on top', async () => {
    const code = await main(
      deps({
        headSha: () => RELEASE_COMMIT,
        tagCommit: () => TAGGED,
        changedBetween: () => ['CHANGELOG.md', 'release/last-candidate.json', 'release/last-candidate-node24.json'],
        records: () => [greenRecord({ file: 'release/last-candidate.json', commit: TAGGED })],
        jobs: async () => greenRun(),
      }),
    );
    expect(code).toBe(0);
  });

  it('refuses when something that reaches the tarball changed between the tag and HEAD', async () => {
    const code = await main(
      deps({
        headSha: () => RELEASE_COMMIT,
        tagCommit: () => TAGGED,
        changedBetween: () => ['src/components/PdfViewer.tsx', 'CHANGELOG.md'],
        records: () => [greenRecord({ file: 'release/last-candidate.json', commit: TAGGED })],
      }),
    );
    expect(code).toBe(1);
  });

  it('refuses a tag that does not resolve, and a HEAD that is not the tagged commit or its descendant', async () => {
    expect(
      releaseOrderProblems({ tagName: `v${VERSION}`, taggedSha: '', headSha: RELEASE_COMMIT, changed: null }),
    ).toEqual([expect.stringContaining(`no tag v${VERSION}`)]);
    expect(
      releaseOrderProblems({ tagName: `v${VERSION}`, taggedSha: TAGGED, headSha: RELEASE_COMMIT, changed: null }),
    ).toEqual([expect.stringContaining('not the tagged commit')]);
    expect(releaseOrderProblems({ tagName: `v${VERSION}`, taggedSha: TAGGED, headSha: TAGGED, changed: [] })).toEqual(
      [],
    );
  });

  it('binds the candidate record to the tagged commit, not to the commit that carries the file', () => {
    const record = greenRecord({ file: 'release/last-candidate.json', commit: TAGGED });
    expect(candidateProblems([record], { version: VERSION, sha: TAGGED })).toEqual([]);
    expect(candidateProblems([record], { version: VERSION, sha: RELEASE_COMMIT })).toEqual([
      expect.stringContaining('the tagged commit'),
    ]);
  });
});

describe('FR-58: the registry write is prefaced and followed, not just attempted', () => {
  const clean = {
    version: VERSION,
    name: NAME,
    whoami: 'princegoel072',
    packument: { versions: {} },
    tagName: `v${VERSION}`,
    taggedSha: SHA,
    headSha: SHA,
    changed: [],
    dirty: '',
    dryRunOk: true,
  };

  it('refuses an unauthenticated host, a dirty tree, a missing tag or a taken version', () => {
    expect(preflightProblems({ ...clean, whoami: '' }).join(' ')).toMatch(/npm is not authenticated/);
    // #207's lesson is that a name is not proof the write will be accepted — a Publish-type token is refused
    // `EOTP` by `npm deprecate`, so the message has to point at the token type rather than its presence.
    expect(preflightProblems({ ...clean, whoami: '' }).join(' ')).toMatch(/token type/);
    expect(preflightProblems({ ...clean, dirty: ' M src/lib/x.ts\n M package.json' }).join(' ')).toMatch(/working tree is dirty \(2 file\(s\)\)/);
    expect(preflightProblems({ ...clean, taggedSha: '' }).join(' ')).toMatch(new RegExp(`no tag v${VERSION.replace('.', '\\.')}`));
    expect(preflightProblems({ ...clean, packument: { versions: { [VERSION]: {} } } }).join(' ')).toMatch(/burned permanently/);
    expect(preflightProblems({ ...clean, dryRunOk: false }).join(' ')).toMatch(/cannot be built/);
    expect(preflightProblems(clean)).toEqual([]);
  });

  it('accepts the release commit that carries the record, because the tag cannot name a file it does not contain', () => {
    expect(preflightProblems({ ...clean, headSha: RELEASE_COMMIT, changed: ['CHANGELOG.md', 'release/last-candidate.json'] })).toEqual([]);
    expect(preflightProblems({ ...clean, headSha: RELEASE_COMMIT, changed: ['src/index.ts'] }).join(' ')).toMatch(
      /beyond the release evidence/,
    );
  });

  it('names a green candidate digest only when one green record binds one digest', () => {
    const legs = requiredLegsFrom(readFileSync(`${repo}/scripts/rc-record.mjs`, 'utf8')).map((l) => leg(l));
    const green = { tag: `v${VERSION}`, commit: SHA, legs, artifact: { file: 'a.tgz', sha256: 'b'.repeat(64) } };
    expect(expectedDigest([green])).toBe('b'.repeat(64));
    // rc.1's three records describe one tarball: the merged file and the Node 24 cell skipped `benchmarks`, so
    // only the Node 22.13.0 cell is green — and its digest is what a published tarball must be compared against.
    const records = ['release/last-candidate.json', 'release/last-candidate-node22.13.0.json', 'release/last-candidate-node24.json'].map(
      (file) => ({ file, ...JSON.parse(readFileSync(`${repo}/${file}`, 'utf8')) }),
    );
    const node22 = records.find((r) => r.file.endsWith('node22.13.0.json'));
    expect(expectedDigest(records), `expected one digest, got ${expectedDigest(records)}`).toBe(node22?.artifact?.sha256);
    const merged = records.find((r) => r.file === 'release/last-candidate.json');
    expect(deriveCandidatePasses(merged?.legs ?? []), 'the merged record must stay not-green while a leg was skipped').toMatchObject({
      passes: false,
    });
    expect(expectedDigest([{ legs: [leg('verify-chain', 'failure')], artifact: { sha256: 'c'.repeat(64) } }])).toBeNull();
  });

  it('treats a lagging registry as a re-run, never as a licence to publish again', () => {
    const ok = {
      version: VERSION,
      name: NAME,
      packument: { versions: { [VERSION]: {} }, 'dist-tags': { latest: VERSION } },
      downloaded: true,
      latestTag: VERSION,
      digest: 'b'.repeat(64),
      bound: 'b'.repeat(64),
    };
    expect(readbackProblems(ok)).toEqual([]);
    expect(readbackProblems({ ...ok, latestTag: '0.1.2' }).join(' ')).toMatch(/re-run before you re-publish/);
    expect(readbackProblems({ ...ok, packument: { versions: {}, 'dist-tags': { latest: VERSION } } }).join(' ')).toMatch(/absence is not proof/);
    expect(readbackProblems({ ...ok, digest: 'd'.repeat(64) }).join(' ')).toMatch(/is not the digest the green candidate record bound/);
    expect(readbackProblems({ ...ok, bound: null }).join(' ')).toMatch(/nothing to be compared against/);
    expect(readbackProblems({ ...ok, downloaded: false, digest: '' }).join(' ')).toMatch(/read-back did not happen/);
    // An unpublished version must read as "not there yet", not as four complaints including a hash of nothing.
    const unpublished = { ...ok, packument: { versions: {}, 'dist-tags': { latest: '0.1.2' } }, latestTag: '0.1.2', downloaded: false, digest: '' };
    expect(readbackProblems(unpublished).join(' ')).toMatch(/re-run before you re-publish/);
    expect(readbackProblems(unpublished).join(' '), readbackProblems(unpublished).join(' ')).not.toMatch(/sha256/);
  });
});
