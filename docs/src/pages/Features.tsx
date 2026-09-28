export function Features() {
  return (
    <>
      <h1>Features &amp; tiers</h1>
      <p className="doc-lede">
        Eight things a viewer can do to a document — print it, save it, fill it in, show its outline,
        switch its layers, hand over its attachments, mark it up, rearrange its pages — are values you
        import. The reason is
        arithmetic: measured against <code>0.3</code>,{' '}
        <code>PdfViewer</code> with every feature prop switched off cost <strong>24.09 kB</strong> gzipped
        against <strong>24.07 kB</strong> with them all on. A prop turns a control off. Only an import
        decides what your bundle contains.
      </p>

      <h2>The eight built-ins</h2>
      <table className="doc-table">
        <thead>
          <tr>
            <th>Entry</th>
            <th>Adds</th>
            <th>Stylesheet</th>
            <th>Cost over core</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>
              <code>pdfjs-react-reader/features/print</code>
            </td>
            <td>
              The toolbar control, the page-range selector, the <code>Ctrl/Cmd + P</code> binding, and
              the render-at-print-intent pipeline — all pages, the page on screen, or a range the
              reader types. Never offered on iOS, where there is no print dialog to open.
            </td>
            <td>
              <code>pdfjs-react-reader/print.css</code>
            </td>
            <td>2.50 kB</td>
          </tr>
          <tr>
            <td>
              <code>pdfjs-react-reader/features/download</code>
            </td>
            <td>
              Save. The original bytes, or — when <code>formsFeature</code> is mounted and something was
              edited — an incremental <code>saveDocument()</code> that keeps the fields interactive.
            </td>
            <td>none needed</td>
            <td>0.77 kB</td>
          </tr>
          <tr>
            <td>
              <code>pdfjs-react-reader/features/forms</code>
            </td>
            <td>
              Interactive AcroForm widgets: text, checkbox, radio, choice, button, writing into pdf.js
              annotation storage. Links and markup annotations are core and keep working without it.
            </td>
            <td>
              <code>pdfjs-react-reader/forms.css</code>
            </td>
            <td>1.91 kB</td>
          </tr>
          <tr>
            <td>
              <code>pdfjs-react-reader/features/outline</code>
            </td>
            <td>
              The bookmarks sidebar tab. Without it the sidebar has one tab, not two disabled ones.
            </td>
            <td>
              <code>pdfjs-react-reader/outline.css</code>
            </td>
            <td>0.93 kB</td>
          </tr>
          <tr>
            <td>
              <code>pdfjs-react-reader/features/layers</code>
            </td>
            <td>
              The optional-content sidebar tab: every layer the document declares, with what the
              document currently says about it, and a page redraw when the reader changes it. A layer
              switched from the sidebar and a layer switched by a document&apos;s own
              <code>SetOCGState</code> link are the same one object, so neither can leave the other
              showing a stale tick.
            </td>
            <td>
              <code>pdfjs-react-reader/layers.css</code>
            </td>
            <td>1.19 kB</td>
          </tr>
          <tr>
            <td>
              <code>pdfjs-react-reader/features/attachments</code>
            </td>
            <td>
              The embedded-files sidebar tab: name, description and a save per file, with the bytes
              read only when asked for. pdf.js 5 ships the content inside the attachment list and 6
              behind <code>getAttachmentContent()</code>; this feature reads either. A file that an
              annotation carries rather than the name tree names saves from the annotation itself —
              that path is core, so it works with or without this tab.
            </td>
            <td>
              <code>pdfjs-react-reader/attachments.css</code>
            </td>
            <td>1.10 kB</td>
          </tr>
          <tr>
            <td>
              <code>pdfjs-react-reader/features/annotate</code>
            </td>
            <td>
              Marking up the document: one pdf.js <code>AnnotationEditorUIManager</code> per document,
              three tools — highlight, free text, ink — a highlight colour from the engine&apos;s own
              palette, and a Delete enabled only while a mark is selected. The marks are PDF
              annotations, so they go back into the file on save and survive zoom, rotation and
              scrolling a page out of the way. It takes the shell&apos;s freehand toggle&apos;s place
              in the bar rather than sitting next to it, because this is the ink that saves.
            </td>
            <td>
              <code>pdfjs-react-reader/annotate.css</code>
            </td>
            <td>1.85 kB</td>
          </tr>
          <tr>
            <td>
              <code>pdfjs-react-reader/edit</code>
            </td>
            <td>
              The pages themselves, and a file that no longer needs a viewer. A <strong>Pages</strong>{' '}
              sidebar tab lists every page and moves, turns and removes them through a <em>plan</em>:
              rows answer to buttons or to a drag, each carries its own controls, and nothing is
              written until Apply. Apply then replaces the document on screen with the result, Extract
              hands the planned pages to the save dialog as a new file, and Split cuts the list at any
              row into two files. <strong>Flatten</strong> is the other half: it bakes every mark and
              field value into the page, so the marks survive a reader who opens the file somewhere with
              no editor to show them. The one tier with a dependency of its own —{' '}
              <code>@cantoo/pdf-lib</code>, an <em>optional</em> peer that nothing else imports.
            </td>
            <td>
              <code>pdfjs-react-reader/edit.css</code>
            </td>
            <td>3.60 kB</td>
          </tr>
        </tbody>
      </table>

      <p>
        The optional peer is arranged so that the two ways to be wrong are both loud and neither is
        silent. Not installing it and importing <code>pdfjs-react-reader/edit</code> is a bundler that
        cannot resolve the module — it fails at build, on the machine that made the choice. Not
        installing it and importing <em>anything else</em> is fine, including <code>tsc</code>: no shipped
        declaration file names the writer, because every value crossing that boundary is bytes and plain
        objects. The 245.5 kB the peer gzips to is therefore a decision you make once, at install, for the
        one capability that needs it.
      </p>

      <p>
        Cost is measured, not estimated, and the figures above are the <code>0.7</code> build
        (re-measured at each release close): <code>npm run size</code> bundles one file per
        consumer import with both esbuild and Rollup and reports the larger of the two, so a feature is
        only &ldquo;small&rdquo; if two independent tree-shakers agree. All eight together cost 14.44 kB
        over the <code>24.96 kB</code> core — less than their sum, because they share the shell they attach
        to. Every figure on this page is the cost of <em>one consumer import</em>, which is what your
        bundle pays, and none of them is the peer. Summing the shipped files of the whole root entry instead gives 52.78 kB, because
        that entry re-exports every headless hook whether or not you name one — so quote the import,
        not the entry.
      </p>

      <p>
        The panel is one of a feature&apos;s two surfaces — the other is the control — and it is a
        worked example of the contract: its <code>Runner</code> owns every hook (the plan, the undo
        stack, the byte snapshot, the writer calls), the panel reads that state through{' '}
        <code>usePdfFeatureState()</code> and owns no state of its own beyond what a drag needs, and
        the live region writes its text a task after the notice changes rather than rendering it
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
        A <code>create*Feature</code> factory exists for each feature with a knob:{' '}
        <code>{'scale'}</code> for print, <code>{'fileName'}</code> for download and for the edit tier,{' '}
        <code>{'onChange'}</code> for forms. Options are
        plain data on the feature value, so the component the shell mounts stays
        the same component between renders.
      </p>
      <p>
        Two things a mounted feature is subject to, both by its control&apos;s <code>id</code>.{' '}
        <a href="#/shell">The bar’s <code>controls</code> prop</a> can hide it, re-prioritise it or move
        it, exactly as it does for a built-in — and because the <code>Runner</code>s are mounted by{' '}
        <code>ViewerRoot</code> rather than by <code>PdfViewer</code> itself, a feature works unchanged
        in a layout you wrote. Hiding <code>print</code> is not the same as not importing it: the
        control leaves the bar, the bytes stay.
      </p>

      <h2>What a feature is</h2>
      <pre>
        <code>{`type PdfFeature<S> = {
  id: string;              // keys the Runner, and the name peers look you up by
  Runner?: ComponentType;  // the only place a feature may call hooks
  controls?: Array<{       // toolbar items, folded by the same planner as the built-ins
    id: string;
    priority: number;      // 1 stays in the bar to the end, 12 goes first
    label(labels, state): string;
    available?(state, shell): boolean;
    render: ComponentType;
  }>;
  panel?: { id: string; label(labels, state): string; render: ComponentType };
  keys?: Array<{ key: string; ctrl?: boolean; when?(state, shell): boolean; run(state, shell, event) }>;
  pageProps?(state): FeaturePageProps;  // merged into every rendered page
}`}</code>
      </pre>

      <p>
        The shape is not a style preference. Two failures made it, and both are silent:
      </p>
      <ul>
        <li>
          <strong>A feature contributes a component, never a hook the shell calls.</strong> A shell that
          ran one <code>useState</code> per feature threw <em>Rendered fewer hooks than expected</em> the
          first time the list changed length. The <code>Runner</code> owns the hooks; the shell mounts one
          per feature and never counts them.
        </li>
        <li>
          <strong>Runners are keyed by <code>id</code>, not position.</strong> Drop an unrelated feature
          from the array and an index key remounts the survivor, discarding its state with no error — a
          print job that forgot it was printing, a form that forgot what was typed. The array is expected
          to be rebuilt inline on every render, which is the ordinary way to write this, so the key is the
          only thing holding identity.
        </li>
      </ul>

      <h2>The authoring hooks</h2>
      <p>
        Exported from the package root, for a feature of your own — which is how <code>editFeature</code>, the newest of the eight, is written:
      </p>
      <ul>
        <li>
          <code>usePdfFeatureShell()</code> — the document, page, zoom and rotation,{' '}
          <code>scrollToPage</code>, the ink on each page, <code>reportError</code>, the resolved labels,
          and <code>documentLabel</code>.
        </li>
        <li>
          <code>usePdfFeaturePublish(state)</code> — call it from the <code>Runner</code>. A one-level
          shallow compare is what keeps a rebuilt object from re-rendering the viewer forever, so publish
          primitives and stable references, not fresh nested objects.
        </li>
        <li>
          <code>usePdfFeatureState()</code> — read it back in a control or panel. It is <code>{'{}'}</code>{' '}
          on the first pass, before the Runner’s effect has run, so destructure with defaults.
        </li>
        <li>
          <code>usePdfFeaturePeer(id)</code> — another feature’s state. <code>{'{}'}</code> when that
          feature is not mounted, which is how download knows not to save edits that no longer exist.
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
        One rule the shell cannot enforce for you: a control’s <code>render</code> is mounted up to three
        times — the off-screen row that measures it, the bar, and the overflow menu — so a control reads
        state and never owns it. Anything with a hook belongs in the <code>Runner</code>.
      </p>

      <h2>Stylesheets, per tier</h2>
      <p>
        <code>styles.css</code> carries the core chrome and nothing else; the widget, print, outline, layer, attachment, editor and page-list rules live in their own sheets so a viewer that mounted neither ships neither. They are separate{' '}
        <code>import</code> statements on purpose: a bundler strips CSS that no JavaScript file imports,
        and every attempt to smuggle a feature’s stylesheet inside its module ends with the import removed
        and the styles silently missing. <code>{'sideEffects: ["**/*.css"]'}</code> is what exempts them
        from the shaking.
      </p>

      <h2>The Pages tab, in its own words</h2>
      <p>
        A panel is a feature&apos;s other surface, and this one earned the right to exist by not being
        bolted onto something core: thumbnails stay core, the rows that reorder them are the tier&apos;s.
        Four things about what it shows are worth stating, because each one looked like a bug to the
        person who wrote it.
      </p>
      <ul>
        <li>
          <strong>A row&apos;s label numbers the page in the file being edited, not a permanent name.</strong>{' '}
          After an apply the list renumbers — the page that read &ldquo;Page 2 of 20&rdquo; is
          &ldquo;Page 1 of 20&rdquo; in the document now on screen. That is what makes a second apply
          compose against the new file rather than the old one.
        </li>
        <li>
          <strong>The angle badge means &ldquo;changed here&rdquo;, not &ldquo;what the file
          says&rdquo;.</strong> A page that arrived already rotated shows no badge, and the badge
          disappears once applied. Reading every page&apos;s own <code>/Rotate</code> would mean a worker
          round trip per page — a thousand of them for a thousand rows — for a decoration, so the panel
          reports only what the reader changed in this session.
        </li>
        <li>
          <strong>Nothing is written until Apply.</strong> Moves, turns and removals edit an array, so a
          batch is undone by stepping a stack with no bytes touched; Apply is the one write, and
          &ldquo;Undo the last apply&rdquo; restores from the single byte snapshot the tier holds. It is
          one deep, and its button disables behind it, so the offer and the memory match.
        </li>
        <li>
          <strong>Split makes two files, not five.</strong> A reader who wants equal parts can split
          twice; a fourth download in one click is where a browser puts a permission prompt the viewer
          cannot honestly earn. So the row says &ldquo;Split the list here&rdquo; and cuts at that slot
          rather than offering a count.
        </li>
      </ul>
      <p>
        The same writer answers for <strong>Flatten</strong>, which is what makes marks survive outside a
        viewer: <code>downloadFeature</code> can only add an incremental update, so the fields stay
        interactive and a mark is still an object a renderer may choose not to draw. Flattening bakes them
        into the page. Both are one import, and the pure helpers — <code>arrangePages</code>,{' '}
        <code>flattenBytes</code>, the page-plan functions — are exported for a host who wants the
        mechanism without the panel.
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
              <code>{'features={[printFeature]}'}</code>,{' '}
              <code>{'createPrintFeature({ scale })'}</code>
            </td>
          </tr>
          <tr>
            <td>
              <code>enableDownload</code>, <code>downloadFileName</code>
            </td>
            <td>
              <code>{'features={[downloadFeature]}'}</code>,{' '}
              <code>{'createDownloadFeature({ fileName })'}</code>
            </td>
          </tr>
          <tr>
            <td>
              <code>renderForms</code>, <code>onFormValuesChange</code>
            </td>
            <td>
              <code>{'features={[formsFeature]}'}</code>,{' '}
              <code>{'createFormsFeature({ onChange })'}</code>
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
        The defaults are the change: <code>{'<PdfViewer src />'}</code> used to mean print, save,
        fillable widgets and the outline tab, and now means a viewer that reads. Add the four features to
        get the old behaviour back, byte for byte nothing else moved.
      </p>

      <h2>Where to look next</h2>
      <ul>
        <li>
          The <a href="#/shell">drop-in viewer</a> example has one checkbox per feature, so you can watch
          a control leave the toolbar and its bytes leave the bundle.
        </li>
        <li>
          <a href="#/headless">Headless hooks</a> are what a feature wraps — <code>usePdfPrint</code>,{' '}
          <code>usePdfDownload</code>, <code>usePdfFormValues</code>, <code>usePdfOutline</code>,{' '}
          <code>usePdfOptionalContent</code> and <code>usePdfAttachments</code> are public on their own,
          with or without this shell.
        </li>
        <li>
          <a href="#/compatibility">Versions &amp; compatibility</a> carries the measured per-tier numbers.
        </li>
      </ul>
    </>
  );
}
