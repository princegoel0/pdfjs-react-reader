/*
 * FR-45: WCAG 2.2 AA — the text layer's contrast is still an open measurement.
 *
 * `a11y/browser.json` records six axe-core audits across Chromium, Firefox and WebKit. In every one, 19 nodes
 * sit under `color-contrast` as `incomplete` rather than `pass` or `violation`, all of them `.pjsr-text-layer`
 * spans, with axe's own reason — the element's background cannot be determined because it is overlapped by
 * another element. The text layer draws transparent glyphs over the canvas it transcribes, so it has no
 * background of its own and no DOM audit can decide its ratio.
 *
 * What this file does:
 *  1. Holds the browser record to its own reading — the incomplete set must stay exactly the text-layer spans,
 *     and a real `color-contrast` violation in any engine reddens it.
 *  2. Pins the WCAG 2.2 SC 1.4.3 luminance and ratio formula that the eventual measurement will use.
 *
 * What it does not do: read a pixel. `getImageData`, `getContext` and a browser appear nowhere here, so
 * nothing in this file can notice the rendered page getting harder to read. The measurement belongs in
 * `scripts/a11y-browser-record.mjs`, sampling the painted backing store under each text-layer box per engine.
 */
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

export type RGB = [number, number, number];

/**
 * Calculates WCAG 2.2 relative luminance from 8-bit sRGB color channels.
 * Formula: https://www.w3.org/TR/WCAG22/#dfn-relative-luminance
 */
export function relativeLuminance([r, g, b]: RGB): number {
  const toLinear = (c: number): number => {
    const s = c / 255;
    return s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * toLinear(r) + 0.7152 * toLinear(g) + 0.0722 * toLinear(b);
}

/**
 * Calculates WCAG 2.2 contrast ratio between two colors: (L1 + 0.05) / (L2 + 0.05).
 * Formula: https://www.w3.org/TR/WCAG22/#dfn-contrast-ratio
 */
export function contrastRatio(c1: RGB, c2: RGB): number {
  const l1 = relativeLuminance(c1);
  const l2 = relativeLuminance(c2);
  const lighter = Math.max(l1, l2);
  const darker = Math.min(l1, l2);
  return (lighter + 0.05) / (darker + 0.05);
}

const root = join(__dirname, '..', '..');
const BROWSER_RECORD = join(root, 'a11y', 'browser.json');

describe('FR-45: Canvas text layer contrast verification', () => {
  it('holds the browser record to its own color-contrast reading of the text layer', () => {
    expect(existsSync(BROWSER_RECORD), 'a11y/browser.json must exist').toBe(true);
    const data = JSON.parse(readFileSync(BROWSER_RECORD, 'utf8'));

    expect(data.audits).toBeDefined();
    expect(data.audits.length).toBeGreaterThanOrEqual(6);

    for (const audit of data.audits) {
      if (!audit.started) continue;
      // Zero contrast violations in the real browser audit
      const contrastViolations = (audit.violations ?? []).filter((v: { id: string }) => v.id === 'color-contrast');
      expect(contrastViolations, `${audit.engine} ${audit.state} has unexpected contrast violations`).toHaveLength(0);

      // Incomplete list must carry exactly the 19 text-layer nodes
      const contrastIncomplete = (audit.incomplete ?? []).find((i: { id: string }) => i.id === 'color-contrast');
      expect(contrastIncomplete, `${audit.engine} ${audit.state} missing color-contrast incomplete entry`).toBeDefined();
      expect(contrastIncomplete.nodes, `${audit.engine} ${audit.state} incomplete node count`).toBe(19);

      // The examples must cite .pjsr-text-layer spans
      if (contrastIncomplete.examples) {
        for (const example of contrastIncomplete.examples) {
          expect(example.target).toContain('.pjsr-text-layer');
          expect(example.why).toContain('Element\'s background color could not be determined because it is overlapped');
        }
      }
    }
  });

  it('calculates WCAG 2.2 relative luminance and contrast ratios accurately', () => {
    // Pure black vs pure white
    const white: RGB = [255, 255, 255];
    const black: RGB = [0, 0, 0];
    expect(relativeLuminance(white)).toBeCloseTo(1.0, 4);
    expect(relativeLuminance(black)).toBeCloseTo(0.0, 4);
    expect(contrastRatio(white, black)).toBeCloseTo(21.0, 1);

    // WCAG AA minimum threshold is 4.5:1 for normal text
    const threshold45: RGB = [118, 118, 118]; // standard grey on white
    expect(contrastRatio(white, threshold45)).toBeGreaterThanOrEqual(4.5);

    // Dark grey text on white canvas (typical antialiased PDF render)
    const darkGrey: RGB = [34, 34, 34];
    expect(contrastRatio(white, darkGrey)).toBeGreaterThan(10.0);
  });

  it('applies the formula to the palette the text layer is expected to render in — assumed colours, not a measurement', () => {
    const whiteCanvasBackground: RGB = [255, 255, 255];
    // Declared here, read from nowhere: `form-sample.pdf` does draw "AcroForm fixture" and "Full name:"
    // (scripts/make-form-pdf.mjs:145-146), but these three triples are an assumption about how the engine
    // rasterises them. The ratio that means anything is the one taken off the painted canvas (#299).
    const renderedGlyphColors: RGB[] = [
      [0, 0, 0],       // Primary title and field label text ("AcroForm fixture", "Full name:")
      [20, 20, 20],    // Text glyph core with subpixel rendering
      [50, 50, 50],    // Antialiased glyph boundary
    ];

    for (const glyphColor of renderedGlyphColors) {
      const ratio = contrastRatio(whiteCanvasBackground, glyphColor);
      expect(ratio, `Glyph RGB [${glyphColor.join(',')}] on white canvas`).toBeGreaterThanOrEqual(4.5);
    }
  });
});
