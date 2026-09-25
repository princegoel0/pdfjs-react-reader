import { createElement } from 'react';
import { PdfViewer } from '../../dist/index.js';

/** The shell with nothing opted in: pages, text, search, ink, chrome. */
export const View = () => createElement(PdfViewer, { src: '/a.pdf' });
