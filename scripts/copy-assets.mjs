import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { basename } from 'node:path';
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
  ['src/styles/layers.css', 'dist/layers.css'],
  ['src/styles/annotate.css', 'dist/annotate.css'],
  ['src/styles/attachments.css', 'dist/attachments.css'],
  ['src/styles/structure.css', 'dist/structure.css'],
  ['src/styles/edit.css', 'dist/edit.css'],
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
   declaration, so every CSS export carries one. The list is derived from the
   sheets above: a stylesheet added to one without the other was how
   `layers.css` and `attachments.css` came to be importable and absent. */
writeFileSync(
  'dist/styles.d.ts',
  sheets
    .map(([, to]) => `declare module 'pdfjs-react-reader/${basename(to)}';`)
    .join('\n') + '\n',
);

// The export map is the public contract, so this — the step that fills `dist/` —
// is where it gets proven. `tsconfig.json` resolves `pdfjs-react-reader/*` onto
// `src/`, so a target that exists only in the manifest typechecks, plays and
// docs-builds perfectly while every consumer import of it fails.
const { exports: exportMap } = JSON.parse(readFileSync('package.json', 'utf8'));
const missing = Object.entries(exportMap).flatMap(([subpath, entry]) => {
  const targets = typeof entry === 'string' ? [entry] : Object.values(entry);
  return targets
    .map((target) => target.replace(/^\.\//, ''))
    .filter((file) => !existsSync(file))
    .map((file) => `  ${subpath} -> ${file}`);
});

if (missing.length) {
  console.error(`package.json exports point at files this build did not emit:\n${missing.join('\n')}`);
  process.exit(1);
}

// The other direction, which is the one a playground cannot catch: `tsconfig.json` resolves
// `pdfjs-react-reader/*` onto `src/`, so a stylesheet built and imported by the playground but never
// added to the export map typechecks, plays and docs-builds while every consumer import of it fails.
// `structure.css` was emitted for a whole session before anyone looked.
const unlisted = sheets
  .map(([, to]) => `./${to.replace('dist/', '')}`)
  .filter((subpath) => !(subpath in exportMap));

if (unlisted.length) {
  console.error(
    `this build emitted stylesheets that package.json exports does not offer:\n` +
      `${unlisted.map((s) => `  ${s}`).join('\n')}\n` +
      `  (add each to "exports" with "types": "./dist/styles.d.ts")`,
  );
  process.exit(1);
}
