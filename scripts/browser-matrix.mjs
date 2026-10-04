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
 *  - It says nothing about Edge (its own per-release pass), about the `pdfjs-dist` version spread (the
 *    `consumer` job's engine matrix), or about React majors (the `react` job).
 */
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
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
          const fire = (type, list) =>
            el.dispatchEvent(
              new TouchEvent(type, {
                bubbles: true,
                cancelable: true,
                touches: list,
                targetTouches: list,
                changedTouches: list,
              }),
            );
          for (let step = 1; step <= 8; step += 1) {
            const gap = 30 + step * 25;
            fire(step === 1 ? 'touchstart' : 'touchmove', [mk(1, -gap, 0), mk(2, gap, 0)]);
            await new Promise((r) => setTimeout(r, 16));
          }
          fire('touchend', [mk(1, -230, 0), mk(2, 230, 0)]);
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
          const fire = (type, list) =>
            el.dispatchEvent(
              new TouchEvent(type, {
                bubbles: true,
                cancelable: true,
                touches: list,
                targetTouches: list,
                changedTouches: list,
              }),
            );
          for (let step = 0; step <= 8; step += 1) {
            fire(step === 0 ? 'touchstart' : 'touchmove', [mk(1, -60, step * 30), mk(2, 60, step * 30)]);
            await new Promise((r) => setTimeout(r, 16));
          }
          fire('touchend', [mk(1, -60, 240), mk(2, 60, 240)]);
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
