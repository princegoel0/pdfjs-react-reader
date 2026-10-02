import { createContext, useContext } from 'react';
import type { ReactNode } from 'react';
import { PdfError } from '../lib/errors';
import type { ViewerController } from './ViewerController';

const ControllerContext = createContext<ViewerController | null>(null);

/**
 * Publishes a controller so the parts below it can read it.
 *
 * `PdfViewer` wraps its default layout in one. A host writing their own layout
 * wraps theirs, gets the same controller `useViewerController` returns, and
 * therefore needs no props passed through by hand — the wiring lives in the
 * hook, the arrangement lives here.
 */
export function ViewerProvider({
  controller,
  children,
}: {
  controller: ViewerController;
  children: ReactNode;
}) {
  return <ControllerContext.Provider value={controller}>{children}</ControllerContext.Provider>;
}

/**
 * The controller of the viewer this component is inside.
 *
 * Throws rather than returning null: a part used outside a viewer has no state
 * to read, and the alternative is a viewer that renders an empty toolbar and
 * tells nobody why.
 */
export function useViewer(): ViewerController {
  const controller = useContext(ControllerContext);
  if (!controller) {
    throw new PdfError(
      'CONFIGURATION_ERROR',
      'pdfjs-react-reader: this part needs a viewer to read from. Render it inside <PdfViewer>, ' +
        'or wrap your own layout in <ViewerProvider controller={…}>.',
    );
  }
  return controller;
}
