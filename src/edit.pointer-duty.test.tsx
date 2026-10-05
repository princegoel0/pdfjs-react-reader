/*
 * FR-47's other pointer-only surface: the signing pad says its exception in the panel, not in a tooltip (#226).
 *
 * The pad already had a sentence — `signatureNeedsPointer` — and it was already in all four catalogs, so the
 * duty looked done. It was not: the sentence lived in the canvas's `title`, and a `title` is what a mouse shows
 * you. A touch device has no hover, a keyboard reader reaches the control without a pointer at all, and the one
 * reader the amendment is protecting is precisely the one who cannot operate the surface and needs to be told
 * that before they try. So the words moved into a paragraph the panel renders — the same shape the panel already
 * uses to say a drawn mark is not a cryptographic signature — and the canvas points at it with
 * `aria-describedby`.
 *
 * Asserted here: the description resolves to that paragraph, and the paragraph carries the panel's own
 * note class rather than being a stray element; and the `title` is gone, because leaving both would have a
 * screen reader say the sentence twice, which is how a disclosure becomes noise.
 *
 * Measured on 2026-10-05 by putting the `title` back (`.spike/counterfactual-226.mjs`, restored
 * byte-for-byte, the unmutated run 7 passed / 0 failed): **2 failed** —
 * `the pad carries no description: expected null to be truthy`, and
 * `expected 'Drawing needs a mouse, a pen or a fin…' to be null`.
 */
import { act, cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { FeaturePart, FeatureRunners, useFeatureStore } from './components/FeatureHost';
import { DEFAULT_LABELS } from './lib/labels';
import { editFeature } from './edit';
import type { AnyPdfFeature, PdfViewerShell } from './lib/features';

/** A document that claims an AcroForm, which is the only thing that makes the section appear. */
function shellWithForm(): PdfViewerShell {
  return {
    doc: {
      getData: async () => new Uint8Array([0x25, 0x50, 0x44, 0x46]),
      annotationStorage: { size: 0 },
      getMetadata: async () => ({ info: { IsAcroFormPresent: true } }),
    } as unknown as PdfViewerShell['doc'],
    numPages: 1,
    pageRotations: {},
    replaceDocument: vi.fn(),
    rotatePage: vi.fn(),
    reportError: vi.fn(),
    labels: DEFAULT_LABELS,
    documentLabel: 'signing',
  } as unknown as PdfViewerShell;
}

function Panel() {
  const features: AnyPdfFeature[] = [editFeature];
  const store = useFeatureStore(shellWithForm());
  return (
    <>
      <FeatureRunners features={features} store={store} />
      {features.map((feature) => (
        <FeaturePart key={feature.id} feature={feature} store={store}>
          {feature.panel ? <feature.panel.render /> : null}
        </FeaturePart>
      ))}
    </>
  );
}

afterEach(cleanup);

/** One flush, so the metadata answer has arrived and the section has rendered. */
const settle = async () => {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 20));
  });
};

describe('the signing pad states its exception where it can be heard (FR-47)', () => {
  it('points from the pad to a paragraph of the panel', async () => {
    const { container } = render(<Panel />);
    await settle();
    const pad = container.querySelector<HTMLCanvasElement>('.pjsr-sign-pad');
    expect(pad, 'the pad did not render, so there is nothing to describe').toBeTruthy();
    const describedBy = pad!.getAttribute('aria-describedby');
    expect(describedBy, 'the pad carries no description').toBeTruthy();
    const note = document.getElementById(describedBy!);
    expect(note?.textContent).toBe(DEFAULT_LABELS.signatureNeedsPointer);
    // In the tree, visible, and styled as the panel's other sentence — not a tooltip and not `display: none`.
    expect(note?.tagName).toBe('P');
    expect(note?.className).toContain('pjsr-sign-note');
  });

  it('does not also hang the sentence off the mouse', async () => {
    const { container } = render(<Panel />);
    await settle();
    const pad = container.querySelector<HTMLCanvasElement>('.pjsr-sign-pad')!;
    // Two routes to one sentence means an AT reads it twice. The visible paragraph is the route that reaches
    // every input, so the hover-only one goes.
    expect(pad.getAttribute('title')).toBeNull();
  });
});
