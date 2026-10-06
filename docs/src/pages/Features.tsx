import figures from '../size-figures.json';

/** The size column is rendered, not typed: `npm run size` writes the file this reads. */
const cost = (value: number) => `${value.toFixed(2)} kB`;
const peer = (key: 'engineMain' | 'engineWorker' | 'writer') => {
  const entry = figures.peers[key];
  return entry ? `${entry.kB.toFixed(1)} kB` : 'not installed where this was built';
};

export function Features() {
  return (
    <>
      <h1>Features &amp; tiers</h1>
      <p className="doc-lede">
        Nine things a viewer can do to a document — print it, save it, fill it in, show its outline, switch its layers,
        hand over its attachments, mark it up, rearrange its pages, read its structure to a screen reader — are values
        you import. The reason is arithmetic: measured on the build where the comparison was made,{' '}
        <code>PdfViewer</code> with every switch off — wheel, pinch, fullscreen, keys, drop, and{' '}
        <code>controls.hide</code> over the whole bar — cost <strong>90 bytes more</strong> gzipped than the same viewer
        left at its defaults, which is byte-for-byte the plain <code>src</code> import. Turning controls off cost a
        little more than leaving them on, because saying &ldquo;hide&rdquo; is itself code. Only an import decides what
        your bundle contains. That pair was measured by hand rather than by <code>npm run size</code> (in #223&rsquo;s
        pass, on the core of that day), so read it as the direction and{' '}
        <a href="#/compatibility">Versions &amp; compatibility</a> for the figures this build produced.
      </p>

      <h2>The nine built-ins</h2>
      <table className="doc-table">
        <thead>
          <tr>
            <th>Entry</th>
            <th>Adds</th>
            <th>Stylesheet</th>
            <th>Cost over core, measured {figures.measuredOn}</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>
              <code>pdfjs-react-reader/features/print</code>
            </td>
            <td>
              The toolbar control, the page-range selector, the <code>Ctrl/Cmd + P</code> binding, and the
              render-at-print-intent pipeline — all pages, the page on screen, or a range the reader types. Never
              offered on iOS, where there is no print dialog to open.
            </td>
            <td>
              <code>pdfjs-react-reader/print.css</code>
            </td>
            <td>{cost(figures.overCore.print)}</td>
          </tr>
          <tr>
            <td>
              <code>pdfjs-react-reader/features/download</code>
            </td>
            <td>
              Save. The original bytes, or — when <code>formsFeature</code> is mounted and something was edited — an
              incremental <code>saveDocument()</code> that keeps the fields interactive.
            </td>
            <td>none needed</td>
            <td>{cost(figures.overCore.download)}</td>
          </tr>
          <tr>
            <td>
              <code>pdfjs-react-reader/features/forms</code>
            </td>
            <td>
              Interactive AcroForm widgets: text, checkbox, radio, choice, button, writing into pdf.js annotation
              storage. Links and markup annotations are core and keep working without it.
            </td>
            <td>
              <code>pdfjs-react-reader/forms.css</code>
            </td>
            <td>{cost(figures.overCore.forms)}</td>
          </tr>
          <tr>
            <td>
              <code>pdfjs-react-reader/features/outline</code>
            </td>
            <td>
              The bookmarks sidebar tab. A click lands where the bookmark points, not merely on the page it names — the
              destination’s own position, and its magnification when it asks for one. Without this feature the sidebar
              has one tab, not two disabled ones.
            </td>
            <td>
              <code>pdfjs-react-reader/outline.css</code>
            </td>
            <td>{cost(figures.overCore.outline)}</td>
          </tr>
          <tr>
            <td>
              <code>pdfjs-react-reader/features/layers</code>
            </td>
            <td>
              The optional-content sidebar tab: every layer the document declares, with what the document currently says
              about it, and a page redraw when the reader changes it. A layer switched from the sidebar and a layer
              switched by a document&apos;s own
              <code>SetOCGState</code> link are the same one object, so neither can leave the other showing a stale
              tick.
            </td>
            <td>
              <code>pdfjs-react-reader/layers.css</code>
            </td>
            <td>{cost(figures.overCore.layers)}</td>
          </tr>
          <tr>
            <td>
              <code>pdfjs-react-reader/features/attachments</code>
            </td>
            <td>
              The embedded-files sidebar tab: name, description and a save per file, with the bytes read only when asked
              for. pdf.js 5 ships the content inside the attachment list and 6 behind{' '}
              <code>getAttachmentContent()</code>; this feature reads either. A file that an annotation carries rather
              than the name tree names saves from the annotation itself — that path is core, so it works with or without
              this tab.
            </td>
            <td>
              <code>pdfjs-react-reader/attachments.css</code>
            </td>
            <td>{cost(figures.overCore.attachments)}</td>
          </tr>
          <tr>
            <td>
              <code>pdfjs-react-reader/features/annotate</code>
            </td>
            <td>
              Marking up the document: one pdf.js <code>AnnotationEditorUIManager</code> per document, three tools —
              highlight, free text, ink — a highlight colour from the engine&apos;s own palette, and a Delete enabled
              only while a mark is selected. The marks are PDF annotations, so they go back into the file on save and
              survive zoom, rotation and scrolling a page out of the way. It is the only ink the package draws (FR-18
              withdrew the core freehand surface), and this is the one that saves. The three are the whole list, and the
              reason is said here rather than found at save time (FR-29): stamp and the engine&apos;s signature editor
              were measured to break <code>saveDocument()</code> rather than refuse politely —<code>pdfjs-dist</code>{' '}
              exports no <code>SignatureManager</code> to give one, and an image-less stamp throws in the worker — and
              underline, strikeout and squiggly are absent because the engine gives its editors no subtype to build them
              on.
            </td>
            <td>
              <code>pdfjs-react-reader/annotate.css</code>
            </td>
            <td>{cost(figures.overCore.annotate)}</td>
          </tr>
          <tr>
            <td>
              <code>pdfjs-react-reader/features/structure</code>
            </td>
            <td>
              The structure tree the document already carries, as accessibility structure: a tagged PDF says which of
              its words are a heading, a list item, a table cell or a figure and what that figure&apos;s alternative
              text is, and this is what turns that into <code>role</code>d elements owning the text spans they describe.
              No control, no panel, no key — the tree is how the page <em>is</em>, not a view of it. Its cost is this
              row&apos;s last column; the ~50 kB of pdf.js viewer it reads is a lazy <code>import()</code> taken only
              for a document that declares itself tagged, and it is fetched at runtime, so it is not in your bundle and
              not in this table. One part of it needs a newer engine than the package does: a link given the words it
              sits over is <code>6.3.289</code> and up, and the tier says so on{' '}
              <code>engineRequirements</code> and through the <code>linkOwnershipAvailable</code> flag in its state, so
              a host on <code>6.2.108</code> reads which half it has rather than discovering it.
            </td>
            <td>
              <code>pdfjs-react-reader/structure.css</code>
            </td>
            <td>{cost(figures.overCore.structure)}</td>
          </tr>
          <tr>
            <td>
              <code>pdfjs-react-reader/edit</code>
            </td>
            <td>
              The pages themselves, and a file that no longer needs a viewer. A <strong>Pages</strong> sidebar tab lists
              every page and moves, turns and removes them through a <em>plan</em>: rows answer to buttons or to a drag,
              each carries its own controls, and nothing is written until Apply. Apply then replaces the document on
              screen with the result, Extract hands the planned pages to the save dialog as a new file, and Split cuts
              the list at any row into two files. <strong>Flatten</strong> is the other half: it bakes every mark and
              field value into the page, so the marks survive a reader who opens the file somewhere with no editor to
              show them. One of the two tiers with a dependency of its own — <code>@cantoo/pdf-lib</code>, an{' '}
              <em>optional</em> peer that nothing else imports. Merging two documents into a third is the other, and it
              lives on its own entry point instead of in a feature, because a merge is a way to get a document rather
              than a control over the one on screen: see <a href="#/recipes">Recipes</a>.
            </td>
            <td>
              <code>pdfjs-react-reader/edit.css</code>
            </td>
            <td>{cost(figures.overCore.edit)}</td>
          </tr>
        </tbody>
      </table>

      <p>
        The optional peer is arranged so that the two ways to be wrong are both loud and neither is silent. Not
        installing it and importing <code>pdfjs-react-reader/edit</code> or <code>pdfjs-react-reader/merge</code> is a
        bundler that cannot resolve the module — it fails at build, on the machine that made the choice. Not installing
        it and importing <em>anything else</em> is fine, including <code>tsc</code>: no shipped declaration file names
        the writer, because every value crossing that boundary is bytes and plain objects. The {peer('writer')} the peer
        gzips to is therefore a decision you make once, at install, for the one library that needs it.
      </p>

      <p>
        Cost is measured, not estimated: <code>npm run size</code> bundles one file per consumer import with both
        esbuild and Rollup and reports the larger of the two, so a feature is only &ldquo;small&rdquo; if two
        independent tree-shakers agree, and the numbers on this page are the ones it wrote on {figures.measuredOn}. All
        nine together cost {cost(figures.overCore.all)}
        over the <code>{cost(figures.kB['core'])}</code> core — less than their sum, because they share the shell they
        attach to. Every figure on this page is the cost of <em>one consumer import</em>, which is what your bundle
        pays, and none of them is the peer. Summing the shipped files of the whole root entry instead gives{' '}
        {cost(figures.kB['shell'])}, because that entry re-exports every headless hook whether or not you name one — so
        quote the import, not the entry. One caveat about the base figure itself: adding an entry point reshuffles the
        shared chunks that every path is built from, so <code>core</code> moves a little at each release for reasons
        that are not about the feature being added. The <em>over core</em> column nets that out, and it is the one to
        read.
      </p>

      <p>
        The panel is one of a feature&apos;s two surfaces — the other is the control — and it is a worked example of the
        contract: its <code>Runner</code> owns every hook (the plan, the undo stack, the byte snapshot, the writer
        calls), the panel reads that state through <code>usePdfFeatureState()</code> and owns no state of its own beyond
        what a drag needs, and the live region writes its text a task after the notice changes rather than rendering it
        straight, because a region that mounts already holding its words announces nothing.
      </p>

      <pre>
        <code>{`import { PdfViewer } from 'pdfjs-react-reader';
import { printFeature } from 'pdfjs-react-reader/features/print';
import { createFormsFeature } from 'pdfjs-react-reader/features/forms';
import { createEditFeature } from 'pdfjs-react-reader/edit';
import 'pdfjs-react-reader/styles.css';
import 'pdfjs-react-reader/print.css';
import 'pdfjs-react-reader/forms.css';
import 'pdfjs-react-reader/edit.css';

const forms = createFormsFeature({ onChange: (values) => save(values) });
const edit = createEditFeature({ fileName: 'contract-edited.pdf' });

<PdfViewer src="/contract.pdf" features={[printFeature, forms, edit]} />;`}</code>
      </pre>

      <p>
        A <code>create*Feature</code> factory exists for each feature with a knob: <code>{'scale'}</code> for print,{' '}
        <code>{'fileName'}</code> for download and for the edit tier, <code>{'onChange'}</code> for forms, and{' '}
        <code>{'signal'}</code> for the edit tier — an <code>AbortSignal</code> that stops a writer pass between its
        pages, which is the one operation long enough to want it. Options are plain data on the feature value, so the
        component the shell mounts stays the same component between renders.
      </p>
      <p>
        Two things a mounted feature is subject to, both by its control&apos;s <code>id</code>.{' '}
        <a href="#/shell">
          The bar’s <code>controls</code> prop
        </a>{' '}
        can hide it, re-prioritise it or move it, exactly as it does for a built-in — and because the{' '}
        <code>Runner</code>s are mounted by <code>ViewerRoot</code> rather than by <code>PdfViewer</code> itself, a
        feature works unchanged in a layout you wrote. Hiding <code>print</code> is not the same as not importing it:
        the control leaves the bar, the bytes stay.
      </p>

      <h2>What a feature is</h2>
      <pre>
        <code>{`type PdfFeature<S> = {
  id: string;              // keys the Runner, and the name peers look you up by
  dependsOn?: string[];    // features this one requires, validated before anything mounts
  Runner?: ComponentType;  // the only place a feature may call hooks
  controls?: Array<{       // toolbar items, folded by the same planner as the built-ins
    id: string;
    priority: number;      // 1 stays in the bar to the end, 12 goes first
    label(labels, state): string;
    available?(state, shell): boolean;
    render: ComponentType;
  }>;
  replaces?: string[];     // built-in control ids this feature takes over
  panel?: { id: string; label(labels, state): string; render: ComponentType };
  keys?: Array<{ key: string; ctrl?: boolean; when?(state, shell): boolean; run(state, shell, event) }>;
  pageProps?(state): FeaturePageProps;  // merged into every rendered page
  stylesheets?: string[];  // the sheets your chrome needs, declared rather than assumed
  cleanup?(): void;        // releases what the Runner never held
}`}</code>
      </pre>

      <p>The shape is not a style preference. Two failures made it, and both are silent:</p>
      <ul>
        <li>
          <strong>A feature contributes a component, never a hook the shell calls.</strong> A shell that ran one{' '}
          <code>useState</code> per feature threw <em>Rendered fewer hooks than expected</em> the first time the list
          changed length. The <code>Runner</code> owns the hooks; the shell mounts one per feature and never counts
          them.
        </li>
        <li>
          <strong>
            Runners are keyed by <code>id</code>, not position.
          </strong>{' '}
          Drop an unrelated feature from the array and an index key remounts the survivor, discarding its state with no
          error — a print job that forgot it was printing, a form that forgot what was typed. The array is expected to
          be rebuilt inline on every render, which is the ordinary way to write this, so the key is the only thing
          holding identity.
        </li>
      </ul>

      <h2>The authoring hooks</h2>
      <p>
        Exported from the package root, for a feature of your own — which is how <code>editFeature</code> and{' '}
        <code>structureFeature</code>, the two newest, are written:
      </p>
      <ul>
        <li>
          <code>usePdfFeatureShell()</code> — the document, page, zoom and rotation, <code>scrollToPage</code>,{' '}
          <code>reportError</code>, the resolved labels, and <code>documentLabel</code>.
        </li>
        <li>
          <code>usePdfFeaturePublish(state)</code> — call it from the <code>Runner</code>. A one-level shallow compare
          is what keeps a rebuilt object from re-rendering the viewer forever, so publish primitives and stable
          references, not fresh nested objects.
        </li>
        <li>
          <code>usePdfFeatureState()</code> — read it back in a control or panel. It is <code>{'{}'}</code> on the first
          pass, before the Runner’s effect has run, so destructure with defaults.
        </li>
        <li>
          <code>usePdfFeaturePeer(id)</code> — another feature’s state. <code>{'{}'}</code> when that feature is not
          mounted, which is how download knows not to save edits that no longer exist.
        </li>
        <li>
          <code>usePdfFeatureOptions()</code> — what the <code>create*Feature</code> call passed in.
        </li>
      </ul>

      <pre>
        <code>{`import { usePdfFeaturePublish, usePdfFeatureShell, usePdfFeatureState } from 'pdfjs-react-reader';
import type { PdfFeature } from 'pdfjs-react-reader';

function ProgressRunner() {
  const shell = usePdfFeatureShell();
  usePdfFeaturePublish({
    percent: shell.numPages ? Math.round((shell.currentPage / shell.numPages) * 100) : 0,
  });
  return null;
}

function ProgressBar() {
  const { percent = 0 } = usePdfFeatureState<{ percent?: number }>();
  return <progress className="pjsr-badge" value={percent} max={100} aria-label="Reading progress" />;
}

export const progressFeature: PdfFeature = {
  id: 'progress',
  Runner: ProgressRunner,
  controls: [{ id: 'progress', priority: 11, label: (l) => l.pageOf, render: ProgressBar }],
};`}</code>
      </pre>

      <p>
        One rule the shell cannot enforce for you: a control’s <code>render</code> is mounted up to three times — the
        off-screen row that measures it, the bar, and the overflow menu — so a control reads state and never owns it.
        Anything with a hook belongs in the <code>Runner</code>.
      </p>

      <h2>Stylesheets, per tier</h2>
      <p>
        <code>styles.css</code> carries the core chrome and nothing else; the widget, print, outline, layer, attachment,
        editor and page-list rules live in their own sheets so a viewer that mounted neither ships neither. They are
        separate <code>import</code> statements on purpose: a bundler strips CSS that no JavaScript file imports, and
        every attempt to smuggle a feature’s stylesheet inside its module ends with the import removed and the styles
        silently missing. <code>{'sideEffects: ["**/*.css"]'}</code> is what exempts them from the shaking.
      </p>

      <h2>Registration is validated, not hoped over</h2>
      <p>
        A feature list is checked before a single Runner mounts, and three shapes of list are refused with{' '}
        <code>PdfError</code> whose <code>code</code> is <code>CONFIGURATION_ERROR</code>: two features under one{' '}
        <code>id</code>, a <code>dependsOn</code> naming a feature that is not in the list, and a dependency cycle. The
        message names the feature and the problem, and <code>details.problem</code> says which of the three it was —{' '}
        <code>{'duplicate-id'}</code>, <code>{'missing-dependency'}</code>, <code>{'dependency-cycle'}</code> — so a
        host can branch on it without reading prose.
      </p>
      <p>
        The refusal throws rather than calling <code>onError</code>, because it is a mistake in a component tree rather
        than something that happened to a document: the viewer renders nothing, and the error reaches your error
        boundary with the feature id in it. A duplicate is refused rather than resolved because two features under one
        id leave a control reading state that belongs to neither copy, and that is discovered by losing work rather than
        by an error.
      </p>
      <pre>
        <code>{`import { orderFeatures } from 'pdfjs-react-reader';

// The shell does this itself. You need it only to build your own bar, or your own
// mergeFeaturePageProps call, from the same order the Runners were mounted in.
const list = [markupFeature, formsFeature, printFeature]; // markupFeature: dependsOn ['forms']

orderFeatures(list);
// → [forms, markup, print]: the dependency first, and everything else in the order written.
// A list with no dependencies at all comes back as the very array you passed.`}</code>
      </pre>
      <p>
        Registration order is the order the shell resolves every tie in: which Runner initialises first, which feature
        has the last word on a page contribution (the later one), which of two equal-priority controls stays in the bar
        when it folds, and which feature claims a chord both of them bind (the first one). Where two features have no
        dependency between them, that order is the order you wrote.
      </p>

      <h2>Lifecycle, stylesheets, and what a feature may import</h2>
      <ul>
        <li>
          <strong>A feature&apos;s stylesheet is declared, not discovered.</strong> <code>stylesheets</code> on the
          value lists the published specifiers its chrome needs —<code>pdfjs-react-reader/annotate.css</code> and so on,
          never the core sheet, which every shell consumer imports anyway. The shell does not load them: CSS has no
          runtime import a bundler can tree-shake, so the application does, and the field exists so that decision can be
          read off the list before anything is registered. The built-ins are cross-checked against the package&apos;s
          export map, so a declaration that names an unpublished sheet — or a tier that stops declaring one it needs —
          fails the build.
        </li>
        <li>
          <strong>Cleanup is for what outlives the component.</strong> The shell calls <code>cleanup</code> once when a
          feature leaves the list or the viewer unmounts, after retiring the state peers read. It runs <em>before</em>{' '}
          that feature&apos;s Runner effect cleanups, because that is how React tears a deleted subtree down, so a
          resource the Runner acquired belongs in the Runner and <code>cleanup</code> belongs to what it never held — an
          object URL kept across documents, a module-level table. None of the built-ins needs one.
        </li>
        <li>
          <strong>A feature cannot reach upward, and cannot reach sideways.</strong> No module under{' '}
          <code>src/lib</code>, <code>src/headless</code> or <code>src/components</code> imports a tier, which is what
          keeps an unused feature out of your bundle; <code>npm run size</code> proves it from the built artifact and a
          source test names the import if it ever appears. And a feature never imports another feature: peers are read
          by <code>id</code> through <code>usePdfFeaturePeer</code>, with <code>src/lib/feature-ids.ts</code> as the
          string-only module that makes naming a peer possible without pulling it in.
        </li>
      </ul>

      <h2>The Pages tab, in its own words</h2>
      <p>
        A panel is a feature&apos;s other surface, and this one earned the right to exist by not being bolted onto
        something core: thumbnails stay core, the rows that reorder them are the tier&apos;s. Four things about what it
        shows are worth stating, because each one looked like a bug to the person who wrote it.
      </p>
      <ul>
        <li>
          <strong>A row&apos;s label numbers the page in the file being edited, not a permanent name.</strong> After an
          apply the list renumbers — the page that read &ldquo;Page 2 of 20&rdquo; is &ldquo;Page 1 of 20&rdquo; in the
          document now on screen. That is what makes a second apply compose against the new file rather than the old
          one.
        </li>
        <li>
          <strong>The angle badge means &ldquo;changed here&rdquo;, not &ldquo;what the file says&rdquo;.</strong> A
          page that arrived already rotated shows no badge, and the badge disappears once applied. Reading every
          page&apos;s own <code>/Rotate</code> would mean a worker round trip per page — a thousand of them for a
          thousand rows — for a decoration, so the panel reports only what the reader changed in this session.
        </li>
        <li>
          <strong>Nothing is written until Apply.</strong> Moves, turns and removals edit an array, so a batch is undone
          by stepping a stack with no bytes touched; Apply is the one write, and &ldquo;Undo the last apply&rdquo;
          restores from the single byte snapshot the tier holds. It is one deep, and its button disables behind it, so
          the offer and the memory match.
        </li>
        <li>
          <strong>Split makes two files, not five.</strong> A reader who wants equal parts can split twice; a fourth
          download in one click is where a browser puts a permission prompt the viewer cannot honestly earn. So the row
          says &ldquo;Split the list here&rdquo; and cuts at that slot rather than offering a count.
        </li>
      </ul>
      <p>
        The same writer answers for <strong>Flatten</strong>, which is what makes marks survive outside a viewer:{' '}
        <code>downloadFeature</code> can only add an incremental update, so the fields stay interactive and a mark is
        still an object a renderer may choose not to draw. Flattening bakes them into the page. Both are one import, and
        the pure helpers — <code>arrangePages</code>, <code>flattenBytes</code>, the page-plan functions — are exported
        for a host who wants the mechanism without the panel.
      </p>

      <h2>Upgrading from 0.3</h2>
      <table className="doc-table">
        <thead>
          <tr>
            <th>0.3</th>
            <th>0.4</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>
              <code>enablePrint</code>, <code>printScale</code>
            </td>
            <td>
              <code>{'features={[printFeature]}'}</code>, <code>{'createPrintFeature({ scale })'}</code>
            </td>
          </tr>
          <tr>
            <td>
              <code>enableDownload</code>, <code>downloadFileName</code>
            </td>
            <td>
              <code>{'features={[downloadFeature]}'}</code>, <code>{'createDownloadFeature({ fileName })'}</code>
            </td>
          </tr>
          <tr>
            <td>
              <code>renderForms</code>, <code>onFormValuesChange</code>
            </td>
            <td>
              <code>{'features={[formsFeature]}'}</code>, <code>{'createFormsFeature({ onChange })'}</code>
            </td>
          </tr>
          <tr>
            <td>outline tab, always there</td>
            <td>
              <code>{'features={[outlineFeature]}'}</code>
            </td>
          </tr>
        </tbody>
      </table>
      <p>
        The defaults are the change: <code>{'<PdfViewer src />'}</code> used to mean print, save, fillable widgets and
        the outline tab, and now means a viewer that reads. Add the four features to get the old behaviour back, byte
        for byte nothing else moved.
      </p>

      <h2>Where to look next</h2>
      <ul>
        <li>
          The <a href="#/shell">drop-in viewer</a> example has one checkbox per feature, so you can watch a control
          leave the toolbar and its bytes leave the bundle.
        </li>
        <li>
          <a href="#/headless">Headless hooks</a> are what a feature wraps — <code>usePdfPrint</code>,{' '}
          <code>usePdfDownload</code>, <code>usePdfFormValues</code>, <code>usePdfOutline</code>,{' '}
          <code>usePdfOptionalContent</code> and <code>usePdfAttachments</code> are public on their own, with or without
          this shell.
        </li>
        <li>
          <a href="#/compatibility">Versions &amp; compatibility</a> carries the measured per-tier numbers.
        </li>
      </ul>
    </>
  );
}
