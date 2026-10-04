import { forwardRef, useImperativeHandle } from 'react';
import {
  useViewer,
  useViewerController,
  ViewerPages,
  ViewerProvider,
  ViewerRoot,
  ViewerSidebar,
  ViewerToolbar,
} from 'pdfjs-react-reader';
import type { PdfViewerHandle, PdfViewerProps, ToolbarItem } from 'pdfjs-react-reader';

/**
 * A layout written by the application instead of by the library.
 *
 * Same controller, different arrangement: the host's own page controls on top,
 * the pages in the middle, the stock toolbar along the bottom. Nothing here
 * re-implements document loading, virtualization, search or features — it
 * only decides where things go, which is the half that used to mean forking the
 * shell. It takes the same ref as `PdfViewer`, because the handle comes from
 * the controller rather than from the component that renders it.
 */
export const CustomLayoutViewer = forwardRef<PdfViewerHandle, PdfViewerProps>(
  function CustomLayoutViewer(props, ref) {
    const controller = useViewerController(props);
    useImperativeHandle(ref, () => controller.handle, [controller.handle]);

    return (
      <ViewerProvider controller={controller}>
        <ViewerRoot>
          <HostPageBar />
          <div className="pjsr-body">
            <ViewerSidebar />
            <ViewerPages />
          </div>
          <ViewerToolbar />
        </ViewerRoot>
      </ViewerProvider>
    );
  },
);

/** Chrome written against the controller, with no library component in it. */
function HostPageBar() {
  const { currentPage, numPages, resolvedScale, handle, docLabel } = useViewer();
  const at = (page: number) => handle.goToPage(page);

  return (
    <div className="host-bar">
      <strong>{docLabel ?? 'Document'}</strong>
      <button type="button" onClick={() => at(1)} disabled={currentPage <= 1}>
        First
      </button>
      <button type="button" onClick={() => at(currentPage - 1)} disabled={currentPage <= 1}>
        Prev
      </button>
      <span className="host-bar-count">
        {currentPage} / {numPages || '—'}
      </span>
      <button type="button" onClick={() => at(currentPage + 1)} disabled={currentPage >= numPages}>
        Next
      </button>
      <button type="button" onClick={() => at(numPages)} disabled={currentPage >= numPages}>
        Last
      </button>
      <span className="host-bar-zoom">{Math.round(resolvedScale * 100)}%</span>
      <button type="button" onClick={() => handle.zoomBy(1.25)}>
        Zoom in
      </button>
      <button type="button" onClick={() => handle.fitTo('width')}>
        Fit
      </button>
    </div>
  );
}

/**
 * A control the application contributes to the bar: same priority scale as the
 * built-ins, same folding, and its node may read the viewer — the toolbar is
 * rendered inside the provider, so `useViewer` works from here.
 */
export const progressControl: ToolbarItem = {
  id: 'progress',
  priority: 9,
  label: 'Reading progress',
  node: <ProgressBadge />,
};

function ProgressBadge() {
  const { currentPage, numPages } = useViewer();
  const percent = numPages ? Math.round((currentPage / numPages) * 100) : 0;
  return (
    <span className="host-progress" title="Share of the document read">
      {percent}%
    </span>
  );
}
