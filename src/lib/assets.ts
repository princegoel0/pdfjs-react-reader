import { version as pdfjsVersion } from 'pdfjs-dist';

/**
 * Where pdf.js fetches its support assets: cMaps for CJK text, the standard
 * font files, and the decoders that run as WebAssembly.
 *
 * `'cdn'` is the only value with a default location. Everything else has to be
 * a path the consumer serves, because pdf.js looks these files up by name at
 * runtime — a bundler cannot help, since it only emits the files it can see as
 * literal specifiers, and it renames them on the way out. Copying the folders
 * into the site's own static directory is the portable answer, and the reason
 * this accepts a plain root: `assetUrl: '/pdfjs-dist/'`.
 */
export type AssetUrl = 'cdn' | (string & {});

export interface PdfAssetUrls {
  cMapUrl: string;
  standardFontDataUrl: string;
  wasmUrl: string;
}

/**
 * unpkg pinned to the engine version in use, which is the only version whose
 * asset files match the code reading them.
 */
export const CDN_ASSET_ROOT = `https://unpkg.com/pdfjs-dist@${pdfjsVersion}/`;

/** pdf.js concatenates these with the file name, and throws on a base without one. */
export function withTrailingSlash(root: string): string {
  return root.endsWith('/') ? root : `${root}/`;
}

export function assetUrlsFor(root: string): PdfAssetUrls {
  const base = withTrailingSlash(root);
  return {
    cMapUrl: `${base}cmaps/`,
    standardFontDataUrl: `${base}standard_fonts/`,
    wasmUrl: `${base}wasm/`,
  };
}

function documentBase(): string | null {
  const g = globalThis as typeof globalThis & {
    document?: { baseURI?: string };
    location?: { href?: string };
  };
  return g.document?.baseURI ?? g.location?.href ?? null;
}

/**
 * Turns an `assetUrl` into the root the folders are looked up under.
 *
 * A relative root is made absolute here rather than left for pdf.js: the cMaps
 * are fetched inside the worker, whose own URL is a different base from the
 * page, so a bare `vendor/pdfjs/` would resolve against the wrong document.
 */
export function resolveAssetRoot(assetUrl?: AssetUrl): string {
  if (!assetUrl || assetUrl === 'cdn') return CDN_ASSET_ROOT;
  const root = withTrailingSlash(assetUrl);
  const base = documentBase();
  if (!base) return root;
  try {
    return new URL(root, base).href;
  } catch {
    return root;
  }
}

/** The `getDocument` parameters for an `assetUrl`. */
export function pdfAssetUrls(assetUrl?: AssetUrl): PdfAssetUrls {
  return assetUrlsFor(resolveAssetRoot(assetUrl));
}
