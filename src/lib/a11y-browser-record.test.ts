/*
 * FR-45 / FR-58: the browser half of the accessibility record, and the fields that make it evidence.
 *
 * `npm run a11y:browser-record` runs axe inside chromium, firefox and webkit and commits what it saw to
 * `a11y/browser.json`. That file is the only place in this repository where colour contrast and target geometry
 * are *measured* rather than declared — under jsdom those two rules have nothing to work on, which is why the
 * first run of this script found nine unnamed form controls and one unnamed link that eleven audit tests had
 * never seen (#267, and the finding is fixed in `src/lib/annotation-names.ts`).
 *
 * A record nobody checks is a second document describing a run that may not have happened, so these are the
 * rules that fail:
 *
 *  - **the toolchain it names is the one installed now** — axe-core and Playwright, read from `node_modules`.
 *    A record made by a different axe is a different audit (#244's lesson, and #262's: the check has to bind
 *    the versions the CI matrix actually pins, not the ones it is allowed to vary);
 *  - **the rule set is read out of the harness**, not restated here, so the record cannot start claiming a WCAG
 *    level the audits do not ask axe for;
 *  - **contrast and geometry were evaluated** — each audit carries passing node counts for `color-contrast` and
 *    `target-size`, and a zero means the run measured nothing, which is the exact blind spot this file exists
 *    to close;
 *  - **the widgets in the audited tree all have a name**, which is the FR-45 claim in the environment that can
 *    check it — and so do the links, each recorded with the attribute its name came from, because a reader that
 *    looks at only one attribute invents a defect (see the link case below);
 *  - an audit with violations cannot be in a green record, `notRunnable` has to name every engine that did not
 *    start, and the derived totals have to equal the entries they are derived from.
 *
 * It never re-runs the browsers — that needs engines and minutes, and the record is read by the `node` project
 * on purpose. Regenerate it with `npm run a11y:browser-record`, which refuses to write when any audit is red.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { auditTags } from '../../scripts/axe-tags.mjs';

interface AuditEntry {
  engine: string;
  engineVersion: string;
  started: boolean;
  auditFailed?: boolean;
  document?: string;
  state?: string;
  nodesInDocument?: number;
  formWidgetsPainted?: number;
  widgetNames?: string[];
  linkNames?: string[];
  violations?: Array<{ id: string; impact: string | null; nodes: number }>;
  incomplete?: Array<{ id: string; nodes: number }>;
  geometryPassingNodes?: Record<string, number>;
  note?: string;
}

interface RecordShape {
  schema: number;
  producedBy: string;
  environment: Record<string, string>;
  standard: { source: string; tags: string[]; harness: string; note: string };
  totals: {
    audits: number;
    engines: string[];
    notRunnable: string[];
    violationsRecorded: number;
    contrastNodesMeasured: number;
    targetSizeNodesMeasured: number;
    rulesIncomplete: string[];
  };
  audits: AuditEntry[];
}

const PATH = join(process.cwd(), 'a11y', 'browser.json');

function load(): RecordShape {
  if (!existsSync(PATH)) {
    throw new Error(
      'a11y/browser.json is missing. `npm run a11y:browser-record` writes it from a real run in chromium, ' +
        'firefox and webkit; nothing here re-runs them, so an absent file means the claim has no reading behind it.',
    );
  }
  return JSON.parse(readFileSync(PATH, 'utf8')) as RecordShape;
}

function installedVersion(name: string): string {
  return JSON.parse(readFileSync(join(process.cwd(), 'node_modules', name, 'package.json'), 'utf8')).version;
}

const record = load();
const started = record.audits.filter((entry) => entry.started && !entry.auditFailed);

function derived(rule: (entries: AuditEntry[]) => number): number {
  return rule(started);
}

describe('FR-45 / FR-58: the browser accessibility record is a reading, not a claim', () => {
  it('names the toolchain that is installed in this tree right now', () => {
    for (const [key, name] of [
      ['axeCore', 'axe-core'],
      ['playwright', 'playwright'],
    ] as const) {
      expect(record.environment[key], `the record names ${name} ${record.environment[key]}`).toBe(
        installedVersion(name),
      );
    }
    expect(record.environment.revision, 'the run belongs to a commit').toMatch(/^[0-9a-f]{40}$/);
    const ranAt = record.environment.ranAt ?? '';
    expect(ranAt, 'the run is dated').toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(Number.isNaN(Date.parse(ranAt)), 'and the date parses').toBe(false);
  });

  it('claims exactly the rule set the harness asks axe for', () => {
    expect(record.standard.tags, 'the record cannot claim a level the audits do not check').toEqual(auditTags());
  });

  it('has at least one real audit, and says which engines were not there', () => {
    expect(started.length, 'a record of nothing is not evidence').toBeGreaterThan(0);
    const notRunnable = record.audits.filter((entry) => !entry.started || entry.auditFailed);
    expect(record.totals.notRunnable, 'an engine that did not start is named, never silently dropped').toEqual(
      notRunnable.map((entry) => entry.engine).filter((name, index, all) => all.indexOf(name) === index),
    );
    for (const entry of notRunnable) {
      expect(entry.note, `${entry.engine} is listed as unavailable without a reason`).toBeTruthy();
    }
  });

  it('found no violation in any engine that ran', () => {
    for (const entry of started) {
      expect(entry.violations, `${entry.engine} · ${entry.state}: ${JSON.stringify(entry.violations)}`).toEqual([]);
    }
    expect(record.totals.violationsRecorded, 'the total is derived from the entries, not typed').toBe(
      derived((entries) => entries.reduce((n, e) => n + (e.violations?.length ?? 0), 0)),
    );
  });

  it('measured contrast and geometry rather than deferring them the way jsdom must', () => {
    for (const entry of started) {
      const geometry = entry.geometryPassingNodes ?? {};
      expect(geometry['color-contrast'] ?? 0, `${entry.engine} · ${entry.state}: color-contrast evaluated 0 nodes`).toBeGreaterThan(0);
      expect(geometry['target-size'] ?? 0, `${entry.engine} · ${entry.state}: target-size evaluated 0 nodes`).toBeGreaterThan(0);
    }
    expect(record.totals.contrastNodesMeasured).toBe(
      derived((entries) => entries.reduce((n, e) => n + (e.geometryPassingNodes?.['color-contrast'] ?? 0), 0)),
    );
    expect(record.totals.targetSizeNodesMeasured).toBe(
      derived((entries) => entries.reduce((n, e) => n + (e.geometryPassingNodes?.['target-size'] ?? 0), 0)),
    );
    expect(record.totals.audits, 'and the audit count is the entries themselves').toBe(started.length);
  });

  it('holds a name for every form control the engine put on the page', () => {
    /*
     * The FR-45 claim, checked where it can be: pdf.js names a widget only when the PDF carries a `/TU` label,
     * and `form-sample.pdf` does not, so before `nameUnnamedWidgets` these entries read `fullName:(none)` and
     * axe called them `label` violations in three engines at once. The `name:label` shape is kept deliberately:
     * an entry whose two halves match is a control named from its own field name, which is the honest source.
     */
    for (const entry of started) {
      const unnamed = (entry.widgetNames ?? []).filter((w) => w.endsWith(':(none)'));
      expect(unnamed, `${entry.engine} · ${entry.state}: controls with no accessible name`).toEqual([]);
      expect(entry.formWidgetsPainted ?? 0, 'the audited mount really had widgets in it').toBeGreaterThan(0);
    }
  });

  it('holds a name for every link too, and names the source the name came from', () => {
    /*
     * Links arrived later than the widgets did, and for a different reason. The first version of this field
     * printed `["(unnamed)","Link"]` on a run with no `link-name` violation, because the page-side reader looked
     * only at `aria-label` and the text: the link it called unnamed is `title="Back to page one (link annotation)"`,
     * which is pdf.js naming a link that carries a `/TU`, and `nameUnnamedWidgets` leaves it alone because a real
     * label beats the generic one. Each entry is therefore `source:name` (`src/lib/annotation-names.ts` supplies
     * the `aria-label:` cases), and an entry that is not a source is a link with nothing to announce.
     */
    const NAMED = /^(aria-label|aria-labelledby|title|text):/;
    for (const entry of started) {
      const links = entry.linkNames ?? [];
      expect(links.length, `${entry.engine} · ${entry.state}: the audited mount painted no link at all`).toBeGreaterThan(0);
      const unnamed = links.filter((link) => !NAMED.test(link) && link !== 'hidden-by-design');
      expect(unnamed, `${entry.engine} · ${entry.state}: links with no accessible name`).toEqual([]);
    }
  });

  it('says what the audited tree was, so a clean report has a scope', () => {
    for (const entry of started) {
      expect(entry.document, 'which PDF').toBe('form-sample.pdf');
      expect(entry.state, 'which mount state — the sidebar changes the tree').toMatch(/sidebar (closed|open)/);
      expect(entry.nodesInDocument, 'how much tree axe walked').toBeGreaterThan(100);
    }
    const rulesIncomplete = [...new Set(started.flatMap((e) => (e.incomplete ?? []).map((i) => i.id)))].sort();
    expect(record.totals.rulesIncomplete, 'the incomplete list is the entries, not a shorter hand copy').toEqual(
      rulesIncomplete,
    );
    // `color-contrast` stays partly incomplete on a text layer painted under the widget layer: axe cannot
    // resolve a background through an overlapping element. Named here because the record lists it, and because
    // "19 nodes undetermined" is a different fact from "contrast not measured".
    expect(rulesIncomplete, 'an unexpected rule went blind in a real browser').toEqual(['color-contrast']);
  });
});
