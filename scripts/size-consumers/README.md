# Size consumers

Each file here is the smallest honest example of one thing an application can
import, and `scripts/check-size.mjs` bundles all of them with both esbuild and
Rollup to measure what that application actually downloads.

They import `../../dist/...` by relative path on purpose: the published
specifiers (`pdfjs-react-reader`, `pdfjs-react-reader/features/print`) resolve to
the same files through `node_modules`, but Rollup needs a resolver plugin to
follow them and this repo deliberately ships none. A path that is measured is a
path whose shape is known, so the relative form is the safer lie to tell.

Keep `react`, `react-dom` and `pdfjs-dist` out of these bundles: the application
supplies them, and `pdfjs-dist` alone gzips to 128.6 kB on the main thread
against our tens.
