import { createElement } from 'react';
import { PdfViewer } from '../../dist/index.js';
import { structureFeature } from '../../dist/features/structure.js';

/**
 * The structure tier, measured as a gate rather than as code: everything it costs to bundle is the
 * `import('pdfjs-dist/web/pdf_viewer.mjs')` specifier the bundler is told to leave alone, because what it
 * points at is fetched at runtime and only for a document that declared a structure tree.
 */
export const View = () =>
  createElement(PdfViewer, { src: '/a.pdf', features: [structureFeature] });
