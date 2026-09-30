/*
 * What a reader of a file that will not open actually gets.
 *
 * `PRD.md`'s error-handling line promises the viewer says so and offers a way back, and until now
 * nothing had ever rendered that state: `damaged.test.ts` proves the engine rejects a truncated file,
 * and this proves the shell turns that rejection into an announcement a screen reader hears and a
 * retry that actually re-requests the document. The two halves are separate on purpose — a UI that
 * swallows the error would still leave the engine test green.
 *
 * The loader is stubbed with the message pdf.js really produces (`InvalidPDFException: Invalid PDF
 * structure.`), so this file is asserting the wiring between a real failure and the visible state,
 * not an invented one.
 */
import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_LABELS, formatLabel } from '../lib/labels';
import { useViewerController } from './ViewerController';
import { ViewerProvider } from './ViewerContext';
import { ViewerLayout } from './ViewerLayout';

const reload = vi.hoisted(() => vi.fn());

// The toolbar measures its own overflow and the virtualizer measures its scroll container; jsdom gives
// neither a ResizeObserver, so the render dies before the failure state is ever reached. Same stub the
// Toolbar tests install — it reports no size change, which is what jsdom's zero-width box already means.
class ObserverStub {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}
globalThis.ResizeObserver = ObserverStub as unknown as typeof ResizeObserver;

vi.mock('../headless/usePdfDocument', () => ({
  // FR-37 made these fields one value, so the mock states them together the way the hook now can only:
  // `status: 'error'` carries the message, and there is no document, no prompt and nothing to retry yet.
  usePdfDocument: () => ({
    status: 'error',
    doc: null,
    numPages: 0,
    isReady: false,
    error: new Error('Invalid PDF structure.'),
    capabilities: null,
    passwordRequest: null,
    reload,
  }),
}));

afterEach(() => {
  reload.mockClear();
});

function Failing() {
  const controller = useViewerController({ src: '/fixtures/damaged-truncated.pdf' });
  return (
    <ViewerProvider controller={controller}>
      <ViewerLayout controller={controller} />
    </ViewerProvider>
  );
}

describe('a document that will not load', () => {
  it('says what went wrong, in the engine’s own words, rather than a blank page', () => {
    render(<Failing />);
    const alert = screen.getByRole('alert');
    expect(alert.textContent).toContain('Invalid PDF structure.');
    // The whole sentence, composed the way the component composes it — so the assertion follows the
    // catalog rather than a fragment of English typed into this file.
    expect(alert.textContent).toContain(
      formatLabel(DEFAULT_LABELS.loadFailed, { message: 'Invalid PDF structure.' }),
    );
  });

  /*
   * The retry has to re-request, not just re-render: a reader who was served a half-downloaded file
   * needs another attempt at the network, and a button that only reset local state would look like
   * recovery while guaranteeing the same failure.
   */
  it('offers a retry that asks the engine again', () => {
    render(<Failing />);
    fireEvent.click(screen.getByRole('button', { name: DEFAULT_LABELS.retry }));
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('does not render a page area, a spacer, or a thumbnail of nothing', () => {
    render(<Failing />);
    expect(document.querySelector('.pjsr-spacer')).toBeNull();
    expect(document.querySelectorAll('.pjsr-page')).toHaveLength(0);
  });

  // The failure announces itself: `role="alert"` is what makes the message reach a reader who never
  // looked at the viewport, and the same region must not be a polite `role="status"` that a screen
  // reader may skip while it is busy.
  it('announces it, so the message is not left for the reader to find', () => {
    render(<Failing />);
    expect(screen.getByRole('alert').getAttribute('role')).toBe('alert');
    expect(screen.queryByRole('status')).toBeNull();
  });
});
