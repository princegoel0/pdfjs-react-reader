import { useEffect, useState } from 'react';
import { usePdfFeaturePublish, usePdfFeatureShell } from '../components/FeatureHost';
import { STRUCTURE_FEATURE_ID } from './ids';
import type { PdfFeature, PdfStructTreeLayerBuilder } from '../lib/features';

export interface StructureFeatureState {
  /** pdf.js's builder, from the moment it has been fetched and the document has said it is tagged. */
  structTreeLayerBuilder: PdfStructTreeLayerBuilder | null;
}

/**
 * Fetch the one viewer class this feature needs.
 *
 * `pdfjs-dist/web/pdf_viewer.mjs` is a 320 kB pre-bundled viewer that does not tree-shake: importing
 * `StructTreeLayerBuilder` from it statically costs a consumer ≈50 kB gzipped, about 1.8× this package's
 * whole core. Lazily importing it does not make those bytes free, but it moves them out of the bundle the
 * application ships and into a chunk the browser fetches only for a document that declared a structure
 * tree — which `src/lib/tagged.test.ts` measures as the exception rather than the rule.
 */
async function loadStructTreeLayerBuilder(): Promise<PdfStructTreeLayerBuilder> {
  const viewer = await import('pdfjs-dist/web/pdf_viewer.mjs');
  return viewer.StructTreeLayerBuilder as unknown as PdfStructTreeLayerBuilder;
}

/**
 * The document's own `Marked` flag.
 *
 * `getMarkInfo()` is declared to resolve with a "MarkInfo object" and resolves, in fact, with a `Map`
 * keyed `Marked` / `UserProperties` / `Suspects` — measured in Chromium against `tagged-sample.pdf`. Both
 * shapes are read because the two sources disagree and nothing in the package's own types says which one
 * arrives: the first version of this gate read the property, found `undefined` on a Map, and so reported
 * every tagged document in the world as untagged — silently, with no console line and no failing test,
 * because the fake document in the test had been written as an object too. `src/lib/tagged.test.ts` now
 * pins the real engine's shape, which is where a change upstream would be noticed.
 */
function isMarkedDocument(info: unknown): boolean {
  if (info === null || info === undefined) return false;
  const marked = info instanceof Map ? info.get('Marked') : (info as { Marked?: boolean }).Marked;
  return marked === true;
}

function StructureRunner() {
  const { doc, reportError } = usePdfFeatureShell();
  const [builder, setBuilder] = useState<PdfStructTreeLayerBuilder | null>(null);

  useEffect(() => {
    let cancelled = false;
    setBuilder(null);
    if (!doc) return;

    /*
     * Asked of the document, not of a page: the transport memoises `GetMetadata` but *not*
     * `GetStructTree`, so a per-page probe clones that page's whole tree to the main thread twice — once
     * for the check, and once again inside the builder's constructor, which calls the same method and
     * cannot be handed the answer.
     *
     * A file that declares `Marked true` and carries no `/StructTreeRoot` still pays the chunk: the
     * builder resolves `null` from the tree fetch and the page mounts nothing, which is the honest price of
     * trusting the declaration the specification asks producers to make.
     */
    (async () => {
      if (!isMarkedDocument(await doc.getMarkInfo()) || cancelled) return;
      const loaded = await loadStructTreeLayerBuilder();
      // The function form because a constructor *is* a function: `setBuilder(loaded)` would be read as an
      // updater, called with the previous state, and hand the pages a freshly built layer instance rather
      // than the class they asked for.
      if (!cancelled) setBuilder(() => loaded);
    })().catch((err: unknown) => {
      // A structure tree is an overlay on a page that already reads fine, so this goes to `onError` and
      // nowhere else: the page keeps painting, and turning a missing a11y layer into a load failure would
      // tell the reader their document is broken when it is not.
      if (!cancelled) reportError(err instanceof Error ? err : new Error(String(err)));
    });

    return () => {
      cancelled = true;
    };
  }, [doc, reportError]);

  usePdfFeaturePublish<StructureFeatureState>({ structTreeLayerBuilder: builder });
  return null;
}

/**
 * FR-43: the document's structure tree, as accessibility structure.
 *
 * A tagged PDF says which of its words are a heading, a list item, a table cell or a figure, and what a
 * figure's alternative text is. Without a layer that reads that tree, a screen reader is handed the page
 * as a run of text — WCAG 1.3.1 unmet for the one document class that did its part.
 *
 * Mounting this feature is the opt-in. It contributes no control, no panel and no key: there is nothing
 * for a reader to press, because the tree is how the page *is*, not a view of it. What it does in page
 * props is ask every page to extract its marked content (which is what a tree binds to, and what a text
 * layer built without it has no wrappers for), and then hand the page pdf.js's builder once the document
 * has declared itself tagged and the chunk has arrived.
 *
 * Untagged documents — most of them — get one `getMarkInfo()` message and nothing else: no chunk fetch, no
 * tree, and no change to what is painted. The extraction cost is real and it is the price of mounting the
 * feature rather than of any one document; `structureLayer` is a static page prop on purpose, because a
 * page that learned the answer later would have to rebuild its text layer to act on it.
 *
 * ```tsx
 * import { structureFeature } from 'pdfjs-react-reader/features/structure';
 * import 'pdfjs-react-reader/structure.css';
 * ```
 *
 * The stylesheet is not decoration. `structure.css` is what keeps the tree out of the layout it shares
 * with the canvas, and a mounted feature whose sheet was never imported is a viewer with an invisible —
 * rather than merely unstyled — accessibility layer.
 */
export const structureFeature: PdfFeature<StructureFeatureState> = {
  id: STRUCTURE_FEATURE_ID,
  Runner: StructureRunner,
  /*
   * Both halves, from two sources: the extraction switch is static, and the builder is the published one
   * that arrives late. Forwarding the second from the state rather than reading it where it is decided is
   * what makes it reach a page at all — a feature that publishes a value and returns only the constant
   * from here keeps the value for itself, which is exactly how the first version of this feature behaved:
   * marked text layers, an imported viewer module, and no tree on the page.
   */
  pageProps: (state) => ({
    structureLayer: true,
    structTreeLayerBuilder: state.structTreeLayerBuilder,
  }),
};
