/*
 * FR-45's harness rule, held by a test: every axe audit runs in the serialised project.
 *
 * #216 was fixed in two places: the audits moved into their own vitest project — `fileParallelism: false`, so
 * one audit file at a time, and `sequence.groupOrder: 1`, so that project starts after the parallel ones
 * finish — and every run now goes through the queue in `src/components/axe-audit-harness.ts`, which refuses to
 * let two `axe.run()` calls overlap and says "#216: the harness" when it finds axe's run lock already held.
 *
 * A fix that lives only in `vitest.config.ts` quietly ends the day someone adds the third audit file and lets
 * it land in the DOM project — the suite stays green on their machine, and the next busy runner gets a wall of
 * `Axe is already running` failures that look like accessibility regressions. So this reads the config and
 * the source and refuses that arrangement: every file that reaches axe-core must be matched by the serialised
 * project's include, must not be matched by the project it was taken out of, and the project must still be
 * serialised.
 *
 * `--project` invocations are checked too, because CI and a script can name projects explicitly: a list that
 * omits `a11y` would silently stop auditing anything.
 *
 * What the fix and this guard were measured against, all on 2026-10-05 with the machine deliberately
 * oversubscribed (32 busy processes on 16 cores, `.spike/contend.mjs`):
 *
 *  - before it, `--project dom` failed **7 tests in `a11y.audit.test.tsx`, 6 of them on axe's run lock** —
 *    one timed-out audit converting every audit behind it into a message about nothing;
 *  - with the project in place and `poolOptions.forks.singleFork` deleted, this file fails with `the a11y
 *    project does not run its files in one fork: expected undefined to be true`; with
 *    `sequence.groupOrder` deleted, `does not run after the parallel projects`; with the DOM project's
 *    exclusion deleted, it names `src/components/a11y.audit.test.tsx` as running in the parallel project too;
 *  - the queue's own half is measured in `src/components/a11y.harness.test.tsx`, whose header carries the
 *    number for replacing `runAudit` with a bare `axe.run`;
 *  - under the same load after the change: **no audit failure at all**, three timeouts elsewhere
 *    (`src/lib/ssr.test.ts` twice, `src/edit.test.tsx` once), which are not this defect and are recorded as
 *    remaining contention sensitivity rather than fixed here.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import vitestConfig from '../../vitest.config';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

/**
 * Every test file that runs an audit — by importing axe-core, or by importing the harness that wraps it.
 *
 * An import statement at the start of a line, not the string `axe-core` anywhere: this very file names the
 * module in a comment and inside a pattern, and the first version of this scan reported itself as an audit
 * that was missing from the serialised project. That was the scanner being wrong, not the config. The
 * harness counts too because a file that reaches `runAudit` reaches axe's run lock just the same.
 */
const AXE_IMPORT =
  /^[ \t]*import\s+[^;]*?from\s+['"](?:axe-core|[^'"]*axe-audit-harness)['"]/m;

function axeFiles(): string[] {
  const found: string[] = [];
  const walk = (dir: string): void => {
    for (const item of readdirSync(dir)) {
      const path = join(dir, item);
      if (statSync(path).isDirectory()) walk(path);
      else if (/\.test\.tsx?$/.test(item) && AXE_IMPORT.test(readFileSync(path, 'utf8')))
        found.push(relative(root, path).replace(/\\/g, '/'));
    }
  };
  walk(join(root, 'src'));
  return found;
}

/** Vitest's `**`/`*` globs, over posix paths only, for the one job of "does this file match". */
function matches(pattern: string, file: string): boolean {
  const escaped = pattern
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*\*\//g, '\u0000')
    .replace(/\*\*/g, '\u0001')
    .replace(/\*/g, '[^/]*')
    .replace(/\u0000/g, '(?:[^/]+\\/)*')
    .replace(/\u0001/g, '.*');
  return new RegExp(`^${escaped}$`).test(file);
}

/**
 * The projects as vitest will see them.
 *
 * Imported from `vitest.config.ts`, not scraped from its text. The first version of this guard regex-parsed
 * the config file and passed with the project's serialisation setting deleted from it — a counterfactual
 * that passes indicts the guard, and here it indicted two things at once: the scrape, and the idea that a
 * hand-written parser of someone else's object literal is ever trustworthy. `defineConfig` is inert, so this
 * reads the same array the runner reads.
 */
type ProjectConfig = {
  name: string;
  include?: string[];
  exclude?: string[];
  poolOptions?: { forks?: { singleFork?: boolean } };
  sequence?: { groupOrder?: number };
};

function projects(): ProjectConfig[] {
  const config = vitestConfig as { test?: { projects?: { test?: ProjectConfig }[] } };
  return (config.test?.projects ?? []).map((p) => p.test as ProjectConfig);
}

describe('the axe audits are serialised (FR-45, #216)', () => {
  const audit = projects().find((p) => p.name === 'a11y');
  const dom = projects().find((p) => p.name === 'dom');
  const users = axeFiles();

  it('finds the audit files it is supposed to be guarding', () => {
    // A scan that found nothing would pass every rule below for the wrong reason.
    expect(users.length, 'no audit file was found to guard').toBeGreaterThanOrEqual(3);
  });

  it('puts every axe-using file in a project that runs one file at a time', () => {
    expect(audit, 'vitest.config.ts has no `a11y` project').toBeTruthy();
    // Read from the config object, so deleting a line fails this test rather than only the scrape of it.
    expect(
      audit?.poolOptions?.forks?.singleFork,
      'the a11y project does not run its files in one fork (poolOptions.forks.singleFork)',
    ).toBe(true);
    // The half that stops an audit sharing the machine with fifty jsdom workers: a higher group order runs
    // after group 0, so the audits get the cores once the parallel projects are finished.
    expect(
      audit?.sequence?.groupOrder,
      'the a11y project does not run after the parallel projects (sequence.groupOrder)',
    ).toBe(1);
    for (const file of users) {
      expect(
        audit?.include?.some((pattern) => matches(pattern, file)),
        `${file} is not audited serially`,
      ).toBe(true);
    }
  });

  it('takes those same files out of the parallel DOM project', () => {
    expect(dom, 'vitest.config.ts has no `dom` project').toBeTruthy();
    for (const file of users) {
      const inDom =
        dom?.include?.some((pattern) => matches(pattern, file)) === true &&
        dom?.exclude?.some((pattern) => matches(pattern, file)) !== true;
      expect(inDom, `${file} runs in the parallel dom project as well`).toBe(false);
    }
  });

  it('is named by every script and job that runs the suite', () => {
    const scripts = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).scripts as Record<
      string,
      string
    >;
    for (const [file, script] of Object.entries(scripts)) {
      if (!/vitest/.test(script)) continue;
      const named = [...script.matchAll(/--project[= ](\S+)/g)]
        .map((m) => m[1])
        .filter((name): name is string => name !== undefined)
        .map((name) => name.replace(/^['"]|['"]$/g, ''));
      // A run with no `--project` takes all three; a run that names projects has to name the audits, or it
      // is not auditing anything and the suite is reporting a green it did not earn.
      expect(
        named.length === 0 || named.includes('a11y'),
        `npm run ${file} runs vitest with ${named.join(', ') || 'no project'}, which skips the axe audits`,
      ).toBe(true);
    }
    const ci = readFileSync(join(root, '.github', 'workflows', 'ci.yml'), 'utf8');
    for (const match of ci.matchAll(/--project[= ](\S+)/g)) {
      const named = match[1];
      expect(named, 'CI names a vitest project without the audits').not.toBe('dom');
    }
  });
});
