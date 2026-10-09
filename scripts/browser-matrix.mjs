/**
 * FR-48: PRD §8's browser rows, run rather than asserted.
 *
 * Every other check in this repository asks a DOM question of jsdom, and jsdom is one engine that
 * rasterises no canvas, knows no `devicePixelRatio`, dispatches no touch, ignores `forced-colors` and
 * arbitrate no wheel — which is to say it cannot answer the questions the compatibility table actually
 * asks. This script asks them in three engines over two viewport profiles against the playground served
 * from source, with the engine's support assets (cMaps, standard fonts, wasm) served by
 * `playground/vite.config.ts` from `node_modules/pdfjs-dist`, so a request that leaves the machine is a
 * finding rather than an accident of the network.
 *
 * What is deliberately *not* claimed:
 *  - **This is emulation, not hardware.** PRD §8 lists a real-device pass separately because the two are
 *    not the same evidence, and nothing here reproduces a bug that only lives on a phone.
 *  - **The pinch is a synthetic `TouchEvent` sequence.** It proves that our `TouchManager` wiring and our
 *    `onPinching`/`onPanning` split respond to a two-finger span changing; it does not prove anything about
 *    a digitizer, and the report says `synthetic` on every line that uses one.
 *  - **A capability an engine cannot be shown is reported `skip`, never `ok`.** WebKit and Firefox differ
 *    on media emulation and on mobile context flags; pretending otherwise would turn a gap into a green
 *    row, which is the failure mode this whole file exists to avoid.
 *  - **The engine reported is the engine the browser ran.** Measuring a peer floor means replacing
 *    `node_modules/pdfjs-dist` under a running toolchain, and Vite's dependency cache is keyed on the
 *    lockfile rather than on the package's contents — so the page can be served the *previous* release while
 *    this file prints the new one. `prebundleMismatch()` refuses that arrangement before a browser starts,
 *    because 22 document loads timing out against the wrong bundle look exactly like a viewer defect.
 *  - It says nothing about Edge (its own per-release pass), about the `pdfjs-dist` version spread (the
 *    `consumer` job's engine matrix), or about React majors (the `react` job).
 */
import { readFileSync, mkdirSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createServer } from 'vite';

/*
 * §8's browser-floor policy says a floor claim must be backed by "a pinned browser image, container, Playwright
 * browser build … or equivalent reproducible environment", and that "a current browser passing the suite does not
 * certify an old-version floor". The browser a Playwright release drives is fixed by that release, so running a
 * floor means running a *different Playwright* than this repository's own — and installing it over `node_modules`
 * would turn the cell into a reading of a tree nobody ships, which is what #244 was written to stop. The driver is
 * therefore resolved from `PJSR_PLAYWRIGHT` (a package directory) when a job names one, and the run prints the
 * release it loaded: a floor claim that does not say what drove it is the claim §8 refuses to accept.
 */
const repoDir = join(dirname(fileURLToPath(import.meta.url)), '..');
const driverDir = process.env.PJSR_PLAYWRIGHT
  ? resolve(process.env.PJSR_PLAYWRIGHT)
  : join(repoDir, 'node_modules', 'playwright');
// `index.mjs` is the package's ESM surface; older releases ship only `index.js`, whose named exports Node
// re-derives from the CommonJS module — both are the same driver, and the floor build is what is under test.
const driverEntry = existsSync(join(driverDir, 'index.mjs')) ? 'index.mjs' : 'index.js';
const { chromium, firefox, webkit } = await import(pathToFileURL(join(driverDir, driverEntry)).href);
const driverVersion = JSON.parse(readFileSync(join(driverDir, 'package.json'), 'utf8')).version;

const repo = repoDir;
const engineVersion = JSON.parse(
  readFileSync(join(repo, 'node_modules', 'pdfjs-dist', 'package.json'), 'utf8'),
).version;

const args = process.argv.slice(2);
/**
 * Read `--flag value` or `--flag=value`.
 *
 * The `=` form is accepted because it is what everyone types; the old parser silently ignored
 * `--engines=webkit` and ran the whole matrix instead, which is a surprising way to spend eleven minutes.
 */
const value = (flag, fallback) => {
  const inline = args.find((arg) => arg.startsWith(`${flag}=`));
  if (inline !== undefined) return inline.slice(flag.length + 1);
  const at = args.indexOf(flag);
  return at === -1 || at + 1 >= args.length ? fallback : args[at + 1];
};
const KNOWN_FLAGS = ['--engines', '--profiles', '--checks', '--no-json'];
for (const arg of args) {
  const name = arg.split('=')[0];
  if (name.startsWith('--') && !KNOWN_FLAGS.includes(name)) {
    console.error(`FAIL  unknown flag ${name}; this script runs a matrix, and a mistyped filter must not` +
      ` quietly run all of it instead. Known flags: ${KNOWN_FLAGS.join(', ')}`);
    process.exit(2);
  }
}
const ONLY_ENGINES = value('--engines', 'chromium,firefox,webkit').split(',');
const ONLY_PROFILES = value('--profiles', 'desktop,mobile').split(',');
/**
 * A name-filtered subset of the checks, for developing one row without re-running the rest of them. The count
 * is deliberately not quoted here: it lives in `PRD.md` §8, and `npm run check:docs` derives it from this array.
 *
 * The cell's own two verdicts are never filtered out, because a row that leaves an uncaught error behind it
 * has to keep telling the story: `--checks=print` narrows what runs, not what is reported.
 */
const ONLY_CHECKS = value('--checks', '')
  .split(',')
  .map((name) => name.trim())
  .filter(Boolean);

const BROWSERS = { chromium, firefox, webkit };

/**
 * The visible control bar. `Toolbar` keeps a second copy of every item in a `.pjsr-toolbar-sizer`, hidden
 * with `visibility: hidden` so it can measure widths without joining the accessibility tree or the tab
 * order. A selector that names a control without naming the bar resolves twice and Playwright's strict mode
 * calls that an error; `:visible` is what tells the real control from the measuring copy — and in the
 * overflow menu, it is also the proof the control is on screen.
 */
const BAR = '.pjsr-toolbar';
/**
 * The page-count readout. `:visible` is wrong for this one: the count is a `hideOnly` control, so a 375px
 * bar legitimately drops it rather than folding it into the menu, and the reading comes from whichever copy
 * the DOM has — the bar's or the measuring one, both rendered from the same live props.
 */
const COUNT = `${BAR} .pjsr-page-count`;

/**
 * The two shapes a §8 row is claimed for. `touch` is what we *ask* the engine for; each check that
 * depends on it reports what the engine actually answered, because on Firefox the request is ignored and
 * that is a result rather than a silent difference.
 */
const PROFILES = {
  desktop: {
    note: 'desktop 1280×900 dpr 1',
    viewport: { width: 1280, height: 900 },
    deviceScaleFactor: 1,
    touch: false,
  },
  mobile: {
    note: 'mobile 375×812 dpr 2',
    viewport: { width: 375, height: 812 },
    deviceScaleFactor: 2,
    touch: true,
  },
};

/**
 * The browser floors `PRD.md` §8 claims, as numbers this file can compare a launched engine against.
 *
 * They are the *engine's* floors, not ours: pdf.js 6.0 raised its minimum to Chrome 125 and Safari 18 and
 * made `light-dark()`, the nesting selector and `:dir()` required, and §8 lists Firefox 124 as the
 * provisional package floor. §8's own rule is that a stale WebKit "fails the engine rather than the page",
 * so the comparison is a row of its own — a run on an engine below a floor is a red row, and a run whose
 * engine cannot be identified is `na`, which is §8's "unverified, not passed".
 */
const FLOORS = { chromium: 125, firefox: 124, webkit: 18 };

/**
 * Compare the version an engine reports for itself against §8's floor for it.
 *
 * `launch.version()` is the browser's own answer, not a string this file maintains, which is the point: a
 * runner that ships an older engine than the table claims has to be caught by the table's own instrument.
 * An unparseable version is `na` — §8 treats an unverifiable row as unverified rather than letting a missing
 * number read as a pass or as a defect in the viewer.
 */
function floorVerdict(engineName, version) {
  const claimed = FLOORS[engineName];
  const major = Number(/^(\d+)/.exec(version ?? '')?.[1] ?? NaN);
  if (!Number.isFinite(claimed) || !Number.isFinite(major)) {
    return { claimed: claimed ?? null, actual: version ?? null, status: 'na' };
  }
  return { claimed, actual: version, major, status: major >= claimed ? 'ok' : 'fail' };
}

/**
 * Dotted-release comparison for the *engine* axis (#194), numeric per segment.
 *
 * The §8 floor check above compares browser majors, which are single integers; a `pdfjs-dist` release is not, and
 * `'6.10.0' < '6.2.0'` is true as a string and false as a release. Missing segments read as zero, so `6.3` is
 * below `6.3.289` — the answer a feature's declared minimum needs when the loaded engine reports less than it.
 */
function releaseAtLeast(have, want) {
  const a = String(have ?? '').split(/[.\-+]/).map((part) => Number.parseInt(part, 10) || 0);
  const b = String(want).split(/[.\-+]/).map((part) => Number.parseInt(part, 10) || 0);
  for (let i = 0; i < Math.max(a.length, b.length); i += 1) {
    const x = a[i] ?? 0;
    const y = b[i] ?? 0;
    if (x !== y) return x > y;
  }
  return true;
}

for (const [kind, chosen, known] of [
  ['--engines', ONLY_ENGINES, Object.keys(BROWSERS)],
  ['--profiles', ONLY_PROFILES, Object.keys(PROFILES)],
]) {
  // A filter that names nothing is indistinguishable from a matrix that passed, and a mistyped
  // `--engines=Cromium` would otherwise run zero cells and exit 0.
  const unknown = chosen.filter((name) => !known.includes(name));
  if (unknown.length || !chosen.length) {
    console.error(
      `FAIL  ${kind} asked for [${chosen.join(', ')}]; this script knows ${known.join(', ')}` +
        (unknown.length ? '' : ' — and an empty selection is not a pass'),
    );
    process.exit(2);
  }
}

/**
 * The §8 row each engine's floor is read from, so the table above stays a copy of the contract rather than a
 * second opinion on it. A row renamed there is a loud failure here, because a matrix that checks engines
 * against numbers nobody maintains has stopped being the evidence §8 points at.
 */
const FLOOR_ROWS = { chromium: 'Chrome / Chromium', firefox: 'Firefox', webkit: 'Safari (macOS)' };

/**
 * The minimum-version column of every §8 environment row, keyed by the row's label.
 *
 * The table's fourth column carries values like `124 provisional package floor` and `125-equivalent
 * Chromium engine`, so the leading number is the floor and the rest is its reason.
 */
function contractFloors() {
  const found = new Map();
  for (const line of readFileSync(join(repo, 'PRD.md'), 'utf8').split('\n')) {
    if (!line.startsWith('| ')) continue;
    const cells = line.split('|').map((cell) => cell.trim());
    if (cells.length < 6) continue;
    const version = /^(\d+)(?:\.\d+)*/.exec(cells[4]);
    if (version) found.set(cells[1], Number(version[1]));
  }
  return found;
}

for (const [engine, rowLabel] of Object.entries(FLOOR_ROWS)) {
  const fromTable = contractFloors().get(rowLabel);
  if (fromTable === undefined) {
    console.error(`FAIL  §8 has no "${rowLabel}" row with a version to read — FLOORS.${engine} is unchecked`);
    process.exit(2);
  }
  if (fromTable !== FLOORS[engine]) {
    console.error(
      `FAIL  FLOORS.${engine} is ${FLOORS[engine]} while §8's "${rowLabel}" row claims ${fromTable}. ` +
        'One of the two is wrong; this matrix is the evidence for that row, so it may not disagree with it.',
    );
    process.exit(2);
  }
}
console.log(
  `§8 floors read from PRD.md: ${Object.entries(FLOORS).map(([e, v]) => `${e} ${v}`).join(', ')}`,
);

/** A check's three outcomes: a measured detail, a gap in the engine, or a failure. */
const SKIP = Symbol('skip');
const skip = (reason) => ({ [SKIP]: reason });
class Failure extends Error {}
const fail = (message) => {
  throw new Failure(message);
};

// ---------------------------------------------------------------------------
// Page-side helpers, all evaluated in the browser under test.
// ---------------------------------------------------------------------------

/**
 * Ink over the whole canvas, downsampled into 300×300 before reading it back: a page is white paper with
 * marks on it, so "non-white pixel fraction" is the only paint assertion that does not depend on which
 * glyphs the fixture happens to contain.
 */
const INK = ([selector]) => {
  const source = document.querySelector(selector);
  if (!source || !source.width || !source.height) return null;
  const scratch = document.createElement('canvas');
  scratch.width = Math.min(300, source.width);
  scratch.height = Math.min(300, source.height);
  const ctx = scratch.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(source, 0, 0, scratch.width, scratch.height);
  const { data } = ctx.getImageData(0, 0, scratch.width, scratch.height);
  let marks = 0;
  const total = scratch.width * scratch.height;
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] < 8) continue;
    if (Math.abs(255 - data[i]) + Math.abs(255 - data[i + 1]) + Math.abs(255 - data[i + 2]) > 60) marks += 1;
  }
  const box = source.getBoundingClientRect();
  return {
    ratio: marks / total,
    width: source.width,
    height: source.height,
    cssWidth: Math.round(box.width),
    cssHeight: Math.round(box.height),
  };
};

/** The playground's event log holds the public callback output — newer entries first. */
const LAST_LOG = (prefix) => {
  const lines = [...document.querySelectorAll('.app-log li')].map((li) => li.textContent.trim());
  return lines.find((line) => line.startsWith(prefix)) ?? '';
};

/**
 * Count the page-change callbacks as they arrive, because the newest one cannot say how the reader got there.
 *
 * FR-05 / #259: `virtualizes-1000-pages` polled `last onPageChange "N"`. A reader that walked 733 pages one at
 * a time and a reader that moved once and then stopped both report the same line, and those are different
 * defects with different fixes — one is a slow layout sweep, the other is a scroll write that was never
 * applied. The playground's log is a bounded stack of eight strings, so the events that left the top of it are
 * gone by the time a check looks; the count has to be collected while the walk is happening.
 *
 * It records page numbers it has not seen, deduplicated by text on purpose: React keys the log rows by
 * position, so prepending one line re-keys all eight and an observer that counted added nodes would report
 * eight events for one callback. A number that repeats is therefore counted once — true of any walk that
 * never revisits a page, which is what a jump and a scroll-out are — and `largest step` between consecutive
 * recorded pages is what separates a teleport from a one-row-at-a-time walk.
 */
const START_PAGE_CHANGE_WATCH = () => {
  const list = document.querySelector('.app-log');
  if (!list) return false;
  const pages = [];
  const seen = new Set();
  const harvest = () => {
    for (const li of list.querySelectorAll('li')) {
      const match = /^onPageChange (\d+)/.exec((li.textContent ?? '').trim());
      if (match && !seen.has(match[1])) {
        seen.add(match[1]);
        pages.push(Number(match[1]));
      }
    }
  };
  harvest();
  new MutationObserver(harvest).observe(list, { childList: true, subtree: true, characterData: true });
  window.__pjsrPageChanges = pages;
  return true;
};

/**
 * The sentence the counter buys: how many page changes, over what span, and whether it crossed that span in
 * jumps or in steps.
 */
function pageChangeSummary(pages) {
  if (!pages || pages.length === 0) return 'no onPageChange event was recorded';
  if (pages.length === 1) return `1 onPageChange event (${pages[0]})`;
  let largestStep = 0;
  for (let i = 1; i < pages.length; i++) largestStep = Math.max(largestStep, Math.abs(pages[i] - pages[i - 1]));
  // The interpretation only when the figure earns it: two events one page apart is a jump and its correction,
  // two hundred of them is a reader being walked down the document.
  const shape = pages.length > 20 ? `, largest step ${largestStep} (walked, not jumped)` : `, largest step ${largestStep}`;
  return `${pages.length} onPageChange events, ${pages[0]} → ${pages[pages.length - 1]}${shape}`;
}

/**
 * The bytes a check asked the browser to save.
 *
 * `download.path()` is the file Playwright kept for it; the stream is the fallback for an engine that reports
 * the event without a temporary file. Either way the bytes are read here, in Node, and re-opened there: the
 * claim is about the file that left the page, not about a save the page said good things about.
 */
async function savedBytes(download) {
  const path = await download.path();
  if (path) return new Uint8Array(readFileSync(path));
  const stream = await download.createReadStream();
  if (!stream) {
    fail(`the download event carried neither a file path nor a stream, so its bytes cannot be read`);
  }
  const chunks = [];
  for await (const chunk of stream) chunks.push(chunk);
  return new Uint8Array(Buffer.concat(chunks));
}

/**
 * Open saved bytes with the engine and count one annotation subtype on one page.
 *
 * This is the *reopen* in FR-29's "a written mark survives a save and a reopen": `pdfjs-dist` parses the bytes
 * the save produced, and `getAnnotations()` is the record a page view would be handed. The dynamic import is
 * the `legacy` build because this half runs in Node, where the browser build says so in its own warning.
 */
async function countSubtype(bytes, pageNumber, subtype) {
  const { getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs');
  // A copy, because the engine hands `data` to the worker and the caller's view is left detached: reading
  // `bytes.length` afterwards answers 0 for a file that parsed perfectly.
  const doc = await getDocument({ data: new Uint8Array(bytes), verbosity: 0 }).promise;
  try {
    const page = await doc.getPage(pageNumber);
    const annotations = await page.getAnnotations();
    return {
      count: annotations.filter((annotation) => annotation.subtype === subtype).length,
      all: annotations.map((annotation) => annotation.subtype).join(','),
    };
  } finally {
    await doc.loadingTask.destroy();
  }
}

/**
 * One page's box at scale 1, read from the fixture in Node with the legacy engine build.
 *
 * The print row needs the PDF's own units to say what resolution a sheet was painted at: the canvas the
 * browser hands back knows its device pixels and nothing about the document, so `sheet.width / base.width` is
 * the scale, and only this side of the boundary can supply the denominator.
 */
async function basePageDims(file, pageNumber = 1) {
  const { getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const doc = await getDocument({
    data: new Uint8Array(readFileSync(join(repo, 'playground/fixtures', file))),
    verbosity: 0,
  }).promise;
  try {
    const page = await doc.getPage(pageNumber);
    const viewport = page.getViewport({ scale: 1, rotation: page.rotate % 360 });
    return { width: viewport.width, height: viewport.height, rotate: page.rotate, pages: doc.numPages };
  } finally {
    await doc.loadingTask.destroy();
  }
}

// ---------------------------------------------------------------------------
// Checks. Each takes the harness and returns a detail string, `skip(reason)` or throws.
// ---------------------------------------------------------------------------

const CHECKS = [
  {
    name: 'paints-a-page',
    run: async ({ load, page }) => {
      await load('page-order-sample.pdf', 20);
      const count = (await page.textContent(`${COUNT}`))?.trim() ?? '';
      const ink = await pollInk(page, '.pjsr-page-canvas');
      if (!ink) fail('there is no page canvas to read');
      if (ink.ratio < 0.0005) fail(`canvas stayed blank (${ink.ratio} ink)`);
      if (ink.width < 100 || ink.height < 100) fail(`canvas is ${ink.width}×${ink.height} device px`);
      return `${count}, ink ${(ink.ratio * 100).toFixed(2)} %, canvas ${ink.width}×${ink.height} for ${ink.cssWidth}×${ink.cssHeight} css px`;
    },
  },
  {
    name: 'canvas-follows-dpr',
    run: async ({ page, load }) => {
      await load('page-order-sample.pdf', 20);
      const m = await page.evaluate(() => {
        const canvas = document.querySelector('.pjsr-page-canvas');
        if (!canvas) return null;
        const box = canvas.getBoundingClientRect();
        return { dpr: devicePixelRatio, ratio: canvas.width / box.width, width: canvas.width };
      });
      if (!m) fail('no canvas to measure');
      // The render's own area cap can pull a ratio down on a large page; the claim under test is that the
      // canvas is *not* CSS-resolution when the device is not.
      const floor = m.dpr >= 2 ? 1.5 : 0.9;
      if (m.ratio < floor) fail(`ratio ${m.ratio.toFixed(2)}× at dpr ${m.dpr} (floor ${floor})`);
      return `dpr ${m.dpr} → ${m.ratio.toFixed(2)}× backing store, ${m.width} device px`;
    },
  },
  {
    name: 'text-layer-selectable',
    run: async ({ page, load }) => {
      await load('page-order-sample.pdf', 20);
      const layer = await page.evaluate(() => {
        const el = document.querySelector('.pjsr-text-layer');
        if (!el) return null;
        const spans = [...el.querySelectorAll('span')];
        return {
          spans: spans.length,
          width: Math.round(el.getBoundingClientRect().width),
          words: spans.filter((s) => /[A-Za-z]{4,}/.test(s.textContent ?? '')).length,
        };
      });
      if (!layer) fail('no text layer element');
      if (layer.spans === 0) fail('text layer holds no spans');
      if (layer.width < 50) fail(`text layer is ${layer.width}px wide`);
      const box = await page
        .locator('.pjsr-text-layer span')
        .filter({ hasText: /[A-Za-z]{4,}/ })
        .first()
        .boundingBox()
        .catch(() => null);
      let selected = '';
      if (box) {
        await page.mouse.dblclick(box.x + box.width / 2, box.y + box.height / 2);
        selected = ((await page.evaluate(() => String(getSelection()))).trim() ?? '');
      }
      if (box && !selected) fail(`double-click on "${layer.words} word spans" selected nothing`);
      return `${layer.spans} spans over ${layer.width}px, word-select gives "${selected.slice(0, 28)}"`;
    },
  },
  {
    name: 'search-marks-matches',
    run: async ({ page, load, reveal }) => {
      await load('page-order-sample.pdf', 20);
      // The counter carries its meaning in its text; `data-state` is only set for the two states that need
      // a colour of their own, so a wait for `data-state="matches"` would be a wait for an attribute the
      // component never writes.
      const snapshot = () =>
        page.evaluate(() => ({
          counter: (document.querySelector('.pjsr-search-count')?.textContent ?? '').trim(),
          state: document.querySelector('.pjsr-search-count')?.dataset.state ?? '',
          marks: document.querySelectorAll('.pjsr-mark').length,
          active: document.querySelectorAll('.pjsr-mark--active').length,
        }));
      await (await reveal('Search document')).click();
      await page.waitForSelector('.pjsr-search-input');
      await page.fill('.pjsr-search-input', 'MARKER');
      await page.press('.pjsr-search-input', 'Enter');
      const first = await waitFor(async () => {
        const s = await snapshot();
        return s.marks > 0 ? s : null;
      }, 30_000);
      if (first === null) fail(`"${(await snapshot()).counter}" — the query found nothing to mark`);
      if (first.active !== 1) fail(`${first.marks} marks painted, ${first.active} of them the active one`);
      await page.press('.pjsr-search-input', 'Enter');
      const second = await waitFor(async () => {
        const s = await snapshot();
        return s.counter !== first.counter ? s : null;
      }, 15_000);
      if (second === null) fail(`Enter did not advance past "${first.counter}"`);
      await page.fill('.pjsr-search-input', 'qqzz-no-such-phrase');
      await page.waitForSelector('.pjsr-search-count[data-state="empty"]', { timeout: 30_000 });
      const empty = await snapshot();
      await page.fill('.pjsr-search-input', '');
      await page.keyboard.press('Escape');
      return `"${first.counter}" → "${second.counter}" on ${first.marks} marks, no-hits reads "${empty.counter}"`;
    },
  },
  {
    name: 'sidebar-thumbs-outline',
    run: async ({ page, load, reveal }) => {
      await load('outline-sample.pdf', 3);
      await (await reveal('Toggle sidebar')).click();
      await page.waitForSelector('.pjsr-sidebar');
      // The list renders a beat after the panel does, so asking for a thumbnail rather than counting one is
      // the difference between a check and a race.
      await page.waitForSelector('.pjsr-thumbnail', { timeout: 20_000 });
      const thumbs = await page.locator('.pjsr-thumbnail').count();
      const ink = await pollInk(page, '.pjsr-thumbnail-canvas');
      if (!ink || ink.ratio < 0.0005) fail(`${thumbs} thumbnails, none of them painted`);
      await page.click('.pjsr-sidebar [role="tab"]:has-text("Outline")');
      await page.waitForSelector('.pjsr-outline-item', { timeout: 15_000 });
      const items = await page.locator('.pjsr-outline-item').count();
      if (items === 0) fail('the outline tab is empty on a document that has an outline');
      /*
       * FR-33's thumbnail half, which needs a document of its own: a pure-XFA page's canvas holds no
       * operators at all, so the card's bitmap is white paper and the composed DOM form *is* the miniature.
       * That is what made every card of an XFA form blank in 0.8, and neither the outline fixture nor the
       * ink reading above could have caught it — the ink line passes on a document with one painted card,
       * and this document has zero.
       */
      await page.click('.pjsr-sidebar [role="tab"]:has-text("Thumbnails")');
      await load('xfa-sample.pdf', 1);
      const readCard = () =>
        page.evaluate(() => {
          const host = document.querySelector('.pjsr-thumbnail-xfa');
          if (!host) return null;
          const box = host.getBoundingClientRect();
          const fields = [...host.querySelectorAll('input, select, textarea, button, a[href]')];
          return {
            layers: host.querySelectorAll('.xfaLayer').length,
            width: Math.round(box.width),
            height: Math.round(box.height),
            inert: host.inert === true,
            hidden: host.getAttribute('aria-hidden'),
            tabbable: fields.filter((el) => el.tabIndex >= 0).length,
            chars: (host.textContent ?? '').replace(/\s+/g, '').length,
          };
        });
      const card = await waitFor(async () => {
        const reading = await readCard();
        return reading && reading.layers > 0 && reading.width > 0 && reading.chars > 0 ? reading : null;
      }, 25_000);
      if (card === null) {
        const where = await page.evaluate(() => ({
          cards: document.querySelectorAll('.pjsr-thumbnail').length,
          hosts: document.querySelectorAll('.pjsr-thumbnail-xfa').length,
          canvas: document.querySelector('.pjsr-thumbnail-canvas')?.width ?? 0,
        }));
        fail(`a pure-XFA document left the card holding no composed form: ${JSON.stringify(where)}`);
      }
      if (card.layers !== 1) fail(`the card's form tree repeated ${card.layers} times, expected 1`);
      // The card sits inside a button, so a live form in it is a set of fields a keyboard reader reaches
      // nine times over on a nine-page document, none of it visible. `inert` plus `aria-hidden` plus the
      // walked `tabIndex = -1` is the whole of that defence, and only a real engine applies the cascade.
      if (!card.inert || card.hidden !== 'true' || card.tabbable > 0) {
        fail(
          `the form inside the card is reachable by a reader: inert=${card.inert} ` +
            `aria-hidden=${card.hidden} ${card.tabbable} tabbable field(s)`,
        );
      }
      /*
       * The card is not turned here, and the reason is a defect rather than a harness shortcut. The viewport
       * change this path needs is a toolbar control, and at 375×812 the bar folds every one of them into the
       * overflow menu — measured with `.pjsr-viewer` spanning y=447 to y=688 (343×241) under `overflow: clip`:
       * the rotate row is 44 px tall from y=669, so its own centre at y=691 is past the clip edge,
       * `elementFromPoint` there answers the page behind it, and a pointer click cannot land on it at all. The
       * keyboard still reaches it — 49 Tab presses from the body, `activeElement` on the button, the sheet's
       * own `rgb(79, 70, 229) solid 2px` ring, and Enter turned the canvas from 670×867 to 871×673 — so what a
       * pointer user loses is the row, which is task #241. Until that is fixed, the rotation half of the
       * clause is guarded where the mechanism is observable: `PdfPage.xfa.test.tsx` and
       * `PdfThumbnail.xfa.test.tsx` drive the viewport change through the component's own inputs.
       */
      // Closed with the panel's own control rather than the toolbar's: an open sidebar narrows the bar the
      // fold check measures next, and by this width the toggle may itself be folded away.
      await page.click('.pjsr-sidebar .pjsr-sidebar-close');
      await page.waitForSelector('.pjsr-sidebar', { state: 'detached' });
      return (
        `${thumbs} thumbnails at ${(ink.ratio * 100).toFixed(2)} % ink, outline ${items} items, ` +
        `pure-XFA card ${card.width}×${card.height}px over ${card.chars} form characters, 1 tree, inert`
      );
    },
  },
  {
    name: 'virtualizes-1000-pages',
    run: async ({ page, log, load, jumpTo, watchPageChanges, pageChanges }) => {
      await load('long-sample.pdf', 1000);
      const count = (await page.textContent(`${COUNT}`))?.trim() ?? '';
      const total = Number(count.replace(/\D+/g, ''));
      if (!Number.isFinite(total) || total < 900) fail(`page count reads "${count}"`);
      const mounted = await page.locator('.pjsr-page-slot').count();
      const height = await page.evaluate(() => document.querySelector('.pjsr-viewport')?.scrollHeight ?? 0);
      if (!(await watchPageChanges()))
        fail('no .app-log to count page changes in, so a walk cannot be told from a stall');
      const how = await jumpTo(total);
      /*
       * 90s rather than 30, the elapsed time printed, and the scroll position reported on failure, because this
       * row came up red on WebKit desktop (stuck at page 733, no further movement for the whole window) in one
       * run and green in the next.
       *
       * What that red was, measured 2026-10-07 (#259 reopened #210, #265 closed it). The note here used to say
       * it was a harness artifact — two matrix processes sharing one dev-server port — and that a solo run
       * reached page 999 in 0.1s; a solo run does not do that, and five of them said so. The counter installed
       * below then killed the second theory too: webkit's failure read `2 onPageChange events, 733 → 732`, so
       * the reader was not walked down the document one page at a time, they were put on the wrong page once
       * and left there. A probe that wrapped `Element.prototype.scrollTo` and the `scrollTop` setter (the ones
       * in `.spike/`, this harness does not carry them) found the third and correct theory: the jump was
       * written against the layout the fit mode had resolved from the 612-wide *default* page box, scale 1.98,
       * because page 1's real landscape box had not landed yet; when it landed the whole document shrank 27 %,
       * the engine clamped the reader to the new end of the range, and the virtualizer's anchor looked that
       * clamped position up in the *old* table, named the row it found there, and moved the reader to it.
       * Chromium wins the same race by measuring page 1 first. Fixed in `usePdfVirtualizer`, where a jump is
       * now a request that outlives its write.
       *
       * What the row can still not tell you: the two engines agree on layout to within a few hundred px of
       * scroll height, so nothing here was ever an engine difference — it is a timing one, and a browser that
       * resolves `getPage(1)` a frame later is enough to hit it. The long ceiling, the event count and the
       * scroll position are what make the next such failure diagnosable from its own line.
       */
      const walked = Date.now();
      const line = await waitFor(async () => {
        const latest = await log('onPageChange');
        return Number(latest.replace(/\D+/g, '')) >= total - 3 ? latest : null;
      }, 90_000);
      const seconds = ((Date.now() - walked) / 1000).toFixed(1);
      const seen = pageChangeSummary(await pageChanges());
      if (line === null) {
        // The bare "never reached the end" message said nothing about *how* it failed, and a row that is red in
        // one run and green in the next has to be diagnosable from its own line. Where the reader stopped, how
        // far the scroll got, how many slots are mounted and how many page changes it took to get there are
        // what tell a slow sweep from a write that was never applied, without re-running anything.
        const stuck = await log('onPageChange');
        const { top, height } = await page.evaluate(() => {
          const el = document.querySelector('.pjsr-viewport');
          return { top: el?.scrollTop ?? -1, height: el?.scrollHeight ?? -1 };
        });
        fail(
          `${how}, but the reader never reached the end of ${total} pages in ${seconds}s — ${seen}, last ` +
            `onPageChange "${stuck}", scrollTop ${top} of ${height}px, ` +
            `${await page.locator('.pjsr-page-slot').count()} slots mounted`,
        );
      }
      const landed = Number(line.replace(/\D+/g, ''));
      const ink = await pollInk(page, '.pjsr-page-canvas');
      const after = await page.locator('.pjsr-page-slot').count();
      if (!ink || ink.ratio < 0.0005) fail(`page ${landed} never painted`);
      if (Math.max(mounted, after) > 40) fail(`${mounted} then ${after} page slots mounted — not virtualizing`);
      return (
        `${total} pages, ${how}, ${mounted}→${after} slots mounted, scroll height ${height}px, page ${landed} at ` +
        `${(ink.ratio * 100).toFixed(2)} % ink, reached in ${seconds}s, ${seen}`
      );
    },
  },
  {
    name: 'toolbar-fold',
    run: async ({ page, profile, load }) => {
      await load('page-order-sample.pdf', 20);
      const overflow = await page.locator('.pjsr-overflow').count();
      if (profile.touch) {
        if (overflow === 0) return skip(`nothing folded at ${profile.viewport.width}px — the bar had room`);
        // A previous check may have opened the menu to reach a folded control; measure a fresh open.
        if (await page.locator('.pjsr-overflow-menu').count()) {
          await page.click(`${BAR} [aria-label="More controls"]:visible`);
        }
        await page.click(`${BAR} [aria-label="More controls"]:visible`);
        await page.waitForSelector('.pjsr-overflow-menu', { timeout: 10_000 });
        const rows = await page.locator('.pjsr-overflow-row').count();
        const labels = await page.locator('.pjsr-overflow-label').allTextContents();
        if (rows === 0) fail('the overflow menu opened empty');

        /*
         * FR-45's "geometry checks for touch targets", and #241's claim in the same pass.
         *
         * The clause has always asked for targets to be *measured*, and until now the only assertions were CSS
         * declarations under jsdom, which lays nothing out. Measuring them here found the defect #236 worked
         * around: the panel hung below the ⋯ inside `.pjsr-viewer`, which clips with `overflow: clip`, and a clip
         * is not a scrollbar — content past it is not painted, not hit-testable and not scrollable to. At this
         * profile the panel wanted 421 px against 196 px of clipped box, and four of the nine rows (Download, Page
         * layout, Enter fullscreen, Print pages) hit-tested the page behind the viewer or nothing at all. So each
         * row is scrolled into view, measured, and asked whether a pointer landing on its own centre reaches its
         * control; the height is asserted at 44 px where the engine reports a coarse pointer, and reported rather
         * than asserted where it does not — Firefox is asked for touch and ignores it, which is a result and not a
         * silent difference.
         */
        const panel = await page.evaluate(() => {
          const el = document.querySelector('.pjsr-overflow-menu');
          let clip = null;
          for (let a = el.parentElement; a; a = a.parentElement) {
            const s = getComputedStyle(a);
            if (/clip|hidden/.test(`${s.overflowX}${s.overflowY}`)) {
              clip = a;
              break;
            }
          }
          const box = el.getBoundingClientRect();
          const clipBox = clip?.getBoundingClientRect();
          return {
            size: `${Math.round(box.width)}x${Math.round(box.height)} at y ${Math.round(box.top)}`,
            clip: clip ? `.${String(clip.className).split(' ')[0]} ending at y ${Math.round(clipBox.bottom)}` : 'nothing',
            scrolls: `client ${el.clientHeight}px of scroll ${el.scrollHeight}px`,
            coarse: window.matchMedia('(pointer: coarse)').matches,
          };
        });
        const unreachable = [];
        const undersized = [];
        const heights = [];
        for (let i = 0; i < rows; i += 1) {
          const row = page.locator('.pjsr-overflow-row').nth(i);
          const label = (await row.locator('.pjsr-overflow-label').textContent()) ?? `row ${i + 1}`;
          const control = row.locator('button, select, input').last();
          await control.scrollIntoViewIfNeeded();
          const seen = await control.evaluate((el) => {
            const box = el.getBoundingClientRect();
            const hit = document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2);
            const own = el.closest('.pjsr-overflow-menu').getBoundingClientRect();
            return {
              height: Math.round(box.height),
              past: Math.round(box.bottom - own.bottom),
              lands: hit !== null && (hit === el || el.contains(hit) || hit.contains(el)),
              what: hit ? `${hit.tagName}${hit.className ? `.${String(hit.className).split(' ')[0]}` : ''}` : 'nothing',
            };
          });
          heights.push(seen.height);
          if (!seen.lands) unreachable.push(`${label}: its centre hit-tests ${seen.what}`);
          else if (seen.past > 1) unreachable.push(`${label}: ${seen.past}px outside its own panel`);
          if (panel.coarse && seen.height < 44) undersized.push(`${label} at ${seen.height}px`);
        }
        if (unreachable.length) {
          fail(
            `${unreachable.length} of ${rows} folded rows are past the reach of a pointer at ` +
              `${profile.viewport.width}×${profile.viewport.height} — ${unreachable.join('; ')} — the panel is ` +
              `${panel.size}, ${panel.scrolls}, and clipped by ${panel.clip}`,
          );
        }
        if (undersized.length) {
          fail(
            `the engine reported a coarse pointer, and FR-45 asks for 44 px touch targets: ${undersized.join(
              ', ',
            )} — panel ${panel.size}, ${panel.scrolls}`,
          );
        }
        const shortest = Math.min(...heights);
        return (
          `${rows} rows: ${labels.slice(0, 6).join(' | ')} — all ${rows} reachable by pointer, smallest control ` +
          `measured ${shortest}px${panel.coarse ? ' against FR-45’s 44 px floor' : ' (the engine reported a fine pointer, so 44 px is not the requirement here)'}, ` +
          `panel ${panel.size} ${panel.scrolls}, clipped by ${panel.clip}`
        );
      }
      const inline = await page.locator(`${BAR} .pjsr-page-input:visible`).isVisible();
      if (overflow > 0 || !inline) fail(`at ${profile.viewport.width}px the bar folded (overflow ${overflow}, page field inline ${inline})`);
      return `no overflow at ${profile.viewport.width}px, jump-to-page inline`;
    },
  },
  {
    name: 'keyboard-paging',
    run: async ({ page, log, load }) => {
      await load('page-order-sample.pdf', 20);
      // The viewer's key handler sits on its root and refuses only editable targets, so the key has to
      // arrive from inside the component. Focusing a visible control is how a reader does that.
      // `:not([disabled])` because the previous-page button is disabled on page 1, and focus does not land
      // on a disabled control: the key would have gone to `body`, which the viewer is right to ignore.
      const control = page.locator(`${BAR} button:visible:not([disabled])`).first();
      const label = (await control.getAttribute('aria-label')) ?? 'a toolbar control';
      await control.focus();
      const top = () => page.evaluate(() => document.querySelector('.pjsr-viewport').scrollTop);
      const newest = () => page.evaluate(() => document.querySelector('.app-log li')?.textContent?.trim() ?? '');
      // `ArrowRight` is deliberately *not* a paging key: the viewport scrolls sideways at high zoom and in
      // spread layout, and taking the arrow would put the wide row out of keyboard reach. Refusing it is
      // part of the claim, so it is measured beside the keys that page.
      const from = await top();
      await page.keyboard.press('ArrowRight');
      await page.waitForTimeout(700);
      const sideways = await top();
      const before = await log('onPageChange');
      await page.keyboard.press('ArrowDown');
      const line = await waitFor(async () => {
        const latest = await log('onPageChange');
        return latest && latest !== before ? latest : null;
      }, 10_000);
      if (line === null) fail(`ArrowDown with focus on "${label}" produced no onPageChange callback`);
      const scrolled = await waitFor(async () => ((await top()) > from ? await top() : null), 4_000);
      if (scrolled === null) fail(`${line} fired but the viewport did not move from ${from}px`);
      await page.keyboard.press('PageUp');
      const back = await waitFor(async () => ((await newest()) === 'onPageChange 1' ? 'onPageChange 1' : null), 6_000);
      if (back === null) fail(`PageUp left the newest callback at "${await newest()}"`);
      if (sideways !== from) fail(`ArrowRight paged the viewer (${from}px → ${sideways}px), which it must not do`);
      return `focus on "${label}": ArrowDown ${line}, PageUp ${back}, ArrowRight held the scroll at ${from}px`;
    },
  },
  {
    name: 'wheel-zoom-and-scroll',
    run: async ({ page, log, viewportBox, load, profile }) => {
      await load('page-order-sample.pdf', 20);
      const box = await viewportBox();
      const top = () => page.evaluate(() => document.querySelector('.pjsr-viewport').scrollTop);
      const scale = async () => Number((await log('onScaleChange')).match(/[\d.]+$/)?.[0] ?? NaN);
      // What the page was *offered* is recorded beside what it did with it, because "the emulation sent no
      // wheel event" and "the viewer ignored the wheel event" are different findings, and only the second
      // one is ours.
      await page.evaluate(() => {
        window.__wheels = [];
        document
          .querySelector('.pjsr-viewport')
          .addEventListener('wheel', (e) => window.__wheels.push(`${e.ctrlKey ? 'ctrl+' : ''}wheel ${e.deltaY}`), {
            capture: true,
            passive: true,
          });
      });
      const seen = () => page.evaluate(() => window.__wheels.join(' | '));

      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
      const fromTop = await top();
      const beforePlain = await scale();
      await page.mouse.wheel(0, 300);
      const scrolled = await waitFor(async () => ((await top()) > fromTop ? await top() : null), 8_000);
      if (scrolled === null) {
        return skip(
          `no wheel event moved the viewport (${profile.viewport.width}px, engine saw "${await seen()}")`,
        );
      }
      const afterPlain = await scale();
      if (afterPlain !== beforePlain) fail(`a plain wheel also zoomed (${beforePlain} → ${afterPlain})`);

      await page.keyboard.down('Control');
      await page.mouse.wheel(0, -240);
      await page.keyboard.up('Control');
      const zoomed = await waitFor(async () => {
        const now = await scale();
        return Number.isFinite(now) && now !== afterPlain ? now : null;
      }, 8_000);
      if (zoomed === null) {
        const offered = await seen();
        if (!/ctrl\+wheel/.test(offered)) {
          return skip(`ctrl+wheel never reached the page (${profile.viewport.width}px, engine saw "${offered}")`);
        }
        fail(`ctrl+wheel reached the page ("${offered}") and left the scale at ${afterPlain}`);
      }
      return `plain wheel scrolled ${fromTop}→${scrolled}px and held ${afterPlain}; ctrl+wheel ${afterPlain} → ${zoomed}`;
    },
  },
  {
    /*
     * FR-06: "a zoom step updates existing overlay layers in place rather than rebuilding them."
     *
     * `PdfPage.overlay.test.tsx` counts the calls the page makes against its own mocks, which proves the page
     * asks; only a real engine proves that asking is enough. The observable fact in a browser is churn: a
     * rebuilt layer takes its elements out and puts new ones back, so a `childList` removal count over the zoom
     * sequence is the clause, read off the DOM rather than off a stub. `annotated-sample.pdf` is the fixture
     * because its first page carries markups the annotation layer paints with no feature mounted — a page with
     * nothing in the layer would report zero churn in both worlds and certify nothing, so the count of elements
     * found at load is printed with the verdict.
     */
    name: 'zoom-updates-the-layers-in-place',
    run: async ({ page, load, log }) => {
      await load('annotated-sample.pdf', 2);
      /*
       * The annotations arrive after the canvas does — `load` waits for the document label and the painted page,
       * not for the overlay — so arming straight away watched an empty layer on the first Firefox run and
       * reported a skip that was really the harness reading its own timing. Wait for the layer to have
       * something in it, and only treat a layer that stays empty as an engine finding.
       */
      const populated = await waitFor(
        async () =>
          (await page.evaluate(() => {
            const el = document.querySelector('.pjsr-annotation-layer');
            return el !== null && el.querySelectorAll('*').length > 0;
          }))
            ? true
            : null,
        10_000,
      );
      const scale = async () => Number((await log('onScaleChange')).match(/[\d.]+$/)?.[0] ?? NaN);
      const armed = await page.evaluate(() => {
        const layers = ['.pjsr-annotation-layer', '.pjsr-editor-layer']
          .map((selector) => document.querySelector(selector))
          .filter((el) => el !== null);
        if (!layers.length) return null;
        window.__churn = { added: 0, removed: 0, steps: 0 };
        /*
         * The watched nodes are kept by reference. A zoom to 300 % legitimately mounts the *next* page with its
         * own layers, and counting every `.pjsr-annotation-layer *` in the document would then compare one
         * page's elements against two — which reads a correct zoom as a layer that grew. The first run of this
         * check failed that way, on the check rather than on the viewer.
         */
        window.__watched = layers;
        for (const el of layers) {
          new MutationObserver((records) => {
            for (const r of records) {
              if (r.type !== 'childList') continue;
              window.__churn.added += r.addedNodes.length;
              window.__churn.removed += r.removedNodes.length;
            }
          }).observe(el, { childList: true, subtree: true });
        }
        return layers.map((el) => el.querySelectorAll('*').length);
      });
      if (!armed) fail('the page mounted neither an annotation nor an editor layer to watch');
      if (populated === null) {
        return skip('the annotation layer never carried an element within 10 s of the page painting, so there is nothing to keep in place');
      }
      const marks = armed.reduce((a, b) => a + b, 0);
      if (!marks) {
        return skip(`the watched layers hold ${armed.join(' + ')} elements — nothing there to keep in place`);
      }

      const field = page
        .locator('.pjsr-toolbar .pjsr-zoom-input:visible')
        .or(page.locator('.pjsr-overflow-menu .pjsr-zoom-input:visible'))
        .first();
      if (!(await field.count())) return skip('no zoom control the harness could reach in this profile');

      const before = await scale();
      for (const percent of [150, 200, 250, 300]) {
        const want = percent / 100;
        await field.fill(String(percent));
        await field.press('Enter');
        // Wait for *this* step rather than for any step: once the first has landed the scale differs from
        // `before` forever, so a check against `before` returns at once and the sequence is measured as stillness.
        const landed = await waitFor(async () => ((await scale()) === want ? true : null), 8_000);
        if (landed === null) fail(`the zoom field asked for ${percent} % and the scale never reached it`);
        await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
        await page.evaluate(() => {
          window.__churn.steps += 1;
        });
      }
      const after = await scale();
      const churn = await page.evaluate(() => ({ ...window.__churn }));
      const kept = await page.evaluate(() =>
        (window.__watched ?? []).map((el) => el.querySelectorAll('*').length).reduce((a, b) => a + b, 0),
      );

      if (!(after > before)) fail(`the zoom never landed (${before} → ${after}), so the churn count means nothing`);
      if (churn.removed || churn.added) {
        fail(
          `${churn.steps} zoom steps replaced ${churn.removed} overlay elements and added ${churn.added}: ` +
            'a layer that is repositioned in place keeps its own nodes',
        );
      }
      if (kept !== marks) fail(`the watched layers held ${marks} elements before the zoom and ${kept} after it`);
      return `${churn.steps} steps ${before} → ${after}, ${marks} overlay elements in place throughout, 0 added / 0 removed`;
    },
  },
  {
    /*
     * FR-16's first clause: five interactive form field types have to arrive as **real HTML controls**.
     *
     * Until now the evidence was `src/lib/form.test.ts` reading parsed field data — `combo?.type === 'select'`
     * describes an annotation object, not something a reader can tab to — so a layer that painted nine boxes and
     * no controls would have passed. This asks the DOM: for each field the fixture names, the element that
     * carries it, its `type`, and whether it is focusable at all. Measured 2026-10-05 in chromium at
     * 6.3.289, `form-sample.pdf`: eight controls on page 1 — `input[text] fullName`, `textarea notes`,
     * `input[checkbox] subscribe`, three `input[radio] priority`, `select[select-one] country`,
     * `select[select-multiple] skills` — all with `tabIndex >= 0`, inside nine widget boxes.
     *
     * The clause's sixth type is the one that needed this package to draw something, and this row asserts it rather
     * than reporting it now. Measured on `signature-sample.pdf` (2026-10-06, chromium 6.3.289): of its six `/Sig`
     * widgets, the one the engine flags `hasOwnCanvas` gets an element — `section.norotate`, at exactly the rect the
     * fixture carries — and the other five get **no element in the layer at all**. Sampling the painted canvas
     * inside each of those five rects, four read **0 % ink**; the fifth, `sigAlreadySigned`, reads 4.03 %, because
     * the canvas paints the appearance the file carries for it. The box is drawn over that one too, and the reason
     * is the same measurement: the flags do not predict what the canvas paints — `sigKid` declares an appearance and
     * reads 0 % — so a rule that tried to skip "already visible" fields would be guessing, while the clause asks
     * for the widget to render as its box. An earlier reading of this row said "none of the widgets produces
     * anything", which was the detector's fault rather than the viewer's: it looked for a class matching `sig`, and
     * the engine names its element for the rotation flag instead. So a box for every widget the engine will not give
     * an element to is drawn by the core (#229), and what is asserted below is that it lands where the engine would
     * have put its own — compared against the one element the engine did make, on a field whose rect is identical.
     *
     * What also stays true either way, and is still asserted: a signature box is not a control. Nothing on those
     * two pages may be focusable and named for a `/Sig` field, and the drawn box may not take the pointer.
     */
    name: 'form-widgets-are-html-controls',
    run: async ({ page, load, reveal, jumpTo }) => {
      /*
       * Back to the top, then wait for the layer. The rows before this one leave the document scrolled (the
       * 1,000-page row jumps to its last sheet) and zoomed, and the virtualizer only mounts the pages that are
       * near the viewport — so a page whose widgets are off-screen has no annotation layer to read yet. #228
       * learned the same lesson the hard way: measure where the thing actually is, or the harness reports its
       * own aim as a defect.
       */
      const settle = async (predicate, ms = 20_000) => {
        await page.evaluate(() => {
          const el = document.querySelector('.pjsr-viewport');
          el.scrollTop = 0;
          el.scrollLeft = 0;
        });
        // `waitFor` hands back the truthy value, not a boolean: a count of 6 is a pass, and comparing it
        // with `true` is how the first version of this helper reported "never painted" for a layer holding six
        // controls.
        return Boolean(await waitFor(predicate, ms));
      };
      const painted = (selector) =>
        page.evaluate((s) => document.querySelectorAll(s).length, selector);

      await load('form-sample.pdf', 2);
      // Wait only for the layer to paint *something*; the assertions below name what is missing, which is a
      // better report than a magic count that can move with the zoom the previous row left behind. The
      // predicate has to await the read — `painted(...) >= 1` compares a Promise to a number, which is false
      // for any value, and the first version of this line reported "never painted" for a layer holding six
      // controls.
      if (
        !(await settle(
          async () =>
            (await painted('.pjsr-annotation-layer input, .pjsr-annotation-layer select, .pjsr-annotation-layer textarea')) >= 1,
        ))
      ) {
        fail('the form fixture never painted a single widget within 20 s — the annotation layer is not rendering at all');
      }
      const fields = await page.evaluate(() => {
        const out = [];
        for (const layer of document.querySelectorAll('.pjsr-annotation-layer')) {
          for (const el of layer.querySelectorAll('input, select, textarea')) {
            out.push({
              name: el.name ?? '',
              tag: el.tagName.toLowerCase(),
              type: el.type ?? '',
              focusable: el.tabIndex >= 0,
            });
          }
        }
        return { controls: out, boxes: document.querySelectorAll('.pjsr-annotation-layer [class*="Widget"]').length };
      });
      const wanted = [
        ['fullName', 'input', 'text'],
        ['notes', 'textarea', 'textarea'],
        ['subscribe', 'input', 'checkbox'],
        ['priority', 'input', 'radio'],
        ['country', 'select', 'select-one'],
        ['skills', 'select', 'select-multiple'],
      ];
      const missing = wanted
        .filter(([name, tag, type]) => !fields.controls.some((c) => c.name === name && c.tag === tag && c.type === type))
        .map(([name, tag, type]) => `${tag}[type=${type}] name=${name}`);
      if (missing.length) {
        fail(
          `${missing.length} of ${wanted.length} field types is not a real HTML control: ${missing.join('; ')} — ` +
            `the layer holds ${fields.controls.length} control(s): ` +
            fields.controls.map((c) => `${c.tag}[${c.type}]${c.name ? `(${c.name})` : ''}`).join(', '),
        );
      }
      const untabbable = fields.controls.filter((c) => !c.focusable).map((c) => `${c.tag}(${c.name})`);
      if (untabbable.length) {
        fail(`${untabbable.length} control(s) cannot be focused: ${untabbable.join(', ')} — a form a keyboard cannot reach is not "real HTML controls"`);
      }
      if (fields.boxes < fields.controls.length) {
        fail(`${fields.boxes} widget boxes holding ${fields.controls.length} controls — the box is what positions the control`);
      }

      // The signature half: the box the clause asks for, measured against the one widget the engine paints itself.
      await load('signature-sample.pdf', 2);
      if (
        !(await settle(
          async () => (await painted('.pjsr-annotation-layer input[name="title"]')) >= 1,
        ))
      ) {
        fail(
          `the /Tx field on the signature fixture never painted within 12 s, so the signature counts below ` +
            'would mean nothing — the layer is not painting this document at all',
        );
      }
      /*
       * The anchor of every comparison below is the element the engine builds for the one widget it renders on
       * its own canvas — and that widget is on **page 2**. Waiting only for page 1's `/Tx` control is not the
       * same wait: CI run 37472575777 failed this row in firefox·mobile with `layer classes seen: (none)`, six
       * cells deep in a job where every row before it has scrolled, zoomed and swapped documents, so the read
       * landed while the second page's layer was still empty. Reproduced alone, the same cell passes, which is
       * the signature of a precondition the row never waited for rather than a widget that cannot render. Wait
       * for the anchor itself, and if it still does not arrive say what was on screen.
       */
      if (
        !(await settle(
          async () => (await painted('.pjsr-annotation-layer section.norotate')) >= 1,
          12_000,
        ))
      ) {
        const where = await page.evaluate(() => ({
          pages: [...document.querySelectorAll('.pjsr-page-canvas')].map(
            (el) => el.getAttribute('aria-label') ?? '(unnamed)',
          ),
          layerChildren: [...document.querySelectorAll('.pjsr-annotation-layer')].map((el) => el.childElementCount),
          sigBoxes: document.querySelectorAll('.pjsr-sig-box').length,
          scroll: Math.round(document.querySelector('.pjsr-viewport')?.scrollTop ?? -1),
        }));
        fail(
          'the one /Sig widget the engine renders on its own canvas produced no element within 12 s, so the ' +
            `comparison that anchors the drawn boxes has nothing to read against — what was on screen: ${JSON.stringify(
              where,
            )} — this names where the read landed; it is not a finding that the widget cannot render`,
        );
      }
      const readSig = () => {
        /** Fractions of the layer the element lives in, so the assertions survive any zoom the row left on. */
        const frac = (el, root) => {
          const r = el.getBoundingClientRect();
          const b = root.getBoundingClientRect();
          return [(r.left - b.left) / b.width, (r.top - b.top) / b.height, r.width / b.width, r.height / b.height];
        };
        const px = (el) => {
          const r = el.getBoundingClientRect();
          return [r.width, r.height];
        };
        const names = ['sigPlain', 'sigNoRotate', 'sigKid', 'sigAlreadySigned', 'sigTwoBoxes'];
        const controls = [...document.querySelectorAll('.pjsr-annotation-layer input, .pjsr-annotation-layer select, .pjsr-annotation-layer textarea')];
        const engine = document.querySelector('.pjsr-annotation-layer section.norotate');
        const boxes = [...document.querySelectorAll('.pjsr-sig-box')].map((el) => {
          const r = el.getBoundingClientRect();
          const hit = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
          return {
            name: el.getAttribute('data-pjsr-field-name') ?? '(no name)',
            rect: frac(el, el.closest('.pjsr-sig-layer')),
            size: px(el),
            secondPage: el.closest('.pjsr-page') === document.querySelectorAll('.pjsr-page')[1],
            takesPointer: hit !== null && (hit === el || el.contains(hit)),
          };
        });
        return {
          layers: document.querySelectorAll('.pjsr-annotation-layer').length,
          sigControls: controls.filter((el) => names.includes(el.name ?? '')).length,
          engineRect: engine ? frac(engine, engine.closest('.pjsr-annotation-layer')) : null,
          engineSize: engine ? px(engine) : null,
          engineClass: engine ? String(engine.className) : '(none)',
          boxes,
        };
      };
      const sig = await page.evaluate(readSig);
      if (sig.sigControls) {
        fail(
          `${sig.sigControls} focusable control(s) stand where FR-16 promises a signature box — capturing a mark ` +
            "is the edit tier's job (§2.4), so the core must not build one",
        );
      }
      if (!sig.engineRect) {
        fail(
          'the engine element the wait above just saw is gone at the read — the layer was rebuilt between them ' +
            `(layer classes seen: ${sig.engineClass}), so no comparison below can be trusted`,
        );
      }
      const near = (a, b) => a.every((v, i) => Math.abs(v - b[i]) < 0.002);
      const want = ['sigAlreadySigned', 'sigKid', 'sigPlain', 'sigTwoBoxes', 'sigTwoBoxes'];
      const got = sig.boxes.map((b) => b.name).sort();
      if (got.join(',') !== want.join(',')) {
        /*
         * The state fields come FIRST. `errText()` caps a failure at 260 characters, and the clause quote that
         * used to open this message pushed the layer count and the engine element's class past the cut — so the
         * detail #282 was opened to look for was in a sentence nobody could read. A verdict's useful part is the
         * part that must survive its own length limit.
         */
        fail(
          `${sig.boxes.length} of five boxes were drawn, and the layer held ${sig.layers} annotation layer(s) with ` +
            `the engine element "${sig.engineClass}" and ${sig.sigControls} focusable control(s) where a box belongs ` +
            `(fields: ${got.join(', ') || 'none'}) — the signature fixture holds six /Sig widgets, one of which the ` +
            'engine paints itself, and a widget with no element in the layer has nothing a reader can see or aim at' +
            '(clause: "a signature widget renders as its box")',
        );
      }
      // `sigPlain` carries the same rect as `sigNoRotate` (72,660,272,720 on a 612×792 page), on the page the
      // engine did render — so a box that agrees with that element's fractions agrees with the engine's own
      // coordinate system, at whatever zoom the row happens to be at.
      const plain = sig.boxes.find((b) => b.name === 'sigPlain');
      if (!near(plain.rect, sig.engineRect)) {
        fail(
          `the drawn box for sigPlain sits at ${plain.rect.map((v) => v.toFixed(4)).join(', ')} of its page while ` +
            `the engine's own element for the identical rect sits at ${sig.engineRect.map((v) => v.toFixed(4)).join(', ')} — ` +
            'a box that does not land on its widget is not the widget\u2019s box',
        );
      }
      const grabbing = sig.boxes.filter((b) => b.takesPointer);
      if (grabbing.length) {
        fail(
          `${grabbing.length} signature box(es) take the pointer (${grabbing.map((b) => b.name).join(', ')}) — the ` +
            'box says where a signature goes, it is not the thing you sign into, and the edit tier owns the click',
        );
      }

      /*
       * The rotation leg. A box that lands only while the page stands upright is not the widget's box: the
       * fixture carries a NOROTATE field precisely because rotation is where annotation geometry goes wrong, and
       * a unit test can only model the transform rather than measure it. So page 2 turns, and every box on it has
       * to keep the share of the page it covers while its pixel aspect inverts — with the engine's own element on
       * that page doing the same, which is the half read off pdf.js rather than off our own arithmetic.
       */
      const turned = sig.boxes.filter((b) => b.secondPage);
      if (!turned.length) {
        fail(
          `none of the ${sig.boxes.length} drawn boxes was on page 2, so the rotation leg had nothing to turn ` +
            `(pages seen: ${sig.boxes.map((b) => b.name).join(', ')})`,
        );
      }
      const share = (r) => r[2] * r[3];
      const aspect = (s) => s[0] / s[1];
      const before = {
        boxes: turned.map((b) => ({ name: b.name, share: share(b.rect), aspect: aspect(b.size) })),
        engineShare: share(sig.engineRect),
        engineAspect: aspect(sig.engineSize),
      };
      await jumpTo(2);
      await (await reveal('Rotate clockwise')).click();
      await page.waitForTimeout(1_500);
      const spun = await page.evaluate(readSig);
      const after = {
        boxes: spun.boxes.filter((b) => b.secondPage).map((b) => ({ name: b.name, share: share(b.rect), aspect: aspect(b.size) })),
        engineShare: spun.engineRect ? share(spun.engineRect) : null,
        engineAspect: spun.engineSize ? aspect(spun.engineSize) : null,
      };
      const drift = [];
      for (const b of before.boxes) {
        const moved = after.boxes.find((x) => x.name === b.name);
        if (!moved) {
          drift.push(`${b.name}'s box disappeared when the page turned`);
          continue;
        }
        if (Math.abs(moved.share - b.share) > 0.002) {
          drift.push(`${b.name} covers ${(moved.share * 100).toFixed(2)} % of the turned page and ${(b.share * 100).toFixed(2)} % of the upright one`);
        }
        if (Math.abs(moved.aspect * b.aspect - 1) > 0.08) {
          drift.push(`${b.name} kept its aspect (${b.aspect.toFixed(2)} → ${moved.aspect.toFixed(2)}) instead of inverting it`);
        }
      }
      if (after.engineShare === null || Math.abs(after.engineShare - before.engineShare) > 0.002) {
        drift.push(`the engine's own element changed its page share (${(before.engineShare * 100).toFixed(2)} % → ${after.engineShare === null ? 'gone' : `${(after.engineShare * 100).toFixed(2)} %`})`);
      }
      if (after.engineAspect !== null && Math.abs(after.engineAspect * before.engineAspect - 1) > 0.08) {
        drift.push(`the engine's element kept its aspect (${before.engineAspect.toFixed(2)} → ${after.engineAspect.toFixed(2)}) while our boxes did something else`);
      }
      if (drift.length) {
        fail(
          `page 2 turned 90° and the signature boxes did not follow it the way the engine's own element does — ` +
            `${drift.join('; ')}`,
        );
      }
      // Leave the viewer as found: a page still turned would be the next row's unasked-for premise.
      await (await reveal('Rotate counterclockwise')).click();
      await page.waitForTimeout(1_000);

      return `${fields.controls.length} controls in ${fields.boxes} boxes, all focusable (text/textarea/checkbox/radio×3/combo/list); signature document, ${sig.layers} layer(s) mounted, ${sig.boxes.length} boxes drawn and 1 left to the engine (${sig.engineClass}, agreeing with sigPlain's box to within 0.002 of the page), ${before.boxes.length} of them holding through a 90° turn of page 2 alongside the engine's element, no sig control focusable, none taking the pointer`;
    },
  },
  {
    name: 'pinch-vs-pan (synthetic touch)',
    mobileOnly: true,
    run: async ({ page, log, viewportBox, load }) => {
      await load('page-order-sample.pdf', 20);
      const touch = await page.evaluate(() => {
        // Ask the second question too. WebKit reports `typeof Touch === "function"` and then throws
        // `TypeError: Illegal constructor` on the construction, so probing the global alone turned an engine
        // that cannot synthesise the event into a failing check — a gap in the evidence reading as a defect
        // in the viewer, which is the one mistake this matrix exists to avoid.
        let synthesiable = false;
        try {
          const el = document.querySelector('.pjsr-viewport');
          const one = new Touch({ identifier: 1, target: el, clientX: 0, clientY: 0, screenX: 0, screenY: 0 });
          synthesiable = new TouchEvent('touchstart', { touches: [one] }) instanceof TouchEvent;
        } catch {
          synthesiable = false;
        }
        return {
          constructors: synthesiable,
          coarse: matchMedia('(pointer: coarse)').matches,
          points: navigator.maxTouchPoints ?? 0,
        };
      });
      if (!touch.constructors) return skip('no Touch/TouchEvent constructor to synthesise from');
      const box = await viewportBox();
      const scale = async () => Number((await log('onScaleChange')).match(/[\d.]+$/)?.[0] ?? NaN);
      /**
       * The scale once two reads agree.
       *
       * Each pinch step posts a React state update, and the playground's log line lands on the render after
       * it, so reading the log the first time it differs can catch a middle step. Comparing the pan's final
       * scale against that middle step made this row fail on Chromium about one run in three with nothing
       * changed but the timing — the drift was 0.62 against 0.61, the last two steps of the same spread.
       */
      const settledScale = async () => {
        let previous = await scale();
        for (let step = 0; step < 40; step += 1) {
          await new Promise((resolve) => setTimeout(resolve, 100));
          const now = await scale();
          if (Number.isFinite(now) && now === previous) return now;
          previous = now;
        }
        return Number.isFinite(previous) ? previous : null;
      };
      const before = await settledScale();
      const cx = box.x + box.width / 2;
      const cy = box.y + box.height / 2;
      // Two fingers spreading: the span changes on every move, which is the only thing that separates a
      // pinch from a pan on the way in.
      const spread = await page.evaluate(
        async ([x, y]) => {
          const el = document.querySelector('.pjsr-viewport');
          const mk = (id, dx, dy) =>
            new Touch({
              identifier: id,
              target: el,
              clientX: x + dx,
              clientY: y + dy,
              screenX: x + dx,
              screenY: y + dy,
            });
          const fire = (type, list, changed = list) =>
            el.dispatchEvent(
              new TouchEvent(type, {
                bubbles: true,
                cancelable: true,
                touches: list,
                targetTouches: list,
                changedTouches: changed,
              }),
            );
          for (let step = 1; step <= 8; step += 1) {
            const gap = 30 + step * 25;
            fire(step === 1 ? 'touchstart' : 'touchmove', [mk(1, -gap, 0), mk(2, gap, 0)]);
            await new Promise((r) => setTimeout(r, 16));
          }
          // `touches` is what is *still on the glass*: a real browser reports an empty list at the end of a
          // two-finger gesture, with the lifted points only in `changedTouches`. Listing them in `touches` too
          // is a lie the engine honours — pdf.js ends a gesture when fewer than two fingers remain, so an
          // un-ended pinch left the next gesture measured against the first one's start scale, and this row
          // reported "the pan also zoomed" at the 6.2.108 floor on 2026-10-05 for that reason alone.
          fire('touchend', [], [mk(1, -230, 0), mk(2, 230, 0)]);
          return true;
        },
        [cx, cy],
      );
      if (!spread) fail('the synthetic gesture did not dispatch');
      const pinched = await settledScale();
      if (pinched === null) fail('the scale never reported a value the pinch could be compared against');
      if (pinched === before) fail(`two fingers spreading left the scale at ${before}`);
      // Same two fingers, same span, travelling together: that is a scroll, and the zoom must not move.
      // Room is given first — `onPanning` subtracts the midpoint delta from `scrollTop`, so at the top of a
      // document the gesture clamps to a no-op and would read as broken wiring rather than as position.
      await page.evaluate(() => {
        document.querySelector('.pjsr-viewport').scrollTop = 400;
      });
      const top = await page.evaluate(() => document.querySelector('.pjsr-viewport').scrollTop);
      await page.evaluate(
        async ([x, y]) => {
          const el = document.querySelector('.pjsr-viewport');
          const mk = (id, ox, oy) =>
            new Touch({
              identifier: id,
              target: el,
              clientX: x + ox,
              clientY: y + oy,
              screenX: x + ox,
              screenY: y + oy,
            });
          const fire = (type, list, changed = list) =>
            el.dispatchEvent(
              new TouchEvent(type, {
                bubbles: true,
                cancelable: true,
                touches: list,
                targetTouches: list,
                changedTouches: changed,
              }),
            );
          for (let step = 0; step <= 8; step += 1) {
            fire(step === 0 ? 'touchstart' : 'touchmove', [mk(1, -60, step * 30), mk(2, 60, step * 30)]);
            await new Promise((r) => setTimeout(r, 16));
          }
          fire('touchend', [], [mk(1, -60, 240), mk(2, 60, 240)]);
        },
        [cx, cy],
      );
      const panned = await waitFor(async () => {
        const now = await page.evaluate(() => document.querySelector('.pjsr-viewport').scrollTop);
        return now !== top ? now : null;
      }, 8_000);
      const held = await settledScale();
      if (panned === null) fail('a two-finger pan moved neither the page nor the scroll position');
      if (held !== pinched) fail(`the pan also zoomed (${pinched} → ${held})`);
      return `pointer:coarse ${touch.coarse}, maxTouchPoints ${touch.points}: spread ${before} → ${pinched}, two-finger drag scrolled to ${panned} and held ${held}`;
    },
  },
  {
    /*
     * FR-47's other touch clause: "a one-finger drag on a drawing tool draws rather than scrolls".
     *
     * The pinch above is dispatched from page JavaScript, and that will not answer this one. Whether a finger
     * becomes a stroke or becomes a scroll is decided in the browser's input pipeline: the compositor reads the
     * `touch-action` chain under the point the touch lands and either leaves the pointer sequence alone or
     * takes it for itself, which the page sees as `pointercancel`. A `TouchEvent` built in the page never
     * reaches that decision — it only proves the engine's handlers run, which is a different sentence. So the
     * drag goes in through CDP `Input.dispatchTouchEvent`, which enters the same path a finger does.
     *
     * Chromium only, and said plainly: Firefox and WebKit have no CDP here, and Playwright's touchscreen API
     * taps but does not drag. An invented substitute would be exactly the kind of claim this matrix exists not
     * to make.
     *
     * The disarmed half is the load-bearing control, not a second case. If the *same* gesture with the pen off
     * is not cancelled, this harness is not seeing touch-action at all, and "no cancel while armed" would be an
     * absence of evidence dressed as a measurement — so that arm fails the check with its own message.
     *
     * Measured 2026-10-05, chromium 153 at 6.3.289, mobile 375×812 dpr 2, page-order-sample at the zoom the
     * pinch row left behind (3.37, so page 1 is 2059×2665 CSS px and only part of it is on screen): the armed
     * finger at (88,545) delivered ten `pointermove`s with **zero `pointercancel`**, held one live `<path>` in
     * the page mid-gesture, and came out with `0 → 1` ink editors; the same gesture with the pen off was
     * cancelled after the first move, on a `section.editorAnnotation`, and added nothing.
     *
     * Two things this row does not claim. It reports `scrollTop` before and after but does not assert on it —
     * the aim resets the scroll itself, and headless Chromium moved the position for reasons that are not the
     * gesture, so the clause is read off the cancellation signal the browser emits rather than off a position
     * that would need a real device to mean anything. And it is not evidence for the `touch-action: none` rule
     * in the annotate sheet: the editor layer's computed value while a tool is armed is `auto`, so the rule is
     * not what leaves the finger with the page. What that rule is for has to be said by its own guard, not by
     * borrowing this row's verdict.
     */
    name: 'pen-draws-not-scrolls (real touch)',
    mobileOnly: true,
    run: async ({ page, load, reveal }) => {
      const engine = page.context().browser()?.browserType().name();
      if (engine !== 'chromium') {
        return skip(`${engine}: no CDP input pipeline to send a real one-finger drag through`);
      }
      // The pen is a feature control, and the playground only mounts the tier when it is asked for.
      await page.locator('.app-features label', { hasText: 'annotate' }).locator('input').check();
      await load('page-order-sample.pdf', 20);

      await page.evaluate(() => {
        window.__drag = { events: [], cancels: 0, moves: 0, first: null };
        const name = (node) =>
          `${node?.tagName?.toLowerCase()}.${node?.className?.baseVal ?? node?.className ?? ''}`;
        for (const type of ['pointerdown', 'pointermove', 'pointerup', 'pointercancel']) {
          window.addEventListener(
            type,
            (event) => {
              window.__drag.events.push(`${type}@${name(event.target)}`);
              if (type === 'pointerdown' && !window.__drag.first) {
                window.__drag.first = {
                  x: Math.round(event.clientX),
                  y: Math.round(event.clientY),
                  pointerType: event.pointerType,
                  name: name(event.target),
                };
              }
              if (type === 'pointercancel') window.__drag.cancels += 1;
              if (type === 'pointermove' && event.pointerType === 'touch') window.__drag.moves += 1;
            },
            { capture: true, passive: true },
          );
        }
      });

      const read = () =>
        page.evaluate(() => {
          const layer = document.querySelector('.pjsr-editor-layer');
          const page1 = document.querySelector('.pjsr-page');
          return {
            pressed:
              document.querySelector('.pjsr-toolbar [aria-label="Ink"]')?.getAttribute('aria-pressed') ?? '?',
            layerClass: layer ? layer.className.replace('pjsr-editor-layer', '').trim() : '(no editor layer)',
            livePaths: (page1?.querySelectorAll('path') ?? []).length,
            inkEditors: document.querySelectorAll('.pjsr-editor-layer .inkEditor').length,
            cancels: window.__drag.cancels,
            moves: window.__drag.moves,
            first: window.__drag.first,
            scrolled: Math.round(document.querySelector('.pjsr-viewport')?.scrollTop ?? -1),
          };
        });

      const reset = () =>
        page.evaluate(() => {
          window.__drag = { events: [], cancels: 0, moves: 0, first: null };
        });

      /**
       * Arm or disarm through the bar's own control. At 375 px the tool group is folded into the overflow
       * menu, and the menu opens over the page — so it is dismissed again before the finger lands, and the
       * press is keyboard rather than click: the menu renders under the playground's own panel, which
       * intercepts a pointer, while FR-45 requires the button to be pressable from the keyboard anyway. The
       * engine's ink mode is what is under test, not the geometry of a tap on the toggle.
       */
      const pressInk = async () => {
        const pen = await reveal('Ink');
        await pen.focus();
        await page.keyboard.press('Enter');
        await page.keyboard.press('Escape');
        await page.waitForTimeout(350);
        return pen;
      };

      const cdp = await page.context().newCDPSession(page);

      /*
       * Aim at the page, and aim again for every gesture — from inside the page.
       *
       * Three first versions of this row each read the harness's own aim as a viewer that cancels a touch
       * drag. One aimed with `boundingBox()` before arming, and arming the pen makes the bar show its
       * pointer-only sentence (FR-47's disclosure, #226), which on a 375 px bar is a whole extra line that
       * moves the page down; one left the overflow menu open under the finger; one took a point from a canvas
       * that the earlier rows' zoom (the pinch row leaves it at 3.37) and scroll had put off-screen. So the
       * point now comes from the canvas's own client rectangle clamped to what is visible, it is resolved
       * again for every gesture, and the page is asked twice — what is under that point, and what actually
       * received the pointer.
       */
      const aim = () =>
        page.evaluate(() => {
          const scroller = document.querySelector('.pjsr-viewport');
          scroller.scrollTop = 0;
          scroller.scrollLeft = 0;
          const win = `${window.innerWidth}×${window.innerHeight}`;
          const rect = document.querySelector('.pjsr-page-canvas')?.getBoundingClientRect();
          if (!rect) return { error: 'there is no page canvas to aim at', win };
          const left = Math.max(rect.left, 0);
          const top = Math.max(rect.top, 0);
          const width = Math.min(rect.right, window.innerWidth) - left;
          const height = Math.min(rect.bottom, window.innerHeight) - top;
          if (width < 60 || height < 120) {
            return { error: `page 1 holds only ${Math.round(width)}×${Math.round(height)} visible px`, win };
          }
          // Left of centre and near the top: page 1 of this fixture carries annotations in the middle, and a
          // gesture that lands on one of them is the engine selecting a mark rather than the clause being asked.
          const x = Math.round(left + width * 0.2);
          const y = Math.round(top + Math.min(40, height * 0.15));
          const hit = document.elementFromPoint(x, y);
          const name = (node) =>
            node ? `${node.tagName.toLowerCase()}.${node.className?.baseVal ?? node.className ?? ''}` : '(nothing)';
          return {
            x,
            y,
            name: name(hit),
            layer: hit?.closest('.pjsr-editor-layer') instanceof Element,
            page: hit?.closest('.pjsr-page') instanceof Element,
            win,
            canvas: `${Math.round(rect.left)},${Math.round(rect.top)} ${Math.round(rect.width)}×${Math.round(rect.height)}`,
          };
        });

      /**
       * One finger, straight down, sixteen CSS px at a time.
       *
       * `wantLayer` is the premise: while a drawing tool is armed the editor layer is what is under the finger,
       * and if it is not, the gesture is aimed at chrome and its answer means nothing. The control run has no
       * such requirement — with nothing armed the page itself takes the touch. Both runs then compare what the
       * aim said with what the page recorded on arrival, because a disagreement there is a harness defect and
       * has to read as one rather than as a regression in the viewer.
       */
      const drag = async ({ wantLayer }) => {
        const at = await aim();
        if (at.error) fail(`cannot aim a one-finger drag: ${at.error} in a ${at.win} window`);
        if (wantLayer && !at.layer) {
          fail(
            `the armed touch point (${at.x},${at.y}) is over "${at.name}", not the editor layer (canvas ` +
              `${at.canvas}, window ${at.win}) — the gesture would not be a stroke on the page`,
          );
        }
        if (!at.page) fail(`the touch point (${at.x},${at.y}) is not over a page at all ("${at.name}")`);
        await reset();
        await cdp.send('Input.dispatchTouchEvent', {
          type: 'touchStart',
          touchPoints: [{ x: at.x, y: at.y, id: 1 }],
        });
        let mid = null;
        for (let step = 1; step <= 10; step += 1) {
          await cdp.send('Input.dispatchTouchEvent', {
            type: 'touchMove',
            touchPoints: [{ x: at.x, y: at.y + step * 16, id: 1 }],
          });
          await page.waitForTimeout(20);
          if (step === 5) mid = await read();
        }
        // `touches` is what is still on the glass; see the pinch row above for what happens when it lies.
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
        await page.waitForTimeout(700);
        const after = await read();
        const landed = after.first;
        if (landed && (Math.abs(landed.x - at.x) > 4 || Math.abs(landed.y - at.y) > 4)) {
          fail(
            `aimed at (${at.x},${at.y}) "${at.name}" but the page received the pointer at (${landed.x},` +
              `${landed.y}) on "${landed.name}" in a ${at.win} window — the two coordinate spaces disagree, so ` +
              'this row would be measuring its own aim',
          );
        }
        return { mid, after, at };
      };

      await pressInk();
      const armed = await read();
      if (armed.pressed !== 'true') fail(`the pen did not report itself armed (aria-pressed "${armed.pressed}")`);
      if (!armed.layerClass.includes('inkEditing')) {
        fail(`arming the pen left the editor layer as "${armed.layerClass}", so no drawing tool is active`);
      }
      const drawn = await drag({ wantLayer: true });
      // The stroke the finger made is committed by the engine when the mode changes, so the count that proves
      // it was *drawn* is read after the tool comes off — which is also how a reader gets their mark into the
      // document they then save.
      await pressInk();
      const committed = await read();

      if (drawn.mid.cancels || drawn.after.cancels) {
        fail(
          `the browser took the gesture while the pen was armed (${drawn.after.cancels} pointercancel over ` +
            `${drawn.after.moves} moves, first hit ${JSON.stringify(drawn.after.first)}) — a cancelled pointer ` +
            'draws nothing',
        );
      }
      if (!drawn.mid.livePaths) {
        fail(`no stroke was painted mid-drag (${JSON.stringify(drawn.mid)}), so the finger drew nothing`);
      }
      if (committed.inkEditors <= 0) {
        fail(`a one-finger drag with the pen armed committed ${committed.inkEditors} ink editors`);
      }

      // The control: the identical gesture with nothing armed must be taken by the browser.
      const off = await drag({ wantLayer: false });
      if (!off.after.cancels) {
        fail(
          `the control gesture was not cancelled either (${off.after.moves} moves, 0 cancels, first hit ` +
            `${JSON.stringify(off.after.first)}): this harness is not seeing touch-action, so the armed arm of ` +
            'this check proves nothing about the finger',
        );
      }
      if (off.after.inkEditors !== committed.inkEditors) {
        fail(
          `the disarmed drag added an ink editor (${committed.inkEditors} → ${off.after.inkEditors}): the ` +
            'gesture was a drawing even though the pen was off',
        );
      }

      return (
        `armed on "${drawn.at.name}" at (${drawn.at.x},${drawn.at.y}) of ${drawn.at.canvas} in ` +
        `${drawn.at.win}: ${drawn.after.moves} moves, ${drawn.after.cancels} cancel, ` +
        `${drawn.mid.livePaths} live path mid-drag, ${armed.inkEditors}→${committed.inkEditors} ink editors, ` +
        `layer "${armed.layerClass}", scroll ${armed.scrolled}→${committed.scrolled} | disarmed at ` +
        `(${off.at.x},${off.at.y}) on "${off.at.name}": cancelled after ${off.mid.moves} move(s), ` +
        `${off.after.inkEditors} editors unchanged`
      );
    },
  },
  {
    /*
     * FR-29's two clauses that jsdom cannot reach: "persisted by an incremental save" and "an editor survives
     * its page scrolling out and back".
     *
     * `src/features/annotate.lifecycle.test.tsx` guards the lifetime the package controls — one manager per
     * document, bound to the document an incremental save commits, disposed by the feature, and untouched by a
     * page coming and going. It cannot *author* anything: `pdfjs-dist` exports no editor classes from its
     * package root, and a mark is made by a pointer moving over an editor layer, which is a browser's input
     * pipeline and not a DOM shim's. So this row draws one real stroke and then asks the two questions of it:
     *
     *  - does it survive its page leaving the virtualized window and coming back? The premise is proved rather
     *    than assumed: the row **fails** if jumping to page 14 does not take page 1's editor element out of the
     *    document, because then the scroll never happened and the "survived" it would report means nothing;
     *  - does it reach the bytes? The file is saved through the viewer's own Download control, captured by the
     *    browser, and re-opened here by the same engine — with the fixture read off disk as the control, so a
     *    file that already carried an ink annotation would fail the row instead of quietly passing it.
     *
     * A mouse, not a finger: FR-47's touch exception is `pen-draws-not-scrolls`' job, and it needs CDP to ask.
     * What is under test here is what happens to the mark *after* it is drawn, which is engine and storage
     * rather than input. The save leg reports `skip` where an engine will not hand over the file, because a
     * capability that cannot be shown is a gap in the evidence rather than a green row.
     */
    name: 'authored-ink-survives-scroll-and-save',
    desktopOnly: true,
    run: async ({ page, load, reveal, jumpTo }) => {
      const engine = page.context().browser()?.browserType().name();
      await page.locator('.app-features label', { hasText: 'annotate' }).locator('input').check();
      await load('page-order-sample.pdf', 20);
      /*
       * Wait for the consequence of the click, not just its effect on the box. Playwright's `check()` reads the
       * input's `checked` property, which the browser sets as it processes the click — before React's `onChange`
       * has mounted the feature's controls — so this row used to reach `reveal('Ink')` against a bar that had
       * never been asked to grow (#276: webkit desktop, three runs of `no "Ink" control … and no overflow menu
       * to look in`, in a cell where the row after it armed the same pen and drew). An absent control group with
       * the box still checked is a product finding and this row says so; an unchecked box is this row's own
       * click, and the message names that too. The wait sits after the load because a bar with no document in
       * it is not the bar this row is about.
       */
      const mounted = await page
        .waitForSelector('.pjsr-annotate', { timeout: 10_000 })
        .then(() => true)
        .catch(() => false);
      if (!mounted) {
        const box = await page.evaluate(() => ({
          annotate: [...document.querySelectorAll('.app-features input')].find((i) =>
            (i.closest('label')?.textContent ?? '').includes('annotate'),
          )?.checked,
          group: document.querySelectorAll('.pjsr-annotate').length,
          labels: [...document.querySelectorAll('.pjsr-toolbar [aria-label]')].map((n) =>
            n.getAttribute('aria-label'),
          ),
        }));
        fail(
          `the annotate box reads ${box.annotate} and ${box.group} control group(s) are rendered 10 s after the ` +
            `document was ready, so this row's own precondition never arrived ` +
            `(${box.labels.length} labelled control(s) in the bar)`,
        );
      }
      // A box this row owns: the earlier rows leave the zoom wherever they parked it, and "out of the window"
      // is a statement about how much of a page a window holds.
      await page.selectOption(`${BAR} [aria-label="Zoom level"]`, 'automatic');

      const read = () =>
        page.evaluate(() => ({
          inkEditors: document.querySelectorAll('.pjsr-editor-layer .inkEditor').length,
          layerClass:
            document
              .querySelector('.pjsr-editor-layer')
              ?.className.replace('pjsr-editor-layer', '')
              .trim() ?? '(no editor layer)',
          pressed:
            document.querySelector('.pjsr-toolbar [aria-label="Ink"]')?.getAttribute('aria-pressed') ?? '?',
          mountedPages: document.querySelectorAll('.pjsr-page').length,
          scrolled: Math.round(document.querySelector('.pjsr-viewport')?.scrollTop ?? -1),
        }));

      /** Poll the live DOM until `predicate` accepts a reading, and hand back whichever reading it settled on. */
      const until = async (predicate, timeout = 12_000) => {
        let last = null;
        const hit = await waitFor(async () => {
          last = await read();
          return predicate(last) ? last : null;
        }, timeout);
        return hit ?? last;
      };

      /*
       * The top-left of page 1, clamped to what is actually visible, resolved after the arming (the bar grows
       * the pen's pointer-only sentence, which pushes the page down) — the same three lessons
       * `pen-draws-not-scrolls` records, applied to a mouse.
       */
      const aim = () =>
        page.evaluate(() => {
          const scroller = document.querySelector('.pjsr-viewport');
          scroller.scrollTop = 0;
          scroller.scrollLeft = 0;
          const win = `${window.innerWidth}×${window.innerHeight}`;
          const rect = document.querySelector('.pjsr-page-canvas')?.getBoundingClientRect();
          if (!rect) return { error: `there is no page canvas to aim at in ${win}` };
          const left = Math.max(rect.left, 0);
          const top = Math.max(rect.top, 0);
          const width = Math.min(rect.right, window.innerWidth) - left;
          const height = Math.min(rect.bottom, window.innerHeight) - top;
          if (width < 60 || height < 120) {
            return { error: `page 1 holds only ${Math.round(width)}×${Math.round(height)} visible px in ${win}` };
          }
          const x = Math.round(left + width * 0.15);
          const y = Math.round(top + Math.min(50, height * 0.12));
          const hit = document.elementFromPoint(x, y);
          const name = (node) =>
            node ? `${node.tagName.toLowerCase()}.${node.className?.baseVal ?? node.className ?? ''}` : '(nothing)';
          return {
            x,
            y,
            name: name(hit),
            layer: hit?.closest('.pjsr-editor-layer') instanceof Element,
            win,
            canvas: `${Math.round(rect.width)}×${Math.round(rect.height)}`,
          };
        });

      const pen = await reveal('Ink');
      await pen.click();
      await page.keyboard.press('Escape').catch(() => undefined);
      await page.waitForFunction(
        () => document.querySelector('.pjsr-editor-layer')?.className.includes('inkEditing') === true,
        undefined,
        { timeout: 15_000 },
      );

      const at = await aim();
      if (at.error) fail(`cannot aim a stroke at page 1: ${at.error}`);
      if (!at.layer) {
        fail(
          `the armed point (${at.x},${at.y}) is over "${at.name}" rather than the editor layer (canvas ` +
            `${at.canvas}, window ${at.win}), so the drag would not be a mark on the page`,
        );
      }
      await page.mouse.move(at.x, at.y);
      await page.mouse.down();
      for (let step = 1; step <= 8; step += 1) {
        await page.mouse.move(at.x + step * 7, at.y + step * 11, { steps: 2 });
      }
      await page.mouse.up();
      /*
       * Take the tool off *before* counting. The engine's ink editor holds several strokes in one drawing
       * session, so `endDrawing` builds the editor when the mode changes rather than at every pointerup — a
       * reading taken straight after `pointerup` sees the stroke on the draw layer and no editor element at
       * all. This row found that out by failing: the same gesture, measured after disarming, gives one editor.
       */
      await pen.click();
      const drawn = await until((state) => state.inkEditors >= 1);
      if (drawn.inkEditors < 1) {
        fail(
          `a mouse drag over (${at.x},${at.y}) with the pen armed, and the tool then taken off, produced ` +
            `${drawn.inkEditors} ink editors (layer "${drawn.layerClass}", aria-pressed ${drawn.pressed}) — ` +
            'nothing was drawn, so the rest of this row has nothing to follow',
        );
      }

      // The scroll-out leg, and its premise proved by the element going away.
      await jumpTo(14);
      const away = await until((state) => state.inkEditors === 0);
      if (away.inkEditors !== 0) {
        fail(
          `page 1's ink editor was still in the document after jumping to page 14 (${away.inkEditors} editors, ` +
            `${away.mountedPages} of 20 pages mounted, scroll ${away.scrolled}) — the page never left the ` +
            'virtualized window, so "survives scrolling out and back" was never asked',
        );
      }
      const mountedAway = away.mountedPages;
      await jumpTo(1);
      const back = await until((state) => state.inkEditors >= 1);
      if (back.inkEditors < 1) {
        fail(
          `page 1 came back with ${back.inkEditors} ink editors (${back.mountedPages} pages mounted, scroll ` +
            `${back.scrolled}, layer "${back.layerClass}") after holding ${drawn.inkEditors} — the mark the ` +
            `reader drew did not survive its page leaving the window (${mountedAway} pages mounted there)`,
        );
      }

      // The save leg, through the viewer's own control.
      let captureError = null;
      const pending = page
        .waitForEvent('download', { timeout: 25_000 })
        .catch((error) => {
          captureError = error;
          return null;
        });
      const save = await reveal('Download document');
      await save.click();
      const download = await pending;
      if (!download) {
        return skip(
          `${engine}: the save leg could not be captured (${errText(captureError)}) — the mark was drawn at ` +
            `(${at.x},${at.y}) and survived page 1 leaving the window and returning, but its bytes were never read`,
        );
      }
      const bytes = await savedBytes(download);
      const saved = await countSubtype(bytes, 1, 'Ink');
      const original = new Uint8Array(
        readFileSync(join(repo, 'playground/fixtures/page-order-sample.pdf')),
      );
      const control = await countSubtype(original, 1, 'Ink');
      if (control.count !== 0) {
        fail(
          `the fixture already carries ${control.count} ink annotations on page 1 (it holds ${control.all}), so ` +
            "a mark the reader made cannot be told from one the file arrived with — this row's control is broken",
        );
      }
      if (saved.count < 1) {
        fail(
          `the saved ${bytes.length}-byte file (${download.suggestedFilename()}) carries ${saved.count} ink ` +
            `annotations on page 1 (it holds ${saved.all || 'nothing'}) where the fixture held none — the mark ` +
            'was drawn, seen on screen, re-mounted after a scroll, and never reached the bytes',
        );
      }
      return (
        `drew at (${at.x},${at.y}) of a ${at.canvas} page 1 in ${at.win}: ${drawn.inkEditors} editor ` +
        `committed, ${mountedAway} pages mounted at 14 with page 1 gone, back to ${back.inkEditors} editor on ` +
        `return, ${download.suggestedFilename()} saved as ${bytes.length} bytes and re-opened with ` +
        `${saved.count} /Ink on page 1 against ${control.count} in the fixture`
      );
    },
  },
  {
    /*
     * FR-43: the structure tree as an assistive technology is handed it, not as a DOM shape.
     *
     * `src/lib/tagged.test.ts` reads the tree out of the engine and `PdfPage.structure.test.tsx` proves both
     * layers were handed the builder — which is the wiring, and nothing more. The clause is about what the
     * reader gets: "heading, list and table hierarchy instead of an undifferentiated run of text", and "a
     * widget is announced with its owning node rather than as an unlabelled control". Neither is a jsdom
     * question: jsdom has no accessibility tree, and axe checks the tree it derives against rules, not the
     * ownership the clause names.
     *
     * So this row asks Playwright's own aria snapshot, which every engine here serves from its inspector
     * protocol, and reads the ownership the engine writes: `aria-owns` from the link annotation onto the
     * structure elements its words sit in. The two halves are asserted together on purpose — a page can carry
     * `role="heading"` elements that nothing references while the link still reads as a bare control, and a
     * link can own its text while the hierarchy was never mounted.
     *
     * The second document is the clause's degrade, measured rather than assumed: the same feature left
     * mounted, an untagged file, no structure root anywhere, the text layer still there, and no page error
     * raised on the way. `null` from `getStructTree()` and a swallowed exception look identical in the UI.
     *
     * …and it comes *first*, because the tier's cost model is a request. `structure.tsx` fetches
     * `pdfjs-dist/web/pdf_viewer.mjs` — about 50 kB gzipped, and the docs promise it is fetched only for a
     * document that declares a structure tree. jsdom proves that by counting reads of the exported class
     * (`structure.test.tsx`, which fails five cases if the gate is dropped); in a browser the same fact is a
     * network request, and a request is what a consumer pays. Loading the untagged file first is what makes
     * that measurable at all: fetch the chunk once and every later document is served from the page's own
     * module cache, so the second reading would answer zero for reasons that have nothing to do with the gate.
     */
    name: 'structure-tree-in-the-accessibility-tree',
    desktopOnly: true,
    run: async ({ page, load, pageErrors }) => {
      const engine = page.context().browser()?.browserType().name();
      const viewerRequests = [];
      const onRequest = (request) => {
        if (/pdf_viewer/.test(request.url())) viewerRequests.push(request.url().split('/').pop());
      };
      page.on('request', onRequest);
      await page.locator('.app-features label', { hasText: 'structure' }).locator('input').check();
      const errorsBefore = pageErrors.length;

      // The degrade, asked before it has anything to cache.
      await load('page-order-sample.pdf', 20);
      await page.waitForTimeout(1_500);
      const untagged = await page.evaluate(() => ({
        roots: document.querySelectorAll('.structTree').length,
        spans: document.querySelectorAll('.pjsr-text-layer span').length,
        errorState: document.querySelector('.pjsr-status')?.textContent ?? '',
      }));
      const untaggedFetch = viewerRequests.length;
      if (untagged.roots !== 0) {
        fail(`an untagged document mounted ${untagged.roots} structure tree(s) — the gate reads the document, not a hope`);
      }
      if (untagged.spans === 0) {
        fail('an untagged document lost its text layer along with the structure tree, which is the degrade done wrong');
      }
      if (untaggedFetch !== 0) {
        fail(
          `an untagged document fetched ${untaggedFetch} viewer chunk(s) (${untaggedFetch ? viewerRequests[0] : '-'}) ` +
            '— the tier costs nothing for a file that declares no structure tree, and the docs say so',
        );
      }

      await load('tagged-sample.pdf', 2);
      await waitFor(
        () => page.evaluate(() => document.querySelectorAll('.structTree').length > 0),
        15_000,
      );
      const taggedFetch = viewerRequests.length;

      /*
       * The engine axis (#194) reads this row at the advertised floor as well as at the current release, and the
       * floor has no link-ownership code at all: `enableLinkOwnership` appears twice in 6.3.289's `build/pdf.mjs`
       * and not once in 6.2.108's, which is what the first axis run showed in all three engines. The tier says so
       * itself — `structureFeature.engineRequirements`, minimum 6.3.289 — and this is the same number, kept from
       * drifting by `src/features/structure.engine-floor.test.tsx`. Below the minimum the row asserts the
       * *declared* shape rather than the wanted one, because a row that only ever checks the happy case cannot
       * notice an engine gaining or losing the behaviour, which is the whole point of declaring a boundary.
       */
      const LINK_OWNERSHIP_MINIMUM = '6.3.289';
      const ownsLinks = releaseAtLeast(engineVersion, LINK_OWNERSHIP_MINIMUM);

      const readDom = () =>
        page.evaluate(() => {
          const roots = [...document.querySelectorAll('.structTree')];
          const roles = new Set();
          for (const root of roots) {
            for (const el of root.querySelectorAll('[role]')) roles.add(el.getAttribute('role'));
          }
          const link = document.querySelector('.pjsr-annotation-layer a');
          const owned = (link?.getAttribute('aria-owns') ?? '')
            .split(' ')
            .filter(Boolean)
            .map((id) => {
              const el = document.getElementById(id);
              return el
                ? {
                    id,
                    inTree: !!el.closest('.structTree'),
                    role: el.getAttribute('role') ?? el.tagName.toLowerCase(),
                  }
                : { id, inTree: false, role: '(no such element)' };
            });
          return {
            roots: roots.length,
            roles: [...roles].sort(),
            link: link
              ? {
                  owns: owned,
                  ownsCount: owned.filter((entry) => entry.inTree).length,
                  name: link.getAttribute('aria-label') ?? '',
                }
              : null,
          };
        });

      /*
       * Waited for, not read once. The annotation layer is built and the engine writes `aria-owns` onto it
       * afterwards, so a single read can land between the two and report a link that owns nothing — which is what
       * webkit · desktop did twice on 2026-10-07, once green and once red, on the *same* build and with the
       * annotate feature never even mounted in that cell. Same family as #246's mark premise and #248's
       * read-back: the row has to wait for the state its claim is about, and the below-minimum branch still
       * asserts the absence, so an engine that gained the ownership is caught rather than waited away.
       */
      let dom = null;
      const settledDom = await waitFor(async () => {
        dom = await readDom();
        if (!dom || dom.roots === 0 || !dom.link) return null;
        return ownsLinks ? (dom.link.ownsCount > 0 ? dom : null) : dom;
      }, 20_000);
      if (!settledDom) {
        fail(
          `no structure tree with a mounted link annotation settled within 20 s on ${engine} ` +
            `(${engineVersion}): ${JSON.stringify(dom)} — the tree is built by the tier's lazy import and the ` +
            'link by the annotation layer, and the ownership is written after both',
        );
      }
      dom = settledDom;

      if (dom.roots === 0) {
        fail('no structure tree was mounted on a document that declares one — the feature fetched nothing or the gate refused');
      }
      if (taggedFetch === 0) {
        fail('a tagged document mounted a structure tree without fetching the viewer it is built from — the tree came from somewhere the tier does not name');
      }
      // The hierarchy the clause names, read off the elements the builder wrote. Every role here is one the
      // fixture declares: `tagged-sample.pdf` is authored as H1, three list items, a figure and a table.
      const wanted = ['heading', 'list', 'listitem', 'figure', 'table', 'row', 'columnheader', 'cell'];
      const missing = wanted.filter((role) => !dom.roles.includes(role));
      if (missing.length) {
        fail(`the structure tree carries no ${missing.join(', ')} — it read ${dom.roles.join(', ')}`);
      }
      if (!dom.link) {
        fail('the tagged fixture carries a link annotation and the annotation layer mounted none, so the ownership half of the clause could not be asked');
      }
      if (ownsLinks && dom.link.ownsCount === 0) {
        fail(
          `the link annotation owns nothing in the structure tree on ${engineVersion} (aria-owns ${JSON.stringify(dom.link.owns)}): ` +
            'an unlabelled control is what a reader gets when the widget and its words are not connected',
        );
      }
      if (!ownsLinks && (dom.link.ownsCount !== 0 || dom.link.name !== '')) {
        fail(
          `the link owns ${dom.link.ownsCount} element(s) and reads "${dom.link.name}" on ${engineVersion}, which is ` +
            `below the declared minimum ${LINK_OWNERSHIP_MINIMUM} — the engine moved and ` +
            'either the feature’s `engineRequirements` or this row is now out of date',
        );
      }

      /*
       * The a11y tree itself, in the engine's own words. This is the assertion the clause is actually about:
       * the roles above could be present in a DOM that no assistive technology reads, and `aria-owns` could
       * resolve to elements the engine ignores. Playwright's snapshot is built from each engine's accessibility
       * protocol, so what appears here is what an AT is handed.
       */
      const snapshot = await page.locator('.pjsr-page').first().ariaSnapshot();
      const lines = snapshot.split('\n');
      const paragraphAt = lines.findIndex((line) => /^\s*- paragraph:$/.test(line));
      const linkAt = lines.findIndex((line) => /- link "/.test(line));
      const indent = (line) => (/^(\s+)/.exec(line)?.[1] ?? '').length;
      const nestedUnderParagraph =
        paragraphAt >= 0 && linkAt === paragraphAt + 1 && indent(lines[linkAt]) > indent(lines[paragraphAt]);
      if (!/heading "Quarterly report"/.test(snapshot)) {
        fail(`the accessibility tree calls no heading by its text. Snapshot began:\n${snapshot.slice(0, 400)}`);
      }
      if (!/listitem:/.test(snapshot)) {
        fail('the accessibility tree has no list items, so the list is a run of text again');
      }
      const linkLine = linkAt >= 0 ? lines[linkAt].trim() : '(no link node in the snapshot)';
      if (!ownsLinks) {
        // Nothing is asserted about the link below the minimum except that the layer still rendered it: what it
        // is *called* there is the destination URL, which is the degradation the feature declares rather than a
        // defect, and the row's own text carries what the engine produced so a run reads as a measurement.
        if (linkAt < 0) {
          fail(`the annotation layer mounted a link element but the accessibility tree has no link node at all on ${engineVersion}`);
        }
      } else {
        if (!nestedUnderParagraph) {
          fail(
            `the link is not announced inside its owning paragraph (paragraph at line ${paragraphAt + 1}, link ` +
              `at line ${linkAt + 1}: "${linkLine}") — it owns ${dom.link.ownsCount} structure element(s), which ` +
              'is the wiring, but the tree still reads it flat',
          );
        }
        if (!/link "See the annual statement"/.test(snapshot)) {
          fail(`the link is announced with no name: "${linkLine}"`);
        }
      }

      // The figure's alternative text, which arrives from `/Alt` and nowhere else.
      const figure = await page.evaluate(() => {
        for (const root of document.querySelectorAll('.structTree')) {
          const el = root.querySelector('[role="figure"][aria-label]');
          if (el) return el.getAttribute('aria-label');
        }
        return null;
      });
      if (!figure || !/bar chart/i.test(figure)) {
        fail(`the figure is announced as ${JSON.stringify(figure)}, not the alternative text the file carries`);
      }

      page.off('request', onRequest);
      if (pageErrors.length > errorsBefore) {
        fail(`the two documents raised ${pageErrors.length - errorsBefore} page error(s): ${pageErrors[errorsBefore]}`);
      }

      return (
        `untagged first: 0 trees, ${untagged.spans} spans, ${untaggedFetch} requests for the viewer chunk; ` +
        `then tagged: ${dom.roots} tree(s) over ${dom.roles.join('/')} after ${taggedFetch - untaggedFetch} ` +
        `fetch of ${viewerRequests[0] ?? '?'}, the heading called by its text; ` +
        (ownsLinks
          ? `link owns ${dom.link.ownsCount} in-tree element(s) ` +
            `(${dom.link.owns.map((o) => `${o.id.slice(-8)}→${o.role}`).join(', ')}) and is announced as a named ` +
            'link inside its paragraph'
          : `engine ${engineVersion} is below the tier's declared ${LINK_OWNERSHIP_MINIMUM} minimum, so the link ` +
            `is asserted absent rather than wired: owns ${dom.link.ownsCount}, label ${JSON.stringify(dom.link.name)}, ` +
            `announced as ${JSON.stringify(linkLine.slice(0, 60))}`) +
        `; figure named "${(figure ?? '').slice(0, 34)}" from /Alt`
      );
    },
  },
  {
    /*
     * FR-43's noun is a widget, and until this row the repository had never put one inside a structure tree:
     * `tagged-sample.pdf` carries a link (which is what `enableLinkOwnership` is written for) and
     * `form-sample.pdf` carries fields with no tree at all, so the sentence "a widget is announced with its
     * owning node rather than as an unlabelled control" was measured on the annotation that is not a widget
     * (#268's gap). `tagged-form-sample.pdf` is authored for exactly this question, and it now has two
     * widgets because there are two honest answers:
     *
     *  - `reviewerName` sits in a `/Form` element carrying `/Alt (Reviewer name)`. pdf.js's
     *    `StructTreeLayerBuilder.#setAttributes` walks such an element, and for every kid of type
     *    `annotation` it puts the `/Alt`, verbatim, into the table `AnnotationLayer` asks for by annotation
     *    id — so the owner names the control. That is the clause's own mechanism, and it is the engine's,
     *    **and the engine only from 6.3.289.** At the advertised floor the same document puts the `/Alt` on
     *    the `/Form` node inside the structure tree and never reaches the widget, which #277 found by
     *    running this row at both releases on one host and in all three desktop engines in CI's floor cell.
     *    So the row asserts the engine's half where the engine has it and the degradation where it does not,
     *    the way #249 made the link-ownership row say the same kind of thing — reached separately, because
     *    the two mechanisms differ and only the number coincides.
     *  - `reviewerComments` has no `/Alt` and no `/TU` either, so the engine has nothing to say. The name it
     *    arrives with is the shell's: `src/lib/annotation-names.ts` (#267) lends it the field name the engine
     *    wrote onto `name`. Asserting both in one row is the point — a file with only the first case would
     *    pass while the producer that forgot to label anything got nothing, and a file with only the second
     *    would credit the shell with the engine's work.
     *
     * Both halves also assert what a name must not cost: the field still holds its value and is still tabbable,
     * which is the trap #267 measured and refused (`aria-hidden` silences axe and takes the control away).
     */
    name: 'widget-named-by-its-owning-node',
    desktopOnly: true,
    run: async ({ page, load, pageErrors }) => {
      // The tier has to be on for the structure layer to reach the annotation layer at all. Checking the box
      // is idempotent, and it is checked here rather than inherited from the row above because a row that
      // depends on another row's state is a row that changes when the order does (#254, #248).
      await page.locator('.app-features label', { hasText: 'structure' }).locator('input').check();
      const errorsBefore = pageErrors.length;
      await load('tagged-form-sample.pdf', 1);
      await page
        .waitForSelector('.pjsr-annotation-layer input[name="reviewerName"]', { timeout: 30_000 })
        .catch(() => undefined);
      await page.waitForTimeout(1_500);

      const read = await page.evaluate(() => {
        const fields = [...document.querySelectorAll('.pjsr-annotation-layer input, .pjsr-annotation-layer textarea')].map(
          (el) => ({
            name: el.getAttribute('name') ?? '',
            id: el.id,
            label: el.getAttribute('aria-label') ?? '',
            owns: el.getAttribute('aria-owns') ?? '',
            value: el.value ?? '',
            tabbable: el.tabIndex >= 0,
          }),
        );
        const owned = [...document.querySelectorAll('.structTree [aria-owns]')].flatMap((el) =>
          (el.getAttribute('aria-owns') ?? '').split(/\s+/).filter(Boolean),
        );
        // Which node carries the alt is precisely what differs between the two releases, so the row reads
        // the tree's own names as well as the widgets'.
        const labelled = [...document.querySelectorAll('.structTree *')]
          .map((el) => ({
            role: el.getAttribute('role') ?? '',
            label: (el.getAttribute('aria-label') ?? '').trim(),
          }))
          .filter((t) => t.label);
        return { fields, trees: document.querySelectorAll('.structTree').length, owned, labelled };
      });

      const byName = (name) => read.fields.find((f) => f.name === name);
      for (const name of ['reviewerName', 'reviewerComments']) {
        if (!byName(name)) {
          fail(
            `the tagged form fixture mounted ${read.fields.length} control(s) ` +
              `[${read.fields.map((f) => f.name || '(no name)').join(', ')}] and none of them is ` +
              `"${name}", so there is no widget to ask about — ${read.trees} structure tree(s) on the page`,
          );
        }
      }

      const named = byName('reviewerName');
      // Measured, not assumed (2026-10-08, chromium on this host with the engine pinned and proved by
      // `pin-tree.mjs check --exact`, and in all three desktop engines in CI's floor cell at 048c608): at
      // 6.3.289 the widget itself carries "Reviewer name" and no tree node is named; at 6.2.108 the /Form
      // node in the tree carries `role=form aria-label="Reviewer name"` and the widget keeps the name the
      // shell lends it. Nothing was published between the two, so the boundary is 6.3.289.
      const WIDGET_ALT_MINIMUM = '6.3.289';
      const altOnWidget = releaseAtLeast(engineVersion, WIDGET_ALT_MINIMUM);
      const arrivesOnWidget = named.label === 'Reviewer name';
      const arrivesOnOwningNode = read.labelled.some((t) => t.role === 'form' && t.label === 'Reviewer name');
      const treeNames = read.labelled.map((t) => `${t.role || '(no role)'}="${t.label}"`).join(', ') || '(none)';
      if (altOnWidget && !arrivesOnWidget) {
        fail(
          `engine ${engineVersion} is at or above the measured ${WIDGET_ALT_MINIMUM} boundary, where the owning ` +
            `/Form element's /Alt arrives on the widget itself; it arrived as aria-label ` +
            `${JSON.stringify(named.label)} instead. Tree nodes carrying a name: ${treeNames}; ` +
            `${read.trees} tree(s), ${read.owned.length} owned ids`,
        );
      }
      if (!altOnWidget && !arrivesOnWidget && !arrivesOnOwningNode) {
        fail(
          `engine ${engineVersion} is below ${WIDGET_ALT_MINIMUM}, where the /Alt belongs on the owning node ` +
            `inside the tree — but it is on neither the widget (aria-label ${JSON.stringify(named.label)}) nor a ` +
            `role=form tree node, so the document's own alt reached no accessibility name at all. Tree nodes ` +
            `carrying a name: ${treeNames}`,
        );
      }
      // What the clause owes a reader does not depend on the boundary: the widget is announced with a name.
      if (!named.label) {
        fail(`the widget for reviewerName arrives with no accessible name at all on engine ${engineVersion}`);
      }

      const bare = byName('reviewerComments');
      if (bare.label !== 'reviewerComments') {
        fail(
          `the widget the file says nothing about arrived as aria-label ${JSON.stringify(bare.label)}; the shell's ` +
            'naming pass (#267) is expected to lend it the field name the engine put on `name`, and a different ' +
            'value means either the pass did not run or the file grew a label the row does not know about',
        );
      }

      for (const field of [named, bare]) {
        if (!field.tabbable) {
          fail(`the widget "${field.name}" is not tabbable — a name that costs keyboard access is not a fix (#267 measured this)`);
        }
        if (!field.value) {
          fail(`the widget "${field.name}" lost its value on the way to being named`);
        }
      }

      // The floor differs in one more place than the label. The id the tree writes is the bare annotation id
      // (`6R`) while the element the annotation layer mounts is `pdfjs_internal_id_6R`: the
      // `#getStructElementId` prefix arrived with 6.3.289, the same release that moved the /Alt onto the
      // widget — measured on the same two pinned runs (2026-10-08, chromium, this host). The claim this row
      // is asked to check is "the tree names the widget", which is true under either spelling, so the match
      // accepts both and the verdict line prints which form it found.
      const stripped = (id) => id.replace(/^pdfjs_internal_id_/, '');
      const claimedBy = (f) =>
        read.owned.includes(f.id) ? f.id : read.owned.includes(stripped(f.id)) ? stripped(f.id) : null;
      const unowned = [named, bare].filter((f) => !claimedBy(f)).map((f) => `${f.name} (${f.id})`);
      if (unowned.length) {
        fail(
          `${unowned.join(' and ')} is not in any owning element's aria-owns list, so the structure tree does not ` +
            `claim the widget at all — owned ids seen: ${read.owned.slice(0, 8).join(', ') || '(none)'}`,
        );
      }

      if (pageErrors.length > errorsBefore) {
        fail(`this row raised ${pageErrors.length - errorsBefore} new page error(s): ${pageErrors[errorsBefore]}`);
      }

      return (
        `2 widgets, ${read.trees} tree(s) on engine ${engineVersion}: reviewerName arrives "${named.label}" ` +
        (altOnWidget
          ? "from its owning /Form element's /Alt, which this release puts on the widget"
          : `from the shell's pass, because this release is below the measured ${WIDGET_ALT_MINIMUM} boundary ` +
            'where the /Alt reaches the widget; the /Alt itself sits on the role=form node in the tree here') +
        `, reviewerComments arrives "${bare.label}" from the shell's naming pass (the file says nothing about it); ` +
        `both tabbable with their values (${[named, bare].map((f) => f.value).join(', ')}), both claimed by the ` +
        `structure DOM's aria-owns as ${[named, bare].map((f) => claimedBy(f)).join(', ')}`
      );
    },
  },
  {
    name: 'forced-colours',
    desktopOnly: true,
    run: async ({ page, load, reveal }) => {
      const engineName = () => page.context().browser()?.browserType().name();
      await load('page-order-sample.pdf', 20);
      try {
        await page.emulateMedia({ forcedColors: 'active' });
      } catch (error) {
        return skip(`emulateMedia(forcedColors) is not offered: ${firstLine(error)}`);
      }
      const state = await page.evaluate(() => {
        const slot = document.querySelector('.pjsr-page-slot');
        const cs = slot ? getComputedStyle(slot) : null;
        return {
          matches: matchMedia('(forced-colors: active)').matches,
          outline: cs ? `${cs.outlineStyle} ${cs.outlineWidth}` : 'no slot',
          shadow: cs ? cs.boxShadow : '',
        };
      });
      if (!state.matches) return skip('the engine still reports forced-colors as inactive under emulation');
      if (!state.outline.startsWith('solid')) fail(`page slot outline is "${state.outline}", not a solid line"`);
      if (state.shadow !== 'none') fail(`the page kept its drop shadow: ${state.shadow}`);
      /*
       * FR-44's other half, read where the mark is actually painted. The clause names three signals that must
       * not rely on hue alone and the search marks were the ones already asserted; an annotation highlight is
       * the one whose *only* content is the tint, and a forced palette is exactly where the tint stops being
       * information. Read while the emulation is still on, and from the document that carries the markup —
       * `annotated-sample.pdf`, because asserting against a page with no annotations would pass by absence.
       */
      await load('annotated-sample.pdf', 2);
      const painted = await waitFor(
        () =>
          page.evaluate(() => {
            const el = document.querySelector('.pjsr-annotation-layer section.highlightAnnotation');
            if (!el) return null;
            const cs = getComputedStyle(el);
            const box = el.getBoundingClientRect();
            return {
              outline: `${cs.outlineStyle} ${cs.outlineWidth}`,
              colour: cs.outlineColor,
              width: Math.round(box.width),
            };
          }),
        8_000,
      );
      if (!painted) {
        fail('the annotation layer never painted a highlight from annotated-sample.pdf, so its edge could not be read');
      }
      if (!painted.outline.startsWith('solid') || painted.width <= 0) {
        fail(
          `a forced palette left the highlight with "${painted.outline}" on a ${painted.width}px box — ` +
            'the tint is overridden here, so an edge is the only thing marking it',
        );
      }
      /*
       * FR-44's remaining two signals, and the sentence it names outright: "focus remains visible".
       *
       * Both were asserted as *declarations* in `src/styles/forced-colors.test.ts` and never painted, which is
       * the weak half of that file's own argument — a declaration is not a channel in the one rendering mode
       * that exists to override declarations. So read them here, on a document that carries the marks: a
       * search for `license` over `page-order-sample.pdf`, whose hits are the tinted spans.
       */
      await load('page-order-sample.pdf', 20);
      const searchToggle = await reveal('Search document');
      await searchToggle.click();
      await page.waitForSelector('.pjsr-search-input');
      // `MARKER` is the word this fixture was generated to be found by; a query that matches nothing
      // would leave this row reporting the palette's flatness on an empty page.
      await page.fill('.pjsr-search-input', 'MARKER');
      await page.press('.pjsr-search-input', 'Enter');
      // Wait for the *resting* mark, not for the first one any mark at all. The walk is incremental, so a row
      // that settles as soon as anything is painted finds the middle of it: on the webkit cell of CI run
      // 37390542384 that was a single match — the active one — and this row then reported that the clause's
      // colour-only signal had nothing to be read on, one run after the same cell had read all six signals with
      // no code touching the row in between. Chromium and firefox have two marks by the time anything exists;
      // the fix is to wait for the state the claim describes rather than for a sign of work.
      const haveResting = await waitFor(
        () => page.evaluate(() => document.querySelectorAll('mark.pjsr-mark:not(.pjsr-mark--active)').length || null),
        25_000,
      );
      if (!haveResting) {
        const seen = await page.evaluate(() => {
          const count = document.querySelectorAll('mark.pjsr-mark').length;
          const active = document.querySelectorAll('mark.pjsr-mark--active').length;
          return `${count} mark(s), ${active} of them active, readout "${
            document.querySelector('.pjsr-search-count')?.textContent ?? '(none)'
          }"`;
        });
        fail(`the search never painted a resting mark within 25 s — ${seen}`);
      }
      const marks = await page.evaluate(() => {
        const pick = (el) => {
          if (!el) return null;
          const cs = getComputedStyle(el);
          return {
            rule: `${cs.borderBottomStyle} ${cs.borderBottomWidth}`,
            ring: `${cs.outlineStyle} ${cs.outlineWidth}`,
            box: Math.round(el.getBoundingClientRect().width),
          };
        };
        return {
          count: document.querySelectorAll('mark.pjsr-mark').length,
          plain: pick(document.querySelector('mark.pjsr-mark:not(.pjsr-mark--active)')),
          active: pick(document.querySelector('mark.pjsr-mark--active')),
        };
      });
      if (!marks.plain) {
        fail(
          `the search made ${marks.count} marks and none of them was the resting kind, so the clause's ` +
            'first colour-only signal had nothing to be read on',
        );
      }
      if (!marks.plain.rule.startsWith('solid') || marks.plain.box <= 0) {
        fail(
          `a forced palette left the search mark with the rule "${marks.plain.rule}" on a ${marks.plain.box}px ` +
            'box — the tint is flattened here, so the rule is the whole channel',
        );
      }
      if (marks.active && !marks.active.ring.startsWith('solid')) {
        fail(`the active match reached a forced palette with the ring "${marks.active.ring}"`);
      }

      /*
       * Focus, reached the way a keyboard reader reaches it. This arm first used `element.focus()` and read
       * `outline: none 3px` off a toolbar button — which is Chromium declining to call a programmatic focus
       * `:focus-visible`, not a viewer that hides focus. Tab is the state the clause is about.
       */
      await page.keyboard.press('Tab');
      let focus = null;
      for (let step = 0; step < 24; step += 1) {
        await page.keyboard.press('Tab');
        focus = await page.evaluate(() => {
          const el = document.activeElement;
          if (!el || !el.closest('.pjsr-toolbar, .pjsr-search, .pjsr-viewport, .pjsr-sidebar')) return null;
          const cs = getComputedStyle(el);
          return {
            label: `${el.tagName.toLowerCase()}[${el.getAttribute('aria-label') ?? ''}]`,
            outline: `${cs.outlineStyle} ${cs.outlineWidth} ${cs.outlineColor}`,
            visible: el.matches(':focus-visible'),
          };
        });
        if (focus) break;
      }
      if (!focus) fail('Tab never reached the viewer’s own chrome, so focus could not be asked');
      if (!focus.visible || /^(none|0px)/.test(focus.outline)) {
        fail(`a keyboard-focused ${focus.label} reports "${focus.outline}" (:focus-visible ${focus.visible}) under a forced palette`);
      }
      /*
       * And which ring that was. This arm first stopped at the line above, and a counterfactual that deleted
       * `.pjsr-button:focus-visible` from the sheet **passed it**: under a forced palette Chromium paints its
       * own focus ring, `auto 1px`, so "focus is visible" can be the engine's answer rather than ours. Read
       * the same element with the palette off, where nothing overrides the author's outline, and the ring has
       * to be the one this package declared — which is also the only way this row can tell that the token is
       * the thing re-pointed by the palette rather than a default the browser would have supplied anyway.
       */
      await page.emulateMedia({ forcedColors: 'none' });
      const resting = await page.evaluate(() => {
        const cs = getComputedStyle(document.activeElement);
        return `${cs.outlineStyle} ${cs.outlineWidth} ${cs.outlineColor}`;
      });
      await page.emulateMedia({ forcedColors: 'active' });
      if (!/^solid 2px/.test(resting)) {
        fail(
          `the focused ${focus.label} shows "${resting}" with the palette off, so the ring seen under a forced ` +
            `palette ("${focus.outline}") is the browser's, not this sheet's`,
        );
      }

      /*
       * The editor's half of the highlight signal — a mark the reader is making *now*, in the layer that is
       * not the file's. Its resting channel is a `box-shadow`, and a forced palette does not re-point a
       * shadow: it removes one. Measured before the fix, the element reported `box-shadow: none`,
       * `outline: none`, `border: 0` and a transparent background on a 98×50 box — a mark with no channel at
       * all, which is the failure `annotate.css` now answers with a border inside its forced block.
       *
       * A rectangle drag started on the text layer's own surface, because that is where pdf.js begins a
       * highlight drawing: `#textLayerPointerDown` only starts one when the pointerdown lands on the layer
       * div rather than on a word. Where an engine will not take the gesture, the arm says so in the report
       * instead of passing a claim it did not measure.
       */
      await page.locator('.app-features label', { hasText: 'annotate' }).locator('input').check();
      await page.locator(`${BAR} [aria-label="Highlight"]:visible`).click();
      const stroke = await page.evaluate(() => {
        const span = [...document.querySelectorAll('.pjsr-text-layer span')].find(
          (node) => (node.textContent ?? '').trim().length > 3,
        );
        const rect = span?.getBoundingClientRect();
        return rect && rect.width > 20
          ? { x: Math.round(rect.left) - 6, y: Math.round(rect.top + rect.height / 2) - 7 }
          : null;
      });
      let authored = null;
      let authoredNote = 'the mark was never drawn';
      if (stroke) {
        await page.mouse.move(stroke.x, stroke.y);
        await page.mouse.down();
        await page.mouse.move(stroke.x + 90, stroke.y + 16, { steps: 8 });
        await page.mouse.up();
        authored = await waitFor(
          () =>
            page.evaluate(() => {
              const el = document.querySelector('.highlightEditor .internal');
              if (!el) return null;
              const cs = getComputedStyle(el);
              const box = el.getBoundingClientRect();
              return {
                edge: `${cs.borderTopStyle} ${cs.borderTopWidth} ${cs.borderTopColor}`,
                shadow: cs.boxShadow,
                box: `${Math.round(box.width)}×${Math.round(box.height)}`,
              };
            }),
          10_000,
        );
      }
      await page.emulateMedia({ forcedColors: 'none' });

      if (authored) {
        if (!/^solid 1px/.test(authored.edge)) {
          fail(
            `a highlight the reader drew sits under a forced palette with the border "${authored.edge}" and ` +
              `the box-shadow "${authored.shadow}" on a ${authored.box} box — the palette removes shadows, ` +
              'which is the entire reason the sheet carries an edge of its own there',
          );
        }
        authoredNote = `editor mark edged ${authored.edge} on ${authored.box} (shadow ${authored.shadow})`;
      } else if (stroke) {
        authoredNote = `${engineName()}: a rectangle drag made no highlight editor, so the edge was not read there`;
      }

      return (
        `matchMedia active, slot ${state.outline}, shadow removed; file highlight edge ${painted.outline} ` +
        `${painted.colour} on ${painted.width}px; search mark rule ${marks.plain.rule} on ${marks.plain.box}px, ` +
        `active ring ${marks.active ? marks.active.ring : '(none mounted)'}; focus ${focus.label} forced ` +
        `"${focus.outline}" against the sheet's own "${resting}"; ` +
        `${authoredNote}`
      );
    },
  },
  {
    /*
     * FR-19: the sheet, in a browser, at the resolution the memory budget paid for.
     *
     * Everything the clause says about *planning* is asserted in Node — `print.test.ts` over the ladder and the
     * refusal, `usePdfPrint.ceilings.test.tsx` against the engine's own byte estimate. What no jsdom run can
     * show is the sentence's nouns: a **sheet** (a canvas with pixels on it, laid out by a stylesheet that is
     * only read in print media) and **everything else hidden**. jsdom resolves no media query against a layout,
     * so the last six rows of `print.css` are, there, a string.
     *
     * `window.print()` opens the platform's own dialog, which no headless engine answers, and the pipeline
     * tears the container down the moment that call returns — so the observer is installed *at that boundary*
     * and reads the live DOM from inside it. The override is the app's own edge, not a private channel: if the
     * pipeline never reaches it, `__sheets` stays empty and this row says so. Media emulation is Playwright's
     * instrument, and where an engine still reports `matchMedia('print')` false after the row has waited for the
     * page to confirm the media and run the job again, the row skips rather than accuses.
     *
     * Five jobs, in the order their cost arrives, and each read in the media its claim belongs to:
     *
     *  - **job one, on screen — what the pipeline hands the platform.** Two sheets for the two pages that were
     *    selected, painted at the resolution the memory budget allowed (measured against the fixture's own MediaBox
     *    in Node, so "the highest step" is a ratio and not a hope), with ink on both.
     *  - **job two, in print media — the sheet shown and everything else put away.** The container block, every
     *    other direct child of `<body>` at `display: none`, the second page breaking to itself, and the teardown:
     *    the container gone and the application visible again.
     *  - **job three — a typed value travels.** The same page printed again after the field is filled, with the
     *    dark-pixel count taken inside the widget's own box on the sheet. That comparison is the clause's whole
     *    difference: a stored value that reaches the paper and one that stays in the DOM look identical to a mock.
     *  - **job four — the selection the reader typed.** "From–to 2–2" on a two-page file has to come out as one
     *    sheet, which is the scope a default cannot express: the earlier jobs print either everything or the page
     *    the reader happens to be on. Reaching the fields is itself part of #243's claim — a range that folds out
     *    of the bar when the reader chooses it is a range nobody can type.
     *  - **job five — a selection that cannot fit is refused**, and the platform is never asked: no print call, no
     *    container, and the error the host is handed names the count that would fit.
     *
     * The order within each job is forced too. The scope is chosen on screen and the media flips afterwards,
     * because in print media Firefox stops hit-testing the toolbar's own icon — and a sheet's styles only exist in
     * the media they are written for, so the button is *pressed* rather than clicked once the page is in print.
     * Both were measured after the first versions of this row failed on them; the ordering is in `printWith`.
     */
    name: 'print-sheets-hide-the-application',
    desktopOnly: true,
    run: async ({ page, load, reveal }) => {
      const engine = page.context().browser()?.browserType().name();
      const base = await basePageDims('form-sample.pdf', 1);

      /** Where the `fullName` widget sits on its page, as fractions of the page box. */
      const fieldFraction = async () =>
        page.evaluate(() => {
          const field = document.querySelector('.pjsr-annotation-layer input[name="fullName"]');
          const canvas = document.querySelector('.pjsr-page-canvas');
          if (!field || !canvas) return null;
          const f = field.getBoundingClientRect();
          const c = canvas.getBoundingClientRect();
          if (!c.width || !c.height) return null;
          return {
            x0: (f.left - c.left) / c.width,
            x1: (f.right - c.left) / c.width,
            y0: (f.top - c.top) / c.height,
            y1: (f.bottom - c.top) / c.height,
          };
        });

      const install = (fraction) =>
        page.evaluate((rect) => {
          const w = window;
          w.__sheets = [];
          w.__errors = [];
          w.__field = rect;
          w.print = function print() {
            const container = document.querySelector('.pjsr-print');
            const canvases = container ? Array.from(container.querySelectorAll('canvas')) : [];
            const dark = (data) => {
              let marks = 0;
              for (let i = 0; i < data.length; i += 4) {
                if (Math.abs(255 - data[i]) + Math.abs(255 - data[i + 1]) + Math.abs(255 - data[i + 2]) > 60) {
                  marks += 1;
                }
              }
              return marks;
            };
            w.__sheets.push({
              printing: document.body.classList.contains('pjsr-printing'),
              mediaPrint: w.matchMedia('print').matches,
              container: container ? getComputedStyle(container).display : '(absent)',
              // Everything the sheet is supposed to take out of the page, read as the browser resolves it.
              siblings: Array.from(document.body.children)
                .filter((el) => el !== container)
                .map(
                  (el) =>
                    `${el.tagName.toLowerCase()}.${el.className || el.id || '-'}`.replace(/\s+/g, ' '),
                ),

              visible: Array.from(document.body.children)
                .filter((el) => getComputedStyle(el).display !== 'none')
                .map((el) => el.tagName.toLowerCase()),
              sheets: canvases.map((canvas, index) => {
                const box = canvas.getBoundingClientRect();
                const style = getComputedStyle(canvas);
                const scratch = document.createElement('canvas');
                scratch.width = Math.min(240, canvas.width);
                scratch.height = Math.min(240, canvas.height);
                const flat = scratch.getContext('2d', { willReadFrequently: true });
                flat.drawImage(canvas, 0, 0, scratch.width, scratch.height);
                const whole = flat.getImageData(0, 0, scratch.width, scratch.height).data;
                let fieldInk = 0;
                let fieldPixels = 0;
                if (index === 0 && w.__field) {
                  const x0 = Math.max(0, Math.floor(w.__field.x0 * canvas.width));
                  const x1 = Math.min(canvas.width, Math.ceil(w.__field.x1 * canvas.width));
                  const y0 = Math.max(0, Math.floor(w.__field.y0 * canvas.height));
                  const y1 = Math.min(canvas.height, Math.ceil(w.__field.y1 * canvas.height));
                  if (x1 > x0 && y1 > y0) {
                    const ctx = canvas.getContext('2d', { willReadFrequently: true });
                    const patch = ctx.getImageData(x0, y0, x1 - x0, y1 - y0).data;
                    fieldInk = dark(patch);
                    fieldPixels = (x1 - x0) * (y1 - y0);
                  }
                }
                return {
                  width: canvas.width,
                  height: canvas.height,
                  css: `${Math.round(box.width)}x${Math.round(box.height)}`,
                  breakBefore: style.breakBefore || style.pageBreakBefore,
                  inkRatio: dark(whole) / (scratch.width * scratch.height),
                  fieldInk,
                  fieldPixels,
                };
              }),
            });
          };
          const report = w.console.error.bind(w.console);
          w.console.error = (...args) => {
            const last = args[args.length - 1];
            w.__errors.push(last && last.message ? String(last.message) : String(last));
            report(...args);
          };
        }, fraction);

      const sheetCount = () => page.evaluate(() => window.__sheets.length);
      const lastSheet = () => page.evaluate(() => window.__sheets[window.__sheets.length - 1] ?? null);

      /**
       * Choose a scope, press print, and wait for the *new* job to arrive.
       *
       * All three scopes are driven, including "From–to" and its two number fields, and that is the #243 fix
       * rather than a new ambition: the control grows from 116 px to 197 px when the range appears, which is wide
       * enough to change what the bar can hold, so when the fold was measured at the *current* width the reader's
       * own choice evicted the control they had just used — and the fields they had just asked for went with it,
       * into an overflow panel that nothing had opened. This row's first two attempts timed out on that, one per
       * field, which is what filed the ticket. The bar measures a growing control at its widest state now, so the
       * fold is decided at load and the fields stay reachable beside the select that reveals them.
       *
       * The three scopes are three different claims, and all three are asserted: all of a two-page document, the
       * single page in front of the reader, and a range the reader typed. A pipeline that printed the whole file
       * regardless would fail the last two.
       */
      /** Where the engine made the row drive a control the way a choice would rather than by selection. */
      const scopeNotes = [];

      /** Where the engine needed more than one frame to hand the application back after a job. */
      const restoreNotes = [];

      /**
       * Six readings of the print scope control over three seconds, taken out of the DOM rather than through a
       * locator.
       *
       * The first version asked Playwright to `evaluate` on the locator it had just failed to act on, and in
       * webkit that probe timed out twice — sixty seconds of instrument waiting for the element it was supposed
       * to be describing — which reports "the harness is slow", not what the viewer is doing. So the selector is
       * read straight out of the page: every match of the label, each with its box, whether it is painted,
       * whether a pointer landing at its centre hits it, and whether it is disabled; plus the bar's own
       * clientWidth against its scrollWidth and whether an overflow panel exists, because the question being
       * answered is whether the fold planner is under pressure at this viewport.
       *
       * What it now answers is a three-way question, because CI run 37421704560 showed the two-way version
       * mis-reporting the middle case. A control can be (a) inline in the bar, (b) folded into the overflow list,
       * which is reachable because the ⋯ button is in the bar and a reader opens it, or (c) rendered nowhere a
       * pointer can get to. Reading (b) as (c) — which the old `where === 'bar'` filter did, and did in the same
       * row that had *just* clicked the button to reach it — called webkit's control unreachable while the row was
       * standing in its panel. So a `menu` copy counts as usable when the panel is open, the ⋯ button's own
       * presence is printed, and the panel's rows are named: that is the difference between the planner folding
       * on webkit's metrics at 1,246 px and the control genuinely vanishing.
       */
      /*
       * One reading of every copy of the print scope control, taken inside the page — and when a value is handed
       * to it, the write that reading has just authorised. `#248` is why the two are the same function: the row
       * described the control with DOM readings (good) and then read its value back through a bare locator call
       * (bad), so every one of its nine runner failures has been reported as
       * `locator.inputValue: Timeout 30000ms exceeded … waiting for locator('.pjsr-toolbar [aria-label="Print pages"]:visible')`,
       * which does not say which of the row's five reads it was, which scope had just been set, whether the panel
       * was open at that instant, or which of the three states the copies were in. A message like that cannot be
       * compared with the next one, which is how a row stays a mystery for nine runs.
       */
      const readScopeControl = (write) =>
        page.evaluate(
          ([label, value]) => {
            const bar = document.querySelector('.pjsr-toolbar');
            const elements = Array.from(
              document.querySelectorAll(
                `.pjsr-toolbar [aria-label="${label}"], .pjsr-overflow-menu [aria-label="${label}"]`,
              ),
            );
            const shape = (el, i) => {
                const box = el.getBoundingClientRect();
                const style = getComputedStyle(el);
                const hit = document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2);
                const scope = el.closest('.pjsr-print-scope');
                const scopeBox = scope?.getBoundingClientRect();
                /*
                 * The clip walk, which is #241 stated in pixels rather than as a timeout: the viewer clips with
                 * `overflow: clip`, so a panel that hangs below its box is not merely off-screen — nothing a
                 * pointer does can land on the part that is cut, and a `<select>` there has no room to open.
                 */
                let clippedBy = null;
                for (let a = el.parentElement; a; a = a.parentElement) {
                  const s = getComputedStyle(a);
                  if (!/clip|hidden/.test(`${s.overflowX}${s.overflowY}`)) continue;
                  const r = a.getBoundingClientRect();
                  const dx = Math.max(0, r.left - box.left) + Math.max(0, box.right - r.right);
                  const dy = Math.max(0, r.top - box.top) + Math.max(0, box.bottom - r.bottom);
                  if (dx > 0 || dy > 0) {
                    clippedBy = `${a.className || a.tagName} cut ${Math.round(dx)}x${Math.round(dy)}px of it ` +
                      `(box ${Math.round(r.width)}x${Math.round(r.height)} at ${Math.round(r.x)},${Math.round(r.y)})`;
                    break;
                  }
                }
                return {
                  i,
                  where: el.closest('.pjsr-overflow-menu')
                    ? 'menu'
                    : el.closest('.pjsr-toolbar-sizer')
                      ? 'sizer'
                      : 'bar',
                  box: `${Math.round(box.x)},${Math.round(box.y)} ${Math.round(box.width)}x${Math.round(box.height)}`,
                  // The whole control, not just its select: #243 is about this box doubling when the range appears.
                  group: scopeBox ? `${Math.round(scopeBox.width)}x${Math.round(scopeBox.height)}` : 'none',
                  clippedBy,
                  painted:
                    box.width > 0 && box.height > 0 && style.display !== 'none' && style.visibility !== 'hidden',
                  covered: !(hit !== null && (hit === el || el.contains(hit) || hit.contains(el))),
                  disabled: Boolean(el.disabled),
                  value: 'value' in el ? String(el.value) : null,
                };
              };
              const matches = elements.map(shape);
              const panel = Boolean(document.querySelector('.pjsr-overflow-menu'));
              const reachable = (m) => m.painted && !m.covered && !m.disabled && !m.clippedBy;
              // (a) inline in the bar or (b) in a panel that is open — both a reader can use; (c) nowhere.
              const usable =
                matches.find((m) => reachable(m) && (m.where === 'bar' || (m.where === 'menu' && panel))) ?? null;
              let wrote = null;
              if (value !== null && usable) {
                const el = elements[usable.i];
                el.value = value;
                el.dispatchEvent(new Event('input', { bubbles: true }));
                el.dispatchEvent(new Event('change', { bubbles: true }));
                wrote = `the ${usable.where} copy at ${usable.box}`;
              }
              const more = document.querySelector('.pjsr-toolbar [aria-label="More controls"]');
              const moreBox = more?.getBoundingClientRect();
              return {
                label,
                matches,
                usable,
                /** What a report says instead of "no match": the copies, each with the reason it was or was not usable. */
                copies: matches.length
                  ? matches
                      .map(
                        (m) =>
                          `${m.where} ${m.box} group ${m.group} value "${m.value}"` +
                          `${m.painted ? '' : ' unpainted'}${m.covered ? ' covered' : ''}` +
                          `${m.disabled ? ' disabled' : ''}${m.clippedBy ? ` cut by ${m.clippedBy}` : ''}`,
                      )
                      .join(' | ')
                  : 'nothing carrying that label',
                wrote,
                value: usable ? usable.value : null,
                /*
                 * The state as the app holds it, read off every copy that exists — including the measuring
                 * sizer, which no pointer can reach but which is bound to the same React value. #248 needs the
                 * two separated: a copy a reader can use is the *premise* (that is what #243 is about), while
                 * agreement between the copies is the *state*. Null when they disagree, which would itself be
                 * a finding about two controlled copies of one select.
                 */
                mirror: matches.length && matches.every((m) => m.value === matches[0].value)
                  ? matches[0].value
                  : null,
                more: more
                  ? `present ${Math.round(moreBox.width)}x${Math.round(moreBox.height)}`
                  : 'no button in the bar',
                panel,
                rows: Array.from(document.querySelectorAll('.pjsr-overflow-label')).map((node) => node.textContent),
                bar: bar ? `${bar.clientWidth}/${bar.scrollWidth}` : 'none',
              };
            },
          ['Print pages', write ?? null],
        );

      /** One line, from one reading — the shape every failure message on this row now ends with. */
      const stateOf = (r) =>
        `panel ${r.panel ? 'open' : 'closed'}, ${
          r.usable ? `usable copy in the ${r.usable.where} at ${r.usable.box} reading "${r.usable.value}"` : 'no usable copy'
        }, copies ${r.copies}, overflow button ${r.more}, panel rows ${r.rows.join(' | ') || '(none)'}, ` +
        `bar clientWidth/scrollWidth ${r.bar}`;

      const scopeSamples = async (count = 6) => {
        const runs = [];
        for (let i = 0; i < count; i += 1) {
          runs.push(await readScopeControl(null));
          if (i < count - 1) await page.waitForTimeout(500);
        }
        return runs;
      };

      /** The samples as one line, plus whether a reader could have used the control in each of them. */
      const describeSamples = (runs) => {
        const usable = runs.map((run) => run.usable);
        const found = usable.filter(Boolean);
        const boxes = [...new Set(found.map((m) => m.box))];
        const places = [...new Set(found.map((m) => m.where))];
        // A copy that exists but is cut by an ancestor is a different failure from one that is missing, and it
        // is #241's: say which it is instead of letting "no usable control" cover both.
        const cut = [...new Set(runs.flatMap((r) => r.matches.map((m) => m.clippedBy).filter(Boolean)))];
        return {
          usable: found.length,
          agreed: boxes.length === 1,
          total: runs.length,
          text:
            `${found.length}/${runs.length} samples saw a usable control` +
            (found.length ? ` in the ${places.join(' or the ')} at ${boxes.join(' then ')}` : ' at no box') +
            (cut.length ? `, while ${cut.join(' and ')} shows one that a pointer cannot fully reach` : '') +
            `; overflow button ${[...new Set(runs.map((r) => r.more))].join(' or ')}; panel ` +
            `${[...new Set(runs.map((r) => (r.panel ? 'open' : 'closed')))].join(' or ')}; ` +
            `rows ${[...new Set(runs.map((r) => r.rows.join(' | ')))].join(' // ') || '(no panel rows)'}; ` +
            `bar clientWidth/scrollWidth ${[...new Set(runs.map((r) => r.bar))].join(' ')}; first sample held ${
              runs[0].matches.length
                ? runs[0].matches
                    .map(
                      (m) =>
                        `${m.where} ${m.box} group ${m.group}${m.painted ? '' : ' unpainted'}${
                          m.covered ? ' covered' : ''
                        }${m.clippedBy ? ' clipped' : ''}`,
                    )
                    .join(' | ')
                : 'nothing carrying that label'
            }`,
        };
      };

      const pickScope = async (scope) => {
        const pages = await reveal('Print pages');
        // Which door the value came in by is part of what the next engine's reading means, so it is carried to
        // the read-back rather than being inferred from the absence of a note.
        let how = `${engine} took the selection through Playwright's selectOption`;
        try {
          await pages.selectOption(scope);
        } catch (error) {
          /*
           * WebKit has now failed this line four times and told three different stories: on CI run 37386366651
           * (dev at 651672c) Playwright resolved the `<select>` as visible and then could not act on it; on CI run
           * 37390542384 (dev at 3f12174) the same locator never resolved at all; on CI runs 37391924675/37392699425
           * the label existed only on the hidden measuring copy; and on CI run 37421704560 (dev at 1e502ba, after
           * #243) the row reached the control through the ⋯ panel, the selection timed out, and the samples —
           * which counted only a bar copy as usable — then described the panel they had just opened as an absent
           * control. A layout question that keeps changing shape is answered by measuring more of it, not by
           * retrying the same probe: webkit would not start on this host at that moment (three attempts, all
           * `Target page, context or browser has been closed`), so the runner carried the instrument. It has since
           * started here — the run of 2026-10-07 launched chromium 153.0.8010.12, firefox 155.0 and webkit 26.6 on
           * this machine — which makes that refusal a transient of the host rather than a property of it, and the
           * reason a `not runnable` line in a log is worth re-running before it is believed.
           *
           * So the panel is put back before anything is described (an abandoned selection dismisses it, and a
           * closed panel renders no folded control at all), and six DOM readings then decide which of the three
           * states this is. Six agreeing on one painted, uncovered, enabled copy — in the bar or in that open
           * panel — is a control a reader can use, so the value goes on it the way a choice puts it: `input` then
           * `change`, the events the app listens for, and the substitution is printed in the row's own text.
           * Anything else, including a copy that appears in some samples and not in others, is this package's
           * failure, and the row fails with every sample in the message.
           */
          if ((await page.locator('.pjsr-overflow-menu').count()) === 0) {
            const more = page.locator('.pjsr-toolbar [aria-label="More controls"]:visible');
            if ((await more.count()) > 0) {
              await more.click();
              await page.waitForSelector('.pjsr-overflow-menu', { timeout: 5_000 }).catch(() => undefined);
            }
          }
          const seen = describeSamples(await scopeSamples());
          if (seen.usable !== seen.total || !seen.agreed) {
            fail(`the "${scope}" scope control could not be used: ${firstLine(error)} — ${seen.text}`);
          }
          /*
           * The write and the description are one reading now. The old version re-resolved a locator after the
           * samples had already agreed the control was usable, and the two could disagree about *which* copy they
           * meant — the panel's or the bar's — because `.first()` takes the first in DOM order and both exist.
           * `readScopeControl(scope)` puts the value on the copy the reachability rule just selected and says
           * which that was, so the note names the door rather than implying it.
           */
          const wrote = await readScopeControl(scope);
          if (!wrote.wrote) {
            fail(
              `the "${scope}" scope could not be written although six samples agreed the control was usable ` +
                `(${seen.text}); the reading at the write was ${stateOf(wrote)}`,
            );
          }
          scopeNotes.push(
            `"${scope}" set through the change event because ${engine} refused the selection ` +
              `(${firstLine(error)}) on ${wrote.wrote}, a control six samples agreed a reader could use`,
          );
          how = `${engine} refused the selection (${firstLine(error)}) and the value went on through the change event`;
        }
        // The substitution above is only worth making if the app took it: the scope is read back off the same
        // control the reader would look at, so a value the panel accepted and the state did not is a failure.
        //
        // CI run 37428185484 reached this line in webkit and reported `the scope select reads "all" after being
        // set to "all"` — which is not a contradiction, it is a second bug in *this* check: the message read the
        // value again, so it printed the settled value while the comparison had failed on an earlier one. What
        // webkit actually did was take the selection and expose a different value for a moment afterwards, and the
        // row has no way to say which that moment held because it never looked twice. So the read is polled, the
        // values it sees are kept, and the path that set the value is named: a select that settles is the app
        // agreeing with the control, and a select that never does is a failure worth its whole sequence.
        /*
         * Polled in the page, not through a locator. `locator.inputValue()` waits thirty seconds for an element
         * that may have folded away, and when it gives up the message names only the selector — which is every
         * failure this row has ever printed on the runner. The read is instant, and the failure carries the state
         * of the moment it gave up: panel open or closed, which copies exist, where each is, what each reads.
         */
        const seenValues = [];
        let last = null;
        let panelSeenOpen = false;
        let closedAfter = null;
        /** `null` is what "no copy a reader could use" looks like in a list of readings. */
        const said = (r) => (r.value === null ? `(no usable copy; state reads "${r.mirror}")` : r.value);
        const settled = await waitFor(async () => {
          last = await readScopeControl(null);
          if (last.panel) panelSeenOpen = true;
          else if (panelSeenOpen && closedAfter === null) closedAfter = seenValues.length;
          if (last.value === scope || (last.value === null && last.mirror === scope)) return true;
          const now = said(last);
          if (seenValues[seenValues.length - 1] !== now) seenValues.push(now);
          return null;
        }, 3_000);
        if (!settled) {
          fail(
            `the scope select never read "${scope}" — it read ${seenValues.length ? seenValues.join(', ') : '(nothing)'} ` +
              `over 3 s after ${how}; at the last reading, ${stateOf(last)}`,
          );
        }
        /*
         * The two ways to settle are two different claims, and the row says which one it got. Reading the value
         * off a usable copy is the ordinary one. Settling on the state mirror alone — CI run 37515055554's
         * webkit cell, where every copy read "all" while the panel had closed under the poll — is the app
         * agreeing while the reader's door vanished, so the *scope* premise still holds and what the row
         * finally asserts is what came out on paper. Naming the transition is the point: whether the panel
         * dismissed itself after a selection is a fact about the engine, and a note that says so is worth more
         * here than a failure that implies the viewer refused the choice.
         */
        if (last.value !== scope && last.mirror === scope) {
          scopeNotes.push(
            `"${scope}" reached the app's state — every copy present reads it, the sizer among them — but no copy ` +
              `a pointer could reach did${closedAfter === null ? ' at any reading' : ` after the panel closed at reading ${closedAfter + 1}`}, ` +
              `so the sheet counts below carry this scope's claim (${how})`,
          );
        } else if (seenValues.length) {
          scopeNotes.push(
            `"${scope}" settled on the select after ${seenValues.length} other reading(s): ${seenValues.join(', ')} — ${how}`,
          );
        }
        // Put the panel back before reaching for the action. Print's button is a higher-priority control, so it
        // stays in the bar — and an open overflow menu hangs over it, which leaves the click waiting on a
        // hit-test the panel keeps winning. Firefox folded the selector at 1,280 px and reached this line;
        // Chromium did not, which is the reason a row has to be run in more than one engine.
        if (await page.locator('.pjsr-overflow-menu').count()) {
          await page.keyboard.press('Escape');
          await page
            .waitForSelector('.pjsr-overflow-menu', { state: 'detached', timeout: 5_000 })
            .catch(() => undefined);
        }
        return pages;
      };

      /**
       * Start a job, and be in print media by the time it reaches the boundary.
       *
       * The click always happens on screen. Both halves of that ordering were measured after the first versions
       * of this row failed: under emulated print media **Chromium collapses the application's own height**, so
       * the toolbar's controls stop being visible and the button cannot be reached at all (`reveal` then reports
       * no control and no overflow menu), and under emulated print media **Firefox stops hit-testing the toolbar's
       * icon** at its centre, so Playwright refuses the click (`.spike/probe-print-firefox.mjs`: six samples
       * reading `covered: true`, and `click -> ok` the moment the media goes back). The media is therefore flipped
       * *while the job is in flight*, gated on the one signal that proves it — the print control becoming its own
       * abort — which is a commit that necessarily precedes the first page render, and the boundary needs a
       * render plus a frame.
       */
      const barLabels = () =>
        page.evaluate(() =>
          Array.from(document.querySelectorAll('.pjsr-toolbar [aria-label], .pjsr-overflow-menu [aria-label]'))
            .filter((el) => getComputedStyle(el).display !== 'none')
            .map((el) => `${el.getAttribute('aria-label')}=${getComputedStyle(el).visibility}`)
            .join(', '),
        );

      const printWith = async (stepName, scope, after, media = 'screen') => {
        if (scope) await pickScope(scope);
        let button = null;
        try {
          button = await reveal('Print document');
        } catch (error) {
          fail(
            `${stepName}: ${firstLine(error)} — the bar held: ${(await barLabels()).slice(0, 400)}`,
          );

        }
        await button.click();
        if (media === 'print') {
          await page
            .waitForSelector(`${BAR} [aria-label="Cancel printing"]:visible`, { timeout: 15_000 })
            .catch(() => undefined);
          await page.emulateMedia({ media: 'print' });
        }
        const arrived = await waitFor(async () => ((await sheetCount()) > after ? true : null), 60_000);
        await page.emulateMedia({ media: 'screen' });
        if (!arrived) return false;
        /*
         * Wait out the end of the job before the next one starts.
         *
         * `window.print()` returns *inside* the pipeline's try block, so a row that presses on the moment the
         * boundary is reached finds the control still reading "Cancel printing" and no `Print document` to press —
         * which is how this row's second job failed the first time. The clause's claim that the sheet is a moment
         * rather than a second document is the same fact from the other side, so it is asserted here once and
         * relied on everywhere: the container detached, the body's print class gone, the application visible
         * again, and the control back to the one that starts a job.
         */
        const ended = await waitFor(
          async () => ((await page.evaluate(() => !document.querySelector('.pjsr-print'))) ? true : null),
          15_000,
        );
        if (ended !== true) {
          fail(`${stepName}: the print container was still in the document 15 s after the job reached the printer`);
        }
        const reading = () =>
          page.evaluate(() => ({
            printing: document.body.classList.contains('pjsr-printing'),
            toolbar: getComputedStyle(document.querySelector('.pjsr-toolbar') ?? document.body).display,
            control: document.querySelector('.pjsr-toolbar [aria-label="Print document"]')
              ? 'Print document'
              : document.querySelector('.pjsr-toolbar [aria-label="Cancel printing"]')
                ? 'still Cancel printing'
                : '(no print control)',
          }));
        const settled = (r) => !r.printing && r.toolbar !== 'none' && r.control === 'Print document';
        /*
         * The container is removed by the pipeline and the control's label is React's, so the two land one
         * commit apart: asking once, on the frame the container went away, reads a sheet that has finished and a
         * button that has not been re-rendered yet. CI run 37432005740 did exactly that in webkit — the first
         * time that engine got this far in this row — and reported `pjsr-printing=false, display: flex, and the
         * control is "still Cancel printing"`, which is an instrument reading its own race, not a sheet that
         * outlived its print. So the restoration is waited for, the readings it took are kept, and a button that
         * never comes back fails with all of them: that would be the clause's failure, and it would be named.
         */
        const readings = [];
        const restoreDeadline = Date.now() + 10_000;
        let restored = await reading();
        while (!settled(restored) && Date.now() < restoreDeadline) {
          if (!readings.length || JSON.stringify(readings[readings.length - 1]) !== JSON.stringify(restored)) {
            readings.push(restored);
          }
          await page.waitForTimeout(50);
          restored = await reading();
        }
        if (!settled(restored)) {
          const shown = [...readings];
          const last = JSON.stringify(restored);
          if (!shown.length || JSON.stringify(shown[shown.length - 1]) !== last) shown.push(restored);
          const seen = shown
            .map((r) => `pjsr-printing=${r.printing}, toolbar display: ${r.toolbar}, control "${r.control}"`)
            .join(' then ');
          fail(
            `${stepName}: 10 s after the job reached the printer the application had not come back — ${seen} — ` +
              'a sheet that outlives its print is the second document the clause rules out',
          );
        }
        if (readings.length) {
          restoreNotes.push(
            `${engine} returned the control to "Print document" ${readings.length} reading(s) after the ` +
              `container detached (${readings.map((r) => r.control).join(', ')})`,
          );
        }
        return true;
      };

      // A predictable bar: the search panel, left open by an earlier row, takes the width that folds the
      // print selector away.
      await page.keyboard.press('Escape');
      await page.keyboard.press('Escape');

      await load('form-sample.pdf', 2);
      /*
       * To the top, and wait for the widget itself. The rows before this one leave the document scrolled
       * somewhere of their own — the 1,000-page row ends at page 1,000 — and the virtualizer mounts only the
       * pages near the viewport, so page 1's annotation layer, and the field this row measures ink inside, is
       * not in the DOM until the scroll says so. (#228's lesson, applied to the harness's own aim: measure where
       * the thing actually is.)
       */
      await page.evaluate(() => {
        const el = document.querySelector('.pjsr-viewport');
        el.scrollTop = 0;
        el.scrollLeft = 0;
      });
      await page
        .waitForSelector('.pjsr-annotation-layer input[name="fullName"]', { timeout: 30_000 })
        .catch(() => undefined);
      const fraction = await fieldFraction();
      if (!fraction) {
        return skip(`${engine}: the fullName widget never painted a box to measure, so the sheet had no region to read`);
      }
      await install(fraction);
      /*
       * What the scope held before any job, read the same way — and if there is no copy a reader could use at
       * *this* point, the row says so in the row's own words instead of letting a thirty-second locator timeout
       * report it as a bare selector. CI runs 37500226195 and 37501699590 each failed with that selector message
       * and no scope named; this is one of the two lines it can only have been (#248).
       *
       * `reveal()` first, and that is not decoration. The full local run of 2026-10-06 caught the first version of
       * this line failing in chromium and firefox both with `copies sizer … unpainted covered, overflow button
       * present`: by the time this row runs, the bar is folded and the only copy of the control is inside a panel
       * nothing has opened — so the reader has to be opened like the old locator did, or a row that asks for a
       * folded control reports it missing. Reading the state is an addition to that step, never a replacement.
       */
      await reveal('Print pages');
      const opening = await readScopeControl(null);
      if (!opening.usable) {
        fail(`before job one, the print scope had no copy a reader could use: ${stateOf(opening)}`);
      }
      const openedWith = opening.value;

      /*
       * Job one, on screen media: what the pipeline hands the platform. How many sheets the selection became, at
       * what resolution, and whether each one carries ink.
       */
      const before = await sheetCount();
      if (!(await printWith('job one', 'all', before, 'screen'))) {
        return skip(
          `${engine}: the pipeline never reached window.print() within 60 s, so there was no sheet to read — ` +
            'the render half is asserted in Node and this row cannot tell a slow engine from a broken one',
        );
      }
      const run1 = await lastSheet();
      if (run1.sheets.length !== 2) {
        fail(
          `the whole of a two-page document (scope arrived as "${openedWith}") reached the printer as ` +
            `${run1.sheets.length} sheet(s) — one sheet per selected page`,
        );
      }
      const blank = run1.sheets.filter((sheet) => sheet.inkRatio < 0.0005);
      if (blank.length) {
        fail(
          `${blank.length} of ${run1.sheets.length} sheets came to the printer with no ink on them ` +
            `(ratios ${run1.sheets.map((s) => s.inkRatio.toFixed(5)).join(', ')}) — a blank sheet is the failure ` +
            'the whole clause exists to avoid',
        );
      }
      const scale = run1.sheets[0].width / base.width;
      if (scale < 1.5) {
        fail(
          `the sheet was painted at ${scale.toFixed(2)}x the PDF unit (${run1.sheets[0].width}x${run1.sheets[0].height} ` +
            `device px for a ${Math.round(base.width)}x${Math.round(base.height)}pt page): two pages of this size ` +
            'fit the 256 MB budget at the top step, so the ladder was not tried best-first',
        );
      }

      /*
       * Job two, in print media: the sheet shown and everything else put away. A stylesheet the browser never
       * reads is not a channel, so this is the job that says what the clause's second sentence is worth — the
       * container block, the host's own children `display: none`, and the second page breaking to itself.
       */
      const styled = await sheetCount();
      if (!(await printWith('job two', null, styled, 'print'))) {
        fail('the second job never reached the printer, so the print-media layout could not be read');
      }
      let run2 = await lastSheet();
      // Whether this cell needed the retry is engine evidence, not harness trivia: a green row that says nothing
      // about it cannot be compared with a CI cell that skipped on the same race.
      let retriedMedia = false;
      if (!run2.mediaPrint) {
        /*
         * One retry, and the reason for it is the row's own ordering: the media has to be flipped *during* the
         * job, because a control cannot be clicked in print media (Chromium collapses the application's height —
         * measured, and the reason the click happens on screen). That leaves a race between the emulation
         * reaching the page and the pipeline reaching `window.print()`, and the sheet then records a media that
         * had not switched yet. Measured 2026-10-06: chromium desktop reported `mediaPrint: false` on **every**
         * run, so the clause's central sentence — the print stylesheet shows the sheet and hides everything else —
         * was being skipped on the one engine that can read it, quietly, in the only harness that runs it.
         *
         * The retry waits for the page to say the media has matched, then asks again. That press goes through
         * the element rather than a pointer, because by then the claim being measured is about the sheet the
         * pipeline hands over, not about how the click arrived.
         */
        const matched = await (async () => {
          // `printWith` has already put the page back in screen media, which is why the first reading said false
          // and why the retry has to ask for the print media itself.
          await page.emulateMedia({ media: 'print' });
          return waitFor(() => page.evaluate(() => window.matchMedia('print').matches || null), 10_000);
        })();
        const before = await sheetCount();
        await page.evaluate(() => {
          // The bar renders a hidden measuring copy of every control last, so a plain selector would be one
          // element ordering accident away from pressing the copy nobody can see (#243 made that copy grow).
          const control = Array.from(
            document.querySelectorAll(
              '.pjsr-toolbar [aria-label="Print document"], .pjsr-toolbar [aria-label="Cancel printing"]',
            ),
          ).find((el) => !el.closest('.pjsr-toolbar-sizer'));
          if (control instanceof HTMLElement) control.click();
        });
        const arrived = await waitFor(async () => ((await sheetCount()) > before ? true : null), 60_000);
        // Let the retried job finish before the media goes back: a container left mounted here would be
        // measured as the next job's starting state, and the row's own teardown claim would go vague.
        const torn = await waitFor(
          async () => ((await page.evaluate(() => !document.querySelector('.pjsr-print'))) ? true : null),
          15_000,
        );
        await page.emulateMedia({ media: 'screen' });
        if (arrived) run2 = await lastSheet();
        if (!run2.mediaPrint) {
          return skip(
            `${engine}: matchMedia('print') still reports false under Playwright's media emulation after ` +
              `waiting for it (${matched ? 'the page matched, the retried sheet did not' : 'the page never matched'})` +
              `${arrived ? '' : ', and the retried job never reached the printer'}` +
              `${torn ? '' : ', and its container never detached'}, so the sheet's styles were not read here`,
          );
        }
        retriedMedia = true;
      }
      if (!run2.printing || run2.container !== 'block') {
        fail(
          `in print media the body carried pjsr-printing=${run2.printing} and the container was ` +
            `display: ${run2.container} — the sheet is what the print stylesheet must show`,
        );
      }
      if (run2.visible.length > 1) {
        fail(
          `${run2.visible.length} direct children of <body> were still visible in print media (${run2.visible.join(', ')}) ` +
            `while printing — the clause hides everything else, and the host's own chrome was among them: ${run2.siblings.join(', ')}`,
        );
      }
      if (run2.sheets[1].breakBefore !== 'always' && run2.sheets[1].breakBefore !== 'page') {
        fail(
          `the second sheet breaks "${run2.sheets[1].breakBefore}" rather than starting its own page, so two ` +
            'pages would come out on one sheet',
        );
      }
      const fieldBefore = run2.sheets[0].fieldInk;

      /*
       * Job three: the value the reader typed has to reach the sheet. The same page is printed again, so the two
       * ink counts are the same measurement of the same box at the same resolution — and the difference between
       * them is pixels rather than a call record.
       *
       * What this does *not* prove, and a counterfactual said so: dropping `printAnnotationStorage` from the
       * render params leaves the ink delta exactly the same (`.spike/counterfactual-fr19.mjs`, CF-P1 green),
       * because the engine's print intent falls back to the document's live `annotationStorage` when no snapshot
       * is handed to it (`pdfjs-dist/build/pdf.mjs:16494`). The row measures *that the value arrives*; which
       * storage it arrived from is not separable by pixels, and the snapshot has its own pin in
       * `src/lib/core-ink.withdrawal.test.ts`.
       */

      const field = page.locator('.pjsr-annotation-layer input[name="fullName"]').first();
      await field.click();
      await field.fill('ADA LOVELACE');
      if ((await (await field.elementHandle())?.evaluate((el) => el.value)) !== 'ADA LOVELACE') {
        fail('the typed value never reached the control, so the sheet could not be expected to carry it');
      }
      const typed = await sheetCount();
      if (!(await printWith('job three', 'current', typed, 'print'))) {
        fail('the third print never reached window.print(), so the typed value could not be read off a sheet');
      }
      const run3 = await lastSheet();
      if (run3.sheets.length !== 1) {
        fail(
          `scope "Current page" printed ${run3.sheets.length} sheets where the reader had selected one — the ` +
            'selector and the job disagree',
        );
      }
      if (run3.sheets[0].width !== run2.sheets[0].width) {
        fail(
          `the same page printed at ${run2.sheets[0].width}px before the value and ${run3.sheets[0].width}px after, ` +
            'so the two ink counts are not comparable',
        );
      }
      const fieldAfter = run3.sheets[0].fieldInk;
      if (fieldAfter <= fieldBefore) {
        fail(
          `the widget's own box on the sheet holds ${fieldAfter} dark pixels of ` +
            `${run3.sheets[0].fieldPixels} after "ADA LOVELACE" was typed, against ${fieldBefore} before it ` +
            `(field box measured over ${(fraction.x1 - fraction.x0).toFixed(3)} x ` +
            `${(fraction.y1 - fraction.y0).toFixed(3)} of the page) — form values are supposed to travel with ` +
            'the pages',
        );
      }

      /*
       * Job four: the range the reader *typed*, which is "the selected pages" said from the side a default
       * cannot show. #243 was filed against exactly this pair of fields: choosing "From–to" widened the scope
       * control from 116 px to 197 px, which is wide enough for the fold planner to move the whole row out of the
       * bar, so the two fields a reader had just asked for appeared inside an overflow panel that nothing had
       * opened — and the row timed out on the first of them, reading as a missing input rather than as a control
       * that had moved. The bar now measures a growing control at its widest state, so the fold is decided before
       * the reader touches anything and these fields stay where their own select is.
       */
      // The range is the state where the control grows, so it is read back through the same instrument.
      await pickScope('range');
      await (await reveal('First page to print')).fill('2');
      await (await reveal('Last page to print')).fill('2');
      const ranged = await sheetCount();
      if (!(await printWith('job four', null, ranged, 'screen'))) {
        fail('the range job never reached the printer, so "the selected pages" was never measured from a range');
      }
      const run4 = await lastSheet();
      if (run4.sheets.length !== 1) {
        fail(
          `"From–to" set to 2–2 printed ${run4.sheets.length} sheets of a 2-page file — the clause is about the ` +
            'pages the reader selected, and one page was selected',
        );
      }

      /*
       * Job five: a job the budget cannot pay for is refused before the platform is asked. No print arrives,
       * which is the outcome — so this one clicks and waits a fixed beat rather than polling for a boundary that
       * must never be reached, and then reads what the host was told. "All pages" of a four-figure document is
       * the selection a reader makes by not choosing one.
       */
      await page.evaluate(() => {
        window.__sheets.length = 0;
        window.__errors.length = 0;
      });
      await load('long-sample.pdf', 1000);
      const big = await basePageDims('long-sample.pdf', 1);
      await pickScope('all');
      await (await reveal('Print document')).click();
      await page.waitForTimeout(4_000);
      const refused = await page.evaluate(() => ({
        prints: window.__sheets.length,
        errors: window.__errors.slice(),
        container: Boolean(document.querySelector('.pjsr-print')),
      }));
      if (refused.prints > 0 || refused.container) {
        fail(
          `all ${big.pages} pages of a ${Math.round(big.width)}x${Math.round(big.height)}pt document reached the ` +
            `printer (${refused.prints} print calls, container present: ${refused.container}) instead of being ` +
            'refused for exceeding the budget',
        );
      }
      const named = refused.errors.find((line) => /shorter range|pages at a time/i.test(line));
      if (!named) {
        fail(
          `the refusal never reached the host: ${refused.errors.join(' / ') || '(nothing logged)'} — the clause ` +
            'says a selection that cannot fit is refused *and names the page count that would*',
        );
      }

      return (
        `${engine}: the whole of a two-page document printed ${run1.sheets.length} sheets of a ` +
        `${base.width.toFixed(0)}x${base.height.toFixed(0)}pt page at ${scale.toFixed(2)}x ` +
        `(${run1.sheets[0].width}x${run1.sheets[0].height} device px), ink ` +
        `${run1.sheets.map((sheet) => `${(sheet.inkRatio * 100).toFixed(2)}%`).join('/')}; in print media the ` +
        `container was display:${run2.container} and ${run2.siblings.length} other body children ` +
        `"${run2.siblings.join(' ')}" went to none, second sheet breaking "${run2.sheets[1].breakBefore}", and ` +
        `the container was gone with the toolbar back afterwards; the widget's own ` +
        `${run3.sheets[0].fieldPixels}px box went ${fieldBefore} → ${fieldAfter} dark px for a typed value, and ` +
        `"Current page" printed ${run3.sheets.length} of the 2, "From–to 2–2" printed ${run4.sheets.length}; all ` +
        `${big.pages} pages of a ` +
        `${big.width.toFixed(0)}x${big.height.toFixed(0)}pt document refused with no print call and ` +
        `"${(named ?? '').slice(0, 90)}"` +
        (retriedMedia
          ? '; the first print-media job reached the printer before the emulation landed, so the row waited for ' +
            "matchMedia('print') and ran that job again"
          : '') +
        (restoreNotes.length ? `; ${[...new Set(restoreNotes)].join('; ')}` : '') +
        // An engine that would not take the selection says so here rather than passing quietly: the scopes are
        // what make the third job's one-page sheet mean "current" instead of "whatever the default was".
        (scopeNotes.length ? `; ${scopeNotes.join('; ')}` : '')
      );
    },
  },
  {
    /*
     * FR-24's pixels, which is the half of the clause jsdom cannot reach.
     *
     * Its other sentence — that every page draws from *the same* `OptionalContentConfig` instance, and that a
     * `SetOCGState` action moves that instance rather than a copy — is asserted by object identity in
     * `src/headless/usePdfOptionalContent.shared.test.tsx` and `src/components/ViewerController.layers.test.tsx`,
     * which is the right instrument for identity and no instrument at all for "the page changed". A panel that
     * flips a checkbox on an instance no render reads, or a page that fetches its own config (pdf.js builds a
     * **new** object on every `getOptionalContentConfig()` call, from cached worker data), passes both files.
     * So this row asks the question that cannot be faked: does the ink move?
     *
     * Four claims, in the order a reader meets them:
     *  - the tab **lists** the fixture's three groups with the states `/OCProperties` declares them in, read
     *    back off the checkboxes rather than from the generator;
     *  - the band the Stamp layer paints is blank while that group is off, and the two lines of content either
     *    side of it are inked — the premise that the page painted at all, and that the blankness belongs to the
     *    layer rather than to a canvas that never arrived;
     *  - one switch on inks that band and one switch off blanks it again, which is the same config object the
     *    render holds, moved twice by the panel;
     *  - a **second** page follows while it is the one on screen, which is the clause's "every page": page 2's
     *    grouped line goes blank when a panel last read against page 1 switches that group off, and returns
     *    when it is switched back on. A config fetched per render would leave page 2 on the document's defaults.
     */
    name: 'layers-switch-paints-a-page',
    desktopOnly: true,
    run: async ({ page, load, reveal, jumpTo }) => {
      const engine = page.context().browser()?.browserType().name();
      const size = await basePageDims('attachments-ocg-sample.pdf', 1);
      await page.locator('.app-features label', { hasText: 'layers' }).locator('input').check();
      await load('attachments-ocg-sample.pdf', 3);
      await page.evaluate(() => {
        const el = document.querySelector('.pjsr-viewport');
        el.scrollTop = 0;
        el.scrollLeft = 0;
      });

      /**
       * Ink inside horizontal bands of one page's canvas, in bands the document's own units define.
       *
       * Each range is a distance from the top of the page, converted against `basePageDims()` rather than
       * against a constant, at the full width of the canvas: the fixture puts exactly one line of text in each
       * optional-content group and nothing else at that height, so a band is that layer's whole contribution
       * and a change in it cannot have come from anywhere else on the page.
       */
      const BANDS = ([selector, ranges, height]) => {
        const canvas = document.querySelector(selector);
        if (!canvas || !canvas.width || !canvas.height) return null;
        const ctx = canvas.getContext('2d', { willReadFrequently: true });
        if (!ctx) return null;
        const out = {};
        for (const [name, from, to] of ranges) {
          const y0 = Math.max(0, Math.floor((from / height) * canvas.height));
          const y1 = Math.min(canvas.height, Math.ceil((to / height) * canvas.height));
          if (y1 <= y0) {
            out[name] = { marks: 0, pixels: 0 };
            continue;
          }
          const { data } = ctx.getImageData(0, y0, canvas.width, y1 - y0);
          let marks = 0;
          for (let i = 0; i < data.length; i += 4) {
            if (data[i + 3] < 8) continue;
            if (Math.abs(255 - data[i]) + Math.abs(255 - data[i + 1]) + Math.abs(255 - data[i + 2]) > 60) {
              marks += 1;
            }
          }
          out[name] = { marks, pixels: canvas.width * (y1 - y0) };
        }
        return out;
      };

      // The fixture's lines, in pt from the top of a 612x792 page: page 1 has Heading 16pt at 700, Body 12pt at
      // 660, the Stamp layer's 16pt line at 600 with its 4pt rule at 576, and ungrouped 10pt text at 520.
      const PAGE1 = [
        ['heading', 68, 102],
        ['body', 112, 146],
        ['stamp', 176, 218],
        ['plain', 254, 282],
      ];
      const PAGE2 = [
        ['body', 76, 98],
        ['plain', 116, 138],
      ];
      const ONE = '.pjsr-page-canvas[aria-label="Page 1"]';
      const TWO = '.pjsr-page-canvas[aria-label="Page 2"]';
      const read = (selector, ranges) => page.evaluate(BANDS, [selector, ranges, size.height]);
      const inked = (band) => Boolean(band) && band.marks > 30;
      const blank = (band) => Boolean(band) && band.marks < 10;
      const shown = (bands) =>
        bands === null
          ? '(no canvas)'
          : Object.entries(bands)
              .map(([name, band]) => `${name} ${band.marks}/${band.pixels}`)
              .join(', ');
      /** Poll one band until the predicate accepts it, and keep the last reading for the failure message. */
      const until = async (selector, ranges, name, accept, timeout = 20_000) => {
        let last = null;
        const hit = await waitFor(async () => {
          last = await read(selector, ranges);
          return last && accept(last[name]) ? last : null;
        }, timeout);
        return { bands: hit ?? last, settled: hit !== null };
      };

      /**
       * Every tab in the sidebar, with what a pointer landing on its centre would hit.
       *
       * The tablist is `flex: 1 1 auto` inside a 248 px sidebar and does not wrap, so a third tab runs past the
       * panel's own box and the page area — which comes later in DOM order — paints over the part that does. The
       * row therefore asks the same question a reader's finger asks (`elementFromPoint` at the centre, the way
       * #241 and #243 learned to ask it) and takes the keyboard path when the answer is not the tab itself,
       * rather than letting a pointer click time out and report a viewer defect that is really a reachability
       * one. Both paths are the application's own: the arrow keys are `Sidebar`'s roving tabindex, not a
       * synthetic event.
       */
      const tabs = () =>
        page.evaluate(() =>
          Array.from(document.querySelectorAll('.pjsr-sidebar [role="tab"]')).map((el) => {
            const box = el.getBoundingClientRect();
            const hit = document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2);
            return {
              label: (el.textContent ?? '').trim(),
              selected: el.getAttribute('aria-selected'),
              box: `${Math.round(box.x)},${Math.round(box.y)} ${Math.round(box.width)}x${Math.round(box.height)}`,
              reached: hit === el || el.contains(hit) || (hit !== null && hit.contains(el)),
              covers: hit ? `${hit.tagName.toLowerCase()}.${hit.className?.baseVal ?? hit.className ?? ''}` : '(nothing)',
            };
          }),
        );

      /** Open one sidebar tab the way a reader can, pointer when the tab takes the press, keyboard when it does not. */
      const openTab = async (label) => {
        const first = await tabs();
        const target = first.find((entry) => entry.label === label);
        if (!target) fail(`the sidebar tablist holds ${first.map((entry) => `"${entry.label}"`).join(', ')} and no "${label}"`);
        if (target.selected === 'true') return { how: 'already open', target };
        if (target.reached) {
          await page.click(`.pjsr-sidebar [role="tab"]:has-text("${label}")`);
          return { how: 'clicked', target };
        }
        const active = first.find((entry) => entry.selected === 'true') ?? first[0];
        await page.evaluate((name) => {
          const el = Array.from(document.querySelectorAll('.pjsr-sidebar [role="tab"]')).find(
            (tab) => (tab.textContent ?? '').trim() === name,
          );
          el?.focus();
        }, active.label);
        for (let step = 0; step < first.length; step += 1) {
          await page.keyboard.press('ArrowRight');
          const now = (await tabs()).find((entry) => entry.label === label);
          if (now?.selected === 'true') return { how: `arrow keys from "${active.label}" (a pointer at ${target.box} hits ${target.covers})`, target };
        }
        fail(
          `"${label}" never became the selected tab after ${first.length} ArrowRight presses from "${active.label}" — ` +
            `the tablist now reads ${JSON.stringify(await tabs())}`,
        );
        return { how: 'unreachable', target };
      };

      /** What one layer's checkbox reports right now. */
      const checkedOf = (label) =>
        page.evaluate((name) => {
          const li = Array.from(document.querySelectorAll('.pjsr-layers-item')).find(
            (item) => (item.querySelector('.pjsr-layers-name')?.textContent ?? '').trim() === name,
          );
          return li ? Boolean(li.querySelector('input[type=checkbox]')?.checked) : null;
        }, label);

      /*
       * Switch one layer and wait for the panel to agree, rather than using Playwright's `check()`.
       *
       * `check()` reads the box on the tick after the click and throws "Clicking the checkbox did not change
       * its state" when it has not moved yet — and it has not, because the click runs `setVisibility` on the
       * shared config and then `shell.repaint`, so the row's own `checked` prop only lands on the next React
       * commit. The stamp switch got lucky; the body one did not. The state is what the clause claims, so it is
       * waited for, and a panel that never shows it is reported as the stale list it is.
       */
      const toggle = async (label, want) => {
        const now = await checkedOf(label);
        if (now !== !want) {
          fail(
            `"${label}" reads checked=${now} before a switch ${want ? 'on' : 'off'} — the row expected ` +
              `${!want}, and clicking it now would move the wrong way`,
          );
        }
        await page.click(`.pjsr-layers-item:has-text("${label}") input[type="checkbox"]`);
        const settled = await waitFor(async () => ((await checkedOf(label)) === want ? true : null), 5_000);
        if (!settled) {
          fail(
            `clicking "${label}"'s checkbox left the panel reading checked=${await checkedOf(label)} after 5 s — ` +
              'a list that cannot see the state it just wrote is a copy, not the instance the render reads',
          );
        }
      };

      await (await reveal('Toggle sidebar')).click();
      await page.waitForSelector('.pjsr-sidebar');
      const opened = await openTab('Layers');
      const pointerReached = opened.target.reached;
      /*
       * #254, asserted rather than noted. The row was written to fall back to the tablist's own arrow keys
       * because a pointer could not reach this tab, and the fallback proved the keyboard reader's path while
       * hiding the mouse user's — so reaching a tab *is* now part of what this row requires, and the wrapping
       * tablist is what makes it true. The keyboard route stays in `openTab` as the shape a reader can take, not
       * as a way for the row to pass.
       */
      if (!pointerReached) {
        fail(
          `the "Layers" tab at ${opened.target.box} is not where a pointer lands: elementFromPoint at its centre ` +
            `answers "${opened.target.covers}", so a mouse user cannot open the layer list at all (#254) — ` +
            `the row got in by ${opened.how}, which is a reader's fallback and not a fix`,
        );
      }
      await page.waitForSelector('.pjsr-layers-item', { timeout: 20_000 });
      const rows = await page.evaluate(() =>
        Array.from(document.querySelectorAll('.pjsr-layers-item')).map((li) => ({
          name: (li.querySelector('.pjsr-layers-name')?.textContent ?? '').trim(),
          checked: li.querySelector('input[type=checkbox]')?.checked ?? null,
        })),
      );
      for (const [name, expectChecked] of [
        ['Heading layer', true],
        ['Body layer', true],
        ['Stamp layer', false],
      ]) {
        const row = rows.find((entry) => entry.name === name);
        if (!row) fail(`the layers tab listed ${rows.map((entry) => `"${entry.name}"`).join(', ')} without "${name}"`);
        if (row.checked !== expectChecked) {
          fail(
            `"${name}" reads checked=${row.checked} in the panel while /OCProperties declares it ` +
              `${expectChecked ? 'ON' : 'OFF'} — the list is not the document's state (${JSON.stringify(rows)})`,
          );
        }
      }

      /*
       * The premise, waited for. WebKit's cell failed the first version of this line by reading the canvas once
       * and finding every band blank — which is the instrument reading its own race, not a viewer that paints
       * nothing: the row had only just mounted the page. So the three bands that the document declares visible
       * are waited for, and a page that never paints them is reported as the missing premise it is.
       */
      let start = null;
      const painted = await waitFor(async () => {
        start = await read(ONE, PAGE1);
        return start && inked(start.plain) && inked(start.heading) && inked(start.body) ? start : null;
      }, 30_000);
      if (!painted) {
        fail(
          `page 1 never painted the two default-on layers and the ungrouped line beside them: ${shown(start)} after ` +
            `30 s in ${engine} — with nothing on the page there is no change for a switch to be measured against`,
        );
      }
      if (!blank(start.stamp)) {
        fail(
          `the Stamp layer is OFF in the document and still painted ${start.stamp.marks}/${start.stamp.pixels} ` +
            `dark px in its band (${shown(start)}) — this render is not reading /OCProperties, so nothing below can ` +
            'attribute a change to it',
        );
      }

      // The first switch also proves the panel writes the instance the page paints with: `checked` is read from
      // the rows, and the rows are rebuilt from the config on the repaint's revision bump.
      await toggle('Stamp layer', true);
      const on = await until(ONE, PAGE1, 'stamp', inked);
      if (!on.settled) {
        fail(
          `switching the Stamp layer on left its band at ${shown(on.bands && { stamp: on.bands.stamp })} after ` +
            `20 s (${engine}) — the checkbox moved and the page did not, which is what a config the render never ` +
            'reads looks like',
        );
      }
      const widened = await read(ONE, PAGE1);
      if (!inked(widened.plain) || !inked(widened.heading) || !inked(widened.body)) {
        fail(`switching one layer on took other content away: ${shown(widened)}`);
      }

      await toggle('Stamp layer', false);
      const off = await until(ONE, PAGE1, 'stamp', blank);
      if (!off.settled) {
        fail(
          `switching the Stamp layer back off left ${shown(off.bands && { stamp: off.bands.stamp })} in its band ` +
            `(${shown(off.bands)}) — the ink that arrived with the switch did not leave with it, so the reading ` +
            'above may have been a late paint rather than the layer',
        );
      }

      await toggle('Body layer', false);
      const p1body = await until(ONE, PAGE1, 'body', blank);
      if (!p1body.settled) {
        fail(`switching the Body layer off left page 1's grouped line painted: ${shown(p1body.bands)}`);
      }
      const p1left = await read(ONE, PAGE1);
      if (!inked(p1left.heading) || !inked(p1left.plain)) {
        fail(`switching one group off took more than that group with it: ${shown(p1left)}`);
      }

      // The second page, reached the way a reader reaches it, with the panel still showing what it read for page 1.
      await jumpTo(2);
      await page.waitForSelector(TWO, { timeout: 20_000 }).catch(() => undefined);
      const p2wait = await until(TWO, PAGE2, 'plain', inked, 30_000);
      const p2 = p2wait.bands;
      if (!p2) fail(`page 2 never mounted a canvas after the jump (${engine})`);
      if (!p2wait.settled) {
        fail(
          `page 2's ungrouped line never painted (${shown(p2)} after 30 s in ${engine}) — the page did not paint at ` +
            'all, so its grouped band being blank would say nothing about the layer either way',
        );
      }
      if (!blank(p2.body)) {
        fail(
          `page 2 still paints its Body-layer line (${p2.body.marks}/${p2.body.pixels} dark px) after the panel ` +
            `switched that group off for page 1 (${shown(p1left)}) — the clause says *every* page redraws from the ` +
            'same instance, and a config fetched per render leaves this page on the document defaults',
        );
      }

      await toggle('Body layer', true);
      const p2back = await until(TWO, PAGE2, 'body', inked);
      if (!p2back.settled) {
        fail(
          `switching the Body layer back on, while page 2 was the page on screen, left its band at ` +
            `${shown(p2back.bands && { body: p2back.bands.body })} (${shown(p2back.bands)})`,
        );
      }

      await page.click('.pjsr-sidebar .pjsr-sidebar-close');
      await page.waitForSelector('.pjsr-sidebar', { state: 'detached' });

      return (
        `${engine}: ${rows.length} groups listed as the document declares them (${rows.map((entry) => `${entry.name}=${entry.checked ? 'on' : 'off'}`).join(', ')}), ` +
        `the Layers tab ${pointerReached ? 'took a pointer click' : `was reached by ${opened.how}`}, ` +
        `page 1's Stamp band went ${start.stamp.marks} → ${on.bands.stamp.marks} → ${off.bands.stamp.marks} dark px ` +
        `of ${on.bands.stamp.pixels} for one switch on and back off, with the other three bands still painted ` +
        `(${shown(widened)}); page 2's grouped band followed the same panel to ${p2.body.marks} px blank and back ` +
        `to ${p2back.bands.body.marks} px while its ungrouped line stayed at ${p2back.bands.plain.marks}`
      );
    },
  },
  {
    /*
     * FR-19's marks half: what the reader drew has to arrive on paper.
     *
     * The clause sends three things with a page — form values, persisted annotation marks, and the reader's own
     * authoring marks *only when the authoring feature is loaded and they are persisted*. The first is measured
     * by `print-sheets-hide-the-application`, where a typed value moves the widget's own box on the sheet from
     * 27 dark px to over a thousand. The second was asserted only in jsdom, where the pipeline's `page.render`
     * is a mock and "it reached the sheet" describes nothing — so this row draws a stroke with the shipped ink
     * tool, prints the same page twice, and counts the same box on the same sheet before and after.
     *
     * Why the *print-intent* render is the only place this can be shown: the pipeline composites nothing. It
     * asks pdf.js for each page at `intent: 'print'` with `AnnotationMode.ENABLE_STORAGE` and hands those
     * canvases to the platform, so a mark gets to paper only if the engine draws it out of the document's
     * annotation storage. The DOM editor layer a reader sees on screen is not in the print container and cannot
     * be, which is also why the transient core pen needed a compositing step and this one does not. Asserting
     * that an `.inkEditor` element exists proves a mark was *made*; the delta below proves it was *kept where
     * the printer looks*.
     */
    name: 'print-carries-an-authored-mark',
    desktopOnly: true,
    run: async ({ page, load, reveal }) => {
      const engine = page.context().browser()?.browserType().name();
      const base = await basePageDims('annotated-sample.pdf', 1);
      await page.locator('.app-features label', { hasText: 'annotate' }).locator('input').check();
      await load('annotated-sample.pdf', 2);
      await page.evaluate(() => {
        const el = document.querySelector('.pjsr-viewport');
        el.scrollTop = 0;
        el.scrollLeft = 0;
      });
      // A predictable box: rows before this one leave the zoom wherever they parked it, and the region below is
      // expressed as fractions of the page.
      await page.selectOption(`${BAR} [aria-label="Zoom level"]`, 'automatic');
      await page.waitForSelector('.pjsr-page-canvas');

      /*
       * The stroke's box, in fractions of the page rather than in pixels: the screen canvas and the sheet are
       * two different rasterisations of the same page, and the ratio is the only thing they share. Page 1 of
       * this fixture puts its last line of text at 596 pt, so everything below 400 pt is blank paper — and the
       * blankness is asserted, not assumed, because the comparison is a delta.
       */
      const REGION = { x0: 0.1, x1: 0.6, y0: 0.32, y1: 0.46 };

      await page.evaluate((rect) => {
        const w = window;
        w.__jobs = [];
        w.__rect = rect;
        w.print = function print() {
          const container = document.querySelector('.pjsr-print');
          const canvases = container ? Array.from(container.querySelectorAll('canvas')) : [];
          const count = (data) => {
            let marks = 0;
            for (let i = 0; i < data.length; i += 4) {
              if (Math.abs(255 - data[i]) + Math.abs(255 - data[i + 1]) + Math.abs(255 - data[i + 2]) > 60) {
                marks += 1;
              }
            }
            return marks;
          };
          w.__jobs.push(
            canvases.map((canvas) => {
              const x0 = Math.max(0, Math.floor(rect.x0 * canvas.width));
              const x1 = Math.min(canvas.width, Math.ceil(rect.x1 * canvas.width));
              const y0 = Math.max(0, Math.floor(rect.y0 * canvas.height));
              const y1 = Math.min(canvas.height, Math.ceil(rect.y1 * canvas.height));
              if (x1 <= x0 || y1 <= y0) {
                return { width: canvas.width, height: canvas.height, marks: 0, pixels: 0 };
              }
              const ctx = canvas.getContext('2d', { willReadFrequently: true });
              const marks = ctx ? count(ctx.getImageData(x0, y0, x1 - x0, y1 - y0).data) : 0;
              return { width: canvas.width, height: canvas.height, marks, pixels: (x1 - x0) * (y1 - y0) };
            }),
          );
        };
      }, REGION);

      const jobCount = () => page.evaluate(() => window.__jobs.length);
      const lastJob = () => page.evaluate(() => window.__jobs[window.__jobs.length - 1] ?? null);

      /**
       * Every copy of the scope select, what each one reads, whether a pointer could reach it — and what the ⋯
       * panel is doing. The panel belongs in the same reading because a folded control lives behind it, and a row
       * that reports only the copies cannot tell "the reader would have to open the panel" from "the application
       * lost the control". (#278)
       */
      const readScope = () =>
        page.evaluate(() => {
          const copies = Array.from(
            document.querySelectorAll(
              '.pjsr-toolbar [aria-label="Print pages"], .pjsr-overflow-menu [aria-label="Print pages"]',
            ),
          ).map((el) => ({
            where: el.closest('.pjsr-overflow-menu')
              ? 'menu'
              : el.closest('.pjsr-toolbar-sizer')
                ? 'sizer'
                : 'bar',
            value: el.value,
            painted: el.getBoundingClientRect().width > 0 && getComputedStyle(el).visibility !== 'hidden',
          }));
          const trigger = document.querySelector('.pjsr-toolbar [aria-label="More controls"]');
          return {
            copies,
            panel: {
              open: !!document.querySelector('.pjsr-overflow-menu'),
              expanded: trigger ? (trigger.getAttribute('aria-expanded') ?? '(none)') : 'no trigger',
              rows: Array.from(document.querySelectorAll('.pjsr-overflow-menu .pjsr-overflow-label')).map(
                (row) => row.textContent?.trim() ?? '',
              ),
            },
          };
        });
      const scopeCopies = () => readScope().then((state) => state.copies);

      /*
       * One read of a folded control cannot answer the question this row is really asking, which is *where the
       * control went*. #278: CI's webkit · desktop cell failed saying "no copy a pointer could reach was present"
       * with only the hidden measuring copy in the dump, while `print-sheets-hide-the-application`, in the same
       * cell minutes earlier, wrote this same control's value through the ⋯ panel's copy at 795,288. So the panel
       * had closed between the reach and the read, and a single DOM scan read that as the application losing the
       * control. The row now polls while it reaches, and puts the panel back the way that row does, before it is
       * allowed to accuse.
       */
      const traceWhile = (flag, trace) => {
        const started = Date.now();
        return (async () => {
          while (flag.on) {
            const state = await readScope();
            const at = Date.now() - started;
            const last = trace[trace.length - 1];
            const same =
              last && JSON.stringify([last.copies, last.panel]) === JSON.stringify([state.copies, state.panel]);
            if (same) last.over = at;
            else trace.push({ at, ...state, over: null });
            await new Promise((resolve) => setTimeout(resolve, 100));
          }
        })();
      };

      /** The trace condensed to its transitions, so a failure reads as a story rather than as 300 snapshots. */
      const traceText = (trace) =>
        trace
          .map(
            (snap) =>
              `${snap.at}ms: ${
                snap.copies.length
                  ? snap.copies.map((c) => `${c.where}${c.painted ? '' : '(unpainted)'}`).join('+')
                  : 'no copy at all'
              } panel ${
                snap.panel.open ? `open (${snap.panel.rows.length} rows)` : `closed/${snap.panel.expanded}`
              }${snap.over === null ? '' : ` held ${snap.over - snap.at}ms`}`,
          )
          .join(' → ');

      /**
       * How many times the set of copies changed shape while the control was being reached for. bar ↔ panel is
       * what a reader would notice, and #243's family; a row that only names the door cannot tell a fold that sat
       * still from a control that flickered between the bar and the panel (#278).
       */
      const movesIn = (trace) => {
        const shape = (snap) => snap.copies.map((c) => `${c.where}${c.painted ? '' : '(unpainted)'}`).join('+');
        let moves = 0;
        for (let i = 1; i < trace.length; i += 1) if (shape(trace[i]) !== shape(trace[i - 1])) moves += 1;
        return moves;
      };

      /** Open the ⋯ panel if it is not open, the way a reader does it: a pointer click on the trigger. */
      const openPanelIfClosed = async () => {
        if ((await readScope()).panel.open) return 'the panel was already open';
        const trigger = page.locator(`${BAR} [aria-label="More controls"]:visible`);
        if ((await trigger.count()) === 0) return 'there was no ⋯ trigger to click';
        await trigger.click();
        await page.waitForSelector('.pjsr-overflow-menu', { timeout: 5_000 }).catch(() => undefined);
        return (await readScope()).panel.open
          ? 'a pointer click reopened the panel that had closed'
          : 'the ⋯ trigger was clicked and no panel appeared';
      };

      /*
       * Choose "All pages", and prove the application took it.
       *
       * The scope is not assumed because rows share one page and `print-sheets-hide-the-application` leaves it on
       * "From–to" — a job of one sheet for page 2, which would make the sheet this row reads a different page from
       * the one it drew on. WebKit refuses `selectOption` on a native `<select>` (that engine's note is in the
       * print row), so the fallback puts the value on through the event the application listens for, on the copy a
       * pointer could reach rather than the hidden measuring one (#243) — and since #278, when that copy is behind
       * a panel that has closed, the row opens the panel and looks again before it calls the control unreachable.
       */
      let scopeDoor = 'locator.selectOption';
      const pickAll = async () => {
        const control = await reveal('Print pages');
        const trace = [];
        const flag = { on: true };
        const poller = traceWhile(flag, trace);
        const finish = async () => {
          flag.on = false;
          await poller;
        };
        try {
          await control.selectOption('all');
        } catch (error) {
          const refusal = firstLine(error);
          const door = await openPanelIfClosed();
          const wrote = await page.evaluate(() => {
            const copies = Array.from(
              document.querySelectorAll(
                '.pjsr-toolbar [aria-label="Print pages"], .pjsr-overflow-menu [aria-label="Print pages"]',
              ),
            ).filter((el) => !el.closest('.pjsr-toolbar-sizer') && el.getBoundingClientRect().width > 0);
            const el = copies[0];
            if (!el) return 'none';
            el.value = 'all';
            el.dispatchEvent(new Event('input', { bubbles: true }));
            el.dispatchEvent(new Event('change', { bubbles: true }));
            return `${copies.length} copy(ies)`;
          });
          if (wrote === 'none') {
            await finish();
            fail(
              `"All pages" could not be written and no copy of the scope control a pointer could reach was present ` +
                `after ${refusal} — ${door}. The control went: ${traceText(trace) || '(no samples)'}, so this is ` +
                'not a panel that merely closed on a control still sitting behind it',
            );
          }
          scopeDoor = `${door}, then the change event on ${wrote}`;
        }
        const settled = await waitFor(async () => {
          const copies = await scopeCopies();
          return copies.length > 0 && copies.every((copy) => copy.value === 'all') ? copies : null;
        }, 5_000);
        await finish();
        if (!settled) {
          fail(
            `the print scope never settled on "all" — it read ${JSON.stringify(await scopeCopies())} after 5 s, so ` +
              `the sheet counts below would be some other selection's. The control went: ${traceText(trace)}`,
          );
        }
        const moves = movesIn(trace);
        if (moves) {
          scopeDoor += `, after the control changed place ${moves} time(s) while it was being reached for`;
        }
        return settled;
      };
      const scopePath = await pickAll();

      /** Press the viewer's own print control, then wait for the job to reach the boundary and for the app to come back. */
      const printNow = async (step) => {
        const before = await jobCount();
        const button = await reveal('Print document');
        await button.click();
        const arrived = await waitFor(async () => ((await jobCount()) > before ? true : null), 60_000);
        if (!arrived) {
          fail(`${step}: the pipeline never reached window.print() within 60 s, so there was no sheet to read`);
        }
        const torn = await waitFor(
          async () => (await page.evaluate(() => !document.querySelector('.pjsr-print')) ? true : null),
          15_000,
        );
        if (!torn) fail(`${step}: the print container was still in the document 15 s after the job reached the printer`);
        return lastJob();
      };

      const first = await printNow('before the mark');
      if (!first || first.length !== 2) {
        fail(
          `"All pages" (every copy of the control reads "${scopePath[0]?.value}") printed ${first ? first.length : 0} ` +
            `sheet(s) for a two-page fixture, so page 1 had no sheet to compare against: ${JSON.stringify(first)}`,
        );
      }
      if (first[0].pixels < 4_000) {
        fail(
          `the box the stroke is planned into covers ${first[0].pixels} px of a ${first[0].width}x${first[0].height} ` +
            `sheet — a region too small to measure a mark in`,
        );
      }
      if (first[0].marks > 30) {
        fail(
          `the region already holds ${first[0].marks} dark px of ${first[0].pixels} on page 1's sheet before ` +
            'anything is drawn, so the fixture is not blank where this row planned to mark it and a delta would mean nothing',
        );
      }

      const pen = await reveal('Ink');
      await pen.click();
      await page.waitForFunction(
        () => document.querySelector('.pjsr-editor-layer')?.className.includes('inkEditing') === true,
        undefined,
        { timeout: 15_000 },
      );
      /*
       * Aim at the band, and scroll it into view first.
       *
       * The region is a fixed fraction of the page — the sheet is read by fraction, so it cannot move — and a
       * page at fit-width on a 1,280px window is ~1,571 CSS px tall in a 900px viewport, so a band at 32-46 %
       * of the page is off the bottom of the window unless the row scrolls. That is #228's lesson applied to
       * the harness's own aim: the claim is about a place on the page, and the instrument has to go there.
       */
      const at = await page.evaluate((rect) => {
        const scroller = document.querySelector('.pjsr-viewport');
        const canvas = document.querySelector('.pjsr-page-canvas');
        if (!canvas || !scroller) return { error: 'there is no page-1 canvas to aim at' };
        // The frame the point has to live inside is the scroll element's own box: the playground's header and
        // event log sit above and below the viewer, so "60 px from the top of the window" is a feature checkbox.
        const view = scroller.getBoundingClientRect();
        let box = canvas.getBoundingClientRect();
        scroller.scrollTop += box.top + box.height * rect.y0 - (view.top + 60);
        box = canvas.getBoundingClientRect();
        const x = box.left + box.width * rect.x0;
        const y = box.top + box.height * rect.y0;
        const bottom = box.top + box.height * rect.y1;
        if (y < view.top + 8 || bottom > view.bottom - 8 || box.width < 200) {
          return {
            error:
              `the region runs y=${Math.round(y)}..${Math.round(bottom)} inside a viewport of ` +
              `${Math.round(view.width)}x${Math.round(view.height)} at y=${Math.round(view.top)} (canvas ` +
              `${Math.round(box.width)}x${Math.round(box.height)} at y=${Math.round(box.top)}, scroll ` +
              `${Math.round(scroller.scrollTop)}) — nothing to draw on`,
          };
        }
        const hit = document.elementFromPoint(x, y);
        return {
          x,
          y,
          width: box.width,
          height: box.height,
          scrolled: Math.round(scroller.scrollTop),
          layer: hit?.closest('.pjsr-editor-layer') instanceof Element,
          name: hit ? `${hit.tagName.toLowerCase()}.${hit.className?.baseVal ?? hit.className ?? ''}` : '(nothing)',
        };
      }, REGION);
      if (at.error) fail(`cannot aim the stroke on page 1: ${at.error}`);
      if (!at.layer) {
        fail(
          `the armed point (${Math.round(at.x)},${Math.round(at.y)}) is over "${at.name}" rather than the editor ` +
            'layer, so the drag would not be a mark on the page',
        );
      }
      await page.mouse.move(at.x, at.y);
      await page.mouse.down();
      for (let step = 1; step <= 10; step += 1) {
        const fx = (REGION.x1 - REGION.x0) * (step / 10);
        const fy = step % 2 === 0 ? 0.13 : 0.05;
        await page.mouse.move(at.x + fx * at.width, at.y + fy * at.height, { steps: 3 });
      }
      await page.mouse.up();
      // Take the tool off before counting: the engine builds the editor when the mode changes rather than at
      // every pointerup, and an editor element is the mark that lives in annotation storage — the draw layer
      // this gesture paints into is gone by the time the printer is asked.
      await pen.click();
      const editors = await waitFor(
        () => page.evaluate(() => document.querySelectorAll('.pjsr-editor-layer .inkEditor').length || null),
        15_000,
      );
      if (!editors) {
        fail(
          `a mouse drag across page 1 with the pen armed, and the tool then taken off, produced no ink editor in ` +
            `the layer (${engine}) — nothing was authored, so the sheet comparison below has no mark in it`,
        );
      }

      const second = await printNow('after the mark');
      if (!second || second.length !== first.length) {
        fail(
          `the second job printed ${second ? second.length : 0} sheet(s) against ${first.length} for the same ` +
            'selection, so the two readings are not of the same pages',
        );
      }
      if (second[0].width !== first[0].width || second[0].height !== first[0].height) {
        fail(
          `page 1 reached the sheet at ${first[0].width}x${first[0].height} device px before the mark and ` +
            `${second[0].width}x${second[0].height} after it, so the two counts are not the same measurement`,
        );
      }
      const gained = second[0].marks - first[0].marks;
      if (gained < 100) {
        fail(
          `the drawn mark never reached paper: page 1's sheet holds ${second[0].marks} dark px in the ` +
            `${second[0].pixels} px box after ${editors} ink editor was committed to annotation storage, against ` +
            `${first[0].marks} before it (engine ${engine}, pdfjs-dist ${engineVersion}) — the clause says a ` +
            'persisted mark travels with the pages',
        );
      }
      // Page 2 is the control: same job, same box, a page nobody drew on.
      const control = second[1].marks - first[1].marks;
      if (control > 20) {
        fail(
          `page 2's sheet gained ${control} dark px in the same box where only page 1 was marked ` +
            `(${first[1].marks} → ${second[1].marks}), so the reading is not about the page that was drawn on`,
        );
      }

      return (
        `${engine}: ${scopePath.length} copies of the scope control read "all" (written by ${scopeDoor}), ` +
        `${first.length} sheets at ` +
        `${first[0].width}x${first[0].height} device px, and page 1's own ${first[0].pixels} px box went ` +
        `${first[0].marks} → ${second[0].marks} dark px for one authored mark held in annotation storage ` +
        `(${editors} ink editor committed, the draw layer gone), while page 2's sheet in the same box moved ` +
        `${first[1].marks} → ${second[1].marks}`
      );
    },
  },
  {
    name: 'nothing-came-from-a-cdn',
    cell: true,
    run: ({ external, local }) => {
      if (external.length) fail(`fetched from a CDN: ${external[0]}`);
      // The engine files counted here are the worker resolved out of `node_modules` by the dev server, not
      // hits on the playground's `/pdfjs-dist/` middleware: none of these fixtures needs a cMap, a standard
      // font or a wasm decoder. So this measures "nothing left the machine", which is what it says.
      const files = new Set(local.map((u) => u.split('/').pop()));
      return `${local.length} requests for ${files.size} engine file(s) served locally, ${external.length} off-machine`;
    },
  },
  {
    name: 'no-uncaught-errors',
    cell: true,
    run: ({ pageErrors, consoleErrors }) => {
      const noise = consoleErrors.length ? ` (${consoleErrors.length} console errors, first: ${consoleErrors[0]})` : '';
      if (pageErrors.length) fail(`${pageErrors.length} uncaught: ${pageErrors.slice(0, 2).join(' / ')}`);
      return `0 uncaught${noise}`;
    },
  },
];

// ---------------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------------

/** Poll an ink reading until the canvas actually carries marks, or give up with the last reading. */
async function pollInk(page, selector, timeout = 25_000) {
  const deadline = Date.now() + timeout;
  let last = null;
  for (;;) {
    last = await page.evaluate(INK, [selector]);
    if (last && last.ratio >= 0.0005) return last;
    if (Date.now() > deadline) return last;
    await page.waitForTimeout(120);
  }
}

async function waitFor(fn, timeout) {
  const deadline = Date.now() + timeout;
  for (;;) {
    const out = await fn();
    if (out) return out;
    if (Date.now() > deadline) return null;
    await new Promise((r) => setTimeout(r, 120));
  }
}

const firstLine = (error) => String(error?.message ?? error).split('\n')[0].slice(0, 120);

/**
 * Playwright puts the locator it was waiting for on a later line than the timeout, and a report that names
 * only the first line says "timed out" without saying what never appeared.
 */
const errText = (error) => String(error?.message ?? error).replace(/\s+/g, ' ').slice(0, 260);

/**
 * A browser that will not start is a different finding from a check that failed, and the log has to tell
 * them apart: an engine whose process dies before a page exists means nothing in this package has been
 * measured there, which is a gap in the evidence rather than a defect in the viewer. It has happened on this
 * host — the recorded readings include firefox and webkit exiting with an NTSTATUS before any report line —
 * and it is not a permanent property of it: the run of 2026-10-07 started all three engines here (chromium
 * 153.0.8010.12, firefox 155.0, webkit 26.6). The status code is translated because a decimal NTSTATUS is not
 * something a reader can look up in a log.
 */
const NTSTATUS = { 3236495362: '0xC0000142, DLL initialisation failed' };
const launchText = (error) => {
  const raw = errText(error);
  const named = NTSTATUS[Number(/exitCode=(\d+)/.exec(raw)?.[1])];
  return named ? `${raw} — the engine process itself exited with ${named}` : raw;
};

async function runCell(engineName, profileName, baseUrl) {
  const browser = BROWSERS[engineName];
  const profile = PROFILES[profileName];
  const launch = await browser.launch({ headless: true });
  const options = {
    viewport: profile.viewport,
    deviceScaleFactor: profile.deviceScaleFactor,
  };
  // `isMobile` and `hasTouch` are Chromium/WebKit affordances; asking Firefox for them is a request it
  // ignores, so the flag is only passed where it changes something, and the touch check reports what the
  // engine's own `pointer: coarse` answer was either way.
  if (profile.touch && engineName !== 'firefox') {
    options.hasTouch = true;
    if (engineName === 'chromium') options.isMobile = true;
  }
  const context = await launch.newContext(options);
  const page = await context.newPage();
  page.setDefaultTimeout(30_000);

  const pageErrors = [];
  const consoleErrors = [];
  const external = [];
  const local = [];
  /*
   * Which row was running when the engine threw. `no-uncaught-errors` is a cell-level check, so before this it
   * could only say "1 uncaught" about nineteen rows and a whole matrix run — the first webkit desktop reading of
   * 2026-10-07 said exactly that, and nothing in the log could say whether the cause was the print row, the ink
   * row or a document swap two checks earlier. The name is stamped where the error is *recorded*, not where it is
   * reported, because a throw from a `setTimeout` lands here long after the row that scheduled it.
   */
  let runningCheck = '(before the first check)';
  page.on('pageerror', (error) => pageErrors.push(`[${runningCheck}] ${firstLine(error)}`));
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text().split('\n')[0].slice(0, 120));
  });
  // No network in the matrix: the playground's default document is a remote URL, so refusing it keeps a run
  // measuring three engines against local bytes rather than measuring the internet.
  let ready = false;
  await page.route(/raw\.githubusercontent\.com|unpkg\.com/, (route) => route.abort());
  page.on('request', (request) => {
    const url = request.url();
    if (/unpkg\.com|raw\.githubusercontent\.com|jsdelivr|cdn\./.test(url)) {
      // The default document is requested by the app before the harness can point it at a fixture; the
      // refusal above is ours, so only post-load requests count against the claim this check makes.
      if (ready) external.push(url);
    } else if (/\/pdfjs-dist\//.test(url)) {
      local.push(url);
    }
  });
  await page.goto(baseUrl, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.app-header');
  await page.selectOption('.app-header select', '/pdfjs-dist/');

  const harness = {
    page,
    profile,
    pageErrors,
    consoleErrors,
    external,
    local,
    log: (prefix) => page.evaluate(LAST_LOG, prefix),
    watchPageChanges: () => page.evaluate(START_PAGE_CHANGE_WATCH),
    pageChanges: () => page.evaluate(() => window.__pjsrPageChanges?.slice() ?? []),
    viewportBox: async () =>
      (await page.locator('.pjsr-viewport').boundingBox()) ?? { x: 0, y: 0, width: 300, height: 300 },
    load: async (file, pages) => {
      // An absolute URL, because `input[type=url]` refuses a relative path on validation grounds and the
      // form would silently not submit — a harness that typed `/fixtures/x.pdf` would be watching a viewer
      // that was never asked to load anything.
      await page.fill('.app-url input[type=url]', new URL(`/fixtures/${file}`, baseUrl).href);
      await page.press('.app-url input[type=url]', 'Enter');
      // The document label is read off the *requested source*, so it changes the moment a load starts and
      // proves nothing about the document that arrived — a check that settled on it measured the previous
      // file's page count. The count does belong to the arrived document, and it is declared by the check
      // rather than read back, so a fixture that changes shape fails loudly instead of being measured
      // quietly as something else.
      const stem = file.replace(/\.pdf$/, '');
      await page.waitForFunction(
        ([name, count]) =>
          (document.querySelector('.pjsr-meta-title')?.textContent ?? '').includes(name) &&
          (document.querySelector('.pjsr-page-count')?.textContent ?? '').trim() === `of ${count}`,
        [stem, pages],
        { timeout: 45_000 },
      );
      await page.waitForSelector('.pjsr-page-canvas');
      ready = true;
    },
    /**
     * A locator for a named bar control, opening the overflow menu first when the bar has folded it away.
     * It hands back the locator rather than clicking it, so a check can fill a field as well as press a
     * button, and the menu opening is what a reader with a phone does rather than a shortcut the harness
     * is owed.
     */
    reveal: async (label) => {
      const control = page.locator(`${BAR} [aria-label="${label}"]:visible`).first();
      if ((await page.locator(`${BAR} [aria-label="${label}"]:visible`).count()) > 0) return control;
      const menu = page.locator(`${BAR} [aria-label="More controls"]:visible`);
      if ((await menu.count()) === 0) {
        /*
         * #276: this line failed in webkit desktop for three runs with a sentence about the viewer and no way
         * to tell which of two things it had found — a control the application never rendered, or a control the
         * row reached for before the application had been told to want it. So the verdict now carries the bar's
         * own state: every label it holds, where each copy of the missing control is (bar, measuring sizer,
         * overflow panel) and whether a pointer could reach it, the bar's width against its scroll width, and
         * the playground's feature boxes, since a control group is a feature's and a folded bar with no
         * overflow to open is what a *shorter* bar looks like.
         */
        const seen = await page.evaluate((wanted) => {
          const bar = document.querySelector('.pjsr-toolbar');
          const where = (node) =>
            node.closest('.pjsr-toolbar-sizer') ? 'sizer' : node.closest('.pjsr-overflow-menu') ? 'panel' : 'bar';
          const copies = [...document.querySelectorAll(`[aria-label="${wanted}"]`)].map((n) => {
            const r = n.getBoundingClientRect();
            const cs = getComputedStyle(n);
            return `${where(n)} ${Math.round(r.x)},${Math.round(r.y)} ${Math.round(r.width)}x${Math.round(r.height)} ${cs.visibility}`;
          });
          return {
            labels: [...document.querySelectorAll('.pjsr-toolbar [aria-label]')]
              .filter((n) => {
                const r = n.getBoundingClientRect();
                return r.width > 0 && r.height > 0 && getComputedStyle(n).visibility !== 'hidden';
              })
              .map((n) => n.getAttribute('aria-label')),
            copies,
            bar: bar ? `${bar.clientWidth}/${bar.scrollWidth}px` : '(no bar)',
            panel: document.querySelectorAll('.pjsr-overflow-menu').length,
            features: [...document.querySelectorAll('.app-features input')]
              .map((i) => `${(i.closest('label')?.textContent ?? '').trim() || '?'}=${i.checked}`)
              .join(','),
          };
        }, label);
        fail(
          `no "${label}" control in the ${profile.viewport.width}px bar, and no overflow menu to look in: ` +
            `the bar holds [${seen.labels.join(', ') || '(nothing visible)'}], bar clientWidth/scrollWidth ` +
            `${seen.bar}, ${seen.panel} panel(s), ${seen.copies.length} copy(ies) of that label ` +
            `${seen.copies.length ? `[${seen.copies.join('; ')}]` : '— the application never rendered it'}${
              seen.features ? `, features ${seen.features}` : ''
            }`,
        );
      }
      /*
       * Open the panel; never toggle it. The first version clicked whenever the control was not in the bar, so a
       * row that asked for a *second* folded control after the menu was already open closed the one it was
       * reaching into — and then waited for a panel that had just gone away. `print-sheets-hide-the-application`
       * found it by typing into print's two range fields back to back, and the failure read as a missing input
       * rather than as this.
       */
      if ((await page.locator('.pjsr-overflow-menu').count()) === 0) await menu.click();
      await page.waitForSelector('.pjsr-overflow-menu');
      return control;
    },
    jumpTo: async (pageNumber) => {
      const field = page.locator(`${BAR} .pjsr-page-input:visible`);
      if ((await field.count()) === 0) {
        await page.click(`${BAR} [aria-label="More controls"]:visible`);
        await page.waitForSelector('.pjsr-overflow-menu');
      }
      if ((await field.count()) > 0) {
        await field.first().fill(String(pageNumber));
        await field.first().press('Enter');
        return `typed ${pageNumber} into the page field`;
      }
      // The field is a `hideOnly` control at this width — folded away would be a different story, but the
      // menu has no row for it either. A reader in the same position scrolls, and so does the harness.
      await page.evaluate(() => {
        const el = document.querySelector('.pjsr-viewport');
        el.scrollTop = el.scrollHeight;
      });
      return 'scrolled to the end of the document';
    },
  };

  const results = [];
  for (const check of CHECKS) {
    if (check.mobileOnly && !profile.touch) continue;
    if (check.desktopOnly && profile.touch) continue;
    if (ONLY_CHECKS.length && !check.cell && !ONLY_CHECKS.some((name) => check.name.startsWith(name))) continue;
    const started = Date.now();
    runningCheck = check.name;
    try {
      const detail = await check.run(harness);
      if (detail && typeof detail === 'object' && detail[SKIP]) {
        results.push({ check: check.name, status: 'skip', detail: detail[SKIP], ms: Date.now() - started });
      } else {
        results.push({ check: check.name, status: 'ok', detail: String(detail), ms: Date.now() - started });
      }
    } catch (error) {
      results.push({
        check: check.name,
        status: 'fail',
        detail: `${error instanceof Failure ? '' : `${error.name}: `}${errText(error)}`,
        ms: Date.now() - started,
      });
    }
  }

  await context.close();
  await launch.close();
  const version = launch.version();
  return {
    engine: engineName,
    version,
    profile: profileName,
    started: true,
    // A cell-level verdict rather than another check: §8's own row counts are quoted in that table and
    // in this file's header, and the floor is a statement about the engine the cell ran on, not about a
    // property of the viewer.
    floor: floorVerdict(engineName, version),
    results,
  };
}

// ---------------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------------

/**
 * Does the browser get the engine this file claims it got?
 *
 * Vite's dependency cache is keyed on the lockfile, so replacing `node_modules/pdfjs-dist` with another
 * release — which is how a peer floor is measured — leaves `deps/pdfjs-dist.js` holding the *previous*
 * engine, and the page runs that one. Both halves of the mismatch look legitimate from the outside: the
 * banner prints the version read off `node_modules`, and the symptom is every document-load check timing
 * out. Measured twice on 2026-10-05, once in each direction — 22 timeouts on a run that called itself
 * `6.2.108` while its prebundle carried `6.3.289`, then a `6.3.289` run that hung against the `6.2.108`
 * prebundle the run before it had written. A matrix that reports an engine it did not exercise is worse
 * than one that fails, so this refuses to start instead.
 */
function prebundleMismatch() {
  const caches = [
    join(repo, 'node_modules', '.vite', 'deps'),
    join(repo, 'playground', 'node_modules', '.vite', 'deps'),
  ];
  for (const dir of caches) {
    if (!existsSync(dir)) continue;
    const file = readdirSync(dir).find((name) => /^pdfjs-dist[a-zA-Z0-9_-]*\.js$/.test(name));
    if (!file) continue;
    const found = /version\s*=\s*["'](\d+\.\d+\.\d+)["']/.exec(readFileSync(join(dir, file), 'utf8'));
    if (found && found[1] !== engineVersion) {
      return `${relative(repo, join(dir, file))} holds ${found[1]} while node_modules/pdfjs-dist is ${engineVersion}`;
    }
  }
  return null;
}

const stalePrebundle = prebundleMismatch();
if (stalePrebundle) {
  console.error(
    `FAIL  the browser would not run the engine this matrix claims to measure: ${stalePrebundle}.\n` +
      '      Remove the dependency cache (`node_modules/.vite`) before trusting anything below this line; the\n' +
      '      failures that follow are document loads timing out against the wrong bundle, not viewer defects.',
  );
  process.exit(2);
}

const server = await createServer({
  root: join(repo, 'playground'),
  configFile: join(repo, 'playground', 'vite.config.ts'),
  server: { port: 5299, host: '127.0.0.1' },
  logLevel: 'warn',
});
await server.listen();
const baseUrl = server.resolvedUrls?.local[0] ?? 'http://127.0.0.1:5299/';
console.log(
  `playground served from ${baseUrl} (pdfjs-dist ${engineVersion}, Playwright ${driverVersion}${
    process.env.PJSR_PLAYWRIGHT ? ', pinned driver' : ''
  })`,
);

/*
 * FR-58, §9: "the release candidate is built and tested on a clean runner **from the packed npm artifact**", and
 * `PJSR_TARGET=dist` is how the playground is pointed at the build instead of the sources. An environment variable
 * is a claim, not a witness: a stale alias, an unbuilt `dist/`, or a config that stopped honouring the flag all
 * still print `dist` while the browser loads `src`. So the copy under test is read off the module graph the page
 * actually requested — Vite serves the repository's own files under `/@fs/<repo>/dist/…` or `/@fs/<repo>/src/…`,
 * which is the difference between the two — and a run that asked for the artifact and got the sources refuses to
 * produce readings at all. The same shape as `prebundleMismatch()` above: measure what the browser got, or say nothing.
 */
async function servedLibraryCopy() {
  const driver = { chromium, firefox, webkit }[ONLY_ENGINES[0]];
  if (!driver) return { observed: 'unreadable', detail: `no driver for ${ONLY_ENGINES[0]}` };
  let browser;
  try {
    browser = await driver.launch();
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    await page.goto(baseUrl, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('.app-header', { timeout: 30_000 }).catch(() => undefined);
    const urls = await page.evaluate(() => performance.getEntriesByType('resource').map((e) => e.name));
    const count = (segment) => urls.filter((url) => url.includes(segment)).length;
    const dist = count('pdfjs-react-reader/dist/');
    const src = count('pdfjs-react-reader/src/');
    const observed = dist > 0 && src === 0 ? 'dist' : src > 0 && dist === 0 ? 'src' : dist > 0 ? 'mixed' : 'unreadable';
    return { observed, detail: `${dist} artifact module(s), ${src} source module(s)` };
  } catch (error) {
    return { observed: 'unreadable', detail: String(error.message ?? error).split('\n')[0].slice(0, 120) };
  } finally {
    await browser?.close();
  }
}

const requestedCopy = process.env.PJSR_TARGET === 'dist' ? 'dist' : 'src';
const served = await servedLibraryCopy();
console.log(`library copy under test: ${served.observed} (${served.detail}) — asked for ${requestedCopy}`);
if (requestedCopy === 'dist' && served.observed !== 'dist') {
  console.error(
    `FAIL  PJSR_TARGET=dist was asked for and the browser got \`${served.observed}\`: ${served.detail}.\n` +
      '      FR-58 tests the artifact, so a run that silently serves the sources is not evidence about the artifact.\n' +
      '      Run `npm run build` first, and check that dist/ holds index.js plus the feature and locale entries.',
  );
  await server.close();
  process.exit(2);
}

const cells = [];
for (const engineName of ONLY_ENGINES) {
  for (const profileName of ONLY_PROFILES) {
    console.log(`\n${engineName} · ${PROFILES[profileName].note}`);
    let cell;
    try {
      cell = await runCell(engineName, profileName, baseUrl);
    } catch (error) {
      cell = {
        engine: engineName,
        version: 'did not start',
        profile: profileName,
        started: false,
        results: [{ check: '(engine launch)', status: 'na', detail: launchText(error) }],
      };
    }
    cells.push(cell);
    if (cell.floor) {
      const mark = cell.floor.status === 'ok' ? '  ok  ' : cell.floor.status === 'na' ? ' n/a  ' : ' FAIL ';
      const detail =
        cell.floor.status === 'ok'
          ? `${cell.engine} ${cell.floor.major} is at or above §8's floor ${cell.floor.claimed}`
          : cell.floor.status === 'na'
            ? `${cell.engine} reported "${cell.floor.actual}" — no version to compare against §8's ${cell.floor.claimed}`
            : `${cell.engine} ${cell.floor.actual} is below §8's floor ${cell.floor.claimed} — §8: a stale engine fails the engine row, not the page`;
      console.log(`  ${mark} ${'engine-floor'.padEnd(28)} ${detail}`);
    }
    for (const r of cell.results) {
      const mark = r.status === 'ok' ? '  ok  ' : r.status === 'skip' ? ' skip ' : r.status === 'na' ? ' n/a  ' : ' FAIL ';
      console.log(`  ${mark} ${r.check.padEnd(28)} ${r.detail}`);
    }
  }
}

await server.close();

const tally = (status) => cells.reduce((n, c) => n + c.results.filter((r) => r.status === status).length, 0);
/** Floor verdicts are cell-level, so they are counted on their own axis rather than folded into `tally`. */
const floors = (status) => cells.filter((c) => c.floor?.status === status).length;
console.log(
  `\n${cells.length} engine×profile cells on pdfjs-dist ${engineVersion}: ${tally('ok')} ok, ${tally('skip')} skipped, ${tally('na')} not runnable, ${tally('fail')} failed` +
    `; engine floors vs §8: ${floors('ok')} at or above, ${floors('fail')} below, ${floors('na')} unreadable.`,
);

// An engine that never started leaves its §8 row unbacked, and a summary that only counts failures would
// let that read as "one row of the table has a problem" rather than "this row has no evidence yet".
const missing = [...new Set(cells.filter((c) => c.started === false).map((c) => c.engine))];
if (missing.length) {
  console.log(
    `Not started on this host: ${missing.join(', ')}. Their §8 rows stay targets — the CI browser job is the instrument that will run them.`,
  );
}
console.log(
  'Also not evidence from this run: Edge (its own per-release pass), iOS/Android hardware (emulation only),',
);
console.log('the pdfjs-dist version spread (the consumer job) or React majors (the react job).');

if (!args.includes('--no-json')) {
  mkdirSync(join(repo, '.spike'), { recursive: true });
  writeFileSync(
    join(repo, '.spike', 'browser-matrix.json'),
    JSON.stringify({ engineVersion, ranAt: new Date().toISOString(), cells }, null, 1),
  );
  console.log(`wrote .spike/browser-matrix.json`);
}

// A cell that could not be run is not a pass: §8's own rule is that a row is not tested until the job named
// as its evidence runs, so an engine that never started has to fail the run rather than shrink it. The floor
// comparison is in the same family — an engine older than the number the table claims makes every row in
// that cell evidence about the wrong version — and neither is reported through `results`, because a summary
// that counts only check rows would let both read as a shorter matrix rather than a missing one.
process.exit(tally('fail') || tally('na') || floors('fail') || floors('na') ? 1 : 0);
