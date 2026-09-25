import { createElement } from 'react';
import { PdfViewer } from '../../dist/index.js';
import { formsFeature } from '../../dist/features/forms.js';

export const View = () => createElement(PdfViewer, { src: '/a.pdf', features: [formsFeature] });
