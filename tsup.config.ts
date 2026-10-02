import { defineConfig } from 'tsup';

export default defineConfig({
  entry: {
    index: 'src/index.ts',
    headless: 'src/headless.ts',
    // The tier that needs the PDF writer. Its own entry because its dependency is an
    // optional peer: nothing the shell or the core imports may reach it.
    edit: 'src/edit.tsx',
    merge: 'src/merge.ts',
    // One entry per built-in feature, so naming a feature in your import list is
    // what decides whether it is in your bundle. The shell imports none of them.
    'features/print': 'src/features/print.tsx',
    'features/download': 'src/features/download.tsx',
    'features/forms': 'src/features/forms.tsx',
    'features/outline': 'src/features/outline.tsx',
    'features/layers': 'src/features/layers.tsx',
    'features/annotate': 'src/features/annotate.tsx',
    'features/attachments': 'src/features/attachments.tsx',
    // The only entry whose payload is a lazy `import()` of a peer module: the tier itself is a gate and a
    // few hundred bytes, and what it fetches at runtime is ≈50 kB of pdf.js viewer. `external` below keeps
    // that specifier intact rather than folding the viewer into the tier.
    'features/structure': 'src/features/structure.tsx',
    // One entry per shipped catalog. Not re-exported from the index on purpose: a
    // language is 134 strings, and importing the viewer should not hand it to you.
    'locales/de': 'src/locales/de.ts',
    'locales/es': 'src/locales/es.ts',
    'locales/fr': 'src/locales/fr.ts',
  },
  /*
   * Two formats, one package (FR-41). ESM is what every bundler and every `import` consumer resolves;
   * CJS is what a `require()` in a Jest test or a legacy Node toolchain resolves, and tsup names it
   * `.cjs` so `type: module` keeps the `.js` file ESM. The declaration files come out as `.d.ts` and
   * `.d.cts`, which is why each condition in the export map carries its own `types`.
   */
  format: ['esm', 'cjs'],
  target: 'es2022',
  platform: 'browser',
  dts: true,
  sourcemap: true,
  clean: true,
  minify: false,
  external: ['react', 'react-dom', 'pdfjs-dist', '@cantoo/pdf-lib'],
});
