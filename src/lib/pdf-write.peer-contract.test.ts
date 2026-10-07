/*
 * FR-53's last sentence, given an instrument: "npm semver acceptance alone is not a support claim."
 *
 * The clause's other halves are measured — `pdfjs-dist` is built *and painted* at both ends of `^6.2.108`, and the
 * tier whose behaviour differs between them declares that on its own contract (`engineRequirements`, #249). The
 * writer peer was the half resting on a sentence: installed exactly once, from the lockfile. Read against the
 * registry on 2026-10-07 that made the gap sharper rather than wider — `@cantoo/pdf-lib` has 48 published 2.x
 * versions and **exactly one member of `^2.11.1`**, which is also `dist-tags.latest`, so there was no untested
 * upper version sitting unmeasured. What was unmeasured is the *content* of the promise: a range says "anything
 * in here works", and nothing in the repo said which facts about the package that claim rests on.
 *
 * So this file says them. What `^2.11.1` promises is the surface `pdf-write.ts` and `pdf-merge.ts` call; the
 * supportable statement about a version nobody has run is "it keeps this surface", and one command now answers
 * that question for whatever version is in the tree. Every member is resolved on the installed peer and, where the
 * call site reaches it through an object, on a live one — which was not a refinement but a correction:
 * `page.node`, `page.ref` and `field.acroField` are assigned in their constructors and appear on no prototype, so
 * the first draft of this oracle, reading prototypes, reported three members this package genuinely calls as
 * missing. An instrument that calls the system broken when the instrument is wrong is worse than none.
 *
 * Four things keep it honest rather than decorative:
 *
 *  - **the import list is derived from the sources, not typed out here.** Add an import of a peer name and the
 *    coverage case fails until the contract accounts for it, so the contract has to grow rather than quietly stop
 *    matching what the code depends on;
 *  - **every declared member has to still be called.** Comments are stripped first, because `pdf-write.ts`
 *    discusses `insertPage()` and `context.delete(page.ref)` in prose about a design it rejected, and a contract
 *    that promises members nobody calls is a wider promise than the code makes;
 *  - **the coverage check runs in both directions**, so a group left over from a dependency the sources stopped
 *    importing fails like a new dependency does;
 *  - **the range advertised is checked against the tree measured**, in both places it is written. `peerDependencies`
 *    and `devDependencies` carry the same string, and if they ever differ the suite has been certifying one range
 *    while publishing another.
 *
 * What it cannot catch, stated because the file should not imply otherwise: a *new* member called on a class
 * already covered here escapes every guard above, and is caught by the behaviour suite that actually writes files
 * (`pdf-write.test.ts`, `pdf-merge.test.ts`) — the right division of labour, since those run on the peer instead
 * of reading it.
 */
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import * as peer from '@cantoo/pdf-lib';
import packageJson from '../../package.json';

const PEER = '@cantoo/pdf-lib';
const repo = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

/** The two modules that may touch the peer — the same pair `dependency-boundary.test.ts` walks. */
const HOLDERS = ['src/lib/pdf-write.ts', 'src/lib/pdf-merge.ts'];

/**
 * Comments removed, so prose about a rejected API is not read as a call to it.
 *
 * The same pair of rules the module-graph walk uses: a non-greedy block rule, because these files hold several
 * blocks, and a line rule that leaves a URL's scheme alone.
 */
function withoutComments(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:\\])\/\/[^\n]*/g, '$1');
}

const sources = (): string =>
  HOLDERS.map((file) => withoutComments(readFileSync(join(repo, file), 'utf8'))).join('\n');

/** Every name the holders import from the peer, derived rather than listed here. */
function importedNames(): string[] {
  const names = new Set<string>();
  for (const match of sources().matchAll(/import\s*\{([^}]*)\}\s*from\s*['"]@cantoo\/pdf-lib['"]/g)) {
    for (const entry of (match[1] ?? '').split(',')) {
      const name = entry.trim().split(/\s+as\s+/)[0]?.trim();
      if (name) names.add(name);
    }
  }
  return [...names].sort();
}

/** Members reached as a static on an imported class: `PDFDocument.load`, `PDFName.of`. */
const STATICS: Record<string, string[]> = {
  PDFDocument: ['create', 'load'],
  PDFName: ['of'],
};

/**
 * Members reached on an object a call site holds, grouped by how the call site obtains it.
 *
 * Each entry is a promise: a version of the peer that loses one of these breaks the edit tier whatever its
 * number says. `dictionary` and `array` are the classes `doc.context.lookup(x, PDFDict)` and `context.obj([...])`
 * hand back, which is where `pdf-write.ts` gets both.
 */
const INSTANCES: Record<string, string[]> = {
  document: [
    'addPage',
    'catalog',
    'context',
    'copyPages',
    'getForm',
    'getPageCount',
    'getPages',
    'removePage',
    'save',
  ],
  'document.context': ['lookup', 'obj', 'register', 'stream'],
  'document.getForm()': ['flatten', 'getFields'],
  'document.addPage()': ['node', 'setRotation'],
  dictionary: ['get', 'set'],
  array: ['asArray', 'size'],
  'signature field': ['acroField', 'getName'],
};

/** Which imported class each group belongs to, so an orphan group cannot survive a removed dependency. */
const CLASS_GROUPS: Record<string, string[]> = {
  PDFDocument: ['document', 'document.context', 'document.getForm()', 'document.addPage()'],
  PDFDict: ['dictionary'],
  PDFArray: ['array'],
  PDFSignature: ['signature field'],
};

/** Names the contract holds no member list for, and what they are instead. */
const ROLES: Record<string, string> = {
  PDFObject: `type position only — ${HOLDERS[0]}'s \`numberOf(doc, raw: PDFObject | undefined)\``,
  degrees: 'a function rather than a surface — `degrees(angle)` feeds `setRotation`',
};

/** Read from disk rather than imported: `./package.json` is not on the peer's export list. */
function installedVersion(): string {
  const manifest = JSON.parse(readFileSync(join(repo, 'node_modules/@cantoo/pdf-lib/package.json'), 'utf8')) as {
    version?: string;
  };
  if (!manifest.version) throw new Error(`${PEER} is installed with no version in its manifest`);
  return manifest.version;
}

/** The same copy `pdf-write.ts`'s `toArrayBuffer` makes: a Buffer can be a view into a shared pool. */
function fixture(name: string): ArrayBuffer {
  return new Uint8Array(readFileSync(join(repo, 'playground/fixtures', name))).buffer;
}

const liveDocument = (): Promise<peer.PDFDocument> => peer.PDFDocument.create();

/** The first real `/Sig` field in the fixture, which is what `signatureWidgets` iterates over. */
async function liveSignatureField(): Promise<peer.PDFSignature> {
  const doc = await peer.PDFDocument.load(fixture('signature-sample.pdf'), { ignoreEncryption: true });
  const field = doc.getForm().getFields().find((candidate) => candidate instanceof peer.PDFSignature);
  if (!field) throw new Error(`${PEER}@${installedVersion()}: signature-sample.pdf yielded no PDFSignature field`);
  return field as peer.PDFSignature;
}

/** `[group, object]` for each entry in `INSTANCES`, reached the way the call sites reach it. */
async function groups(): Promise<Map<string, object>> {
  const doc = await liveDocument();
  const form = doc.getForm();
  const page = doc.addPage([612, 792]);
  return new Map<string, object>([
    ['document', doc],
    ['document.context', doc.context],
    ['document.getForm()', form],
    ['document.addPage()', page],
    ['dictionary', doc.catalog],
    ['array', doc.context.obj([0, 0, 612, 792])],
    ['signature field', await liveSignatureField()],
  ]);
}

describe('FR-53: what the writer peer promise rests on', () => {
  it('knows which version it read, because a green suite that cannot say so proves nothing', () => {
    expect(installedVersion(), `${PEER} is not installed, so the contract has no subject`).toMatch(/^\d+\.\d+\.\d+/);
  });

  it('advertises one range in both places it is written', () => {
    const peerRange = packageJson.peerDependencies[PEER];
    const devRange = packageJson.devDependencies?.[PEER];
    expect(peerRange, `${PEER} is not declared as a peer at all`).toBeTruthy();
    expect(devRange, `${PEER} is not installed for the suite to read, so nothing measures the peer range`).toBeTruthy();
    expect(devRange, `the suite measures ${devRange} while consumers are promised ${peerRange}`).toBe(peerRange);
  });

  it('installs a version the advertised range actually contains', () => {
    const range = packageJson.peerDependencies[PEER]!;
    // `satisfiesCaret` handles the one form the manifest uses, and this assertion pins that assumption instead of
    // letting the helper quietly mean something else once the range becomes `>=2.11.1` or a union.
    expect(range, `satisfiesCaret understands caret ranges only, and the manifest advertises ${range}`).toMatch(
      /^\^\d+\.\d+\.\d+$/,
    );
    const have = installedVersion();
    expect(satisfiesCaret(have, range), `${PEER}@${have} does not satisfy the advertised ${range}`).toBe(true);
  });

  it('exports every name the sources import from it', () => {
    const names = importedNames();
    expect(names.length, `no import of ${PEER} was found in ${HOLDERS.join(' or ')} — the walk lost its subject`).toBeGreaterThan(
      0,
    );
    const missing = names.filter((name) => !(name in peer));
    expect(
      missing,
      `${PEER}@${installedVersion()} exports no ${missing.join(', ')} of the ${names.length} names the sources import`,
    ).toEqual([]);
    // Every imported name is a constructor or a function today, so a release that turns one into a plain object is
    // a breaking change even where the name survives.
    const notCallable = names.filter((name) => typeof (peer as Record<string, unknown>)[name] !== 'function');
    expect(notCallable, `${PEER}@${installedVersion()} has ${notCallable.join(', ')} as a non-function`).toEqual([]);
  });

  it('accounts for every imported name, every static owner and every group, in both directions', () => {
    const names = importedNames();
    const unaccounted = names.filter((name) => !(name in STATICS) && !(name in CLASS_GROUPS) && !(name in ROLES));
    expect(
      unaccounted,
      `${unaccounted.join(', ')} imported from ${PEER}@${installedVersion()} with no members declared and no role stated`,
    ).toEqual([]);
    const goneStatics = Object.keys(STATICS).filter((owner) => !names.includes(owner));
    expect(goneStatics, `the contract lists statics of ${goneStatics.join(', ')}, which no holder imports`).toEqual([]);
    const owned = new Set(Object.values(CLASS_GROUPS).flat());
    const declared = new Set(Object.keys(INSTANCES));
    const unowned = [...declared].filter((group) => !owned.has(group));
    expect(unowned, `the contract declares ${unowned.join(', ')}, belonging to no class the sources import`).toEqual([]);
    const phantom = [...owned].filter((group) => !declared.has(group));
    expect(phantom, `the contract assigns ${phantom.join(', ')}, which it does not declare`).toEqual([]);
    const classless = Object.keys(CLASS_GROUPS).filter((name) => !names.includes(name));
    expect(classless, `the contract assigns groups to ${classless.join(', ')}, which no holder imports`).toEqual([]);
  });

  it('finds every declared member on the object the call site actually holds', async () => {
    const resolved = await groups();
    const absent: string[] = [];
    for (const [owner, members] of Object.entries(STATICS)) {
      const object = (peer as Record<string, unknown>)[owner] as Record<string, unknown> | undefined;
      if (!object) throw new Error(`${PEER}@${installedVersion()} has no ${owner} to read statics from`);
      for (const member of members) if (!(member in object)) absent.push(`${owner}.${member}`);
    }
    for (const [group, members] of Object.entries(INSTANCES)) {
      const object = resolved.get(group);
      if (!object) throw new Error(`the contract declares group ${group}, which the harness never builds`);
      const kind = (object as { constructor?: { name?: string } }).constructor?.name ?? 'object';
      for (const member of members) {
        if (!(member in object)) absent.push(`${group} → ${member} (held by ${kind})`);
      }
    }
    const total = Object.values(STATICS).reduce((n, list) => n + list.length, 0) + Object.values(INSTANCES).reduce((n, list) => n + list.length, 0);
    expect(absent, `${PEER}@${installedVersion()} carries no ${absent.join(', no ')} of the ${total} members called`).toEqual(
      [],
    );
  });

  it('declares no member the sources have stopped calling', () => {
    const text = sources();
    const stale: string[] = [];
    for (const [owner, members] of Object.entries(STATICS)) {
      for (const member of members) {
        if (!new RegExp(`${owner}\\s*\\.\\s*${member}\\b`).test(text)) stale.push(`${owner}.${member}`);
      }
    }
    for (const [group, members] of Object.entries(INSTANCES)) {
      for (const member of members) {
        if (!new RegExp(`\\.\\s*${member}\\b`).test(text)) stale.push(`${group} → ${member}`);
      }
    }
    expect(stale, `the contract still promises ${stale.join(', ')}, which neither holder calls any more`).toEqual([]);
  });

  it('composes the two calls the rotation path relies on, on a live page', async () => {
    const doc = await liveDocument();
    const page = doc.addPage([612, 792]);
    // `degrees(angle)` feeds `setRotation`, and that pair is the whole of `arrangePages`'s rotation write. Either
    // half changing shape is what this case is for, and it is a change reflection would report as fine.
    expect(() => page.setRotation(peer.degrees(90))).not.toThrow();
    const saved = await doc.save({ useObjectStreams: false });
    expect(saved.length, `${PEER}@${installedVersion()} saved a document with no bytes in it`).toBeGreaterThan(0);
    expect(new TextDecoder().decode(saved.slice(0, 5))).toBe('%PDF-');
  });

  it('reaches a signature field through the instanceof the signature path branches on', async () => {
    const field = await liveSignatureField();
    expect(field.constructor.name, `${PEER}@${installedVersion()} yielded a field that is not a PDFSignature`).toBe(
      'PDFSignature',
    );
    expect(typeof field.getName()).toBe('string');
    // `signatureWidgets` reads `field.acroField.dict`, which is an instance assignment, not a prototype member.
    expect(field.acroField.dict.constructor.name, 'acroField.dict is not the PDFDict the widget walk assumes').toBe(
      'PDFDict',
    );
  });

  it('holds the page-tree composition the permutation writes', async () => {
    const doc = await liveDocument();
    doc.addPage([612, 792]);
    doc.addPage([612, 792]);
    const tree = doc.context.lookup(doc.catalog.get(peer.PDFName.of('Pages'))!, peer.PDFDict);
    expect(tree, `${PEER}@${installedVersion()} gives a fresh document no /Pages dictionary`).toBeTruthy();
    const list = doc.context.lookup(tree!.get(peer.PDFName.of('Kids'))!, peer.PDFArray);
    expect(list, 'the page tree holds no /Kids array to permute').toBeTruthy();
    expect(list!.size()).toBe(2);
    // The writes `permutePageTree` performs, performed on a real tree.
    tree!.set(peer.PDFName.of('Kids'), doc.context.obj([...list!.asArray()].reverse()));
    tree!.set(peer.PDFName.of('Count'), doc.context.obj(2));
    const saved = await doc.save({ useObjectStreams: false });
    expect(new TextDecoder().decode(saved.slice(0, 5))).toBe('%PDF-');
  });
});

/**
 * Does `have` fall inside `^base`?
 *
 * Written here rather than installed as a dependency: `semver` would be an undeclared runtime requirement of the
 * *test*, and the clause's first sentence is precisely that nothing reaches a consumer undeclared. It handles the
 * one form the case above pins with a regex — caret over `[major].[minor].[patch]` — and throws on anything else,
 * so `>=`, `x` ranges and unions have to be given a real comparator rather than be read as this one.
 */
function satisfiesCaret(have: string, range: string): boolean {
  const match = /^\^(\d+)\.(\d+)\.(\d+)$/.exec(range.trim());
  if (!match) throw new Error(`satisfiesCaret: ${range} is not a caret [major.minor.patch] range`);
  const [major, minor, patch] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const [haveMajor = '', haveMinor = '0', havePatch = '0'] = have.split('.');
  if (haveMajor !== String(major)) return false;
  const minorNumber = Number(haveMinor.split(/[-+]/)[0]);
  if (minorNumber !== minor) return minorNumber > minor;
  return Number(havePatch.split(/[-+]/)[0]) >= patch;
}
