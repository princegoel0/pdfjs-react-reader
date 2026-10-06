/*
 * FR-43's engine floor, declared rather than hoped (#249).
 *
 * `pdfjs-dist@6.2.108` is the advertised peer floor and the browser matrix read this row against it: the tree
 * arrives, the link does not. The engine has no link-ownership code before 6.3.289, so the honest contract is
 * "this behaviour has a minimum", said in one place and checked in three: on the feature value a host reads, in
 * the state the Runner publishes for the engine actually loaded, and in the matrix script — which has to stop
 * asserting at the floor what it asserts above it, and is caught doing otherwise by the last case here.
 *
 * The seam is `readEngineVersion`, stubbed rather than the engine itself: mocking `pdfjs-dist` wholesale in a file
 * whose import graph already uses it is how a test ends up asserting against a module its own subject no longer
 * touches.
 */
import { cleanup, render } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { FeaturePart, FeatureRunners, useFeatureStore, usePdfFeatureState } from '../components/FeatureHost';
import { structureFeature, STRUCTURE_LINK_OWNERSHIP_MINIMUM, type StructureFeatureState } from './structure';
import type { AnyPdfFeature, PdfViewerShell } from '../lib/features';

const engine = vi.hoisted(() => ({ version: '6.3.289' }));

vi.mock('../lib/engine-version', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../lib/engine-version')>()),
  readEngineVersion: () => engine.version,
}));

let published: StructureFeatureState | null = null;

function Probe() {
  published = usePdfFeatureState<StructureFeatureState>();
  return null;
}

/** An untagged document: the feature publishes its state and fetches nothing, so this tests the wiring only. */
function Harness() {
  const shell = {
    doc: { getMarkInfo: async () => new Map([['Marked', false]]) },
    reportError: vi.fn(),
  } as unknown as PdfViewerShell;
  const features: AnyPdfFeature[] = [structureFeature];
  const store = useFeatureStore(shell);
  return (
    <>
      <FeatureRunners features={features} store={store} />
      <FeaturePart feature={structureFeature} store={store}>
        <Probe />
      </FeaturePart>
    </>
  );
}

function mount() {
  render(<Harness />);
}

afterEach(() => {
  cleanup();
  published = null;
  engine.version = '6.3.289';
});

describe('the structure feature declares its engine floor (FR-43, #249)', () => {
  it('says the minimum on the feature value, with what happens below it', () => {
    const requirement = structureFeature.engineRequirements?.find((r) => r.behaviour.includes('link'));
    expect(requirement, 'the link-ownership behaviour declares no engine minimum').toBeTruthy();
    expect(requirement?.minimum).toBe('6.3.289');
    // The degraded case is named because it is not merely "absent": the browser falls back to the destination,
    // which a reader hears as a URL — a different answer from a link that is not there at all.
    expect(requirement?.below).toMatch(/destination|URL/i);
  });

  it('publishes false for the release the contract opens with', () => {
    engine.version = '6.2.108';
    mount();
    expect(published?.linkOwnershipAvailable, 'the state promised ownership at the floor').toBe(false);
  });

  it('publishes true from the release that has the code', () => {
    engine.version = STRUCTURE_LINK_OWNERSHIP_MINIMUM;
    mount();
    expect(published?.linkOwnershipAvailable).toBe(true);
  });

  it('keeps the browser matrix naming the same boundary the feature does', () => {
    const matrix = readFileSync('scripts/browser-matrix.mjs', 'utf8');
    expect(
      matrix.includes(`'${STRUCTURE_LINK_OWNERSHIP_MINIMUM}'`),
      `scripts/browser-matrix.mjs never names ${STRUCTURE_LINK_OWNERSHIP_MINIMUM}, so the row that reads the link ` +
        'at the floor is deciding the boundary for itself and the two can drift without anyone noticing',
    ).toBe(true);
  });
});
