import { createElement } from 'react';
import { PdfViewer } from '../../dist/index.js';
import { editFeature } from '../../dist/edit.js';
import { annotateFeature } from '../../dist/features/annotate.js';
import { attachmentsFeature } from '../../dist/features/attachments.js';
import { downloadFeature } from '../../dist/features/download.js';
import { formsFeature } from '../../dist/features/forms.js';
import { layersFeature } from '../../dist/features/layers.js';
import { outlineFeature } from '../../dist/features/outline.js';
import { printFeature } from '../../dist/features/print.js';

/** Everything this package ships in its own UI layer. */
export const View = () =>
  createElement(PdfViewer, {
    src: '/a.pdf',
    features: [
      printFeature,
      downloadFeature,
      formsFeature,
      outlineFeature,
      layersFeature,
      annotateFeature,
      attachmentsFeature,
      editFeature,
    ],
  });
