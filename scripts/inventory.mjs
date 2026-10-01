// Lists every name a consumer can import from each JS entry point, read out of the built
// declarations rather than out of a document. `CODE_REFERENCE.md` §4 is generated from this, and
// §22 tells anyone checking that document to run it, which means it has to live in `scripts/` and
// not in the ignored spike folder where it was written.
//
// Types appear in `export { type X }` lists and in `export declare` lines, so both are parsed.
// Requires `npm run build` first — it reads `dist/`, the thing consumers actually resolve.
import { readFileSync, existsSync } from 'node:fs';
const entries = {
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
const out = {};
for (const [name, file] of Object.entries(entries)) {
  if (!existsSync(file)) { out[name] = ['MISSING ' + file]; continue; }
  const src = readFileSync(file, 'utf8');
  const names = new Set();
  // export { A, type B, C as D } from '...'
  for (const m of src.matchAll(/export\s*\{([^}]*)\}\s*(?:from|;)/g)) {
    for (const part of m[1].split(',')) {
      const t = part.trim();
      if (!t) continue;
      const cleaned = t.replace(/^type\s+/, '').split(/\s+as\s+/).pop().trim();
      if (cleaned && cleaned !== 'default') names.add(cleaned + (t.startsWith('type ') ? ' (type)' : ''));
    }
  }
  for (const m of src.matchAll(/export declare (?:const|function|class|type|interface|enum) (\w+)/g)) names.add(m[1]);
  for (const m of src.matchAll(/export type (\w+)/g)) names.add(m[1] + ' (type)');
  out[name] = [...names].sort();
}
console.log(JSON.stringify(out, null, 1));
