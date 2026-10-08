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

  /*
   * FR-43's widget half, measured rather than inherited (#277). The row that reads a widget inside marked
   * content asserts two things the releases disagree about — where the `/Alt` lands, and in what id namespace
   * the tree claims the widget — so the guard here is that the row *branches* rather than assuming one engine's
   * DOM is every engine's. It is a source read for the same reason #249's is: the behaviour needs a browser,
   * and the thing that goes wrong is a row quietly asserting less than its clause.
   */
  it('keeps the widget row branching on the measured boundary instead of assuming one release’s DOM', () => {
    const matrix = readFileSync('scripts/browser-matrix.mjs', 'utf8');
    const commented = matrix.indexOf("FR-43's noun is a widget");
    expect(commented, 'the widget row no longer says which clause it is for').toBeGreaterThan(-1);
    const row = matrix.slice(commented);
    expect(row.length, 'the widget row is missing from the matrix').toBeGreaterThan(500);
    expect(row).toContain("name: 'widget-named-by-its-owning-node'");
    // The same number as the link boundary, by measurement and not by borrowing: if a future release moves one
    // path without the other, this constant has to move deliberately and the case above keeps the link honest.
    expect(row).toMatch(/const WIDGET_ALT_MINIMUM = '6\.3\.289';/);
    expect(row).toMatch(/releaseAtLeast\(engineVersion, WIDGET_ALT_MINIMUM\)/);
    // Both branches have to say something: an `if` with no else is how a row ends up asserting nothing below
    // the boundary while still reporting ok.
    expect(row).toMatch(/if \(altOnWidget && !arrivesOnWidget\)/);
    expect(row).toMatch(/if \(!altOnWidget && !arrivesOnWidget && !arrivesOnOwningNode\)/);
    // And the claim the clause actually makes survives on both paths.
    expect(row).toMatch(/if \(!named\.label\)/);
    expect(row, 'the row claims the tree owns the widget id in one spelling only (#277)').toMatch(
      /pdfjs_internal_id_/,
    );
  });
});
