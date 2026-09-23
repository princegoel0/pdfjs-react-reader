/** A download name that is safe to hand to the OS and always ends in `.pdf`. */
export function pdfFileName(label: string | undefined | null, fallback = 'document'): string {
  const cleaned = (label ?? '')
    .trim()
    // Characters Windows rejects; everything else is a legitimate title.
    .replace(/[\\/:*?"<>|]/g, ' ')
    .replace(/\.pdf$/i, '');
  return `${cleaned || fallback}.pdf`;
}

/**
 * FR-20: hand bytes to the browser's save dialog.
 *
 * The anchor has to be in the document for Firefox to honour the click, and the
 * object URL is revoked on a later task — revoking synchronously can cancel the
 * download before the browser has read the blob.
 */
export function downloadBytes(bytes: Uint8Array | ArrayBuffer, fileName: string): void {
  // `Uint8Array<ArrayBufferLike>` is not a `BlobPart` as far as TypeScript is
  // concerned (the buffer might be shared), while Blob only ever copies bytes.
  const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: 'application/pdf' }));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = fileName;
  anchor.rel = 'noopener';
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}
