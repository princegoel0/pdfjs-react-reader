import { createElement } from 'react';
import { PdfViewer } from '../../dist/index.js';
import { downloadFeature } from '../../dist/features/download.js';

export const View = () =>
  createElement(PdfViewer, { src: '/a.pdf', features: [downloadFeature] });
