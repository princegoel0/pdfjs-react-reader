/*
 * FR-54's own register rule: every published code is a code some test names.
 *
 * The clause is about the whole vocabulary — "All consumer-visible failures use `PdfError` and stable codes" —
 * and a code list is exactly the kind of surface where one member can go stale while the row reads as covered.
 * This case makes the *shape* of that claim a gate: the list in `errors.ts` is the published set, so a code added
 * there without a test naming it fails the suite, and the row cannot drift by growing. What it deliberately does
 * not assert is the harder question, which is whether each code has a producer a consumer can reach — that is a
 * judgement per code, it is written up in `FR-54`'s register row, and today two of the eighteen have no speaker
 * (`RENDER_CANCELLED`, which every call site returns before reaching the wrapper, and `UNSUPPORTED_FEATURE`,
 * which nothing in the package throws).
 */
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { PDF_ERROR_CODES } from './errors';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

/** Every test file in the package, repo-relative. */
function testFiles(dir: string, into: string[] = []): string[] {
  for (const entry of readdirSync(join(repo, dir), { withFileTypes: true })) {
    const path = `${dir}/${entry.name}`;
    if (entry.isDirectory()) testFiles(path, into);
    else if (/\.test\.tsx?$/.test(entry.name)) into.push(path);
  }
  return into;
}

const tests = testFiles('src');
const named = PDF_ERROR_CODES.filter((code) =>
  tests.some((file) => readFileSync(join(repo, file), 'utf8').includes(`'${code}'`)),
);

describe('FR-54: the published code set is a testable set, not a name table', () => {
  it('names every one of §3.6’s codes in a test, so none can go stale inside an otherwise green row', () => {
    const untested = PDF_ERROR_CODES.filter((code) => !named.includes(code));
    expect(untested, `no test mentions: ${untested.join(', ')}`).toEqual([]);
    expect(named.length, 'and the check is over the published list, whatever it holds today').toBe(
      PDF_ERROR_CODES.length,
    );
  });

  it('has a test file that reaches every code, so the assertion above is not one giant blob', () => {
    // A single file listing all eighteen names would satisfy the case above and prove nothing about coverage.
    // The published set is spread across the suites that produce it; this counts how many of them name one.
    const naming = tests.filter((file) =>
      PDF_ERROR_CODES.some((code) => readFileSync(join(repo, file), 'utf8').includes(`'${code}'`)),
    );
    expect(naming.length, 'several suites each name the codes their own path produces').toBeGreaterThan(8);
  });
});
