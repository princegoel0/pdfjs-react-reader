/*
 * §6.2's security sentences, asserted instead of arranged.
 *
 * Three of them describe an absence, and an absence is the easiest thing in a codebase to lose: nothing writes
 * a document-supplied string as HTML, nothing needs `unsafe-eval`, and nothing performs an external navigation
 * itself. All three were true of this tree and none of them was in anybody's failure, so the first
 * `dangerouslySetInnerHTML` a contributor reaches for — because a popup's title has to go *somewhere* — would
 * have landed silently in a package whose PRD says the annotation and link DOM is not an injection vector.
 *
 * The fourth is the opposite shape and is the reason this file exists at all. §6.2 says an object URL belongs
 * to whoever creates it and is revoked rather than left for the lifetime of the page. `downloadBytes` did
 * revoke, on a later task, and its reason is written above the call; the worker's cross-origin import wrapper
 * did not, so a host that reloads documents against a CDN `workerSrc` leaked one blob URL per load for as long
 * as the page lived. That is fixed in `worker.ts` and proved in `worker.test.ts`; what is asserted here is the
 * shape that let it happen — that the set of creators is known, and that every one of them also revokes.
 *
 * The scanner is local, as `layering.test.ts` and `feature-boundary.test.ts` keep theirs: a shared helper
 * would have to live under `src/lib/`, and a test-only module sitting in the core glue is the first thing a
 * reader of §3.1's assertion would ask about.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const repo = join(dirname(fileURLToPath(import.meta.url)), '../..');
const read = (rel: string): string => readFileSync(join(repo, rel), 'utf8');

const isTestFile = (file: string): boolean => /\.test\.[cm]?[tj]sx?$/.test(file);
const normalize = (path: string): string => path.split(/[\\/]+/).join('/');

/** Every non-test source module under `src/`, whether or not an entry point reaches it. */
function shippedSources(dir = 'src', out: string[] = []): string[] {
  for (const entry of readdirSync(join(repo, dir), { withFileTypes: true })) {
    const path = normalize(`${dir}/${entry.name}`);
    if (entry.isDirectory()) shippedSources(path, out);
    else if (/\.[cm]?[tj]sx?$/.test(entry.name) && !isTestFile(path)) out.push(path);
  }
  return out;
}

/** Comments removed: these sources quote the rules they hold in prose, and a sentence is not a call site. */
const withoutComments = (text: string): string =>
  text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:\\])\/\/[^\n]*/g, '$1');

const sources = shippedSources();
const code = new Map(sources.map((file) => [file, withoutComments(read(file))]));

/** A document-supplied string reaching the parser, which is the injection §6.2 rules out. */
const HTML_WRITE =
  /\b(?:innerHTML|outerHTML|insertAdjacentHTML|dangerouslySetInnerHTML)\b|\bdocument\.write\s*\(/;

/** Anything that needs `unsafe-eval` in a host's CSP, which §6.2 says nothing here does. */
const EVAL_LIKE = /(?:^|[^.\w])eval\s*\(|\bnew\s+Function\s*\(/;

/** A navigation this package performs, where §6.2 says it hands the URL to the host instead. */
const NAVIGATES = /\bwindow\.open\s*\(|\blocation\.(?:assign|replace)\s*\(|\blocation\.href\s*=[^=]/;

const offenders = (pattern: RegExp): string[] =>
  sources
    .filter((file) => pattern.test(code.get(file)!))
    .flatMap((file) =>
      code
        .get(file)!
        .split('\n')
        .map((line, index) => ({ line, at: `${file}:${index + 1}` }))
        .filter(({ line }) => pattern.test(line))
        .map(({ line, at }) => `${at} ${line.trim().slice(0, 90)}`),
    );

describe('§6.2: no document-supplied string is written as HTML', () => {
  it('finds no HTML write in shipped source', () => {
    expect(offenders(HTML_WRITE), 'a document-supplied string parsed as markup is the injection §6.2 rules out').toEqual([]);
    expect(sources.length, 'and the scan really walked the tree').toBeGreaterThan(60);
  });

  it('finds no `unsafe-eval` requirement', () => {
    expect(offenders(EVAL_LIKE), 'a host whose CSP forbids eval must be able to load this package').toEqual([]);
  });

  it('performs no external navigation itself', () => {
    // Separate from the case above so a violation of either is reported on its own: two bans in one case mean
    // the second is never reached once the first fails, which reads as one defect where there are two.
    expect(offenders(NAVIGATES), 'external navigation belongs to the host, through the link service').toEqual([]);
  });

  it('sees each violation it bans, and ignores the code that merely looks like one', () => {
    // The scan's own health, in both directions. A pattern that matched nothing would pass every case above
    // vacuously; a pattern that matched ordinary code would have failed the first time someone wrote a
    // comment about it, which is why comments are stripped before the scan rather than exempted inside it.
    for (const snippet of [
      'node.innerHTML = annotation.title',
      'el.outerHTML = rendered',
      'target.insertAdjacentHTML("beforeend", popup)',
      'document.write(body)',
      '<span dangerouslySetInnerHTML={{ __html: label }} />',
    ]) {
      expect(HTML_WRITE.test(snippet), `the HTML ban does not fire on: ${snippet}`).toBe(true);
    }
    for (const snippet of ['eval(documentScript)', 'const run = new Function(body)']) {
      expect(EVAL_LIKE.test(snippet), `the eval ban does not fire on: ${snippet}`).toBe(true);
    }
    for (const snippet of ['window.open(url, "_blank")', 'location.assign(href)', 'location.href = target']) {
      expect(NAVIGATES.test(snippet), `the navigation ban does not fire on: ${snippet}`).toBe(true);
    }
    // Near-misses the bans must leave alone, or the guard becomes a reason to write worse code around it.
    expect(HTML_WRITE.test('node.textContent = annotation.title')).toBe(false);
    expect(EVAL_LIKE.test('const verdict = evaluate(expression)')).toBe(false);
    expect(EVAL_LIKE.test('const href = resolve(url)')).toBe(false);
    expect(NAVIGATES.test('if (location.href === base) return')).toBe(false);
  });
});

describe('§6.2: an object URL is owned by whoever creates it, and revoked', () => {
  const creators = sources.filter((file) => /createObjectURL/.test(code.get(file)!)).sort();

  it('knows every module that allocates one', () => {
    // Pinned as a set rather than counted, so a third creator is a question the guard asks out loud: which
    // load owns it, and where does it die. Both current creators are per-load — one download, one worker —
    // and each revokes on the path that ends that load.
    expect(creators, 'the modules that allocate an object URL').toEqual(['src/lib/download.ts', 'src/lib/worker.ts']);
  });

  it('has every creator revoke what it created', () => {
    const unrevoked = creators.filter((file) => !/revokeObjectURL/.test(code.get(file)!));
    expect(unrevoked, 'an object URL left for the lifetime of the page is the leak §6.2 names').toEqual([]);
  });

  it('revokes on the path that ends the owner, which is what the two current creators do', () => {
    // The shape of the fix, stated so the next creator is written to it: `downloadBytes` revokes on a later
    // task because revoking synchronously can cancel the download before the browser reads the blob, and the
    // worker revokes in `dispose` because the wrapper has to outlive the constructor that reads it. Neither
    // is a revoke at creation, and a revoke at creation is the bug this case exists to keep out.
    const download = code.get('src/lib/download.ts')!;
    expect(download, 'the download revokes after the click, not before it').toMatch(
      /setTimeout\(\s*\(\)\s*=>\s*URL\.revokeObjectURL/,
    );
    const worker = code.get('src/lib/worker.ts')!;
    expect(worker, 'the worker revokes the wrapper it created, in the dispose that ends the load').toMatch(
      /dispose:\s*\(\)\s*=>\s*\{[\s\S]*?revokeObjectURL\(script\.blob\)/,
    );
  });
});
