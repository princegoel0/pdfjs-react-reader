/*
 * FR-18 is one row with two halves, and only the second can rot quietly: render the annotations a document
 * already carries, and withdraw the freehand pen the core shipped at `0.1.2`. The withdrawal is written as a
 * list of names — `usePdfInk`, `InkLayer` and the stroke helpers leave `.` and `/headless` — so this file
 * reads that list out of the source the package builds from and asserts each name is gone.
 *
 * Why the source rather than `dist/`: a name can be missing from a built artifact for reasons that have
 * nothing to do with the export map (a stale build, a tree-shaken barrel), while `src/index.ts` and
 * `src/headless.ts` are where a re-export either is or is not. The built surface is checked its own way by
 * `npm run check:maturity`, which is also where the removal ledger is enforced.
 *
 * Every scan here has a positive control in the same read of the same file, because "no violations" is also
 * what a scanner that never opened anything produces.
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const read = (path: string) => readFileSync(join(process.cwd(), path), 'utf8');

/**
 * FR-18's named withdrawal, expanded to everything that existed only to serve it. The five rows of `0.1.2`
 * on npm are the base: the hook, the overlay component, the stroke helpers and the two option lists the
 * toolbar rendered from.
 */
const WITHDRAWN = [
  'usePdfInk',
  'UsePdfInkOptions',
  'UsePdfInkResult',
  'InkLayer',
  'InkLayerProps',
  'InkStroke',
  'InkSettings',
  'createStrokeId',
  'simplifyPoints',
  'strokePathD',
  'pointsBounds',
  'strokeBounds',
  'drawInkStrokes',
  'INK_COLORS',
  'INK_WIDTHS',
];

/** The catalog keys whose only user was the core pen; `undoLabel` and `clearLabel` outlived it. */
const DROPPED_LABELS = [
  'drawOnDocument',
  'exitDrawingMode',
  'drawingTools',
  'drawLabel',
  'drawWithColor',
  'penWidth',
  'undoStroke',
  'clearAllDrawings',
  'penThin',
  'penMedium',
  'penThick',
];

const CATALOGS = ['src/lib/labels.ts', 'src/locales/de.ts', 'src/locales/es.ts', 'src/locales/fr.ts'];

/** Every TypeScript/TSX module under `src/`, minus the test files that name what they assert about. */
function sourceModules(dir = 'src'): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(join(process.cwd(), dir), { withFileTypes: true })) {
    const path = `${dir}/${entry.name}`;
    if (entry.isDirectory()) out.push(...sourceModules(path));
    else if (/\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name)) out.push(path);
  }
  return out;
}

const MODULES = sourceModules();

describe('FR-18: the withdrawal left the two published entries', () => {
  it('has a list to check, so an empty scan cannot pass', () => {
    expect(WITHDRAWN).toHaveLength(15);
    expect(MODULES.length).toBeGreaterThan(50);
  });

  it('names nothing withdrawn in either barrel', () => {
    for (const barrel of ['src/index.ts', 'src/headless.ts']) {
      const text = read(barrel);
      // The control: the file really is the barrel, so a wrong path reads as a pass rather than an error.
      expect(text, barrel).toContain(barrel === 'src/index.ts' ? 'PdfViewer' : 'usePdfDocument');
      for (const name of WITHDRAWN) {
        expect(text, `${barrel} still mentions ${name}`).not.toContain(name);
      }
    }
  });

  it('has deleted the modules the barrels used to re-export', () => {
    // Deleting the export line and leaving the module would still let an application reach it by path, and
    // would leave the register citing a test file for a surface nothing publishes.
    for (const path of [
      'src/lib/ink.ts',
      'src/lib/ink.test.ts',
      'src/components/InkLayer.tsx',
      'src/headless/usePdfInk.ts',
    ]) {
      expect(existsSync(join(process.cwd(), path)), `${path} is still on disk`).toBe(false);
    }
  });

  it('keeps the two point types, which moved rather than went', () => {
    /*
     * `PdfPoint` and `ViewportPoint` describe a place on a page, and the signing and page-edit paths need
     * both, so they were re-homed in `layout` instead of being withdrawn with their only former owner. A
     * host that imported them from the root sees the same names from the same entry.
     */
    for (const barrel of ['src/index.ts', 'src/headless.ts']) {
      const text = read(barrel);
      expect(text, barrel).toContain('PdfPoint');
      expect(text, barrel).toContain('ViewportPoint');
    }
    expect(read('src/lib/layout.ts')).toContain('ViewportPoint');
  });

  it('leaves the annotate feature as the only ink the package offers', () => {
    // The requirement's whole reason: two ink paths, one of which survives a save.
    const authors = MODULES.filter((path) => read(path).includes('AnnotationEditorType.INK'));
    expect(authors).toEqual(['src/features/annotate.tsx']);
  });
});

describe('FR-18: nothing in the core draws, and FR-19 carries no transient marks', () => {
  it('renders no overlay and takes no strokes, page component included', () => {
    const text = read('src/components/PdfPage.tsx');
    expect(text).toContain('pjsr-annotation-layer');
    for (const token of ['InkLayer', 'inkStrokes', 'inkDrawing', 'inkSettings', 'onInkCommit']) {
      expect(text, `PdfPage still carries ${token}`).not.toContain(token);
    }
  });

  it('gives the toolbar no pen control and no ink panel', () => {
    const text = read('src/components/Toolbar.tsx');
    expect(text).toContain("id: 'search'");
    for (const token of ["id: 'draw'", 'drawMode', 'onDrawToggle', 'INK_COLORS', 'INK_WIDTHS', 'pjsr-ink']) {
      expect(text, `Toolbar still carries ${token}`).not.toContain(token);
    }
  });

  it('gives the controller no ink state to hand a page', () => {
    const text = read('src/components/ViewerController.tsx');
    expect(text).toContain('usePdfSearch');
    for (const token of ['usePdfInk', 'commitFor', 'strokesForPage', 'ink:']) {
      expect(text, `the controller still holds ${token}`).not.toContain(token);
    }
  });

  it('keeps ink out of the core feature contract, so a feature cannot be handed transient strokes', () => {
    const contract = read('src/lib/features.ts');
    expect(contract).toContain('annotationEditorUIManager');
    expect(contract).not.toContain('inkStrokesForPage');
  });

  it('prints persisted marks only, which is FR-19 said in one clause', () => {
    const hook = read('src/headless/usePdfPrint.ts');
    // The control that the print path is still a print path: persisted annotations ride the sheet, which is
    // the half of FR-19 the removal must not take with it.
    expect(hook).toContain('printAnnotationStorage');
    expect(hook).toContain('AnnotationMode.ENABLE_STORAGE');
    const feature = read('src/features/print.tsx');
    expect(feature).toContain('usePdfPrint');
    for (const [path, text] of [
      ['src/headless/usePdfPrint.ts', hook],
      ['src/features/print.tsx', feature],
    ]) {
      for (const token of ['InkStroke', 'inkStrokes', 'getInkStrokes', 'drawInkStrokes']) {
        expect(text, `${path} still composites ${token}`).not.toContain(token);
      }
    }
  });

  it('leaves the core stylesheet without drawing chrome, which is FR-22 said in one clause', () => {
    const core = read('src/styles/viewer.css');
    expect(core).toContain('.pjsr-annotation-layer');
    for (const token of [
      '.pjsr-ink',
      'pjsr-ink-layer',
      'pjsr-swatch',
      '.pjsr-annotation-layer--inert',
    ]) {
      expect(core, `viewer.css still styles ${token}`).not.toContain(token);
    }
    // Withdrawn from the core, and withdrawn rather than relocated: the feature that draws keeps its own rule
    // for a finger that starts a drag on an editor box. Not claimed as FR-47's one-finger-draws clause — that
    // was measured on 2026-10-05 in the browser matrix (`pen-draws-not-scrolls`), where the editor layer's
    // computed `touch-action` while a tool is armed is `auto`, so this rule is not what leaves the finger with
    // the page. It is checked here as a *relocation*: the core sheet may not style drawing chrome at all.
    expect(read('src/styles/annotate.css')).toContain('touch-action: none');
    // And no module in the package renders it either, so the rule cannot be re-added by a component that
    // still writes the class.
    const users = MODULES.filter((path) => read(path).includes('pjsr-ink'));
    expect(users).toEqual([]);
  });

  it('drops the eleven catalog keys whose only user was the pen, in every language', () => {
    for (const path of CATALOGS) {
      const text = read(path);
      // `undoLabel` and `clearLabel` stay: the edit tier's buttons are their remaining users.
      expect(text, `${path} lost a label the edit tier still renders`).toContain('undoLabel');
      expect(text, `${path} lost a label the edit tier still renders`).toContain('clearLabel');
      for (const key of DROPPED_LABELS) {
        expect(text, `${path} still carries ${key}`).not.toMatch(new RegExp(`^\\s*${key}:`, 'm'));
      }
    }
    expect(MODULES.filter((p) => p.includes('pjsr-ink') || /labels?\(.*draw/.test(read(p)))).toEqual([]);
  });
});

describe('FR-18: the removal is recorded, not merely done', () => {
  interface Ledger {
    tag: string;
    removedIn: string;
    announcedIn: string;
    supersededBy: string;
  }

  const inventory = JSON.parse(read('api-maturity.json')) as {
    states: string[];
    tags: Record<string, string>;
    removed: Record<string, Ledger>;
  };
  const changelog = read('CHANGELOG.md');

  /** The body of one `## [label]` section, or null when the heading does not exist. */
  function section(label: string): string | null {
    const start = changelog.indexOf(`## [${label}]`);
    if (start === -1) return null;
    const next = changelog.indexOf('\n## ', start + 1);
    return changelog.slice(start, next === -1 ? changelog.length : next);
  }

  it('lists every withdrawn name in the changelog that announces it', () => {
    const unreleased = section('Unreleased');
    // The control: the ledger's own claims are read from a section that exists and says something.
    expect(unreleased).not.toBeNull();
    expect(unreleased ?? '').toContain('freehand');
    for (const name of WITHDRAWN) {
      expect(unreleased ?? '', `${name} is not listed in CHANGELOG.md`).toContain(name);
    }
  });

  it('records each name with the tag it held, a major release, and its replacement', () => {
    expect(Object.keys(inventory.removed).length).toBeGreaterThanOrEqual(WITHDRAWN.length);
    for (const name of WITHDRAWN) {
      const entry = inventory.removed[name];
      expect(entry, `${name} has no removal record`).toBeTruthy();
      expect(inventory.states, `${name} was tagged ${entry?.tag}`).toContain(entry?.tag);
      // §5.5: a public name leaves in a major version. `1.0.0` is the first release without them.
      expect(entry?.removedIn, `${name} left in a non-major`).toMatch(/^\d+\.0\.0$/);
      expect(entry?.supersededBy, `${name} names no replacement`).toBe('annotateFeature');
      expect(inventory.tags[name], `${name} is both tagged and removed`).toBeUndefined();
    }
  });

  it('keeps the ledger and the published surface agreeing about what is gone', () => {
    // A name cannot be removed in the file and still exported from the package. `check:maturity` compares
    // this against `dist/`; here the barrels are the promise that the manifest is not describing a build
    // nobody ships.
    const barrels = read('src/index.ts') + read('src/headless.ts');
    for (const name of WITHDRAWN) {
      expect(barrels, `${name} is recorded as gone and is still re-exported`).not.toContain(name);
    }
    expect(Object.keys(inventory.tags).length).toBeGreaterThan(300);
  });
});
