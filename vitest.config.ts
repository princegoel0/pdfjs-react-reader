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

/**
 * The edit tier's tests, which write real files.
 *
 * Named by directory-level behaviour rather than by a measured cost per file: every one of these renders the
 * page panel over the twenty-page fixture and follows an apply or an extract through a real `@cantoo/pdf-lib`
 * pass whose bytes are then parsed back, so all six are slow for the same reason and none of them is slow
 * because someone wrote a bad test.
 */
const WRITER_FILES = ['src/edit*.test.tsx'];

export default defineConfig({
  test: {
    /* Two projects, because only the feature-seam tests touch the DOM and the
       library's own logic is tested in Node, where a jsdom global could hide an
       assumption about `window`. The DOM project needs `globals: true`: that is
       how @testing-library/react finds an `afterEach` to register its cleanup. */
    projects: [
      {
        test: {
          /*
           * One file, for the same reason as the group above and with the same evidence: `ssr.test.ts` imports
           * the whole public surface in a DOM-free Node — the first entry costs 417 ms alone, the rest 5–30 ms
           * each — and on 2026-10-07 a full-suite run red with `Test timed out in 5000ms` on `imports '.'`
           * while the same file on an idle machine finished that test in 417 ms. Twelve times the work was
           * stolen by the sixty-eight-file wave it shares a group with. The answer is not a bigger ceiling: an
           * idle measurement that far under the ceiling says contention is the cause, and #216 settled that
           * reasoning for this repository — serialise the heavy thing, leave the ceiling alone.
           */
          name: 'node-serial',
          environment: 'node',
          include: ['src/lib/ssr.test.ts'],
          pool: 'forks',
          poolOptions: { forks: { singleFork: true } },
          sequence: { groupOrder: 1 },
        },
      },
      {
        test: {
          name: 'node',
          environment: 'node',
          include: ['src/**/*.test.ts'],
          exclude: [...configDefaults.exclude, 'src/lib/ssr.test.ts'],
        },
      },
      {
        test: {
          name: 'dom',
          environment: 'jsdom',
          globals: true,
          include: ['src/**/*.test.tsx'],
          exclude: [...configDefaults.exclude, ...AUDIT_FILES, ...WRITER_FILES],
        },
      },
      {
        test: {
          /*
           * The edit tier gets its own serialised group for the same reason #224 gave the axe audits one, and
           * the measurement is the same shape: `npm run test` on an idle machine is green at 148 files, while
           * `npm run verify` on a busy one failed 4–17 tests across `edit.test.tsx`, `edit.undo.test.tsx` and
           * `edit.extract.test.tsx`, each of which passes alone. Every one of those failures is
           * `Test timed out in 5000ms`, and reading the ceiling up is the thing this repository refuses to do
           * to hide contention (#216's lesson: serialise, do not raise). What these files do is a real save
           * through the engine plus a real pass by the writer over a twenty-page fixture — `kidsOf(bytes)`
           * parses the bytes back, which is why the assertions mean something — so a fork that has to share
           * twenty jsdom siblings can exceed the ceiling without anything being broken. Running them one at a
           * time, after the parallel groups, gives each the whole machine; the test ceiling itself is untouched.
           */
          name: 'writers',
          environment: 'jsdom',
          globals: true,
          include: WRITER_FILES,
          exclude: [...configDefaults.exclude],
          pool: 'forks',
          poolOptions: { forks: { singleFork: true } },
          // Same ordering rule as the audits: higher group order runs later, so these get the cores to
          // themselves instead of arriving in the middle of the dom group's peak.
          sequence: { groupOrder: 1 },
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
