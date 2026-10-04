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
 *
 * And the name tree is not the whole list. A `FileAttachment` annotation can carry its own filespec, and
 * `getAttachments()` does not report it — see `collectAnnotationAttachments`, which is the second half of the
 * same read and is why this module is not one function.
 */
import type { PDFDocumentProxy } from 'pdfjs-dist';

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

/**
 * The files a page carries in its own annotations rather than in the catalog's name tree — FR-25's last
 * sentence, which the engine does not do for us.
 *
 * Measured against `attachments-ocg-sample.pdf` on `pdfjs-dist` 6.3.289: `getAttachments()` answers the three
 * files the `/EmbeddedFiles` tree names and *nothing else*, while the `FileAttachment` annotation on page 2
 * reports `file: {filename, description}` and a `fileId` of `attachmentRef:23R` that `getAttachmentContent()`
 * reads back byte-exact. So the name tree and the annotations are two addresses for the same kind of thing, and
 * a viewer that only ever reads the first one silently hides a file the reader can see, click, and be told the
 * description of. `src/lib/attachments.fixture.test.ts` is that measurement, as a gate.
 *
 * Contents are still not read here: pdf.js hands annotation `file` data as metadata only, which is what lets a
 * document with a paperclip on page 400 be listed without fetching what is behind it. The cost is one
 * `getAnnotations()` per page, so the caller decides when to pay it — the attachments panel, not the load.
 */
export async function collectAnnotationAttachments(
  doc: PDFDocumentProxy,
  signal?: AbortSignal,
): Promise<AttachmentInfo[]> {
  const found: AttachmentInfo[] = [];
  for (let pageNumber = 1; pageNumber <= doc.numPages; pageNumber++) {
    // Checked per page for the same reason the search index checks per page: this is a loop whose length is a
    // property of the document rather than of the caller's patience.
    if (signal?.aborted) break;
    const page = await doc.getPage(pageNumber);
    const annotations = await page.getAnnotations({ intent: 'any' });
    for (const annotation of annotations as readonly Record<string, unknown>[]) {
      if (annotation.subtype !== 'FileAttachment') continue;
      const file = annotation.file as Record<string, unknown> | undefined;
      if (!file) continue;
      const filename = text(file.filename) ?? text(file.rawFilename);
      if (!filename) continue;
      // The annotation's own address, not the filename: that is the key this engine's `getAttachmentContent`
      // takes for a file the name tree never heard of.
      const id = text(annotation.fileId) ?? filename;
      const description = text(file.description);
      const content = bytes(file.content);
      const info: AttachmentInfo = { id, filename };
      if (description) info.description = description;
      if (content) info.content = content;
      found.push(info);
    }
  }
  return found;
}

/**
 * One list out of the catalog's files and the pages' files, each file appearing once.
 *
 * Deduplicated by file name rather than by id, because the same `/Filespec` reached through the name tree and
 * through an annotation has two different addresses and one name. The name-tree entry wins where both exist: its
 * id is the name a host would recognise, and on the 5.x line it is the one that carries the bytes inline.
 */
export function mergeAttachments(...sources: AttachmentInfo[][]): AttachmentInfo[] {
  const byFilename = new Map<string, AttachmentInfo>();
  for (const source of sources) {
    for (const info of source) {
      const key = info.filename.toLowerCase();
      const held = byFilename.get(key);
      if (!held) byFilename.set(key, info);
      // A carried file with a `/Desc` and a named file without one is still one file, and the description is
      // the part a reader needs; keep it without inventing an id for it.
      else if (!held.description && info.description) byFilename.set(key, { ...held, description: info.description });
    }
  }
  return [...byFilename.values()].sort(
    (a, b) => a.filename.localeCompare(b.filename, 'en') || a.id.localeCompare(b.id, 'en'),
  );
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
