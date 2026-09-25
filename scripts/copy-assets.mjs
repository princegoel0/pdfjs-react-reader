import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { transformSync } from 'esbuild';

mkdirSync('dist', { recursive: true });

// One stylesheet per tier (FR-22): the core sheet carries no rules for a feature
// the application did not ask for, so each feature ships the rules it needs.
// They are minified because the originals are heavily commented — the source
// comments explain the pdf.js internals these rules depend on, which is worth
// reading once and not worth downloading.
const sheets = [
  ['src/styles/viewer.css', 'dist/styles.css'],
  ['src/styles/print.css', 'dist/print.css'],
  ['src/styles/forms.css', 'dist/forms.css'],
  ['src/styles/outline.css', 'dist/outline.css'],
];

for (const [from, to] of sheets) {
  const css = readFileSync(from, 'utf8');
  const minified = transformSync(css, { loader: 'css', minify: true, sourcefile: from });
  writeFileSync(to, minified.code);
  const saved = 1 - minified.code.length / css.length;
  console.log(
    `${to}  ${css.length} B -> ${minified.code.length} B (-${(saved * 100).toFixed(0)}%)`,
  );
}

/* TypeScript 5.6+ reports TS2882 for a side-effect CSS import with no
   declaration, so every CSS export carries one. */
writeFileSync(
  'dist/styles.d.ts',
  [
    "declare module 'pdfjs-react-reader/styles.css';",
    "declare module 'pdfjs-react-reader/print.css';",
    "declare module 'pdfjs-react-reader/forms.css';",
    "declare module 'pdfjs-react-reader/outline.css';",
    '',
  ].join('\n'),
);
