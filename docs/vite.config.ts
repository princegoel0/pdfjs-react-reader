import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';

const r = (p: string) => fileURLToPath(new URL(p, import.meta.url));

/* Which copy of the library the docs render. Development aliases to `src` so
   edits hot-reload; CI sets DOC_TARGET=dist so the build proves the shipped
   bundle and its real export map instead of the sources. */
const fromDist = process.env.DOC_TARGET === 'dist';
const target = (file: string) => r(fromDist ? `../dist/${file}` : `../src/${file}`);

export default defineConfig({
  plugins: [react()],
  /* Relative so the same build works from a project-page subpath or a custom
     domain; the app routes on the hash, so no server rewrites are needed. */
  base: process.env.DOCS_BASE || './',
  resolve: {
    alias: [
      { find: /^pdfjs-react-reader\/styles\.css$/, replacement: target(fromDist ? 'styles.css' : 'styles/viewer.css') },
      { find: /^pdfjs-react-reader\/headless$/, replacement: target('headless.ts') },
      { find: /^pdfjs-react-reader$/, replacement: target(fromDist ? 'index.js' : 'index.ts') },
    ],
  },
  server: {
    port: 5200,
  },
  /* The examples load the repo's own fixture PDFs. They live with the
     playground, so serving that folder as the public dir avoids a second copy
     that would silently drift from the generator scripts. */
  publicDir: r('../playground/fixtures'),
  build: {
    outDir: 'dist',
  },
});
