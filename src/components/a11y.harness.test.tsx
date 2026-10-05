/*
 * FR-45's harness, under test — because #216's failures were never about accessibility.
 *
 * The symptom was a busy runner turning one slow audit into six red tests reading `Axe is already running`,
 * since axe-core holds a single module-level run lock and an audit that vitest already timed out does not
 * release it. The fix has two halves: the audits run one file at a time, after the parallel projects
 * (`vitest.config.ts`, guarded by `src/lib/a11y-serial.test.ts`), and every run goes through a queue that
 * refuses to overlap. This file is the second half — the one that has to keep working when someone adds an
 * audit that asks for two runs at once, or when a run is refused outright.
 *
 * The counterfactual, run once and reverted by checksum: replace `runAudit`'s body with a bare
 * `axe.run(node, options)` and **all three tests here fail**, the first with axe's own
 * `Axe is already running` and the other two with the same message — which is the stickiness this queue
 * exists to prevent, reproduced on purpose. With the queue in place the same run is green, and under the
 * oversubscribed machine (32 busy processes on 16 cores) the audit files report no failure at all.
 */
import { cleanup, render } from '@testing-library/react';
import axe from 'axe-core';
import { afterEach, describe, expect, it } from 'vitest';
import { runAudit } from './axe-audit-harness';

/**
 * axe's run lock is private and stays that way in the app; a test of the harness has to reach it to show
 * what a stuck one looks like, so it is named once here rather than scattered through the file.
 */
const lock = axe as unknown as { _running: boolean };

const mount = () =>
  render(
    <div className="pjsr-host">
      <button type="button">Save the file</button>
    </div>,
  ).container;

describe('the audit harness serialises its runs (FR-45, #216)', () => {
  afterEach(() => {
    lock._running = false;
    cleanup();
  });

  it('queues two audits asked for at the same time instead of colliding on the lock', async () => {
    const first = mount();
    const second = mount();
    const [one, two] = await Promise.all([runAudit(first), runAudit(second)]);
    expect(one.violations).toEqual([]);
    expect(two.violations).toEqual([]);
    expect(lock._running, 'the queue left axe mid-run').toBe(false);
  });

  it('blames the harness when axe is already running, not the shell', async () => {
    const node = mount();
    lock._running = true;
    await expect(runAudit(node)).rejects.toThrow(/#216.*harness/);
  });

  it('still runs the next audit after one is refused', async () => {
    // This is the failure mode the whole change is about: a refused audit must not be sticky, or one lost
    // race reddens the rest of the file with messages that describe neither the shell nor a WCAG rule.
    const refused = mount();
    lock._running = true;
    await expect(runAudit(refused)).rejects.toThrow(/#216/);
    lock._running = false;

    const clean = mount();
    const result = await runAudit(clean);
    expect(result.violations).toEqual([]);
    expect(result.passes.length).toBeGreaterThan(0);
  });
});
