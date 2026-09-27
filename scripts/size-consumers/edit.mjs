import { createElement } from 'react';
import { PdfViewer } from '../../dist/index.js';
import { editFeature } from '../../dist/edit.js';

/** The tier that pulls in the optional PDF writer. */
export const View = () =>
  createElement(PdfViewer, { src: '/a.pdf', features: [editFeature] });
