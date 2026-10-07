/**
 * The axe harness the FR-45 audits run through, with the two guards #216 asked for.
 *
 * axe-core holds one module-level run lock (`axe._running`) and a second `axe.run()` while one is in flight
 * throws `Axe is already running` instead of queueing. A test that vitest has already timed out does not
 * release that lock, so one audit that could not get CPU converted every later audit in the same file into a
 * failure that named no accessibility problem at all. Measured on 2026-10-05 with the DOM project running 55
 * files on a 16-core machine that was deliberately oversubscribed: 7 failed, 6 of them on the lock and none
 * on a violation.
 *
 * Two rules, both here rather than in the test files so a new audit inherits them. Every audit waits its
 * turn — the serialisation lives in the queue below and in the `a11y` project in `vitest.config.ts`
 * (`fileParallelism: false`, and a `sequence.groupOrder` that starts it after the parallel projects), which is
 * what keeps a jsdom-plus-axe file from competing with fifteen siblings.
 * And a lock found already set is reported as the harness defect it is, because the alternative is a red CI
 * that tells you about contrast ratios when the truth is contention. The timeout is *not* raised: a
 * 5-second audit that needs longer than that under load is a measurement worth keeping honest.
 */
import axe from 'axe-core';
import { readFileSync, writeFileSync } from 'node:fs';
import { expect } from 'vitest';

/** The tags `PRD.md` §Access claims: WCAG 2.0, 2.1 and 2.2, levels A and AA. */
const AUDIT_OPTIONS = {
  runOnly: {
    type: 'tag' as const,
    values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'],
  },
};

/**
 * axe's own report type, named through the namespace `axe-core` exports.
 *
 * `Awaited<ReturnType<typeof axe.run>>` is the obvious spelling and it is wrong here: `axe.run` is
 * overloaded, `ReturnType` resolves to the callback form, and every field the tests then read is `any` —
 * a harness that cannot tell a violation from a typo.
 */
export type AuditResult = axe.AxeResults;

let queue: Promise<unknown> = Promise.resolve();

export function runAudit(node: Element): Promise<AuditResult> {
  const turn = queue.then(async () => {
    if ((axe as unknown as { _running?: boolean })._running) {
      throw new Error(
        '#216: axe entered this audit already running, so the previous run never finished. ' +
          'This is the harness losing its serialisation, not the shell failing an accessibility rule.',
      );
    }
    return axe.run(node as HTMLElement, AUDIT_OPTIONS);
  });
  // The chain survives a failed run. Without the catch, one poisoned audit would fail every later one —
  // which is precisely the shape of the failure this file exists to prevent.
  queue = turn.catch(() => undefined);
  return turn;
}

/** The report is only useful if it says which node and which rule, so the targets come along. */
export function violationList(result: Pick<AuditResult, 'violations'>): string[] {
  return result.violations.map(
    (v: axe.Result) => `${v.id} — ${v.nodes.map((n: axe.NodeResult) => n.target.join(' ')).join(', ')}`,
  );
}

/**
 * FR-58's record, written only when `npm run a11y:record` names a path in `PJSR_A11Y_RECORD`.
 *
 * §9 wants accessibility evidence a reader can re-read, not a console log that ends with the job, and the
 * benchmark half of that was produced in W8 by a tracked `benchmarks/latest.json`. This is the same discipline
 * applied to the audits: each audit contributes one entry, and
 * [`scripts/a11y-record.mjs`](../../scripts/a11y-record.mjs) adds the environment around them.
 *
 * Nothing is written during `npm run a11y` or `npm test`, deliberately — a test that rewrote a tracked file on
 * every run would leave the working tree permanently dirty, and the clean-checkout condition is part of every
 * gate here. The record changes when someone asks for it.
 *
 * An entry names the test it came from (`expect.getState()`, so a shared helper records the case that called
 * it rather than the helper) and carries `expectViolation`, because a record that says "no violations" about
 * a run that included no failing tree proves nothing about the audit's reach. The one case that introduces a
 * defect on purpose sets it, and `src/lib/a11y-record.test.ts` fails if no entry has it.
 */
export function recordAudit(result: AuditResult, options: { expectViolation?: boolean } = {}): void {
  const path = process.env.PJSR_A11Y_RECORD;
  if (!path) return;
  const state = expect.getState() as { currentTestName?: string; testFilePath?: string; testPath?: string };
  const entry = {
    test: state.currentTestName ?? '(outside a test)',
    file: (state.testFilePath ?? state.testPath ?? '').split(/[\\/]/).slice(-2).join('/'),
    violations: result.violations.map((v: axe.Result) => v.id),
    // axe's own sentence, not a paraphrase: "incomplete" means it could not answer, and the record has to
    // say which of the two a reader is looking at.
    incomplete: result.incomplete.map((r: axe.Result) => ({
      id: r.id,
      reason: String(r.nodes?.[0]?.failureSummary ?? r.description ?? 'no reason given').replace(/\s+/g, ' ').slice(0, 160),
    })),
    passes: result.passes.length,
    expectViolation: options.expectViolation === true,
  };
  let entries: unknown[] = [];
  try {
    entries = JSON.parse(readFileSync(path, 'utf8')) as unknown[];
  } catch {
    entries = [];
  }
  entries.push(entry);
  writeFileSync(path, JSON.stringify(entries, null, 2));
}
