/*
 * FR-45's evidence split, second leg: the same axe run, inside a real engine, so the rules that need a layout
 * actually evaluate.
 *
 * `a11y/latest.json` records what axe says under jsdom, and that file's own header says why it cannot be the
 * whole story: jsdom gives every element a 0×0 box and paints nothing, so `color-contrast` reports `incomplete`
 * and `target-size` "passes" six nodes it could not have measured. FR-45 asks for evidence split four ways —
 * automated axe and DOM assertions, browser keyboard and forced-colour checks, geometry checks for touch
 * targets, and a screen-reader pass — and until now the axe leg had only ever run in the environment where two
 * of its rules are blind. The gap in `fr-evidence.json` said it plainly: "contrast is still asserted as CSS
 * declarations, not measured".
 *
 * So this drives the playground in Playwright's engines, injects the axe build that is in `node_modules`, runs
 * the rule set the jsdom harness declares (`scripts/axe-tags.mjs` — one derivation for both, so a browser
 * record cannot name a standard the harness stopped checking), and writes `a11y/browser.json`. In a real layout
 * `color-contrast` compares painted pixels and `target-size` measures boxes, which is the thing being claimed.
 *
 * Five rules this script keeps to itself:
 *
 *  - **it writes nothing when an audit finds a violation.** A record of a red run dressed as a green file is
 *    how an open defect becomes documentation; the violations are printed instead, and the fix goes in the
 *    viewer. Same discipline as `scripts/a11y-record.mjs`, which refuses to write when the a11y project fails.
 *  - **an engine that will not start is `n/a`, not a pass.** The entry it writes names the engine and the first
 *    line of the loader's complaint, and the totals list it under `notRunnable`, so a record with one engine in
 *    it is visibly a partial record. As measured on 2026-10-07 all three engines do start on this Windows host
 *    (chromium 153.0.8010.12, firefox 155.0, webkit 26.6), so the local record is six audits over three engines
 *    and `notRunnable` is empty — an earlier version of this comment claimed the Windows loader refused the
 *    other two, which is the kind of sentence a run overtakes. The `n/a` path stays because CI's matrix is the
 *    place where a host that cannot start one is a fact worth printing.
 *  - **an audit that measured no contrast fails too.** A green run in which `color-contrast` passed zero nodes
 *    is the jsdom blind spot wearing a browser costume, so the pass count is asserted, not merely recorded.
 *  - **the audit's scope is recorded, not implied.** Each entry names the document, the page count the shell
 *    itself reported, the mount state audited (sidebar closed; then sidebar open on the tab that was actually
 *    clicked, labelled from its own text) and how many nodes were in the tree, because "axe is clean" means
 *    nothing unless the tree it looked at is known.
 *  - **no network.** The default document is a remote URL, so the matrix's refusal is installed here too: the
 *    audit runs against local bytes and the local engine files.
 */
import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { hostname, platform, release } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import { chromium, firefox, webkit } from 'playwright';

import { auditTags } from './axe-tags.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(root, 'a11y', 'browser.json');
const AXE_FILE = join(root, 'node_modules', 'axe-core', 'axe.min.js');
const DOCUMENT = 'form-sample.pdf';
const VIEWPORT = { width: 1280, height: 900 };
const ENGINES = [
  ['chromium', chromium],
  ['firefox', firefox],
  ['webkit', webkit],
];

/** The rules whose whole point is a layout. Named once, and the page-side copy below has to agree by hand. */
const GEOMETRY_RULES = ['color-contrast', 'target-size'];

/**
 * Run axe in the page and come back with the shape this record needs.
 *
 * Everything the page-side function touches arrives as its one argument: a function handed to `page.evaluate`
 * runs in the browser with nothing from this module in scope, so referencing `GEOMETRY_RULES` or `tags` from
 * inside it is a `ReferenceError` in the page rather than a compile error here.
 */
function axeInPage({ values, geometry }) {
  const brief = (list) =>
    list.map((rule) => ({
      id: rule.id,
      impact: rule.impact ?? null,
      nodes: rule.nodes.length,
      firstTarget: rule.nodes[0] ? rule.nodes[0].target.join(' ') : null,
      // Up to three of the offending elements, as the page holds them. A rule id and a count say what failed;
      // the markup is what says why, and it is the difference between a finding a reader can act on and a
      // number in a file — the lesson #248 left on the print row.
      examples: rule.nodes.slice(0, 3).map((node) => ({
        target: node.target.join(' '),
        html: String(node.html ?? '').replace(/\s+/g, ' ').slice(0, 220),
        why: String(node.failureSummary ?? '').replace(/\s+/g, ' ').slice(0, 200),
      })),
    }));
  return window.axe.run({ runOnly: { type: 'tag', values } }).then((results) => {
    const passes = {};
    for (const rule of results.passes) passes[rule.id] = rule.nodes.length;
    return {
      engine: results.testEngine ?? null,
      url: results.url,
      violations: brief(results.violations),
      incomplete: brief(results.incomplete),
      passingRules: Object.keys(passes).length,
      geometry: Object.fromEntries(geometry.map((id) => [id, passes[id] ?? 0])),
      nodes: document.querySelectorAll('*').length,
      widgets: document.querySelectorAll('.pjsr-annotation-layer input, .pjsr-annotation-layer select').length,
      /*
       * What the widget-naming pass left behind, read off the DOM rather than from its return value: the
       * audit's zero violations say nothing about *how* a name arrived, and "named from its field name" and
       * "hidden because the document never said what it was" both come out clean to axe. A link's fate in
       * particular is a functional question, not a lint one.
       */
      widgetState: [...document.querySelectorAll('.pjsr-annotation-layer input, .pjsr-annotation-layer select')]
        .map((el) => `${el.getAttribute('name') ?? el.type}:${el.getAttribute('aria-label') ?? '(none)'}`)
        .sort(),
      /*
       * Each link as `where-the-name-came-from:the name`, because the bare version of this field lied once: the
       * first reading printed `["(unnamed)","Link"]` on a tree where axe reported no `link-name` violation, and
       * the cause was this reader looking at `aria-label` and the text only. The link it called unnamed carries
       * `title="Back to page one (link annotation)"` — pdf.js's own naming of a link that has a `/TU`, which
       * `nameUnnamedWidgets` correctly leaves alone. A record that cannot tell those two facts apart is a
       * finding invented by an instrument, which is the lesson #210 and #248 both left behind.
       */
      linkState: [...document.querySelectorAll('.pjsr-annotation-layer a')]
        .map((el) => {
          const one = (value) => String(value ?? '').trim();
          const named = [
            ['aria-label', one(el.getAttribute('aria-label'))],
            ['aria-labelledby', el.getAttribute('aria-labelledby') ? one(el.getAttribute('aria-labelledby')) : ''],
            ['title', one(el.getAttribute('title'))],
            ['text', one(el.textContent)],
          ].find(([, name]) => name);
          if (named) return `${named[0]}:${named[1]}`;
          return el.getAttribute('aria-hidden') === 'true' ? 'hidden-by-design' : 'none:(unnamed)';
        })
        .sort(),
    };
  });
}

function installedVersion(name) {
  try {
    return JSON.parse(readFileSync(join(root, 'node_modules', name, 'package.json'), 'utf8')).version;
  } catch {
    return `${name} is not installed`;
  }
}

function revision() {
  const r = spawnSync('git rev-parse HEAD', { cwd: root, encoding: 'utf8', shell: true });
  return r.status === 0 ? String(r.stdout).trim() : 'unknown';
}

const tags = auditTags();
if (!existsSync(AXE_FILE)) {
  console.error(`FAIL  ${AXE_FILE} is not there, so axe cannot be injected. Run npm ci first.`);
  process.exit(1);
}
const axeSource = readFileSync(AXE_FILE, 'utf8');

const server = await createServer({
  root: join(root, 'playground'),
  configFile: join(root, 'playground', 'vite.config.ts'),
});
await server.listen();
const baseUrl = server.resolvedUrls?.local[0] ?? 'http://127.0.0.1:5199/';

const entries = [];
for (const [name, browser] of ENGINES) {
  let launch;
  try {
    launch = await browser.launch({ headless: true });
  } catch (error) {
    entries.push({
      engine: name,
      engineVersion: 'n/a',
      started: false,
      note: `the engine would not start on this host: ${String(error.message).split('\n')[0].slice(0, 160)}`,
    });
    continue;
  }
  const context = await launch.newContext({ viewport: VIEWPORT, deviceScaleFactor: 1 });
  const page = await context.newPage();
  page.setDefaultTimeout(60_000);
  await page.route(/raw\.githubusercontent\.com|unpkg\.com|jsdelivr|cdn\./, (route) => route.abort());
  const uncaught = [];
  page.on('pageerror', (error) => uncaught.push(String(error.message).split('\n')[0].slice(0, 120)));
  const engineVersion = launch.version();

  try {
    await page.goto(baseUrl, { waitUntil: 'domcontentloaded' });
    await page.selectOption('.app-header select', '/pdfjs-dist/');
    await page.fill('.app-url input[type=url]', new URL(`/fixtures/${DOCUMENT}`, baseUrl).href);
    await page.press('.app-url input[type=url]', 'Enter');
    const stem = DOCUMENT.replace(/\.pdf$/, '');
    await page.waitForFunction(
      (name) => (document.querySelector('.pjsr-meta-title')?.textContent ?? '').includes(name),
      stem,
      { timeout: 60_000 },
    );
    await page.waitForSelector('.pjsr-page-canvas');
    const pageCount = Number(
      ((await page.textContent('.pjsr-page-count')) ?? '').replace(/\D+/g, '') || '0',
    );
    // The widgets are what makes this document the right subject: pdf.js's annotation layer turns each AcroForm
    // field into a real HTML control, which is the only place in the shell where a form control's own contrast
    // and box size get painted. If they never arrive, say so in the entry rather than auditing a page of canvas.
    await page
      .waitForSelector('.pjsr-annotation-layer input, .pjsr-annotation-layer select', { timeout: 30_000 })
      .catch(() => undefined);
    await page.waitForTimeout(400);
    await page.addScriptTag({ content: axeSource });

    const shell = await page.evaluate(axeInPage, { values: tags, geometry: GEOMETRY_RULES });
    entries.push(entry(name, engineVersion, shell, 'document loaded, sidebar closed', pageCount));

    await page.click('.pjsr-toolbar [aria-label="Toggle sidebar"]');
    await page.waitForSelector('.pjsr-sidebar-tabs [role="tab"]');
    const tab = page.locator('.pjsr-sidebar-tabs [role="tab"]').first();
    const tabLabel = (await tab.textContent())?.trim() ?? '(unreadable)';
    await tab.click();
    await page.waitForTimeout(900);
    const sidebar = await page.evaluate(axeInPage, { values: tags, geometry: GEOMETRY_RULES });
    entries.push(entry(name, engineVersion, sidebar, `sidebar open on the tab labelled "${tabLabel}"`, pageCount));
  } catch (error) {
    entries.push({
      engine: name,
      engineVersion,
      started: true,
      document: DOCUMENT,
      auditFailed: true,
      note: `the audit could not be run: ${String(error.message).split('\n')[0].slice(0, 200)}`,
    });
  }
  if (uncaught.length) entries[entries.length - 1].uncaughtErrors = uncaught;
  await context.close();
  await launch.close();
}
await server.close();

function entry(engine, engineVersion, result, state, pageCount) {
  return {
    engine,
    engineVersion,
    started: true,
    axeCore: installedVersion('axe-core'),
    document: DOCUMENT,
    pages: pageCount,
    viewport: `${VIEWPORT.width}×${VIEWPORT.height} dpr 1`,
    state,
    url: result.url,
    testEngine: result.engine,
    nodesInDocument: result.nodes,
    formWidgetsPainted: result.widgets,
    widgetNames: result.widgetState,
    linkNames: result.linkState,
    passingRules: result.passingRules,
    violations: result.violations,
    incomplete: result.incomplete,
    geometryPassingNodes: result.geometry,
  };
}

const started = entries.filter((e) => e.started && !e.auditFailed);
const failed = entries.filter((e) => e.auditFailed);
const neverStarted = entries.filter((e) => !e.started);
const withViolations = started.filter((e) => e.violations.length > 0);
const noContrast = started.filter((e) => (e.geometryPassingNodes['color-contrast'] ?? 0) === 0);

console.log(
  `\naxe in a real browser: ${started.length} audits over ${new Set(started.map((e) => e.engine)).size} engine(s); ` +
    `${neverStarted.length} engine(s) did not start on this host`,
);
for (const e of started) {
  console.log(
    `  ok    ${e.engine} ${e.engineVersion} · ${e.state} — ${e.nodesInDocument} nodes, ${e.formWidgetsPainted} widget(s), ` +
      `${e.passingRules} rules passed, color-contrast ${e.geometryPassingNodes['color-contrast']} nodes, ` +
      `target-size ${e.geometryPassingNodes['target-size']} nodes, ${e.violations.length} violations, ` +
      `${e.incomplete.length} incomplete${e.violations.length ? ` [${e.violations.map((v) => `${v.id}×${v.nodes}`).join(', ')}]` : ''}`,
  );
  console.log(`        link names: ${JSON.stringify(e.linkNames)} · widget names: ${JSON.stringify(e.widgetNames)}`);
}
for (const e of failed) console.log(`  FAIL  ${e.engine}: ${e.note}`);
for (const e of neverStarted) console.log(`  n/a   ${e.engine}: ${e.note}`);

let refused = 0;
if (withViolations.length) {
  refused = 1;
  // One entry is printed in full, because the engines agreed on every rule in this run and the markup is what
  // tells a reader which layer of the shell produced the node.
  const first = withViolations[0];
  console.error(
    `\nFAIL  ${withViolations.length} audit(s) found violations, so no record is written. ` +
      `${first.engine} ${first.engineVersion}, ${first.state}:\n` +
      first.violations
        .map(
          (v) =>
            `  ${v.id} (${v.impact}, ${v.nodes} node(s))\n` +
            v.examples.map((e) => `      ${e.target}\n        ${e.html}\n        ${e.why}`).join('\n'),
        )
        .join('\n') +
      '\n      Fix the viewer, or say why the finding is not the shell’s, in fr-evidence.json’s FR-45 gaps.',
  );
}
if (noContrast.length) {
  refused = 1;
  console.error(
    `\nFAIL  ${noContrast.length} audit(s) passed but measured no contrast (color-contrast found 0 passing nodes), ` +
      'which is the jsdom blind spot this script exists to leave.',
  );
}
if (!started.length) {
  refused = 1;
  console.error('FAIL  no engine started, so there is nothing to record.');
}
if (refused) process.exit(1);

const record = {
  schema: 1,
  producedBy: 'npm run a11y:browser-record (scripts/a11y-browser-record.mjs)',
  environment: {
    machine: hostname(),
    platform: platform(),
    osRelease: release(),
    node: `v${process.versions.node}`,
    axeCore: installedVersion('axe-core'),
    playwright: installedVersion('playwright'),
    ranAt: new Date().toISOString(),
    revision: revision(),
  },
  standard: {
    source: 'PRD.md §Access / FR-45',
    tags,
    harness: 'src/components/axe-audit-harness.ts (the tag list, read by scripts/axe-tags.mjs)',
    note:
      'axe inside a real engine: `color-contrast` compares painted pixels and `target-size` measures boxes, which is ' +
      'what the jsdom run cannot do. This is the automated leg of FR-45’s four-way evidence split; the keyboard and ' +
      'forced-colour rows are in the browser matrix, the touch-target geometry is now measured twice (here and by ' +
      '`toolbar-fold`), and the NVDA/JAWS/VoiceOver pairings are still an operator and a schedule away.',
  },
  totals: {
    audits: started.length,
    engines: [...new Set(started.map((e) => e.engine))].sort(),
    notRunnable: neverStarted.map((e) => e.engine),
    violationsRecorded: started.reduce((n, e) => n + e.violations.length, 0),
    contrastNodesMeasured: started.reduce((n, e) => n + (e.geometryPassingNodes['color-contrast'] ?? 0), 0),
    targetSizeNodesMeasured: started.reduce((n, e) => n + (e.geometryPassingNodes['target-size'] ?? 0), 0),
    rulesIncomplete: [...new Set(started.flatMap((e) => e.incomplete.map((i) => i.id)))].sort(),
  },
  audits: entries,
};

mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, `${JSON.stringify(record, null, 2)}\n`);
console.log(
  `\nwrote a11y/browser.json — ${record.totals.audits} audits, ${record.totals.contrastNodesMeasured} contrast nodes and ` +
    `${record.totals.targetSizeNodesMeasured} target-size nodes measured in a real layout, ` +
    `${record.totals.rulesIncomplete.length} rules still incomplete` +
    (record.totals.notRunnable.length ? `, engines not runnable here: ${record.totals.notRunnable.join(', ')}` : ''),
);
