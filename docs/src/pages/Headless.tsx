import { HeadlessExample } from '../examples/HeadlessExample';

const HOOKS: [string, string][] = [
  [
    'usePdfDocument({ src, workerSrc?, assetUrl?, cMapUrl?, standardFontUrl?, allowedSources?, httpHeaders?, withCredentials?, rangeChunkSize?, disableRange?, disableStream?, retry?, onRetryAttempt?, onProgress?, signal?, enableXfa?, onPasswordRequired? })',
    'Loads the file. Returns { status, doc, numPages, isReady, error, passwordRequest, capabilities, reload }. `status` is the published document model — idle, loading, password-required, ready, error, destroyed — and every other field is read off it, so `ready` never arrives without a handle and a cancelled load reports `destroyed` rather than an error. The network options apply to a URL source only; `retry` defaults to three attempts with full-jitter backoff and never retries a 401, a 403, a 404 or a corrupt file; `onProgress` reports `{ loaded, total, percent }` as bytes arrive, with `percent` null when the response did not state a length; `signal` cancels the load exactly as an unmount would and reports no error.',
  ],
  [
    'usePdfVirtualizer({ doc, numPages, scale, gap?, rotation?, pageRotations?, overscan?, layout? })',
    'The scroll engine. Returns { containerRef, virtualSlots, totalHeight, currentPage, pageEstimate, resolvedScale, viewportWidth, viewportHeight, scrollToPage, reportPageDims }.',
  ],
  [
    'usePdfSearch({ doc, onError?, signal?, focusPage?, index? })',
    'Search with a 200 ms debounce in the shell and cancellation of stale runs. `search(query, { caseSensitive?, wholeWord?, regex? })` — several words mean a page holding all of them, `regex` treats the query as an expression. Indexing is incremental and starts from `focusPage`, walking outward, so a first answer arrives before the document is finished; `index` takes a prebuilt `{version: 1, pages: [{text, itemEnds}]}` instead of extracting. Returns { status, progress, query, options, results, total, counts, pagesWithMatches, patternError, activeIndex, activeSeq, complete, pagesIndexed, pagesTotal, indexError, search, setActiveIndex, nextMatch, prevMatch, clear, invalidatePages }.',
  ],
  [
    'usePdfOptionalContent({ doc, config?, revision?, onChanged?, onError? })',
    'The document’s optional-content groups (layers). Returns { rows, loading, error, supported, config, setVisibility, applyState }. Pass the `config` you get back to `page.render({ optionalContentConfigPromise })`: pdf.js builds a fresh config per call, so a mutation on any other instance is invisible to the page.',
  ],
  [
    'usePdfAttachments({ doc, onError? })',
    'The files embedded in the document. Returns { files, loading, error, supported, busyId, saveError, download }; contents are read per file, never all at once.',
  ],
  [
    'usePdfOutline({ doc })',
    'The bookmark tree, with destinations resolved to 0-based page indexes. Returns { entries, loading } — `entries` is null while loading.',
  ],
  [
    'usePdfPageLabels({ doc, signal? })',
    'What the pages are called — the document’s /PageLabels table, or null when it declares none, which is the ordinary answer and not a failure. Read once per document handle and republished when the handle changes, so a replaced document gets its own numbering; an already-aborted signal means the round trip is never made. Pair it with `resolvePageInput` and `formatPageLabel` to build a page box that takes "iii" back from the reader.',
  ],
  [
    'usePdfFormValues({ doc, onError? })',
    'Returns { fields, widgets, values, isDirty, version, loading, refresh, storage, setValue, getFormData, setFormData, reset }.',
  ],
  [
    'usePdfInk({ resetKey? })',
    'Freehand strokes stored in PDF user space, so zoom and rotation both map correctly. Returns { strokes, settings, drawing, setDrawing, updateSettings, addStroke, undo, clear, strokesForPage, getDrawingData, setDrawingData }.',
  ],
  [
    'usePdfPrint({ doc, rotation?, getInkStrokes?, onError? })',
    'Headless print pipeline. Returns { print, cancel, isPrinting, progress, error, supported }; `print()` takes { range?, scale? } and defaults to the whole document.',
  ],
  [
    'usePdfDownload({ doc, fileName?, onError? })',
    'Saves the file. Returns { download, isBusy, error }; `download()` takes { saveEdits? }, which writes an incremental save carrying what is in the annotation storage — field values and annotation marks both — instead of the bytes the document was loaded from.',
  ],
  [
    'usePdfMerge({ sources, onError?, signal? })   // from pdfjs-react-reader/merge, not /headless',
    'The state behind a merge picker: { available, order, taken, add, remove, move, clear, merge, busy }. `merge()` writes a NEW file out of the pages the plan names and resolves null for an empty plan or a stopped caller; no source is ever written. Its own entry because it is the second half of the optional peer, and a viewer that only displays PDFs should not be able to pull a page-copying writer in by naming the wrong hook.',
  ],
];

export function Headless() {
  return (
    <>
      <h1>Headless hooks</h1>
      <p className="doc-lede">
        Import from <code>pdfjs-react-reader/headless</code> and build the entire interface
        yourself. You get the document proxy, the virtualizer, and the layer components — you choose
        where every button lives. These are the same hooks the shell&apos;s built-in{' '}
        <a href="#/features">features</a> wrap, so nothing a feature can do is closed to you.
      </p>

      <HeadlessExample />

      <h2>The pieces</h2>
      <table className="doc-table">
        <thead>
          <tr>
            <th>Hook</th>
            <th>Returns</th>
          </tr>
        </thead>
        <tbody>
          {HOOKS.map(([sig, note]) => (
            <tr key={sig}>
              <td>
                <code>{sig}</code>
              </td>
              <td>{note}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <h2>Rendering pages</h2>
      <p>
        <code>PdfPage</code> draws one page: canvas, selectable text layer, annotation layer, ink
        overlay, and — when a feature hands it an editor manager — the annotation editor layer. A pure
        XFA page is painted from its template instead of the text layer, and a search marks that text
        rather than finding it and showing nothing. The virtualizer hands you rows
        (<code>virtualSlots</code>) already grouped for the active layout, positioned by
        <code>offsetTop</code>:
      </p>
      <pre>
        <code>{`<div ref={containerRef} style={{ height: totalHeight, position: 'relative' }}>
  {virtualSlots.map((slot) => (
    <div
      key={slot.indices[0]}
      style={{ position: 'absolute', top: 0, transform: \`translate(-50%, \${slot.offsetTop}px)\` }}
    >
      {slot.indices.map((index) => (
        <PdfPage
          key={index}
          doc={doc}
          pageNumber={index + 1}
          scale={resolvedScale}
          onBaseDimensions={reportPageDims}
        />
      ))}
    </div>
  ))}
</div>`}</code>
      </pre>
      <p>
        <code>reportPageDims</code> feeds measured page sizes back into the virtualizer, so the
        scrollbar stops guessing after the first page renders.
      </p>
      <p>
        <code>PdfPage</code> renders annotations read-only until something hands it an editor: a
        typable form needs <code>renderForms</code> plus the <code>annotationStorage</code>,{' '}
        <code>formVersion</code> and <code>onFormChange</code> that <code>usePdfFormValues</code> hands
        back, and marking the page up needs the <code>annotationEditorUIManager</code> and{' '}
        <code>annotationEditorEditing</code> pair. Those are exactly what <code>formsFeature</code> and{' '}
        <code>annotateFeature</code> publish through their <code>pageProps</code>.
      </p>

      <h2>Two state models, so the branches are yours</h2>
      <p>
        The load and the page each have a named state, exported as{' '}
        <code>PdfDocumentStatus</code> and <code>PdfPageStatus</code>. Every other field on the result is
        read off the document&apos;s state, which is what makes the pair impossible to catch
        disagreeing: <code>status</code> is never <code>ready</code> with a null <code>doc</code>, and a
        load the host cancelled lands on <code>destroyed</code> having never passed through{' '}
        <code>error</code>.
      </p>
      <pre>
        <code>{`// usePdfDocument
'idle' → 'loading' → 'password-required' → 'ready' → 'error' | 'destroyed'

const { status, doc, error, passwordRequest, reload } = usePdfDocument({ src });

{status === 'password-required' && passwordRequest && (
  <MyPrompt
    onSubmit={(value) => passwordRequest.submit(value)}
    // An Error is how a dismissed prompt fails the load instead of hanging it.
    onCancel={() => passwordRequest.submit(new Error('No password provided.'))}
  />
)}
{status === 'error' && error && <MyFailure message={error.message} onRetry={reload} />}

// PdfPage, one page at a time
'queued' → 'rendering' → 'rendered' → 'released', with 'cancelled' and 'error' off the middle

// The page number travels with the status, so one stable handler tracks the whole document and the
// memo on PdfPage keeps working — a closure per page would defeat it.
const [pageStates, setPageStates] = useState<Record<number, PdfPageStatus>>({});
const onPageStatus = useCallback((pageNumber: number, state: PdfPageStatus) => {
  setPageStates((was) => ({ ...was, [pageNumber]: state }));
}, []);

<PdfPage pageNumber={i + 1} doc={doc} scale={scale} onStatusChange={onPageStatus} />`}
</code>
      </pre>
      <p>
        A wrong password does not fail the load. The engine re-asks within about a millisecond and the hook
        publishes that as a fresh <code>password-required</code> with <code>reason:
        &apos;incorrect-password&apos;</code>, so the prompt above comes back with its own message and needs
        no second state. One way to spend that contract badly is worth naming, because it is invisible until
        it happens: answering <em>from inside the callback</em> — an automatic retry of a stored credential
        rather than a decision a person made — loops, since the re-ask is chained in the same microtask and
        nothing ever yields. Measured at roughly 27,000 asks a second, and stated on{' '}
        <code>PdfPasswordRequest.submit</code> as well as here.
      </p>
      <p>
        A page that has not been asked for is <code>unrequested</code>, and it is the one state a page
        never reports — a page the virtualizer has not mounted is not there to say so, which is exactly
        what <code>virtualSlots</code> describe. A zoom reads <code>released → rendering → rendered</code>{' '}
        and produces no <code>cancelled</code>: nothing was in flight when the buffer was handed back.
      </p>

      <h2>Two rules that matter</h2>
      <div className="doc-callout">
        <strong>Give <code>PdfPage</code> stable props.</strong> It is memoised, because it is the most
        expensive subtree here and the shell re-renders for reasons that cannot reach it — opening the
        search bar changes no page prop. A fresh inline arrow or a new object each render defeats that
        and re-renders every visible page. Separately, the callbacks that appear in a layer's
        dependency list (<code>onError</code>, <code>onBaseDimensions</code>,{' '}
        <code>onFormChange</code>, <code>onStatusChange</code>) are read through refs, because a layer
        rebuild clears its container, drops text selection and flashes the page; the shell does the same.
      </div>
      <div className="doc-callout">
        <strong>Give the viewport element a height and let it scroll.</strong> The virtualizer
        measures its <code>containerRef</code>; a container sized by its content will report zero
        and render nothing but the first row.
      </div>

      <h2>The four production knobs</h2>
      <p>
        Headless consumers get the same protections the shell uses, as plain options.
      </p>
      <pre>
        <code>{`import {
  configureTrustedTypes,
  usePdfDocument,
  type PdfCapabilities,
} from 'pdfjs-react-reader/headless';

const { status, doc, numPages, isReady, error, capabilities, reload } = usePdfDocument({
  src,
  // Where the file may come from. Byte sources are always allowed.
  allowedSources: ['/uploads/', 'https://cdn.example.com'],
  // cmaps/, standard_fonts/ and wasm/ — 'cdn' or a directory you serve.
  assetUrl: '/pdfjs-assets/',
  // Defaults to true; false leaves a dynamic XFA with no content to show.
  enableXfa: true,
});

// capabilities: { form: 'none' | 'acroform' | 'xfa' | 'mixed',
//                 renderedFromXfa: boolean, hasJSActions: boolean }
// Null until the document is open. It is the answer to "can this be filled in
// here", which a rendered page cannot tell you.
if (capabilities?.form === 'xfa' && !capabilities.renderedFromXfa) {
  // offer it for download instead of showing a form that will not accept input
}`}</code>
      </pre>
      <p>
        <code>configureTrustedTypes(name)</code> is a module-level call, not a hook option, and only
        belongs on a page whose CSP has <code>require-trusted-types-for 'script'</code>: pdf.js takes
        a <em>string</em> worker URL and cannot use one there, so without this it parses on the main
        thread without telling you. The name has to be one your directive already lists.
      </p>
      <p>
        Page canvases are capped too — pass <code>maxRenderPixels</code> and{' '}
        <code>devicePixelRatio</code> to <code>PdfPage</code>, or leave them unset: the ceiling then comes
        from <code>maxRenderPixelsFor(readCanvasEnvironment())</code>, the limit the engine uses, and the
        density from the watched <code>window.devicePixelRatio</code>, which re-reads itself when the window
        moves to another display — a <code>devicePixelRatio</code> you pass is a number that does not move,
        and the pages stop answering the environment. An uncapped page at deep zoom asks for more pixels than
        a browser will allocate, and the failure is a blank rectangle, not an exception.
      </p>

      <h2>Search without the shell</h2>
      <pre>
        <code>{`const search = usePdfSearch({ doc, focusPage: page - 1 });

search.search('speculation', { caseSensitive: false, wholeWord: true });
// search.results    -> PageMatch[] with pageIndex and a rect per hit
// search.total      -> how many, which is how 'no matches' reads differently from 'still working'
// search.status     -> 'idle' | 'indexing' | 'ready' | 'error' (indexing the text, not the query)
// search.complete   -> false while the index is still growing, and search.pagesIndexed / pagesTotal say how far
// search.activeIndex, search.nextMatch(), search.prevMatch(), search.clear()
search.nextMatch();

// Pass each page its slice of matches to highlight in the text layer:
<PdfPage doc={doc} pageNumber={i + 1} scale={scale} highlights={byPage.get(i)} />`}</code>
      </pre>
      <p>
        Indexing starts at <code>focusPage</code> and walks outward — the page in view, then +1, −1, +2, −2 —
        publishing every 25 pages or 120 ms, so a query on a thousand-page document answers against what the
        reader can see instead of waiting for the file. A partial answer says so: a host drawing its own
        counter should branch on <code>search.complete</code> between &ldquo;3 of 17&rdquo; and
        &ldquo;3 of 17 so far&rdquo;. To supply an index built elsewhere — by a server that has already read
        the corpus — pass <code>index</code>:
      </p>
      <pre>
        <code>{`import { buildTextIndex, usePdfSearch } from 'pdfjs-react-reader/headless';

// On the server, per page: const items = (await page.getTextContent()).items;
const index = buildTextIndex(pagesOfItems);        // {version: 1, pages: [{text, itemEnds}]}
await fetch('/publish', { body: JSON.stringify(index) });

// Here:
const search = usePdfSearch({ doc, index });
// A page the index leaves as null is read from the document, and only that page.
// An index for a different revision is refused by its page count, reported in
// search.indexError, and the document is searched anyway.`}</code>
      </pre>
      <p>
        A host using the shell instead of these hooks reaches the same place through <code>find</code>: the
        index only has to become a controller, and <code>PdfViewer</code> will draw its own bar, marks and
        page counts from it — which is what <code>playground/src/HostFind.tsx</code> demonstrates.
      </p>
      <p>
        What the index holds is the page&apos;s <em>content stream</em>, and the limit is worth knowing before
        you build a UI on it: <code>getTextContent()</code> reports a form field&apos;s label rather than the
        value a reader typed, and an annotation&apos;s text not at all — measured against the shipped fixtures
        in <code>src/lib/search.parity.test.ts</code>. So nothing typed in this session becomes searchable, in
        this viewer or any other built on these hooks; <code>search.invalidatePages([7])</code> is the cheap
        way to say a page&apos;s text is no longer what was indexed, not a way to follow an edit.
      </p>

      <h2>Merging documents</h2>
      <p>
        On its own entry point, because a viewer that only displays PDFs has no reason to carry a writer:
      </p>
      <pre>
        <code>{`import { usePdfMerge, type MergeSource } from 'pdfjs-react-reader/merge';

const merge = usePdfMerge({ sources });          // MergeSource[] = [{ bytes, name }]
// merge.available  -> pages per source, null until read
// merge.order      -> the plan: [{ source, page }] in output order; a page may appear twice
// merge.add(at, page) · merge.remove(position) · merge.move(from, to) · merge.clear()

const result = await merge.merge();              // null if the plan was empty or it was stopped
downloadBytes(result.bytes, 'merged.pdf');       // result.pages, result.taken, result.available`}</code>
      </pre>
      <p>
        The bytes you pass in come back out unchanged — every source is loaded from a copy, and the test suite
        hashes both sides of a merge to prove it — so a reader can experiment with a merge without being able
        to lose a document by trying one. What a merge does not carry across is the interactive form: a page
        arrives with its widget annotations but not the <code>AcroForm</code> that binds them, so on a merged
        file the values are visible and the fields are not live.
      </p>

      <h2>Deciding what a string is, before loading it</h2>
      <p>
        A source that arrives from an upload widget, a query parameter or a JSON payload is a string whose
        kind nothing has checked yet, and the loader has a rule about it that a host cannot guess: a long
        pure-base64 run is bytes, anything else with a slash or a <code>.pdf</code> suffix is a path, and a
        bare word is refused rather than fetched — because fetching <code>report</code> hands the parser
        whatever this origin serves there, which arrives as a corrupt-document error with nothing pointing
        at the typo. <code>classifySource</code> is that rule, asked out loud. It never throws, and it is
        the same code <code>normalizeSource</code> runs, so a prediction and an outcome cannot disagree —
        the refusal even carries the sentence the loader would have thrown.
      </p>
      <pre>
        <code>{`import { base64ToBytes, classifySource } from 'pdfjs-react-reader/headless';

const classified = classifySource(requested);
// { kind: 'url',    url }    — the engine fetches it
// { kind: 'bytes',  data }   — the string is the file: long base64, or a ;base64 data URL
// { kind: 'refused', reason, message }   'empty' | 'bare-name' | 'windows-path' | 'bad-base64'

if (classified.kind === 'refused') {
  // reason is the branch a form message keys off; message is a sentence already worth showing.
  showProblem(classified.message);
}

// A base64 document held as text, turned into bytes to hash, wrap in a File, or post elsewhere.
// Passing the string straight to \`src\` does this decode for you; this is for the step before.
const bytes = base64ToBytes(payload.fileBase64);`}</code>
      </pre>

      <h2>What the pages are called</h2>
      <p>
        A document may number itself however it likes — <code>i, ii, iii</code> for the front matter,{' '}
        <code>1, 2, 3</code> from there, <code>A-1</code> for an appendix — and a reader looking at{' '}
        <code>iii</code> means that when they type it. The shell’s page box already does this: it shows the
        name, and it becomes a text input only when the names differ from the numbers. For a bar of your
        own, <code>usePdfPageLabels</code> asks the document — answering <code>null</code> when it declares
        nothing, which is the ordinary case, not a failure — and two pure functions carry both directions.
      </p>
      <pre>
        <code>{`import { formatPageLabel, resolvePageInput, usePdfPageLabels } from 'pdfjs-react-reader/headless';

const labels = usePdfPageLabels(doc);            // ['i','ii','iii','1',…] or null
const shown = formatPageLabel(labels, index);    // 'iii' — the name this page wears

// Label first, because that is what the reader copied: on that document "2" is the fifth page,
// not the second. A whole number naming no label clamps into the document; '3a' and 'xiv' are
// refused, so a box never jumps somewhere the reader did not ask for.
const target = resolvePageInput(typed, labels, doc.numPages);   // 1-based, or null
if (target !== null) scrollToPage(target);`}</code>
      </pre>

      <h2>Pure helpers</h2>
      <p>
        Everything the hooks are built from is exported too, so you can unit-test your own logic
        against it: <code>computeSlots</code>, <code>findVisibleRange</code>,{' '}
        <code>buildPageText</code>, <code>planFind</code>, <code>findPageMatches</code>,{' '}
        <code>countPerPage</code>, <code>planPrintPages</code>, <code>planPrintScale</code>,{' '}
        <code>strokePathD</code>, <code>drawInkStrokes</code>, <code>parseDestination</code>,{' '}
        <code>collectWidgets</code>, <code>readFormValues</code>, <code>resolveRenderScale</code>,{' '}
        <code>maxRenderPixelsFor</code>, <code>pdfAssetUrls</code>, <code>isAllowedSource</code>,{' '}
        <code>flattenOptionalContent</code>, <code>normalizeAttachments</code>,{' '}
        <code>automaticFitMode</code>, <code>normalizeSource</code>, <code>classifySource</code>,{' '}
        <code>base64ToBytes</code>, <code>formatPageLabel</code>, <code>resolvePageInput</code>,{' '}
        <code>readEditingState</code>,{' '}
        <code>readEditingParams</code>, <code>HIGHLIGHT_COLORS</code>,{' '}
        <code>HIGHLIGHT_PALETTE_STRING</code>. The three a replaceable find
        strategy needs — <code>planFind</code>, <code>findPageMatches</code>, <code>countPerPage</code>{' '}
        — are on the root entry as well, because <code>find</code> is a shell prop and a host should not
        have to import from two places to build one.
      </p>
    </>
  );
}
