import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';

const r = (p: string) => fileURLToPath(new URL(p, import.meta.url));

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: [
      { find: /^pdfjs-react-reader\/styles\.css$/, replacement: r('../src/styles/viewer.css') },
      { find: /^pdfjs-react-reader\/headless$/, replacement: r('../src/headless.ts') },
      { find: /^pdfjs-react-reader$/, replacement: r('../src/index.ts') },
    ],
  },
  server: {
    port: 5199,
  },
});
