/**
 * The feature seam, tested against the machinery the shell actually uses —
 * `useFeatureStore`, `FeatureRunners` and `FeaturePart` — rather than against a
 * prototype of it. These are the rules that fail silently: a lost search query,
 * a download that saves form edits nobody made, a Runner that re-renders the
 * viewer forever. What they cannot cover is a real document rendering, which is
 * what the playground pass is for.
 */
import { act, cleanup, render, screen } from '@testing-library/react';
import { useCallback, useEffect, useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  FeaturePart,
  FeatureRunners,
  useFeatureStore,
  usePdfFeaturePeer,
  usePdfFeaturePublish,
  usePdfFeatureState,
  type FeatureStore,
} from './FeatureHost';
import type { AnyPdfFeature, PdfViewerShell } from '../lib/features';

const shell = {} as PdfViewerShell;

// Explicit, so the file does not depend on testing-library finding a global
// `afterEach` to register its own cleanup into.
afterEach(cleanup);

/** Mirrors the shell's wiring: Runners for state, controls that read it. */
function Harness({
  features,
  positionalRunners,
}: {
  features: AnyPdfFeature[];
  positionalRunners?: boolean;
}) {
  const store = useFeatureStore(shell);
  return (
    <>
      {positionalRunners ? (
        <PositionalRunners features={features} store={store} />
      ) : (
        <FeatureRunners features={features} store={store} />
      )}
      {features.flatMap((feature) =>
        (feature.controls ?? []).map((control) => (
          <FeaturePart key={control.id} feature={feature} store={store}>
            <control.render />
          </FeaturePart>
        )),
      )}
    </>
  );
}

/** `FeatureRunners` with the one thing it does right taken out. */
function PositionalRunners({
  features,
  store,
}: {
  features: AnyPdfFeature[];
  store: FeatureStore;
}) {
  return (
    <>
      {features.map((feature, index) => (
        <FeaturePart key={index} feature={feature} store={store}>
          {feature.Runner ? <feature.Runner /> : null}
        </FeaturePart>
      ))}
    </>
  );
}

/** A feature whose state is one counter, bumped through its own control. */
function counterFeature(id: string, events: string[] = []): AnyPdfFeature {
  function Runner() {
    const [count, setCount] = useState(0);
    const bump = useCallback(() => setCount((c) => c + 1), []);
    useEffect(() => {
      events.push(`${id}:mount`);
      return () => {
        events.push(`${id}:unmount`);
      };
    }, []);
    usePdfFeaturePublish({ count, bump });
    return null;
  }
  function Control() {
    const state = usePdfFeatureState<{ count: number; bump: () => void }>();
    return (
      <button type="button" data-testid={id} onClick={() => state.bump?.()}>
        {`${id}:${state.count ?? 'none'}`}
      </button>
    );
  }
  return { id, Runner, controls: [{ id, priority: 1, label: () => id, render: Control }] };
}

function bump(testId: string, times = 1) {
  for (let i = 0; i < times; i++) {
    act(() => {
      (screen.getByTestId(testId) as HTMLButtonElement).click();
    });
  }
}

describe('feature publication store', () => {
  it('carries state from a Runner to a control mounted elsewhere in the tree', () => {
    render(<Harness features={[counterFeature('a')]} />);
    expect(screen.getByTestId('a').textContent).toBe('a:0');
    bump('a', 2);
    expect(screen.getByTestId('a').textContent).toBe('a:2');
  });

  it('renders a control before its Runner has published, without throwing', () => {
    // The first pass always looks like this: the toolbar has rendered and the
    // publication lands in the effect after. A control that assumed state
    // existed would crash the viewer on mount.
    const feature: AnyPdfFeature = {
      id: 'late',
      Runner() {
        usePdfFeaturePublish({ ready: true });
        return null;
      },
    };
    function Control() {
      const state = usePdfFeatureState<{ ready?: boolean }>();
      return <span>{state.ready ? 'ready' : 'not yet'}</span>;
    }
    const withControl: AnyPdfFeature = { ...feature, controls: [{ id: 'c', priority: 1, label: () => 'c', render: Control }] };
    render(<Harness features={[withControl]} />);
    expect(screen.getByText('ready')).toBeTruthy();
  });

  it('does not re-render the shell when a Runner rebuilds the same values', () => {
    let runnerRenders = 0;
    let shellRenders = 0;
    const feature: AnyPdfFeature = {
      id: 'noisy',
      Runner() {
        runnerRenders += 1;
        if (runnerRenders > 100) throw new Error('publish loop');
        // A fresh object with identical values, every single render.
        usePdfFeaturePublish({ stable: 1, label: 'same' });
        return null;
      },
    };
    function Control() {
      shellRenders += 1;
      return <span>{usePdfFeatureState<{ label?: string }>().label ?? 'none'}</span>;
    }
    const { rerender } = render(
      <Harness features={[{ ...feature, controls: [{ id: 'c', priority: 1, label: () => 'c', render: Control }] }]} />,
    );
    rerender(
      <Harness features={[{ ...feature, controls: [{ id: 'c', priority: 1, label: () => 'c', render: Control }] }]} />,
    );
    expect(screen.getByText('same')).toBeTruthy();
    expect(runnerRenders).toBeLessThan(6);
    expect(shellRenders).toBeLessThan(6);
  });

  it('keeps each feature on its own Runner instance when the list reorders', () => {
    /*
     * Both features share one Runner function on purpose. With distinct Runner
     * identities React has to remount on a positional key anyway, so the type
     * system hides the bug; sharing the identity is what exposes it. Keyed by
     * position, the instance holding `a`'s count stays at slot 0 and becomes
     * `b`'s state — no error, just a print job that forgot where it was.
     */
    function SharedRunner() {
      const [count, setCount] = useState(0);
      const bump = useCallback(() => setCount((c) => c + 1), []);
      usePdfFeaturePublish({ count, bump });
      return null;
    }
    const featureFor = (id: string): AnyPdfFeature => ({
      id,
      Runner: SharedRunner,
      controls: [
        {
          id,
          priority: 1,
          label: () => id,
          render: function Control() {
            const state = usePdfFeatureState<{ count: number; bump: () => void }>();
            return (
              <button type="button" data-testid={id} onClick={() => state.bump?.()}>
                {`${id}:${state.count ?? 'none'}`}
              </button>
            );
          },
        },
      ],
    });

    const a = featureFor('a');
    const b = featureFor('b');
    const keyed = render(<Harness features={[a, b]} />);
    bump('a', 2);
    expect(screen.getByTestId('a').textContent).toBe('a:2');
    expect(screen.getByTestId('b').textContent).toBe('b:0');

    keyed.rerender(<Harness features={[b, a]} />);
    expect(screen.getByTestId('a').textContent).toBe('a:2');
    expect(screen.getByTestId('b').textContent).toBe('b:0');
    keyed.unmount();

    // The twin that differs only in the key loses it, which is what makes the
    // two assertions above a test rather than a tautology. This is the failure
    // the PRD's FR-21 acceptance note describes, reproduced rather than asserted.
    const positional = render(<Harness features={[a, b]} positionalRunners />);
    bump('a', 2);
    expect(screen.getByTestId('a').textContent).toBe('a:2');
    positional.rerender(<Harness features={[b, a]} positionalRunners />);
    expect(screen.getByTestId('b').textContent).toBe('b:2');
    expect(screen.getByTestId('a').textContent).not.toBe('a:2');
  });

  it('drops the survivor cleanly when an earlier sibling goes away', () => {
    const events: string[] = [];
    const a = counterFeature('a', events);
    const b = counterFeature('b', events);
    const { rerender } = render(<Harness features={[b, a]} />);
    bump('a', 3);
    expect(screen.getByTestId('a').textContent).toBe('a:3');

    // `a` shifts from slot 1 to slot 0, the case a positional key breaks on.
    rerender(<Harness features={[a]} />);
    expect(events).not.toContain('a:unmount');
    expect(screen.getByTestId('a').textContent).toBe('a:3');
  });

  it('stops a peer seeing state from a feature that is no longer mounted', () => {
    const forms: AnyPdfFeature = {
      id: 'forms',
      Runner() {
        usePdfFeaturePublish({ isDirty: true });
        return null;
      },
    };
    function DownloadControl() {
      // Download asks forms whether there are edits to save. A publication that
      // outlived its feature would keep saving edits the reader already threw away.
      const formsPeer = usePdfFeaturePeer<{ isDirty?: boolean }>('forms');
      return <span>{formsPeer.isDirty ? 'save edits' : 'save file'}</span>;
    }
    const download: AnyPdfFeature = {
      id: 'download',
      controls: [{ id: 'download', priority: 1, label: () => 'download', render: DownloadControl }],
    };

    const { rerender } = render(<Harness features={[forms, download]} />);
    expect(screen.getByText('save edits')).toBeTruthy();

    rerender(<Harness features={[download]} />);
    expect(screen.getByText('save file')).toBeTruthy();
  });

  it('routes a page-less feature list through without touching the DOM', () => {
    const spy = vi.fn();
    const stateless: AnyPdfFeature = { id: 'quiet', Runner: spy };
    const { container } = render(<Harness features={[stateless]} />);
    expect(spy).toHaveBeenCalled();
    expect(container.childElementCount).toBe(0);
  });
});
