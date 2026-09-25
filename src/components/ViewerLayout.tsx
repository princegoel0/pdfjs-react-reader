import { ViewerProvider } from './ViewerContext';
import { ViewerPages, ViewerRoot, ViewerSidebar, ViewerToolbar } from './ViewerParts';
import type { ViewerController } from './ViewerController';

/**
 * The default arrangement: toolbar above, sidebar beside the pages.
 *
 * It is four parts and one wrapper div, which is the whole point — a host who
 * wants something else writes these five lines their own way and gets the same
 * controller, not a re-wiring of the shell's state.
 */
export function ViewerLayout({ controller }: { controller: ViewerController }) {
  return (
    <ViewerProvider controller={controller}>
      <ViewerRoot>
        <ViewerToolbar />
        <div className="pjsr-body">
          <ViewerSidebar />
          <ViewerPages />
        </div>
      </ViewerRoot>
    </ViewerProvider>
  );
}
