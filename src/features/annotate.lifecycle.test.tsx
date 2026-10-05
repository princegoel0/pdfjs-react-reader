/*
 * FR-29's lifecycle clauses: the manager the feature owns, the document it writes into, and what happens when
 * a page — or a whole document — goes away.
 *
 * The row read `met` for two milestones on the strength of a browser pass made during `0.6`, and the register's
 * own gap said so: the feature was "never mounted by a test". That half is out of date — `annotate.armed.test.tsx`
 * mounts it, and the mode arithmetic a tool has to reach the engine is guarded there. What was still unasserted
 * is the rest of the sentence: **owned and disposed by `annotateFeature`**, and the two clauses that ride on it —
 * *persisted by an incremental save* and *an editor survives its page scrolling out and back*.
 *
 * Those three are one object's lifetime, and each has a failure mode that produces no error:
 *
 *  - the manager is constructed with a **document**, because pdf.js binds its annotation storage off that object
 *    (`build/pdf.mjs:2733`, `this.#annotationStorage = pdfDocument.annotationStorage`) and `saveDocument()` is the
 *    save of exactly that storage. A manager bound to anything else — or to nothing — authors marks a reader can
 *    see and a save cannot write. `args[7]` is therefore the whole persistence clause in jsdom.
 *  - the manager is **document-wide on purpose**: it is what keeps an editor alive while its page leaves the
 *    virtualized window. If it were owned per page, a scroll would take the reader's marks with it and the page
 *    would come back clean. So page churn must not dispose it, and the page's own layer must be rebuilt against
 *    the *same instance* — that instance identity is the mechanism behind "survives its page scrolling out and
 *    back", and the re-adoption it enables is measured in a browser by `authored-ink-survives-scroll-and-save`.
 *  - the manager must be **disposed**: it holds an `AbortController`, a command stack, every editor, and a
 *    reference to the document. A feature that leaked it on a document swap would keep writing the previous
 *    file's marks into the previous file's storage, and the reader's next save would be of a document they
 *    closed.
 *
 * The last section is FR-29's refusal clause — "tools the engine cannot persist correctly are not offered". It is
 * guarded by enumeration rather than by absence: every control the bar renders is pressed, and no mode the engine
 * reports that the package does not offer (STAMP 13, SIGNATURE 101, COMMENT 102, POPUP 16, DISABLE -1) may appear.
 * The signature editor is also switched off *by construction* — the manager's `signatureManager` argument is
 * `null`, because `pdfjs-dist` exports no such class — which is asserted here because that argument, not the tool
 * list, is what makes the engine refuse the mode.
 *
 * Measured by counterfactual (`.spike/counterfactual-t1e.mjs`, every mutation restored byte-for-byte; the
 * unmutated tree reported 20 passed over these four files):
 *  - `doc` dropped from the build effect's dependency array: **2 failed** — the swap case found one manager
 *    surviving a new document, and the alert-region case found two regions stacked on one root;
 *  - `manager.destroy()` deleted from the cleanup: **1 failed** — "the previous document's manager was never
 *    disposed: expected +0 to be 1";
 *  - the constructor's document argument replaced with `null`: **2 failed**, both naming the binding — the
 *    mark would be authored into no file at all;
 *  - `annotationEditorUIManager.destroy()` added to `PdfPage`'s layer teardown, which is the per-page owner the
 *    clause forbids: **8 failed over two files**, the churn case ("the page took the document-wide manager down
 *    with it") and the page's own overlay guard, which is the correct company for that mutation.
 */
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useMemo, useRef } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AnnotationEditorType } from 'pdfjs-dist';
import { PdfPage } from '../components/PdfPage';
import {
  FeaturePart,
  FeatureRunners,
  useFeatureStore,
  usePdfFeatureState,
} from '../components/FeatureHost';
import { createPdfLinkService } from '../lib/link-service';
import { DEFAULT_LABELS } from '../lib/labels';
import { mergeFeaturePageProps } from '../lib/features';
import { annotateFeature, type AnnotateFeatureState } from './annotate';
import type { AnyPdfFeature, PdfViewerShell } from '../lib/features';
import type { AnnotationEditorUIManager, PDFDocumentProxy, PDFPageProxy } from 'pdfjs-dist';

interface Call {
  viewport: { width: number; height: number; rotation: number };
  div: HTMLElement;
  [key: string]: unknown;
}

/** One entry per manager the feature ever constructed, for the whole file. */
interface ManagerRecord {
  args: unknown[];
  modes: number[];
  destroys: number;
  deletes: number;
  instance: { destroy(): void };
}

const seen = vi.hoisted(() => ({
  managers: [] as ManagerRecord[],
  editorBuilt: [] as Call[],
  layerDestroyed: [] as string[],
}));

const BOX = { width: 595, height: 842 };

function viewportFor(scale: number, rotation: number) {
  const turned = Math.abs(rotation) % 180 === 90;
  return {
    width: (turned ? BOX.height : BOX.width) * scale,
    height: (turned ? BOX.width : BOX.height) * scale,
    rotation,
  };
}

vi.mock('pdfjs-dist', async (importOriginal) => {
  const actual = await importOriginal<typeof import('pdfjs-dist')>();
  class RecordingManager {
    record: ManagerRecord;

    constructor(...args: unknown[]) {
      this.record = { args, modes: [], destroys: 0, deletes: 0, instance: this as never };
      seen.managers.push(this.record);
    }

    updateMode(mode: number) {
      this.record.modes.push(mode);
      return Promise.resolve();
    }

    delete(): void {
      this.record.deletes += 1;
    }

    destroy(): void {
      this.record.destroys += 1;
    }
  }

  return {
    ...actual,
    AnnotationEditorUIManager: RecordingManager,
    TextLayer: class {
      textDivs: HTMLElement[] = [];
      render(): Promise<void> {
        return Promise.resolve();
      }
      update(): void {}
      cancel(): void {}
    },
    AnnotationLayer: class {
      div: HTMLElement;
      constructor(params: Call) {
        this.div = params.div;
      }
      render(): Promise<void> {
        return Promise.resolve();
      }
      update(): void {}
      destroy(): void {
        seen.layerDestroyed.push('annotation');
      }
    },
    DrawLayer: class {
      setParent(): void {}
      destroy(): void {
        seen.layerDestroyed.push('draw');
      }
    },
    /*
     * The page's editor layer. Its `render()` is where pdf.js re-adopts the editors the document-wide manager
     * holds for this page index, so the stub leaves a mark behind — a mark that `PdfPage`'s own teardown
     * (`container.replaceChildren()`) then removes. A rebuilt layer that renders nothing would look identical in
     * the counts and be a page that came back clean.
     */
    AnnotationEditorLayer: class {
      div: HTMLElement;
      uiManager: unknown;
      constructor(params: Call) {
        seen.editorBuilt.push(params);
        this.div = params.div;
        this.uiManager = params.uiManager;
      }
      render(): Promise<void> {
        const mark = document.createElement('div');
        mark.className = 'pjsr-adopted-editor';
        this.div.replaceChildren(mark);
        return Promise.resolve();
      }
      update(): void {}
      destroy(): void {
        seen.layerDestroyed.push('editor');
      }
    },
    XfaLayer: { render: () => ({}), update: () => undefined },
  };
});

/**
 * A document, built outside every render callback.
 *
 * The Runner's build effect keys on `shell.doc`, so a fake document minted inside a render function is a new
 * document on every commit: the effect would tear the manager down and rebuild it forever. The same trap that
 * took a worker down at 4 GB in the search harness.
 */
function makeDoc(name: string): PDFDocumentProxy {
  const page = {
    rotate: 0,
    isPureXfa: false,
    filterFactory: {},
    getViewport: ({ scale = 1, rotation = 0 }: { scale?: number; rotation?: number }) => ({
      ...viewportFor(scale, rotation),
      clone: () => viewportFor(scale, rotation),
    }),
    render: () => ({ promise: Promise.resolve(), cancel: vi.fn() }),
    streamTextContent: () => Promise.resolve({ items: [] }),
    getAnnotations: async () => [],
    getXfa: async () => null,
  } as unknown as PDFPageProxy;
  return {
    numPages: 3,
    isPureXfa: false,
    // The object pdf.js binds the manager's storage to, and the one `saveDocument()` commits.
    annotationStorage: { size: 0, name },
    getPage: async () => page,
  } as unknown as PDFDocumentProxy;
}

interface HarnessProps {
  doc: PDFDocumentProxy;
  pages: number[];
  linkService: ReturnType<typeof createPdfLinkService>;
  out: { pageProps: Record<string, unknown> };
}

function Harness({ doc, pages, linkService, out }: HarnessProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const shell = useMemo(
    () =>
      ({
        doc,
        rootRef,
        labels: DEFAULT_LABELS,
        scale: 1,
        rotation: 0,
        reportAnnotationChange: () => {},
        reportError: () => {},
      }) as unknown as PdfViewerShell,
    [doc],
  );
  const store = useFeatureStore(shell);
  const features: AnyPdfFeature[] = [annotateFeature];
  // Read during render, the way the shell does: what a page is handed is the merged value.
  out.pageProps = mergeFeaturePageProps(features, store.get) as Record<string, unknown>;
  return (
    <>
      <div ref={rootRef} className="pjsr-root" />
      <FeatureRunners features={features} store={store} />
      {pages.map((pageNumber) => (
        <div key={`page-${pageNumber}`} className="pjsr-page">
          <PdfPage
            doc={doc}
            pageNumber={pageNumber}
            scale={1}
            rotation={0}
            devicePixelRatio={1}
            linkService={linkService}
            onStatusChange={() => undefined}
            {...out.pageProps}
          />
        </div>
      ))}
      {(annotateFeature.controls ?? []).map((control) => (
        <FeaturePart key={control.id} feature={annotateFeature as unknown as AnyPdfFeature} store={store}>
          <Gate control={control} shell={shell} />
        </FeaturePart>
      ))}
    </>
  );
}

/** The shell's own gate: the bar is rendered only once the feature has published a manager. */
function Gate({
  control,
  shell,
}: {
  control: NonNullable<typeof annotateFeature.controls>[number];
  shell: PdfViewerShell;
}) {
  const state = usePdfFeatureState<AnnotateFeatureState>();
  if (!(control.available?.(state, shell) ?? true)) return null;
  return <control.render />;
}

const button = (label: string) => screen.getByRole('button', { name: label });

function harnessProps(doc: PDFDocumentProxy, pages: number[], linkService: ReturnType<typeof createPdfLinkService>) {
  const out: HarnessProps['out'] = { pageProps: {} };
  return { out, props: { doc, pages, linkService, out } satisfies HarnessProps };
}

beforeEach(() => {
  seen.managers.length = 0;
  seen.editorBuilt.length = 0;
  seen.layerDestroyed.length = 0;
});

afterEach(cleanup);

describe('the feature owns the manager, and the manager belongs to the document (FR-29)', () => {
  it('binds the manager to the document whose storage an incremental save commits', async () => {
    const doc = makeDoc('A');
    const linkService = createPdfLinkService();
    const { out, props } = harnessProps(doc, [1], linkService);
    render(<Harness {...props} />);
    await waitFor(() => expect(seen.managers).toHaveLength(1));

    // pdf.js reads `pdfDocument.annotationStorage` off this argument and `saveDocument()` writes exactly that
    // store, so this index is the whole "persisted by an incremental save" clause at the level the package
    // controls: the marks a reader authors must land in the file the save is going to commit.
    const [manager] = seen.managers;
    expect(manager!.args[7], 'the manager was not bound to the open document').toBe(doc);
    expect((manager!.args[7] as PDFDocumentProxy).annotationStorage).toBe(doc.annotationStorage);

    // …and the pages are handed the same instance the manager record belongs to.
    await waitFor(() => expect(seen.editorBuilt).toHaveLength(1));
    expect(seen.editorBuilt[0]!.uiManager).toBe(manager!.instance);
    expect(out.pageProps.annotationEditorUIManager).toBe(manager!.instance);
  });

  /*
   * "An editor survives its page scrolling out and back." The package's half of that is a lifetime: the object
   * that holds the editors outlives every page, and a page that comes back re-attaches to *it* rather than to a
   * replacement. The engine's half — re-adopting the editors of a page index on `render()` — is measured in a
   * real browser by `authored-ink-survives-scroll-and-save`, because jsdom holds no editors.
   */
  it('lets a page come and go without touching the manager the marks live in', async () => {
    const doc = makeDoc('A');
    const linkService = createPdfLinkService();
    const { props } = harnessProps(doc, [1, 2], linkService);
    const view = render(<Harness {...props} />);
    await waitFor(() => expect(seen.editorBuilt).toHaveLength(2));
    expect(seen.managers).toHaveLength(1);
    const [manager] = seen.managers;
    expect(view.container.querySelectorAll('.pjsr-adopted-editor')).toHaveLength(2);

    // Page 1 leaves the virtualized window: its layer is destroyed, its mark element goes with the container.
    act(() => view.rerender(<Harness {...props} pages={[2]} />));
    await waitFor(() => expect(seen.layerDestroyed).toContain('editor'));
    expect(manager!.destroys, 'the page took the document-wide manager down with it').toBe(0);
    expect(seen.managers, 'a page remount built a second manager').toHaveLength(1);
    expect(view.container.querySelectorAll('.pjsr-adopted-editor')).toHaveLength(1);

    // And back. The rebuilt layer is a new layer — pdf.js gives a page its own — over the manager that stayed.
    act(() => view.rerender(<Harness {...props} pages={[1, 2]} />));
    await waitFor(() => expect(seen.editorBuilt).toHaveLength(3));
    const rebuilt = seen.editorBuilt.at(-1);
    expect(rebuilt!.uiManager, 'the page came back attached to a different manager').toBe(manager!.instance);
    await waitFor(() => expect(view.container.querySelectorAll('.pjsr-adopted-editor')).toHaveLength(2));
    expect(manager!.destroys).toBe(0);
  });

  it('disposes the manager the old document owned when the document is replaced', async () => {
    const first = makeDoc('A');
    const second = makeDoc('B');
    const linkService = createPdfLinkService();
    const { props } = harnessProps(first, [1], linkService);
    const view = render(<Harness {...props} />);
    await waitFor(() => expect(seen.managers).toHaveLength(1));
    const [old] = seen.managers;

    act(() => view.rerender(<Harness {...props} doc={second} />));
    await waitFor(() => expect(seen.managers).toHaveLength(2));
    // The swap is the leak: a manager left alive keeps writing the closed file's marks into the closed file's
    // storage, and the next save is of a document the reader is no longer looking at.
    expect(old!.destroys, 'the previous document’s manager was never disposed').toBe(1);
    expect(seen.managers[1]!.args[7], 'the new manager was bound to the old document').toBe(second);
    expect(seen.managers[0]!.instance).not.toBe(seen.managers[1]!.instance);
    expect(seen.managers.filter((m) => m.destroys === 0)).toHaveLength(1);

    cleanup();
    expect(seen.managers[1]!.destroys, 'unmounting the viewer left the manager alive').toBe(1);
  });

  it('takes the announcement region down with the manager it belongs to', async () => {
    const first = makeDoc('A');
    const second = makeDoc('B');
    const linkService = createPdfLinkService();
    const { props } = harnessProps(first, [1], linkService);
    const view = render(<Harness {...props} />);
    await waitFor(() => expect(seen.managers).toHaveLength(1));
    expect(view.container.querySelectorAll('.pjsr-alert')).toHaveLength(1);

    // A second manager with a second live region is the leak a reader cannot see and a screen reader hears:
    // every announcement from then on is made twice.
    act(() => view.rerender(<Harness {...props} doc={second} />));
    await waitFor(() => expect(seen.managers).toHaveLength(2));
    expect(view.container.querySelectorAll('.pjsr-alert')).toHaveLength(1);

    cleanup();
    expect(view.container.querySelectorAll('.pjsr-alert')).toHaveLength(0);
  });

  it('arms no mode the engine cannot persist, and refuses the signature editor by construction', async () => {
    const doc = makeDoc('A');
    const linkService = createPdfLinkService();
    const { props } = harnessProps(doc, [1], linkService);
    render(<Harness {...props} />);
    await screen.findByRole('button', { name: DEFAULT_LABELS.inkTool });
    // Let the page finish its own fetch before pressing anything: the click would otherwise land while
    // `PdfPage`'s `getPage` promise is still in the air, and its resolution is an update outside this test's
    // `act`.
    await waitFor(() => expect(seen.editorBuilt).toHaveLength(1));
    const [manager] = seen.managers;

    // The engine's refusal of signing is an argument, not a hidden button: `pdfjs-dist` exports no
    // `SignatureManager`, so `null` here is what makes the mode unavailable rather than available and broken.
    expect(manager!.args[5], 'a signature manager was handed to the engine that has no way to author one').toBeNull();
    expect(manager!.args[4], 'the comment manager was enabled with no comment editors offered').toBeNull();

    // Press everything the bar offers, in both directions, and ask what the engine was told.
    for (const name of [
      DEFAULT_LABELS.highlightTool,
      DEFAULT_LABELS.freeTextTool,
      DEFAULT_LABELS.inkTool,
    ]) {
      fireEvent.click(button(name));
      fireEvent.click(button(name));
    }
    const offered = new Set<number>([
      AnnotationEditorType.NONE,
      AnnotationEditorType.HIGHLIGHT,
      AnnotationEditorType.FREETEXT,
      AnnotationEditorType.INK,
    ]);
    const refused = new Set<number>(
      Object.values(AnnotationEditorType)
        .filter((value) => typeof value === 'number')
        .filter((value) => !offered.has(value)),
    );
    expect([...refused].sort(), 'the engine has nothing left to refuse, so this case is measuring nothing').not.toEqual([]);
    expect(
      manager!.modes.filter((mode) => refused.has(mode)),
      `the bar armed a mode it cannot persist: ${manager!.modes.join(', ')}`,
    ).toEqual([]);
    expect(new Set(manager!.modes)).toEqual(
      new Set([AnnotationEditorType.NONE, AnnotationEditorType.HIGHLIGHT, AnnotationEditorType.FREETEXT, AnnotationEditorType.INK]),
    );

    // Delete acts on a selection through the same manager, and is disabled while there is none — a control that
    // armed an editor of its own would show up in the modes above.
    expect(button(DEFAULT_LABELS.deleteAnnotation).hasAttribute('disabled')).toBe(true);
    expect(manager!.deletes).toBe(0);
    fireEvent.click(button(DEFAULT_LABELS.deleteAnnotation));
    expect(manager!.deletes, 'a disabled control still reached the engine').toBe(0);
  });
});
