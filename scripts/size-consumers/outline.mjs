import { createElement } from 'react';
import { PdfViewer } from '../../dist/index.js';
import { outlineFeature } from '../../dist/features/outline.js';

export const View = () =>
  createElement(PdfViewer, { src: '/a.pdf', features: [outlineFeature] });
