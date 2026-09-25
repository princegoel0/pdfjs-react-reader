export function Features() {
  return (
    <>
      <h1>Features &amp; tiers</h1>
      <p className="doc-lede">
        Four things a viewer can do to a document — print it, save it, fill it in, show its outline — are
        values you import. The reason is arithmetic: measured against <code>0.3</code>,{' '}
        <code>PdfViewer</code> with every feature prop switched off cost <strong>24.09 kB</strong> gzipped
        against <strong>24.07 kB</strong> with them all on. A prop turns a control off. Only an import
        decides what your bundle contains.
      </p>

      <h2>The four built-ins</h2>
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
              The toolbar control, the <code>Ctrl/Cmd + P</code> binding, and the render-every-page
              pipeline. Never offered on iOS, where there is no print dialog to open.
            </td>
            <td>
              <code>pdfjs-react-reader/print.css</code>
            </td>
            <td>2.02 kB</td>
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
            <td>0.86 kB</td>
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
            <td>1.99 kB
          </td>
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
        </tbody>
      </table>

      <p>
        Cost is measured, not estimated: <code>npm run size</code> bundles one file per consumer import
        with both esbuild and Rollup and reports the larger of the two, so a feature is only
        &ldquo;small&rdquo; if two independent tree-shakers agree. All four together cost 5.18 kB over the{' '}
        <code>20.61 kB</code> core — less than their sum, because they share the shell they attach to.
        Every figure on this page is the cost of <em>one consumer import</em>, which is what your bundle
        pays. Summing the shipped files of the whole root entry instead gives 44.01 kB, because that
        entry re-exports every headless hook whether or not you name one — so quote the import, not the
        entry.
      </p>

      <pre>
        <code>{`import { PdfViewer } from 'pdfjs-react-reader';
import { printFeature } from 'pdfjs-react-reader/features/print';
import { createFormsFeature } from 'pdfjs-react-reader/features/forms';
import 'pdfjs-react-reader/styles.css';
import 'pdfjs-react-reader/print.css';
import 'pdfjs-react-reader/forms.css';

const forms = createFormsFeature({ onChange: (values) => save(values) });

<PdfViewer src="/contract.pdf" features={[printFeature, forms]} />;`}</code>
      </pre>

      <p>
        A <code>create*Feature</code> factory exists for the feature with a knob:{' '}
        <code>{'scale'}</code> for print, <code>{'fileName'}</code> for download, <code>{'onChange'}</code>{' '}
        for forms. Options are plain data on the feature value, so the component the shell mounts stays
        the same component between renders.
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
        Exported from the package root, for a feature of your own — annotation editing in the roadmap
        starts here:
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
        <code>styles.css</code> carries the core chrome and nothing else; the widget, print and outline
        rules live in their own sheets so a viewer that mounted neither ships neither. They are separate{' '}
        <code>import</code> statements on purpose: a bundler strips CSS that no JavaScript file imports,
        and every attempt to smuggle a feature’s stylesheet inside its module ends with the import removed
        and the styles silently missing. <code>{'sideEffects: ["**/*.css"]'}</code> is what exempts them
        from the shaking.
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
          <code>usePdfDownload</code>, <code>usePdfFormValues</code>, <code>usePdfOutline</code> are public
          on their own, with or without this shell.
        </li>
        <li>
          <a href="#/compatibility">Versions &amp; compatibility</a> carries the measured per-tier numbers.
        </li>
      </ul>
    </>
  );
}
