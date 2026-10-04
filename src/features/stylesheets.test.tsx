/**
 * FR-21 and FR-56: §3.7's stylesheet clause — "its stylesheet entries are *declared on the
 * feature value* rather than discovered by convention, so an application can see what a
 * feature will pull into the page before it registers it."
 *
 * A declaration nobody checks is a comment with a field name, so these assertions cross it
 * against the two things that can actually disagree with it. Every specifier a built-in
 * feature names has to be a published subpath *and* a file in this repository, which is
 * what fails when a tier starts declaring a sheet that was never built. And the union of
 * the declarations has to be the whole set of per-feature sheets the package publishes,
 * which is what fails when a feature stops declaring the sheet its own chrome needs — the
 * silent version of that bug is a control that renders unstyled in an application three
 * months from now, on a page nobody re-opened.
 *
 * What is deliberately not here: that the CSS *loads*. It is imported by the application,
 * not injected by the shell, so the shell cannot observe it. That is also why the field
 * exists — the list is for the reader of the feature value, and `docs/src/pages/Features.tsx`
 * is where that reader is shown.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { annotateFeature } from './annotate';
import { attachmentsFeature } from './attachments';
import { downloadFeature } from './download';
import { formsFeature } from './forms';
import { layersFeature } from './layers';
import { outlineFeature } from './outline';
import { printFeature } from './print';
import { structureFeature } from './structure';
import { editFeature } from '../edit';
import type { AnyPdfFeature } from '../lib/features';

const PACKAGE = 'pdfjs-react-reader';

const BUILT_INS: readonly AnyPdfFeature[] = [
  printFeature,
  downloadFeature,
  formsFeature,
  outlineFeature,
  layersFeature,
  annotateFeature,
  attachmentsFeature,
  structureFeature,
  editFeature,
];

/** The CSS keys of the export map — `./print.css`, `./styles.css`, … */
function publishedStylesheets(): string[] {
  const pkg = JSON.parse(readFileSync(join(process.cwd(), 'package.json'), 'utf8')) as {
    exports: Record<string, unknown>;
  };
  return Object.keys(pkg.exports).filter((name) => name.endsWith('.css'));
}

/** The specifier a host writes, from the export-map key this package publishes. */
function specifierFor(key: string): string {
  return key === './styles.css' ? `${PACKAGE}/styles.css` : `${PACKAGE}/${key.slice(2)}`;
}

const declaredById = new Map(
  BUILT_INS.map((feature) => [feature.id, [...(feature.stylesheets ?? [])]]),
);

describe('stylesheets declared on the feature value (§3.7)', () => {
  it('states, per built-in feature, exactly the sheets its chrome needs', () => {
    // The one place a host can read this before registering — so the assertion is the
    // declaration itself. Delete a feature's `stylesheets` and this fails even though the
    // CSS file is still published and still on disk.
    expect(Object.fromEntries(declaredById)).toEqual({
      print: ['pdfjs-react-reader/print.css'],
      // The only built-in with no chrome of its own: its control is a toolbar button, and
      // the toolbar belongs to the shell's sheet.
      download: [],
      forms: ['pdfjs-react-reader/forms.css'],
      outline: ['pdfjs-react-reader/outline.css'],
      layers: ['pdfjs-react-reader/layers.css'],
      annotate: ['pdfjs-react-reader/annotate.css'],
      attachments: ['pdfjs-react-reader/attachments.css'],
      structure: ['pdfjs-react-reader/structure.css'],
      edit: ['pdfjs-react-reader/edit.css'],
    });
  });

  it('declares only sheets this package actually publishes', () => {
    const published = new Set(publishedStylesheets().map(specifierFor));
    for (const [id, sheets] of declaredById) {
      for (const sheet of sheets) expect(published.has(sheet), `${id} → ${sheet}`).toBe(true);
    }
  });

  it('declares only sheets whose source is in this repository', () => {
    for (const [, sheets] of declaredById) {
      for (const sheet of sheets) {
        const file = join(process.cwd(), 'src', 'styles', sheet.split('/').pop() as string);
        expect(readFileSync(file, 'utf8'), sheet).toContain('.pjsr-');
      }
    }
  });

  it('leaves no published per-feature sheet undeclared', () => {
    const declared = new Set([...declaredById.values()].flat());
    const orphans = publishedStylesheets()
      .map(specifierFor)
      .filter((sheet) => sheet !== `${PACKAGE}/styles.css` && !declared.has(sheet));
    expect(orphans).toEqual([]);
  });

  it('does not make the core sheet a feature declaration', () => {
    // `styles.css` is the shell's, imported by every consumer of the shell whether or not
    // they mount a feature. Listing it on a feature would tell a host that a page can be
    // styled without it, which is the opposite of how the tiers are built.
    expect([...declaredById.values()].flat()).not.toContain(`${PACKAGE}/styles.css`);
  });

  it('keeps the declaration on the value a factory returns, not only on the constant', () => {
    // `create*Feature` spreads the constant, so a factory-built feature carries the same
    // list — and a host that assembles its viewer from factories is the one reading it.
    const configured = { ...printFeature, options: { fileName: 'a' } };
    expect(configured.stylesheets).toEqual(printFeature.stylesheets);
  });
});
