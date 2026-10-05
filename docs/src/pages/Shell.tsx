import { FormsExample } from '../examples/FormsExample';
import { LabelsExample } from '../examples/LabelsExample';

const PROPS: [string, string, string][] = [
  ['src', 'PdfSource', 'Required. URL, path, data URI, base64, File/Blob, or PDF bytes. Changing it reloads in place — keep the value stable across renders.'],
  ['features', 'readonly PdfFeature[]', 'What this viewer can do beyond reading: printFeature, downloadFeature, formsFeature, outlineFeature, layersFeature, attachmentsFeature, annotateFeature, editFeature or one you wrote. Defaults to none — the code you do not import is code you do not ship.'],
  ['controls', 'ToolbarControls', 'The bar’s own contents: `hide` by id, `priorities` to change what folds first, `order` to place controls, `add` for ones you wrote. Feature control ids work here too.'],
  ['find', 'PdfFindController', 'Replace the finding strategy, keep the find bar. Any object shaped like `usePdfSearch`’s result works — a server-side index, a stemmed or fuzzy matcher. The marks, the counter and Enter/Shift+Enter all read your answers.'],
  ['workerSrc', 'string', 'Pins the pdf.js worker location. Auto-detected when omitted.'],
  ['assetUrl', "'cdn' | string", 'Root for cmaps/, standard_fonts/ and wasm/. Defaults to a version-pinned unpkg root; pass a directory you serve.'],
  ['allowedSources', 'readonly string[]', 'URLs a string src may point at: prefixes, bare origins, or same-origin paths. Unrestricted by default; pass ["*"] to say so out loud.'],
  ['httpHeaders', 'Record<string, string>', 'Request headers for a URL src — an `Authorization` bearer, a signed-URL token, a tenant id. Forwarded to the engine’s fetch verbatim, never logged and never echoed into an error. Read when a load starts, so an inline literal does not reload the document; reopen the URL to apply new ones.'],
  ['withCredentials', 'boolean', 'Send cookies and HTTP auth for a cross-origin URL src.'],
  ['rangeChunkSize', 'number', 'Bytes per range request; the engine’s default applies when omitted.'],
  ['disableRange', 'boolean', 'Fetch the whole file in one request instead of by byte range.'],
  ['disableStream', 'boolean', 'Turn off progressive streaming as the file arrives. Together with the row above, this is how a host on a metered or high-latency connection chooses whole-file download over progressive display.'],
  ['retry', 'RetryPolicy | false', 'Bounded retries for a load failure that can heal: three attempts, a 1 s first interval with full jitter, a 30 s ceiling. Every retryable attempt is reported, the last one included, with `willRetry: false` on it. `false` fails on the first error. A 401, a 403, a 404, a corrupt file and an encrypted document are never retried — resubmitting the same credentials is not a recovery.'],
  ['onRetryAttempt', '(info) => void', 'Fires before each wait with the attempt, the total, the delay and the status, so the UI can say “retrying (2 of 3)” instead of spinning.'],
  ['onProgress', '(report) => void', 'Bytes as they arrive. `percent` is null when the response did not say how long the file is — a chunked or gzipped body — rather than the `NaN` the engine reports. The shell draws no bar; this is the host’s channel.'],
  ['signal', 'AbortSignal', 'Stop the load from outside. Aborting runs exactly what an unmount would — the task is destroyed, the worker released, nothing reported as an error. Swapping the signal moves which signal we follow; it does not restart a load in progress.'],
  ['enableXfa', 'boolean', 'Render XFA forms. Defaults to true, which is what a dynamic XFA needs to have any content at all: the page is then painted from its own template by `XfaLayer` and the text layer steps aside, and a search marks that text like any other. Saving one back is not offered, and `Versions & compatibility` says exactly which half of that was measured.'],
  ['defaultScale', 'number | "fit-width" | "fit-page" | "automatic"', 'Initial zoom. 1 = 100%; any percentage from 25 to 500 is accepted, not just the presets. "automatic" fits a landscape page whole and a portrait one by width.'],
  ['defaultLayout', '"continuous" | "single" | "spread"', 'Row grouping.'],
  ['defaultRotation', 'number', 'Initial rotation in degrees; the toolbar rotates from here.'],
  ['defaultPageRotations', 'Record<number, number>', 'Per-page rotation in degrees, keyed by 0-based page index.'],
  ['defaultSidebarOpen', 'boolean', 'Show the sidebar on first render, on its first tab.'],
  ['gap', 'number', 'Vertical gap between pages in CSS pixels.'],
  ['maxRenderPixels', 'number', 'Area ceiling per page canvas in device pixels. Constrains the budget rather than replacing it: the ceiling used is the minimum of this, the viewport working set, the probed platform ceiling and pdf.js’s own limit, tightened for mobile — over it a browser paints a blank page rather than failing. Unset, the limit is that minimum without this term.'],
  ['capAreaFactor', 'number', 'The viewport working-set factor, as a percentage of the display’s own pixel count (§6.1’s “200 %, host-configurable” row). A constraint in one direction: below 200 tightens the area ceiling for a viewer that occupies part of the screen, above 200 is ignored, because lifting the working set is switching a ceiling off rather than tuning it. `renderBudget.capAreaFactor` reports the number that was used.'],
  ['devicePixelRatio', 'number', 'Device pixels per CSS pixel for page canvases. Unset, this is the live window.devicePixelRatio, re-read when the display changes; passing a number pins it and a monitor switch then repaints nothing.'],
  ['enableWheelZoom', 'boolean', 'Ctrl/Cmd + wheel, which is also how browsers report trackpad pinch. Defaults to true.'],
  ['enablePinchZoom', 'boolean', 'Two-finger pinch through the engine’s touch manager. Defaults to true.'],
  ['enableFullscreen', 'boolean', 'Show the fullscreen control, and only where the platform supports it. Defaults to true.'],
  ['enableKeyboardNavigation', 'boolean', 'Arrow / PageUp / PageDown / Home / End paging. Defaults to true.'],
  ['enableDrop', 'boolean', 'Open a dropped PDF in place of src. Off by default.'],
  ['acceptDrop', '(file) => boolean', 'Gate which dropped files count. Defaults to any PDF.'],
  ['onDropFile', '(file) => void', 'Fires for every accepted drop, even when enableDrop is off.'],
  ['labels', 'PdfViewerLabelsOverride', 'Override any subset of the shell’s strings; everything else keeps its English default.'],
  ['onCapabilities', '(capabilities) => void', 'What the opened document declares: form type, whether the pages came from XFA, whether it carries JavaScript.'],
  ['onPageChange', '(page) => void', 'The topmost visible page, after load.'],
  ['onScaleChange', '(scale) => void', 'The effective zoom, including what a fit mode resolves to.'],
  ['onLayoutChange', '(layout) => void', 'The layout mode.'],
  ['onFullscreenChange', '(active) => void', 'Follows the real element, so Escape counts too.'],
  ['onAnnotationChange', '(state) => void', "What the editor can do right now: `isEditing`, `isEmpty`, `canUndo`, `canRedo`, `canDelete`, `hasSelectedText`. Fires when the engine's own state differs from what it last reported, so it counts a keyboard delete as readily as a click. Gate a Save on `canUndo`, not `isEmpty`."],
  ['onExternalLink', '(url) => void', 'Clicks on external links: navigation is prevented and the URL comes here.'],
  ['onPasswordRequired', '(submit, reason) => void', 'Encrypted document. Supplying it replaces the built-in prompt.'],
  ['onError', '(error) => void', 'Loading and per-page render failures.'],
  ['className / style', 'string / CSSProperties', 'Applied to the viewer root — the theming override point.'],
];

const HANDLE: [string, string][] = [
  ['goToPage(page)', 'Scrolls to a 1-based page.'],
  ['zoomTo(scale)', 'Sets an absolute factor, clamped to 25–500%.'],
  ['zoomBy(factor)', 'Multiplies the zoom currently on screen.'],
  ['fitTo(mode)', 'Switches to "width", "page" or "automatic".'],
  ['setLayout(layout)', 'continuous, single or spread.'],
  ['rotate(degrees)', 'Rotates the whole document.'],
  ['rotatePage(page, degrees)', 'Rotates one page in place.'],
  ['retryPage(page)', 'Re-queues one 1-based page: its proxy is fetched again and it paints again. The published way back out of a page’s `error`, which is otherwise a state a mounted row never leaves.'],
  ['openSidebar(open, tab?)', 'Opens the sidebar. The tab argument is a string, and the only tabs that exist are the ones mounted: `thumbnails` is core, while `outline`, `layers`, `attachments` and the edit tier’s `edit` need their feature.'],
  ['toggleFullscreen()', 'Needs a user gesture, like every fullscreen request.'],
  ['search(query, options?)', 'Runs a search and reveals the search bar. `options` takes the same `caseSensitive`, `wholeWord` and `regex` flags the find bar exposes, and several words in one query means all of them on a page.'],
];


export function Shell() {
  return (
    <>
      <h1>The viewer shell</h1>
      <p className="doc-lede">
        <code>PdfViewer</code> is the whole product in one element: toolbar, sidebar, search and
        virtualized pages. What it can do <em>to</em> a document — print it, save it, fill it in — is
        a feature you import, so the viewer you ship is the viewer you named. It is uncontrolled by
        design: it owns its own state and tells you what changed through callbacks.
      </p>

      <pre>
        <code>{`import { PdfViewer } from 'pdfjs-react-reader';
import { printFeature } from 'pdfjs-react-reader/features/print';
import { downloadFeature } from 'pdfjs-react-reader/features/download';
import { formsFeature } from 'pdfjs-react-reader/features/forms';
import 'pdfjs-react-reader/styles.css';
import 'pdfjs-react-reader/print.css';
import 'pdfjs-react-reader/forms.css';

export function Viewer() {
  return (
    <PdfViewer
      src="/contract.pdf"
      defaultScale="fit-width"
      features={[printFeature, downloadFeature, formsFeature]}
    />
  );
}`}</code>
      </pre>

      <p>
        Reading only — pages, text, search, thumbnails, rotation, layout modes — needs nothing beyond{' '}
        <code>&lt;PdfViewer src=&hellip; /&gt;</code>. Each feature is a separate entry and a separate
        stylesheet, so leaving one out leaves its bytes and its rules out of your bundle.{' '}
        <a href="#/features">Features</a> covers them, including writing your own.
      </p>
      <p>
        Choosing a layout — continuous, one page at a time, a two-page spread — regroups the rows and moves
        nothing else. A page keeps its element through the switch, so at a fixed zoom no canvas is painted
        again and nothing the reader had done to a page is lost with it. In a fit mode the pages do repaint,
        and that is correct rather than wasteful: fitting two pages into one width is a different fit than
        fitting one.
      </p>

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
        A pinch and a two-finger pan are the same physical event until the distance between the
        fingers changes, and the engine claims the whole <code>touchmove</code> before it knows which
        one it is holding — so the viewer answers both: the span growing zooms, the midpoint travelling
        scrolls the document. Which half the engine answers varies across the advertised range: releases
        from <code>6.3</code> hand the pan back through <code>onPanning</code>, and the floor
        (<code>6.2.108</code>) has no such callback at all, so the package asks the installed class
        whether a pan it fires comes back — a probe, not a version comparison — and scrolls the
        container itself when it does not. The page area also declares <code>touch-action: pan-x pan-y</code> and{' '}
        <code>overscroll-behavior: contain</code>, which is the part a listener cannot settle: it tells
        the browser before the gesture starts that panning is the document’s and page zoom is not
        yours, and that running out of document does not chain into the host page.
      </p>
      <p>
        Nothing is registered on <code>window</code> or <code>document</code>, and a gesture the viewer
        takes is prevented but still allowed to bubble — <code>event.defaultPrevented</code> is how your
        own listener learns it was consumed, rather than never hearing about it. A surface that needs the
        finger outright asks for it in CSS rather than winning a race: the annotation feature's own sheet
        sets <code>touch-action: none</code> on its editor layer, which the browser reads before any
        listener runs. Every gesture has a route that is not a gesture: the zoom select and{' '}
        <code>zoomTo</code>/<code>zoomBy</code>, the arrow and page keys on the focused region, the
        sidebar’s own scroll, and a <code>src</code> that is yours to set — the drop is a convenience
        over that, not the only way to change document.
      </p>
      <p>
        Drag-and-drop is off by default for the same reason the shell never navigates: a viewer whose
        document is controlled by the host app must not swap it out behind the app’s back. Turn it on
        with <code>enableDrop</code>, or leave it off and use <code>onDropFile</code> to drive the
        change yourself. <code>acceptDrop</code> gates which files count.
      </p>

      <h2>Labels</h2>
      <p>
        Every string in the shell — 136 of them, from <code>aria-label</code>s to the
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
        Values are templates, not functions, so a catalog is plain data: it can be loaded from a
        server, diffed against the English source, and sent for translation without executing
        anything. Slots that are left unfilled stay visible (<code>Go to page {'{page}'}</code>)
        rather than blanking a control’s accessible name, and <code>formatLabel</code> is exported
        for your own chrome.
      </p>

      <h3>The shipped catalogs</h3>
      <p>
        Three complete languages ship with the package, one import each:
      </p>
      <pre>
        <code>{`import { PdfViewer } from 'pdfjs-react-reader';
import { DE_LABELS } from 'pdfjs-react-reader/locales/de';

<PdfViewer src="/vertrag.pdf" labels={DE_LABELS} />`}</code>
      </pre>
      <p>
        Each is typed as the whole <code>PdfViewerLabels</code> rather than the partial a host may
        send, so a string added to the English source stops that catalog building until it is
        answered too. They are separate entry points on purpose: German is 2.38 kB gzipped, and
        importing the viewer must not hand you a language you did not ask for. Replace one word of
        a shipped catalog the way you would override a default — <code>{`{ ...DE_LABELS, outlineTab: 'Inhaltsverzeichnis' }`}</code>.
      </p>
      <p>
        What is checked is completeness and the slots, not the prose: a test walks every key of the
        English catalog and asserts each language answers it, trims it, and carries exactly the{' '}
        <code>{'{page}'}</code>-style placeholders the English template does — a dropped slot being
        the one mistake a catalog can make that nothing else would ever notice. The wording itself
        has not been through a native speaker, and corrections are wanted.
      </p>
      <LabelsExample />

      <h2>Forms</h2>
      <p>
        Filling a form in is <a href="#/features">a feature</a>: mount <code>formsFeature</code> and the
        annotation layer renders AcroForm widgets against pdf.js storage, so printing and{' '}
        <code>saveDocument()</code> carry what the reader typed. Edits reach you through{' '}
        <code>createFormsFeature({'{ onChange }'})</code>, which fires with the whole field map whenever
        one changes; <code>downloadFeature</code> asks the same publication whether there is anything
        worth saving.
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
            <td>
              Print the document — <code>printFeature</code>&apos;s own binding, at whatever range its
              page selector is showing, so a reader who set “2–3” and reaches for the keyboard gets 2–3.
              A viewer without the feature leaves <code>Ctrl/Cmd + P</code> to the browser.
            </td>
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
        container while the feature controls and layout give way first. Nothing is ever hidden while
        there is room for it, and the menu lists what each control does rather than showing bare
        glyphs. A feature joins the same planner as the built-ins: it contributes items with priorities
        of its own and is folded by the same arithmetic, so adding three capabilities to a narrow
        viewer costs three menu entries, not a wrapped toolbar.
      </p>
      <p>
        Control <em>size</em> follows the input device instead of the width: 44 px targets under{' '}
        <code>(pointer: coarse)</code>, 32 px on a mouse. A narrow desktop window therefore keeps
        the dense layout, and a landscape tablet gets finger-sized targets.
      </p>
      <p>
        The page field shows what the page is <em>called</em>, which is not always its number. A document
        that declares a numbering — roman front matter, a body restarting at 1, an appendix prefixed{' '}
        <code>A-</code> — gets a text field holding that label, and accepts one back: typing{' '}
        <code>iii</code> goes to the third page, and a number that names no label still clamps to the
        document. An ordinary PDF sees none of this: the field stays a number input with its spinner,
        because <code>getPageLabels()</code> answered <code>null</code>. (This is the document’s own
        numbering, and has nothing to do with the <em>Labels</em> section above, which is the words the
        chrome is drawn in.)
      </p>

      <h2>Shaping the bar</h2>
      <p>
        Every control has an id, and <code>controls</code> speaks to the bar in those ids:{' '}
        <code>sidebar</code>, <code>prev</code>, <code>page</code>, <code>next</code>,{' '}
        <code>search</code>, <code>zoomOut</code>, <code>zoomCustom</code>,{' '}
        <code>zoomIn</code>, <code>fit</code>, <code>rotateCcw</code>, <code>rotateCw</code>,{' '}
        <code>rotatePage</code>, <code>fullscreen</code>, <code>layout</code>, <code>count</code>,{' '}
        <code>meta</code> — plus whatever id a mounted feature’s control declared, such as{' '}
        <code>print</code>, <code>print-pages</code> or <code>download</code>. An id that is not there
        is ignored, so a config written once behaves the same on a browser without fullscreen.
      </p>
      <pre>
        <code>{`import { PdfViewer } from 'pdfjs-react-reader';
import type { ToolbarItem } from 'pdfjs-react-reader';

const fullscreenToggle: ToolbarItem = {
  id: 'reading',
  priority: 9,
  label: 'Reading mode',
  node: <button type="button" onClick={toggleMode}>Mode</button>,
};

<PdfViewer
  src="/contract.pdf"
  features={[printFeature]}
  controls={{
    hide: ['search', 'meta'],         // gone from the bar and the menu
    priorities: { layout: 2 },       // now it folds with the zoom cluster
    order: ['search', 'page'],       // these two lead; the rest keep their places
    add: [fullscreenToggle],         // an id that exists replaces it in place
  }}
/>`}</code>
      </pre>
      <p>
        <code>priorities</code> and <code>order</code> are separate on purpose: priority decides what
        survives a narrow bar, order decides where a control sits while it is in it. An{' '}
        <code>add</code> that names an existing id replaces that control where it stands — so swapping
        one button does not move it to the end — and the overflow menu still groups by priority, which
        is what keeps the rotate arrows on one row.
      </p>
      <p>
        One limit worth stating: hiding <code>print</code> takes the control out of the bar, not out of
        your bundle. The feature is still mounted because you imported it; to stop it shipping, remove
        the import.
      </p>

      <h2>Finding things</h2>
      <p>
        The find bar searches the whole document, debounced, with stale runs cancelled. What a query
        <em> means</em> is worth stating because it is not the obvious thing: spaces split it into
        words and a page counts only when <strong>every</strong> word appears on it, which is the rule
        every other PDF viewer’s search box follows — <code>trace monkey</code> on the test document
        narrows 416 matches to 401 because the pages holding one word and not the other drop out.
        <code>Match case</code> and <code>Whole words only</code> do what they say.{' '}
        <code>Regular expression</code> (<code>.*</code>) switches off both the splitting and the
        escaping, so <code>^Trace-based</code> is an anchored pattern rather than nine characters with a
        caret in them.
      </p>
      <p>
        An expression that will not compile is reported as <strong>Invalid pattern</strong> in the
        error styling, not as “no results”, which would be a claim that the document was searched. And
        when the built-in strategy is not yours — a server index, a stemmed matcher, a synonym list —
        pass <code>find</code>: anything shaped like <code>usePdfSearch</code>’s result drives the bar,
        the marks and the page counter. The playground’s <em>host find results</em> checkbox does exactly
        that with a fixed three-match table, which is why it reports 3 where the engine finds 416.
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
        The shell is two things: a controller that owns every piece of state, and a layout that places
        the parts. Both are exported, so an arrangement that is not toolbar-on-top is a few lines of
        JSX rather than a fork:
      </p>
      <pre>
        <code>{`import {
  useViewerController,
  ViewerProvider,
  ViewerRoot,
  ViewerSidebar,
  ViewerToolbar,
  ViewerPages,
  useViewer,
  type PdfViewerHandle,
  type PdfViewerProps,
} from 'pdfjs-react-reader';
import { forwardRef, useImperativeHandle } from 'react';

export const ReadingView = forwardRef<PdfViewerHandle, PdfViewerProps>(function ReadingView(
  props,
  ref,
) {
  const controller = useViewerController(props);
  useImperativeHandle(ref, () => controller.handle, [controller.handle]);

  return (
    <ViewerProvider controller={controller}>
      <ViewerRoot>
        <div className="pjsr-body">
          <ViewerSidebar />
          <ViewerPages />
        </div>
        <ViewerToolbar />
      </ViewerRoot>
    </ViewerProvider>
  );
});`}</code>
      </pre>
      <p>
        <code>ViewerRoot</code> is the frame: the element that carries the theme tokens, the keyboard
        and drop handlers, and the mounted features’ <code>Runner</code>s — so print, download, forms,
        the outline panel, the annotation editors and the Pages tab work exactly as they do in the
        default layout.
        Your own components inside
        it read the same state with <code>useViewer()</code>, which is how a host-written page counter
        or a set of buttons needs no props passed to it. The built-in parts are held to the same rule:
        <code>ViewerToolbar</code>, <code>ViewerPages</code> and <code>ThumbnailList</code> take nothing
        but a starting width, <code>OutlineView</code> takes nothing at all — it reads the bookmark tree
        out of the outline tier’s publication in the same store — and <code>ViewerRoot</code> accepts a
        <code>className</code> and a <code>style</code> of yours on top of the controller’s own. Give
        <code>ViewerSidebar</code> children and it shows them with no tab strip, because a tab that
        selects nothing is a control that lies.
      </p>
      <p>
        One more thing <code>useViewer()</code> carries, added for the edit tier and general in shape:{' '}
        <code>replaceDocument(bytes, name?)</code>. It hands the viewer a whole new file as bytes and the
        viewer loads it in place — the page count, the labels and the pages themselves come from the new
        document, the label the download control saves under carries across unless a name is given, and
        per-page rotations clear, because a caller that rewrote the document wrote them into it. A change
        to the <code>src</code> prop, or a dropped file, wins over the replacement: the viewer never shows
        a document its props do not describe. That is what lets Apply put a reordered file on the screen
        without a remount, and it is there for any host with bytes of its own — a merge, a server-side
        edit, a decryption step.
      </p>
      <p>
        The controller also carries <code>status</code>, which is the same published document model the
        headless hooks return — <code>idle</code>, <code>loading</code>, <code>password-required</code>,{' '}
        <code>ready</code>, <code>error</code>, <code>destroyed</code>. The built-in page region reads it
        to choose between its prompt, its failure message and its waiting notice, and a host-written{' '}
        <code>ViewerPages</code> replacement reads the same value rather than inferring a state from{' '}
        <code>doc</code> and <code>error</code>. <code>passwordPrompt</code> and <code>isReady</code> are
        still there, both derived from it. The shell forwards <code>onProgress</code>, <code>retry</code>,{' '}
        <code>signal</code> and the network options to the same hook, and draws nothing of its own from the
        first two.
      </p>
      <p>
        Two routes, deliberately. The parts above read the viewer around them;{' '}
        <code>Toolbar</code>, <code>Sidebar</code>, <code>SearchBox</code>, <code>PdfPage</code> and
        friends still take their props explicitly, which is what you want when you are driving the
        hooks yourself and owning the state. And the authoring hooks are exported too, so a feature you
        write can be mounted in any <code>PdfViewer</code> without its consumer knowing how it works.
      </p>
    </>
  );
}
