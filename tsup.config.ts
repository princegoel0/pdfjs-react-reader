import { defineConfig } from 'tsup';

export default defineConfig({
  entry: {
    index: 'src/index.ts',
    headless: 'src/headless.ts',
    // One entry per built-in feature, so naming a feature in your import list is
    // what decides whether it is in your bundle. The shell imports none of them.
    'features/print': 'src/features/print.tsx',
    'features/download': 'src/features/download.tsx',
    'features/forms': 'src/features/forms.tsx',
    'features/outline': 'src/features/outline.tsx',
  },
  format: ['esm'],
  target: 'es2022',
  platform: 'browser',
  dts: true,
  sourcemap: true,
  clean: true,
  minify: false,
  external: ['react', 'react-dom', 'pdfjs-dist'],
});
