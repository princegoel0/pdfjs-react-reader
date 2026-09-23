import { FormsExample } from '../examples/FormsExample';

const PROPS: [string, string, string][] = [
  ['src', 'PdfSource', 'Required. URL, File, Blob, Uint8Array, or a ranged source object.'],
  ['workerSrc', 'string', 'Pins the pdf.js worker location. Auto-detected when omitted.'],
  ['defaultScale', 'number | "fit-width" | "fit-page"', 'Initial zoom. 1 = 100%.'],
  ['defaultLayout', '"continuous" | "single" | "spread"', 'Row grouping.'],
  ['defaultRotation', 'number', 'Initial rotation in degrees; the toolbar rotates from here.'],
  ['defaultSidebarOpen', 'boolean', 'Show the thumbnails/outline sidebar on first render.'],
  ['gap', 'number', 'Vertical gap between pages in CSS pixels.'],
  ['renderForms', 'boolean', 'Render interactive AcroForm widgets. Defaults to true.'],
  ['enablePrint', 'boolean', 'Show the print control and bind Ctrl/Cmd+P. Defaults to true, never on iOS.'],
  ['printScale', 'number', 'Print canvas scale. Auto-tuned against a memory budget by default.'],
  ['enableDownload', 'boolean', 'Show the download control. Defaults to true.'],
  ['downloadFileName', 'string', 'Name for the saved file; defaults to the document name.'],
  ['onFormValuesChange', '(values) => void', 'Fires whenever the user edits a form field.'],
  ['onPasswordRequired', '(submit, reason) => void', 'Encrypted document. Supplying it replaces the built-in prompt.'],
  ['onError', '(error) => void', 'Loading and per-page render failures.'],
  ['className / style', 'string / CSSProperties', 'Applied to the viewer root — the theming override point.'],
];

export function Shell() {
  return (
    <>
      <h1>The viewer shell</h1>
      <p className="doc-lede">
        <code>PdfViewer</code> is the whole product in one element: toolbar, sidebar, search, ink,
        printing, download and virtualized pages. It is uncontrolled by design — it owns its own
        state and tells you what changed through callbacks.
      </p>

      <pre>
        <code>{`import { PdfViewer } from 'pdfjs-react-reader';
import 'pdfjs-react-reader/styles.css';

export function Viewer() {
  return <PdfViewer src="/contract.pdf" defaultScale="fit-width" />;
}`}</code>
      </pre>

      <h2>Props</h2>
      <table className="doc-table">
        <thead>
          <tr>
            <th>Prop</th>
            <th>Type</th>
            <th>Notes</th>
          </tr>
        </thead>
        <tbody>
          {PROPS.map(([name, type, note]) => (
            <tr key={name}>
              <td>
                <code>{name}</code>
              </td>
              <td>
                <code>{type}</code>
              </td>
              <td>{note}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <h2>Forms</h2>
      <p>
        Widget edits land in pdf.js annotation storage, so printing and{' '}
        <code>saveDocument()</code> carry them. <code>onFormValuesChange</code> gives you the whole
        field map whenever one changes.
      </p>
      <FormsExample />

      <h2>Keyboard</h2>
      <table className="doc-table">
        <thead>
          <tr>
            <th>Shortcut</th>
            <th>Action</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>
              <code>Ctrl/Cmd + F</code>
            </td>
            <td>Open search. Scoped to the viewer, so the host page keeps its own behaviour.</td>
          </tr>
          <tr>
            <td>
              <code>Ctrl/Cmd + P</code>
            </td>
            <td>Print the document, when enabled.</td>
          </tr>
          <tr>
            <td>
              <code>Escape</code>
            </td>
            <td>Close the overflow menu, then the search bar, then the sidebar.</td>
          </tr>
          <tr>
            <td>
              <code>Enter</code>
            </td>
            <td>In search, run immediately instead of waiting for the debounce.</td>
          </tr>
        </tbody>
      </table>

      <h2>How the toolbar behaves</h2>
      <p>
        The bar is not built from fixed breakpoints. Every control carries a priority, the toolbar
        measures the natural width of each one, and it folds the least useful control into the{' '}
        <code>⋯</code> menu as space runs out — so the page field and zoom survive down to a 320 px
        container while print, download and layout give way first. Nothing is ever hidden while
        there is room for it, and the menu lists what each control does rather than showing bare
        glyphs.
      </p>
      <p>
        Control <em>size</em> follows the input device instead of the width: 44 px targets under{' '}
        <code>(pointer: coarse)</code>, 32 px on a mouse. A narrow desktop window therefore keeps
        the dense layout, and a landscape tablet gets finger-sized targets.
      </p>

      <h2>Encrypted documents</h2>
      <p>
        Without a handler, the viewer renders its own password prompt and re-prompts when the
        answer is wrong. Pass <code>onPasswordRequired</code> to own that UI; call{' '}
        <code>submit(password)</code> to continue or <code>submit(new Error())</code> to abort,
        which surfaces as a normal load error.
      </p>
      <pre>
        <code>{`<PdfViewer
  src={encrypted}
  onPasswordRequired={(submit, reason) => {
    const password = window.prompt(reason === 'incorrect-password' ? 'Wrong password, try again' : 'Password');
    if (password === null) submit(new Error('cancelled'));
    else submit(password);
  }}
/>`}</code>
      </pre>

      <h2>Building your own chrome</h2>
      <p>
        The shell is assembled from exported parts — <code>Toolbar</code>, <code>SearchBox</code>,{' '}
        <code>Sidebar</code>, <code>ThumbnailList</code>, <code>OutlineView</code>,{' '}
        <code>PdfPage</code>, <code>InkLayer</code>, <code>PasswordPrompt</code> — so you can
        compose them differently without dropping to raw hooks. Read{' '}
        <code>src/components/PdfViewer.tsx</code> for the wiring.
      </p>
    </>
  );
}
