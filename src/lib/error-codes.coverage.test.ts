/*
 * FR-54's own register rule: every published code has a producer, and every engine name we branch on is one
 * the engine actually uses.
 *
 * The clause is about the whole vocabulary — "All consumer-visible failures use `PdfError` and stable codes" —
 * and a code list is exactly the kind of surface where one member can go stale while the row reads as covered.
 * This case makes the *shape* of that claim a gate: the list in `errors.ts` is the published set, so a code added
 * there without a test naming it fails the suite, and the row cannot drift by growing.
 *
 * The second half is what #242 added, and it is the harder question the first half deliberately left open. A code
 * can be named by a test, thrown by nothing, and still read as covered — which is how `UNSUPPORTED_FEATURE` sat in
 * §3.6 being advertised at every host while its only claimed producer was a table row for `NotImplementedException`,
 * a class that appears in **no** shipped `pdfjs-dist` bundle anywhere in the peer range (measured 2026-10-07 over
 * 6.2.108, 6.3.289 and 6.4.299: the engine's `wrapReason` passes five names through and folds everything else into
 * `UnknownErrorException`; `NotImplemented` is not one of them, and neither is `MissingPDFException`,
 * `XRefException`, `UnknownException` or `InvalidCanvasContext`, which were also rows here). So both directions are
 * now derived from files that exist rather than asserted: a table key must be stamped by the installed engine or
 * created by this package, and a published code must have a call site or a table row that passes that test.
 *
 * What the gate cannot see is reachability *within* the package — `RENDER_CANCELLED`'s class is real and thrown by
 * `RenderTask.cancel()`, and every call site that catches one returns before the wrapper because FR-36 says a
 * cancellation is not an ordinary failure. That is a design decision, it is written on the row, and `#242`'s probe
 * measured it in Chromium; a test that hands the wrapper the class proves the classification either way.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { CODE_BY_ENGINE_NAME, PDF_ERROR_CODES } from './errors';

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

/**
 * The exception names the *installed* engine actually uses.
 *
 * Read off the shipped bundles rather than off pdf.js's source or a changelog, because the class identity is gone
 * by the time a reason crosses the worker boundary and only the stamped string survives — which is exactly the
 * string our table keys on. `BaseException`'s subclasses stamp themselves with `super(msg, "Name")`, so that is
 * the pattern; `build/pdf.worker.mjs` is scanned too, since half the family is thrown there and rebuilt here.
 */
function engineStampedNames(): Set<string> {
  const names = new Set<string>();
  for (const bundle of ['build/pdf.mjs', 'build/pdf.worker.mjs']) {
    let text = '';
    try {
      text = readFileSync(join(repo, 'node_modules', 'pdfjs-dist', bundle), 'utf8');
    } catch {
      continue;
    }
    for (const match of text.matchAll(/super\([^)]*?,\s*"([A-Za-z][A-Za-z0-9]*)"\s*\)/g)) {
      if (match[1]) names.add(match[1]);
    }
  }
  return names;
}

/** Names this package stamps itself, read off the same sources rather than listed here. */
function ownNames(): Set<string> {
  const names = new Set<string>();
  for (const file of sourceFiles('src').filter((f) => !/\.test\.tsx?$/.test(f))) {
    const text = readFileSync(join(repo, file), 'utf8');
    for (const match of text.matchAll(/(?:name|ABORT_ERROR_NAME)\s*[:=]\s*['"]([A-Za-z][A-Za-z0-9]*)['"]/g)) {
      if (match[1]) names.add(match[1]);
    }
  }
  return names;
}

function sourceFiles(dir: string, into: string[] = []): string[] {
  for (const entry of readdirSync(join(repo, dir), { withFileTypes: true })) {
    const path = `${dir}/${entry.name}`;
    if (entry.isDirectory()) sourceFiles(path, into);
    else if (/\.tsx?$/.test(entry.name)) into.push(path);
  }
  return into;
}

/** The call sites: a code named by a non-test source file that is not the vocabulary module itself. */
function producerOf(code: string): string | null {
  for (const file of sourceFiles('src').filter((f) => !/\.test\.tsx?$/.test(f) && f !== 'src/lib/errors.ts')) {
    if (readFileSync(join(repo, file), 'utf8').includes(`'${code}'`)) return file;
  }
  return null;
}

/**
 * A code the wrapper itself is proved to answer, read off the assertions rather than off the classifier's text.
 *
 * `HTTP_ERROR`, `AUTH_ERROR` and `PASSWORD_INVALID` have no throw site: they are the wrapper's answer to a *field*
 * on an engine object (`ResponseException#status`, `PasswordException#code`), which is a branch inside
 * `errors.ts` and invisible to a call-site scan. The honest evidence that such a branch is live is a test that
 * hands `toPdfError` an object in the engine's own shape and reads the code back out of it, so that is what this
 * looks for — the exact assertion form, not the word appearing somewhere in a file.
 */
function classifierProofOf(code: string): boolean {
  return tests.some((file) =>
    new RegExp(`\\.code\\)\\.toBe\\(\\s*'${code}'`).test(readFileSync(join(repo, file), 'utf8')),
  );
}

describe('FR-54: the published code set is a testable set, not a name table', () => {
  it('names every one of §3.6’s codes in a test, so none can go stale inside an otherwise green row', () => {
    const untested = PDF_ERROR_CODES.filter((code) => !named.includes(code));
    expect(untested, `no test mentions: ${untested.join(', ')}`).toEqual([]);
    expect(named.length, 'and the check is over the published list, whatever it holds today').toBe(
      PDF_ERROR_CODES.length,
    );
  });

  it('has a test file that reaches every code, so the assertion above is not one giant blob', () => {
    // A single file listing all seventeen names would satisfy the case above and prove nothing about coverage.
    // The published set is spread across the suites that produce it; this counts how many of them name one.
    const naming = tests.filter((file) =>
      PDF_ERROR_CODES.some((code) => readFileSync(join(repo, file), 'utf8').includes(`'${code}'`)),
    );
    expect(naming.length, 'several suites each name the codes their own path produces').toBeGreaterThan(8);
  });

  it('branches only on exception names the installed engine actually stamps (#242)', () => {
    const stamped = engineStampedNames();
    const own = ownNames();
    expect(stamped.size, 'the scan found no stamped exception names at all — it is reading the wrong file').toBeGreaterThan(
      4,
    );
    const unbacked = Object.keys(CODE_BY_ENGINE_NAME).filter((name) => !stamped.has(name) && !own.has(name));
    expect(
      unbacked,
      `${unbacked.join(', ')} — this package maps an engine name that no shipped bundle stamps, so the row is a ` +
        'branch nothing can reach. That is how UNSUPPORTED_FEATURE came to be advertised from a class that does not exist.',
    ).toEqual([]);
  });

  it('publishes no code that nothing produces (#242)', () => {
    const stamped = engineStampedNames();
    const own = ownNames();
    const orphans = PDF_ERROR_CODES.filter(
      (code) =>
        !producerOf(code) &&
        !classifierProofOf(code) &&
        !Object.entries(CODE_BY_ENGINE_NAME).some(
          ([name, target]) => target === code && (stamped.has(name) || own.has(name)),
        ),
    );
    expect(
      orphans,
      `${orphans.join(', ')} — a code a host may branch on with no throw site, no classifier assertion and no ` +
        'engine class behind it. §3.6 advertises the list as something to write a branch against; a name nothing ' +
        'produces is a branch that can only ever be tested by inspection.',
    ).toEqual([]);
  });
});
