import { describe, expect, it, vi } from 'vitest';

// pdf.js touches DOM globals at import time, which the node test environment
// does not provide. assets.ts only needs the engine version for its CDN root.
vi.mock('pdfjs-dist', () => ({ version: '9.9.9' }));

const { CDN_ASSET_ROOT, assetUrlsFor, pdfAssetUrls, resolveAssetRoot, withTrailingSlash } =
  await import('./assets');

describe('asset roots', () => {
  it('pins the CDN root to the engine version', () => {
    expect(CDN_ASSET_ROOT).toBe('https://unpkg.com/pdfjs-dist@9.9.9/');
    expect(resolveAssetRoot()).toBe(CDN_ASSET_ROOT);
    expect(resolveAssetRoot('cdn')).toBe(CDN_ASSET_ROOT);
    expect(resolveAssetRoot('')).toBe(CDN_ASSET_ROOT);
  });

  it('derives all three folder bases from one root', () => {
    expect(assetUrlsFor('https://example.com/pdfjs')).toEqual({
      cMapUrl: 'https://example.com/pdfjs/cmaps/',
      standardFontDataUrl: 'https://example.com/pdfjs/standard_fonts/',
      wasmUrl: 'https://example.com/pdfjs/wasm/',
    });
  });

  // pdf.js concatenates the base with the file name and throws otherwise.
  it('keeps every base slash-terminated', () => {
    expect(withTrailingSlash('a/b/')).toBe('a/b/');
    expect(withTrailingSlash('a/b')).toBe('a/b/');
    expect(Object.values(pdfAssetUrls('/pdfjs-dist')).every((url) => url.endsWith('/'))).toBe(true);
  });

  it('uses a self-hosted root verbatim', () => {
    expect(pdfAssetUrls('https://assets.example.com/p')).toEqual({
      cMapUrl: 'https://assets.example.com/p/cmaps/',
      standardFontDataUrl: 'https://assets.example.com/p/standard_fonts/',
      wasmUrl: 'https://assets.example.com/p/wasm/',
    });
  });
});

describe('relative roots', () => {
  const withBase = (baseURI: string, run: () => void) => {
    Reflect.set(globalThis, 'document', { baseURI });
    try {
      run();
    } finally {
      Reflect.deleteProperty(globalThis, 'document');
    }
  };

  it('resolves against the document, not the worker', () => {
    withBase('https://example.com/app/reports/index.html', () => {
      expect(resolveAssetRoot('vendor/pdfjs')).toBe('https://example.com/app/reports/vendor/pdfjs/');
      expect(resolveAssetRoot('/pdfjs-dist')).toBe('https://example.com/pdfjs-dist/');
      expect(resolveAssetRoot('../pdfjs')).toBe('https://example.com/app/pdfjs/');
    });
  });

  it('leaves a server-rendered relative root alone', () => {
    expect(resolveAssetRoot('/pdfjs-dist/')).toBe('/pdfjs-dist/');
  });

  it('passes through what URL cannot parse', () => {
    withBase('not a url', () => {
      expect(resolveAssetRoot('vendor/pdfjs')).toBe('vendor/pdfjs/');
      expect(resolveAssetRoot('https://cdn.example.com/pdfjs/')).toBe(
        'https://cdn.example.com/pdfjs/',
      );
    });
  });
});
