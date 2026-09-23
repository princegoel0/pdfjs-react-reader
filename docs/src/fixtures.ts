/* The fixture PDFs are served from the docs' public dir (see vite.config.ts).
   Prefixing `BASE_URL` is what makes them resolve when the site is deployed
   under a repository subpath — set `DOCS_BASE=/pdfjs-react-reader/` for that. */
const asset = (name: string) => `${import.meta.env.BASE_URL}${name}`;

export const FORM_SAMPLE = asset('form-sample.pdf');
export const OUTLINE_SAMPLE = asset('outline-sample.pdf');
export const ENCRYPTED_SAMPLE = asset('encrypted-sample.pdf');

export const SAMPLES = [
  { label: 'Form (2 pages)', value: FORM_SAMPLE },
  { label: 'Outline (3 pages)', value: OUTLINE_SAMPLE },
  { label: 'Encrypted — password "secret"', value: ENCRYPTED_SAMPLE },
];
