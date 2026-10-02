/**
 * FR-49: the §6 benchmark profiles, measured against their fixtures and reported.
 *
 * `PRD.md` §6 draws the line this script obeys: "A target is not a measurement… A maximum observed on one
 * device does not become a promise that a slower reader's machine will break." So every line is one of two
 * kinds, and the distinction is the point of the file:
 *
 *  - **bar** — a structural property that holds on any machine, so it fails the run when it does not: the
 *    canvas count stays bounded, live pixel budget does not grow with scroll depth, the render caps bind
 *    where they are supposed to and degrade resolution rather than painting a blank page.
 *  - **measure** — a timing, printed with the machine it came from and never failed on: document open, cold
 *    page, frame gaps, longest main-thread task. Headless Chromium has no vsync to hit, so "60 FPS" is not
 *    a thing this can honestly assert; the longest long task is, and it is the half a reader feels.
 *
 * A bar that cannot fail is not a bar, and cannot be wrong is not much either. Three of these went through
 * a version that did not measure what it said: the zoom test at 400 % on a dpr-1 desktop left the canvas at
 * 3.45 MP against a 33.6 MP ceiling, so "the cap held" described a run where no cap engaged — it is now run
 * at dpr 2 and 500 %, where the ceiling that applies is the screen-relative one and it bites; counting
 * canvases that had left the DOM but kept their buffer measured nothing, because a removed element is not
 * in `document` to be queried; and comparing the live *pixel* budget between the first and last third of a
 * scroll failed on profile A for a reason that was not a leak, because its pages have three different page
 * boxes — the count of held canvases is the box-independent shape of the claim, and that is what is asserted
 * now.
 *
 * Profiles come from §6's table: A is text-heavy (`long-sample.pdf`, 1,000 pages), B is image-heavy
 * (`scan-sample.pdf`, twelve 8.4-megapixel scans). C (vector-heavy) and D (low-memory device) have no
 * fixture, and the report says so rather than reporting nothing about them.
 *
 * It needs a browser, so it is its own command — `npm run bench`, a step in CI's `browser` job — and not
 * part of `npm run verify`.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import { chromium } from 'playwright';

const repo = join(dirname(fileURLToPath(import.meta.url)), '..');

/**
 * The caps, read out of `src/lib/canvas.ts` rather than copied: a benchmark that hard-codes the ceiling it
 * checks against would pass the day someone lowers it, which is the one day it matters.
 */
function readCaps() {
  const source = readFileSync(join(repo, 'src', 'lib', 'canvas.ts'), 'utf8');
  const literal = (name) => {
    const raw = new RegExp(`export const ${name} = ([^;]+);`).exec(source)?.[1]?.trim();
    if (!raw) throw new Error(`${name} is no longer a simple constant in src/lib/canvas.ts`);
    const power = /^(\d+) \*\* (\d+)$/.exec(raw);
    if (power) return Number(power[1]) ** Number(power[2]);
    if (!/^[\d_]+$/.test(raw)) throw new Error(`cannot read the value of ${name} from "${raw}"`);
    return Number(raw.replace(/_/g, ''));
  };
  return {
    maxPixels: literal('MAX_RENDER_PIXELS'),
    maxSide: literal('MAX_RENDER_SIDE'),
    capAreaFactor: literal('CAP_AREA_FACTOR'),
  };
}

const PROFILES = [
  {
    id: 'A',
    name: 'text-heavy',
    fixture: 'long-sample.pdf',
    pages: 1000,
    coldPage: 500,
    steps: 40,
    stepMs: 120,
    target: 'cold page under 100 ms; no frame over 16.7 ms; bounded canvas count',
  },
  {
    id: 'B',
    name: 'image-heavy / scanned',
    fixture: 'scan-sample.pdf',
    pages: 12,
    coldPage: 12,
    steps: 11,
    stepMs: 300,
    target: '60 FPS scrolling; strict release of off-screen buffers; the area and side caps hold without a blank page',
  },
  { id: 'C', name: 'vector-heavy', target: 'cold page under 120 ms; no main-thread block over 200 ms' },
  { id: 'D', name: 'low-memory device', target: 'no exhaustion crash; degraded resolution rather than a dead tab' },
];

const caps = readCaps();

/** The canvas population the viewer is holding at one moment during a scroll. */
const SNAPSHOT = () => {
  const live = [...document.querySelectorAll('.pjsr-page-canvas')].filter((c) => c.isConnected);
  return {
    mounted: live.length,
    slots: document.querySelectorAll('.pjsr-page-slot').length,
    devicePixels: live.reduce((sum, c) => sum + c.width * c.height, 0),
    widest: live.reduce((max, c) => Math.max(max, c.width, c.height), 0),
  };
};

/** Non-white pixel fraction over the whole of the first live canvas. */
const INK = () => {
  const source = document.querySelector('.pjsr-page-canvas');
  if (!source || !source.width) return 0;
  const scratch = document.createElement('canvas');
  scratch.width = 240;
  scratch.height = 240;
  const ctx = scratch.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(source, 0, 0, 240, 240);
  const { data } = ctx.getImageData(0, 0, 240, 240);
  let marks = 0;
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] < 8) continue;
    if (Math.abs(255 - data[i]) + Math.abs(255 - data[i + 1]) + Math.abs(255 - data[i + 2]) > 60) marks += 1;
  }
  return marks / (240 * 240);
};

const bar = (label, ok, detail) => ({ kind: 'bar', ok, label, detail });
const measure = (label, detail) => ({ kind: 'measure', label, detail });
const note = (label, detail) => ({ kind: 'note', label, detail });

const pct = (sorted, q) => (sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))] : 0);
const MP = (pixels) => `${(pixels / 1e6).toFixed(1)} MP`;

/** Arm the frame-gap recorder and the long-task observer before any work happens. */
async function arm(page) {
  await page.evaluate(() => {
    window.__longest = 0;
    window.__frames = [];
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) window.__longest = Math.max(window.__longest, entry.duration);
      // `longtask` is buffered, so a task during the first paint is still seen — which is the one worth knowing about.
    }).observe({ type: 'longtask', buffered: true });
    let last = performance.now();
    const tick = (now) => {
      window.__frames.push(now - last);
      last = now;
      if (window.__frames.length < 900) requestAnimationFrame(tick);
    };
    requestAnimationFrame((now) => {
      last = now;
      requestAnimationFrame(tick);
    });
  });
}

async function openDocument(page, baseUrl, fixture) {
  await page.route(/raw\.githubusercontent\.com|unpkg\.com/, (route) => route.abort());
  await page.goto(baseUrl, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.app-header');
  await page.selectOption('.app-header select', '/pdfjs-dist/');
  await arm(page);
  const started = Date.now();
  await page.fill('.app-url input[type=url]', new URL(`/fixtures/${fixture}`, baseUrl).href);
  await page.press('.app-url input[type=url]', 'Enter');
  await page.waitForSelector('.pjsr-page-canvas');
  const ink = await waitForInk(page);
  return { openMs: Date.now() - started, ink };
}

async function waitForInk(page, timeout = 30_000) {
  const deadline = Date.now() + timeout;
  for (;;) {
    const ink = await page.evaluate(INK);
    if (ink > 0) return ink;
    if (Date.now() > deadline) return ink;
    await page.waitForTimeout(100);
  }
}

async function jumpTo(page, pageNumber) {
  const field = page.locator('.pjsr-toolbar .pjsr-page-input:visible').first();
  await field.fill(String(pageNumber));
  await field.press('Enter');
}

/**
 * The scroll sweep, sampled at every step: the bars that belong to a document being moved through.
 */
function sweepBars(samples, profile) {
  const peak = (key) => Math.max(...samples.map((s) => s[key]));
  const blank = samples.filter((s) => s.mounted === 0).length;
  // Early against late, counted rather than measured in pixels. A first draft compared the live *pixel*
  // budget across the two ends of the scroll and failed on profile A for a reason that was not a leak: its
  // pages have three different boxes, so the later third simply had larger canvases on it. The number of
  // canvases still held is the box-independent shape of "released", and it is the one that would grow if
  // off-screen pages kept their buffers.
  const third = Math.max(1, Math.floor(samples.length / 3));
  const early = Math.max(...samples.slice(0, third).map((s) => s.mounted));
  const late = Math.max(...samples.slice(-third).map((s) => s.mounted));
  return [
    bar(
      'canvas count stays bounded',
      peak('mounted') <= 24 && peak('slots') <= 40,
      `peak ${peak('mounted')} canvases and ${peak('slots')} slots over ${samples.length} steps across ${profile.pages} pages`,
    ),
    bar(
      'off-screen canvases are not kept',
      late <= early + 1,
      `${early} canvases held at the peak of the first third and ${late} at the peak of the last, whose canvases covered ${MP(peak('devicePixels'))} in total`,
    ),
    bar('no blank page during the scroll', blank === 0, `${blank} of ${samples.length} samples had nothing mounted`),
    bar(
      'no canvas exceeds the area cap',
      peak('devicePixels') <= caps.maxPixels,
      `largest single canvas ${MP(peak('devicePixels'))} against the ${MP(caps.maxPixels)} absolute ceiling`,
    ),
    bar('no canvas exceeds the side cap', peak('widest') <= caps.maxSide, `widest side ${peak('widest')} px against ${caps.maxSide}`),
  ];
}

/**
 * The cap under load: dpr 2 and the top of the zoom ladder, where a letter page would want 48.5 MP and the
 * ceiling says 33.6. What is being proved is the *shape* of the answer — resolution comes down, the page
 * does not go blank — so a run where the cap never engaged has to be labelled as one.
 */
async function cappedZoom(browser, baseUrl, profile) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, deviceScaleFactor: 2 });
  const page = await context.newPage();
  page.setDefaultTimeout(60_000);
  await openDocument(page, baseUrl, profile.fixture);
  const field = page.locator('.pjsr-toolbar .pjsr-zoom-input:visible').first();
  if ((await field.count()) === 0) {
    await context.close();
    return [note('at dpr 2 / 500 %', 'the custom-zoom field was not reachable, so the cap was not tested under load')];
  }
  await field.fill('500');
  await field.press('Enter');
  await page.waitForTimeout(3_000);
  const at = await page.evaluate(() => {
    const live = [...document.querySelectorAll('.pjsr-page-canvas')].filter((c) => c.isConnected);
    const first = live[0];
    let ink = 0;
    if (first) {
      const s = document.createElement('canvas');
      s.width = 240;
      s.height = 240;
      const g = s.getContext('2d', { willReadFrequently: true });
      g.drawImage(first, 0, 0, 240, 240);
      const d = g.getImageData(0, 0, 240, 240).data;
      let marks = 0;
      for (let i = 0; i < d.length; i += 4) {
        if (Math.abs(255 - d[i]) + Math.abs(255 - d[i + 1]) + Math.abs(255 - d[i + 2]) > 60) marks += 1;
      }
      ink = marks / (240 * 240);
    }
    const box = first ? first.getBoundingClientRect() : null;
    return {
      mounted: live.length,
      dpr: devicePixelRatio,
      area: Math.max(0, ...live.map((c) => c.width * c.height)),
      widest: Math.max(0, ...live.flatMap((c) => [c.width, c.height])),
      cssArea: box ? box.width * box.height : 0,
      screen: { w: screen.availWidth, h: screen.availHeight },
      ink,
    };
  });
  await context.close();
  if (at.mounted === 0) return [bar('at dpr 2 / 500 %', false, 'nothing stayed mounted under the zoom')];
  // The ceiling that applies is the smaller of the absolute one and the screen-relative one
  // (`maxRenderPixelsFor`): three times the display's own device pixels. On a 1280×900 screen at dpr 2 that
  // is 13.8 MP, so it is the screen-relative cap that bites here — which is the more interesting result,
  // and the one a copied constant would have missed.
  const screenCeiling = Math.ceil(at.screen.w * at.screen.h * at.dpr ** 2 * (1 + caps.capAreaFactor / 100));
  const ceiling = Math.min(caps.maxPixels, screenCeiling);
  const effective = at.cssArea > 0 ? Math.sqrt(at.area / at.cssArea) : 0;
  const bound = at.area >= ceiling * 0.98;
  return [
    bar(
      'at dpr 2 / 500 % the cap bites and the page survives',
      at.area <= ceiling * 1.02 && at.ink > 0 && bound && effective < at.dpr - 0.05,
      `largest canvas ${MP(at.area)} against the ${MP(ceiling)} ceiling that applies here (${MP(caps.maxPixels)} absolute, ${MP(screenCeiling)} at ${at.screen.w}×${at.screen.h} dpr ${at.dpr} × 1+${caps.capAreaFactor}%) — ${bound ? 'clamped' : 'never reached, so the cap was not tested'}; rendered at ${effective.toFixed(2)}× instead of ${at.dpr}×, ${(at.ink * 100).toFixed(2)} % ink, side ${at.widest} px`,
    ),
  ];
}

async function runProfile(browser, profile, baseUrl) {
  if (!profile.fixture) {
    return [note('fixture', `profile ${profile.id} has no committed fixture — nothing is measured for it`)];
  }
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();
  page.setDefaultTimeout(60_000);
  const opened = await openDocument(page, baseUrl, profile.fixture);
  const lines = [
    measure(
      'document open to first ink',
      `${opened.openMs} ms, ${(opened.ink * 100).toFixed(2)} % ink (dev-server transforms included; §6's cold-page bar is about a page, measured next)`,
    ),
  ];

  // A cold page: the document is already open, and this one has never been rendered.
  const coldStart = Date.now();
  await jumpTo(page, profile.coldPage);
  const coldInk = await waitForInk(page);
  lines.push(
    measure(
      'cold page',
      `${Date.now() - coldStart} ms to ink on page ${profile.coldPage} (${(coldInk * 100).toFixed(2)} % ink)${
        profile.id === 'A' ? ', against §6\u2019s bar of under 100 ms' : '; §6 sets no cold-page bar for this profile'
      }`,
    ),
  );

  const samples = [];
  for (let step = 0; step < profile.steps; step += 1) {
    await page.evaluate(() => {
      const el = document.querySelector('.pjsr-viewport');
      el.scrollTop += el.clientHeight;
    });
    await page.waitForTimeout(profile.stepMs);
    samples.push(await page.evaluate(SNAPSHOT));
  }
  lines.push(...sweepBars(samples, profile));

  const t = await page.evaluate(() => ({ longTaskMs: window.__longest ?? 0, frames: [...(window.__frames ?? [])] }));
  const gaps = t.frames.filter((f) => f > 0);
  lines.push(
    measure(
      'frame gaps / main thread',
      `p50 ${pct(gaps, 0.5).toFixed(1)} ms, p95 ${pct(gaps, 0.95).toFixed(1)} ms, max ${pct(gaps, 1).toFixed(1)} ms over ${gaps.length} frames; longest long task ${t.longTaskMs.toFixed(0)} ms. Headless has no vsync, so no frame rate is claimed.`,
    ),
  );

  await context.close();
  return [...lines, ...(await cappedZoom(browser, baseUrl, profile))];
}

const server = await createServer({
  root: join(repo, 'playground'),
  configFile: join(repo, 'playground', 'vite.config.ts'),
  server: { port: 5300, host: '127.0.0.1' },
  logLevel: 'warn',
});
await server.listen();
const baseUrl = server.resolvedUrls?.local[0] ?? 'http://127.0.0.1:5300/';
const engine = JSON.parse(readFileSync(join(repo, 'node_modules/pdfjs-dist/package.json'), 'utf8')).version;
console.log(`benchmark against ${baseUrl} — pdfjs-dist ${engine}, caps ${MP(caps.maxPixels)} area / ${caps.maxSide} px side`);

const browser = await chromium.launch({ headless: true });
const results = [];
for (const profile of PROFILES) {
  console.log(`\nprofile ${profile.id} — ${profile.name}${profile.fixture ? ` (${profile.fixture})` : ''}`);
  console.log(`  §6 target: ${profile.target}`);
  let lines;
  try {
    lines = await runProfile(browser, profile, baseUrl);
  } catch (error) {
    lines = [bar('profile ran', false, String(error?.message ?? error).split('\n')[0])];
  }
  results.push({ profile: profile.id, lines });
  for (const line of lines) {
    const mark = line.kind === 'bar' ? (line.ok ? '  bar  ok  ' : '  BAR FAIL  ') : line.kind === 'measure' ? '  meas.    ' : '  note     ';
    console.log(`  ${mark}${line.label.padEnd(56)}${line.detail}`);
  }
}
await browser.close();
await server.close();

const bars = results.flatMap((r) => r.lines.filter((l) => l.kind === 'bar'));
const broke = bars.filter((l) => !l.ok);
console.log(
  `\n${bars.length} bars, ${bars.length - broke.length} held, ${broke.length} broke; ` +
    `${results.flatMap((r) => r.lines.filter((l) => l.kind === 'measure')).length} timings recorded as baselines.`,
);
console.log(`Machine: ${process.platform} ${process.arch}, node ${process.version}. A baseline is not a target (PRD §6).`);

mkdirSync(join(repo, '.spike'), { recursive: true });
writeFileSync(
  join(repo, '.spike', 'benchmark.json'),
  JSON.stringify({ engine, caps, ranAt: new Date().toISOString(), results }, null, 1),
);
console.log('wrote .spike/benchmark.json');
process.exit(broke.length ? 1 : 0);
