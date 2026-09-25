import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { GlobalWorkerOptions } from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import { App } from './App';
import 'pdfjs-react-reader/styles.css';
import './docs.css';

// The examples here run against a production build, where a bare
// `new URL('pdfjs-dist/…', import.meta.url)` cannot resolve and pdf.js drops to
// its main-thread fake worker. `?url` is the bundler-safe form.
GlobalWorkerOptions.workerSrc = workerUrl;

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
