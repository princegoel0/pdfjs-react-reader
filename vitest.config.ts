import { configDefaults, defineConfig } from 'vitest/config';

/*
 * The axe audits get their own project (#216), and the reason is a measurement rather than a hunch.
 *
 * With all 55 DOM files sharing a pool, an `axe.run()` on a busy machine can pass vitest's 5 s while the
 * next one in the same file is refused outright: axe-core holds a single module-level run lock, an aborted
 * run never releases it, and every later audit fails with `Axe is already running` — a red suite that names
 * no accessibility rule. Measured on 2026-10-05 with the machine deliberately oversubscribed: 7 failures,
 * 6 of them on the lock. So the audit files run one at a time, in one fork, and `testTimeout` is left at
 * vitest's default on purpose: raising it would hide the contention instead of removing it, and an audit
 * that genuinely needs more than five seconds is a fact worth failing on.
 *
 * `src/lib/a11y-serial.test.ts` is the guard: it reads this file and the source, and refuses a new axe-using
 * file that is not in the serialised project.
 */
const AUDIT_FILES = ['src/**/a11y.*.test.tsx'];

export default defineConfig({
  test: {
    /* Two projects, because only the feature-seam tests touch the DOM and the
       library's own logic is tested in Node, where a jsdom global could hide an
       assumption about `window`. The DOM project needs `globals: true`: that is
       how @testing-library/react finds an `afterEach` to register its cleanup. */
    projects: [
      {
        test: {
          name: 'node',
          environment: 'node',
          include: ['src/**/*.test.ts'],
        },
      },
      {
        test: {
          name: 'dom',
          environment: 'jsdom',
          globals: true,
          include: ['src/**/*.test.tsx'],
          exclude: [...configDefaults.exclude, ...AUDIT_FILES],
        },
      },
      {
        test: {
          name: 'a11y',
          environment: 'jsdom',
          globals: true,
          include: AUDIT_FILES,
          // One fork for the whole project, which is what "sequentially" means here: the audit files run one
          // after another in a single process. (`fileParallelism` is a root-only option — vitest lists it among
          // the settings a project may not override — so `singleFork` is the per-project knob.)
          pool: 'forks',
          poolOptions: { forks: { singleFork: true } },
          // And this project starts only after the group-0 projects have finished, which is the other half:
          // an axe run sharing a machine with fifty jsdom workers is the condition that produced #216. Higher
          // group order runs later, so the audits get the cores to themselves.
          sequence: { groupOrder: 1 },
        },
      },
    ],
  },
});
