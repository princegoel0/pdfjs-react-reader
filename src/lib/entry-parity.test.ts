/**
 * FR-52: "The published export map is the authoritative public surface." A surface that only
 * resolves once somebody has run a build is not a surface; it is a hope with a `dist/` folder
 * under it.
 *
 * The reason this file exists is that CI's first real run failed every `typecheck` cell and
 * reported every browser-matrix cell `not runnable` for one cause: `tsconfig.json#paths` and
 * the two Vite configs named the root, `/headless`, `/features/*` and the stylesheets, but not
 * `/edit`, `/merge` or `/locales/*`. Locally those same specifiers resolved — TypeScript and
 * Vite both honour a package's self-reference through its own `name` and `exports`, and a
 * `dist/` left over from an earlier build was there to be found. So a green local gate had been
 * proving the shipped artifact rather than the source layout, which is the one thing §5.7's
 * sixth item says packaging evidence must never do alone.
 *
 * Three rules, each of which a refactor can cross by accident while every behaviour test still
 * passes:
 *
 *  - **the public surface is reachable from source.** Every key of `package.json#exports`
 *    matches a `paths` entry, and the file that entry points at exists;
 *  - **the playground serves every entry it imports.** Every `pdfjs-react-reader*` specifier
 *    under `playground/src/` matches an alias in `playground/vite.config.ts`, and applying
 *    that alias — the same `String.replace` Vite applies — lands on a file that exists. This is
 *    the rule whose absence made the browser matrix unusable: the dev server could not resolve
 *    `/merge`, so no page painted and no check ran;
 *  - **the docs site matches every entry it imports,** which is asserted as a match rather than
 *    an existing file because the docs aliases are computed from `DOC_TARGET` and legitimately
 *    point into `dist/`.
 *
 * A missing entry fails a rule; an entry nobody imports and nobody maps does *not* fail one, on
 * purpose. The docs site is allowed to alias only what it shows, and a guard that demanded
 * symmetry in that direction would only teach whoever hit it to widen the alias list with junk.
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

const root = process.cwd();
const posix = (p: string) => p.split('\\').join('/');

/** Every documented JavaScript or CSS entry, which is what a consumer may import. */
function publicEntries(): string[] {
  const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as {
    exports: Record<string, unknown>;
  };
  return Object.keys(pkg.exports)
    // The self-reference is Node's, not ours to map through a bundler alias.
    .filter((key) => key !== './package.json')
    .map((key) => (key === '.' ? 'pdfjs-react-reader' : `pdfjs-react-reader/${key.slice(2)}`))
    .sort();
}

/** `pdfjs-react-reader/features/*` → a RegExp with one capture group, as `paths` means it. */
function patternOf(key: string): RegExp {
  const escaped = key.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '<*>');
  return new RegExp(`^${escaped.replace(/<\*>/g, '(.*)')}$`);
}

function tsconfigPaths(): Record<string, string[]> {
  const raw = readFileSync(join(root, 'tsconfig.json'), 'utf8');
  const parsed = ts.parseConfigFileTextToJson('tsconfig.json', raw);
  if (parsed.error) throw new Error(`tsconfig.json does not parse: ${parsed.error.messageText}`);
  const paths = (parsed.config?.compilerOptions?.paths ?? {}) as Record<string, string[]>;
  return paths;
}

/** The `pdfjs-react-reader*` specifiers a directory tree imports, read off the AST. */
function importedSpecifiers(dir: string): Map<string, string[]> {
  const found = new Map<string, string[]>();
  const files = readdirSync(join(root, dir), { recursive: true })
    .map((p) => posix(String(p)))
    .filter((p) => /\.tsx?$/.test(p))
    .filter((p) => !/\.test\.tsx?$/.test(p))
    .sort();
  for (const file of files) {
    const path = join(root, dir, file);
    const source = readFileSync(path, 'utf8');
    const parsed = ts.createSourceFile(file, source, ts.ScriptTarget.ES2022, true, ts.ScriptKind.TSX);
    const specifiers: string[] = [];
    const visit = (node: ts.Node) => {
      if (
        (ts.isImportDeclaration(node) || ts.isExportDeclaration(node) || ts.isCallExpression(node)) &&
        node.parent !== undefined
      ) {
        const specifier = ts.isCallExpression(node)
          ? node.expression.kind === ts.SyntaxKind.ImportKeyword
            ? (node.arguments[0] as ts.StringLiteral | undefined)?.text
            : undefined
          : node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)
            ? node.moduleSpecifier.text
            : undefined;
        if (specifier?.startsWith('pdfjs-react-reader')) specifiers.push(specifier);
      }
      ts.forEachChild(node, visit);
    };
    visit(parsed);
    if (specifiers.length) found.set(`${dir}/${file}`, specifiers.sort());
  }
  return found;
}

/**
 * The alias list of a Vite config, as `{ find, replacement }` pairs.
 *
 * Parsed from the AST, because the `find` values are regex literals and a line-oriented read of
 * a config full of comments would invent patterns nobody wrote. A replacement is followed to a
 * file when it is a path the scanner can read — a string literal, or the single literal argument
 * of the config's own `r(...)` helper — and a docs replacement built by `target()` from
 * `DOC_TARGET` is treated as a match only, since its result legitimately lives in `dist/`.
 */
function aliasesOf(configPath: string): { pattern: RegExp; replacement: string | null }[] {
  /** The literal path behind `r('../src/x.ts')`, or plain `'./x.ts'`; null if computed. */
  const literalPath = (node: ts.Node): string | null => {
    if (ts.isStringLiteral(node)) return node.text;
    if (ts.isCallExpression(node)) {
      const first = node.arguments[0];
      if (first && ts.isStringLiteral(first)) return first.text;
    }
    return null;
  };
  const source = readFileSync(join(root, configPath), 'utf8');
  const parsed = ts.createSourceFile(
    configPath,
    source,
    ts.ScriptTarget.ES2022,
    true,
    ts.ScriptKind.TS,
  );
  const aliases: { pattern: RegExp; replacement: string | null }[] = [];
  const visit = (node: ts.Node) => {
    if (ts.isObjectLiteralExpression(node)) {
      const find = node.properties.find(
        (p) => ts.isPropertyAssignment(p) && p.name.getText() === 'find',
      ) as ts.PropertyAssignment | undefined;
      const replacement = node.properties.find(
        (p) => ts.isPropertyAssignment(p) && p.name.getText() === 'replacement',
      ) as ts.PropertyAssignment | undefined;
      // A `find:` that is not a regex literal is not one of ours: the array also carries
      // plugin-level string aliases in other configs, and a plain string means exact match.
      if (find && ts.isRegularExpressionLiteral(find.initializer) && replacement) {
        const body = find.initializer.getText().slice(1, -1);
        aliases.push({
          pattern: new RegExp(body),
          replacement: literalPath(replacement.initializer),
        });
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(parsed);
  return aliases;
}

const entries = publicEntries();
const paths = tsconfigPaths();
const playground = { dir: 'playground/src', config: 'playground/vite.config.ts' };
const docs = { dir: 'docs/src', config: 'docs/vite.config.ts' };

describe('the export map is reachable from the source layout (FR-52)', () => {
  it('maps every documented entry through tsconfig paths, to a file that exists', () => {
    const unresolved: string[] = [];
    const missing: string[] = [];
    for (const specifier of entries) {
      const hit = Object.entries(paths).find(([key]) => patternOf(key).test(specifier));
      if (!hit) {
        unresolved.push(specifier);
        continue;
      }
      const captured = specifier.match(patternOf(hit[0]));
      const mapped = hit[1][0];
      if (!mapped) {
        missing.push(`${specifier} → (${hit[0]} has no target)`);
        continue;
      }
      const target = mapped.replace(/^\.\//, '').replace(/\*/g, captured?.[1] ?? '');
      if (!existsSync(resolve(root, target))) missing.push(`${specifier} → ${target}`);
    }
    expect(unresolved, `entries with no source mapping: ${unresolved.join(', ')}`).toEqual([]);
    expect(missing, `entries mapped at a file that is not there: ${missing.join(', ')}`).toEqual([]);
  });

  it('refuses a tsconfig paths entry that points at nothing, because a stale alias is a lie', () => {
    const dead = Object.entries(paths)
      .flatMap(([, targets]) => targets)
      .filter((target) => !target.includes('*') && !existsSync(resolve(root, target.replace(/^\.\//, ''))))
      .sort();
    expect(dead, `paths entries whose target file does not exist: ${dead.join(', ')}`).toEqual([]);
  });

  it('serves every entry the playground imports, resolving it to a real file', () => {
    const unmatched: string[] = [];
    const broken: string[] = [];
    const aliases = aliasesOf(playground.config);
    const configDir = dirname(join(root, playground.config));
    for (const [file, specifiers] of importedSpecifiers(playground.dir)) {
      for (const specifier of specifiers) {
        const hit = aliases.find(({ pattern }) => pattern.test(specifier));
        if (!hit) {
          unmatched.push(`${specifier} (from ${file})`);
          continue;
        }
        if (!hit.replacement) continue;
        const mapped = specifier.replace(hit.pattern, hit.replacement);
        if (!existsSync(resolve(configDir, mapped))) broken.push(`${specifier} → ${mapped}`);
      }
    }
    expect(aliases.length, `${playground.config} exposed no aliases to scan`).toBeGreaterThan(0);
    expect(unmatched, `specifiers the dev server cannot resolve: ${unmatched.join(', ')}`).toEqual([]);
    expect(broken, `aliases that land on a file that is not there: ${broken.join(', ')}`).toEqual([]);
  });

  it('serves every entry the docs site imports', () => {
    const unmatched: string[] = [];
    const aliases = aliasesOf(docs.config);
    for (const [file, specifiers] of importedSpecifiers(docs.dir)) {
      for (const specifier of specifiers) {
        if (!aliases.some(({ pattern }) => pattern.test(specifier))) {
          unmatched.push(`${specifier} (from ${file})`);
        }
      }
    }
    expect(aliases.length, `${docs.config} exposed no aliases to scan`).toBeGreaterThan(0);
    expect(unmatched, `specifiers the docs build cannot resolve: ${unmatched.join(', ')}`).toEqual([]);
  });

  // The positive control, because all four rules above pass on an empty scan too. Deleting a
  // mapping has to make this file go red for the reason it was written, not quietly stop
  // measuring anything.
  it('actually reads the imports it claims to read', () => {
    const imports = importedSpecifiers(playground.dir);
    const merged = [...imports.values()].flat();
    expect(merged, 'the playground is expected to import the merge entry').toContain(
      'pdfjs-react-reader/merge',
    );
    expect(entries).toContain('pdfjs-react-reader/merge');
    expect(entries.length).toBeGreaterThanOrEqual(20);
  });
});
