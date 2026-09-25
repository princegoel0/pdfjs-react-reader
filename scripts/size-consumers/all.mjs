import { createElement } from 'react';
import { PdfViewer } from '../../dist/index.js';
import { downloadFeature } from '../../dist/features/download.js';
import { formsFeature } from '../../dist/features/forms.js';
import { outlineFeature } from '../../dist/features/outline.js';
import { printFeature } from '../../dist/features/print.js';

/** Everything this package ships in its own UI layer. */
export const View = () =>
  createElement(PdfViewer, {
    src: '/a.pdf',
    features: [printFeature, downloadFeature, formsFeature, outlineFeature],
  });
