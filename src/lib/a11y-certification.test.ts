/**
 * FR-45's fourth evidence leg: the screen-reader pass, and the record that refuses to invent one.
 *
 * FR-45 splits its evidence four ways and closes by saying an automated audit is not proof of full conformance.
 * Three legs have files something writes; the fourth — NVDA with Firefox, JAWS with Chromium, VoiceOver with
 * Safari — had nothing. `scripts/a11y-certify.mjs` now writes the log and `a11y/certifications.json` carries
 * today's honest reading: three pairings, none run, each with the thing that is missing named.
 *
 * What these cases hold is the *discipline*, because a record nobody can make fail is a claim:
 *
 *  - the pairings and the six tasks come out of FR-45's own sentence, and a clause this script cannot parse
 *    stops rather than recording a shorter list;
 *  - `--check` catches a missing pairing (the vacuous-pass shape this repository has been bitten by before: a
 *    comparison over an empty set is true of nothing);
 *  - a `pass` is unrecordable without a person, a real date, a named environment, all six tasks and an artifact
 *    that exists;
 *  - the refusals are driven against a scratch copy, so the committed record is never the thing under test;
 *  - and one positive case writes a complete pass, which is what makes the eight refusals above evidence of
 *    rules rather than evidence of a script that always says no.
 */
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it, afterAll } from 'vitest';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const SCRIPT = join(root, 'scripts', 'a11y-certify.mjs');
const RECORD = join(root, 'a11y', 'certifications.json');
const work = mkdtempSync(join(tmpdir(), 'pjsr-cert-'));

afterAll(() => rmSync(work, { recursive: true, force: true }));

type Row = {
  screenReader: string;
  browser: string;
  status: string;
  operator: string | null;
  date: string | null;
  environment: string | null;
  blocker?: string | null;
  tasks: { name: string; done: boolean }[];
  evidence: string[];
};
type Record = { schema: string; pairings: Row[] };

const run = (...args: string[]) => {
  const r = spawnNode(args);
  return { code: r.status, out: `${r.stdout ?? ''}${r.stderr ?? ''}` };
};

function spawnNode(args: string[]) {
  return spawnSync(process.execPath, [SCRIPT, ...args], { encoding: 'utf8' });
}

const required = (() => {
  const row = readFileSync(join(root, 'PRD.md'), 'utf8').split('\n').find((l) => l.startsWith('| **FR-45** |'));
  if (!row) throw new Error('FR-45 is not in PRD.md');
  return row;
})();

const record = JSON.parse(readFileSync(RECORD, 'utf8')) as Record;

describe('FR-45: the pass is defined by the clause, not by a list typed next to the script', () => {
  it('derives exactly the three pairings FR-45 names', () => {
    const out = run();
    expect(out.code).toBe(0);
    expect(out.out).toMatch(/NVDA\+Firefox/);
    expect(out.out).toMatch(/JAWS\+Chromium/);
    expect(out.out).toMatch(/VoiceOver\+Safari/);
    expect(out.out).toMatch(/requires 3 pairings/);
    // The clause is the source; a PRD edit that renames a reader has to move the record with it.
    expect(required).toMatch(/NVDA with Firefox, JAWS with Chromium, and VoiceOver with Safari/);
  });

  it('splits the six tasks even though the clause has no Oxford comma', () => {
    // "…forms, annotations and tagged structure where applicable" — a comma-only split reads five tasks and the
    // record then checks six of nothing. This is the shape that bit the first version of the script.
    const out = run();
    expect(out.out).toMatch(/over 6 tasks \(loading, navigation, search, forms, annotations, tagged structure\)/);
    expect(out.out).not.toMatch(/annotations and tagged structure/);
  });
});

describe("FR-45: today's record says what has not happened", () => {
  it('carries one row per required pairing, and every row explains its absence', () => {
    expect(record.schema).toBe('pjsr/a11y-certification@1');
    expect(record.pairings.map((p) => `${p.screenReader}+${p.browser}`)).toEqual([
      'NVDA+Firefox',
      'JAWS+Chromium',
      'VoiceOver+Safari',
    ]);
    for (const p of record.pairings) {
      expect(p.status, `${p.screenReader} claims ${p.status} with no session behind it`).toBe('not-run');
      expect((p.blocker ?? '').length, `${p.screenReader}: a not-run with a shrug is not a blocker`).toBeGreaterThan(
        60,
      );
      expect(p.blocker).not.toMatch(/^(not yet|todo|tbd|n\/a)[\s.]*$/i);
      expect(p.tasks.map((t) => t.done)).not.toContain(true);
    }
  });

  it('passes its own gate', () => {
    const out = run('--check');
    expect(out.code).toBe(0);
    expect(out.out).toMatch(/consistent with FR-45/);
  });

  it('fails the gate when a pairing goes missing from the record', () => {
    // Without this case, `--check` could be passing because it is asking nothing of a shorter file.
    const file = join(work, 'missing.json');
    const trimmed: Record = { ...record, pairings: record.pairings.slice(0, 2) };
    writeFileSync(file, `${JSON.stringify(trimmed, null, 2)}\n`);
    const out = run('--check', `--file=${file}`);
    expect(out.code).toBe(1);
    expect(out.out).toMatch(/FR-45 requires \[NVDA\+Firefox, JAWS\+Chromium, VoiceOver\+Safari\]/);
  });
});

describe('FR-45: a pass cannot be written without the things that make it a pass', () => {
  const base = ['--record=NVDA+Firefox', '--environment=Windows 11 23H2 with NVDA 2026.1', '--evidence=PRD.md'];
  const allTasks = '--tasks=loading,navigation,search,forms,annotations,tagged structure';

  const refuse = (args: string[], message: RegExp, label: string) => {
    const file = join(work, `refuse-${label}.json`);
    writeFileSync(file, `${JSON.stringify(record, null, 2)}\n`);
    const out = run(...args, `--file=${file}`);
    expect(out.code, out.out).toBe(2);
    expect(out.out).toMatch(message);
  };

  it('refuses a pass with no person named', () => {
    refuse(
      ['--status=pass', '--date=2026-10-01', allTasks, ...base],
      /needs a person.s name/,
      'operator',
    );
  });

  it('refuses "qa" as a person', () => {
    refuse(
      ['--status=pass', '--operator=qa', '--date=2026-10-01', allTasks, ...base],
      /is not one/,
      'generic-operator',
    );
  });

  it('refuses a pass that did not cover all six tasks', () => {
    refuse(
      [
        '--status=pass',
        '--operator=A. Tester',
        '--date=2026-10-01',
        '--tasks=loading,navigation,search,forms',
        ...base,
      ],
      /only 4\/6 tasks were done/,
      'tasks',
    );
  });

  it('refuses a pass that names an artifact which is not in the tree', () => {
    refuse(
      [
        '--record=NVDA+Firefox',
        '--status=pass',
        '--operator=A. Tester',
        '--date=2026-10-01',
        allTasks,
        '--environment=Windows 11 23H2 with NVDA 2026.1',
        '--evidence=logs/does-not-exist.md',
      ],
      /which is not in the tree/,
      'evidence',
    );
  });

  it('refuses a pass with no artifact at all', () => {
    refuse(
      [
        '--record=NVDA+Firefox',
        '--status=pass',
        '--operator=A. Tester',
        '--date=2026-10-01',
        allTasks,
        '--environment=Windows 11 23H2 with NVDA 2026.1',
      ],
      /no artifact behind it is a sentence/,
      'no-evidence',
    );
  });

  it('refuses a date in the future', () => {
    refuse(
      ['--status=pass', '--operator=A. Tester', '--date=2999-01-01', allTasks, ...base],
      /is in the future/,
      'future',
    );
  });

  it('refuses a not-run row that names nothing it is missing', () => {
    const file = join(work, 'refuse-blank.json');
    writeFileSync(file, `${JSON.stringify(record, null, 2)}\n`);
    const out = run('--record=JAWS+Chromium', '--status=not-run', `--file=${file}`);
    expect(out.code, out.out).toBe(2);
    expect(out.out).toMatch(/has to name the thing that is missing/);
  });

  it('writes the pass when every part of it is there', () => {
    // The positive half: eight refusals prove nothing about a script that rejects every input.
    const file = join(work, 'accept.json');
    writeFileSync(file, `${JSON.stringify(record, null, 2)}\n`);
    const out = run(
      '--record=NVDA+Firefox',
      '--status=pass',
      '--operator=A. Tester',
      '--date=2026-10-01',
      allTasks,
      ...base,
      `--file=${file}`,
    );
    expect(out.code, out.out).toBe(0);
    const written = JSON.parse(readFileSync(file, 'utf8')) as Record;
    const row = written.pairings.find((p) => p.screenReader === 'NVDA')!;
    expect(row.status).toBe('pass');
    expect(row.tasks.filter((t) => t.done)).toHaveLength(6);
    // …and the gate still reads the whole file, so a completed row cannot smuggle the set rule out.
    expect(run('--check', `--file=${file}`).code).toBe(0);
  });
});

describe('FR-45: no document may claim a pass the record does not carry', () => {
  /** The sentence shape a claim would take, kept as a constant so its own bite can be demonstrated. */
  const CLAIM = /(NVDA|JAWS|VoiceOver)[^\n]{0,90}\b(passed|certified|completed|signed off)\b/i;

  it('recognises the claim when it is written', () => {
    expect(CLAIM.test('NVDA+Firefox pass completed on 2026-11-01 by the operator.')).toBe(true);
  });

  it('finds none of them in the docs, README or ROADMAP while the record has no pass', () => {
    expect(record.pairings.some((p) => p.status === 'pass')).toBe(false);
    const files = [
      join(root, 'README.md'),
      join(root, 'ROADMAP.md'),
      join(root, 'docs', 'src', 'pages', 'Accessibility.tsx'),
    ];
    for (const f of files) {
      const text = readFileSync(f, 'utf8');
      expect(CLAIM.test(text), `${f} claims a screen-reader pass nobody recorded`).toBe(false);
    }
  });

  it('points a reader at the log and the command that writes it', () => {
    const page = readFileSync(join(root, 'docs', 'src', 'pages', 'Accessibility.tsx'), 'utf8');
    expect(page).toContain('a11y/certifications.json');
    expect(page).toContain('a11y:certify');
  });
});
