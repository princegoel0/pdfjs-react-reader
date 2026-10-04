/**
 * FR-56: "Feature modules cannot import upward into shell consumers or bypass the public
 * feature boundary", and FR-21's build-time half — "the core viewer must not statically
 * import any optional feature".
 *
 * `scripts/check-size.mjs` already proves the bundle-level promise: a feature marker must be
 * absent from the core bundle under esbuild *and* Rollup. That proof is downstream and
 * indirect — it tells you a leak happened, in a job that needs `npm run build`, without
 * naming the import that caused it. What this file adds is the same rule at the source, in
 * the test project that always runs: four edges, each of which a future refactor can cross
 * by accident while every behaviour test still passes.
 *
 *  - shell → tier: a component or hook that names a feature drags it into every consumer's
 *    bundle, which is the regression `0.4` exists to have fixed;
 *  - tier → shell: a feature that reaches for the viewer shell has no way to be used by the
 *    headless half of the package, and it inverts the layering §3.1 states as "downward and
 *    never upward";
 *  - tier → tier: one feature importing another's module bypasses the seam that exists for
 *    exactly this — `usePdfFeaturePeer(id)` plus `src/lib/feature-ids.ts`, a *string* import
 *    that cannot pull the peer's code into a bundle that did not ask for it;
 *  - contract → anything: `src/lib/features.ts` is the type the shell and every tier share,
 *    and it stays loadable by both only while it imports neither side.
 *
 * Type-only imports are exempt where the runtime rule is the one that matters, because they
 * are erased before the bundle exists; the exemption is stated per rule rather than applied
 * blanket, and the positive control at the bottom proves the scanner sees an import when one
 * is really there.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

const root = process.cwd();

/** Repo-relative, forward-slashed path of every non-test module under `src/`. */
function sourceModules(): string[] {
  return readdirSync(join(root, 'src'), { recursive: true })
    .map((p) => String(p).split('\\').join('/'))
    .filter((p) => /\.tsx?$/.test(p))
    // A test is allowed to import the thing it checks; that is not a dependency edge.
    .filter((p) => !/\.test\.tsx?$/.test(p))
    .map((p) => `src/${p}`)
    .sort();
}

/** `../lib/features` from `src/components/FeatureHost.tsx` → `src/lib/features`. */
function resolved(fromModule: string, specifier: string): string | null {
  if (!specifier.startsWith('.')) return null;
  const absolute = resolve(root, dirname(join(root, fromModule)), specifier);
  const posix = absolute.split('\\').join('/');
  const base = root.split('\\').join('/').replace(/\/$/, '');
  return posix.startsWith(`${base}/`) ? posix.slice(base.length + 1) : null;
}

interface ImportEdge {
  specifier: string;
  /** False for `import type`/`export type`, which leaves nothing in the bundle. */
  runtime: boolean;
}

/**
 * Every static module specifier in a file, read off the AST rather than off a regex.
 *
 * Parsed, because this project's own source is the text being scanned and it is full of
 * doc comments that quote specifiers: a line-oriented match would read "an import from
 * `src/features/`" in a header as a dependency the file does not have. Dynamic
 * `import()` is deliberately absent — these rules are about what a bundler must include,
 * and a deferred request is the host's, not the module's.
 */
function importsOf(file: string): ImportEdge[] {
  const source = readFileSync(join(root, file), 'utf8');
  const parsed = ts.createSourceFile(file, source, ts.ScriptTarget.ES2022, true, ts.ScriptKind.TSX);
  const edges: ImportEdge[] = [];
  for (const statement of parsed.statements) {
    if (ts.isImportDeclaration(statement) || ts.isExportDeclaration(statement)) {
      const specifier = statement.moduleSpecifier;
      // `export { inversePlan } from './lib/page-plan'` always has one; a re-export of a
      // local binding in the same file does not, and names no module to forbid.
      if (!specifier || !ts.isStringLiteral(specifier)) continue;
      const typeOnly = ts.isImportDeclaration(statement)
        ? Boolean(statement.importClause?.isTypeOnly)
        : statement.isTypeOnly;
      edges.push({ specifier: specifier.text, runtime: !typeOnly });
    }
  }
  return edges;
}

const modules = sourceModules();
const edges = new Map<string, ImportEdge[]>(modules.map((file) => [file, importsOf(file)]));

/** The directory half of a module path, as the rule below names layers. */
const layerOf = (file: string) => file.split('/')[1] ?? '';

const SHELL_LAYERS = ['lib', 'headless', 'components'];
/** The shell-part and viewer-layer modules a tier must not reach for at runtime. */
const UPWARD_TARGETS = [
  'src/components/PdfViewer',
  'src/components/ViewerController',
  'src/components/ViewerParts',
  'src/components/ViewerLayout',
  'src/components/ViewerContext',
];

/** Every tier module: the `src/features/` files and the tiers that declare a feature value. */
const TIER_MODULES = modules.filter(
  (file) => layerOf(file) === 'features' || file === 'src/edit.tsx' || file === 'src/merge.ts',
);

describe('the shell imports no feature (FR-21)', () => {
  it('has no shell module naming a tier', () => {
    const leaks: string[] = [];
    for (const [file, list] of edges) {
      if (!SHELL_LAYERS.includes(layerOf(file))) continue;
      for (const edge of list) {
        const target = resolved(file, edge.specifier);
        // `src/lib/features.ts` is the contract, not a tier; only `src/features/*` is code.
        if (target?.startsWith('src/features/')) leaks.push(`${file} → ${edge.specifier}`);
      }
    }
    expect(leaks).toEqual([]);
  });

  it('keeps the contract module free of the code it describes', () => {
    // Both halves of the seam: `features.ts` is what a tier and the shell can *both* import,
    // and `FeatureHost.tsx` is the machinery that hosts a tier it cannot know the name of.
    for (const file of ['src/lib/features.ts', 'src/components/FeatureHost.tsx']) {
      const targets = (edges.get(file) ?? [])
        .map((edge) => resolved(file, edge.specifier))
        .filter((target): target is string => Boolean(target?.startsWith('src/features/')));
      expect(targets, file).toEqual([]);
    }
    const contract = (edges.get('src/lib/features.ts') ?? []).map((edge) =>
      resolved('src/lib/features.ts', edge.specifier),
    );
    expect(contract.filter((target) => target?.startsWith('src/components/'))).toEqual([]);
  });
});

describe('a feature cannot import upward (FR-56)', () => {
  it('never reaches for the viewer shell or the shell parts at runtime', () => {
    const violations: string[] = [];
    for (const file of TIER_MODULES) {
      for (const edge of edges.get(file) ?? []) {
        if (!edge.runtime) continue;
        const target = resolved(file, edge.specifier);
        if (target && UPWARD_TARGETS.includes(target)) violations.push(`${file} → ${edge.specifier}`);
      }
    }
    expect(violations).toEqual([]);
  });

  it('lists the modules the rule is about, so a renamed shell part cannot empty it', () => {
    // A guard whose forbidden set has drifted out of existence would pass forever. Each of
    // these files has to be present for the rule above to mean anything.
    for (const target of UPWARD_TARGETS) {
      expect(modules.filter((file) => file.replace(/\.tsx?$/, '') === target), target).toHaveLength(1);
    }
  });

  it('reads a peer through its published id rather than its module', () => {
    const violations: string[] = [];
    for (const file of TIER_MODULES) {
      for (const edge of edges.get(file) ?? []) {
        if (!edge.runtime) continue;
        const target = resolved(file, edge.specifier);
        if (!target?.startsWith('src/features/')) continue;
        violations.push(`${file} → ${edge.specifier}`);
      }
    }
    expect(violations).toEqual([]);
  });

  it('keeps the id module honest, since naming a feature by string is only safe by construction', () => {
    // This is the module both the shell and a tier may name a feature with, so its safety is
    // structural rather than a promise: no module edge at all, and exports that are string
    // literals rather than something a bundler has to include. It lives in `lib/` for the same
    // reason the contract does — a shell part that reads a tier's publication must not import
    // the tier's code, and `src/features/` is off limits to the shell by the first rule above.
    expect(edges.get('src/lib/feature-ids.ts')).toEqual([]);
    const text = readFileSync(join(root, 'src/lib/feature-ids.ts'), 'utf8');
    const exported = [...text.matchAll(/^export const (\w+) = (.*);$/gm)];
    expect(exported.length).toBeGreaterThanOrEqual(9);
    for (const [, name, value] of exported) {
      expect(name).toMatch(/_FEATURE_ID$/);
      expect(value, name).toMatch(/^'[a-z]+'$/);
    }
  });
});

describe('the scan measures something (FR-56)', () => {
  it('finds the cross-layer imports that are allowed, so an empty violation list is not a blind spot', () => {
    // The positive control. Without it every assertion above could be passing because the
    // scanner never reads a specifier at all.
    expect(resolved('src/index.ts', './features/print')).toBe('src/features/print');
    expect(modules.length).toBeGreaterThan(50);
    const tierToContract = (edges.get('src/features/annotate.tsx') ?? []).some(
      (edge) => resolved('src/features/annotate.tsx', edge.specifier) === 'src/lib/features',
    );
    expect(tierToContract).toBe(true);
    // And a type-only cross-tier import really is present and really is exempt.
    const downloadEdges = edges.get('src/features/download.tsx') ?? [];
    const peerType = downloadEdges.find(
      (edge) => resolved('src/features/download.tsx', edge.specifier) === 'src/features/annotate',
    );
    expect(peerType).toBeDefined();
    expect(peerType!.runtime).toBe(false);
  });

  it('classifies a type-only import and a value import of the same module apart', () => {
    // The exemption the rules above rely on, pinned against real source rather than a
    // fixture: `FeatureHost` both *calls* the contract and only *names* its types.
    const host = edges.get('src/components/FeatureHost.tsx') ?? [];
    const contract = 'src/lib/features';
    const runtime = host.filter((edge) => resolved('src/components/FeatureHost.tsx', edge.specifier) === contract);
    expect(runtime.some((edge) => edge.runtime), 'a runtime import of the contract').toBe(true);
    expect(runtime.some((edge) => !edge.runtime), 'a type-only import of the contract').toBe(true);
  });

  it('reads a doc comment that quotes a specifier as prose, not as a dependency', () => {
    /*
     * The reason this file parses instead of matching lines. `src/lib/features.ts` spends a
     * paragraph promising it has "no import from `src/features/`", and a regex would find
     * that string and report the promise as a violation — or, inverted, a rule could be
     * satisfied by a file whose only mention of a tier is in its own header.
     */
    const text = readFileSync(join(root, 'src/lib/features.ts'), 'utf8');
    expect(text).toContain('src/features/');
    expect(edges.get('src/lib/features.ts')).toEqual(
      expect.arrayContaining([{ specifier: './errors', runtime: true }]),
    );
  });
});
