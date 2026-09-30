/**
 * Reading the files a document carries.
 *
 * `PDFDocumentProxy#getAttachments()` returns a **Map** in pdf.js 6 and a plain
 * object in 5.x, both keyed by the name that `getAttachmentContent(id)` later
 * takes, so one reader accepts either shape. The peer range admits 6.x only
 * (`^6.2.108`) — the 5.x branch is tolerated, not supported: it keeps a host who
 * forces an older engine from mis-reading the list, and nothing else about that
 * engine is verified here. Content is deliberately not read here: fetching every
 * attachment to learn its size would hold a document's whole payload in memory to
 * label a list.
 */

export interface AttachmentInfo {
  /** The key `getAttachmentContent` expects, which is the name in the file-spec tree. */
  id: string;
  filename: string;
  description?: string;
  /**
   * Bytes the engine handed over with the list. pdf.js 5.x embeds every attachment's
   * content in the `getAttachments()` map and has no way to ask for one later; 6.x
   * returns metadata only and adds `getAttachmentContent()`. Carrying the field means
   * neither version needs a special case at the call site.
   */
  content?: Uint8Array;
}

function bytes(value: unknown): Uint8Array | undefined {
  return value instanceof Uint8Array && value.length > 0 ? value : undefined;
}

function text(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed || undefined;
}

export function normalizeAttachments(source: unknown): AttachmentInfo[] {
  const entries: [string, unknown][] =
    source instanceof Map
      ? [...source.entries()]
      : source && typeof source === 'object'
        ? Object.entries(source as Record<string, unknown>)
        : [];

  return entries
    .map(([id, raw]) => {
      const fields = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
      const filename = text(fields.filename) ?? text(fields.rawFilename) ?? id;
      const description = text(fields.description);
      const content = bytes(fields.content);
      const info: AttachmentInfo = { id, filename };
      if (description) info.description = description;
      if (content) info.content = content;
      return info;
    })
    .sort((a, b) => a.filename.localeCompare(b.filename, 'en') || a.id.localeCompare(b.id, 'en'));
}

/** The MIME type a saved copy should claim, from the extension rather than the PDF's `/Subtype`. */
const MIME_BY_EXTENSION: Record<string, string> = {
  csv: 'text/csv',
  json: 'application/json',
  txt: 'text/plain',
  xml: 'text/xml',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  zip: 'application/zip',
  pdf: 'application/pdf',
};

export function attachmentMimeType(filename: string): string | undefined {
  const dot = filename.lastIndexOf('.');
  if (dot < 0) return undefined;
  return MIME_BY_EXTENSION[filename.slice(dot + 1).toLowerCase()];
}
