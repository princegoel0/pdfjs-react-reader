/*
 * FR-29's keyboard half, and the container it is decided by.
 *
 * pdf.js installs the editor manager's key handling on `window`, and its two "create an editor here" bindings
 * are gated by a containment test: Enter runs `addNewEditorFromKeyboard()` when the event's target is not a
 * `<button>` and `#container.contains(target)`, and Space runs it when `#container.contains(document.activeElement)`
 * (`pdfjs-dist/build/pdf.mjs`, `_keyboardManager`). That handler then reads `this.currentLayer.canCreateNewEmptyEditor()`
 * with no guard, so with no page layer current — the moment a document is swapped, or after every page has
 * scrolled out of the virtualized window — the key throws, uncaught, inside the engine.
 *
 * The whole clause therefore hinges on what this package passes as `container`. It passed `rootRef`, the viewer's
 * root element, which contains the toolbar, the sidebar and the page area: an Enter typed into the page-number
 * field, a Space pressed with a sidebar checkbox in focus, or a key held while a document is being swapped all
 * satisfied pdf.js's test and reached a handler that was written for a key pressed *on a page*. Measured:
 * `scripts/browser-matrix.mjs`'s webkit · desktop cell threw
 * `undefined is not an object (evaluating 'this.currentLayer.canCreateNewEmptyEditor')` twice on 2026-10-07, on a
 * run whose rows included a layer switch followed by a page jump — and the same cell read clean between them,
 * which is why the guard here is a wiring assertion rather than a flaky browser row.
 *
 * So the container is the pages' scroll element when the shell has one, which is what pdf.js's own viewer hands
 * it, and the root only as a fallback for a host that writes its own layout without a `.pjsr-viewport` (FR-28's
 * composed shape) — because a feature that silently lost its keyboard authoring on such a host would trade one
 * defect for a worse one.
 */
import { cleanup, render } from '@testing-library/react';
import { useMemo, useRef } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  FeatureRunners,
  useFeatureStore,
} from '../components/FeatureHost';
import { DEFAULT_LABELS } from '../lib/labels';
import { annotateFeature } from './annotate';
import type { AnyPdfFeature, PdfViewerShell } from '../lib/features';

const seen = vi.hoisted(() => ({ containers: [] as unknown[] }));

vi.mock('pdfjs-dist', async (importOriginal) => {
  const actual = await importOriginal<typeof import('pdfjs-dist')>();
  class RecordingManager {
    constructor(container: unknown) {
      seen.containers.push(container);
    }
    updateMode(): Promise<void> {
      return Promise.resolve();
    }
    addLayer(): void {}
    removeLayer(): void {}
    delete(): void {}
    destroy(): void {}
  }
  return { ...actual, AnnotationEditorUIManager: RecordingManager };
});

/** The shell's real geometry: a root that holds a bar, a scroller with a page in it, and a sidebar. */
function Mount({ withViewport = true }: { withViewport?: boolean }) {
  const rootRef = useRef<HTMLDivElement>(null);
  // Memoised on purpose: `useFeatureStore` keys its store on the shell object, so a fresh literal every render
  // re-creates the store, which re-renders the Runner, which re-creates it again — an update loop that eats
  // 4 GB of heap before it reports anything.
  const shell = useMemo(
    () =>
      ({
        doc: { isPureXfa: false },
        rootRef,
        labels: DEFAULT_LABELS,
        scale: 1,
        rotation: 0,
        reportAnnotationChange: () => {},
        reportError: () => {},
      }) as unknown as PdfViewerShell,
    [],
  );
  const store = useFeatureStore(shell);
  const features: AnyPdfFeature[] = [annotateFeature];
  return (
    <div ref={rootRef} className="pjsr-viewer" data-testid="root">
      <div className="pjsr-toolbar">
        <input className="pjsr-page-input" aria-label="Page number" />
      </div>
      {withViewport && (
        <div className="pjsr-viewport" data-testid="viewport">
          <div className="pjsr-page" />
        </div>
      )}
      <div className="pjsr-sidebar" data-testid="sidebar">
        <input type="checkbox" />
      </div>
      <FeatureRunners features={features} store={store} />
    </div>
  );
}

afterEach(() => {
  cleanup();
  seen.containers.length = 0;
});

const lastContainer = () => seen.containers[seen.containers.length - 1] as HTMLElement;

describe('FR-29: the editor manager gets the pages as its container, not the whole viewer', () => {
  it('hands the scroll element to the engine', async () => {
    const { getByTestId } = render(<Mount />);
    await vi.waitFor(() => expect(seen.containers).toHaveLength(1));
    expect(lastContainer(), 'the container is the viewport, which is what pdf.js hands its own viewer').toBe(
      getByTestId('viewport'),
    );
  });

  it('leaves the toolbar and the sidebar outside it, so their keys are not editor keys', async () => {
    const { getByTestId } = render(<Mount />);
    await vi.waitFor(() => expect(seen.containers).toHaveLength(1));
    const container = lastContainer();
    expect(
      container.contains(document.querySelector('.pjsr-page-input')),
      'an Enter in the page field must not reach addNewEditorFromKeyboard',
    ).toBe(false);
    expect(
      container.contains(getByTestId('sidebar').querySelector('input')),
      'a Space with a layer checkbox in focus is a checkbox key, not a drawing key',
    ).toBe(false);
    expect(container.contains(getByTestId('root')), 'the container is inside the root, not around it').toBe(false);
    expect(container.contains(document.querySelector('.pjsr-page')), 'and the pages are inside it').toBe(true);
  });

  it('falls back to the root for a host that writes its own layout without a viewport', async () => {
    const { getByTestId } = render(<Mount withViewport={false} />);
    await vi.waitFor(() => expect(seen.containers).toHaveLength(1));
    expect(
      lastContainer(),
      'a composed layout (FR-28) has no `.pjsr-viewport`; keyboard authoring must still work there',
    ).toBe(getByTestId('root'));
  });
});
