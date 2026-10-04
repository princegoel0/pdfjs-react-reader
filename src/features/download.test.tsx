/**
 * Which branch the download control asks `usePdfDownload` to take.
 *
 * The decision is a two-peer question — "did the reader change anything?" — and it
 * failed in one direction only: a document annotated without the form feature
 * downloaded byte-identical to the file it was opened from, because the gate read
 * `forms.isDirty` alone and `getData()` has no annotations in it. A test of the
 * general peer machinery would not have caught that; this is about which peer is
 * consulted, under the real feature ids, with the real control in front of it.
 */
import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { FeaturePart, FeatureRunners, useFeatureStore, usePdfFeaturePublish } from '../components/FeatureHost';
import { DEFAULT_LABELS } from '../lib/labels';
import { downloadFeature } from './download';
import { ANNOTATE_FEATURE_ID, FORMS_FEATURE_ID } from '../lib/feature-ids';
import type { AnyPdfFeature, PdfViewerShell } from '../lib/features';

const { download } = vi.hoisted(() => ({ download: vi.fn() }));

vi.mock('../headless/usePdfDownload', () => ({
  usePdfDownload: () => ({ download, isBusy: false, error: null, fileName: 'doc.pdf' }),
}));

const shell = { labels: DEFAULT_LABELS } as unknown as PdfViewerShell;

afterEach(() => {
  cleanup();
  download.mockClear();
});

/** A feature that publishes a fixed state under a real peer id. */
function publisher<T extends object>(id: string, state: T): AnyPdfFeature {
  return {
    id,
    Runner() {
      usePdfFeaturePublish(state);
      return null;
    },
  };
}

function annotateWith(canUndo: boolean): AnyPdfFeature {
  return publisher(ANNOTATE_FEATURE_ID, { editing: { canUndo } });
}

function Harness({ features }: { features: AnyPdfFeature[] }) {
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

function pressDownload(): void {
  const button = screen.getByLabelText(DEFAULT_LABELS.downloadDocument);
  act(() => button.click());
}

const asked = (): Record<string, unknown> => download.mock.calls.at(-1)?.[0] ?? {};

describe('downloadFeature decides between the pristine file and a save', () => {
  it('saves when the reader has made a mark and no form feature is mounted', () => {
    // The regression: `annotate` alone was invisible to the gate, so the download was
    // the file as loaded and the marks were gone without a word.
    render(<Harness features={[annotateWith(true), downloadFeature]} />);
    pressDownload();
    expect(asked()).toEqual({ saveEdits: true });
  });

  it('saves when a form field differs', () => {
    render(
      <Harness features={[publisher(FORMS_FEATURE_ID, { isDirty: true }), downloadFeature]} />,
    );
    pressDownload();
    expect(asked()).toEqual({ saveEdits: true });
  });

  it('hands back the original file while a tool is armed and nothing has been made', () => {
    // Measured: arming the highlight tool converts the document's own annotations,
    // which puts entries in `annotationStorage` without the reader having changed a
    // thing. The undo stack is what distinguishes the two.
    render(<Harness features={[annotateWith(false), downloadFeature]} />);
    pressDownload();
    expect(asked()).toEqual({ saveEdits: false });
  });

  it('hands back the original file when neither editing feature is mounted', () => {
    render(<Harness features={[downloadFeature]} />);
    pressDownload();
    expect(asked()).toEqual({ saveEdits: false });
  });
});
