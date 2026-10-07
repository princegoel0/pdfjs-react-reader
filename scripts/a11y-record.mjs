/*
 * FR-58: the accessibility run becomes a committed record instead of a console log.
 *
 * §9's release gate asks for "reproducible benchmark and accessibility evidence", and "evidence that cannot run
 * on the primary development machine … recorded with its environment, operator and date". The benchmark half
 * got that in W8 (`benchmarks/latest.json` plus `src/lib/benchmark-record.test.ts`); the accessibility half was
 * still printed to a stdout that ends with the job. This writes the other half: one entry per audit, gathered
 * by `recordAudit` in `src/components/axe-audit-harness.ts` while the `a11y` project runs, wrapped here in the
 * environment that makes the numbers mean anything.
 *
 * Two things are deliberate.
 *
 *  - **It runs the same tests, it does not invent any.** The record is a by-product of the real serialised a11y
 *    project (#216), so an audit that fails produces no record at all rather than a file describing a run that
 *    did not happen.
 *  - **`npm test` and `npm run a11y` write nothing.** A tracked file rewritten by every test run leaves the
 *    working tree permanently dirty, and the clean-checkout condition is part of every gate here. The record
 *    changes when someone asks for it, which is also how `npm run bench` works.
 *
 * The axe tag set is read out of the harness rather than restated here, because a record that names the
 * standards it claims to check has to be wrong in the same place as the check, not in a second place.
 */
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir, hostname, platform, release } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { auditTags } from './axe-tags.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(root, 'a11y', 'latest.json');

/** A version read out of an installed package's own manifest — not `require(name + '/package.json')`, which
 * throws for packages that restrict `exports` (the lesson #244 left behind). */
function installedVersion(name) {
  try {
    return JSON.parse(readFileSync(join(root, 'node_modules', name, 'package.json'), 'utf8')).version;
  } catch {
    return `${name} is not installed`;
  }
}

function revision() {
  const r = spawnSync('git rev-parse HEAD', { cwd: root, encoding: 'utf8', shell: true });
  return r.status === 0 ? String(r.stdout).trim() : 'unknown';
}

const work = mkdtempSync(join(tmpdir(), 'pjsr-a11y-record-'));
const raw = join(work, 'audits.json');

let status = 1;
try {
  console.log('running the a11y project and recording each audit…');
  const run = spawnSync('npx vitest run --project a11y', {
    cwd: root,
    encoding: 'utf8',
    shell: true,
    env: { ...process.env, PJSR_A11Y_RECORD: raw },
    maxBuffer: 64 * 1024 * 1024,
  });
  process.stdout.write(run.stdout ?? '');
  process.stderr.write(run.stderr ?? '');
  if (run.status !== 0) {
    console.error(`the audit run exited ${run.status}; no record is written for a run that did not pass.`);
    process.exit(run.status);
  }
  let entries;
  try {
    entries = JSON.parse(readFileSync(raw, 'utf8'));
  } catch {
    console.error('the run recorded no audits at all. `recordAudit` writes only when PJSR_A11Y_RECORD names a path — this script sets it, so an empty record means the harness is not being used.');
    process.exit(1);
  }
  if (!Array.isArray(entries) || entries.length === 0) {
    console.error('the run recorded zero audit entries, which is the shape of a suite that quietly stopped auditing.');
    process.exit(1);
  }

  const tags = auditTags();
  const expectedFailures = entries.filter((e) => e.expectViolation);
  const clean = entries.filter((e) => !e.expectViolation);
  const unexpected = clean.filter((e) => e.violations.length > 0);
  if (unexpected.length) {
    console.error(
      `the audits passed but recorded violations: ${unexpected.map((e) => `${e.file} :: ${e.test} [${e.violations.join(', ')}]`).join('\n  ')}`,
    );
    process.exit(1);
  }

  const record = {
    schema: 1,
    producedBy: 'npm run a11y:record (scripts/a11y-record.mjs)',
    environment: {
      machine: hostname(),
      platform: platform(),
      osRelease: release(),
      node: `v${process.versions.node}`,
      axeCore: installedVersion('axe-core'),
      jsdom: installedVersion('jsdom'),
      vitest: installedVersion('vitest'),
      react: installedVersion('react'),
      ranAt: new Date().toISOString(),
      revision: revision(),
    },
    standard: {
      source: 'PRD.md §Access / FR-45',
      tags,
      harness: 'src/components/axe-audit-harness.ts',
      note:
        'axe under jsdom answers structure and naming only. The rules that report `incomplete` here are the ones needing ' +
        'layout, geometry or a real hit-test. Colour contrast and touch-target size are measured where a layout exists: ' +
        'a11y/browser.json, written by `npm run a11y:browser-record` and read back by ' +
        'src/lib/a11y-browser-record.test.ts, runs the same tag list inside Chromium, Firefox and WebKit, and the browser ' +
        'matrix’s `toolbar-fold` row measures the toolbar’s boxes at the widths it folds at. What is still an open gap in ' +
        'fr-evidence.json under FR-45 is the assistive-technology pairings — NVDA with Firefox, JAWS with Chrome and ' +
        'VoiceOver with Safari need a human operator reading what each one speaks.',
    },
    totals: {
      audits: entries.length,
      expectedToBeClean: clean.length,
      expectedToFail: expectedFailures.length,
      violationsRecorded: entries.reduce((n, e) => n + e.violations.length, 0),
      rulesIncomplete: [...new Set(entries.flatMap((e) => e.incomplete.map((i) => i.id)))].sort(),
    },
    audits: entries,
  };

  mkdirSync(dirname(OUT), { recursive: true });
  writeFileSync(OUT, `${JSON.stringify(record, null, 2)}\n`);
  console.log(
    `\nwrote a11y/latest.json — ${record.totals.audits} audits (${record.totals.expectedToFail} of them a tree with a defect put in on purpose), ` +
      `${record.totals.rulesIncomplete.length} rules incomplete: ${record.totals.rulesIncomplete.join(', ') || 'none'}`,
  );
  status = 0;
} finally {
  rmSync(work, { recursive: true, force: true });
}
process.exit(status);
