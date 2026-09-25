import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { ViewerProvider, useViewer } from './ViewerContext';
import type { ViewerController } from './ViewerController';

// Explicit, so the file does not depend on testing-library finding a global
// `afterEach` to register its own cleanup into.
afterEach(cleanup);

const controller = { currentPage: 7, numPages: 12 } as unknown as ViewerController;

function Reader() {
  const { currentPage, numPages } = useViewer();
  return <span data-testid="page">{`${currentPage} of ${numPages}`}</span>;
}

describe('ViewerProvider', () => {
  it('gives a host-written layout the controller it was handed', () => {
    render(
      <ViewerProvider controller={controller}>
        <Reader />
      </ViewerProvider>,
    );
    expect(screen.getByTestId('page').textContent).toBe('7 of 12');
  });

  it('refuses a part used outside a viewer', () => {
    // A part with nothing to read would otherwise render an empty toolbar and
    // never say why, so the miss has to be loud at the point of use.
    expect(() => render(<Reader />)).toThrow(/ViewerProvider/);
  });
});
