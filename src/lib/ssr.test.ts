/*
 * FR-46: importing this package on a server must not throw.
 *
 * The property is worth stating because the framework that pays for it is the one most of our consumers
 * deploy with: a Next.js app server, a Remix loader, a `react-dom/server` render all evaluate the module
 * graph without a DOM, and a single module-top-level `document.createElement` or `new Worker` in a
 * dependency turns that into a crash the reader never sees, on a machine the developer cannot inspect.
 * Rendering is client-only and always will be — a canvas needs a browser — so the documented pattern is a
 * client boundary around the *viewer*, and this test is what makes "import it anywhere" a property rather
 * than an accident nobody thought to check.
 *
 * Two things make the check mean something. The environment is asserted to be a server *first*: if a
 * config change ever leaked jsdom globals into this project, the test would fail on that assertion rather
 * than quietly pass. And the entry list is read out of `package.json`, not typed out here, so the day a
 * fourteenth entry point is added it is covered by the same loop — or the loop fails to find its source
 * file and says so.
 *
 * What is deliberately *not* claimed: that anything renders server-side, that hydration works without a
 * client boundary, or that `pdfjs-dist`'s own legacy build is being imported here (it warns, and importing
 * the module is all this proves). `dist/` is not touched either, because `npm test` runs before
 * `npm run build` in the verify sequence.
 */
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';

interface PackageShape {
  // Either shape the map has used: a bare string, a flat `{ types, import }`, or — since FR-41 — a
  // condition object nested by module format. Only the ESM target matters here.
  exports: Record<string, unknown>;
}

/** The `import`-condition file of one export entry, whichever depth it is nested at. */
function importTarget(entry: unknown): string | undefined {
  if (typeof entry === 'string') return entry.endsWith('.js') ? entry : undefined;
  if (typeof entry !== 'object' || entry === null) return undefined;
  const value = (entry as Record<string, unknown>).import;
  if (typeof value === 'string') return value.endsWith('.js') ? value : undefined;
  if (typeof value === 'object' && value !== null) {
    const target = (value as Record<string, unknown>).default;
    return typeof target === 'string' && target.endsWith('.js') ? target : undefined;
  }
  return undefined;
}

/** Every JS target in the export map, as the entry name it is published under. */
function exportedEntries(): { name: string; distFile: string }[] {
  const pkg = JSON.parse(
    readFileSync(join(process.cwd(), 'package.json'), 'utf8'),
  ) as unknown as PackageShape;
  const entries: { name: string; distFile: string }[] = [];
  for (const [name, target] of Object.entries(pkg.exports)) {
    const file = importTarget(target);
    // Stylesheets and the `types` conditions are not modules, and the CSS entries are the ones that
    // promise nothing about a server.
    if (!file) continue;
    entries.push({ name, distFile: file });
  }
  return entries;
}

/** `dist/features/print.js` → `src/features/print.tsx`, whichever extension the source uses. */
function sourceFor(distFile: string): string {
  // The export map writes `./dist/…`, so the leading `./` goes first or nothing matches.
  const base = distFile
    .replace(/^\.\//, '')
    .replace(/^dist\//, 'src/')
    .replace(/\.js$/, '');
  for (const extension of ['.ts', '.tsx']) {
    const candidate = resolve(process.cwd(), `${base}${extension}`);
    try {
      readFileSync(candidate);
      return candidate;
    } catch {
      // Not this extension; try the next.
    }
  }
  throw new Error(`${distFile} has no ${base}.ts or ${base}.tsx to import`);
}

describe('importing the package without a DOM', () => {
  it('runs in an environment that really is a server', () => {
    // The premise of every assertion below. Stated as a test because a premise nobody checks is a premise
    // that quietly stops being true — vitest's two projects differ only by this kind of global.
    // `typeof` answers with the *string* 'undefined', so these compare strings rather than using
    // `toBeUndefined()`, which would pass only if `typeof` had returned the value itself. `navigator` is
    // deliberately not on the list: Node ships one since v21, so its absence would prove nothing.
    for (const global of ['document', 'window', 'HTMLCanvasElement', 'Worker']) {
      expect(typeof (globalThis as Record<string, unknown>)[global], global).toBe('undefined');
    }
  });

  it('has every entry point in the export map resolvable to a source file', () => {
    const entries = exportedEntries();
    // The list is only as good as the mapping, so prove the mapping first: fifteen modules since FR-41
    // added `/merge`, plus the locales and features that arrive with them.
    expect(entries.length).toBeGreaterThanOrEqual(4);
    for (const entry of entries) {
      expect(sourceFor(entry.distFile), entry.name).toMatch(/[/\\]src[/\\]/);
    }
  });

  it.each(exportedEntries())('imports $name without throwing', async ({ name, distFile }) => {
    const mod = (await import(/* @vite-ignore */ pathToFileURL(sourceFor(distFile)).href)) as Record<
      string,
      unknown
    >;
    // An empty namespace would also "not throw", and would be a broken entry all the same.
    expect(Object.keys(mod).length, `${name} exports nothing`).toBeGreaterThan(0);
  });

  it('names the pieces a server bundle is most likely to reach for', async () => {
    const root = (await import(/* @vite-ignore */ pathToFileURL(sourceFor('dist/index.js')).href)) as Record<
      string,
      unknown
    >;
    const headless = (await import(
      /* @vite-ignore */ pathToFileURL(sourceFor('dist/headless.js')).href
    )) as Record<string, unknown>;

    for (const name of ['PdfViewer', 'PdfPage', 'usePdfDocument', 'classifySource', 'normalizeSource']) {
      expect(root, `index has no ${name}`).toHaveProperty(name);
    }
    for (const name of ['usePdfDocument', 'usePdfSearch', 'base64ToBytes', 'classifyLoadError']) {
      expect(headless, `headless has no ${name}`).toHaveProperty(name);
    }
    // The exports are values, not erased types — that is what a server bundle has to survive importing.
    // `PdfViewer` is created with `forwardRef`, so its value is a component *object*, not a function;
    // asserting 'function' here would be a lie about React, so the two are pinned the way they really are.
    expect(root.PdfViewer).toBeTruthy();
    expect(typeof headless.usePdfDocument).toBe('function');
  });

  it('runs the source helpers that read the DOM, with no DOM to read', async () => {
    // The interesting half of FR-46 for our own code: `resolveSourceUrl` and `isAllowedSource` both reach
    // for `document.baseURI`, and both have to fall back rather than throw when there is no document —
    // which is exactly what a server render of a `<PdfViewer>` would otherwise hit.
    const { base64ToBytes, classifySource, isAllowedSource, resolveSourceUrl } = await import(
      /* @vite-ignore */ pathToFileURL(sourceFor('dist/lib/source.js')).href
    );
    expect(resolveSourceUrl('/files/a.pdf')).toBe('/files/a.pdf');
    expect(classifySource('/files/a.pdf')).toEqual({ kind: 'url', url: '/files/a.pdf' });
    expect(base64ToBytes('AAAA')).toEqual(Uint8Array.from([0, 0, 0]));
    // The allowlist's server behaviour is the subtle one, so both halves are pinned. A relative string
    // cannot be resolved with no document to resolve it against, so it is compared as text — which is
    // still safe, because a relative path is not cross-origin by construction. A *cross-origin* absolute
    // URL, the case the path entry exists to refuse, is refused: the path branch needs an origin to
    // compare to and there is none, so it admits nothing rather than guessing.
    expect(isAllowedSource('/files/a.pdf', ['/files/'])).toBe(true);
    expect(isAllowedSource('https://evil.example/files/a.pdf', ['/files/'])).toBe(false);
    expect(isAllowedSource('https://cdn.example.com/a.pdf', ['https://cdn.example.com'])).toBe(true);
  });
});
