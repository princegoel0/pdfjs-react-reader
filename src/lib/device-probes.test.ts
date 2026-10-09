/**
 * FR-48 and §9: the two environment probes, and the rule that a probe is not a gate.
 *
 * §8's browser rows and §9's device row have both been argued from what this project *cannot* reach — real
 * Safari rather than WebKit under a driver, an Android device rather than emulation — and #267 and #276 each
 * turned one of those sentences into a measurement that said the opposite. The answer is not to write the matrix
 * against an environment nobody has confirmed exists; it is to ask the cheap question first. `scripts/safari-probe.mjs`
 * and `scripts/android-probe.mjs` are that question, one job each, scheduled and dispatchable.
 *
 * What these cases protect is the boundary between a probe and a gate:
 *
 *  - neither is wired into `verify`, `ci.yml` or `release-candidate.yml`. A probe that can fail a build becomes a
 *    flake, and a flake becomes a rule someone weakens;
 *  - each writes its reading before anything else happens, with `if-no-files-found: error`, so a job that
 *    silently skipped the leg cannot be read as a green;
 *  - an instrument that could not be taken exits 2 and says "COULD NOT PROBE", which is a different sentence
 *    from the refusal of a product leg — the distinction this repository's browser rows had to learn;
 *  - each reads the *identity* of the browser it reached, because §8's floors are argued about versions;
 *  - and the Android probe is actually executed here, on a host with no SDK, to show the refusal fires for
 *    real rather than only in the source text.
 */
import { existsSync, readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const read = (p: string) => readFileSync(join(root, p), 'utf8');

const safariScript = read('scripts/safari-probe.mjs');
const androidScript = read('scripts/android-probe.mjs');
const safariJob = read('.github/workflows/macos-safari-probe.yml');
const androidJob = read('.github/workflows/android-emulator-probe.yml');
const verify = JSON.parse(read('package.json')).scripts.verify as string;
const ci = read('.github/workflows/ci.yml');
const candidate = read('.github/workflows/release-candidate.yml');

/**
 * A step block, the way #279's lesson requires: keys inside a step are unordered, so a check that scans lines
 * finds an `if:` that belongs to the step before and certifies nothing.
 */
const stepBlocks = (workflow: string) => workflow.split(/\n {6}- /).slice(1);

describe('FR-48: a probe is not a gate', () => {
  it('keeps both probes out of verify, ci.yml and the release-candidate chain', () => {
    for (const text of [verify, ci, candidate]) {
      expect(text).not.toMatch(/safari-probe/);
      expect(text).not.toMatch(/android-probe/);
    }
  });

  it('runs them only on a schedule or a dispatch, so nothing can fail a build', () => {
    for (const workflow of [safariJob, androidJob]) {
      expect(workflow).toMatch(/^"on":$/m);
      expect(workflow).toMatch(/workflow_dispatch:/);
      expect(workflow).toMatch(/schedule:/);
      expect(workflow).not.toMatch(/^\s{2}push:/m);
      expect(workflow).toMatch('permissions:\n  contents: read');
    }
  });

  it('uploads the reading even when the leg failed, and refuses to pass without it', () => {
    for (const workflow of [safariJob, androidJob]) {
      const upload = stepBlocks(workflow).find((b) => b.includes('Upload the reading'));
      expect(upload, 'the probe must have a step that uploads its reading').toBeDefined();
      expect(upload).toMatch(/if: always\(\)/);
      expect(upload).toMatch('if-no-files-found: error');
      expect(upload).toMatch(/probe/);
    }
  });

  it('names the exact command each job runs, so a renamed script cannot stop running unnoticed', () => {
    expect(safariJob).toMatch('node scripts/safari-probe.mjs');
    expect(androidJob).toMatch('node scripts/android-probe.mjs');
  });
});

describe('FR-48: each probe reads an identity and says what it does not prove', () => {
  it('asks real Safari for its own version string', () => {
    expect(safariScript).toMatch('navigator.userAgent');
    // The APIs §8's floors are argued from, measured inside Safari rather than inferred from Playwright's WebKit.
    for (const api of ['typeof Iterator', 'typeof URL.parse', 'typeof Promise.try', 'typeof AbortSignal.any']) {
      expect(safariScript).toContain(api);
    }
    expect(safariScript).toMatch(/What it does not prove/);
  });

  it('asks the emulator which browser and which Android it actually booted', () => {
    expect(androidScript).toMatch('com.android.chrome');
    expect(androidScript).toMatch('ro.build.version.release');
    expect(androidScript).toMatch('ro.product.cpu.abi');
    expect(androidScript).toMatch('sys.boot_completed');
    // The DevTools endpoint gives url and title with no new dependency and no WebSocket client.
    expect(androidScript).toMatch('/json/list');
  });

  it('separates an instrument that could not be taken from a leg that refused', () => {
    for (const script of [safariScript, androidScript]) {
      expect(script).toMatch('COULD NOT PROBE');
      expect(script).toMatch('process.exit(2)');
    }
    expect(safariScript).toMatch('That is a missing instrument, not a product result');
  });
});

describe('FR-48: the refusal is executed, not only written down', () => {
  it('exits 2 and says so when this host has no Android SDK', () => {
    // Run with the SDK variables cleared so the case measures the script, not the machine it happens to sit on.
    const env = { ...process.env };
    delete env.ANDROID_HOME;
    delete env.ANDROID_SDK_ROOT;
    const out = spawnSync(process.execPath, [join(root, 'scripts', 'android-probe.mjs')], {
      encoding: 'utf8',
      env,
      timeout: 120_000,
    });
    expect(out.status, out.stdout + out.stderr).toBe(2);
    expect(`${out.stdout}${out.stderr}`).toMatch('COULD NOT PROBE');
    expect(existsSync(join(root, '.spike', 'android-probe.txt'))).toBe(true);
    expect(readFileSync(join(root, '.spike', 'android-probe.txt'), 'utf8')).toMatch('no Android SDK');
  });
});
