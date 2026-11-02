/**
 * Device verification record guard tests (FR-43, FR-48, FR-58, PRD §8, §9).
 *
 * Verifies that `scripts/check-device-records.mjs` enforces the falsifiability,
 * provenance, and validity of mobile device records in `device/`.
 */
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, afterAll } from 'vitest';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const SCRIPT = join(root, 'scripts', 'check-device-records.mjs');
const work = mkdtempSync(join(tmpdir(), 'pjsr-dev-'));

afterAll(() => rmSync(work, { recursive: true, force: true }));

const run = (...args: string[]) => {
  const r = spawnSync(process.execPath, [SCRIPT, ...args], { encoding: 'utf8' });
  return { code: r.status, out: `${r.stdout ?? ''}${r.stderr ?? ''}` };
};

describe('Device Verification Record Guard (FR-43, FR-48, FR-58, PRD §8, §9)', () => {
  const samplePath = join(root, 'device', 'android-chrome-128.json');
  const validBase = JSON.parse(readFileSync(samplePath, 'utf8'));

  const testRefusal = (modifier: (rec: any) => any, pattern: RegExp, label: string) => {
    const file = join(work, `refuse-${label}.json`);
    const modified = modifier(JSON.parse(JSON.stringify(validBase)));
    writeFileSync(file, `${JSON.stringify(modified, null, 2)}\n`, 'utf8');
    const out = run(`--file=${file}`);
    expect(out.code, `Expected exit 1 for ${label}, got ${out.code}: ${out.out}`).toBe(1);
    expect(out.out).toMatch(pattern);
  };

  it('committed device records pass all validation gates', () => {
    const out = run();
    expect(out.code).toBe(0);
    expect(out.out).toMatch(/All device records verified/);
    expect(out.out).toMatch(/ios-safari-18\.json verified/);
    expect(out.out).toMatch(/android-chrome-128\.json verified/);
  });

  it('validates a conformant device record with --file', () => {
    const file = join(work, 'valid.json');
    writeFileSync(file, `${JSON.stringify(validBase, null, 2)}\n`, 'utf8');
    const out = run(`--file=${file}`);
    expect(out.code).toBe(0);
    expect(out.out).toMatch(/is valid/);
  });

  it('refuses invalid schema', () => {
    testRefusal(
      (r) => {
        r.schema = 'pjsr/invalid-schema@1';
        return r;
      },
      /Invalid schema/,
      'schema'
    );
  });

  it('refuses fallback of browserVersion to osVersion (Audit Finding 2)', () => {
    testRefusal(
      (r) => {
        r.osVersion = '15.0';
        r.browser = 'Chrome on Android';
        r.browserVersion = '15.0';
        return r;
      },
      /refusing OS fallback as browser version/,
      'browser-fallback'
    );
  });

  it('refuses browser versions below verified engine floors', () => {
    testRefusal(
      (r) => {
        r.browser = 'Chrome on Android';
        r.browserVersion = '115.0.0.0';
        return r;
      },
      /below the supported floor/,
      'engine-floor'
    );
  });

  it('refuses status "pass" when any verdict is "fail" (Audit Finding 3)', () => {
    testRefusal(
      (r) => {
        r.status = 'pass';
        r.verdicts.touchArbitration = 'fail';
        return r;
      },
      /one or more required verdicts did not pass/,
      'unfailable-verdict'
    );
  });

  it('refuses generic operators like "qa" or "team"', () => {
    testRefusal(
      (r) => {
        r.operator = 'qa';
        return r;
      },
      /generic operator/,
      'generic-operator'
    );
  });

  it('refuses records with missing observations (Audit Finding 4)', () => {
    testRefusal(
      (r) => {
        r.observations.touchArbitration = '';
        return r;
      },
      /Missing or inadequate observation for task "touchArbitration"/,
      'missing-observation'
    );
  });

  it('refuses records with missing touch points', () => {
    testRefusal(
      (r) => {
        r.environment.maxTouchPoints = 0;
        return r;
      },
      /maxTouchPoints/,
      'zero-touch'
    );
  });
});
