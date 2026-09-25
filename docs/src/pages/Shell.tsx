import { FormsExample } from '../examples/FormsExample';

const PROPS: [string, string, string][] = [
  ['src', 'PdfSource', 'Required. URL, File, Blob, Uint8Array, or a ranged source object. Changing it reloads in place — keep the value stable across renders.'],
  ['workerSrc', 'string', 'Pins the pdf.js worker location. Auto-detected when omitted.'],
  ['defaultScale', 'number | "fit-width" | "fit-page"', 'Initial zoom. 1 = 100%. Any percentage is accepted, not just the presets.'],
  ['defaultLayout', '"continuous" | "single" | "spread"', 'Row grouping.'],
  ['defaultRotation', 'number', 'Initial rotation in degrees; the toolbar rotates from here.'],
  ['defaultPageRotations', 'Record<number, number>', 'Per-page rotation in degrees, keyed by 0-based page index.'],
  ['defaultSidebarOpen', 'boolean', 'Show the thumbnails/outline sidebar on first render.'],
  ['gap', 'number', 'Vertical gap between pages in CSS pixels.'],
  ['renderForms', 'boolean', 'Render interactive AcroForm widgets. Defaults to true.'],
  ['enablePrint', 'boolean', 'Show the print control and bind Ctrl/Cmd+P. Defaults to true, never on iOS.'],
  ['printScale', 'number', 'Print canvas scale. Auto-tuned against a memory budget by default.'],
  ['enableDownload', 'boolean', 'Show the download control. Defaults to true.'],
  ['downloadFileName', 'string', 'Name for the saved file; defaults to the document name.'],
  ['enableWheelZoom', 'boolean', 'Ctrl/Cmd + wheel, which is also how browsers report trackpad pinch. Defaults to true.'],
  ['enablePinchZoom', 'boolean', 'Two-finger pinch through the engine’s touch manager. Defaults to true.'],
  ['enableFullscreen', 'boolean', 'Show the fullscreen control, and only where the platform supports it. Defaults to true.'],
  ['enableKeyboardNavigation', 'boolean', 'Arrow / PageUp / PageDown / Home / End paging. Defaults to true.'],
  ['enableDrop', 'boolean', 'Open a dropped PDF in place of src. Off by default.'],
  ['acceptDrop', '(file) => boolean', 'Gate which dropped files count. Defaults to any PDF.'],
  ['onDropFile', '(file) => void', 'Fires for every accepted drop, even when enableDrop is off.'],
  ['labels', 'PdfViewerLabelsOverride', 'Override any subset of the shell’s strings; everything else keeps its English default.'],
  ['onFormValuesChange', '(values) => void', 'Fires whenever the user edits a form field.'],
  ['onPageChange', '(page) => void', 'The topmost visible page, after load.'],
  ['onScaleChange', '(scale) => void', 'The effective zoom, including what a fit mode resolves to.'],
  ['onLayoutChange', '(layout) => void', 'The layout mode.'],
  ['onFullscreenChange', '(active) => void', 'Follows the real element, so Escape counts too.'],
  ['onExternalLink', '(url) => void', 'Clicks on external links: navigation is prevented and the URL comes here.'],
  ['onPasswordRequired', '(submit, reason) => void', 'Encrypted document. Supplying it replaces the built-in prompt.'],
  ['onError', '(error) => void', 'Loading and per-page render failures.'],
  ['className / style', 'string / CSSProperties', 'Applied to the viewer root — the theming override point.'],
];

const HANDLE: [string, string][] = [
  ['goToPage(page)', 'Scrolls to a 1-based page.'],
  ['zoomTo(scale)', 'Sets an absolute factor, clamped to 25–500%.'],
  ['zoomBy(factor)', 'Multiplies the zoom currently on screen.'],
  ['fitTo(mode)', 'Switches to "width" or "page".'],
  ['setLayout(layout)', 'continuous, single or spread.'],
  ['rotate(degrees)', 'Rotates the whole document.'],
  ['rotatePage(page, degrees)', 'Rotates one page in place.'],
  ['openSidebar(open, tab?)', 'Opens the sidebar on thumbnails or outline.'],
  ['toggleFullscreen()', 'Needs a user gesture, like every fullscreen request.'],
  ['search(query, options?)', 'Runs a search and reveals the search bar.'],
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

      <h2>Driving it from code</h2>
      <p>
        The shell stays uncontrolled — it owns zoom, scroll and layout — but it takes a ref so a
        host that needs to act on the document still can. Every method reads through a ref, so the
        handle you get on mount never goes stale.
      </p>
      <pre>
        <code>{`import { useRef } from 'react';
import { PdfViewer, type PdfViewerHandle } from 'pdfjs-react-reader';

export function Viewer() {
  const viewer = useRef<PdfViewerHandle>(null);

  return (
    <>
      <PdfViewer
        ref={viewer}
        src="/contract.pdf"
        onPageChange={(page) => console.log('page', page)}
        onScaleChange={(scale) => console.log('zoom', scale)}
      />
      <button onClick={() => viewer.current?.goToPage(12)}>Go to the schedule</button>
      <button onClick={() => viewer.current?.search('indemnity')}>Find a clause</button>
    </>
  );
}`}</code>
      </pre>
      <table className="doc-table">
        <thead>
          <tr>
            <th>Method</th>
            <th>Notes</th>
          </tr>
        </thead>
        <tbody>
          {HANDLE.map(([name, note]) => (
            <tr key={name}>
              <td>
                <code>{name}</code>
              </td>
              <td>{note}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <h2>Events</h2>
      <p>
        <code>onPageChange</code>, <code>onScaleChange</code>, <code>onLayoutChange</code> and{' '}
        <code>onFullscreenChange</code> report what the user did, so none of them fires while the
        document is still loading — a fit mode resolving to 87&nbsp;% on first paint is not a change
        anybody asked for. <code>onExternalLink</code> is the exception worth knowing about: when it
        is set, the viewer prevents the browser’s own navigation and hands you the URL, because a
        viewer embedded in someone else’s app should not decide on its own whether a link is safe to
        follow.
      </p>

      <h2>Gestures</h2>
      <p>
        Ctrl/Cmd + wheel zooms — which is also exactly how a browser reports a trackpad pinch — and
        two fingers on a touchscreen pinch through the engine’s own touch manager. The wheel listener
        is registered natively with <code>passive: false</code>, because React attaches its own
        <code> onWheel</code> passively and <code>preventDefault()</code> there is a silent no-op:
        the page would scroll while you zoomed. Plain wheel is left alone, so ordinary scrolling
        still works at every zoom level.
      </p>
      <p>
        Drag-and-drop is off by default for the same reason the shell never navigates: a viewer whose
        document is controlled by the host app must not swap it out behind the app’s back. Turn it on
        with <code>enableDrop</code>, or leave it off and use <code>onDropFile</code> to drive the
        change yourself. <code>acceptDrop</code> gates which files count.
      </p>

      <h2>Labels</h2>
      <p>
        Every string in the shell — about ninety of them, from <code>aria-label</code>s to the
        “3 of 416 · p12” counter — lives in one typed catalog with an English default. Pass a partial
        object and only the keys you name change:
      </p>
      <pre>
        <code>{`import { PdfViewer, type PdfViewerLabelsOverride } from 'pdfjs-react-reader';

const de: PdfViewerLabelsOverride = {
  nextPage: 'Nächste Seite',
  pageOf: 'Seite {page} von {total}',
};

<PdfViewer src="/vertrag.pdf" labels={de} />`}</code>
      </pre>
      <p>
        Values are templates, not functions, so a catalog can be plain JSON when locales arrive. Slots
        that are left unfilled stay visible (<code>Go to page {'{page}'}</code>) rather than blanking
        a control’s accessible name, and <code>formatLabel</code> is exported for your own chrome.
      </p>

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
              <code>↓ / PageDown</code>
            </td>
            <td>Next page.</td>
          </tr>
          <tr>
            <td>
              <code>↑ / PageUp</code>
            </td>
            <td>Previous page. Horizontal arrows are deliberately untouched: at high zoom the
            viewport scrolls sideways and those keys are the only way to reach the rest of the row.</td>
          </tr>
          <tr>
            <td>
              <code>Home / End</code>
            </td>
            <td>First and last page.</td>
          </tr>
          <tr>
            <td>
              <code>F</code>
            </td>
            <td>Toggle fullscreen, where the platform supports it.</td>
          </tr>
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
      <p>
        All of it steps aside when the keystroke belongs to something else: a focused field —
        including an AcroForm text box, which the engine renders as a real{' '}
        <code>input</code> inside the page — keeps its own caret behaviour, and any modified chord is
        left to the host.
      </p>

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
