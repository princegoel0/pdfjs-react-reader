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
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import { chromium, firefox, webkit } from 'playwright';

const repo = join(dirname(fileURLToPath(import.meta.url)), '..');
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
const KNOWN_FLAGS = ['--engines', '--profiles', '--no-json'];
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
      // Closed with the panel's own control rather than the toolbar's: an open sidebar narrows the bar the
      // fold check measures next, and by this width the toggle may itself be folded away.
      await page.click('.pjsr-sidebar .pjsr-sidebar-close');
      await page.waitForSelector('.pjsr-sidebar', { state: 'detached' });
      return `${thumbs} thumbnails at ${(ink.ratio * 100).toFixed(2)} % ink, outline ${items} items`;
    },
  },
  {
    name: 'virtualizes-1000-pages',
    run: async ({ page, log, load, jumpTo }) => {
      await load('long-sample.pdf', 1000);
      const count = (await page.textContent(`${COUNT}`))?.trim() ?? '';
      const total = Number(count.replace(/\D+/g, ''));
      if (!Number.isFinite(total) || total < 900) fail(`page count reads "${count}"`);
      const mounted = await page.locator('.pjsr-page-slot').count();
      const height = await page.evaluate(() => document.querySelector('.pjsr-viewport')?.scrollHeight ?? 0);
      const how = await jumpTo(total);
      // 90s rather than 30, the elapsed time printed, and the scroll position reported on failure, because this
      // row came up red on WebKit desktop (stuck at page 733, no further movement for the whole window) in one
      // run and green in the next. The red one was a harness artifact: two matrix processes sharing one dev-server
      // port. Re-run alone, WebKit desktop reaches page 999 in 0.1s and WebKit mobile page 1000 in 0.1s, so there
      // is no engine defect here to file — and what the long ceiling plus the extra detail buy is the ability to
      // say which of those two things happened, from the log line, without re-running anything.
      const walked = Date.now();
      const line = await waitFor(async () => {
        const latest = await log('onPageChange');
        return Number(latest.replace(/\D+/g, '')) >= total - 3 ? latest : null;
      }, 90_000);
      const seconds = ((Date.now() - walked) / 1000).toFixed(1);
      if (line === null) {
        // The bare "never reached the end" message said nothing about *how* it failed, and a row that is red in
        // one run and green in the next has to be diagnosable from its own line. Where the reader stopped, how
        // far the scroll got and how many slots are mounted are what tell a contended port from a stalled walk.
        const stuck = await log('onPageChange');
        const { top, height } = await page.evaluate(() => {
          const el = document.querySelector('.pjsr-viewport');
          return { top: el?.scrollTop ?? -1, height: el?.scrollHeight ?? -1 };
        });
        fail(
          `${how}, but the reader never reached the end of ${total} pages in ${seconds}s — last onPageChange ` +
            `"${stuck}", scrollTop ${top} of ${height}px, ${await page.locator('.pjsr-page-slot').count()} ` +
            'slots mounted',
        );
      }
      const landed = Number(line.replace(/\D+/g, ''));
      const ink = await pollInk(page, '.pjsr-page-canvas');
      const after = await page.locator('.pjsr-page-slot').count();
      if (!ink || ink.ratio < 0.0005) fail(`page ${landed} never painted`);
      if (Math.max(mounted, after) > 40) fail(`${mounted} then ${after} page slots mounted — not virtualizing`);
      return `${total} pages, ${how}, ${mounted}→${after} slots mounted, scroll height ${height}px, page ${landed} at ${(ink.ratio * 100).toFixed(2)} % ink, reached in ${seconds}s`;
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
        return `${rows} rows: ${labels.slice(0, 6).join(' | ')}`;
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
     * The clause's sixth type is the one this row cannot assert, and it says so in its report rather than
     * quietly narrowing: **none** of the fixture's four `/Sig` widgets produces anything. The engine's
     * `SignatureWidgetAnnotationElement` marks a signature renderable only when `data.hasOwnCanvas`
     * (`node_modules/pdfjs-dist/build/pdf.mjs:19170-19173`), and the shapes this fixture carries — `/F 4` with
     * no appearance, `/F 4` with one, a `/Kids` widget, and `/F 20` (NOROTATE) — produced zero boxes on either
     * page, including the NOROTATE one the fixture's own comment expected to pass. So "a signature widget
     * renders as its box" is a gap for us to close in our own layer, not an assertion to write in the engine's
     * image; #229 carries it. What IS asserted about signatures is the thing that stays true either way: a
     * signature box is not a control, so nothing on those two pages is a focusable widget named for a `/Sig`
     * field.
     */
    name: 'form-widgets-are-html-controls',
    run: async ({ page, load }) => {
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

      // The signature half, measured and reported. Asserted only in the direction that cannot rot: no focusable
      // control may name itself for a /Sig field, because the clause's box is not a control.
      await load('signature-sample.pdf', 2);
      if (
        !(await settle(
          async () => (await painted('.pjsr-annotation-layer input[name="title"]')) >= 1,
        ))
      ) {
        fail(
          `the /Tx field on the signature fixture never painted within 12 s, so the signature count below ` +
            'would mean nothing — the layer is not painting this document at all',
        );
      }
      const sig = await page.evaluate(() => {
        const controls = [...document.querySelectorAll('.pjsr-annotation-layer input, .pjsr-annotation-layer select, .pjsr-annotation-layer textarea')];
        const names = ['sigPlain', 'sigNoRotate', 'sigKid', 'sigAlreadySigned', 'sigTwoBoxes'];
        return {
          layers: document.querySelectorAll('.pjsr-annotation-layer').length,
          sigControls: controls.filter((el) => names.includes(el.name ?? '')).length,
          boxes: [...document.querySelectorAll('.pjsr-annotation-layer [class*="Widget"]')]
            .map((el) => String(el.className))
            .filter((cls) => /sig|signature/i.test(cls)).length,
          textControls: controls.filter((el) => el.name === 'title').length,
        };
      });
      if (sig.sigControls) {
        fail(`${sig.sigControls} focusable control(s) stand where FR-16 promises a signature box — capturing a mark is the edit tier's job (§2.4), so the core must not build one`);
      }

      return `${fields.controls.length} controls in ${fields.boxes} boxes, all focusable (text/textarea/checkbox/radio×3/combo/list); signature document, ${sig.layers} layer(s) mounted: ${sig.boxes} sig boxes, ${sig.sigControls} sig controls — the box half of the clause is #229`;
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
    name: 'forced-colours',
    desktopOnly: true,
    run: async ({ page, load }) => {
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
      await page.emulateMedia({ forcedColors: 'none' });
      if (!state.matches) return skip('the engine still reports forced-colors as inactive under emulation');
      if (!state.outline.startsWith('solid')) fail(`page slot outline is "${state.outline}", not a solid line"`);
      if (state.shadow !== 'none') fail(`the page kept its drop shadow: ${state.shadow}`);
      if (!painted) {
        fail('the annotation layer never painted a highlight from annotated-sample.pdf, so its edge could not be read');
      }
      if (!painted.outline.startsWith('solid') || painted.width <= 0) {
        fail(
          `a forced palette left the highlight with "${painted.outline}" on a ${painted.width}px box — ` +
            'the tint is overridden here, so an edge is the only thing marking it',
        );
      }
      return `matchMedia active, slot ${state.outline}, shadow removed; highlight edge ${painted.outline} ${painted.colour} on ${painted.width}px`;
    },
  },
  {
    name: 'nothing-came-from-a-cdn',
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
 * them apart: this host's Windows loader refuses the engine's own DLLs before a page exists, so nothing this
 * package does has been measured — which is a gap in the evidence rather than a defect in the viewer. The
 * status code is translated because a decimal NTSTATUS is not something a reader can look up in a log.
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
  page.on('pageerror', (error) => pageErrors.push(firstLine(error)));
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
        fail(`no "${label}" control in the ${profile.viewport.width}px bar, and no overflow menu to look in`);
      }
      await menu.click();
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
    const started = Date.now();
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
    // A cell-level verdict rather than a fourteenth check: §8's own row counts are quoted in that table and
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
console.log(`playground served from ${baseUrl} (pdfjs-dist ${engineVersion})`);

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
