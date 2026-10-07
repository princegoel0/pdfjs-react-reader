/*
 * FR-53's boundary, asserted instead of arranged.
 *
 * The rule is that the optional peer — the writer, `@cantoo/pdf-lib` — belongs to the entries that edit and to
 * no other door. It has held since 0.7 by *arrangement*: nothing imported the writer from the root, and
 * `npm run size` would notice the bytes if someone did. A rule that lives in nobody's failure is a rule that
 * survives until the day a reasonable-looking re-export of the writer is added to the barrel for convenience,
 * and the root entry gains a peer dependency it never advertised. So the ban is now a test, walking the module
 * graph the way a bundler does.
 *
 * Four things keep the assertions honest rather than tautological:
 *
 *  - **the holders are scanned for, not listed.** Every shipped source that imports the peer is found by reading
 *    `src/`, the ban is asserted against *that* set, and a separate case pins the set to the writer's two files.
 *    A guard that only knows two filenames passes on the day a third starts holding the peer;
 *  - **the opposite is asserted too.** `/edit` and `/merge` must reach a holder. The first version of this walk
 *    resolved `relative()` paths without normalising the separator, so on Windows every edge came back with
 *    backslashes, matched nothing, and the ban passed vacuously while the opposite case failed. That case is the
 *    one that makes the walk's own health observable;
 *  - **type-only imports are not a leak**, so they are not counted: they cost no bytes and install no peer.
 *    Value imports, re-exports and dynamic imports all count. Comments are stripped first, because these sources
 *    say what they reason about in prose and a sentence about importing something is otherwise an import edge;
 *  - **every advertised door is walked, not just the banned two.** The export map names thirteen JS entries; the
 *    set that compiles the peer in must be exactly `/edit` and `/merge`, so a third subpath cannot grow an
 *    unannounced peer requirement on a consumer that never asked to edit.
 *
 * The last case covers the rest of the clause's first sentence: every bare specifier a shipped module imports is
 * declared in the manifest. *Shipped* is derived rather than listed — a module is shipped when an advertised door
 * reaches it — which is what a bundler compiles, and what keeps a dev-only file like the axe harness out of the
 * set without a name on an allow-list. `dependencies` is empty by design: everything the package needs at runtime
 * is either a peer or bundled, so an undeclared import would be an unnoticed install-time requirement reaching a
 * consumer. The size gate cannot see that failure: an undeclared dependency resolves out of `node_modules`
 * happily until the day it does not.
 */
import { builtinModules } from 'node:module';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import packageJson from '../../package.json';

const repo = join(dirname(fileURLToPath(import.meta.url)), '../..');
const source = (relative: string): string => readFileSync(join(repo, relative), 'utf8');

/** The writer's own modules: the only doors through which the optional peer may enter. */
const WRITER_MODULES = ['src/lib/pdf-write.ts', 'src/lib/pdf-merge.ts'];

const PEER = '@cantoo/pdf-lib';

const SOURCE_EXTENSIONS = ['.ts', '.tsx'];

/**
 * Comments removed, so prose is not read as an import edge.
 *
 * The line rule leaves a URL's scheme alone, so a specifier carrying `https://` survives it; the block rule is
 * non-greedy because these files hold several blocks.
 */
function withoutComments(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:\\])\/\/[^\n]*/g, '$1');
}

/** The specifiers a module body really imports: no type-only forms, no comments, dynamic imports included. */
function valueImports(text: string): string[] {
  const code = withoutComments(text)
    .split('\n')
    .filter((line) => !/^\s*(import|export)\s+type\b/.test(line))
    .join('\n');
  const specifiers: string[] = [];
  const patterns = [
    /from\s+['"]([^'"]+)['"]/g,
    /import\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
    /^import\s+['"]([^'"]+)['"]/gm,
  ];
  for (const pattern of patterns) {
    for (const match of code.matchAll(pattern)) specifiers.push(match[1]!);
  }
  return specifiers;
}

/**
 * Resolve a relative specifier the way the build does: extension optional, directory index allowed.
 *
 * A non-relative specifier is not a module in this tree, and a stylesheet resolves to something that is not a
 * source file, so the walk stops there rather than failing on it.
 */
function resolveSpecifier(from: string, specifier: string): string | null {
  if (!specifier.startsWith('.')) return null;
  const base = resolve(dirname(join(repo, from)), specifier);
  const candidates = [
    ...SOURCE_EXTENSIONS.map((extension) => `${base}${extension}`),
    ...SOURCE_EXTENSIONS.map((extension) => join(base, `index${extension}`)),
  ];
  const found = candidates.find((candidate) => existsSync(candidate));
  // Repo-relative with forward slashes, so a resolved edge reads back as a path a human knows. On Windows
  // `relative` answers with backslashes, and a split on `/` alone leaves them — which would quietly make every
  // module a *different* string than the ones the writer list spells.
  return found ? relative(repo, found).split(/[\\/]+/).join('/') : null;
}

/** Every module an entry reaches through value imports, transitively. */
function reachable(entry: string): Set<string> {
  const seen = new Set<string>();
  const queue = [entry];
  while (queue.length) {
    const file = queue.shift()!;
    if (seen.has(file)) continue;
    seen.add(file);
    for (const specifier of valueImports(source(file))) {
      const resolved = resolveSpecifier(file, specifier);
      if (resolved && !seen.has(resolved)) queue.push(resolved);
    }
  }
  return seen;
}

/** The package roots a file list imports, with a subpath reduced to the package that declares it. */
function bareSpecifiers(files: string[]): Set<string> {
  const found = new Set<string>();
  const builtins = new Set(builtinModules);
  for (const file of files) {
    for (const specifier of valueImports(source(file))) {
      if (specifier.startsWith('.') || specifier.startsWith('/') || specifier.startsWith('node:')) continue;
      const root = specifier.startsWith('@')
        ? specifier.split('/').slice(0, 2).join('/')
        : specifier.split('/')[0]!;
      if (builtins.has(root)) continue;
      found.add(root);
    }
  }
  return found;
}

// The manifest is typed from its own shape, which has no `dependencies` key at all — that absence is the design,
// and reading it needs a view that allows it to be there tomorrow.
const manifest = packageJson as typeof packageJson & { dependencies?: Record<string, string> };

const exportedSubpaths = Object.keys(packageJson.exports ?? {});

/** Every shipped source file under `src/`, repo-relative and slash-separated. Tests are a host's stand-in. */
function shippedSources(dir = 'src'): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(join(repo, dir), { withFileTypes: true })) {
    const path = `${dir}/${entry.name}`;
    if (entry.isDirectory()) out.push(...shippedSources(path));
    else if (SOURCE_EXTENSIONS.some((extension) => entry.name.endsWith(extension))) out.push(path);
  }
  return out.filter((file) => !/\.test\.[tj]sx?$/.test(file));
}

/**
 * Every source that puts the peer into a bundle, found by scanning rather than by being told.
 *
 * The ban is asserted against *this* set rather than against the hardcoded list, so the failure it exists to
 * catch — a new `src/lib/somewhat-writer.ts` importing the peer and reached from the root — moves the peer's
 * holder and the guard notices a holder, instead of the list going stale.
 */
function peerHolders(): string[] {
  return shippedSources().filter((file) => valueImports(source(file)).includes(PEER));
}

/**
 * The source an entry point compiles from, with `.` spelled `index`.
 *
 * The export map's own targets are under `dist/` and are pinned against the sources by the parity check (#214);
 * what this file needs is a starting point for a walk over sources, so it maps the subpath by name and asserts
 * the map really declares it — a renamed entry would otherwise leave the walk starting from a file no consumer
 * can import.
 */
function entrySource(subpath: string): string | null {
  expect(exportedSubpaths, `the export map declares ${subpath}`).toContain(subpath);
  const stem = subpath === '.' ? 'index' : subpath.replace(/^\.\//, '');
  for (const extension of SOURCE_EXTENSIONS) {
    const candidate = `src/${stem}${extension}`;
    if (existsSync(join(repo, candidate))) return candidate;
  }
  return null;
}

describe('FR-53: the optional peer enters through the edit door and no other', () => {
  const holders = peerHolders().sort();

  /** Every advertised subpath that compiles from a source, with the modules it reaches. */
  const doors = exportedSubpaths
    .map((subpath) => [subpath, entrySource(subpath)] as const)
    .filter(([, entry]) => entry !== null)
    .map(([subpath, entry]) => [subpath, reachable(entry!)] as const);

  it('knows which sources hold the peer, so the ban cannot be satisfied by moving it and editing the list', () => {
    expect(holders, `the only files that may import ${PEER} are the writer's own`).toEqual(
      [...WRITER_MODULES].sort(),
    );
    for (const module of WRITER_MODULES) {
      expect(existsSync(join(repo, module)), `${module} is still where the guard thinks it is`).toBe(true);
    }
  });

  it('keeps every holder of the peer out of the root and headless entries, by module graph rather than by arrangement', () => {
    for (const subpath of ['.', './headless']) {
      const entry = entrySource(subpath);
      expect(entry, `${subpath} resolves to a source the walk can start from`).not.toBeNull();
      const reached = reachable(entry!);
      const leaked = holders.filter((module) => reached.has(module));
      expect(
        leaked,
        `${subpath} reaches ${PEER} through ${leaked.join(', ')}; the optional peer is not its dependency`,
      ).toEqual([]);
      expect(reached.size, 'and the walk really did walk somewhere').toBeGreaterThan(10);
    }
  });

  it('does reach a holder from /edit and /merge, which is what stops the case above passing on an empty graph', () => {
    for (const subpath of ['./edit', './merge']) {
      const entry = entrySource(subpath);
      expect(entry, `${subpath} resolves to a source file`).not.toBeNull();
      const reached = reachable(entry!);
      expect(
        holders.filter((module) => reached.has(module)).length,
        `${subpath} is the door ${PEER} is allowed behind`,
      ).toBeGreaterThan(0);
    }
  });

  it('publishes the peer through exactly the two advertised doors it is advertised on', () => {
    // Stronger than banning the root by name: no other subpath in the export map may compile the writer in,
    // because a third one would be an unannounced peer requirement on a consumer that never asked to edit.
    expect(doors.length, 'the walk found the sources the export map points at').toBeGreaterThanOrEqual(13);
    const reaching = doors
      .filter(([, reached]) => holders.some((module) => reached.has(module)))
      .map(([subpath]) => subpath);
    expect(reaching, 'every advertised entry that pulls in the optional peer').toEqual(['./edit', './merge']);
  });

  it('imports nothing at runtime that the manifest does not declare', () => {
    const declared = new Set([
      ...Object.keys(manifest.dependencies ?? {}),
      ...Object.keys(packageJson.peerDependencies ?? {}),
    ]);
    // Shipped = reachable from an advertised door, which is what a bundler compiles. That derivation is what
    // keeps this honest: `src/components/axe-audit-harness.ts` imports the dev-only `axe-core` and is reached by
    // no entry, so it is not a shipped module — and a hardcoded file list would have had to say so by name.
    const shipped = [...new Set(doors.flatMap(([, reached]) => [...reached]))].sort();
    const used = bareSpecifiers(shipped);

    const undeclared = [...used].filter((name) => !declared.has(name));
    expect(
      undeclared,
      `imported but in neither dependencies nor peerDependencies: ${undeclared.join(', ')}`,
    ).toEqual([]);
    expect(shipped.length, 'the walk reached the tree, not a handful of files').toBeGreaterThan(40);
    // And the exclusion above came from the graph, not from a name on a list: the audit harness is real source
    // that no door reaches.
    expect(shippedSources()).toContain('src/components/axe-audit-harness.ts');
    expect(shipped, 'a module on no door is not something a consumer installs for').not.toContain(
      'src/components/axe-audit-harness.ts',
    );
    expect(used.has(PEER), 'the writer is in the set, so the case above is not vacuous').toBe(true);
    expect(manifest.dependencies ?? {}, 'nothing is bundled in as a hard dependency').toEqual({});
  });

  it('advertises the React pair as one range, which is the only enforcement this package has', () => {
    /*
     * FR-53's `React and react-dom must match major versions` clause, read for what it can mean here: this
     * package cannot reach into a host's `node_modules`, and npm will install `react@18` beside `react-dom@19`
     * without complaint. What keeps the pair in step is the manifest's own words, so saying the same thing
     * twice, in two strings that have to agree, is the whole of it — and the two strings agreeing is the
     * assertion rather than a formality. Split them — a `^18.0.0 || ^19.0.0` for one and a `^19.0.0` for the
     * other, which is the kind of edit that happens when someone raises a floor in one place — and a host can
     * be told by this manifest that a mismatched pair is supported.
     *
     * What this does not prove is that a matched pair *works*, which is the `react` CI job's claim (18 and 19,
     * minimum and latest patch, one variable feeding both installs) and is cited under FR-48.
     */
    const peers = packageJson.peerDependencies ?? {};
    expect(peers['react-dom'], 'react-dom is advertised with the range react is').toBe(peers.react);
    expect(peers.react, 'the React range is declared, so the case above is not comparing two undefined').toEqual(
      expect.any(String),
    );
  });
});
