/*
 * §8 asks whether this package has ever been looked at in *Safari* — the browser — as opposed to WebKit under a
 * Playwright driver. The register's answer has been "no environment", and #267 measured that a "cannot" nobody
 * has tested is usually a "has not". So this is a probe: it starts `safaridriver`, drives one real Safari session
 * over the W3C protocol with nothing but Node's fetch, and reports what it found. It is deliberately not a test
 * suite — a probe that also runs the whole matrix is a probe nobody builds.
 *
 * Three questions, in the order that costs the least to answer:
 *
 *  1. can a scripted Safari session be started on this machine at all, and by what (no new dependency — the
 *     finding is partly about the dependency),
 *  2. what does real Safari say about the APIs §8's floors are argued from, and is its version the version
 *     WebKit-under-Playwright reports, because those two have been quoted as one thing in this repository's
 *     tables,
 *  3. can the harness reach a document — the one interaction a matrix would need — by setting a React-controlled
 *     input's value the way a user's keystroke does it, and if not, what exactly refused.
 *
 * It exits 0 when the probe ran and wrote its reading, including when Safari refused. It exits 2 only when the
 * probe itself could not be taken, because a missing instrument is not a product result — the distinction this
 * repository's browser rows have had to learn the hard way.
 */
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const DRIVER_PORT = Number(process.env.SAFARI_DRIVER_PORT || 5412);
const APP_PORT = Number(process.env.SAFARI_PROBE_PORT || 5399);
const OUT = join(root, '.spike', 'safari-probe.txt');
/** The fixture the probe asks Safari to load, if the interaction leg gets that far. */
const FIXTURE = 'form-sample.pdf';

const lines = [];
const say = (text) => {
  lines.push(text);
  console.log(text);
};

const base = `http://127.0.0.1:${DRIVER_PORT}`;

async function w3c(method, path, body, sessionId) {
  const url = sessionId ? `${base}/session/${sessionId}${path}` : `${base}${path}`;
  const res = await fetch(url, {
    method,
    headers: { 'Content-Type': 'application/json; charset=utf-8', Accept: 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error(`${method} ${path} -> HTTP ${res.status}, not JSON: ${text.slice(0, 160)}`);
  }
  if (!res.ok) {
    const value = json?.value ?? {};
    throw new Error(`${method} ${path} -> ${value.error ?? res.status}: ${String(value.message ?? '').slice(0, 200)}`);
  }
  return json.value;
}

/** Run `safaridriver` in the background and wait until it answers a status request. */
async function startDriver() {
  const child = spawn('safaridriver', ['--port', String(DRIVER_PORT)], { stdio: ['ignore', 'pipe', 'pipe'] });
  child.stdout.on('data', () => undefined);
  child.stderr.on('data', () => undefined);
  for (let attempt = 0; attempt < 40; attempt += 1) {
    try {
      await w3c('GET', '/status');
      return child;
    } catch {
      await new Promise((r) => setTimeout(r, 250));
    }
  }
  throw new Error('safaridriver did not answer /status within 10 s');
}

const server = await createServer({
  root: join(root, 'playground'),
  configFile: join(root, 'playground', 'vite.config.ts'),
  server: { port: APP_PORT, host: '127.0.0.1' },
  logLevel: 'warn',
});
await server.listen();

let driver;
let sessionId = null;
let status = 'probe-incomplete';
try {
  driver = await startDriver();
  say(`1. driver            safaridriver answered on port ${DRIVER_PORT}`);

  const caps = await w3c('POST', '/session', {
    capabilities: { alwaysMatch: { browserName: 'safari' }},
  });
  sessionId = caps.sessionId;
  say(`   session          created; capabilities ${JSON.stringify(caps.capabilities ?? {}).slice(0, 200)}`);
  await w3c('POST', '/timeouts', { script: 8000, pageLoad: 20000 }, sessionId);
  status = 'probe-ran';

  const appUrl = server.resolvedUrls?.local[0] ?? `http://127.0.0.1:${APP_PORT}/`;
  await w3c('POST', '/url', { url: appUrl }, sessionId);
  say(`   navigated        ${appUrl}`);

  // The measurement §8 actually wants: real Safari, its own engine, its own version string.
  const facts = await w3c(
    'POST',
    '/execute/sync',
    {
      script: `
        return {
          ua: navigator.userAgent,
          vendor: navigator.vendor,
          iterator: typeof Iterator,
          urlParse: typeof URL.parse,
          promiseTry: typeof Promise.try,
          abortSignalAny: typeof AbortSignal.any,
          has: typeof document.documentElement?.has,
          lightDark: !!(window.CSS && CSS.supports && CSS.supports('color', 'light-dark(red, blue)')),
          canvas: !!document.createElement('canvas').getContext('2d'),
          touchMax: navigator.maxTouchPoints,
        };
      `,
      args: [],
    },
    sessionId,
  );
  say(`2. Safari identity   ${facts.ua}`);
  say(
    `   APIs §8 argues from  Iterator=${facts.iterator} URL.parse=${facts.urlParse} Promise.try=${facts.promiseTry} ` +
      `AbortSignal.any=${facts.abortSignalAny} has()=${facts.has} canvas=${facts.canvas} maxTouchPoints=${facts.touchMax}`,
  );

  const shell = await w3c(
    'POST',
    '/execute/sync',
    {
      script: `return {header: !!document.querySelector('.app-header'), viewer: !!document.querySelector('.pjsr-viewer'), controls: document.querySelectorAll('.pjsr-toolbar [aria-label]').length, engines: [...document.querySelectorAll('.app-header option')].map((o) => o.value).slice(0, 4)};`,
      args: [],
    },
    sessionId,
  );
  say(`   shell mounted    header=${shell.header} viewer=${shell.viewer} ${shell.controls} labelled control(s), engine options ${shell.engines.join(', ') || '(none)'}`);

  // The one interaction a matrix would need: a React-controlled input set the way a keystroke sets it.
  const interaction = await w3c(
    'POST',
    '/execute/sync',
    {
      script: `
        const input = document.querySelector('.app-url input[type=url]');
        if (!input) return { step: 'no input', ok: false };
        const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
        setter.call(input, new URL('/fixtures/${FIXTURE}', location.href).href);
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.form?.requestSubmit?.();
        return { step: 'submitted', ok: true, value: input.value };
      `,
      args: [],
    },
    sessionId,
  );
  say(`3. interaction       ${interaction.step} (${interaction.ok ? `typed ${interaction.value}` : 'the harness would stop here'})`);

  let loaded = { pages: '(not reached)' };
  if (interaction.ok) {
    await new Promise((r) => setTimeout(r, 6000));
    loaded = await w3c(
      'POST',
      '/execute/sync',
      {
        script: `return { pages: document.querySelectorAll('.pjsr-page').length, canvas: !!document.querySelector('.pjsr-page-canvas'), count: (document.querySelector('.pjsr-page-count')?.textContent ?? '').trim(), status: [...document.querySelectorAll('.pjsr-status, .pjsr-error, .pjsr-empty')].map((n) => n.textContent.trim()).join(' / ').slice(0, 160) };`,
        args: [],
      },
      sessionId,
    );
    say(
      `   document         ${loaded.pages} page(s) mounted, canvas=${loaded.canvas}, count "${loaded.count}"` +
        `${loaded.status ? `, status "${loaded.status}"` : ''}`,
    );
  }

  say(
    `4. what this proves  Safari version and engine APIs, read from Safari itself rather than from Playwright's ` +
      'bundled WebKit. What it does not prove: anything about VoiceOver, about a phone or tablet, about WCAG, or ' +
      'about the matrix rows — those need the harness, and the harness needs this probe to have said the word ' +
      '"yes" about the interaction leg.',
  );
} catch (error) {
  const line = String(error.message ?? error).split('\n')[0];
  if (status === 'probe-ran') {
    say(`   refused          ${line}`);
  } else {
    say(`COULD NOT PROBE    ${line}`);
    say(
      '   That is a missing instrument, not a product result: the reading below is the refusal, and the job ' +
        'still writes it so the next person does not have to guess whether Safari was ever asked.',
    );
  }
} finally {
  if (sessionId) await w3c('DELETE', '', undefined, sessionId).catch(() => undefined);
  driver?.kill('SIGTERM');
  await server.close().catch(() => undefined);
  mkdirSync(dirname(OUT), { recursive: true });
  writeFileSync(OUT, `${lines.join('\n')}\n`);
  console.log(`wrote ${'.spike/safari-probe.txt'}`);
  if (status !== 'probe-ran') process.exit(2);
}
