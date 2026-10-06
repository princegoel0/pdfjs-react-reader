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
 * A name-filtered subset of the checks, for developing one row without re-running eighteen of them.
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
          'the one /Sig widget the engine renders on its own canvas produced no element, so the comparison that ' +
            `anchors the drawn boxes is gone (layer classes seen: ${sig.engineClass}) — re-read the fixture and ` +
            'this row together rather than trusting the box count alone',
        );
      }
      const near = (a, b) => a.every((v, i) => Math.abs(v - b[i]) < 0.002);
      const want = ['sigAlreadySigned', 'sigKid', 'sigPlain', 'sigTwoBoxes', 'sigTwoBoxes'];
      const got = sig.boxes.map((b) => b.name).sort();
      if (got.join(',') !== want.join(',')) {
        fail(
          `the signature fixture holds six /Sig widgets, one of which the engine paints itself, so five boxes are ` +
            `expected and ${sig.boxes.length} were drawn (fields: ${got.join(', ') || 'none'}) — the clause is ` +
            '"a signature widget renders as its box", and a widget with no element in the layer has nothing a ' +
            'reader can see or aim at',
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

      const dom = await page.evaluate(() => {
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
              ? { id, inTree: !!el.closest('.structTree'), role: el.getAttribute('role') ?? el.tagName.toLowerCase() }
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
      if (dom.link.ownsCount === 0) {
        fail(
          `the link annotation owns nothing in the structure tree (aria-owns ${JSON.stringify(dom.link.owns)}): ` +
            'an unlabelled control is what a reader gets when the widget and its words are not connected',
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
        `fetch of ${viewerRequests[0] ?? '?'}, the heading called by its text, link owns ` +
        `${dom.link.ownsCount} in-tree element(s) (${dom.link.owns.map((o) => `${o.id.slice(-8)}→${o.role}`).join(', ')}) ` +
        `and is announced as a named link inside its paragraph; figure named "${(figure ?? '').slice(0, 34)}" from /Alt`
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
      const scopeSamples = async (count = 6) => {
        const runs = [];
        for (let i = 0; i < count; i += 1) {
          runs.push(
            await page.evaluate(() => {
              const bar = document.querySelector('.pjsr-toolbar');
              const shape = (el) => {
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
                };
              };
              const more = document.querySelector('.pjsr-toolbar [aria-label="More controls"]');
              const moreBox = more?.getBoundingClientRect();
              return {
                matches: Array.from(
                  document.querySelectorAll(
                    '.pjsr-toolbar [aria-label="Print pages"], .pjsr-overflow-menu [aria-label="Print pages"]',
                  ),
                ).map(shape),
                more: more
                  ? `present ${Math.round(moreBox.width)}x${Math.round(moreBox.height)}`
                  : 'no button in the bar',
                panel: Boolean(document.querySelector('.pjsr-overflow-menu')),
                rows: Array.from(document.querySelectorAll('.pjsr-overflow-label')).map((node) => node.textContent),
                bar: bar ? `${bar.clientWidth}/${bar.scrollWidth}` : 'none',
              };
            }),
          );
          if (i < count - 1) await page.waitForTimeout(500);
        }
        return runs;
      };

      /** The samples as one line, plus whether a reader could have used the control in each of them. */
      const describeSamples = (runs) => {
        const reachable = (m) => m.painted && !m.covered && !m.disabled && !m.clippedBy;
        const usable = runs.map(
          (run) =>
            run.matches.find(
              (m) => reachable(m) && (m.where === 'bar' || (m.where === 'menu' && run.panel)),
            ) ?? null,
        );
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
        let pages = await reveal('Print pages');
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
           * retrying the same probe: this host cannot start webkit (three attempts, all `Target page, context or
           * browser has been closed`), so the runner carries the instrument.
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
          // The copy acted on is resolved after the panel came back, not the locator that timed out before it.
          pages = page.locator('.pjsr-toolbar [aria-label="Print pages"]:visible').first();
          await pages.evaluate((el, value) => {
            el.value = value;
            el.dispatchEvent(new Event('input', { bubbles: true }));
            el.dispatchEvent(new Event('change', { bubbles: true }));
          }, scope);
          scopeNotes.push(
            `"${scope}" set through the change event because ${engine} refused the selection ` +
              `(${firstLine(error)}) on a control six samples agreed a reader could use (${seen.text})`,
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
        const seenValues = [];
        const settled = await waitFor(async () => {
          const now = await pages.inputValue();
          if (now === scope) return true;
          if (seenValues[seenValues.length - 1] !== now) seenValues.push(now);
          return null;
        }, 3_000);
        if (!settled) {
          fail(
            `the scope select never read "${scope}" — it read ${seenValues.length ? `"${seenValues.join('", "')}"` : '(nothing)'} ` +
              `over 3 s after ${how}`,
          );
        }
        if (seenValues.length) {
          scopeNotes.push(
            `"${scope}" settled on the select after ${seenValues.length} other reading(s): "${seenValues.join('", "')}" — ${how}`,
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
      const openedWith = await (await reveal('Print pages')).inputValue();

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
