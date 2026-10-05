/*
 * FR-47's one-finger clause, the half a jsdom file can hold: arming the pen has to reach the engine.
 *
 * The clause itself — "a one-finger drag on a drawing tool draws rather than scrolls" — is a property of a
 * browser's input pipeline, and it is measured in one: `scripts/browser-matrix.mjs#pen-draws-not-scrolls`
 * sends a real touch sequence through CDP `Input.dispatchTouchEvent`, which is the only way to ask it,
 * because a JavaScript-dispatched `TouchEvent` never reaches the compositor where `touch-action` is decided.
 * Measured on 2026-10-05 in Chromium at 6.3.289: with the pen armed the drag delivered twelve `pointermove`s
 * with **no `pointercancel`**, painted a live `<path>` into the page mid-gesture, and committed an ink editor
 * whose box was the finger's path (`width 0.53 % × height 15.05 %` for a 240 px vertical drag); with the pen
 * disarmed the identical gesture was cancelled by the browser after the first move and committed nothing.
 *
 * So the discrimination in that check is *whether the tool was armed*, and arming is one line of this
 * package's code — `src/features/annotate.tsx`'s `void uiManager?.updateMode(MODE_BY_TOOL[tool])`. Nothing
 * asserted that line before this file: `grep -rn updateMode src/` returned the implementation and no test, so
 * deleting it would have left the unit suite green and quietly turned every armed touch drag into the
 * disarmed one. The browser check would fail, but it runs in the matrix job, not in `verify`, and a clause
 * whose only guard is a job nobody ran locally is a clause that regresses on the way to the review.
 *
 * Asserted here: the button puts the engine into the ink mode and taking it back out puts it into `NONE`; each
 * tool maps to a mode of its own, because a map that gave every tool the same value would still "call
 * `updateMode`" while the pen drew nothing; and the page props that decide whether a page builds an editable
 * editor layer flip with the tool, since a stroke needs a layer that takes the pointer at all.
 *
 * The engine's own `AnnotationEditorUIManager` is replaced rather than driven: the clause is about which mode
 * the package asks for, and a real manager would answer for the rest of the pipeline jsdom does not have.
 */
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useMemo, useRef } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AnnotationEditorType } from 'pdfjs-dist';
import {
  FeaturePart,
  FeatureRunners,
  useFeatureStore,
  usePdfFeatureState,
} from '../components/FeatureHost';
import { DEFAULT_LABELS } from '../lib/labels';
import { annotateFeature, type AnnotateFeatureState } from './annotate';
import { mergeFeaturePageProps } from '../lib/features';
import type { AnyPdfFeature, PdfViewerShell } from '../lib/features';

const seen = vi.hoisted(() => ({ built: 0, modes: [] as number[] }));

vi.mock('pdfjs-dist', async (importOriginal) => {
  const actual = await importOriginal<typeof import('pdfjs-dist')>();
  class RecordingManager {
    constructor() {
      seen.built += 1;
    }
    updateMode(mode: number) {
      seen.modes.push(mode);
      return Promise.resolve();
    }
    delete(): void {}
    destroy(): void {}
  }
  return { ...actual, AnnotationEditorUIManager: RecordingManager };
});

function Harness({ out }: { out: { pageProps: unknown } }) {
  const rootRef = useRef<HTMLDivElement>(null);
  const shell = useMemo(
    () =>
      ({
        doc: { isPureXfa: false },
        rootRef,
        labels: DEFAULT_LABELS,
        scale: 1,
        rotation: 0,
        reportAnnotationChange: () => {},
        reportError: () => {},
      }) as unknown as PdfViewerShell,
    [],
  );
  const store = useFeatureStore(shell);
  const features: AnyPdfFeature[] = [annotateFeature];
  // Read during render, the way the shell does: what a page is handed is the merged value, not the state.
  out.pageProps = mergeFeaturePageProps(features, store.get);
  return (
    <>
      <div ref={rootRef} />
      <FeatureRunners features={features} store={store} />
      {(annotateFeature.controls ?? []).map((control) => (
        <FeaturePart key={control.id} feature={annotateFeature as unknown as AnyPdfFeature} store={store}>
          <Gate control={control} shell={shell} />
        </FeaturePart>
      ))}
    </>
  );
}

/**
 * The bar's own gate, not a shortcut.
 *
 * The shell asks `available` before it renders a feature control, and the answer is false on the frame before
 * the Runner's effect publishes — a control mounted straight over an empty scope reads `state.editing` out of
 * `{}` and throws. Reproducing the gate is what makes this a test of the bar a reader gets rather than of a
 * component the shell would not have drawn yet.
 */
function Gate({
  control,
  shell,
}: {
  control: NonNullable<typeof annotateFeature.controls>[number];
  shell: PdfViewerShell;
}) {
  const state = usePdfFeatureState<AnnotateFeatureState>();
  if (!(control.available?.(state, shell) ?? true)) return null;
  return <control.render />;
}

const button = (label: string) => screen.getByRole('button', { name: label });

afterEach(() => {
  cleanup();
  seen.built = 0;
  seen.modes = [];
});

describe('arming the pen is the engine being told (FR-47)', () => {
  it('asks for the ink mode when the pen is armed and for NONE when it is taken back off', async () => {
    const out: { pageProps: unknown } = { pageProps: null };
    render(<Harness out={out} />);
    // The control is gated on the manager existing, so finding the button is the mount having completed.
    const pen = await screen.findByRole('button', { name: DEFAULT_LABELS.inkTool });
    await waitFor(() => expect(seen.built).toBe(1));
    expect(seen.modes.at(-1), 'a resting bar still has to tell the engine it is resting').toBe(
      AnnotationEditorType.NONE,
    );

    fireEvent.click(pen);
    await waitFor(() => expect(seen.modes.at(-1)).toBe(AnnotationEditorType.INK));
    expect(out.pageProps).toMatchObject({ annotationEditorEditing: true });

    fireEvent.click(pen);
    await waitFor(() => expect(seen.modes.at(-1)).toBe(AnnotationEditorType.NONE));
    expect(out.pageProps).toMatchObject({ annotationEditorEditing: false });
  });

  /*
   * One mode per tool, not one call per click. The engine reads the number to decide which editor class an
   * incoming pointer starts, so a map that gave the pen the highlighter's value would arm *a* tool — the bar
   * would look right, the touch check would draw something — and FR-47's named exception would be about a
   * stroke nobody can make.
   */
  it('gives every tool a mode of its own, and the pen the ink one', async () => {
    const out: { pageProps: unknown } = { pageProps: null };
    render(<Harness out={out} />);
    await screen.findByRole('button', { name: DEFAULT_LABELS.inkTool });

    // -1 is not an engine mode, so an empty recorder cannot be mistaken for a fourth distinct answer.
    const asked: number[] = [];
    for (const [name, expected] of [
      [DEFAULT_LABELS.highlightTool, AnnotationEditorType.HIGHLIGHT],
      [DEFAULT_LABELS.freeTextTool, AnnotationEditorType.FREETEXT],
      [DEFAULT_LABELS.inkTool, AnnotationEditorType.INK],
    ] as const) {
      fireEvent.click(button(name));
      await waitFor(() => expect(seen.modes.at(-1)).toBe(expected));
      asked.push(seen.modes.at(-1) ?? -1);
      // Back to resting before the next tool, so each click is measured on its own rather than as a diff.
      fireEvent.click(button(name));
      await waitFor(() => expect(seen.modes.at(-1)).toBe(AnnotationEditorType.NONE));
    }
    expect(new Set(asked).size, `the bar offered the same mode twice: ${asked.join(', ')}`).toBe(3);
  });

  /*
   * The stroke lands in the annotation storage the download and the flatten read, which is what makes this
   * the ink that survives rather than a drawing on the screen. The manager is the only route to it, so the
   * value the feature publishes has to be the instance the pages were handed — a bar that armed a *second*
   * manager would draw into one and save from the other.
   */
  it('hands the pages the same manager the bar arms', async () => {
    const out: { pageProps: unknown } = { pageProps: null };
    render(<Harness out={out} />);
    await screen.findByRole('button', { name: DEFAULT_LABELS.inkTool });
    const published = (out.pageProps as { annotationEditorUIManager: unknown }).annotationEditorUIManager;
    expect(published).toBeTruthy();
    expect(seen.built, 'the bar and the pages are not looking at one manager').toBe(1);
    fireEvent.click(button(DEFAULT_LABELS.inkTool));
    await waitFor(() => expect(seen.modes.at(-1)).toBe(AnnotationEditorType.INK));
    expect((out.pageProps as { annotationEditorUIManager: unknown }).annotationEditorUIManager).toBe(published);
  });

  it('arms nothing when no tool was asked for', async () => {
    // A feature whose mount armed a tool would take the finger away from the reader who only opened the file.
    const out: { pageProps: unknown } = { pageProps: null };
    render(<Harness out={out} />);
    await screen.findByRole('button', { name: DEFAULT_LABELS.inkTool });
    await waitFor(() => expect(seen.built).toBe(1));
    expect(seen.modes).toEqual([AnnotationEditorType.NONE]);
    expect(out.pageProps).toMatchObject({ annotationEditorEditing: false });
  });
});
