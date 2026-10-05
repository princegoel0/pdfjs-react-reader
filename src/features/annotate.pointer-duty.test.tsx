/*
 * FR-47's named exception, said on the control that offers it (#226).
 *
 * The amendment the owner ruled on 2026-10-04 kept FR-47's "every gesture has a keyboard or control
 * equivalent" and added one exception to it — a freehand stroke is a pointer act, and there is no key-by-key
 * way to make the mark — with a duty attached: *where the package offers one it says so on the control rather
 * than leaving the reader to discover the absence*. Before this, the pen button said nothing at all. A keyboard
 * reader who armed it armed a tool that then waited for a drag that never came, and found the exception out by
 * trying.
 *
 * So the bar keeps an element with the sentence, and the pen's button points at it with `aria-describedby`.
 * Three things that choice has to survive, all asserted here:
 *
 *  - the reference resolves in **both** states. `aria-describedby` to an id that only exists while the tool is
 *    armed is an invalid reference half the time, and axe-core calls that a violation, so the element is always
 *    rendered and only its visibility changes;
 *  - the other two tools say nothing. A bar that warns beside every button has stopped telling anyone anything,
 *    and the amendment names exactly one exception — highlight and free text are not it;
 *  - the hidden half is hidden *clipped*, not with `display: none`, because a description on an element outside
 *    the accessibility tree is not a description. jsdom resolves no stylesheets, so that one is checked in the
 *    sheet the build ships, the way the forced-colours guard checks its declarations.
 *
 * Measured on 2026-10-05 by breaking each half in turn (`.spike/counterfactual-226.mjs`, every mutation
 * restored byte-for-byte; its CF0 run of the unmutated tree reported 7 passed / 0 failed):
 *  - `aria-describedby={undefined}` on the pen: **2 failed** — `the pen carries no description at all:
 *    expected null to be truthy`, in both armed states;
 *  - the described element rendered only while the pen is armed: **2 failed** — the resting one answering
 *    `expected undefined to be 'Drawing needs a mouse, a pen or a fin…'`, and the "nowhere else" case answering
 *    `expected  to have a length of 1 but got +0`. A reference that does not resolve is exactly the case a
 *    screen reader meets most of the time, because the bar spends its life unarmed;
 *  - the sentence put on all three buttons: **1 failed** — `Highlight is not the exception FR-47 names, so it
 *    declares nothing: expected '_r_2_' to be null`;
 *  - the clip block replaced by `display: none`: **1 failed** on the stylesheet case,
 *    `expected '.pjsr-annotate-hint {\r\n display: n…' to match /position:\s*absolute/`.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { FeaturePart, type FeatureStore } from '../components/FeatureHost';
import { DEFAULT_LABELS } from '../lib/labels';
import { annotateFeature, type AnnotateFeatureState, type AnnotateTool } from './annotate';
import type { AnyPdfFeature, PdfViewerShell } from '../lib/features';

const shell = { labels: DEFAULT_LABELS } as unknown as PdfViewerShell;

/** A scope holding one publication, which is what the Runner would have handed the toolbar on the frame after its effect. */
const storeFor = (state: AnnotateFeatureState): FeatureStore =>
  ({ shell, get: () => state, publish: () => {}, retire: () => {} }) as unknown as FeatureStore;

afterEach(cleanup);

/**
 * The bar under a store that already holds the feature's state.
 *
 * The real shell builds that state in the feature's `Runner` and publishes it from an effect, and its toolbar
 * asks `available` before it renders the control — which is why `{}` on a first pass is never read as
 * `state.editing`. A harness that mounts the control directly has to start from the state it will read, so it
 * hands the scope a store rather than running the lifecycle; the alternative is an assertion about a bar that
 * the shell would not have drawn at all.
 */
function Bar({ tool }: { tool: AnnotateTool }) {
  const state: AnnotateFeatureState = {
    uiManager: {} as never,
    tool,
    setTool: vi.fn(),
    editing: {
      isEditing: tool !== 'none',
      isEmpty: true,
      canUndo: false,
      canRedo: false,
      canDelete: false,
      hasSelectedText: false,
    },
    highlightColor: '#FFCD00',
    setHighlightColor: vi.fn(),
    deleteSelection: vi.fn(),
  };
  return (
    <>
      {(annotateFeature.controls ?? []).map((control) => (
        <FeaturePart
          key={control.id}
          feature={annotateFeature as unknown as AnyPdfFeature}
          store={storeFor(state)}
        >
          <control.render />
        </FeaturePart>
      ))}
    </>
  );
}

const toolButton = (name: string) => screen.getByRole('button', { name });

describe('the pen says what it cannot be done with (FR-47)', () => {
  for (const tool of ['none', 'ink'] as const) {
    it(`points from the ink button to the sentence whether or not the pen is armed (armed: ${tool})`, () => {
      const { container } = render(<Bar tool={tool} />);
      const describedBy = toolButton(DEFAULT_LABELS.inkTool).getAttribute('aria-describedby');
      expect(describedBy, 'the pen carries no description at all').toBeTruthy();
      // The reference has to resolve, in this state and the other one: a description that exists only while
      // the tool is armed is an invalid `aria-describedby` the rest of the time.
      const hint = document.getElementById(describedBy!);
      expect(hint?.textContent).toBe(DEFAULT_LABELS.inkNeedsPointer);
    });
  }

  it('says it on the pen, and nowhere else in the bar', () => {
    const { container } = render(<Bar tool='none' />);
    for (const name of [DEFAULT_LABELS.highlightTool, DEFAULT_LABELS.freeTextTool]) {
      expect(
        toolButton(name).getAttribute('aria-describedby'),
        `${name} is not the exception FR-47 names, so it declares nothing`,
      ).toBeNull();
    }
    // And the sentence is one element, not three.
    expect(container.querySelectorAll('.pjsr-annotate-hint')).toHaveLength(1);
  });

  it('lets the sentence become visible while the pen is armed', () => {
    const resting = render(<Bar tool='none' />);
    expect(resting.container.querySelector('.pjsr-annotate')?.getAttribute('data-ink-armed')).toBe('false');
    cleanup();
    const armed = render(<Bar tool='ink' />);
    expect(armed.container.querySelector('.pjsr-annotate')?.getAttribute('data-ink-armed')).toBe('true');
  });

  it('hides it by clipping rather than by leaving the accessibility tree', () => {
    // jsdom resolves no stylesheets, so this reads the sheet the build ships — the same move the
    // forced-colours and stylesheet guards make. `display: none` would keep the bar tidy and throw the
    // description away, which is the exact failure the clause is about.
    const css = readFileSync(join(process.cwd(), 'src/styles/annotate.css'), 'latin1');
    const block = css.slice(
      css.indexOf('.pjsr-annotate-hint {'),
      css.indexOf('}', css.indexOf('.pjsr-annotate-hint {')),
    );
    expect(block).toMatch(/clip-path:\s*inset\(50%\)/);
    expect(block).toMatch(/position:\s*absolute/);
    expect(block).not.toMatch(/display:\s*none|visibility:\s*hidden/);
    expect(css).toMatch(/\[data-ink-armed='true'\]\s*\.pjsr-annotate-hint\s*\{/);
  });
});
