/*
 * FR-45: the audit, so conformance is a failing test rather than a list of things someone remembered.
 *
 * Everything `PRD.md` §Access promises about the shell was already checked by a hand-written assertion —
 * valid ARIA, instance-scoped keys, `useId`, focus, 44 px targets, announcements, reduced motion. Those
 * prove the rules somebody thought to write down. This file runs axe-core over the same DOM with the WCAG
 * 2.0/2.1/2.2 A and AA tags, which is how an unremembered rule gets noticed: an `aria-labelledby` pointing
 * at an id that does not exist, a list of `role="option"`s outside a listbox, a `tabindex` on a `div` that
 * is not focusable by role. The audit is a test rather than a script so that it fails the `react` matrix
 * and the consumer jobs exactly the way every other test here does.
 *
 * What it cannot see is stated in `unreachable` below and asserted, not waved at. axe evaluates layout —
 * contrast, target size, whether an element is actually visible — and jsdom has none, so those rules come
 * back `incomplete` here and belong to the `0.12` browser matrix alongside the assistive-technology pass.
 */
import { act, cleanup, render } from '@testing-library/react';
import { useEffect } from 'react';
import axe from 'axe-core';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { OutlineView } from './OutlineView';
import { PasswordPrompt } from './PasswordPrompt';
import { useViewer, ViewerProvider } from './ViewerContext';
import { ViewerLayout } from './ViewerLayout';
import { useViewerController, type ViewerController } from './ViewerController';
import { OUTLINE_FEATURE_ID } from '../lib/feature-ids';
import type { FeaturePublication } from '../lib/features';
import type { OutlineEntry, PdfDestinationPosition } from '../lib/outline';
import type { PasswordReason } from '../lib/status';

// The toolbar and the virtualizer both measure with ResizeObserver, which jsdom does not implement; the
// same stub the layout tests install, reporting no size change.
class ObserverStub {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}
globalThis.ResizeObserver = ObserverStub as unknown as typeof ResizeObserver;

const scenario = vi.hoisted(() => ({ current: 'loading' as 'loading' | 'error' | 'password' }));

vi.mock('../headless/usePdfDocument', () => ({
  usePdfDocument: () =>
    scenario.current === 'error'
      ? {
          status: 'error',
          doc: null,
          numPages: 0,
          isReady: false,
          error: new Error('Invalid PDF structure.'),
          capabilities: null,
          passwordRequest: null,
          reload: vi.fn(),
        }
      : {
          status: 'loading',
          doc: null,
          numPages: 0,
          isReady: false,
          error: null,
          capabilities: null,
          // FR-03's prompt is one value of the same §3.5 union, so it is the loading status carrying a
          // request — which is what makes the shell render the form rather than the waiting notice.
          passwordRequest:
            scenario.current === 'password'
              ? { reason: 'wrong-password' as PasswordReason, submit: vi.fn() }
              : null,
          reload: vi.fn(),
        },
}));

afterEach(() => {
  cleanup();
  scenario.current = 'loading';
});

let controller: ViewerController | null = null;

function Shell({ children }: { children?: React.ReactNode }) {
  controller = useViewerController({ src: '/fixtures/outline-sample.pdf' });
  return (
    <div className="pjsr-host">
      <ViewerProvider controller={controller}>
        <ViewerLayout controller={controller} />
      </ViewerProvider>
      {children}
    </div>
  );
}

/**
 * Stands where the outline tier's Runner would be.
 *
 * `OutlineView` reads the store now — that is FR-28's composed shape — so an audit that handed it `entries`
 * as a prop would be auditing markup nothing in the package renders any more. This publishes the same two
 * fields the tier publishes, and the tree the audit walks is the one a reader meets.
 */
function PublishOutline({ publication }: { publication: FeaturePublication }) {
  const { store } = useViewer();
  // Deps on the publication, not on every render: `publish` settles as soon as the values repeat, and an
  // effect that writes the store on each commit re-renders the provider it is writing to.
  useEffect(() => {
    store.publish(OUTLINE_FEATURE_ID, publication);
  }, [store, publication]);
  return null;
}

function OutlineTree({ entries }: { entries: OutlineEntry[] }) {
  controller = useViewerController({ src: '/fixtures/outline-sample.pdf' });
  return (
    <div className="pjsr-host">
      <ViewerProvider controller={controller}>
        <PublishOutline publication={{ entries, loading: false }} />
        <OutlineView />
      </ViewerProvider>
    </div>
  );
}

/** The report is only useful if it says which node and which rule, so the ids and targets come along. */
async function run(node: Element) {
  const { violations, incomplete, passes } = await axe.run(node as HTMLElement, {
    runOnly: {
      type: 'tag',
      values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'],
    },
  });
  return {
    violations: violations.map(
      (v) => `${v.id} — ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`,
    ),
    incomplete: incomplete.map((rule) => rule.id),
    passed: passes.length,
  };
}

const expectClean = async (node: Element, label: string) => {
  const { violations, passed } = await run(node);
  // A number rather than a boolean, so a state that silently stops rendering anything fails for the
  // right reason: an empty subtree has no violations either.
  expect(passed, `${label}: the audit found nothing to check`).toBeGreaterThan(0);
  expect(violations, label).toEqual([]);
};

describe('the shell, audited', () => {
  it('is clean while it waits for a document', async () => {
    const { container } = render(<Shell />);
    await expectClean(container, 'loading');
  });

  it('is clean when the load failed', async () => {
    scenario.current = 'error';
    const { container } = render(<Shell />);
    await expectClean(container, 'error');
  });

  it('is clean while it asks for a password', async () => {
    scenario.current = 'password';
    const { container } = render(<Shell />);
    await expectClean(container, 'password prompt');
  });

  it('is clean with the sidebar open on each tab', async () => {
    const { container } = render(<Shell />);
    for (const tab of ['thumbnails', 'outline', 'layers', 'attachments'] as const) {
      act(() => {
        controller?.setSidebarOpen(true);
        controller?.setSidebarTab(tab);
      });
      await expectClean(container, `sidebar: ${tab}`);
    }
  });

  it('is clean with the search bar open', async () => {
    const { container } = render(<Shell />);
    act(() => {
      controller?.setSearchOpen(true);
    });
    await expectClean(container, 'search');
  });
});

describe('the primitives, audited on their own', () => {
  it('carries an outline tree with nested entries', async () => {
    const entry = (
      title: string,
      pageIndex: number,
      children: OutlineEntry[] = [],
      collapsed = false,
      // A place, not just a page: the tree the audit walks is the one the shell renders, and a bookmark that
      // carries a position is the ordinary case rather than the interesting one.
      position: PdfDestinationPosition | null = { kind: 'XYZ', left: 72, top: 660, zoom: null },
    ): OutlineEntry => ({ title, pageIndex, position, children, collapsed });
    const entries: OutlineEntry[] = [
      entry('Summary', 0, [entry('Revenue', 1), entry('Costs', 2, [], true)]),
    ];
    const { container } = render(<OutlineTree entries={entries} />);
    await expectClean(container, 'outline');
  });

  it('asks for a credential it cannot see', async () => {
    const { container } = render(
      <PasswordPrompt reason="incorrect-password" onSubmit={vi.fn()} onCancel={vi.fn()} />,
    );
    await expectClean(container, 'password prompt primitive');
  });

  /*
   * This one subtree stays a copy. `a11y.page.test.tsx` audits the real `PdfPage` — its text layer and its
   * marks — against a page proxy it can hand directly, but the structure tree is built by the
   * engine's own `StructTreeLayerBuilder`, which lives in `pdfjs-dist/web/pdf_viewer.mjs`, and that module
   * does not boot under jsdom at all (the 0.10 pass tried). So the markup below is what the browser pass
   * measured — the tree the engine renders beside the canvas, with the ids the spans really carry — written
   * out to be audited while the component itself cannot be. A drift between this and the engine's output is
   * a gap in this file, and the `0.12` matrix closes it.
   */
  it('wraps a page in structure that belongs to it', async () => {
    const { container } = render(
      <div className="pjsr-viewer">
        <div className="pjsr-page">
          <div className="pjsr-canvas-wrapper">
            <div className="pjsr-page-canvas" role="img" aria-label="Page 1 of 3">
              <canvas />
            </div>
            <div className="structTree">
              <div role="heading" aria-level={1} aria-owns="p1R_mc0">
                Revenue
              </div>
              <div role="list">
                <div role="listitem" aria-owns="p1R_mc1">
                  Q1
                </div>
              </div>
              <div role="figure" aria-label="Quarterly revenue, in millions" aria-owns="p1R_mc2" />
            </div>
          </div>
          <div className="pjsr-text-layer">
            <span id="p1R_mc0">Revenue</span>
            <span id="p1R_mc1">Q1</span>
            <span id="p1R_mc2">12</span>
            <mark className="pjsr-mark" aria-current="false">
              Revenue
            </mark>
            <mark className="pjsr-mark pjsr-mark--active" aria-current="true">
              Revenue
            </mark>
          </div>
        </div>
      </div>,
    );
    await expectClean(container, 'page layers');
  });
});

/*
 * The audit's own reach, asserted. If axe ever starts resolving layout under jsdom, `color-contrast`
 * leaves this list and the test fails — which is the moment to re-read what this file claims, not to drop
 * the id from the array.
 */
describe('what the audit cannot see', () => {
  it('has no layout to evaluate contrast or target size against', async () => {
    const { container } = render(<Shell />);
    const { incomplete } = await run(container);
    expect(incomplete.sort()).toEqual(['aria-hidden-focus', 'color-contrast']);
  });
});
