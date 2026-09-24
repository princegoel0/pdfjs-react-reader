import { copyFileSync, mkdirSync, writeFileSync } from 'node:fs';

mkdirSync('dist', { recursive: true });
copyFileSync('src/styles/viewer.css', 'dist/styles.css');

/* TypeScript 5.6+ reports TS2882 for a side-effect CSS import with no
   declaration, so the `./styles.css` export carries one. */
writeFileSync(
  'dist/styles.d.ts',
  "declare module 'pdfjs-react-reader/styles.css';\n",
);
