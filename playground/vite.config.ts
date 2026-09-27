import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { createReadStream, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const r = (p: string) => fileURLToPath(new URL(p, import.meta.url));

const PDFJS_PKG = r('../node_modules/pdfjs-dist');

/**
 * Serves `/pdfjs-dist/<folder>/<file>` out of the installed package, so the
 * playground can demonstrate a self-hosted `assetUrl` without adding 2.4 MB of
 * binaries to the repo. Only the three folders pdf.js looks in are exposed, and
 * only under a flat file name, so `..` cannot reach outside them.
 */
function servePdfjsAssets(): Plugin {
  return {
    name: 'serve-pdfjs-assets',
    configureServer(server) {
      server.middlewares.use('/pdfjs-dist', (req, res, next) => {
        const match = /^\/(cmaps|standard_fonts|wasm)\/([A-Za-z0-9._-]+)$/.exec(req.url ?? '');
        const [, folder, name] = match ?? [];
        if (!folder || !name) return next();
        const file = join(PDFJS_PKG, folder, name);
        let size: number;
        try {
          const stats = statSync(file);
          if (!stats.isFile()) return next();
          size = stats.size;
        } catch {
          return next();
        }
        res.setHeader('Content-Type', 'application/octet-stream');
        res.setHeader('Content-Length', String(size));
        if (req.method === 'HEAD') return void res.end();
        createReadStream(file).pipe(res);
      });
    },
  };
}

export default defineConfig({
  plugins: [react(), servePdfjsAssets()],
  resolve: {
    alias: [
      { find: /^pdfjs-react-reader\/styles\.css$/, replacement: r('../src/styles/viewer.css') },
      // Each feature ships its own sheet, so a tier is a JS import and a CSS
      // import, and the playground runs from source rather than from dist.
      { find: /^pdfjs-react-reader\/(\w+)\.css$/, replacement: r('../src/styles/$1.css') },
      { find: /^pdfjs-react-reader\/features\/(\w+)$/, replacement: r('../src/features/$1.tsx') },
      // The writer tier is its own entry, not a feature: it is the one place the
      // optional peer may be imported.
      { find: /^pdfjs-react-reader\/edit$/, replacement: r('../src/edit.tsx') },
      { find: /^pdfjs-react-reader\/headless$/, replacement: r('../src/headless.ts') },
      { find: /^pdfjs-react-reader$/, replacement: r('../src/index.ts') },
    ],
  },
  server: {
    port: 5199,
  },
});
