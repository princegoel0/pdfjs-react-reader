/**
 * FR-48: the pinned-floor instrument, guarded without a browser.
 *
 * §8's execution policy refuses a floor claim backed by "the default hosted browser", and for as long as this
 * repository had only the current-build matrix, FR-48's row said so honestly and left the floors unverified. The
 * instrument that measures them is `scripts/browser-floors.mjs`, and the first thing it has to prove is that it
 * cannot lie: run it without pinned drivers and it refuses, run it with them and it reads the floor out of the
 * contract rather than out of a table it keeps for itself.
 *
 * The second half is the part that is not about the script at all. The floor was measured on 2026-10-09 in three
 * pinned builds — Chromium 125, Firefox 124, WebKit 18.0, each from the Playwright release whose browser build is
 * exactly that version — and none of them rendered a document: Chromium 125 threw `URL.parse is not a function`
 * in the engine's own URL handling, while Firefox 124 and WebKit 18.0 never booted the page because `pdf.mjs`
 * evaluates `Iterator.prototype` at module scope. Those are the engine's requirements, so the cases below read the
 * installed engine's source: they are the evidence that the numbers in §8 are the engine's floor claim, not ours,
 * and they go red the day an engine release stops making the call — which is the only way this repository learns
 * the floor has moved without re-running three browsers by hand.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const script = 'scripts/browser-floors.mjs';
const source = readFileSync(join(process.cwd(), script), 'utf8');
const engine = readFileSync(join(process.cwd(), 'node_modules', 'pdfjs-dist', 'build', 'pdf.mjs'), 'utf8');

describe('FR-48: the pinned browser-floor instrument', () => {
  it('refuses to run on the repository’s own browser, which is the claim §8 rejects', () => {
    let code = 0;
    let output = '';
    try {
      execFileSync(process.execPath, [script], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    } catch (thrown) {
      const error = thrown as { status?: number; stdout?: string; stderr?: string };
      code = error.status ?? 0;
      output = `${error.stdout ?? ''}${error.stderr ?? ''}`;
    }
    expect(code, 'a floor run with no pinned driver exited 0, so it would report the current build as the floor').not.toBe(0);
    expect(output).toMatch(/no pinned driver/i);
    expect(output).toMatch(/§8/);
  });

  it('reads the floors out of PRD.md instead of keeping a second copy of them', () => {
    expect(source).toMatch(/readFileSync\(join\(repo, 'PRD\.md'\)/);
    expect(source).toMatch(/contractFloors\(\)/);
    // The row labels are how the contract is found; a version typed into this script would be a second opinion
    // on the floor, which is the drift §8's own table exists to prevent.
    expect(source).toMatch(/Chrome \/ Chromium/);
    expect(source).toMatch(/Safari \(macOS\)/);
    expect(source).not.toMatch(/const FLOORS\s*=\s*\{/);
    expect(source).not.toMatch(/=\s*125\b|:\s*124\b|:\s*18\b/);
  });

  it('names the members that decide the answer, so a failure says what was missing', () => {
    for (const member of ['Iterator', 'URL.parse', 'Promise.try', 'AbortSignal.any']) {
      expect(source, `the probe does not read ${member}, so a floor failure would not name what the engine needs`).toContain(member);
    }
  });

  it('keeps the engine’s own requirement in the record, because that is what §8 is actually claiming', () => {
    // `Iterator.prototype` is evaluated at module scope: without iterator helpers the engine cannot be imported,
    // which is why Firefox 124 and WebKit 18.0 never reached a first paint.
    expect(engine).toMatch(/typeof Iterator\.prototype\.join/);
    // And the URL path is unguarded: at Chromium 125 the viewer reports this by name through FR-54's error.
    expect((engine.match(/URL\.parse\(/g) ?? []).length, 'the engine stopped calling URL.parse; §8’s floor numbers need re-measuring').toBeGreaterThan(0);
    expect((engine.match(/Promise\.try\(/g) ?? []).length, 'the engine stopped calling Promise.try; re-measure the floor').toBeGreaterThan(0);
  });

  it('reads the failure out of the element the shell writes it to', () => {
    // The first run printed `status "(none)"` for a page that was displaying "Failed to load PDF: URL.parse is
    // not a function", because the probe read `.pjsr-error` and the shell renders a load failure into
    // `.pjsr-status` (ViewerParts.tsx). A floor cell that cannot repeat what the page said is a cell that
    // describes the harness, so the selector is pinned to the class the component actually carries.
    const shell = readFileSync(join(process.cwd(), 'src', 'components', 'ViewerParts.tsx'), 'utf8');
    expect(shell).toMatch(/className="pjsr-status"/);
    // Matched against the selector string, not the file: a comment naming the class must not satisfy this.
    const selector = /querySelectorAll\('([^']*pjsr-error[^']*)'\)/.exec(source)?.[1] ?? '(no such selector)';
    expect(selector, 'the floor probe reads a class the shell never renders a failure into').toContain('.pjsr-status');
  });

  it('reports a floor that does not render as a failure rather than as an unverified row', () => {
    // §8's policy is that an unverified row is not a pass, but a row that was measured and did not render is a
    // failure, and the difference is the exit code.
    expect(source).toMatch(/did not render/);
    expect(source).toMatch(/process\.exit\(1\)/);
  });
});
