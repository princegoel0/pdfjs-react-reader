/*
 * FR-53's discovery half: notice the day the writer peer's range grows a member nobody has proven.
 *
 * `pdfjs-react-reader` advertises `@cantoo/pdf-lib: ^2.11.1` as an optional peer, and the contract for what
 * that promise rests on is `src/lib/pdf-write.peer-contract.test.ts` — the 27 members `pdf-write.ts` and
 * `pdf-merge.ts` call, resolved against the peer that is actually in the tree. That test can only ever speak
 * about the version it is run against. Read from the registry on 2026-10-07, `^2.11.1` has exactly one member,
 * `2.11.1`, which is also the lockfile pin, so the contract covers the whole range today — and it covers
 * nothing the moment npm serves a second member, because a caret range grows by itself.
 *
 * This is the tripwire for that moment, and it is deliberately *not* a second contract run: it asks npm what
 * the advertised range resolves to right now, compares the newest member to the pin the contract was proven
 * against, and fails with the one command that re-runs the contract. It belongs in CI's `consumer` job rather
 * than in `verify` because it needs the network, which `verify` does not (that is why `check:tarball` is out of
 * it too).
 *
 * The readings it prints are the point. A green line here says "this range had one member and it is the one
 * that was proven"; a red line says "the range now offers X, and nobody has run the 27 members against it".
 *
 * `--at=<version>` is a what-if input for proving the comparison, not a substitute for the registry: it skips
 * the npm read and answers as though that version were the range's newest member. `--at 2.12.0` must fail.
 */
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = join(import.meta.dirname, '..');
const packageJson = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
const lock = JSON.parse(readFileSync(join(root, 'package-lock.json'), 'utf8'));

const NAME = '@cantoo/pdf-lib';
const CONTRACT = 'src/lib/pdf-write.peer-contract.test.ts';

/** `1.2.3`, `1.2.3-beta.1` — dotted numerics with any prerelease or build suffix kept for the comparison. */
const VERSION = /\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?/;

function compareVersions(a, b) {
  const split = (v) =>
    String(v)
      .replace(/^[^0-9]*/, '')
      .split(/[-+]/);
  const [numA = '', preA = ''] = split(a);
  const [numB = '', preB = ''] = split(b);
  const partsA = numA.split('.').map((n) => Number.parseInt(n, 10) || 0);
  const partsB = numB.split('.').map((n) => Number.parseInt(n, 10) || 0);
  for (let i = 0; i < 3; i++) {
    if ((partsA[i] ?? 0) !== (partsB[i] ?? 0)) return (partsA[i] ?? 0) - (partsB[i] ?? 0);
  }
  // A prerelease sorts before its own release, which is npm's rule and the one that matters here: a range that
  // starts admitting `-next` tags has gained a member the contract has not seen, not lost one.
  if (preA === preB) return 0;
  if (!preA) return 1;
  if (!preB) return -1;
  return preA < preB ? -1 : 1;
}

const range = packageJson.peerDependencies?.[NAME];
const pin = lock.packages?.[`node_modules/${NAME}`]?.version;
if (!range) throw new Error(`package.json declares no ${NAME} peer, so there is nothing to trip over`);
if (!pin) throw new Error(`the lockfile has no ${NAME} entry, so the proven version is unknown`);

const whatIf = process.argv.slice(2).find((arg) => arg.startsWith('--at='));
let members;
let newest;
if (whatIf) {
  newest = whatIf.slice('--at='.length).trim();
  if (!VERSION.test(newest)) throw new Error(`--at=${newest} is not a version`);
  members = [newest];
} else {
  // One npm call, and npm does the range arithmetic. Ask it directly rather than reimplementing semver: a
  // hand-rolled matcher would be a second answer to "what is in the range", and the two drifting is the same
  // class of defect this script exists to catch.
  //
  // `shell: true` with the spec in double quotes, which is how `check-deps.mjs` and `tarball-check.mjs` reach
  // npm from this repository: `npm` is a `.cmd` file on Windows and cannot be spawned directly, and the caret
  // has to survive both cmd's escape character (where double quotes do) and the shell this runs under locally.
  const spec = `"${NAME}@${range}"`;
  let out = '';
  try {
    const result = spawnSync(`npm view ${spec} version`, {
      cwd: root,
      encoding: 'utf8',
      shell: true,
      maxBuffer: 8 * 1024 * 1024,
    });
    if (result.status !== 0) {
      const first = (result.stderr || result.stdout || `npm exited ${result.status}`).split('\n')[0];
      // npm refuses a range with no member by *erroring* (`No matching version found for …`), which is a
      // different fact from a registry that could not be reached, and the one the reader has to be given:
      // a promise nobody can install is the mistake that shipped 0.1.0, pointed at the writer.
      if (/no matching version|not found|E404/i.test(result.stderr || '')) {
        console.error(
          `FAIL  ${NAME}@${range} resolves to nothing on the registry, so the advertised peer range has no ` +
            `member a host can install.\n      npm's own words: ${first}`,
        );
        process.exit(1);
      }
      throw new Error(first);
    }
    out = result.stdout;
  } catch (error) {
    console.error(
      `FAIL  the registry could not be read for ${NAME}@${range}: ${String(error.message).split('\n')[0]}\n` +
        "      this check is a network check; it runs in CI's `consumer` job, not in `verify`.",
    );
    process.exit(1);
  }
  // One match prints `2.11.1`; several print `name@2.11.0 '2.11.0'` per line. Both shapes are version strings.
  members = [...out.matchAll(new RegExp(VERSION.source, 'g'))].map((match) => match[0]);
  if (members.length === 0) {
    console.error(
      `FAIL  npm resolves ${NAME}@${range} to nothing at all, so the advertised peer range has no member a ` +
        'host can install. That is the mistake that shipped 0.1.0, pointed at the writer instead of the engine.',
    );
    process.exit(1);
  }
  newest = members.reduce((best, v) => (compareVersions(v, best) > 0 ? v : best), members[0]);
}

const detail = whatIf
  ? `range ${range} → newest ${newest} (a --at run: the registry was not asked)`
  : `range ${range} → ${members.length} member${members.length === 1 ? '' : 's'} npm serves, newest ${newest}`;
if (compareVersions(newest, pin) !== 0) {
  console.error(
    `FAIL  FR-53's writer peer range has outgrown the proof. ${detail}, but the contract in ${CONTRACT} was\n` +
      `      written against the version this repository pins, ${pin}. A host installing ${newest} gets a\n` +
      `      surface none of those 27 members has been checked against.\n` +
      `      Re-run the contract against it — in a scratch tree, never with ` +
      "`npm i --no-save` in this one, which re-resolves unrelated devDependencies (that is #244's lesson):\n" +
      `        npm i ${NAME}@${newest} && npx vitest run --project dom ${CONTRACT}\n` +
      `      Green: re-pin and refresh the range's note in fr-evidence.json. Red: the range must not advertise\n` +
      `      ${newest}, and the fix is the range, not the test.`,
  );
  process.exit(1);
}

console.log(
  `ok    ${NAME} peer range is covered by the proven version. ${detail}, which is the pin (${pin}).\n` +
    `      ${CONTRACT} states the 27 members the range rests on, resolved against ${pin}.`,
);
