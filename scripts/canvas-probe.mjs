/**
 * FR-57 / PRD §6.1 "Detection, not labels" — the probe against a real engine.
 *
 * The unit tests hand `probeCanvasCeiling` a fake allocator with a known ceiling. That proves the search
 * finds the largest surface the allocator accepts; it cannot prove the four things only a browser can:
 * that a real Chromium answers through the same code with a real number, that the number it answers with
 * is the ceiling already in force rather than a runaway allocation, that a mobile-class user agent lowers
 * where the search starts *and* what it finds, and where the shell's own probe sits in the page's timeline
 * — which is what "runs off the render path and never delays a first paint" has to mean in a browser.
 *
 * It imports the module under test from the dev server (`/@fs/…`), not a copy, so the code measured here
 * is the code the shell runs. Needs Playwright's Chromium; the other two engines are left to
 * `scripts/browser-matrix.mjs`, which asks different questions of them.
 *
 * Run with `npm run probe:canvas`. It prints three measurement runs plus the shell's own page and a verdict
 * per clause, and exits non-zero when a verdict fails, so a green run is evidence rather than an anecdote.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import { chromium } from 'playwright';

const repo = join(dirname(fileURLToPath(import.meta.url)), '..');
const engineVersion = JSON.parse(
  readFileSync(join(repo, 'node_modules', 'pdfjs-dist', 'package.json'), 'utf8'),
).version;

// Vite serves a file outside the playground root at `/@fs/` plus its absolute path — with the leading
// slash kept on POSIX and a drive letter kept whole on Windows, which is why the two forms are built apart.
const modulePath = join(repo, 'src', 'lib', 'canvas.ts').replace(/\\/g, '/');
const SOURCE = modulePath.startsWith('/') ? `/@fs${modulePath}` : `/@fs/${modulePath}`;

/**
 * Tags every canvas the page obtains a 2D context on with the frame it happened in.
 *
 * Installed at document start, before any module runs, because §6.1's clause is a timing question — "runs
 * off the render path and never delays a first paint" — and a timestamp alone cannot answer it: measured
 * here the playground paints at ~280 ms and the shell's first surface lands ~3 ms later, so the ordering
 * has to be read off the allocation itself. Tagging each surface with its frame is also the only way to
 * see the thing that was wrong the first time this ran: the ladder allocated all of its rungs inside one
 * frame, and a page that had not painted yet would have sat behind them. The promise the code makes now —
 * and that `src/lib/canvas.probe.test.ts` holds it to in jsdom — is one surface per frame from the second
 * onward. The probe's own surfaces are the unclassed ones; every canvas the viewer paints carries a class.
 */
const ALLOCATION_HOOK = () => {
  const state = { frame: 0, entries: [] };
  const countFrames = () => {
    state.frame += 1;
    requestAnimationFrame(countFrames);
  };
  requestAnimationFrame(countFrames);
  const original = HTMLCanvasElement.prototype.getContext;
  HTMLCanvasElement.prototype.getContext = function getContext(type, ...rest) {
    state.entries.push({
      frame: state.frame,
      ms: Math.round(performance.now()),
      side: this.width,
      area: this.width * this.height,
      cls: this.className || '',
    });
    return original.call(this, type, ...rest);
  };
  window.__pjsrAllocations = state;
};

/**
 * Each run is its own context so the realm cache the probe writes cannot carry a previous answer into it,
 * and `evaluateOptions` reaches the probe the way the shell's own options would.
 */
async function runIn(label, contextOptions = {}, evaluateOptions = {}) {
  const browser = await chromium.launch();
  const context = await browser.newContext({
    viewport: { width: 1280, height: 800 },
    ...(contextOptions.userAgent ? { userAgent: contextOptions.userAgent } : null),
    ...(contextOptions.viewport ? { viewport: contextOptions.viewport } : null),
    ...(contextOptions.deviceScaleFactor ? { deviceScaleFactor: contextOptions.deviceScaleFactor } : null),
  });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(String(error).slice(0, 160)));
  await page.addInitScript(ALLOCATION_HOOK);
  await page.goto(baseUrl, { waitUntil: 'load' });
  const result = await page.evaluate(
    async ({ source, options }) => {
      const mod = await import(/* @vite-ignore */ source);
      const env = mod.readCanvasEnvironment();
      // What the shell passes: the ceiling already in force, not the class default.
      const limit = mod.maxRenderPixelsFor(env);
      // Let the page paint before this script asks for anything. Measured here: a probe started during
      // startup pushed the page's first paint from ~270 ms to ~2 s, and a harness that changes the thing
      // it is measuring is not evidence about that thing.
      while (performance.getEntriesByType('paint').length === 0 && performance.now() < 20_000) {
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      const started = performance.now();
      const first = await mod.probeCanvasCeiling({ limit, ...options });
      const firstMs = performance.now() - started;
      // A second run, to tell the probe's own cost from the one-time cost of the page's first big canvas
      // (headless Chromium pays roughly two seconds for that, whoever asks for it).
      const again = performance.now();
      await mod.probeCanvasCeiling({ limit, ...options });
      const secondMs = performance.now() - again;
      // Now ask whether the *shell* measured anything. Only `ensureCanvasCeiling` writes the realm cache —
      // the search this script just ran twice does not touch it — so a value here is the shell's own
      // `useCanvasCeiling` effect answering on a page nobody prodded. Polled, because it starts on mount
      // and costs the cold-canvas time above.
      const waited = performance.now();
      while (mod.probedCanvasCeiling() === null && performance.now() - waited < 8000) {
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      return {
        ua: env.userAgent.slice(0, 46),
        platform: env.platform,
        screen: [env.screenWidth, env.screenHeight],
        devicePixelRatio: env.devicePixelRatio,
        touch: env.maxTouchPoints,
        mobile: mod.isMobileCanvasEnvironment(env),
        default: mod.defaultRenderPixelsFor(env),
        limit,
        ceiling: first,
        firstMs: Math.round(firstMs),
        secondMs: Math.round(secondMs),
        probeStartedAt: Math.round(started),
        shellCeiling: mod.probedCanvasCeiling(),
        shellWaitMs: Math.round(performance.now() - waited),
        firstPaint: performance.getEntriesByType('paint').map((p) => [p.name, Math.round(p.startTime)]),
      };
    },
    { source: SOURCE, options: evaluateOptions },
  );
  console.log(`\n### ${label}`);
  for (const [key, value] of Object.entries(result)) {
    console.log(
      `  ${key}: ${typeof value === 'number' ? value.toLocaleString('en-US') : JSON.stringify(value)}`,
    );
  }
  if (errors.length) console.log(`  pageerrors: ${errors.join(' | ')}`);
  await browser.close();
  return { ...result, label, pageerrors: errors };
}

const server = await createServer({
  root: join(repo, 'playground'),
  configFile: join(repo, 'playground', 'vite.config.ts'),
  server: { port: 5298, host: '127.0.0.1' },
  logLevel: 'warn',
});
await server.listen();
const baseUrl = server.resolvedUrls?.local[0] ?? 'http://127.0.0.1:5298/';
console.log(`playground served from ${baseUrl} (pdfjs-dist ${engineVersion}, source at ${SOURCE})`);

/**
 * A context where nothing but the shell probes, so every allocation the hook records is the shell's.
 *
 * The three measurement runs above call `probeCanvasCeiling` themselves, which would mix their allocations
 * into this timeline; the clause under test here is about the wiring, so it gets a page nobody prodded.
 */
async function runShell() {
  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await context.newPage();
  await page.addInitScript(ALLOCATION_HOOK);
  await page.goto(baseUrl, { waitUntil: 'load' });
  const result = await page.evaluate(async (source) => {
    const mod = await import(/* @vite-ignore */ source);
    const limit = mod.maxRenderPixelsFor(mod.readCanvasEnvironment());
    const waited = performance.now();
    while (mod.probedCanvasCeiling() === null && performance.now() - waited < 20_000) {
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    const rungs = window.__pjsrAllocations.entries.filter((e) => !e.cls && e.area >= 1_000_000);
    return {
      limit,
      shellCeiling: mod.probedCanvasCeiling(),
      waitedMs: Math.round(performance.now() - waited),
      rungs,
      firstPaint: performance.getEntriesByType('paint').map((p) => [p.name, Math.round(p.startTime)]),
    };
  }, SOURCE);
  await browser.close();
  return result;
}

const desktop = await runIn('Chromium desktop, 1280×800 @1×', {});
const tablet = await runIn(
  'Chromium with an iPadOS user agent on a 390×844 @3× screen (the mobile default binds, not the working set)',
  {
    userAgent:
      'Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 3,
  },
);
const capped = await runIn(
  'Chromium desktop with the limit forced to 1,048,576 px (what a host budget does to the search)',
  {},
  { limit: 1_048_576 },
);

const shell = await runShell();

await server.close();

console.log('\n### the shell on its own page');
console.log(`  ceiling in force: ${shell.limit.toLocaleString('en-US')}`);
console.log(`  answered: ${shell.shellCeiling}, after ${shell.waitedMs} ms of waiting`);
console.log(`  first paint entries: ${JSON.stringify(shell.firstPaint)}`);
for (const rung of shell.rungs) {
  console.log(
    `  rung  frame ${String(rung.frame).padStart(3)}  ${rung.side}×${rung.side} = ${rung.area.toLocaleString('en-US')} px  at ${rung.ms} ms`,
  );
}

const shellPainted = shell.firstPaint.length ? Math.max(...shell.firstPaint.map(([, t]) => t)) : 0;
const rungGaps = shell.rungs.slice(1).map((rung, i) => rung.frame - shell.rungs[i].frame);
const framesUsed = new Set(shell.rungs.map((rung) => rung.frame)).size;

const CHECKS = [
  {
    name: 'the probe answers with the ceiling in force (desktop)',
    ok: desktop.ceiling === desktop.limit && Number.isFinite(desktop.ceiling),
    value: `limit ${desktop.limit.toLocaleString('en-US')}, answered ${desktop.ceiling.toLocaleString('en-US')}`,
  },
  {
    name: 'a mobile user agent lowers the start and the answer follows it',
    ok: tablet.mobile === true && tablet.limit === 5_242_880 && tablet.ceiling === 5_242_880,
    value: `default ${tablet.default.toLocaleString('en-US')}, limit ${tablet.limit.toLocaleString('en-US')}, answered ${tablet.ceiling.toLocaleString('en-US')}`,
  },
  {
    name: 'the probe never answers above its limit',
    ok: capped.ceiling <= 1_048_576 && capped.ceiling > 0,
    value: capped.ceiling.toLocaleString('en-US'),
  },
  {
    name: 'the shell probes on its own, without being asked',
    ok: shell.shellCeiling === shell.limit && shell.waitedMs < 20_000,
    value: `${shell.shellCeiling} after ${shell.waitedMs} ms`,
  },
  {
    name: 'the shell waits for frames before its first surface',
    ok: shell.rungs.length > 1 && shell.rungs[0].frame >= 2,
    value: `frame ${shell.rungs[0]?.frame} at ${shell.rungs[0]?.ms} ms (first paint ${shellPainted} ms)`,
  },
  {
    name: 'the first surface is allocated after the page has painted',
    ok: shell.rungs.length > 0 && shell.firstPaint.length > 0 && shell.rungs[0].ms > shellPainted,
    value: `first surface ${shell.rungs[0]?.ms} ms, first paint ${shellPainted} ms`,
  },
  {
    name: 'one surface per frame, from the second onward',
    ok: shell.rungs.length > 1 && framesUsed === shell.rungs.length && rungGaps.every((gap) => gap >= 2),
    value: `${shell.rungs.length} surfaces across ${framesUsed} frames (gaps ${JSON.stringify(rungGaps)})`,
  },
  {
    name: 'no rung allocates beyond the ceiling in force',
    ok: shell.rungs.every((rung) => rung.area <= shell.limit),
    value: `largest rung ${Math.max(...shell.rungs.map((r) => r.area)).toLocaleString('en-US')} of ${shell.limit.toLocaleString('en-US')}`,
  },
  {
    name: 'a host-tightened search does not lower what the realm already measured',
    ok:
      capped.shellCeiling === capped.limit &&
      capped.ceiling < capped.shellCeiling &&
      tablet.shellCeiling === tablet.limit,
    value: `search answered ${capped.ceiling.toLocaleString('en-US')}, realm still holds ${capped.shellCeiling}; mobile realm ${tablet.shellCeiling}`,
  },
  {
    name: 'the search completes rather than running away',
    ok: desktop.firstMs < 2000 && desktop.secondMs < 2000,
    value: `${desktop.firstMs} ms, then ${desktop.secondMs} ms`,
  },
  {
    name: 'no pageerror during the probe',
    ok: desktop.pageerrors.length === 0 && tablet.pageerrors.length === 0 && capped.pageerrors.length === 0,
    value: [...desktop.pageerrors, ...tablet.pageerrors, ...capped.pageerrors],
  },
];

console.log('\nverdicts');
let failed = 0;
for (const check of CHECKS) {
  if (!check.ok) failed += 1;
  console.log(`  ${check.ok ? 'ok  ' : 'FAIL'}  ${check.name}  (${JSON.stringify(check.value)})`);
}
console.log(
  `\n${CHECKS.length - failed}/${CHECKS.length} verdicts ok on Chromium with pdfjs-dist ${engineVersion}.`,
);
process.exit(failed === 0 ? 0 : 1);
