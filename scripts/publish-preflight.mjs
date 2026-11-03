/**
 * FR-58: the two registry steps that surround the irreversible write — preflight before it, read-back after it.
 *
 * `portable-release-book.md`'s steps 10–12: authenticate and print the *shape* of a credential, never the value;
 * confirm the destination accepts you; dry-run every unit of work; then, after publishing, read each result back
 * from the consumer's side, because a pipeline exit code is not evidence that an artifact is live and replica lag
 * means absence proves nothing. This repository has the artifact side of that (`check:tarball` installs the packed
 * thing) and none of the registry side, so `npm publish` had no preflight and no read-back at all.
 *
 * It refuses rather than assuming. A missing `npm`, an unauthenticated whoami, a registry 5xx, a tarball that
 * cannot be fetched — each is a refusal, never a silent pass. And it never prints a token: `npm whoami` answers
 * with a username, and that is all this file echoes.
 *
 * Usage:
 *   npm run publish:preflight          # before `npm publish` — writes nothing
 *   npm run publish:readback           # after it — downloads from the public registry and re-verifies
 */
import { execFileSync, execSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deriveCandidatePasses, realDeps, releaseOrderProblems } from './release-validate.mjs';

const repo = join(dirname(fileURLToPath(import.meta.url)), '..');
const REGISTRY = 'https://registry.npmjs.org';
const args = process.argv.slice(2);
const flag = (name, fallback = '') => args.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3) ?? fallback;
/** The same git readers the gate uses, so the two can never disagree about where a tag points. */
const gitState = realDeps();

/** The candidate digest a published tarball must match, read from the records rather than retyped. */
export function expectedDigest(records) {
  const green = records.filter((r) => deriveCandidatePasses(r.legs ?? []).passes && r.artifact?.sha256);
  if (green.length === 0) return null;
  const digests = [...new Set(green.map((r) => r.artifact.sha256))];
  return digests.length === 1 ? digests[0] : null;
}

/**
 * Everything the human-written `npm publish` should have settled first. `whoami` is the username only — a null
 * here means the credential is absent or is the wrong type, and #207 measured that a Publish-token is refused
 * `EOTP` for `npm deprecate`, so a name is not proof the write will be accepted.
 */
export function preflightProblems({
  name,
  version,
  whoami,
  packument,
  tagName,
  taggedSha,
  headSha,
  changed,
  dirty,
  dryRunOk,
}) {
  const problems = [];
  if (!whoami) problems.push('npm is not authenticated — `npm whoami` returned nothing (check the token type, not just its presence)');
  if (dirty) problems.push(`the working tree is dirty (${dirty.split('\n').length} file(s)) — publish the committed state, not a laptop's accident`);
  problems.push(...releaseOrderProblems({ tagName, taggedSha, headSha, changed }));
  if (!dryRunOk) problems.push('`npm pack --dry-run` failed — the artifact that would be published cannot be built');
  if (packument && Object.keys(packument.versions ?? {}).includes(version)) {
    problems.push(`${name}@${version} is already on the registry — version numbers are burned permanently`);
  }
  return problems;
}

/** Post-publish: the registry's own copy, read as a consumer reads it. */
export function readbackProblems({ version, name, packument, downloaded, latestTag, digest, bound }) {
  const problems = [];
  if (latestTag !== version) {
    problems.push(`dist-tags.latest is ${latestTag ?? 'unset'}, not ${version} — a lagging replica is not a failed publish, so re-run before you re-publish`);
  }
  if (!packument?.versions?.[version]) problems.push(`the registry has no ${name}@${version} yet — absence is not proof it did not happen; retry within the stated window`);
  if (!downloaded) problems.push(`the published tarball could not be fetched from the registry to verify it — read-back did not happen`);
  // The digest is only compared when there is a tarball to compare: an unpublished version should read as
  // "not there yet, re-run", not as four complaints including a hash of nothing.
  if (downloaded) {
    if (bound) {
      if (!expectedDigestOk(digest, bound)) {
        problems.push(`the registry tarball's sha256 (${digest.slice(0, 12)}…) is not the digest the green candidate record bound (${bound.slice(0, 12)}…)`);
      }
    } else {
      problems.push('no single green candidate record carries one digest, so the published bytes have nothing to be compared against');
    }
  }
  return problems;
}

const expectedDigestOk = (digest, expected) => Boolean(digest && expected) && digest.toLowerCase() === expected.toLowerCase();

const git = (argsList) => {
  try {
    return execFileSync('git', argsList, { cwd: repo, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    return '';
  }
};

/**
 * `npm` is `npm.cmd` on Windows and Node refuses to spawn a `.cmd` without a shell, so a plain `execFileSync`
 * reported "not authenticated" and "pack failed" on a machine where both were fine — measured 2026-11-03, in
 * the first run of this file. A command *string* rather than an args array keeps shell:true honest and avoids
 * Node's DEP0190 warning: every string below is a literal in this module, and nothing user-supplied reaches it.
 */
const NPM_COMMANDS = new Set(['whoami', 'pack --dry-run']);

const npmRun = (command) => {
  if (!NPM_COMMANDS.has(command)) throw new Error(`refusing to run an unlisted npm command: ${command}`);
  try {
    return execSync(`npm ${command}`, { cwd: repo, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    return null;
  }
};

const npm = (command) => npmRun(command) !== null;

const packumentOf = async (name) => {
  const res = await fetch(`${REGISTRY}/${name.replace('/', '%2f')}`);
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`registry answered ${res.status}`);
  return res.json();
};

/** Hash the file the registry actually serves, not the one on this laptop. */
const hashTarball = async (tarballUrl) => {
  const res = await fetch(tarballUrl);
  if (!res.ok) return '';
  return createHash('sha256').update(Buffer.from(await res.arrayBuffer())).digest('hex');
};

const records = () => {
  try {
    return readdirSync(join(repo, 'release'))
      .filter((f) => /^last-candidate.*\.json$/.test(f))
      .map((f) => ({ file: `release/${f}`, ...JSON.parse(readFileSync(join(repo, 'release', f), 'utf8')) }));
  } catch {
    return [];
  }
};

export async function run(mode) {
  const pkg = JSON.parse(readFileSync(join(repo, 'package.json'), 'utf8'));
  const { name, version } = pkg;
  try {
    if (mode === 'preflight') {
      const tagName = `v${version}`;
      const taggedSha = gitState.tagCommit(tagName);
      const headSha = gitState.headSha();
      const changed = taggedSha ? gitState.changedBetween(taggedSha, headSha) : [];
      const problems = preflightProblems({
        version,
        name,
        whoami: npmRun('whoami') ?? '',
        packument: await packumentOf(name),
        tagName,
        taggedSha,
        headSha,
        changed,
        dirty: git(['status', '--porcelain']),
        dryRunOk: npm('pack --dry-run'),
      });
      if (problems.length) {
        console.error(`FAIL  publish:preflight refused ${name}@${version}:`);
        for (const p of problems) console.error(`  - ${p}`);
        console.error('Nothing was written anywhere; the publish is still a person’s decision.');
        return 1;
      }
      console.log(`publish:preflight green for ${name}@${version}: authenticated, tagged, committed, packable, and the number is free.`);
      console.log('It does not publish. That is deliberate — the irreversible step stays a human act.');
      return 0;
    }

    const packument = await packumentOf(name);
    const entry = packument?.versions?.[version];
    const digest = entry ? await hashTarball(entry.dist?.tarball ?? '') : '';
    const problems = readbackProblems({
      version,
      name,
      packument,
      downloaded: Boolean(entry && digest),
      latestTag: packument?.['dist-tags']?.latest,
      digest,
      bound: expectedDigest(records()),
    });
    if (problems.length) {
      console.error(`FAIL  publish:readback could not confirm ${name}@${version} from the consumer's side:`);
      for (const p of problems) console.error(`  - ${p}`);
      return 1;
    }
    console.log(`publish:readback green — ${name}@${version} is dist-tags.latest and its tarball matches the candidate digest ${digest.slice(0, 12)}…`);
    return 0;
  } catch (error) {
    console.error(`FAIL  publish:${mode} refused to guess: ${String(error.message ?? error).slice(0, 200)}`);
    return 1;
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  process.exitCode = await run(args.includes('--readback') ? 'readback' : 'preflight');
}
