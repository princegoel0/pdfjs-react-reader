/*
 * FR-19 / FR-28: the bar has to fold on the widest state a control can take, not on whatever state it happens
 * to be in while the page loads.
 *
 * Measured in Chromium at 1,100 px (#243): print's page scope is 116 px while it reads "All pages" and 197 px
 * once the reader chooses "From–to", the row's items summed to 1,088 px against 1,046 px available, so choosing
 * From–to was itself the event that made the bar overflow — and the planner, folding by priority, took the 197 px
 * control out of the bar and into the overflow panel. The reader's first interaction therefore hid the control
 * they were using, together with the two range fields it had just revealed.
 *
 * Measuring the widest state moves that decision to load time, where a reader can see it: at a width that cannot
 * hold 197 px the scope control is in the menu before anything is clicked, so it stays where it was when it grew
 * and the fields appear beside the control that asked for them.
 *
 * The two assertions below are the whole rule, and each fails on its own mutation: take the measuring provider
 * off the sizer and the measured copy loses the fields; make the control ignore the context and the bar copy
 * grows fields nobody asked for.
 */
import { cleanup, render } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { FeaturePart, FeatureRunners, useFeatureStore, usePdfFeaturePublish } from '../components/FeatureHost';
import { LabelsContext } from '../components/labels-context';
import { Toolbar } from '../components/Toolbar';
import { DEFAULT_LABELS } from '../lib/labels';
import { PRINT_FEATURE_ID } from '../lib/feature-ids';
import { printFeature } from '../features/print';
import type { AnyPdfFeature, PdfViewerShell } from '../lib/features';

class ObserverStub {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}

beforeAll(() => {
  globalThis.ResizeObserver = ObserverStub as unknown as typeof ResizeObserver;
});

afterEach(() => cleanup());

const shell = { labels: DEFAULT_LABELS, numPages: 20 } as unknown as PdfViewerShell;

const printControls = printFeature.controls ?? [];
const scopeControl = printControls.find((control) => control.id === 'print-pages');

if (!scopeControl) throw new Error('print no longer offers a "print-pages" control — this file is now measuring ' +
  'a control that does not exist; re-read src/features/print.tsx rather than deleting the check');

const Scope = scopeControl.render;

/**
 * Stable, and outside the component: `publish` settles when the values repeat, so an object literal rebuilt on
 * every render re-writes the store that re-renders the provider it is writing to — the loop that eats 4 GB.
 */
const published = (scope: 'all' | 'range') => ({
  supported: true,
  isPrinting: false,
  scope,
  from: 1,
  to: 2,
  setScope: vi.fn(),
  setRange: vi.fn(),
  toggle: vi.fn(),
});

const STATES = { all: published('all'), range: published('range') };

function Bar({ scope }: { scope: 'all' | 'range' }) {
  const store = useFeatureStore(shell);
  const publisher: AnyPdfFeature = {
    id: PRINT_FEATURE_ID,
    Runner() {
      usePdfFeaturePublish(STATES[scope]);
      return null;
    },
  };
  return (
    <LabelsContext.Provider value={DEFAULT_LABELS}>
      <FeatureRunners features={[publisher]} store={store} />
      <Toolbar
        currentPage={1}
        numPages={20}
        scaleMode="fit-width"
        resolvedScale={1}
        onPageChange={vi.fn()}
        onScaleModeChange={vi.fn()}
        controls={{
          add: [
            {
              id: 'print-pages',
              priority: 11,
              label: 'Print pages',
              node: (
                <FeaturePart feature={printFeature} store={store}>
                  <Scope />
                </FeaturePart>
              ),
            },
          ],
        }}
      />
    </LabelsContext.Provider>
  );
}

/** The copies of one control the bar renders: the live ones, and the hidden row it measures from. */
const copies = (container: HTMLElement) => {
  const fields = (root: Element) => root.querySelectorAll('.pjsr-print-scope-input').length;
  const all = [...container.querySelectorAll('.pjsr-print-scope')];
  return {
    sizer: all.filter((el) => el.closest('.pjsr-toolbar-sizer')).map(fields),
    bar: all.filter((el) => !el.closest('.pjsr-toolbar-sizer')).map(fields),
  };
};

describe('FR-19: what the toolbar measures a growing control at', () => {
  it('holds the range fields in the measuring copy while the bar shows only the selector', () => {
    const { container } = render(<Bar scope="all" />);
    const seen = copies(container);
    expect(seen.sizer, 'the bar renders no measurement copy, so nothing can ever fold').toEqual([2]);
    expect(seen.bar, 'the bar grew fields the reader never asked for').toEqual([0]);
  });

  it('shows the fields in the bar once the reader has chosen the range', () => {
    // Measuring wide must not mean *rendering* wide, or the fix would simply print two dead number boxes in
    // every bar. This is the half that keeps the first assertion honest.
    const { container } = render(<Bar scope="range" />);
    const seen = copies(container);
    expect(seen.bar).toEqual([2]);
    expect(seen.sizer).toEqual([2]);
  });
});
