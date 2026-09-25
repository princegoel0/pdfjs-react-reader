export type PdfSource = string | ArrayBuffer | Uint8Array | Blob;

/** Result of normalization: either a URL pdf.js fetches itself, or raw bytes. */
export type NormalizedSource = { kind: 'url'; url: string } | { kind: 'data'; data: Uint8Array };

/** Schemes that can carry a document. A single letter followed by `:` is a Windows drive, not a scheme. */
const KNOWN_SCHEME_RE = /^(?:https?|blob|file|data|ftp|ws|wss):/i;
const PATH_START_RE = /^(?:\/|\.\/|\.\.\/)/;
const BASE64_RE = /^[A-Za-z0-9+/]+={0,2}$/;

function base64ToBytes(base64: string): Uint8Array {
  const binary = atob(base64.replace(/\s/g, ''));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
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

function classifyString(src: string): NormalizedSource {
  const trimmed = src.trim();
  if (KNOWN_SCHEME_RE.test(trimmed) || PATH_START_RE.test(trimmed) || trimmed.startsWith('//')) {
    return { kind: 'url', url: trimmed };
  }
  const compact = trimmed.replace(/\s/g, '');
  // Heuristic: a long pure-base64 string with no URL characters is treated as base64.
  if (compact.length >= 128 && BASE64_RE.test(compact) && compact.length % 4 === 0) {
    return { kind: 'data', data: base64ToBytes(compact) };
  }
  // A bare word is far more likely to be a mistake than a document path, and
  // fetching it sends whatever the app's origin serves at that location to the
  // parser. A backslash is never a web path either, so refuse both.
  const looksLikePath = trimmed.includes('/') || /\.pdf($|[?#])/i.test(trimmed);
  if (!looksLikePath || trimmed.includes('\\')) {
    throw new TypeError(
      `Unrecognized PDF source ${JSON.stringify(src)}. Expected a URL, a path, ` +
        'a base64 string, or an ArrayBuffer, Uint8Array or Blob of file bytes.',
    );
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
 * Normalizes every supported input shape (URL, data URI, base64, ArrayBuffer,
 * Uint8Array, Blob/File) into either a URL or raw bytes for pdf.js.
 *
 * `allowedSources` restricts URL sources when a host app renders sources it did
 * not author; byte inputs are always accepted, since the app handed them over.
 */
export async function normalizeSource(
  src: PdfSource,
  options?: { allowedSources?: readonly string[] },
): Promise<NormalizedSource> {
  const check = (url: string): NormalizedSource => {
    const { allowedSources } = options ?? {};
    if (allowedSources && !isAllowedSource(resolveSourceUrl(url), allowedSources)) {
      throw new Error(`Refused to load ${url}: it is not listed in allowedSources.`);
    }
    return { kind: 'url', url };
  };

  if (typeof src === 'string') {
    if (src.startsWith('data:')) {
      const res = await fetch(src);
      if (!res.ok) throw new Error(`Failed to resolve data URI (status ${res.status})`);
      return { kind: 'data', data: new Uint8Array(await res.arrayBuffer()) };
    }
    const normalized = classifyString(src);
    return normalized.kind === 'url' ? check(normalized.url) : normalized;
  }
  if (src instanceof Uint8Array) return { kind: 'data', data: src };
  if (src instanceof ArrayBuffer) return { kind: 'data', data: new Uint8Array(src) };
  if (typeof Blob !== 'undefined' && src instanceof Blob) {
    return { kind: 'data', data: new Uint8Array(await src.arrayBuffer()) };
  }
  throw new TypeError('Unsupported PDF source: expected string, ArrayBuffer, Uint8Array, or Blob');
}
