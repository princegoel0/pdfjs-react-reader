/*
 * The seam a document-writing feature depends on: putting new bytes on screen without the
 * host having to hold the source, because a reader who reorders pages has to see the result
 * to keep going.
 *
 * The two behaviours worth nailing down are the ones that are invisible at the call site.
 * A byte array carries no filename, so the document's label has to be carried across by the
 * seam — otherwise the download control silently starts saving "document.pdf" over the file
 * the reader was working on. And the override must give way to the host: an app that
 * navigates to another document cannot be left showing an edited copy of the previous one,
 * which is the same rule the drag-and-drop override already follows, for the same reason.
 */
import { act, cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useViewerController } from './ViewerController';
import { ViewerProvider } from './ViewerContext';

const sawSource = vi.hoisted(() => vi.fn());

vi.mock('../headless/usePdfDocument', () => ({
  usePdfDocument: (options: { src: unknown }) => {
    sawSource(options.src);
    return {
      doc: null,
      numPages: 0,
      isReady: false,
      error: null,
      capabilities: null,
      reload: vi.fn(),
    };
  },
}));

afterEach(cleanup);

const bytes = new Uint8Array([0x25, 0x50, 0x44, 0x46]);
let latest: ReturnType<typeof useViewerController> | null = null;

function Harness({ src }: { src: string }) {
  latest = useViewerController({ src });
  return (
    <ViewerProvider controller={latest}>
      <span />
    </ViewerProvider>
  );
}

const last = () => sawSource.mock.calls.at(-1)?.[0];

describe('replaceDocument', () => {
  it('loads the bytes it is given in place of the document on screen', () => {
    render(<Harness src="/papers/thesis.pdf" />);
    expect(last()).toBe('/papers/thesis.pdf');

    act(() => latest?.replaceDocument(bytes));

    expect(last()).toBeInstanceOf(File);
    expect((last() as File).name).toBe('thesis.pdf');
  });

  it('carries the document label, and takes a name when the caller has one', () => {
    render(<Harness src="/papers/thesis.pdf" />);
    act(() => latest?.replaceDocument(bytes, 'reordered'));
    expect((last() as File).name).toBe('reordered.pdf');
  });

  it('gives way when the host changes the source', () => {
    const view = render(<Harness src="/papers/thesis.pdf" />);
    act(() => latest?.replaceDocument(bytes));
    expect((last() as File).name).toBe('thesis.pdf');

    // Without this the app would be stuck on an edited copy of a document it has left,
    // which is the failure the dropped-file override already had to solve.
    view.rerender(<Harness src="/papers/other.pdf" />);
    expect(last()).toBe('/papers/other.pdf');
  });

  it('clears per-page rotation, which the caller has written into the file', () => {
    render(<Harness src="/papers/thesis.pdf" />);
    act(() => latest?.rotatePage(1, 90));
    expect(latest?.pageRotations[0]).toBe(90);

    act(() => latest?.replaceDocument(bytes));
    expect(latest?.pageRotations).toEqual({});
  });
});
