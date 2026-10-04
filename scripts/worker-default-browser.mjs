/**
 * FR-02's premise, measured where it is claimed: what `GlobalWorkerOptions.workerSrc` holds in a browser
 * before anything configures it.
 *
 * The requirement's "when it is absent" splits across realms, and the split decides what the package does.
 * pdf.js assigns the field from its own `isNodeJS`, so Node starts on `'./pdf.worker.mjs'` — which is the
 * main-thread fallback, and why `ensureWorker` must not write over it (`src/lib/worker.default.test.tsx`
 * asserts that row against the un-mocked engine) — while a browser starts on the empty string, which is
 * why the candidate probe runs there at all and why README can promise Vite, webpack and Rollup without a
 * line of configuration. Neither row is something to infer from the other: this script reads the browser
 * one in Chromium, with the playground's own entry blocked, because `playground/src/main.tsx` pins the
 * worker URL on import and would otherwise be measured as the default.
 *
 * Run with `npm run probe:worker`. Exits non-zero when a row stops being what the code assumes, because a
 * premise that quietly changes is how a guard starts testing a state no realm is in.
 */
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import { chromium } from 'playwright';

const repo = join(dirname(fileURLToPath(import.meta.url)), '..');
const server = await createServer({
  root: join(repo, 'playground'),
  configFile: join(repo, 'playground', 'vite.config.ts'),
  server: { port: 5294, host: '127.0.0.1' },
  logLevel: 'warn',
});
await server.listen();
const baseUrl = server.resolvedUrls?.local[0] ?? 'http://127.0.0.1:5294/';

/** Vite serves a file outside the playground root at `/@fs/` plus its absolute path. */
const moduleUrl = (relative) =>
  '/@fs/' + join(repo, relative).split(String.fromCharCode(92)).join('/');

const ENTRIES = [
  'node_modules/pdfjs-dist/build/pdf.mjs',
  'node_modules/pdfjs-dist/legacy/build/pdf.mjs',
];

const browser = await chromium.launch();
const page = await browser.newPage();
const errors = [];
page.on('pageerror', (error) => errors.push(String(error).slice(0, 160)));
await page.route('**/src/main.tsx', (route) => route.abort());
await page.goto(baseUrl, { waitUntil: 'domcontentloaded' });

const rows = [];
for (const entry of ENTRIES) {
  const read = await page.evaluate(async (url) => {
    try {
      const mod = await import(/* @vite-ignore */ url);
      return {
        ok: true,
        workerSrc: mod.GlobalWorkerOptions?.workerSrc,
        version: mod.version,
      };
    } catch (error) {
      return { ok: false, error: String(error).slice(0, 140) };
    }
  }, moduleUrl(entry));
  rows.push({ entry, ...read });
  console.log(
    `  ${entry}  ${read.ok ? `workerSrc = ${JSON.stringify(read.workerSrc)}` : `did not import: ${read.error}`}`,
  );
}
await browser.close();
await server.close();

const emptyInBrowser = rows.filter((row) => row.ok && row.workerSrc === '');
console.log('');
for (const row of rows) {
  const verdict = !row.ok
    ? 'FAIL (the entry did not import, so its default is unmeasured)'
    : row.workerSrc === ''
      ? 'ok (empty — a browser realm has configured nothing)'
      : `FAIL (assumed empty; found ${JSON.stringify(row.workerSrc)} — ` +
        'which row of `worker.default.test.tsx` this file now duplicates)';
  console.log(`  ${verdict}  ${row.entry}`);
}
if (errors.length) console.log(`  pageerrors: ${errors.join(' | ')}`);

const failed = rows.length - emptyInBrowser.length + (errors.length ? 1 : 0);
console.log(
  `\n${emptyInBrowser.length}/${rows.length} browser entries start on an empty workerSrc${errors.length ? `, with ${errors.length} pageerror(s)` : ''}.`,
);
process.exit(failed === 0 ? 0 : 1);
