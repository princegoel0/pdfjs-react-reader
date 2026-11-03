/*
 * Mobile real-device verification record validator (FR-43, FR-48, FR-58, PRD §8, PRD §9).
 *
 * Validates real hardware test records in `device/` according to the criteria defined in PRD §8 and §9:
 *
 * 1. Schema: must be "pjsr/device-verification@1".
 * 2. Real Browser Version: Refuses any record where browserVersion falls back to osVersion
 *    (e.g. reporting Android OS "15.0" as Chrome "15.0"). Chrome must report the Chrome engine version (>= 128),
 *    and Safari must report the Safari engine version (>= 18).
 * 3. Honesty & Falsifiability: Refuses status: 'pass' if ANY verdict is not 'pass'.
 *    All 8 mandatory tasks must be evaluated: shellMount, viewportScroll, textLayerMounted,
 *    formLayerMounted, annotationLayerMounted, structureLayerMounted, touchArbitration, virtualizedInk.
 * 4. Per-verdict observations: Every verdict must be accompanied by an empirical observation record.
 * 5. Environment metrics: Verified hardware maxTouchPoints (> 0), devicePixelRatio (> 0), screen dimensions.
 * 6. Provenance & Traceability: Valid sessionId, sessionUrl, commit hash, artifactDigest, operator, timestamp.
 *
 * Usage:
 *   node scripts/check-device-records.mjs --check
 *   node scripts/check-device-records.mjs --file=device/ios-safari-18.json
 */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, isAbsolute, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const REQUIRED_VERDICTS = [
  'shellMount',
  'viewportScroll',
  'textLayerMounted',
  'formLayerMounted',
  'annotationLayerMounted',
  'structureLayerMounted',
  'touchArbitration',
  'virtualizedInk',
];

export function validateRecord(record) {
  const errors = [];
  if (!record || typeof record !== 'object') {
    return ['Record is not a valid JSON object'];
  }

  // 1. Schema check
  if (record.schema !== 'pjsr/device-verification@1') {
    errors.push(`Invalid schema: expected "pjsr/device-verification@1", got "${record.schema}"`);
  }

  // 2. Metadata checks
  if (!record.device || typeof record.device !== 'string') errors.push('Missing or invalid device');
  if (!record.os || typeof record.os !== 'string') errors.push('Missing or invalid os');
  if (!record.osVersion || typeof record.osVersion !== 'string') errors.push('Missing or invalid osVersion');
  if (!record.browser || typeof record.browser !== 'string') errors.push('Missing or invalid browser');

  // Refuse fallback of browserVersion to osVersion (Audit Finding 2)
  if (!record.browserVersion || typeof record.browserVersion !== 'string') {
    errors.push('Missing or invalid browserVersion');
  } else if (record.browserVersion === record.osVersion && !record.browser.toLowerCase().includes('safari')) {
    errors.push(
      `Invalid browserVersion "${record.browserVersion}": identical to osVersion "${record.osVersion}" (refusing OS fallback as browser version)`
    );
  }

  if (record.browser?.toLowerCase().includes('chrome')) {
    const major = parseInt(record.browserVersion, 10);
    if (isNaN(major) || major < 128) {
      errors.push(`Chrome browserVersion "${record.browserVersion}" is below the supported floor of 128`);
    }
  } else if (record.browser?.toLowerCase().includes('safari')) {
    const major = parseFloat(record.browserVersion);
    if (isNaN(major) || major < 18.0) {
      errors.push(`Safari browserVersion "${record.browserVersion}" is below the supported floor of 18.0`);
    }
  }

  if (!record.sessionId || typeof record.sessionId !== 'string') errors.push('Missing sessionId');
  if (!record.sessionUrl || !/^https?:\/\//i.test(record.sessionUrl)) errors.push('Missing or invalid sessionUrl');
  if (!record.commit || !/^[0-9a-f]{7,40}$/i.test(record.commit)) errors.push('Missing or invalid git commit hash');
  if (!record.artifactDigest || !record.artifactDigest.startsWith('sha256-')) errors.push('Missing or invalid artifactDigest');
  if (!record.operator || /(^qa$|^team$|unknown|tbd)/i.test(record.operator)) errors.push(`Invalid or generic operator: "${record.operator}"`);
  if (!record.timestamp || isNaN(Date.parse(record.timestamp))) errors.push('Missing or invalid timestamp');

  // 3. Environment metrics
  const env = record.environment;
  if (!env || typeof env !== 'object') {
    errors.push('Missing environment object');
  } else {
    if (!env.ua || typeof env.ua !== 'string') errors.push('Missing environment.ua');
    if (typeof env.maxTouchPoints !== 'number' || env.maxTouchPoints <= 0) {
      errors.push(`Invalid environment.maxTouchPoints: expected > 0 for real touch device, got ${env.maxTouchPoints}`);
    }
    if (typeof env.dpr !== 'number' || env.dpr <= 0) errors.push('Invalid environment.dpr');
    if (!Array.isArray(env.screen) || env.screen.length !== 2 || env.screen[0] <= 0 || env.screen[1] <= 0) {
      errors.push('Invalid environment.screen');
    }
  }

  // 4. Verdicts check (Audit Finding 3)
  const verdicts = record.verdicts;
  if (!verdicts || typeof verdicts !== 'object') {
    errors.push('Missing verdicts object');
  } else {
    for (const key of REQUIRED_VERDICTS) {
      const v = verdicts[key];
      if (v !== 'pass' && v !== 'fail') {
        errors.push(`Missing or invalid verdict for "${key}": expected "pass" or "fail", got "${v}"`);
      }
    }

    const allPass = REQUIRED_VERDICTS.every((key) => verdicts[key] === 'pass');
    if (record.status === 'pass' && !allPass) {
      errors.push('status is "pass" but one or more required verdicts did not pass');
    }
    if (record.status !== 'pass' && record.status !== 'fail') {
      errors.push(`Invalid status "${record.status}": must be "pass" or "fail"`);
    }
  }

  // 5. Per-verdict observations (Audit Finding 4)
  const observations = record.observations;
  if (!observations || typeof observations !== 'object') {
    errors.push('Missing per-verdict observations object');
  } else {
    for (const key of REQUIRED_VERDICTS) {
      if (!observations[key] || typeof observations[key] !== 'string' || observations[key].trim().length < 10) {
        errors.push(`Missing or inadequate observation for task "${key}"`);
      }
    }
  }

  return errors;
}

function parseFlags(argv) {
  const flags = {};
  for (const a of argv) {
    const m = /^--([^=]+)(?:=(.*))?$/.exec(a);
    if (m) flags[m[1]] = m[2] === undefined ? true : m[2];
  }
  return flags;
}

export function checkAllDeviceRecords() {
  const targets = [
    join(root, 'device', 'ios-safari-18.json'),
    join(root, 'device', 'android-chrome-128.json'),
  ];

  let totalErrors = 0;
  for (const file of targets) {
    if (!existsSync(file)) {
      console.error(`ERROR: Device verification record missing: ${file}`);
      totalErrors++;
      continue;
    }

    let parsed;
    try {
      parsed = JSON.parse(readFileSync(file, 'utf8'));
    } catch (e) {
      console.error(`ERROR: Failed to parse ${file}: ${e.message}`);
      totalErrors++;
      continue;
    }

    const errors = validateRecord(parsed);
    if (errors.length > 0) {
      console.error(`FAIL: ${file} failed validation:`);
      for (const err of errors) console.error(`  - ${err}`);
      totalErrors += errors.length;
    } else {
      console.log(`PASS: ${file} verified (${parsed.device}, ${parsed.browser} ${parsed.browserVersion}, status: ${parsed.status})`);
    }
  }

  return totalErrors;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const flags = parseFlags(process.argv.slice(2));
  if (flags.file) {
    const file = isAbsolute(flags.file) ? flags.file : join(root, flags.file);
    if (!existsSync(file)) {
      console.error(`File not found: ${file}`);
      process.exit(2);
    }
    const record = JSON.parse(readFileSync(file, 'utf8'));
    const errors = validateRecord(record);
    if (errors.length > 0) {
      console.error(`Validation errors in ${file}:`);
      for (const err of errors) console.error(`  - ${err}`);
      process.exit(1);
    }
    console.log(`Device record ${file} is valid.`);
    process.exit(0);
  }

  const errors = checkAllDeviceRecords();
  if (errors > 0) {
    console.error(`\nDevice record check failed with ${errors} error(s).`);
    process.exit(1);
  }
  console.log('\nAll device records verified.');
  process.exit(0);
}

