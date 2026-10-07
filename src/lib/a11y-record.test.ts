/*
 * FR-58 / FR-45: the committed accessibility record, and the fields that make it evidence.
 *
 * `npm run a11y` prints axe's findings to a console, and §9 asks instead for "reproducible … accessibility
 * evidence" recorded "with its environment, operator and date". `scripts/a11y-record.mjs` now writes
 * `a11y/latest.json`, and this file is what stops that JSON from becoming a second document that describes a
 * run nobody made — the same job `src/lib/benchmark-record.test.ts` does for the benchmark half.
 *
 * The rules are the kind that fail:
 *
 *  - the **toolchain the record names is the one installed now**, for the packages every cell pins: axe 4.13 and
 *    axe 4.14 disagree about real rules — #244's CI cell failed on exactly that difference — so a record whose
 *    `axeCore` does not match `node_modules` describes a different audit than the one this repository runs.
 *    React is the exception and is checked against the advertised peer range instead, because React is the axis
 *    the `react` job varies; the case that demanded equality turned both React 18 cells red (#262);
 *  - the ruleset claim is **read out of the harness**, not restated here, so a record cannot quietly start
 *    claiming a WCAG level the audits do not ask axe for;
 *  - an entry with zero passing rules is not "clean", it is an audit that saw nothing (lesson 22 — the same
 *    trap that let a set-membership assertion pass on an empty `incomplete` list);
 *  - **at least one entry must be marked as expected to fail.** The record is evidence about the shell *and*
 *    about the audit's reach: `a11y.ready.test.tsx` puts a defect into the mounted sidebar on purpose, and a
 *    record in which that entry has gone missing is a record of an instrument that stopped being able to say
 *    "no";
 *  - the derived figures in `totals` must equal the entries they are derived from.
 *
 * It never re-runs the audits — that needs jsdom and several seconds, and the record is read by the `node`
 * project on purpose. Regenerate it with `npm run a11y:record`, which also refuses to write a record when the
 * audit run is red.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import packageJson from '../../package.json';

interface AuditEntry {
  test: string;
  file: string;
  violations: string[];
  incomplete: Array<{ id: string; reason: string }>;
  passes: number;
  expectViolation: boolean;
}

interface RecordShape {
  schema: number;
  producedBy: string;
  environment: Record<string, string>;
  standard: { source: string; tags: string[]; harness: string; note: string };
  totals: {
    audits: number;
    expectedToBeClean: number;
    expectedToFail: number;
    violationsRecorded: number;
    rulesIncomplete: string[];
  };
  audits: AuditEntry[];
}

const PATH = join(process.cwd(), 'a11y', 'latest.json');

function load(): RecordShape {
  if (!existsSync(PATH)) {
    throw new Error(
      `${PATH} is missing. It is the accessibility evidence §9 asks for — produce it with \`npm run a11y:record\` and commit it.`,
    );
  }
  return JSON.parse(readFileSync(PATH, 'utf8')) as RecordShape;
}

/** An installed version read out of the package's own manifest: `require(name + '/package.json')` throws for
 * packages that restrict `exports`, which is the trap #244 documented. */
function installed(name: string): string {
  return JSON.parse(readFileSync(join(process.cwd(), 'node_modules', name, 'package.json'), 'utf8')).version as string;
}

/** The react peer range the manifest advertises, read rather than restated here. */
function peerRange(): string {
  const range = String(packageJson.peerDependencies.react ?? '');
  if (!range) throw new Error('package.json advertises no react peer range for this check to read');
  return range;
}

/** The majors that range names. Only the `^N.n.n` union form is understood; anything else throws. */
function reactMajorRange(): string[] {
  const range = peerRange();
  const majors = [...range.matchAll(/\^(\d+)\.\d+\.\d+/g)].map((match) => match[1]!);
  if (!majors.length) {
    throw new Error(`the react peer range "${range}" names no caret major, and this check understands only that form`);
  }
  return majors;
}

/** The tag list the harness actually hands axe, read from the source rather than copied. */
function harnessTags(): string[] {
  const source = readFileSync(join(process.cwd(), 'src', 'components', 'axe-audit-harness.ts'), 'utf8');
  const match = /values:\s*\[([^\]]*)\]/.exec(source);
  const [, tags] = match ?? [];
  if (!tags) throw new Error('the axe harness no longer spells its rule tags in a `values: [...]` list');
  return tags
    .split(',')
    .map((s) => s.trim().replace(/^['"]|['"]$/g, ''))
    .filter(Boolean);
}

describe('the committed accessibility record (FR-58)', () => {
  it('is readable, versioned, and says what produced it', () => {
    const r = load();
    expect(r.schema, 'a reader of an old record checks the schema first').toBeGreaterThan(0);
    expect(r.producedBy).toContain('a11y-record');
    expect(r.audits.length, 'a record with no audits is not evidence about anything').toBeGreaterThanOrEqual(15);
  });

  it('names the toolchain that is installed in this tree right now', () => {
    const env = load().environment;
    for (const [key, pattern, label] of [
      ['machine', /\S/, 'the machine it ran on'],
      ['platform', /^(win32|darwin|linux)$/, 'the operating system'],
      ['osRelease', /\d/, 'the OS release'],
      ['node', /^v\d+\.\d+\.\d+/, 'the Node that drove vitest'],
      ['ranAt', /^\d{4}-\d{2}-\d{2}T\d{2}:/, 'the date §9 asks the evidence to carry'],
      ['revision', /^[0-9a-f]{40}$|^unknown$/, 'the commit the numbers came from'],
    ] as Array<[string, RegExp, string]>) {
      expect(String(env[key] ?? ''), `${label} is missing or empty in the record`).toMatch(pattern);
    }
    // The teeth: a record about axe 4.13 says nothing about a suite that now runs axe 4.14.
    for (const name of ['axe-core', 'jsdom', 'vitest']) {
      const key = name === 'axe-core' ? 'axeCore' : name;
      expect(env[key], `${name} is not named in the record at all`).toBeTruthy();
      expect(String(env[key]), `the record was made against ${name} ${env[key]}, and this tree installs ${name} ${installed(name)}`).toBe(
        installed(name),
      );
    }
    /*
     * React is deliberately not compared with this tree, and the reason is a red CI run rather than a preference.
     * React is the axis the `react` job varies, so equality would have the React 18 cells refuse a record the
     * verify job legitimately produced — which is what the first version of this case did: CI run 37631611428,
     * both React 18 cells red on `the record was made against react 19.3.0, and this tree installs react 18.3.1`,
     * one failing test in each, 1,298 passing. The axe/jsdom/vitest comparisons above stay exact because #244
     * pins those in every cell; this one is the tree the matrix is allowed to change. What the record still has
     * to satisfy is the range the package advertises, so a record made against a React this package does not
     * support is refused, and a React move in `package.json` moves this check with it rather than leaving a
     * second list to rot.
     */
    const react = String(env.react ?? '');
    expect(react, 'react is not named in the record at all').toMatch(/^\d+\.\d+\.\d+/);
    const majors = reactMajorRange();
    expect(
      majors.includes(react.split('.')[0]!),
      `the record was made against react ${react}, which is outside the advertised peer range ${peerRange()}`,
    ).toBe(true);
  });

  it('claims exactly the ruleset the harness asks axe for', () => {
    const r = load();
    expect(r.standard.tags, 'the record and the harness disagree about which WCAG tags were run').toEqual(harnessTags());
    expect(r.standard.source).toMatch(/FR-45/);
  });

  it('holds an entry per audit, each with the tree it looked at', () => {
    const r = load();
    for (const a of r.audits) {
      expect(a.test.length, 'an audit entry with no test name identifies nothing').toBeGreaterThan(0);
      expect(a.file, 'an audit entry with no file cannot be opened by a reader').toMatch(/\.tsx?$/);
      expect(existsSync(join(process.cwd(), 'src', a.file)), `src/${a.file} is not a file in this tree`).toBe(true);
      /*
       * `passes > 0` is the clause with teeth: an empty subtree has no violations either, and an audit that
       * reached nothing would otherwise read as a clean run.
       */
      expect(a.passes, `${a.test}: the audit found nothing to check, which is not the same as finding no defect`).toBeGreaterThan(0);
      for (const inc of a.incomplete) {
        expect(inc.reason.trim(), `${a.test}: ${inc.id} reported incomplete with no reason`).toBeTruthy();
      }
    }
    const ids = r.audits.map((a) => `${a.file}::${a.test}`);
    expect(new Set(ids).size, 'two entries carry the same test name, so the record cannot be traced to one case').toBe(
      ids.length,
    );
  });

  it('is clean where it should be and dirty where it says it should be', () => {
    const r = load();
    const unexpected = r.audits.filter((a) => !a.expectViolation && a.violations.length > 0);
    expect(unexpected.map((a) => `${a.test}: ${a.violations.join(', ')}`), 'the record carries violations the audit did not declare').toEqual([]);
    // An audit that cannot report a violation is not evidence — the house counterfactual rule, in the record.
    expect(
      r.audits.filter((a) => a.expectViolation).length,
      'no entry in the record is a tree with a defect put in on purpose, so nothing here proves the audit can fail',
    ).toBeGreaterThan(0);
    for (const a of r.audits.filter((a) => a.expectViolation)) {
      expect(a.violations.length, `${a.test} was supposed to fail and reported nothing`).toBeGreaterThan(0);
    }
  });

  it('derives its totals from its entries instead of asserting them', () => {
    const r = load();
    expect(r.totals.audits).toBe(r.audits.length);
    expect(r.totals.expectedToBeClean).toBe(r.audits.filter((a) => !a.expectViolation).length);
    expect(r.totals.expectedToFail).toBe(r.audits.filter((a) => a.expectViolation).length);
    expect(r.totals.violationsRecorded).toBe(r.audits.reduce((n, a) => n + a.violations.length, 0));
    const fromEntries = [...new Set(r.audits.flatMap((a) => a.incomplete.map((i) => i.id)))].sort();
    expect(r.totals.rulesIncomplete, 'the record’s incomplete-rule list is not the set its entries report').toEqual(fromEntries);
    /*
     * The blind spots have to still be there. Their absence would not mean the shell got better — it would
     * mean the audit stopped seeing them, which is the empty-list failure lesson 22 names. Colour contrast is
     * FR-45 gap[1] and touch geometry is the browser matrix's `toolbar-fold` row: both stay open, and the
     * record says so rather than reading as a full pass.
     */
    for (const blind of ['color-contrast', 'aria-hidden-focus']) {
      expect(fromEntries, `the record no longer reports ${blind} as a blind spot — check the audit, not the shell`).toContain(blind);
    }
  });
});
