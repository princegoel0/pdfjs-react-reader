import { createElement } from 'react';
import { PdfViewer } from '../../dist/index.js';
import { printFeature } from '../../dist/features/print.js';

export const View = () => createElement(PdfViewer, { src: '/a.pdf', features: [printFeature] });
