export type PdfSource = string | ArrayBuffer | Uint8Array | Blob;

/** Result of normalization: either a URL pdf.js fetches itself, or raw bytes. */
export type NormalizedSource = { kind: 'url'; url: string } | { kind: 'data'; data: Uint8Array };

const URL_LIKE_RE = /^(https?:\/\/|blob:|file:|data:|\/|\.\/|\.\.\/)/i;
const BASE64_RE = /^[A-Za-z0-9+/]+={0,2}$/;

function base64ToBytes(base64: string): Uint8Array {
  const binary = atob(base64.replace(/\s/g, ''));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

function classifyString(src: string): NormalizedSource {
  const trimmed = src.trim();
  if (URL_LIKE_RE.test(trimmed) || /\.pdf($|[?#])/i.test(trimmed)) {
    return { kind: 'url', url: trimmed };
  }
  const compact = trimmed.replace(/\s/g, '');
  // Heuristic: a long pure-base64 string with no URL characters is treated as base64.
  if (compact.length >= 128 && BASE64_RE.test(compact) && compact.length % 4 === 0) {
    return { kind: 'data', data: base64ToBytes(compact) };
  }
  return { kind: 'url', url: trimmed };
}

/**
 * Normalizes every supported input shape (URL, data URI, base64, ArrayBuffer,
 * Uint8Array, Blob/File) into either a URL or raw bytes for pdf.js.
 */
export async function normalizeSource(src: PdfSource): Promise<NormalizedSource> {
  if (typeof src === 'string') {
    if (src.startsWith('data:')) {
      const res = await fetch(src);
      if (!res.ok) throw new Error(`Failed to resolve data URI (status ${res.status})`);
      return { kind: 'data', data: new Uint8Array(await res.arrayBuffer()) };
    }
    return classifyString(src);
  }
  if (src instanceof Uint8Array) return { kind: 'data', data: src };
  if (src instanceof ArrayBuffer) return { kind: 'data', data: new Uint8Array(src) };
  if (typeof Blob !== 'undefined' && src instanceof Blob) {
    return { kind: 'data', data: new Uint8Array(await src.arrayBuffer()) };
  }
  throw new TypeError('Unsupported PDF source: expected string, ArrayBuffer, Uint8Array, or Blob');
}
