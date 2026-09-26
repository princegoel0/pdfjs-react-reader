import { createElement } from 'react';
import { PdfViewer } from '../../dist/index.js';
import { annotateFeature } from '../../dist/features/annotate.js';

export const View = () =>
  createElement(PdfViewer, { src: '/a.pdf', features: [annotateFeature] });
