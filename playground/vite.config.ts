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

/*
 * Which copy of the library the playground runs. Source is the default because that is what hot-reload is
 * for. `PJSR_TARGET=dist` is FR-58's: §9 says the release candidate is *tested from the packed artifact*, and
 * a browser matrix that loads `src` cannot evidence that — it certifies code the consumer never installs. The
 * same switch already exists for the docs build (`DOC_TARGET=dist`), so the artifact has two consumers in the
 * toolchain rather than one argument repeated.
 */
const fromDist = process.env.PJSR_TARGET === 'dist';
const target = (file: string) => r(fromDist ? `../dist/${file}` : `../src/${file}`);

export default defineConfig({
  plugins: [react(), servePdfjsAssets()],
  resolve: {
    alias: [
      { find: /^pdfjs-react-reader\/styles\.css$/, replacement: target(fromDist ? 'styles.css' : 'styles/viewer.css') },
      // Each feature ships its own sheet, so a tier is a JS import and a CSS
      // import, and both layouts are the same two patterns.
      { find: /^pdfjs-react-reader\/(\w+)\.css$/, replacement: target(`${fromDist ? '' : 'styles/'}$1.css`) },
      {
        find: /^pdfjs-react-reader\/features\/(\w+)$/,
        replacement: target(`features/$1.${fromDist ? 'js' : 'tsx'}`),
      },
      // Shipped locale catalogs, same two layouts.
      {
        find: /^pdfjs-react-reader\/locales\/(\w\w)$/,
        replacement: target(`locales/$1.${fromDist ? 'js' : 'ts'}`),
      },
      // The writer tier is its own entry, not a feature: it is the one place the
      // optional peer may be imported.
      { find: /^pdfjs-react-reader\/edit$/, replacement: target(`edit.${fromDist ? 'js' : 'tsx'}`) },
      // Merge is a separate entry so a consumer can pull in the writer without the
      // editing UI; the playground's merge demo is what imports it.
      { find: /^pdfjs-react-reader\/merge$/, replacement: target(`merge.${fromDist ? 'js' : 'ts'}`) },
      { find: /^pdfjs-react-reader\/headless$/, replacement: target(`headless.${fromDist ? 'js' : 'ts'}`) },
      { find: /^pdfjs-react-reader$/, replacement: target(fromDist ? 'index.js' : 'index.ts') },
    ],
  },
  server: {
    port: 5199,
  },
});
