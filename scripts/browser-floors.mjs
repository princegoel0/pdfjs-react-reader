#!/usr/bin/env node
/**
 * FR-48, §8: the pinned browser floors, measured rather than asserted.
 *
 * §8's execution policy says a floor claim "MUST NOT rely on the default hosted browser" and that "a current
 * browser passing the suite does not certify an old-version floor" — and FR-48's row has always reported the gap
 * honestly by naming the versions it measured (chromium 153, firefox 155, webkit 26) and saying they are not the
 * floors. This closes the half of that which is instrument: it runs the playground in the *pinned* build each §8
 * row names, and reports whether the package works there.
 *
 * A pinned browser build comes from the Playwright release that was cut against it, so the drivers are passed in
 * as directories (`--drivers=chromium=/abs/pw-1.44.1/node_modules/playwright,…`) and each cell refuses to
 * certificate itself: the run prints the version that actually started and compares it to the floor read out of
 * PRD.md, so a wrong pin says `below the floor it claims`, not `pass`.
 *
 * The first run, on 2026-10-09, did not pass, and the reason is in the engine rather than in this package: every
 * published pdf.js 6.x calls `URL.parse` (8 sites in `pdf.mjs`, 3 in the worker) and `Promise.try` (4 and 4) — all
 * five releases counted from their own tarballs (`6.0.227`, `6.1.200`, `6.2.108`, `6.3.289`, `6.4.299`), and the
 * `Iterator.prototype` check is the one that arrived later: none in `6.0.227` or `6.1.200`, present from `6.2.108`,
 * which is the advertised engine floor. Chromium 125 has neither `Promise.try` nor, at 125, `URL.parse`, while
 * Firefox 124 and WebKit 18.0 throw on
 * the `Iterator` global before the app's first paint. The three counts are printed here per engine so the claim is
 * re-checkable, and §8's floor numbers are the thing that has to answer to them.
 *
 * Usage: node scripts/browser-floors.mjs --drivers=chromium=<dir>,firefox=<dir> [--fixture=name.pdf] [--json=floor.json]
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createServer } from 'vite';

const repo = join(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const inline = args.find((a) => a.startsWith(`--${name}=`));
  return inline ? inline.slice(name.length + 3) : fallback;
};

/**
 * §8's minimum column, read rather than copied — the same derivation `browser-matrix.mjs` uses, so the two cannot
 * quietly disagree about what the contract claims.
 */
function contractFloors() {
  const found = new Map();
  for (const line of readFileSync(join(repo, 'PRD.md'), 'utf8').split('\n')) {
    if (!line.startsWith('| ')) continue;
    const cells = line.split('|').map((c) => c.trim());
    if (cells.length < 6) continue;
    const version = /^(\d+)(?:\.\d+)*/.exec(cells[4]);
    if (version) found.set(cells[1], Number(version[1]));
  }
  return found;
}

const ROWS = { chromium: 'Chrome / Chromium', firefox: 'Firefox', webkit: 'Safari (macOS)' };
const floors = contractFloors();
const drivers = Object.fromEntries(
  (flag('drivers', '') || '')
    .split(',')
    .filter(Boolean)
    .map((pair) => {
      const [engine, dir] = pair.split('=');
      return [engine.trim(), resolve(dir.trim())];
    }),
);
const fixture = flag('fixture', 'page-order-sample.pdf');

const missing = Object.keys(ROWS).filter((engine) => !drivers[engine]);
if (missing.length) {
  console.error(
    `no pinned driver for ${missing.join(', ')} — pass --drivers=chromium=<playwright dir>,….\n` +
      'A floor claim needs the build the floor names; running the repository’s own Playwright would be the ' +
      'thing §8 refuses to count.',
  );
  process.exit(2);
}

const server = await createServer({
  root: join(repo, 'playground'),
  configFile: join(repo, 'playground', 'vite.config.ts'),
  server: { port: Number(flag('port', 5320)), host: '127.0.0.1' },
  logLevel: 'error',
});
await server.listen();
const base = server.resolvedUrls.local[0];

/** The APIs that decide whether the engine's own code can run, named in the order they break. */
const CAPABILITIES = () => ({
  Iterator: typeof Iterator,
  'URL.parse': typeof URL.parse,
  'Promise.try': typeof Promise.try,
  'AbortSignal.any': typeof AbortSignal.any,
  'has()': CSS.supports('selector(:has(*))'),
  'light-dark()': CSS.supports('color', 'light-dark(red, blue)'),
  nesting: CSS.supports('selector(&)'),
});

const report = [];
for (const [engine, rowLabel] of Object.entries(ROWS)) {
  const floor = floors.get(rowLabel);
  const entry = { engine, row: rowLabel, floor, outcome: '', detail: '' };
  report.push(entry);
  let driver;
  const dir = drivers[engine];
  try {
    if (!isAbsolute(dir)) throw new Error(`the driver path must be absolute, because the run starts from the repo: ${dir}`);
    // `index.mjs` is the package's ESM surface; a release old enough to lack it still exports the same driver.
    const entryFile = join(dir, existsSync(join(dir, 'index.mjs')) ? 'index.mjs' : 'index.js');
    driver = await import(pathToFileURL(entryFile).href);
  } catch (error) {
    entry.outcome = 'no driver';
    entry.detail = String(error.message ?? error).slice(0, 140);
    console.log(`${engine.padEnd(9)} floor ${String(floor).padEnd(5)} NO DRIVER — ${entry.detail}`);
    continue;
  }

  let browser;
  try {
    browser = await driver[engine].launch();
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    const thrown = [];
    page.on('pageerror', (e) => thrown.push(String(e?.message ?? e)));
    await page.goto(base, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(3_000);
    const caps = await page.evaluate(CAPABILITIES);
    const ua = await page.evaluate(() => navigator.userAgent);
    const started = Number((/(?:Chrome|Firefox|Version)\/(\d+)/.exec(ua) ?? [])[1] ?? NaN);
    const booted = await page.evaluate(() => !!document.querySelector('.app-header'));
    let painted = 0;
    let count = '(no header)';
    let status = '(no header)';
    if (booted) {
      await page.selectOption('.app-header select', '/pdfjs-dist/').catch(() => undefined);
      await page.fill('.app-url input[type=url]', new URL(`/fixtures/${fixture}`, base).href);
      await page.press('.app-url input[type=url]', 'Enter');
      await page.waitForTimeout(25_000);
      const seen = await page.evaluate(() => ({
        count: document.querySelector('.pjsr-page-count')?.textContent?.trim() ?? '(none)',
        painted: Array.from(document.querySelectorAll('.pjsr-page-canvas')).filter((c) => c.width > 10).length,
        // `.pjsr-status` is the element the shell renders a load failure into (`ViewerParts.tsx`, `role="alert"`);
        // reading only `.pjsr-error` reported "(none)" while the page was showing "Failed to load PDF: URL.parse
        // is not a function", which is the harness describing the page it stood in rather than the page.
        status:
          [...document.querySelectorAll('.pjsr-status, .pjsr-error, .pjsr-empty')]
            .map((e) => e.textContent?.trim())
            .filter(Boolean)
            .join(' / ')
            .slice(0, 200) || '(none)',
      }));
      painted = seen.painted;
      count = seen.count;
      status = seen.status;
    }
    const below = Number.isFinite(started) && started < floor;
    entry.started = started;
    entry.caps = caps;
    entry.booted = booted;
    entry.painted = painted;
    entry.thrown = thrown.slice(0, 2);
    entry.outcome = painted > 0 ? 'renders' : below ? 'below the floor it claims' : 'does not render';
    entry.detail =
      `chrome/firefox version that started: ${started}; header ${booted ? 'mounted' : 'NEVER MOUNTED'}; ` +
      `page count "${count}"; ${painted} painted canvas(es); status "${status}"; ` +
      `Iterator=${caps.Iterator}, URL.parse=${caps['URL.parse']}, Promise.try=${caps['Promise.try']}` +
      (thrown.length ? `; threw: ${thrown[0].slice(0, 90)}` : '');
    console.log(`${engine.padEnd(9)} floor ${String(floor).padEnd(5)} ${entry.outcome.toUpperCase().padEnd(26)} ${entry.detail}`);
  } catch (error) {
    entry.outcome = 'probe threw';
    entry.detail = String(error.message ?? error).split('\n')[0].slice(0, 160);
    console.log(`${engine.padEnd(9)} floor ${String(floor).padEnd(5)} PROBE THREW            ${entry.detail}`);
  } finally {
    await browser?.close();
  }
}

const bad = report.filter((r) => r.outcome !== 'renders');
writeFileSync(flag('json', '.spike/browser-floors.json'), `${JSON.stringify(report, null, 2)}\n`);
await server.close();

if (bad.length) {
  console.log(
    `\n${bad.length} of ${report.length} §8 floor environments did not render ${fixture}. This is not a harness complaint: ` +
      'each line above names the version that started, what it lacked, and what the page said. Where the missing ' +
      'member is one the engine itself calls — `URL.parse`, `Promise.try`, the `Iterator` global — the floor the ' +
      'table names is below the floor the dependency requires, and §8 has to answer for that, not a workaround here.',
  );
  process.exit(1);
}
console.log(`\nall ${report.length} §8 floor environments rendered ${fixture}.`);
