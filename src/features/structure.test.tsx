/*
 * The structure feature's own seam: what it asks the document, when it fetches the peer module, and what
 * it puts in page props.
 *
 * The claims worth a test here are the two that are invisible in the UI. The first is the cost model the
 * `0.10` spike was settled on: `pdfjs-dist/web/pdf_viewer.mjs` is about 50 kB gzipped and does not
 * tree-shake, so an import taken for an untagged document is a download most readers never need — which
 * makes "no import unless `MarkInfo` says so" the whole point of the tier rather than a detail of it. It is
 * asserted by counting reads of the exported class, because the read is what a resolved import does and a
 * module namespace cannot be observed any other way.
 *
 * The second is `structureLayer`, which must be true in the merged page props on the *first* merge, before
 * any answer about the document has come back. A prop that arrived late would give every page a reason to
 * rebuild its text layer, and that rebuild is the 39.8 ms-per-page cost this project removed from the zoom
 * path in `0.8`. The two halves of the feature are deliberately at different speeds, and only a test keeps
 * them there.
 */
import { cleanup, render, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  FeaturePart,
  FeatureRunners,
  useFeatureStore,
  usePdfFeatureState,
} from '../components/FeatureHost';
import { mergeFeaturePageProps } from '../lib/features';
import { structureFeature, type StructureFeatureState } from './structure';
import type { AnyPdfFeature, PdfViewerShell } from '../lib/features';

/** Counts reads of the class, which is what `loadStructTreeLayerBuilder` does with a resolved import. */
const viewer = vi.hoisted(() => ({ reads: 0 }));

class StructTreeLayerBuilder {
  render(): Promise<HTMLElement | null> {
    return Promise.resolve(null);
  }
  updateTextLayer(): void {}
  hide(): void {}
  show(): void {}
}

/*
 * Replaced wholesale rather than layered over `importOriginal`: the real `pdf_viewer.mjs` is a 320 kB
 * viewer that expects a browser, and pulling it in to reach one class would make this file a test of
 * whether jsdom can boot it.
 */
vi.mock('pdfjs-dist/web/pdf_viewer.mjs', () => ({
  get StructTreeLayerBuilder() {
    viewer.reads += 1;
    return StructTreeLayerBuilder;
  },
}));

/**
 * What the engine answers for a tagged file: a `Map`, measured against `tagged-sample.pdf` in
 * `src/lib/tagged.test.ts`, and not the plain object `getMarkInfo()`'s declaration promises. A fake written
 * as an object is how the first version of this gate passed every test in this file while opening for no
 * document that exists.
 */
const markInfo = (marked: boolean): Map<string, unknown> =>
  new Map([
    ['Marked', marked],
    ['UserProperties', false],
    ['Suspects', false],
  ]);

/** A document whose only interesting answer is what it says about being tagged. */
function fakeDoc(markInfo: unknown, onError = vi.fn()): PdfViewerShell {
  return {
    doc: { getMarkInfo: async () => markInfo } as unknown as PdfViewerShell['doc'],
    reportError: onError,
  } as unknown as PdfViewerShell;
}

function Harness({ shell, out }: { shell: PdfViewerShell; out: Record<string, unknown> }) {
  const store = useFeatureStore(shell);
  const features: AnyPdfFeature[] = [structureFeature];
  // Read during render, exactly as the shell does: the merged object is what a page sees. `firstPageProps`
  // is kept separately because the assertions about what a page knows *before the document has answered*
  // cannot be made against the latest value, which the store has already moved on by assertion time.
  if (!('firstPageProps' in out)) out.firstPageProps = mergeFeaturePageProps(features, store.get);
  out.pageProps = mergeFeaturePageProps(features, store.get);
  return (
    <>
      <FeatureRunners features={features} store={store} />
      <FeaturePart feature={structureFeature} store={store}>
        <Probe out={out} />
      </FeaturePart>
    </>
  );
}

function Probe({ out }: { out: Record<string, unknown> }) {
  out.state = usePdfFeatureState<StructureFeatureState>();
  return null;
}

afterEach(() => {
  cleanup();
  viewer.reads = 0;
});

describe('what the structure feature fetches, and when', () => {
  it('asks for the marked content it will bind to before the document has answered anything', () => {
    const out: Record<string, unknown> = {};
    render(<Harness shell={fakeDoc(markInfo(true))} out={out} />);
    // The first merge is synchronous, so this is the state of the world mid-mount: a page rendering now
    // has to already know to extract marked content, because it cannot be told afterwards. The builder is
    // absent here, and that is the point — the page is marked before anything about the document is known.
    expect(out.firstPageProps).toEqual({ structureLayer: true, structTreeLayerBuilder: undefined });
  });

  /*
   * The published class has to be *forwarded* through page props, not merely published. A feature whose
   * Runner publishes a value it never returns from `pageProps` leaves the store holding a class no page
   * ever reads: marked text layers, a fetched viewer module, and no tree. That is how the first version of
   * this feature shipped, and the assertion below is the one that was missing.
   */
  it('hands the builder to the pages once the document has asked for it', async () => {
    const out: Record<string, unknown> = {};
    render(<Harness shell={fakeDoc(markInfo(true))} out={out} />);
    await waitFor(() =>
      expect((out.pageProps as Record<string, unknown>).structTreeLayerBuilder).toBe(
        StructTreeLayerBuilder,
      ),
    );
    expect((out.pageProps as Record<string, unknown>).structureLayer).toBe(true);
  });

  it('never hands a builder to the pages of an untagged document', async () => {
    const out: Record<string, unknown> = {};
    render(<Harness shell={fakeDoc(markInfo(false))} out={out} />);
    // Settled, not merely "before the answer": an untagged document keeps the marking switch on and the
    // builder off, and `toEqual` on the first render would pass on a feature that forwards nothing at all.
    await waitFor(() => expect((out.state as StructureFeatureState).structTreeLayerBuilder).toBeNull());
    expect(out.pageProps).toEqual({ structureLayer: true, structTreeLayerBuilder: null });
  });

  it('reads the builder out of the peer module once the document says it is tagged', async () => {
    const onError = vi.fn();
    const out: Record<string, unknown> = {};
    render(<Harness shell={fakeDoc(markInfo(true), onError)} out={out} />);

    await waitFor(() =>
      expect((out.state as StructureFeatureState).structTreeLayerBuilder).toBe(StructTreeLayerBuilder),
    );
    expect(viewer.reads).toBe(1);
    expect(onError).not.toHaveBeenCalled();
  });

  /*
   * The two untagged shapes, because they are different answers: `/MarkInfo << /Marked false >>` is a
   * declaration, and no `MarkInfo` at all is the absence of one — pdf.js hands back `null` there, and an
   * implementation that tested the object rather than the flag would treat every untagged file in the
   * world as a tagged one.
   */
  it.each([
    ['Marked false', markInfo(false)],
    ['no MarkInfo dictionary', null],
    ['Marked absent', new Map()],
  ])('fetches nothing for %s', async (_name, answer) => {
    const out: Record<string, unknown> = {};
    render(<Harness shell={fakeDoc(answer)} out={out} />);

    await waitFor(() => expect((out.state as StructureFeatureState).structTreeLayerBuilder).toBeNull());
    expect(viewer.reads).toBe(0);
  });

  it('takes the builder back off the pages when the document changes to an untagged one', async () => {
    const tagged = fakeDoc(markInfo(true));
    const out: Record<string, unknown> = {};
    const view = render(<Harness shell={tagged} out={out} />);
    await waitFor(() =>
      expect((out.state as StructureFeatureState).structTreeLayerBuilder).toBe(StructTreeLayerBuilder),
    );

    view.rerender(<Harness shell={fakeDoc(markInfo(false))} out={out} />);
    // A tree mounted against the previous document's page proxies must not be offered to the next one's.
    await waitFor(() => expect((out.state as StructureFeatureState).structTreeLayerBuilder).toBeNull());
  });

  /*
   * A rejected `getMarkInfo()` — a damaged catalog, a page the worker cannot read — goes to `onError` with
   * nothing published. The chunk is not fetched on the strength of a question that was never answered, and
   * the failure is the same one any other page-level problem takes: the host hears about it, and the
   * viewer keeps showing the document.
   */
  /*
   * The shape the types promise, read as well: `{ Marked: true }`. Only one of the two is what pdf.js
   * sends today, and the code cannot tell which it will meet after a peer upgrade, so the branch is not
   * dead and this is where that is shown.
   */
  it('opens for the object shape its declaration promises', async () => {
    const out: Record<string, unknown> = {};
    render(<Harness shell={fakeDoc({ Marked: true })} out={out} />);
    await waitFor(() =>
      expect((out.state as StructureFeatureState).structTreeLayerBuilder).toBe(StructTreeLayerBuilder),
    );
    expect(viewer.reads).toBe(1);
  });

  it('reports a document that cannot answer and fetches nothing', async () => {
    const onError = vi.fn();
    const out: Record<string, unknown> = {};
    const shell = {
      doc: {
        getMarkInfo: async () => {
          throw new Error('no mark info for this file');
        },
      },
      reportError: onError,
    } as unknown as PdfViewerShell;
    render(<Harness shell={shell} out={out} />);

    await waitFor(() => expect(onError).toHaveBeenCalledOnce());
    expect((out.state as StructureFeatureState).structTreeLayerBuilder).toBeNull();
    expect(viewer.reads).toBe(0);
  });
});
