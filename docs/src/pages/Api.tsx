export function Api() {
  return (
    <>
      <h1>The API surface</h1>
      <p className="doc-lede">
        Every name the package hands you, and what each one is for. <code>1.0</code> freezes this list:
        from that version on, a name here that is not marked as plumbing is a promise that the next
        release will not rename it. Before <code>1.0</code> the surface is still moving —{' '}
        <a href="#/compatibility">the upgrade guide</a> says what has changed and what to do about it.
      </p>

      <h2>Entry points</h2>
      <p>
        One package, several specifiers, because what you import is what you download. Nothing in the
        shell imports a feature, so naming a feature is the only way to get its code; the catalogs are
        separate for the same reason — a language is 134 strings and you should not be handed one you
        did not ask for.
      </p>
      <table className="doc-table">
        <thead>
          <tr>
            <th>Specifier</th>
            <th>Contains</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>
              <code>pdfjs-react-reader</code>
            </td>
            <td>The viewer, its parts, the controller, the eight hooks the stock chrome needs, the feature contract and the library layer beneath them. 203 names.</td>
          </tr>
          <tr>
            <td>
              <code>pdfjs-react-reader/headless</code>
            </td>
            <td>
              Every hook — those eight plus <code>usePdfOptionalContent</code> and{' '}
              <code>usePdfAttachments</code> — and every library function, with no React components. For a
              host writing its own viewer. 158 names.
            </td>
          </tr>
          <tr>
            <td>
              <code>pdfjs-react-reader/features/&lt;name&gt;</code>
            </td>
            <td>One of <code>print</code>, <code>download</code>, <code>forms</code>, <code>outline</code>, <code>layers</code>, <code>annotate</code>, <code>attachments</code>.</td>
          </tr>
          <tr>
            <td>
              <code>pdfjs-react-reader/edit</code>
            </td>
            <td>The page-rearranging and flatten tier, the signing half of it, and the only module in the package that may reach the optional peer. 32 names — <code>node scripts/inventory.mjs</code> prints that number from <code>dist/edit.d.ts</code>, so it moves when the surface does.</td>
          </tr>
          <tr>
            <td>
              <code>pdfjs-react-reader/locales/&lt;lang&gt;</code>
            </td>
            <td>
              A complete label catalog: <code>de</code>, <code>es</code>, <code>fr</code>. 2.37–2.39 kB gzipped
              each, frozen, and typed as the whole catalog rather than the partial a host may send.
            </td>
          </tr>
          <tr>
            <td>
              <code>…&lt;name&gt;.css</code>
            </td>
            <td>
              Eight sheets — <code>styles</code>, <code>print</code>, <code>forms</code>, <code>outline</code>,{' '}
              <code>layers</code>, <code>annotate</code>, <code>attachments</code>, <code>edit</code> — one per
              feature that paints anything.
            </td>
          </tr>
        </tbody>
      </table>

      <h2>The viewer</h2>
      <table className="doc-table">
        <thead>
          <tr>
            <th>Name</th>
            <th>What it is</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>
              <code>PdfViewer</code>
            </td>
            <td>The whole thing: frame, toolbar, sidebar, pages. Takes <code>PdfViewerProps</code>, forwards a <code>PdfViewerHandle</code>.</td>
          </tr>
          <tr>
            <td>
              <code>useViewerController</code>
            </td>
            <td>Every piece of viewer state — page, zoom, rotation, layout, sidebar, search, ink, features — with the same props as <code>PdfViewer</code>. The other half of a host-written layout.</td>
          </tr>
          <tr>
            <td>
              <code>ViewerProvider</code>, <code>useViewer</code>
            </td>
            <td>Put the controller in context; read it from any component underneath, so a host control needs no props passed to it. <code>useViewer</code> throws outside a provider rather than rendering an empty control.</td>
          </tr>
          <tr>
            <td>
              <code>ViewerLayout</code>
            </td>
            <td>
              The default arrangement, as one component: <code>ViewerRoot</code> &gt; <code>ViewerToolbar</code> +{' '}
              <code>pjsr-body</code> &gt; <code>ViewerSidebar</code> + <code>ViewerPages</code>. Wrap it to add a
              header above an otherwise stock viewer without repeating its markup; pass your own parts
              instead to move them.
            </td>
          </tr>
          <tr>
            <td>
              <code>ViewerRoot</code>
            </td>
            <td>The frame: the element carrying the theme tokens, the keyboard and drop handlers and the mounted features’ runners.</td>
          </tr>
          <tr>
            <td>
              <code>ViewerToolbar</code>, <code>ViewerSidebar</code>, <code>ViewerPages</code>
            </td>
            <td>The three regions, reading the controller around them. <code>ViewerPages</code> is the scroll host and the virtualised rows.</td>
          </tr>
          <tr>
            <td>
              <code>PdfViewerHandle</code>
            </td>
            <td>
              The imperative escape hatch: <code>goToPage</code>, <code>zoomTo</code>, <code>fitTo</code>,{' '}
              <code>setLayout</code>, <code>rotatePage</code>, <code>openSidebar</code>,{' '}
              <code>toggleFullscreen</code>, <code>search</code>, <code>replaceDocument</code>.
            </td>
          </tr>
        </tbody>
      </table>

      <h2>The parts, taken apart</h2>
      <p>
        Each of these also takes its state as plain props, for a host driving the hooks itself. That is
        the difference between the <code>Viewer*</code> names above and these: one pair reads the viewer
        it is inside, the other is told everything.
      </p>
      <table className="doc-table">
        <thead>
          <tr>
            <th>Name</th>
            <th>What it is</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>
              <code>PdfPage</code>
            </td>
            <td>One page: canvas, text layer, annotation layer, editor layer, XFA layer, ink overlay. The most expensive subtree in the library, so it is memoised and its props are the contract.</td>
          </tr>
          <tr>
            <td>
              <code>Toolbar</code>
            </td>
            <td>The bar, planned by priority: what does not fit folds into an overflow menu. <code>ZOOM_LEVELS</code>, <code>INK_COLORS</code> and <code>INK_WIDTHS</code> are the option lists it renders, exported so a host writing its own bar can offer the same choices rather than inventing a fourth pen width.</td>
          </tr>
          <tr>
            <td>
              <code>SearchBox</code>
            </td>
            <td>The find bar: query, case, whole-word, regex, prev/next, the counter.</td>
          </tr>
          <tr>
            <td>
              <code>Sidebar</code>
            </td>
            <td>The tab strip and the panel body, whatever tabs a mounted feature has added to it.</td>
          </tr>
          <tr>
            <td>
              <code>ThumbnailList</code>, <code>PdfThumbnail</code>
            </td>
            <td>The thumbnails tab: the grid, and one card. A card paints its canvas, and for a page composed from a template it also composes the form over that canvas.</td>
          </tr>
          <tr>
            <td>
              <code>OutlineView</code>
            </td>
            <td>The outline tree, with the disclosure buttons and the destination resolution.</td>
          </tr>
          <tr>
            <td>
              <code>InkLayer</code>
            </td>
            <td>The SVG overlay freehand strokes are drawn into, page-local and viewport-projected.</td>
          </tr>
          <tr>
            <td>
              <code>PasswordPrompt</code>
            </td>
            <td>The modal an encrypted document arrives with: the field, the wrong-password message, the cancel.</td>
          </tr>
          <tr>
            <td>
              <code>LabelsContext</code>, <code>useLabels</code>
            </td>
            <td>
              How a part left the catalog to speak in. <code>LabelsContext</code> defaults to{' '}
              <code>DEFAULT_LABELS</code> rather than to nothing, which is why <code>Toolbar</code> on its own
              still renders English instead of crashing — and the same seam is how you would give your own
              chrome the viewer’s words.
            </td>
          </tr>
        </tbody>
      </table>

      <h2>The hooks</h2>
      <p>
        Each hook’s <code>*Options</code> and <code>*Result</code> types are exported beside it, so a
        wrapper around one can name what it passes and what it gets back.
      </p>
      <table className="doc-table">
        <thead>
          <tr>
            <th>Hook</th>
            <th>Owns</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>
              <code>usePdfDocument</code>
            </td>
            <td>Loading, the worker, the asset roots, the password round-trip and the capability report.</td>
          </tr>
          <tr>
            <td>
              <code>usePdfVirtualizer</code>
            </td>
            <td>What is on screen: slots, offsets, total height, the resolved scale behind <code>fit-width</code> and friends, and <code>scrollToPage</code>.</td>
          </tr>
          <tr>
            <td>
              <code>usePdfSearch</code>
            </td>
            <td>The text index, the matches, the active one, and the depth options. Any object shaped like its result can replace it through <code>find</code>.</td>
          </tr>
          <tr>
            <td>
              <code>usePdfOutline</code>
            </td>
            <td>The outline tree and the destination each entry points at.</td>
          </tr>
          <tr>
            <td>
              <code>usePdfFormValues</code>
            </td>
            <td>The AcroForm fields and the annotation storage they write into.</td>
          </tr>
          <tr>
            <td>
              <code>usePdfInk</code>
            </td>
            <td>Freehand strokes per page, the settings, undo and clear.</td>
          </tr>
          <tr>
            <td>
              <code>usePdfPrint</code>
            </td>
            <td>Rendering a page range into canvases and handing them to the browser. <code>isPrintSupported</code> asks whether this browser can do it at all; <code>PRINT_CONTAINER_CLASS</code> is the element the print sheet keys its <code>@media print</code> rules off.</td>
          </tr>
          <tr>
            <td>
              <code>usePdfDownload</code>
            </td>
            <td>Saving the document out, with or without the reader’s edits.</td>
          </tr>
        </tbody>
      </table>

      <h2>The feature contract</h2>
      <p>
        What a feature is, and the five hooks a feature uses from inside its own components.{' '}
        <a href="#/features">Features &amp; tiers</a> is the page that shows them working; this is the list.
      </p>
      <table className="doc-table">
        <thead>
          <tr>
            <th>Names</th>
            <th>What they are</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>
              <code>PdfFeature</code>, <code>AnyPdfFeature</code>
            </td>
            <td>The shape a feature declares: controls, panel, page props, runners. The second is the erased one, for a list of mixed features.</td>
          </tr>
          <tr>
            <td>
              <code>PdfFeatureControl</code>, <code>PdfFeaturePanel</code>, <code>PdfFeatureKeyBinding</code>, <code>FeatureKeyEvent</code>
            </td>
            <td>The four things a feature can add: a bar control, a sidebar tab, a keyboard binding, and the event a binding is offered.</td>
          </tr>
          <tr>
            <td>
              <code>FeaturePageProps</code>, <code>FeaturePublication</code>, <code>FeatureStore</code>, <code>PdfViewerShell</code>
            </td>
            <td>The state seam — what a feature publishes, what reaches every <code>PdfPage</code>, and the shell a feature is mounted against.</td>
          </tr>
          <tr>
            <td>
              <code>usePdfFeatureState</code>, <code>…Shell</code>, <code>…Peer</code>, <code>…Options</code>, <code>…Publish</code>
            </td>
            <td>The same seam read from inside a feature. Published callbacks must be stable, because the store compares one level deep.</td>
          </tr>
          <tr>
            <td>
              <code>findFeatureKey</code>, <code>mergeFeaturePageProps</code>, <code>samePublication</code>, <code>NO_FEATURES</code>
            </td>
            <td>
              Plumbing the shell uses to resolve a chord to{' '}
              <code>{'{ feature, binding }'}</code> and to fold every feature’s page props into one
              object. Public so a host writing a custom bar can use them; the likeliest to change shape.
            </td>
          </tr>
        </tbody>
      </table>

      <h2>The library layer</h2>
      <p>
        The functions the parts and hooks are built from, re-exported because the headless promise is
        only real if you can do the arithmetic yourself. Each group below is a module, and the module is
        the level this page describes them at — the individual names are listed verbatim, so what is
        public is on paper even where it is not prose.
      </p>
      <table className="doc-table">
        <thead>
          <tr>
            <th>Group</th>
            <th>Names</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>Layout math</td>
            <td>
              <code>computeLayout</code>, <code>computeSlots</code>, <code>findStartIndex</code>, <code>findVisibleRange</code>, <code>scaledPageSize</code>, <code>applyRotation</code>, <code>automaticFitMode</code>, <code>meanBox</code>, <code>spreadSample</code>, <code>DEFAULT_PAGE_ESTIMATE</code>
            </td>
          </tr>
          <tr>
            <td>Canvas limits</td>
            <td>
              <code>resolveRenderScale</code>, <code>maxRenderPixelsFor</code>, <code>readCanvasEnvironment</code>, <code>isMobileCanvasEnvironment</code>, <code>MAX_RENDER_PIXELS</code>, <code>MAX_RENDER_PIXELS_MOBILE</code>, <code>MAX_RENDER_SIDE</code>, <code>CAP_AREA_FACTOR</code>
            </td>
          </tr>
          <tr>
            <td>Search</td>
            <td>
              <code>buildPageText</code>, <code>extractPageText</code>, <code>extractAllText</code>, <code>findPageMatches</code>, <code>countPerPage</code>, <code>convertMatches</code>, <code>convertMatchRanges</code>, <code>planFind</code>, <code>escapeRegExp</code>
            </td>
          </tr>
          <tr>
            <td>Forms</td>
            <td>
              <code>collectWidgets</code>, <code>groupWidgets</code>, <code>describeWidget</code>, <code>readFormValues</code>, <code>writeFormValues</code>, <code>readInitialValues</code>, <code>clearFormValues</code>, <code>formValuesDiffer</code>
            </td>
          </tr>
          <tr>
            <td>Ink geometry</td>
            <td>
              <code>drawInkStrokes</code>, <code>simplifyPoints</code>, <code>pointsBounds</code>, <code>strokeBounds</code>, <code>strokePathD</code>, <code>createStrokeId</code>
            </td>
          </tr>
          <tr>
            <td>Print planning</td>
            <td>
              <code>planPrintPages</code>, <code>planPrintScale</code>, <code>printCanvasSize</code>, <code>estimatePrintBytes</code>, <code>maxPrintablePages</code>, <code>printRangeFor</code>, <code>formatBytes</code>, <code>PRINT_SCALES</code>, <code>BYTES_PER_PIXEL</code>, <code>PRINT_MEMORY_BUDGET</code>
            </td>
          </tr>
          <tr>
            <td>Optional content and attachments</td>
            <td>
              <code>usePdfOptionalContent</code>, <code>optionalContentGroupIds</code>, <code>flattenOptionalContent</code>, <code>usePdfAttachments</code>, <code>normalizeAttachments</code>, <code>attachmentMimeType</code> —
              the layers tab’s group state and the attachments tab’s file list, both of which the sidebar
              renders when the matching feature is mounted. Only on the headless path: the shell’s barrel
              does not carry them, because a host using the stock sidebar never needs them and a host
              writing their own needs nothing else.
            </td>
          </tr>
          <tr>
            <td>Source and assets</td>
            <td>
              <code>normalizeSource</code>, <code>resolveSourceUrl</code>, <code>isAllowedSource</code>, <code>pdfAssetUrls</code>, <code>resolveAssetRoot</code>, <code>CDN_ASSET_ROOT</code>, <code>configureWorker</code>, <code>ensureWorker</code>, <code>configureTrustedTypes</code>, <code>isTrustedTypesConfigured</code>, <code>workerAutoDetectionFailed</code>
            </td>
          </tr>
          <tr>
            <td>Annotations and labels</td>
            <td>
              <code>readEditingState</code>, <code>readEditingParams</code>, <code>HIGHLIGHT_COLORS</code>, <code>DEFAULT_HIGHLIGHT_COLOR</code>, <code>HIGHLIGHT_COLOR_PARAM</code>, <code>HIGHLIGHT_PALETTE_STRING</code>, <code>formatLabel</code>, <code>DEFAULT_LABELS</code>, <code>parseDestination</code>, <code>resolveDestinationPageIndex</code>, <code>createPdfLinkService</code>, <code>downloadBytes</code>, <code>pdfFileName</code>
            </td>
          </tr>
        </tbody>
      </table>

      <h2>What you may not change</h2>
      <p>
        The three shipped catalogs are frozen objects, and writing to a frozen one throws in strict mode.{' '}
        <code>DEFAULT_LABELS</code>, <code>INK_COLORS</code>, <code>INK_WIDTHS</code>,{' '}
        <code>HIGHLIGHT_COLORS</code>, <code>ZOOM_LEVELS</code>, <code>PRINT_SCALES</code> and{' '}
        <code>DEFAULT_PAGE_ESTIMATE</code> are not, yet — they have been published mutable since{' '}
        <code>0.2</code>, and freezing one is a change for anybody who currently writes to it, which is
        exactly the behaviour worth breaking. Until that happens, copy what you need to alter:
      </p>
      <pre>
        <code>{`// Not this — one host's edit becomes every viewer's label.
DEFAULT_LABELS.nextPage = 'Next';

// This.
const labels = { ...DEFAULT_LABELS, nextPage: 'Next' };`}</code>
      </pre>
    </>
  );
}
