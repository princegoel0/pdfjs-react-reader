import { createElement } from 'react';
import { PdfViewer } from '../../dist/index.js';
import { layersFeature } from '../../dist/features/layers.js';

export const View = () =>
  createElement(PdfViewer, { src: '/a.pdf', features: [layersFeature] });
