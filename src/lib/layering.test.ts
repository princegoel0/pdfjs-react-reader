/*
 * §3.1: "a layer may import downward and never upward", as the four sentences the PRD says a check can decide.
 *
 * Two of the four were already checks. "The shell imports no feature" is `feature-boundary.test.ts` (FR-21),
 * and "every documented entry point still imports safely where there is no DOM at all" is `ssr.test.ts`
 * (FR-46). The other two — *the core engine glue imports no React at runtime* and *a headless hook renders
 * nothing and touches no DOM at module scope* — lived in nobody's failure, and §3.1 was cited once in the
 * whole tree, in a comment. Both have held by arrangement, which is the state `dependency-boundary.test.ts`
 * describes for the writer peer: a rule that survives until the day a reasonable-looking edit breaks it. For
 * these two the edit is easy to imagine and easy to miss — a `useState` in a source-normalisation helper
 * because it wanted a cache, or a `document.baseURI` read at the top of a hook module because it looked like
 * a constant rather than like a DOM access.
 *
 * The scanner is local rather than shared, as `feature-boundary.test.ts`'s is. A shared helper would have to
 * live under `src/lib/`, which is the layer this file asserts about, and a test-only module sitting in the
 * core glue is the first thing a reader of that assertion would ask about.
 *
 * What is deliberately not claimed: that the glue is free of React *types*. `src/lib/features.ts` imports
 * `ComponentType` to describe a feature's runner, and a type import costs no bytes and installs no peer, so
 * the runtime ban and the type allowance are asserted as two separate facts rather than one blurred rule.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';

const repo = join(dirname(fileURLToPath(import.meta.url)), '../..');
const read = (rel: string): string => readFileSync(join(repo, rel), 'utf8');

const SOURCE_EXTENSIONS = ['.ts', '.tsx'];
const isTestFile = (file: string): boolean => /\.test\.[cm]?[tj]sx?$/.test(file);

/** Repo-relative and slash-separated, so an edge reads back as a path a human recognises on any platform. */
const normalize = (path: string): string => path.split(/[\\/]+/).join('/');

/** Every non-test source module under a directory. */
function modules(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(join(repo, dir), { withFileTypes: true })) {
    const path = normalize(`${dir}/${entry.name}`);
    if (entry.isDirectory()) modules(path, out);
    else if (SOURCE_EXTENSIONS.some((extension) => entry.name.endsWith(extension)) && !isTestFile(path)) {
      out.push(path);
    }
  }
  return out;
}

/** Comments removed, because these sources reason in prose and a sentence about an import is not an edge. */
function withoutComments(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:\\])\/\/[^\n]*/g, '$1');
}

/** The specifiers a module body imports at runtime: no type-only forms, dynamic imports included. */
function valueImports(text: string): string[] {
  const code = withoutComments(text)
    .split('\n')
    .filter((line) => !/^\s*(import|export)\s+type\b/.test(line))
    .join('\n');
  const specifiers: string[] = [];
  for (const pattern of [
    /from\s+['"]([^'"]+)['"]/g,
    /import\s*\(\s*['"]([^'"]+)\s*['"]\s*\)/g,
    /^import\s+['"]([^'"]+)['"]/gm,
  ]) {
    for (const match of code.matchAll(pattern)) specifiers.push(match[1]!);
  }
  return specifiers;
}

/** Every specifier a module names, type-only forms included — the set the runtime ban is measured against. */
function allImports(text: string): string[] {
  const specifiers: string[] = [];
  for (const pattern of [/from\s+['"]([^'"]+)['"]/g, /^import\s+['"]([^'"]+)['"]/gm]) {
    for (const match of text.matchAll(pattern)) specifiers.push(match[1]!);
  }
  return specifiers;
}

/** Resolve a relative specifier the way the build does; a bare specifier is not a module in this tree. */
function resolveSpecifier(from: string, specifier: string): string | null {
  if (!specifier.startsWith('.')) return null;
  const base = resolve(dirname(join(repo, from)), specifier);
  const found = [
    ...SOURCE_EXTENSIONS.map((extension) => `${base}${extension}`),
    ...SOURCE_EXTENSIONS.map((extension) => join(base, `index${extension}`)),
  ].find((candidate) => existsSync(candidate));
  return found ? normalize(relative(repo, found)) : null;
}

/** The layer a module belongs to, which for this tree is the directory under `src/` it sits in. */
const layerOf = (file: string): string => normalize(file).split('/')[1] ?? '';

const GLUE = 'src/lib';
const HOOKS = 'src/headless';

const glue = modules(GLUE);
const hooks = modules(HOOKS);
const components = modules('src/components');

/** A DOM global read at module scope, which is the access §3.1 bans in a hook. Indented uses are invocations. */
const DOM_GLOBAL = /\b(document|window|localStorage|sessionStorage|matchMedia)\s*[.([]/;

/**
 * Lines of a module that sit at column zero and reach for a DOM global.
 *
 * `navigator` is not on the list for the reason `ssr.test.ts` gives: Node ships one since v21, so its absence
 * would prove nothing and its presence would fail a file that never touched a browser.
 */
function moduleScopeDomAccess(file: string): string[] {
  return withoutComments(read(file))
    .split('\n')
    .map((line, index) => ({ line, number: index + 1 }))
    .filter(({ line }) => /^\S/.test(line) && DOM_GLOBAL.test(line))
    .map(({ line, number }) => `${file}:${number}`);
}

describe('§3.1: the core engine glue imports no React at runtime', () => {
  it('runs where there is no DOM, which is the premise the hook cases below depend on', () => {
    // A leaked jsdom global would make "importing a hook does not throw" true for the wrong reason, so the
    // premise is a case of its own rather than a comment. `typeof` answers with a string, so these compare
    // strings; `toBeUndefined()` would pass only if `typeof` returned the value itself.
    for (const global of ['document', 'window', 'HTMLCanvasElement']) {
      expect(typeof (globalThis as Record<string, unknown>)[global], global).toBe('undefined');
    }
  });

  it('finds no glue module holding a React value import', () => {
    const holders = glue.filter((file) =>
      valueImports(read(file)).some((specifier) => /^react(-dom)?$/.test(specifier)),
    );
    expect(holders, 'the glue renders nothing, so a React value import here is a layer crossing upward').toEqual([]);
    expect(glue.length, 'and the scan really walked the layer').toBeGreaterThan(30);
  });

  it('classifies the contract module’s React import as the type-only import it is', () => {
    // The allowance §3.1 leaves, asserted rather than assumed: `src/lib/features.ts` describes a feature's
    // runner, so it names `ComponentType`. If this ever became a value import the case above would catch it,
    // and if the type import were deleted this case would say the distinction it exists to prove has gone.
    const contract = `${GLUE}/features.ts`;
    expect(existsSync(join(repo, contract)), `${contract} is still the feature contract module`).toBe(true);
    expect(allImports(read(contract)), 'the contract module still names React as a type').toContain('react');
    expect(valueImports(read(contract)), 'and still does not import it at runtime').not.toContain('react');
  });

  it('sees React value imports where they belong, so the empty list above is a measurement', () => {
    // The scan's own health. A regex that matched nothing would pass the ban vacuously, which is the failure
    // `dependency-boundary.test.ts` guards against by asserting the opposite direction too.
    const rendering = components.filter((file) =>
      valueImports(read(file)).some((specifier) => /^react(-dom)?$/.test(specifier)),
    );
    expect(rendering.length, 'primitives and shell parts do import React, and the scan has to find that').toBeGreaterThan(10);
  });
});

describe('§3.1: the glue imports downward and never upward', () => {
  it('resolves every relative edge inside its own layer', () => {
    const crossing: string[] = [];
    for (const file of glue) {
      for (const specifier of valueImports(read(file))) {
        const resolved = resolveSpecifier(file, specifier);
        if (resolved && layerOf(resolved) !== 'lib') crossing.push(`${file} -> ${resolved}`);
      }
    }
    expect(crossing, 'the glue is the bottom layer: nothing under src/lib may reach a hook, a primitive or a tier').toEqual([]);
  });

  it('imports no bare specifier the manifest does not declare', () => {
    const pkg = JSON.parse(read('package.json')) as {
      dependencies?: Record<string, string>;
      peerDependencies?: Record<string, string>;
    };
    const declared = new Set([
      ...Object.keys(pkg.dependencies ?? {}),
      ...Object.keys(pkg.peerDependencies ?? {}),
      'react',
      'react-dom',
    ]);
    const used = new Set<string>();
    for (const file of glue) {
      for (const specifier of valueImports(read(file))) {
        if (specifier.startsWith('.') || specifier.startsWith('node:')) continue;
        used.add(specifier.startsWith('@') ? specifier.split('/').slice(0, 2).join('/') : specifier.split('/')[0]!);
      }
    }
    expect([...used].filter((name) => !declared.has(name)), 'an undeclared runtime import reaches a consumer').toEqual([]);
    expect(used.has('pdfjs-dist'), 'the glue does hold the engine, so this case is not comparing two empties').toBe(true);
  });

  it('finds the downward edges the same walk is looking for', () => {
    // Without this, "no crossing" could mean the walk resolved nothing at all — the exact blind spot the
    // Windows separator bug produced in `dependency-boundary.test.ts`, where every edge came back unmatched.
    const hookEdges = hooks.flatMap((file) =>
      valueImports(read(file))
        .map((specifier) => resolveSpecifier(file, specifier))
        .filter((resolved): resolved is string => resolved !== null && layerOf(resolved) === 'lib'),
    );
    const componentEdges = components.flatMap((file) =>
      valueImports(read(file))
        .map((specifier) => resolveSpecifier(file, specifier))
        .filter((resolved): resolved is string => resolved !== null && layerOf(resolved) === 'lib'),
    );
    expect(hookEdges.length, 'hooks import the glue').toBeGreaterThan(20);
    expect(componentEdges.length, 'primitives and shell parts import the glue').toBeGreaterThan(20);
  });
});

describe('§3.1: a headless hook renders nothing and touches no DOM at module scope', () => {
  it('has no hook module that could render', () => {
    // A `.tsx` under src/headless is a hook that returned markup, which is the primitives layer's job; the
    // tests are `.tsx` because they mount, and `modules()` already excludes them.
    expect(hooks.filter((file) => file.endsWith('.tsx')), 'a headless hook renders nothing').toEqual([]);
    expect(hooks.length, 'and there are hooks to make that statement about').toBeGreaterThan(8);
    const reaching = hooks.filter((file) =>
      valueImports(read(file))
        .map((specifier) => resolveSpecifier(file, specifier))
        .some((resolved) => resolved !== null && ['components', 'features'].includes(layerOf(resolved))),
    );
    expect(reaching, 'a hook that imports a primitive has become a primitive').toEqual([]);
  });

  it('reads no DOM global at module scope', () => {
    const accesses = hooks.flatMap(moduleScopeDomAccess);
    expect(accesses, 'a module-scope DOM read throws on a server and is a layer crossing on a client').toEqual([]);
  });

  it('sees the DOM reads that happen when a hook is invoked, so the case above is not matching nothing', () => {
    // §3.1's named exception, measured instead of quoted: printing reaches the live document, so one hook does
    // hold `document` and `window` references — inside function bodies, which is what the column-zero rule above
    // distinguishes them by. Pinned to that one module rather than to a count, because the interesting failure
    // is a *second* hook growing a DOM reference, and a threshold would let the first one in quietly. A grep for
    // the word `document` reads six hooks here; four of those are prose about a PDF document, which is why the
    // pattern runs over comment-stripped source.
    const invoked = hooks.filter((file) => DOM_GLOBAL.test(withoutComments(read(file))));
    expect(invoked, 'the one browser-only operation §3.1 names is printing, and it is the only hook holding a DOM reference').toEqual([
      `${HOOKS}/usePdfPrint.ts`,
    ]);
    const indented = hooks.flatMap((file) =>
      withoutComments(read(file))
        .split('\n')
        .filter((line) => /^\s+\S/.test(line) && DOM_GLOBAL.test(line)),
    );
    expect(
      indented.length,
      'and those references are indented, which is how the rule tells them apart — a count here is the scan’s health, not a figure about the print path',
    ).toBeGreaterThan(0);
  });

  it(
    'imports every hook module with no DOM present',
    async () => {
      // The property rather than the pattern: a hook module evaluated where there is no DOM must not throw,
      // which is what FR-46's sentence means for this layer and what a regex can only approximate. One loop
      // rather than a case per module, because the modules share a cache and the failures still name themselves.
      const failures: string[] = [];
      for (const file of hooks) {
        try {
          const mod = (await import(/* @vite-ignore */ pathToFileURL(join(repo, file)).href)) as Record<
            string,
            unknown
          >;
          // An empty namespace would also "not throw", and would be a broken hook all the same.
          if (Object.keys(mod).length === 0) failures.push(`${file} exports nothing`);
        } catch (thrown) {
          failures.push(`${file}: ${(thrown as Error).message.split('\n')[0]}`);
        }
      }
      expect(failures, 'a hook that throws on import reached for the DOM at module scope').toEqual([]);
    },
    // `usePdfMerge` pulls the writer peer's own module graph in through `src/lib/pdf-merge.ts`. Alone, that
    // import measures 268 ms; as a case per module under the `node` project's parallel load it passed 5 s, so
    // the default timeout was measuring the runner's queue rather than the property.
    60_000,
  );
});

describe('§3.1: the other two sentences are checks too', () => {
  it('leaves the shell-and-feature sentence to FR-21’s guard and the entry sentence to FR-46’s', () => {
    // Stated here so this file is read as two of four sentences rather than as the whole rule, and asserted
    // so the pointer cannot rot into a file that no longer says what it is cited for.
    expect(read('src/lib/feature-boundary.test.ts'), 'FR-21’s shell-imports-no-feature guard').toMatch(
      /the shell imports no feature \(FR-21\)/,
    );
    expect(read('src/lib/ssr.test.ts'), 'FR-46’s no-DOM entry import guard').toMatch(/importing the package without a DOM/);
  });
});
