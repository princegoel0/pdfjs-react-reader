/**
 * The names a consumer can actually import, read out of the built declarations rather than out of a
 * document. `CODE_REFERENCE.md` §4 is generated from it, `api-maturity.json` is checked against it, and
 * §22 tells anyone verifying that document to run it — which is why it lives in `scripts/` and not in the
 * ignored spike folder where it was written.
 *
 * Types appear in `export { type X }` lists and in `export declare` lines, so both are parsed. The scan is
 * shared by `inventory.mjs` (which prints the lists) and `check-maturity.mjs` (which audits them); one copy
 * of the parsing is the difference between a check and two documents that disagree.
 *
 * Requires `npm run build` first — it reads `dist/`, the thing consumers resolve.
 */
import { existsSync, readFileSync } from 'node:fs';

/** Every JS entry point, as it is published, mapped to the declaration file that names its surface. */
export const ENTRIES = {
  'pdfjs-react-reader': 'dist/index.d.ts',
  'pdfjs-react-reader/headless': 'dist/headless.d.ts',
  'pdfjs-react-reader/edit': 'dist/edit.d.ts',
  'pdfjs-react-reader/merge': 'dist/merge.d.ts',
  'pdfjs-react-reader/features/print': 'dist/features/print.d.ts',
  'pdfjs-react-reader/features/download': 'dist/features/download.d.ts',
  'pdfjs-react-reader/features/forms': 'dist/features/forms.d.ts',
  'pdfjs-react-reader/features/outline': 'dist/features/outline.d.ts',
  'pdfjs-react-reader/features/layers': 'dist/features/layers.d.ts',
  'pdfjs-react-reader/features/annotate': 'dist/features/annotate.d.ts',
  'pdfjs-react-reader/features/attachments': 'dist/features/attachments.d.ts',
  'pdfjs-react-reader/features/structure': 'dist/features/structure.d.ts',
};

/**
 * Name lists per entry, each name tagged as `value` or `type`, plus `missing` for a declaration file the
 * build did not emit — which is itself a packaging defect and is reported rather than skipped.
 *
 * @returns {{ entries: Record<string, {name: string, type: boolean}[]>, missing: string[] }}
 */
export function publishedNames() {
  /** @type {Record<string, {name: string, type: boolean}[]>} */
  const entries = {};
  const missing = [];
  for (const [entry, file] of Object.entries(ENTRIES)) {
    if (!existsSync(file)) {
      missing.push(file);
      entries[entry] = [];
      continue;
    }
    const source = readFileSync(file, 'utf8');
    const found = new Map();
    const add = (name, type) => {
      if (name && name !== 'default') found.set(name, { name, type: type ?? (found.get(name)?.type ?? false) });
    };
    // `export { A, type B, C as D } from '...'` — the alias is the published name, so `as` is taken
    // literally here rather than treated as part of the identifier.
    for (const m of source.matchAll(/export\s*\{([^}]*)\}\s*(?:from|;)/g)) {
      for (const part of m[1].split(',')) {
        const text = part.trim();
        if (!text) continue;
        const isType = text.startsWith('type ');
        add(text.replace(/^type\s+/, '').split(/\s+as\s+/).pop().trim(), isType);
      }
    }
    for (const m of source.matchAll(/export declare (?:const|function|class|type|interface|enum) (\w+)/g)) {
      add(m[1], /type|interface|enum/.test(m[0]));
    }
    for (const m of source.matchAll(/export type (\w+)/g)) add(m[1], true);
    // Code-unit order, not locale-aware: §4 of `CODE_REFERENCE.md` is generated from this list, and a
    // collation change would churn every group heading in the document while renaming nothing.
    entries[entry] = [...found.values()].sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  }
  return { entries, missing };
}

/** The distinct names across every entry, with the ` (type)` marker a printed list needs. */
export function printed(entries) {
  const out = {};
  for (const [entry, list] of Object.entries(entries)) {
    out[entry] = list.map((n) => (n.type ? `${n.name} (type)` : n.name));
  }
  return out;
}
