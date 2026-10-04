/**
 * FR-21 and FR-56: §3.7's registration contract at the seam where it is enforced — the
 * shell's own runner host.
 *
 * Two things are being proved here that a pure-function test cannot prove. The first is
 * *when*: a duplicate id, a missing dependency and a cycle each have to fail **before any
 * Runner mounts**, because a runner that mounted has already registered listeners, built a
 * manager and published state a peer can read. Every refusal below therefore records whether
 * a Runner body ran, and asserts that none did. The second is the lifecycle: a feature's
 * `cleanup` belongs to the shell's unmount, so it runs exactly once per registration and not
 * at all when the host merely reorders the list under the same ids.
 *
 * The counterfactual for all three refusals is one edit in `src/lib/features.ts` — delete the
 * matching pass — and the consequence is visible rather than theoretical: the runners mount,
 * and the second copy of a duplicated feature reads the first copy's state.
 */
import { cleanup, render, screen } from '@testing-library/react';
import { useEffect } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import type { ReactElement } from 'react';
import {
  FeaturePart,
  FeatureRunners,
  useFeatureStore,
  usePdfFeaturePeer,
  usePdfFeaturePublish,
  usePdfFeatureState,
} from './FeatureHost';
import { isPdfError } from '../lib/errors';
import type { AnyPdfFeature, PdfViewerShell } from '../lib/features';

const shell = {} as PdfViewerShell;

// Explicit, so the file does not depend on testing-library finding a global `afterEach`.
afterEach(cleanup);

/** The shell's own wiring: runners for state, controls mounted elsewhere reading it. */
function Harness({ features }: { features: readonly AnyPdfFeature[] }) {
  const store = useFeatureStore(shell);
  return (
    <>
      <FeatureRunners features={features} store={store} />
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

/** Renders inside a try/catch: the refusal *is* a thrown §3.6 error, and the object is the evidence. */
function attempt(ui: ReactElement): unknown {
  try {
    render(ui);
    return undefined;
  } catch (error) {
    return error;
  }
}

/**
 * A feature whose Runner records that its body ran and that its initialisation effect ran.
 *
 * Both, because the two answers come apart: a re-render re-executes every Runner body in the
 * tree, so `render:` alone cannot show whether a feature was registered twice — only a second
 * `init:` can, which is what a reorder must never cause and a refusal must never reach.
 */
function loud(id: string, events: string[], extra: Partial<AnyPdfFeature> = {}): AnyPdfFeature {
  return {
    id,
    ...extra,
    Runner() {
      events.push(`render:${id}`);
      useEffect(() => {
        events.push(`init:${id}`);
        return () => {
          events.push(`teardown:${id}`);
        };
      }, []);
      return null;
    },
  };
}

describe('registration fails before any runner mounts (FR-21)', () => {
  const refusals: [string, (events: string[]) => AnyPdfFeature[], string][] = [
    ['a duplicate id', (events) => [loud('print', events), loud('print', events)], 'print'],
    [
      'a missing dependency',
      (events) => [loud('download', events, { dependsOn: ['forms'] })],
      'forms',
    ],
    [
      'a dependency cycle',
      (events) => [
        loud('a', events, { dependsOn: ['b'] }),
        loud('b', events, { dependsOn: ['a'] }),
      ],
      'a',
    ],
  ];

  it.each(refusals)('refuses %s without running a single Runner', (_case, build, named) => {
    const events: string[] = [];
    const error = attempt(<Harness features={build(events)} />);
    expect(isPdfError(error, 'CONFIGURATION_ERROR')).toBe(true);
    const pdfError = error as { message: string };
    expect(pdfError.message).toContain(named);
    expect(events, 'a Runner mounted despite the refusal').toEqual([]);
  });

  it('names the problem in structured details as well as in the message', () => {
    const events: string[] = [];
    const error = attempt(<Harness features={[loud('a', events), loud('a', events)]} />);
    expect((error as { details?: Record<string, unknown> }).details).toMatchObject({
      problem: 'duplicate-id',
      feature: 'a',
    });
  });

  it('refuses the same list the same way twice, because the shell validates on every render', () => {
    const build = (): AnyPdfFeature[] => {
      const events: string[] = [];
      return [
        loud('a', events, { dependsOn: ['b'] }),
        loud('b', events, { dependsOn: ['a'] }),
      ];
    };
    const first = attempt(<Harness features={build()} />) as { message: string };
    const second = attempt(<Harness features={build()} />) as { message: string };
    expect(second.message).toBe(first.message);
  });

  it('mounts every Runner when the same list is valid, so the refusal is what the test caught', () => {
    // The non-vacuous twin: the recording above is only evidence that a Runner *would* have
    // recorded, had it been reached.
    const events: string[] = [];
    render(<Harness features={[loud('a', events), loud('b', events)]} />);
    expect(events).toEqual(['render:a', 'render:b', 'init:a', 'init:b']);
  });
});

describe('a feature hook called where no feature is mounted (FR-21)', () => {
  it('refuses it with CONFIGURATION_ERROR, which is why the shell body cannot call one', () => {
    /*
     * FR-21 says a feature's hooks live in its Runner and never in the shell body, and the
     * mechanism that makes that a rule rather than a convention is the scope: a hook resolves
     * against the feature it was mounted under, and outside one there is nothing to resolve
     * against. Failing with §3.6's code is the honest half — the alternative is a control that
     * quietly reads whichever publication happened to be nearest, which is the same defect the
     * duplicate-id refusal exists to stop.
     */
    function Rogue() {
      usePdfFeatureState();
      return null;
    }
    const error = attempt(<Rogue />) as { code?: string; message?: string };
    expect(isPdfError(error, 'CONFIGURATION_ERROR')).toBe(true);
    expect(error.message).toContain('mounted feature');
  });
});

describe('a dependency initialises before its dependents (FR-56)', () => {
  it('mounts the dependency first whatever order the host wrote', () => {
    const events: string[] = [];
    render(
      <Harness
        features={[
          loud('dependent', events, { dependsOn: ['dependency'] }),
          loud('dependency', events),
        ]}
      />,
    );
    expect(events).toEqual([
      'render:dependency',
      'render:dependent',
      'init:dependency',
      'init:dependent',
    ]);
  });

  it('keeps two unrelated features in the order the host wrote', () => {
    const events: string[] = [];
    render(<Harness features={[loud('print', events), loud('forms', events)]} />);
    expect(events).toEqual(['render:print', 'render:forms', 'init:print', 'init:forms']);
  });
});

describe('the cleanup contract (FR-56)', () => {
  it('releases a feature when the host takes it out of the list', () => {
    const events: string[] = [];
    const a = loud('a', events, { cleanup: () => events.push('cleanup:a') });
    const b = loud('b', events, { cleanup: () => events.push('cleanup:b') });
    const { rerender } = render(<Harness features={[a, b]} />);
    rerender(<Harness features={[a]} />);
    expect(events).toContain('cleanup:b');
    expect(events).not.toContain('cleanup:a');
  });

  it('runs cleanup once per registration, on unmount as well as on removal', () => {
    const events: string[] = [];
    const feature = loud('a', events, { cleanup: () => events.push('cleanup:a') });
    const { unmount } = render(<Harness features={[feature]} />);
    expect(events).toEqual(['render:a', 'init:a']);
    unmount();
    expect(events.filter((event) => event === 'cleanup:a')).toHaveLength(1);
    expect(events.filter((event) => event === 'init:a')).toHaveLength(1);
  });

  it('does not tear down a feature that only changed position', () => {
    /*
     * The same rule that keeps a Runner's state across a reorder: reordering is not
     * re-registration. A cleanup that ran here would release listeners the surviving Runner
     * still believes it owns, which is the silent half of the defect §3.7 names.
     */
    const events: string[] = [];
    const a = loud('a', events, { cleanup: () => events.push('cleanup:a') });
    const b = loud('b', events, { cleanup: () => events.push('cleanup:b') });
    const { rerender } = render(<Harness features={[a, b]} />);
    rerender(<Harness features={[b, a]} />);
    expect(events).not.toContain('cleanup:a');
    expect(events).not.toContain('cleanup:b');
    expect(events.filter((event) => event === 'init:a')).toHaveLength(1);
    expect(events).not.toContain('teardown:a');
  });

  it('releases a feature the host took out of the list, control and all', () => {
    const forms: AnyPdfFeature = {
      id: 'forms',
      Runner() {
        usePdfFeaturePublish({ isDirty: true });
        return null;
      },
    };
    function DownloadControl() {
      // What a peer asks the mounted feature it reads — the stale-answer half of this is
      // guarded in `FeatureHost.test.tsx`, where the reader stays mounted.
      const peer = usePdfFeaturePeer<{ isDirty?: boolean }>('forms');
      return <span>{peer.isDirty ? 'save edits' : 'save file'}</span>;
    }
    const events: string[] = [];
    const download: AnyPdfFeature = {
      id: 'download',
      controls: [
        { id: 'download', priority: 1, label: () => 'download', render: DownloadControl },
      ],
      cleanup: () => events.push('cleanup:download'),
    };

    const { rerender } = render(<Harness features={[forms, download]} />);
    expect(screen.getByText('save edits').textContent).toBe('save edits');
    rerender(<Harness features={[forms]} />);
    // The control was `download`'s, so its disappearance is the other half of the same fact:
    // the registration ended, rather than its state going stale somewhere it is still read.
    expect(screen.queryByText('save edits')).toBeNull();
    expect(events).toEqual(['cleanup:download']);
  });

  it('runs the declared cleanup before the Runner’s own effect teardown', () => {
    /*
     * Measured, not assumed, and it changes what the field is for. React destroys a deleted
     * subtree's passive effects parent-first, so the shell's unmount of a feature reaches
     * `FeatureMount` before the Runner mounted inside it: when `cleanup` runs, the Runner is
     * still holding every listener its effects have not yet released. So a resource the
     * Runner owns belongs in that Runner, and `cleanup` is for the ones it does not — a
     * module-level table, an object URL kept across documents. Pinned as an assertion because
     * the documentation promises it, and because a React that flipped the order would be
     * changing what this package tells a feature author to write.
     */
    const events: string[] = [];
    const feature: AnyPdfFeature = {
      id: 'a',
      cleanup: () => events.push('cleanup:a'),
      Runner() {
        useEffect(
          () => () => {
            events.push('effect:a');
          },
          [],
        );
        return null;
      },
    };
    const { unmount } = render(<Harness features={[feature]} />);
    unmount();
    expect(events).toEqual(['cleanup:a', 'effect:a']);
  });
});
