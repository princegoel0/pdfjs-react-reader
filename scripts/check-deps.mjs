/*
 * §6.2 — "Automated scanning of transitive dependencies, with a documented triage path — including for
 * findings that originate inside a peer's own bundle and cannot be fixed by changing our range."
 *
 * Until this file existed the obligation had *nothing*: no `npm audit` step, no `dependabot.yml`, no triage
 * document, and therefore no place a finding could be recorded as decided. It is the only PRD-mandated
 * obligation in the whole specification with no code behind it, and it carries no FR row, so
 * `npm run check:fr-evidence` never sees it and cannot remind anyone. That is why the rule lives here, in a
 * gate that runs in `verify` and in CI, rather than in prose.
 *
 * Two surfaces are scanned, because they answer different questions:
 *
 *  - **production** — `npm audit --omit=dev`, the tree a consumer resolves. This package declares **no**
 *    runtime dependencies (peers are installed by the consumer's choice), so a finding here is either a
 *    peer's own bundle or a future mistake in `dependencies`.
 *  - **development** — the whole tree, which is what a runner and a laptop actually execute.
 *
 * A finding is matched against `security/dependency-triage.json` by advisory id, and the match is not
 * name-only. `severity`, `affectedRange`, the set of `packages` it reaches and the `surface` it was seen on
 * all have to agree with what the registry reports today, so an advisory that escalates from moderate to
 * high, or widens to cover a package that was not implicated when the decision was written, reopens the
 * decision instead of riding along under an old signature. That is the difference between a scan and a
 * filing cabinet.
 *
 * The scan itself failing to run is a red gate, not a skipped one. "No network, so no opinion" is how an
 * automated-scanning obligation quietly stops being automated; the message says which audit broke.
 *
 * `--selftest` runs the matching rules against synthetic trees in memory — it never writes — so each rule
 * is shown to fire. A prohibition whose live state is "matches nothing" is otherwise unfalsifiable, and
 * this repository has been burned by exactly that shape (#240).
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const LEDGER = join(root, 'security', 'dependency-triage.json');
const args = process.argv.slice(2);

/** The dispositions this gate recognises. Anything else is prose pretending to be a decision. */
const DECISIONS = {
  'upgrade-now': 'a version that clears it exists inside the declared ranges, and someone has to install it',
  'upgrade-blocked': 'the fix exists but no range change here reaches it; the blocker is named in the reason',
  'accepted-dev-only': 'legal only on the development surface, because nothing a consumer installs contains it',
  'peer-floor': 'the finding is inside a peer, so this package answers with a published floor, not a patch',
};
/** A finding with a fix already available does not get a year. */
const UPGRADE_NOW_WINDOW_DAYS = 30;

// ---------------------------------------------------------------------------
// The scan
// ---------------------------------------------------------------------------

/**
 * Run one audit and read its JSON. `npm` is a `.cmd` shim on Windows, so this goes through a shell like the
 * other scripts here do; every argument is a fixed string this file owns.
 */
function audit(extraArgs) {
  const cmd = ['npm', 'audit', '--json', ...extraArgs].join(' ');
  const result = spawnSync(cmd, { cwd: root, encoding: 'utf8', shell: true, maxBuffer: 64 * 1024 * 1024 });
  const text = (result.stdout ?? '').trim();
  if (!text) {
    throw new Error(`\`${cmd}\` produced no JSON (exit ${result.status}): ${String(result.stderr).trim().slice(0, 200)}`);
  }
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error(`\`${cmd}\` replied with something that is not an audit report: ${text.slice(0, 200)}`);
  }
  if (parsed.error) throw new Error(`\`${cmd}\` reported an error: ${JSON.stringify(parsed.error).slice(0, 200)}`);
  return parsed;
}

/**
 * Every advisory the report names, keyed by its GHSA id, with the four facts this gate re-checks on every
 * run. `via` entries that are bare strings are "this package is vulnerable because that package is", a
 * pointer rather than an advisory, so they are skipped and the reach is captured in `packages` instead.
 */
function advisoriesOf(report) {
  const out = new Map();
  for (const [name, info] of Object.entries(report.vulnerabilities ?? {})) {
    for (const via of info.via ?? []) {
      if (typeof via === 'string') continue;
      const id = advisoryId(via.url);
      if (!id) continue;
      const entry = out.get(id) ?? { id, severity: via.severity, range: via.range, packages: new Set(), title: via.title, url: via.url };
      entry.packages.add(name);
      out.set(id, entry);
    }
  }
  return out;
}

const advisoryId = (url) => /GHSA-[0-9a-z]{4}-[0-9a-z]{4}-[0-9a-z]{4}/.exec(String(url ?? ''))?.[0] ?? null;

function scan() {
  const production = advisoriesOf(audit(['--omit=dev']));
  const development = advisoriesOf(audit([]));
  const found = new Map();
  for (const [id, a] of development) found.set(id, { ...a, packages: [...a.packages].sort(), surface: production.has(id) ? 'production' : 'development' });
  for (const [id, a] of production) found.set(id, { ...a, packages: [...a.packages].sort(), surface: 'production' });
  return found;
}

// ---------------------------------------------------------------------------
// The ledger and the matching rules
// ---------------------------------------------------------------------------

function loadLedger() {
  const text = readFileSync(LEDGER, 'utf8');
  return JSON.parse(text);
}

const sorted = (list) => [...list].sort().join(',');
const today = () => new Date().toISOString().slice(0, 10);

/**
 * Compare the live scan with the recorded decisions. Every failure is a sentence a reader who did not write
 * it can act on, because the point of a triage path is that someone else can tell what was decided and why.
 */
function compare(found, ledger) {
  const fails = [];
  const entries = ledger.entries ?? [];
  const live = entries.filter((e) => e.status !== 'precedent');
  const byId = new Map(live.map((e) => [e.advisory, e]));

  // Shape is checked on every entry, precedents included: a documented path that cannot say why it was a
  // path is not evidence of a triage policy. Registry matching runs only for live findings, below.
  for (const entry of entries) {
    if (!DECISIONS[entry.decision]) {
      fails.push(`${entry.advisory}: "${entry.decision}" is not a disposition this gate knows (${Object.keys(DECISIONS).join(' | ')}).`);
      continue;
    }
    if (entry.decision === 'accepted-dev-only' && entry.surface === 'production') {
      fails.push(
        `${entry.advisory}: recorded as "accepted-dev-only", but it is in the tree a consumer installs. ` +
          'Nothing that ships may be excused as development-only.',
      );
    }
    if (String(entry.reason ?? '').trim().length < 60) {
      fails.push(`${entry.advisory}: the reason is ${String(entry.reason ?? '').trim().length} characters. A triage path documents why, not that.`);
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(entry.reviewedOn ?? ''))) {
      fails.push(`${entry.advisory}: reviewedOn must be an ISO date, so a reader can tell how old the judgement is.`);
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(entry.reviewBy ?? ''))) {
      fails.push(`${entry.advisory}: no reviewBy date. A decision nobody is scheduled to revisit is a permanent one.`);
    } else if (entry.reviewBy < today()) {
      fails.push(`${entry.advisory}: its review date ${entry.reviewBy} has passed. Re-triage it or move the date with a reason.`);
    } else if (entry.decision === 'upgrade-now') {
      const days = (Date.parse(`${entry.reviewBy}T00:00:00Z`) - Date.parse(`${entry.reviewedOn}T00:00:00Z`)) / 86400000;
      if (days > UPGRADE_NOW_WINDOW_DAYS) {
        fails.push(
          `${entry.advisory}: decision is "upgrade-now" but the review date is ${Math.round(days)} days out. ` +
            `A fix that is already published gets at most ${UPGRADE_NOW_WINDOW_DAYS} days, or it is called what it is: accepted.`,
        );
      }
    }
  }

  for (const [id, observed] of found) {
    const entry = byId.get(id);
    if (!entry) {
      fails.push(
        `${id} (${observed.severity}, ${sorted(observed.packages)} on the ${observed.surface} surface) is reported by the registry ` +
          'and recorded nowhere. Triage it in security/dependency-triage.json, or remove it by changing what is installed.',
      );
      continue;
    }
    if (entry.severity !== observed.severity) {
      fails.push(`${id}: the advisory is ${observed.severity} now; the ledger still says ${entry.severity}. The decision was made about a different finding.`);
    }
    if (entry.affectedRange !== observed.range) {
      fails.push(`${id}: the vulnerable range is "${observed.range}" now; the ledger says "${entry.affectedRange}". Re-read what it covers.`);
    }
    if (sorted(entry.packages) !== sorted(observed.packages)) {
      fails.push(`${id}: it reaches [${sorted(observed.packages)}] now; the ledger records [${sorted(entry.packages)}]. A new path in means a new decision.`);
    }
    if (entry.surface !== observed.surface) {
      fails.push(`${id}: the scan finds it on the ${observed.surface} surface, the triage says ${entry.surface}. "Development-only" has to be true, not intended.`);
    }
  }

  for (const [id] of byId) if (!found.has(id)) {
    fails.push(`${id}: the ledger still carries a decision for a finding the registry no longer reports. Delete the entry — a stale triage record reads like a live risk.`);
  }

  return fails;
}

// ---------------------------------------------------------------------------
// --selftest: every rule shown to fire, against synthetic data, writing nothing
// ---------------------------------------------------------------------------

function selftest() {
  const observed = [
    { id: 'GHSA-aaaa-aaaa-aaaa', severity: 'moderate', range: '>=1.0.0 <2.0.0', packages: ['tool-a', 'wrapper'], surface: 'development', title: 'x', url: 'https://github.com/advisories/GHSA-aaaa-aaaa-aaaa' },
    { id: 'GHSA-bbbb-bbbb-bbbb', severity: 'high', range: '>=1.0.0 <1.2.2', packages: ['transitive-b'], surface: 'development', title: 'y', url: 'https://github.com/advisories/GHSA-bbbb-bbbb-bbbb' },
    { id: 'GHSA-cccc-cccc-cccc', severity: 'low', range: '<3.0.0', packages: ['shipped-c'], surface: 'production', title: 'z', url: 'https://github.com/advisories/GHSA-cccc-cccc-cccc' },
  ];
  const base = (over = {}) => ({
    advisory: 'GHSA-aaaa-aaaa-aaaa',
    severity: 'moderate',
    affectedRange: '>=1.0.0 <2.0.0',
    packages: ['tool-a', 'wrapper'],
    surface: 'development',
    decision: 'upgrade-blocked',
    reason: 'The fix is outside the range the holder declares, and moving the holder is a major that touches every test file in the suite.',
    reviewedOn: today(),
    reviewBy: '2099-01-01',
    ...over,
  });
  const ledgerOf = (entries) => ({ entries });
  const clean = [
    base(),
    base({ advisory: 'GHSA-bbbb-bbbb-bbbb', severity: 'high', affectedRange: '>=1.0.0 <1.2.2', packages: ['transitive-b'], decision: 'accepted-dev-only' }),
    base({ advisory: 'GHSA-cccc-cccc-cccc', severity: 'low', affectedRange: '<3.0.0', packages: ['shipped-c'], surface: 'production', decision: 'peer-floor' }),
  ];
  const found = new Map(observed.map((a) => [a.id, a]));

  const scenarios = [
    {
      name: 'the whole ledger, matched against the scan it describes',
      want: 0,
      cases: () => ledgerOf(clean),
    },
    {
      name: 'a finding the registry reports and nobody has decided anything about',
      want: /is reported by the registry and recorded nowhere/,
      cases: () => ledgerOf(clean.slice(0, 2)),
    },
    {
      name: 'a decision kept after the finding is gone',
      want: /no longer reports/,
      cases: () => ledgerOf([...clean, base({ advisory: 'GHSA-dddd-dddd-dddd' })]),
    },
    {
      name: '"accepted-dev-only" applied to something that ships',
      want: /Nothing that ships may be excused as development-only/,
      cases: () => ledgerOf([base({ advisory: 'GHSA-cccc-cccc-cccc', severity: 'low', affectedRange: '<3.0.0', packages: ['shipped-c'], surface: 'production', decision: 'accepted-dev-only' }), ...clean.slice(0, 2)]),
    },
    {
      name: 'a reason that is a shrug',
      want: /A triage path documents why, not that/,
      cases: () => ledgerOf([{ ...clean[0], reason: 'dev only' }, ...clean.slice(1)]),
    },
    {
      name: 'an escalation the ledger has not read about',
      want: /The decision was made about a different finding/,
      cases: () => ledgerOf([{ ...clean[0], severity: 'low' }, ...clean.slice(1)]),
    },
    {
      name: 'a widened vulnerable range the ledger still describes narrowly',
      want: /Re-read what it covers/,
      cases: () => ledgerOf([{ ...clean[0], affectedRange: '>=1.0.0 <1.9.0' }, ...clean.slice(1)]),
    },
    {
      name: 'a second package reached by the same advisory',
      want: /A new path in means a new decision/,
      cases: () => ledgerOf([{ ...clean[0], packages: ['tool-a'] }, ...clean.slice(1)]),
    },
    {
      name: 'a review date that has simply passed',
      want: /has passed/,
      cases: () => ledgerOf([{ ...clean[0], reviewBy: '2020-01-01' }, ...clean.slice(1)]),
    },
    {
      name: '"upgrade-now" used as a way of never doing it',
      want: /gets at most \d+ days/,
      cases: () => ledgerOf([{ ...clean[1], decision: 'upgrade-now', reviewedOn: '2020-01-01', reviewBy: '2099-01-01' }, clean[0], clean[2]]),
    },
    {
      name: 'a disposition word the gate has never heard of',
      want: /is not a disposition this gate knows/,
      cases: () => ledgerOf([{ ...clean[0], decision: 'probably-fine' }, ...clean.slice(1)]),
    },
    {
      name: 'a precedent entry, which is a documented path rather than a live finding',
      want: 0,
      cases: () => ledgerOf([...clean, base({ advisory: 'GHSA-zzzz-zzzz-zzzz', status: 'precedent', decision: 'peer-floor' })]),
    },
  ];

  let bad = 0;
  for (const s of scenarios) {
    const fails = compare(found, s.cases());
    const ok = typeof s.want === 'number' ? fails.length === s.want : fails.some((f) => s.want.test(f));
    if (!ok) {
      bad++;
      console.log(`FAIL  ${s.name}\n      ${fails.join('\n      ') || 'the rule stayed silent'}`);
    } else {
      console.log(`ok    ${s.name}`);
    }
  }
  console.log(`dependency triage selftest: ${scenarios.length - bad}/${scenarios.length} scenarios fired`);
  process.exit(bad ? 1 : 0);
}

// ---------------------------------------------------------------------------
// The run
// ---------------------------------------------------------------------------

if (args.includes('--selftest')) selftest();

let found;
try {
  found = scan();
} catch (error) {
  console.error(`dependency scan did not run: ${error.message}`);
  console.error('§6.2 makes scanning an obligation, so a scan that could not execute is a failure rather than a skip.');
  process.exit(2);
}

const ledger = loadLedger();
const fails = compare(found, ledger);
const precedents = (ledger.entries ?? []).filter((e) => e.status === 'precedent');

for (const entry of ledger.entries ?? []) {
  if (entry.status === 'precedent') {
    console.log(`precedent  ${entry.advisory}  ${entry.decision}  ${sorted(entry.packages)}`);
    continue;
  }
  const a = found.get(entry.advisory);
  console.log(
    `${a ? 'live' : 'stale'}     ${entry.advisory}  ${String(entry.severity).padEnd(8)} ${entry.surface.padEnd(11)} ${entry.decision.padEnd(19)} ${sorted(entry.packages)}  review by ${entry.reviewBy}`,
  );
}
const counts = {};
for (const a of found.values()) counts[a.severity] = (counts[a.severity] ?? 0) + 1;
console.log(
  `dependency scan — ${found.size} advisory(ies) across both surfaces (${counts.critical ?? 0} critical, ${counts.high ?? 0} high, ${counts.moderate ?? 0} moderate, ${counts.low ?? 0} low), ` +
    `${precedents.length} documented precedent(s), production surface: ${[...found.values()].filter((a) => a.surface === 'production').length === 0 ? 'clean' : 'findings present'}`,
);

if (fails.length) {
  console.error(`\n${fails.length} triage failure(s):`);
  for (const f of fails) console.error(`  - ${f}`);
  console.error('\nThe path a finding travels is written in SECURITY.md.');
  process.exit(1);
}
console.log('every finding the registry reports is triaged, and every triage still matches what the registry reports');
