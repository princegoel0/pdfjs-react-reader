import { createElement } from 'react';
import { PdfViewer } from '../../dist/index.js';
import { attachmentsFeature } from '../../dist/features/attachments.js';

export const View = () =>
  createElement(PdfViewer, { src: '/a.pdf', features: [attachmentsFeature] });
