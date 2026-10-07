/*
 * FR-45 over the shell a reader actually lands on — the leg #175 made mountable and #247 is here to run.
 *
 * `a11y.audit.test.tsx` audits the loading, failed and password states, the sidebar on each tab, the search
 * bar, an outline tree, an ink layer and a real `PdfPage`. Every one of those is a piece. The clause says "the
 * shell **and every primitive**", and the state the shell spends its life in — a document loaded, pages in the
 * frame, thumbnails in the sidebar, the bar reading `2 of 4` — had never been through axe, because nothing
 * could mount it until #175. That is the gap this file closes, and it is the kind of gap the audit exists for:
 * the bug axe found on its first run in 2026-10 was a sidebar close control sitting inside a `role="tablist"`,
 * which eleven hand-written assertions had walked past because each one was looking at one part.
 *
 * What the run reaches, measured rather than assumed (2026-10-07, `result.passes` summed over nodes): 244 nodes
 * under 19 rules, over a tree holding 2 mounted pages — each with its canvas, text layer and annotation layer —
 * 4 thumbnail cards, the toolbar's 10 controls plus the measuring copy that sits beside them, the sidebar's
 * tablist and panel, and one `aria-live` region. 25 buttons and 37 `aria-label`ed elements, 0 violations, and 2
 * rules incomplete: `color-contrast` and `aria-hidden-focus`, both geometry, both jsdom's.
 *
 * One claim this file was written with and the measurement took back: that an audit over the whole shell is
 * where a duplicated generated id would show, because the parts reference each other by id. They do not. The
 * mount has **two** ids in it — the sidebar's own tab and panel — and the only `aria-labelledby` between them
 * stays inside that one part. Everything else is named by `aria-label` from the labels object, which axe checks
 * through `button-name`, `label` and `select-name` (15, 2 and 2 nodes). So the second case keeps the uniqueness
 * check as a floor with the measured count in its message, not as the headline: the value of walking the whole
 * tree is the **states**, a page change and a folded bar, where markup is added and removed rather than renamed.
 *
 * The third case is that second state. `plan.showMenu` is computed from each control's `offsetWidth`, jsdom
 * answers 0 for every element, and ten zero-width controls fit any bar — so under jsdom the ⋯ panel does not
 * exist unless the harness supplies widths, which is what `readyFold.itemWidth` is for. Before this file, no
 * test anywhere named `pjsr-overflow`, `pjsr-overflow-menu` or `pjsr-overflow-row`: the primitive that #241
 * found clipped and #243 found inconsistent had never been audited, in jsdom or on a runner.
 */
import { act, cleanup } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { recordAudit, runAudit, violationList } from './axe-audit-harness';
import {
  NUM_PAGES,
  installReadyShellJsdom,
  mountReadyShell,
  pressKeyIn,
  readyFold,
  readyViewport,
  resetReadyShell,
  shellChrome,
} from './ready-shell-harness';

installReadyShellJsdom();

/*
 * The load is mocked in *this* file, not in the harness, because that is how vitest works: `vi.mock` is hoisted
 * above the imports of the file that calls it, so a shared module cannot install it on a test's behalf. Without
 * it the shell reaches pdf.js for a real file — which under jsdom does not fail fast so much as sit there, and
 * the first run of this file timed out in exactly that way. The factory imports `ready-fake-document`, not the
 * harness, for the reason that file's header carries: a factory that pulls in a component module deadlocks
 * collection, and it does so without an error to read.
 */
vi.mock('../headless/usePdfDocument', async () => {
  const { readyLoadResult } = await import('./ready-fake-document');
  return { usePdfDocument: () => readyLoadResult() };
});

afterEach(() => {
  cleanup();
  resetReadyShell();
});

/** Mount the shell and let the page proxies settle, so the tree axe walks is the one a reader meets. */
async function mountReady() {
  const shell = mountReadyShell();
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 50));
  });
  const seen = shellChrome(shell.view);
  /*
   * The guard against auditing nothing. A mount that silently fell back to `loading` would hand axe an empty
   * frame and a clean report — the failure mode this file exists to prevent wearing the costume of a pass.
   * Measured with the load faked back to `loading`, all three cases fail here: `{pages: 0, thumbnails: 0}`.
   */
  expect(
    { pages: seen.pages, thumbnails: seen.thumbnails, count: seen.count },
    'the shell mounted a document, not a waiting notice',
  ).toEqual({ pages: expect.any(Number), thumbnails: NUM_PAGES, count: `of ${NUM_PAGES}` });
  expect(seen.pages).toBeGreaterThan(0);
  return shell;
}

/** The parts the audit is claimed to have walked, so a clean report cannot come from a thin tree. */
function reached(view: ReturnType<typeof mountReadyShell>['view']) {
  const c = view.container;
  return {
    pageCanvas: c.querySelectorAll('.pjsr-page canvas').length,
    textLayers: c.querySelectorAll('.pjsr-text-layer').length,
    annotationLayers: c.querySelectorAll('.pjsr-annotation-layer').length,
    thumbnails: c.querySelectorAll('.pjsr-thumbnail').length,
    liveRegions: c.querySelectorAll('[aria-live]').length,
    toolbarControls: c.querySelectorAll('.pjsr-toolbar .pjsr-button').length,
  };
}

/** Rules jsdom cannot decide, whatever axe's version — the set is tolerant for the reason in the audit file. */
const NEEDS_LAYOUT = new Set(['aria-hidden-focus', 'color-contrast', 'label-content-name-mismatch']);
const CANNOT_EVALUATE = /encountered an error|cannot (?:be )?evaluat|not able to determin/i;

const reportIncompletes = (incomplete: { id: string; nodes: { failureSummary?: string | null }[] }[]) =>
  incomplete
    .flatMap((rule) => rule.nodes.map((node) => `${rule.id}: ${String(node.failureSummary ?? '')}`))
    .filter((line) => !CANNOT_EVALUATE.test(line));

describe('FR-45: axe over the shell with a document on screen (#247)', () => {
  it('is clean over the mounted pages, the bar and the sidebar', async () => {
    const { view } = await mountReady();
    // Every part the sentence claims to walk is present before the audit runs, so a clean report means a
    // populated tree was clean rather than a thin one was quick.
    expect(reached(view)).toEqual({
      pageCanvas: expect.any(Number),
      textLayers: expect.any(Number),
      annotationLayers: expect.any(Number),
      thumbnails: NUM_PAGES,
      liveRegions: 1,
      toolbarControls: expect.any(Number),
    });
    expect(reached(view).pageCanvas).toBeGreaterThan(0);
    expect(reached(view).textLayers).toBeGreaterThan(0);
    expect(reached(view).annotationLayers).toBeGreaterThan(0);
    expect(reached(view).toolbarControls).toBeGreaterThan(0);

    const result = await runAudit(view.container);
    recordAudit(result);
    expect(violationList(result), violationList(result).join('\n')).toEqual([]);
    // The reach of the run, asserted rather than assumed: nothing here may be an incomplete *finding*.
    expect(reportIncompletes(result.incomplete), 'incomplete rules must be jsdom blind spots').toEqual([]);
    expect([...new Set(result.incomplete.map((rule) => rule.id))].filter((id) => !NEEDS_LAYOUT.has(id))).toEqual([]);
    // Measured 2026-10-07: 19 rules reported and 244 nodes evaluated. The floor is deliberately far below the
    // reading — it is the "axe walked a shell" guard, and a run that reported three rules on thirty nodes
    // would be that guard failing rather than the shell getting smaller.
    expect(result.passes.length, 'the audit reported too few rules to have walked the shell').toBeGreaterThanOrEqual(
      15,
    );
    expect(
      result.passes.reduce((n, rule) => n + rule.nodes.length, 0),
      'the audit evaluated too few nodes to have reached the pages, the bar and the sidebar',
    ).toBeGreaterThanOrEqual(150);
  });

  it('is still clean after the reader moves a page with the keyboard', async () => {
    const { view, controller } = await mountReady();
    const root = view.container.querySelector('.pjsr-viewer')!;
    await pressKeyIn(root, 'PageDown');
    expect(controller().currentPage, 'the reader moved').toBe(2);
    expect(shellChrome(view).pageInput, 'and the bar followed').toBe('2');

    const result = await runAudit(view.container);
    recordAudit(result);
    expect(violationList(result), `after a page change: ${violationList(result).join('\n')}`).toEqual([]);
    // Two ids in the whole mount, both the sidebar's (measured), so this is a floor that a future part can trip
    // rather than a claim about what crosses parts today — see the header.
    const ids = Array.from(view.container.querySelectorAll('[id]')).map((el) => el.id);
    expect(ids.length, 'the mounted shell minted no ids at all, so this check would be vacuous').toBeGreaterThanOrEqual(
      2,
    );
    expect(
      ids.filter((id, i) => ids.indexOf(id) !== i),
      'generated ids stay unique per instance',
    ).toEqual([]);
  });

  it('is clean with the bar folded and its ⋯ panel open', async () => {
    /*
     * The fold needs the harness's one optional fake: the planner reads `offsetWidth`, jsdom gives 0, and ten
     * 0-wide controls never overflow. 150 px per control in a 320 px bar is the shape the `toolbar-fold`
     * browser check meets at 375 px, and it is the first time this markup has been through axe anywhere.
     */
    readyViewport.width = 320;
    readyFold.itemWidth = 150;
    const { view } = await mountReady();

    const trigger = view.container.querySelector<HTMLButtonElement>('.pjsr-overflow .pjsr-button');
    if (!trigger) throw new Error(`the bar did not fold at ${readyViewport.width}px, so the panel was never audited`);
    await act(async () => {
      trigger.click();
    });
    const rows = view.container.querySelectorAll('.pjsr-overflow-row');
    expect(rows.length, 'the opened panel showed no rows').toBeGreaterThan(0);
    expect(
      view.container.querySelectorAll('.pjsr-overflow-menu [aria-label], .pjsr-overflow-menu [role]').length,
      'the panel rows hold no accessible naming surface',
    ).toBeGreaterThan(0);

    const result = await runAudit(view.container);
    recordAudit(result);
    expect(violationList(result), `with the ⋯ panel open: ${violationList(result).join('\n')}`).toEqual([]);
  });

  it('can fail, because it is looking at the tree it claims to walk', async () => {
    // The counterfactual the house rule asks for: an audit that cannot report a violation is not evidence. This
    // one introduces the shape the first FR-45 run actually found — a control inside a `role="tablist"` that a
    // tablist may not own — into the mounted sidebar rather than onto a page of its own.
    const { view } = await mountReady();
    const tablist = view.container.querySelector('[role="tablist"]');
    if (!tablist) throw new Error('the mounted shell has no tablist, so this counterfactual proves nothing');
    const stray = view.container.ownerDocument!.createElement('button');
    stray.type = 'button';
    stray.setAttribute('role', 'listitem');
    stray.textContent = 'A row that belongs to no list';
    tablist.appendChild(stray);

    const result = await runAudit(view.container);
    recordAudit(result, { expectViolation: true });
    expect(
      violationList(result).some((line) => line.startsWith('aria-required-children')),
      violationList(result).join('\n') || 'axe saw nothing at all',
    ).toBe(true);
  });
});
