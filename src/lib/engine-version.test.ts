/*
 * The engine-version seam (FR-43, #249).
 *
 * Exists because the engine contract is a range and one release inside it — the advertised floor — cannot do the
 * thing the structure tier's link half asks. A comparison that gets that wrong in the friendly direction would
 * report a capability the loaded engine does not have, and the reader would be handed a link announced by its URL
 * while every test stayed green, so the boundary is asserted on both sides of itself.
 */
import { describe, expect, it } from 'vitest';
import { version as loadedVersion } from 'pdfjs-dist';
import { engineAtLeast, readEngineVersion } from './engine-version';

describe('engine version comparisons (FR-43, #249)', () => {
  it('reads a real release off the engine', () => {
    expect(readEngineVersion()).toBe(loadedVersion);
  });

  it('answers nothing when the engine will not say', () => {
    // A stub, a build without the export, or a placeholder string all reach `null`, and `null` must never read as
    // "capable": the conservative answer is the one that keeps a false promise out of the accessibility tree.
    expect(engineAtLeast(null, '6.3.289')).toBe(false);
    expect(engineAtLeast('', '6.3.289')).toBe(false);
    expect(engineAtLeast('nightly', '6.3.289')).toBe(false);
  });

  it('puts the measured boundary where the measurement put it', () => {
    expect(engineAtLeast('6.2.108', '6.3.289')).toBe(false);
    expect(engineAtLeast('6.3.289', '6.3.289')).toBe(true);
    expect(engineAtLeast('6.4.299', '6.3.289')).toBe(true);
  });

  it('compares releases as numbers, not as strings', () => {
    // '6.10.0' < '6.2.0' lexically and above it in fact; the same trap sits one segment from the boundary above.
    expect(engineAtLeast('6.10.0', '6.2.0')).toBe(true);
    expect(engineAtLeast('6.9.0', '6.10.0')).toBe(false);
    expect(engineAtLeast('7.0.0', '6.99.99')).toBe(true);
    expect(engineAtLeast('6.3', '6.3.289')).toBe(false);
    expect(engineAtLeast('6.3.289-nightly.1', '6.3.289')).toBe(true);
  });
});
