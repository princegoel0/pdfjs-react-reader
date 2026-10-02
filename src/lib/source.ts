import { describeOrigin, PdfError } from './errors';

export type PdfSource = string | ArrayBuffer | Uint8Array | Blob;

/** Result of normalization: either a URL pdf.js fetches itself, or raw bytes. */
export type NormalizedSource = { kind: 'url'; url: string } | { kind: 'data'; data: Uint8Array };

/** Schemes that can carry a document. A single letter followed by `:` is a Windows drive, not a scheme. */
const KNOWN_SCHEME_RE = /^(?:https?|blob|file|data|ftp|ws|wss):/i;
const PATH_START_RE = /^(?:\/|\.\/|\.\.\/)/;
const BASE64_RE = /^[A-Za-z0-9+/]+={0,2}$/;

function base64FromLabel(label: string): Uint8Array {
  const binary = atob(label);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

/**
 * Decode a base64 string into the file's bytes.
 *
 * A base64 string is already a valid `src` — `usePdfDocument({ src: base64 })` decodes it the same way —
 * so this exists for the step *before* that: an upload widget that has the text in a JSON payload and
 * wants bytes to hash, to wrap in a `File`, or to send somewhere else. Validation is on, because a host
 * calling this directly meets strings our own heuristic never lets through: `atob` fails with a
 * `DOMException` that says nothing about the input, and a silent partial decode would be worse.
 */
export function base64ToBytes(base64: string): Uint8Array {
  const compact = base64.replace(/\s/g, '');
  if (!compact) throw new PdfError('INVALID_SOURCE', 'base64ToBytes: the string is empty.');
  if (!BASE64_RE.test(compact) || compact.length % 4 !== 0) {
    throw new PdfError(
      'INVALID_SOURCE',
      'base64ToBytes: not a base64 string. Expected the alphabet A–Z a–z 0–9 + / ' +
        'with = padding, a length that is a multiple of 4, and no URL characters.',
    );
  }
  return base64FromLabel(compact);
}

function documentBase(): string | undefined {
  const g = globalThis as typeof globalThis & { document?: { baseURI?: string } };
  return g.document?.baseURI;
}

/** Absolute form of a source URL, or the input when there is nothing to resolve it against. */
export function resolveSourceUrl(url: string): string {
  const base = documentBase();
  if (!base) return url;
  try {
    return new URL(url, base).href;
  } catch {
    return url;
  }
}

/**
 * Why `classifySource` refused a string — the three ways an upload widget's value stops being a document.
 */
export type PdfSourceRefusal =
  /** Empty, or whitespace only: there is nothing there to load. */
  | 'empty'
  /**
   * A bare word (`report`, `the monthly report`). Fetching it asks the app's own origin for whatever
   * lives at that path, so the parser is handed a HTML error page instead of a PDF — which arrives as a
   * corrupt-document failure with nothing pointing at the typo.
   */
  | 'bare-name'
  /**
   * Carries a backslash (`C:\\docs\\report.pdf`): a filesystem path from a form, a server log or a
   * Windows client. It is never a web path, and the origin fetch above would be a guess.
   */
  | 'windows-path'
  /**
   * Shaped like a base64 data URL — `data:…;base64,` — but the body is not base64: truncated, URL-encoded
   * (`+` arrived as a space), or the wrong payload entirely. Refused rather than decoded into garbage,
   * because the whole purpose of asking first is not to hand the parser a half-file.
   */
  | 'bad-base64';

/**
 * What `normalizeSource` will do with a string, decided without loading it:
 *
 * - `url` — the engine fetches it. Scheme-shaped (`https:`, `blob:`, `data:` …), a path
 *   (`/files/a.pdf`, `./a.pdf`, `//cdn/a.pdf`), or anything with a slash or a `.pdf` suffix that the
 *   loader treats as a path.
 * - `bytes` — the string *is* the document, and `data` is the decoded file: a long pure-base64 run
 *   (≥ 128 characters, a multiple of 4, no URL characters) or a `;base64` data URL.
 * - `refused` — neither, with the `reason` above and a `message` a host can show.
 *
 * It **never throws**, which is the point of asking before loading: `normalizeSource` on the same string
 * throws exactly this `message`, so a host that checks here and a host that only passes `src` through see
 * the same rule and the same words. There is one heuristic, not two.
 *
 * A `data:` URL that is not base64-encoded reports `url` — which is what happens to it: the engine is
 * handed the string and fetches it. `;base64` is the one form decoded here, because that is the case a
 * host can hold as text and turn into bytes without a round trip.
 */
export type PdfSourceClassification =
  | { kind: 'url'; url: string }
  | { kind: 'bytes'; data: Uint8Array }
  | { kind: 'refused'; reason: PdfSourceRefusal; message: string };

/**
 * How much of a host's string is safe to repeat back.
 *
 * §3.6: a refusal names the origin and the reason, never the path or the query. That is not pedantry — a
 * pre-signed S3 or SAS URL carries its credential *in the query string*, and a message is exactly the thing
 * that ends up in a log line, a support ticket and a rendered error panel. So anything URL-shaped contributes
 * its origin; a path contributes "the same origin"; and only a string that cannot be a URL at all (a bare
 * word, a Windows path, an empty value) is echoed, truncated, with anything after `?` or `#` cut off first
 * because a pasted path can carry a token too.
 */
function describeSource(src: string): string {
  const trimmed = src.trim();
  if (!trimmed) return 'an empty string';
  if (/^data:/i.test(trimmed)) return 'a data: URL';
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed) || trimmed.startsWith('//')) return describeOrigin(trimmed);
  if (trimmed.startsWith('/')) return 'the same origin';
  const head = trimmed.split(/[?#]/)[0] ?? '';
  // Quoted exactly as before: the message is a sentence a host may match or show, and re-quoting it would be
  // churn with no security or clarity behind it.
  return JSON.stringify(head.length > 48 ? `${head.slice(0, 48)}…` : head);
}

/** The sentence `normalizeSource` throws for a refused string, and the classifier reports as `message`. */
function refusalMessage(src: string, reason: PdfSourceRefusal): string {
  const why =
    reason === 'empty'
      ? 'the string is empty'
      : reason === 'windows-path'
        ? 'a backslash is a filesystem path, never a web path'
        : reason === 'bad-base64'
          ? 'a data URL that says base64 must carry base64'
          : 'a bare word is not a path, and fetching one returns whatever this origin serves there';
  return (
    `Unrecognized PDF source ${describeSource(src)}: ${why}. Expected a URL, a path, ` +
    'a base64 string, or an ArrayBuffer, Uint8Array or Blob of file bytes.'
  );
}

/**
 * The classifier behind `normalizeSource`, and exported as itself (FR-38) so a host holding a string from
 * an upload widget, a query parameter or a JSON payload can say what it is before anything is fetched.
 */
export function classifySource(src: string): PdfSourceClassification {
  const trimmed = src.trim();
  if (!trimmed) {
    return { kind: 'refused', reason: 'empty', message: refusalMessage(src, 'empty') };
  }

  const isBase64DataUrl = /^data:[^,]*;base64,/i.test(trimmed);
  if (isBase64DataUrl) {
    // Split once at the first comma: the alphabet never contains one.
    const label = trimmed.slice(trimmed.indexOf(',') + 1);
    try {
      return { kind: 'bytes', data: base64ToBytes(label) };
    } catch {
      // The one place the classifier has to catch, and the reason it can: a `data:` URL is how a base64
      // payload arrives from a form or a JSON field, and a truncated or URL-encoded body would otherwise
      // escape as a DOMException from `atob` — a throw from a function whose whole contract is not to.
      return {
        kind: 'refused',
        reason: 'bad-base64',
        message: refusalMessage(src, 'bad-base64'),
      };
    }
  }

  if (KNOWN_SCHEME_RE.test(trimmed) || PATH_START_RE.test(trimmed) || trimmed.startsWith('//')) {
    return { kind: 'url', url: trimmed };
  }

  const compact = trimmed.replace(/\s/g, '');
  // Heuristic: a long pure-base64 string with no URL characters is treated as base64.
  if (compact.length >= 128 && BASE64_RE.test(compact) && compact.length % 4 === 0) {
    return { kind: 'bytes', data: base64FromLabel(compact) };
  }

  // A backslash is never a web path, and a bare word is far more likely to be a mistake than a document:
  // fetching it sends whatever the app's origin serves at that location to the PDF parser.
  if (trimmed.includes('\\')) {
    return { kind: 'refused', reason: 'windows-path', message: refusalMessage(src, 'windows-path') };
  }
  const looksLikePath = trimmed.includes('/') || /\.pdf($|[?#])/i.test(trimmed);
  if (!looksLikePath) {
    return { kind: 'refused', reason: 'bare-name', message: refusalMessage(src, 'bare-name') };
  }
  return { kind: 'url', url: trimmed };
}

/**
 * Whether an absolute URL is covered by an allowlist.
 *
 * An entry is either a URL prefix (`'https://cdn.example.com/pdfs/'`, and a bare
 * origin works the same way) or a path on the page's own origin (`'/files/'`).
 * A path entry is origin-bound on purpose: matching `'/files/'` alone would also
 * admit `https://evil.example/files/`, which is the hole this is meant to close.
 */
export function isAllowedSource(absoluteUrl: string, allowed: readonly string[]): boolean {
  if (allowed.includes('*')) return true;
  let url: URL;
  try {
    url = new URL(absoluteUrl);
  } catch {
    // Unresolvable (relative with no document base). Compare as text.
    return allowed.some((entry) => absoluteUrl.startsWith(entry));
  }
  const sameOriginBase = documentBase();
  return allowed.some((entry) => {
    if (entry === '') return false;
    if (entry.startsWith('/') && !entry.startsWith('//')) {
      // A path entry only means something with an origin to compare against.
      if (!sameOriginBase) return false;
      try {
        return url.origin === new URL(sameOriginBase).origin && url.pathname.startsWith(entry);
      } catch {
        return false;
      }
    }
    return absoluteUrl.startsWith(withPrefixSlash(entry));
  });
}

function withPrefixSlash(entry: string): string {
  // `https://cdn.example.com` must not match `https://cdn.example.com.evil/`.
  return /^[a-z][a-z0-9+.-]*:\/\/[^/]+$/i.test(entry) ? `${entry}/` : entry;
}

/**
 * Normalizes every supported input shape (URL, data URI, base64, ArrayBuffer, Uint8Array, Blob/File) into
 * either a URL or raw bytes for pdf.js.
 *
 * `allowedSources` restricts URL sources when a host app renders sources it did not author; byte inputs
 * are always accepted, since the app handed them over.
 *
 * For a string this is `classifySource` and nothing else, so the check a host can run beforehand and the
 * decision the loader makes are the same code — and a refusal here throws the very `message` the
 * classification carries.
 */
export async function normalizeSource(
  src: PdfSource,
  options?: { allowedSources?: readonly string[] },
): Promise<NormalizedSource> {
  if (typeof src === 'string') {
    const classified = classifySource(src);
    if (classified.kind === 'bytes') return { kind: 'data', data: classified.data };
    if (classified.kind === 'refused') throw new PdfError('INVALID_SOURCE', classified.message);
    const { allowedSources } = options ?? {};
    if (allowedSources && !isAllowedSource(resolveSourceUrl(classified.url), allowedSources)) {
      // The origin, never the href: a pre-signed URL's query string *is* the credential, and this message is
      // documented as safe to show a reader.
      throw new PdfError(
        'SOURCE_NOT_ALLOWED',
        `Refused to load ${describeOrigin(classified.url)}: it is not listed in allowedSources.`,
        { details: { origin: describeOrigin(classified.url) } },
      );
    }
    return { kind: 'url', url: classified.url };
  }
  if (src instanceof Uint8Array) return { kind: 'data', data: src };
  if (src instanceof ArrayBuffer) return { kind: 'data', data: new Uint8Array(src) };
  if (typeof Blob !== 'undefined' && src instanceof Blob) {
    return { kind: 'data', data: new Uint8Array(await src.arrayBuffer()) };
  }
  throw new PdfError(
    'INVALID_SOURCE',
    'Unsupported PDF source: expected string, ArrayBuffer, Uint8Array, or Blob',
  );
}
