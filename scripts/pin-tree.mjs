/*
 * The pinned dev tree for a CI cell that swaps one peer on disk (#244), and the check that the swap landed.
 *
 * `npm i --no-save <axis>` does not install only the axis. npm re-resolves every caret range in
 * `package.json`, so a peer job meant to move React also moved axe-core — the 4.14 rule set arrived, its
 * `label-content-name-mismatch` evaluator threw under jsdom, and four `react` cells went red on a linting
 * library while `verify` stayed green on the lockfile's 4.13. Measured 2026-10-06, CI run 37472575777's
 * ancestors. So every peer cell names the rest of its tree *in the same install*, at the versions the
 * lockfile holds, and this file is where those versions come from — both peer jobs ask for them rather than
 * each keeping its own copy of the derivation, because the two copies drifting is the same defect wearing a
 * different ticket.
 *
 * `check` reads the disk afterwards and refuses a cell that is not the cell the matrix asked for. Straight
 * off the filesystem, not through `require`: several devDependencies (`@cantoo/pdf-lib`, `@vitejs/plugin-react`)
 * restrict their `exports` and would read as missing, and a guard that reports a missing package for an
 * `ERR_PACKAGE_PATH_NOT_EXPORTED` fails a cell that is fine.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
const lock = JSON.parse(readFileSync(join(root, 'package-lock.json'), 'utf8')).packages;

const flags = (name) =>
  process.argv
    .slice(3)
    .filter((a) => a.startsWith(`--${name}=`))
    .map((a) => a.slice(name.length + 3));

const installed = (name) => {
  try {
    return JSON.parse(readFileSync(join(root, 'node_modules', name, 'package.json'), 'utf8')).version;
  } catch {
    return null;
  }
};

const command = process.argv[2];

if (command === 'pins') {
  const axis = new Set(flags('exclude'));
  const pins = Object.keys(pkg.devDependencies || {})
    .filter((name) => !axis.has(name) && lock[`node_modules/${name}`])
    .map((name) => `${name}@${lock[`node_modules/${name}`].version}`);
  if (!pins.length) {
    console.error('pin-tree: no devDependencies found to pin — a job would install a floating tree silently');
    process.exit(2);
  }
  console.log(pins.join(' '));
} else if (command === 'check') {
  const majors = flags('major').map((spec) => spec.split('='));
  const exacts = flags('exact').map((spec) => spec.split('='));
  const axis = new Set([...majors, ...exacts].map(([name]) => name));
  const problems = [];
  for (const [name, want] of majors) {
    const have = installed(name);
    if (have === null) problems.push(`${name} is not installed at all`);
    else if (String(have).split('.')[0] !== want) problems.push(`${name} is ${have}, this cell is the ${want}.x major`);
  }
  for (const [name, want] of exacts) {
    const have = installed(name);
    if (have === null) problems.push(`${name} is not installed at all`);
    else if (have !== want) problems.push(`${name} is ${have}, this cell asked for exactly ${want}`);
  }
  for (const name of Object.keys(pkg.devDependencies || {})) {
    if (axis.has(name)) continue;
    const locked = lock[`node_modules/${name}`] && lock[`node_modules/${name}`].version;
    const have = installed(name);
    if (locked && have !== locked) problems.push(`${name} is ${have ?? 'missing'}, the lockfile says ${locked}`);
  }
  const read = [...axis].map((name) => `${name} ${installed(name)}`).join(', ');
  if (problems.length) {
    console.error(read);
    console.error(`this cell is not the cell the matrix asked for:\n  ${problems.join('\n  ')}`);
    process.exit(1);
  }
  console.log(read);
} else {
  console.error('usage: node scripts/pin-tree.mjs pins --exclude=<name> …');
  console.error('       node scripts/pin-tree.mjs check --major=<name>=<major> … --exact=<name>=<version> …');
  process.exit(2);
}
