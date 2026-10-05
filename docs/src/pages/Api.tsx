import maturity from '../../../api-maturity.json';

// The JSON import gives literal key types; the page indexes by names it discovered from the same file, so
// the widening is the honest description of what is happening rather than a suppression.
const tags = maturity.tags as Record<string, string>;
const notes = maturity.notes as Record<string, string>;

/** The names that are not `stable`, with the reason each one says it is not. */
const movable = Object.entries(notes)
  // `untagged` cannot happen — `check:maturity` fails the build on it — but the index type allows a miss,
  // and a page that would have crashed is better than one that renders `undefined` into a table cell.
  .map(([name, why]) => ({ name, tag: tags[name] ?? 'untagged', why }))
  .filter((row) => row.tag !== 'stable')
  .sort((a, b) => (a.tag === b.tag ? a.name.localeCompare(b.name) : a.tag < b.tag ? -1 : 1));

const stableCount = Object.values(tags).filter((t) => t === 'stable').length;

export function Api() {
  return (
    <>
      <h1>The API surface</h1>
      <p className="doc-lede">
        Every name the package hands you, and what each one is for. Each of them carries a maturity state
        — see <a href="#stability">Stability</a> — and the set is not a list somebody keeps by hand:{' '}
        <code>npm run check:maturity</code> reads the published names out of the build and fails if one of
        them has no state, or if a state in the file no longer has a name behind it.{' '}
        <code>1.0</code> freezes the <em>stable</em> ones; the promise is only worth making because the set
        it applies to is legible.
      </p>

      <h2>Entry points</h2>
      <p>
        One package, several specifiers, because what you import is what you download. Nothing in the
        shell imports a feature, so naming a feature is the only way to get its code; the catalogs are
        separate for the same reason — a language is 137 strings and you should not be handed one you
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
            <td>The viewer, its parts, the controller, the eight hooks the stock chrome needs, the feature contract and the library layer beneath them. 239 names.</td>
          </tr>
          <tr>
            <td>
              <code>pdfjs-react-reader/headless</code>
            </td>
            <td>
              Every hook — those eight plus <code>usePdfOptionalContent</code> and{' '}
              <code>usePdfAttachments</code> — and every library function, with no React components. For a
              host writing its own viewer. 197 names.
            </td>
          </tr>
          <tr>
            <td>
              <code>pdfjs-react-reader/features/&lt;name&gt;</code>
            </td>
            <td>One of <code>print</code>, <code>download</code>, <code>forms</code>, <code>outline</code>, <code>layers</code>, <code>annotate</code>, <code>attachments</code>, <code>structure</code>.</td>
          </tr>
          <tr>
            <td>
              <code>pdfjs-react-reader/edit</code>
            </td>
            <td>The page-rearranging and flatten tier, the signing half of it, and one of the two modules in the package that may reach the optional peer. 36 names — <code>node scripts/inventory.mjs</code> prints that number from <code>dist/edit.d.ts</code>, so it moves when the surface does.</td>
          </tr>
          <tr>
            <td>
              <code>pdfjs-react-reader/merge</code>
            </td>
            <td>
              Two documents, one new file: <code>mergeDocuments</code>, <code>describeMergeSources</code>,{' '}
              <code>usePdfMerge</code> and the plan types — 13 names. The tier&apos;s other half is the picker,
              and it is deliberately not here: which documents may be merged, where they come from and what
              happens to the bytes are the host&apos;s business, so the package ships the writer, the state and
              <a href="#/recipes"> a recipe</a>. The output is always a third file; a source is never written.
            </td>
          </tr>
          <tr>
            <td>
              <code>pdfjs-react-reader/locales/&lt;lang&gt;</code>
            </td>
            <td>
              A complete label catalog: <code>de</code>, <code>es</code>, <code>fr</code>. 2.39–2.42 kB gzipped
              each, frozen, and typed as the whole catalog rather than the partial a host may send.
            </td>
          </tr>
          <tr>
            <td>
              <code>…&lt;name&gt;.css</code>
            </td>
            <td>
              Nine sheets — <code>styles</code>, <code>print</code>, <code>forms</code>, <code>outline</code>,{' '}
              <code>layers</code>, <code>annotate</code>, <code>attachments</code>, <code>structure</code>,{' '}
              <code>edit</code> — one per feature that paints anything. <code>structure.css</code> is the one
              of them that is load-bearing rather than cosmetic: it is what keeps an accessibility layer out
              of the page's layout.
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
            <td>Every piece of viewer state — page, zoom, rotation, layout, sidebar, search, features — with the same props as <code>PdfViewer</code>. The other half of a host-written layout.</td>
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
            <td>The frame: the element carrying the theme tokens, the keyboard and drop handlers and the mounted features’ runners. Beside its children it takes the host’s own <code>className</code> and <code>style</code>, added to the controller’s rather than replacing them — the arrangement is the part a host owns.</td>
          </tr>
          <tr>
            <td>
              <code>ViewerToolbar</code>, <code>ViewerSidebar</code>, <code>ViewerPages</code>
            </td>
            <td>The three regions, reading the controller around them. <code>ViewerPages</code> is the scroll host and the virtualised rows; <code>ViewerSidebar</code> puts the shell’s tabs in by default and takes the host’s own content instead when it is given children, in which case no tab strip is drawn.</td>
          </tr>
          <tr>
            <td>
              <code>PdfViewerHandle</code>
            </td>
            <td>
              The imperative escape hatch: <code>goToPage</code>, <code>zoomTo</code>, <code>fitTo</code>,{' '}
              <code>setLayout</code>, <code>rotatePage</code>, <code>retryPage</code>,{' '}
              <code>openSidebar</code>, <code>toggleFullscreen</code>, <code>search</code>,{' '}
              <code>replaceDocument</code>.
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
            <td>One page: canvas, text layer, annotation layer, and the editor and XFA layers when a feature hands them in. The most expensive subtree in the library, so it is memoised and its props are the contract.</td>
          </tr>
          <tr>
            <td>
              <code>Toolbar</code>
            </td>
            <td>The bar, planned by priority: what does not fit folds into an overflow menu. <code>ZOOM_LEVELS</code> is the option list it renders, exported so a host writing its own bar can offer the same choices rather than inventing a fourth zoom step. The authoring tools are not in it: they arrive with <code>annotateFeature</code> and fold into the same plan.</td>
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
            <td>The tab strip and the panel body. Its <code>tabs</code> list is the strip: omit it and there is no tab that selects nothing, which is the shape a host-written sidebar needs.</td>
          </tr>
          <tr>
            <td>
              <code>ThumbnailList</code>, <code>PdfThumbnail</code>
            </td>
            <td>The thumbnails tab: the grid, and one card. The grid reads the document, its page count, the page on screen and the rotation of each from the controller, so the only thing to pass it is a starting width; a card paints its canvas, and for a page composed from a template it also composes the form over that canvas.</td>
          </tr>
          <tr>
            <td>
              <code>OutlineView</code>
            </td>
            <td>The bookmark tree, with the disclosure buttons and the destination resolution. It takes no props: the tree is the outline tier’s publication in the controller’s store, and a click follows the place the bookmark names.</td>
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
            <td>The text index, the matches, the active one, and the depth options. Indexing is incremental and starts from the page in view (<code>focusPage</code>), so a first answer arrives while the rest of the document is still being read and the counter says <em>so far</em> until it is not; <code>index</code> accepts a prebuilt <code>{'{version: 1, pages: [{text, itemEnds}]}'}</code> from a server instead of extracting at all, and <code>indexError</code> says so if it does not describe this document. Any object shaped like its result can replace it through <code>find</code>.</td>
          </tr>
          <tr>
            <td>
              <code>usePdfMerge</code>
            </td>
            <td>
              The state behind a merge picker on <code>pdfjs-react-reader/merge</code>: how many pages each
              source has, the ordered plan (<code>add</code>, <code>remove</code>, <code>move</code> and{' '}
              <code>clear</code>), how many have been taken from each, and <code>merge()</code>, which writes a
              new file and resolves <code>null</code> for an empty plan or a caller that stopped caring. No
              component, because the preview is the host&apos;s design decision.
            </td>
          </tr>
          <tr>
            <td>
              <code>usePdfOutline</code>
            </td>
            <td>
              The outline tree, with the page <em>and</em> the place each entry points at —{' '}
              <code>position</code> carries what the destination’s <code>/XYZ</code>, <code>/FitH</code> or{' '}
              <code>/FitR</code> named, including a magnification.
            </td>
          </tr>
          <tr>
            <td>
              <code>usePdfFormValues</code>
            </td>
            <td>The AcroForm fields and the annotation storage they write into.</td>
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
              <code>resolveRenderScale</code>, <code>maxRenderPixelsFor</code>, <code>resolveCanvasBudget</code>, <code>readCanvasEnvironment</code>, <code>isMobileCanvasEnvironment</code>, <code>ensureCanvasCeiling</code>, <code>probedCanvasCeiling</code>, <code>MAX_RENDER_PIXELS</code>, <code>MAX_RENDER_PIXELS_MOBILE</code>, <code>MAX_RENDER_SIDE</code>, <code>CAP_AREA_FACTOR</code>, <code>MIN_RENDER_SCALE</code>, <code>T CanvasBudget</code>, <code>T CanvasCeilingSource</code>, <code>T CanvasProbeOptions</code>
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

      <h2 id="stability">Stability</h2>
      <p>
        Every published name is in exactly one of four states, and the file that says so is{' '}
        <code>api-maturity.json</code>. The states matter because a pre-<code>1.0</code> package may break
        an experimental name and may not break a stable one, which is the only way it can be honest about
        what it promises while still asking you to use it today.
      </p>
      <table className="doc-table">
        <thead>
          <tr>
            <th>State</th>
            <th>What it commits to</th>
          </tr>
        </thead>
        <tbody>
          {maturity.policy.map((line) => (
            <tr key={line.split(' ')[0]}>
              <td className="doc-key">
                <code>{line.split(' — ')[0]}</code>
              </td>
              <td>{line.split(' — ')[1]}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p>
        <strong>{stableCount}</strong> of the {Object.keys(maturity.tags).length} published names are
        stable. The rest are every name that may still move under you, with the reason the manifest records
        for it — a state without a reason is rejected by the check, because that is how a temporary label
        becomes permanent.
      </p>
      <table className="doc-table">
        <thead>
          <tr>
            <th>Name</th>
            <th>State</th>
            <th>Why it is not stable</th>
          </tr>
        </thead>
        <tbody>
          {movable.map((row) => (
            <tr key={row.name}>
              <td>
                <code>{row.name}</code>
              </td>
              <td className="doc-key">{row.tag}</td>
              <td>{row.why}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p>
        The rule that keeps all of this current is mechanical:{' '}
        <code>npm run check:maturity</code> reads the published surface out of <code>dist/</code> and fails
        the build if a name has no state, if a state has no name, if a non-stable name has no reason, or if
        the file invents a fifth state. It is the last step of <code>npm run verify</code> and a named step in
        the CI <code>verify</code> job, and it runs
        itself against nine synthetic violations first — a check that has never seen a bad input is not yet
        a check.
      </p>

      <h2>What you may not change</h2>
      <p>
        The three shipped catalogs are frozen objects, and writing to a frozen one throws in strict mode.{' '}
        <code>DEFAULT_LABELS</code>, <code>HIGHLIGHT_COLORS</code>, <code>ZOOM_LEVELS</code>,{' '}
        <code>PRINT_SCALES</code> and{' '}
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
