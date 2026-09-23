import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties, KeyboardEvent } from 'react';
import { usePdfDocument, type PasswordReason, type PasswordSubmit } from '../headless/usePdfDocument';
import { usePdfDownload } from '../headless/usePdfDownload';
import { usePdfFormValues } from '../headless/usePdfFormValues';
import { usePdfInk } from '../headless/usePdfInk';
import { usePdfOutline } from '../headless/usePdfOutline';
import { usePdfPrint } from '../headless/usePdfPrint';
import { usePdfSearch } from '../headless/usePdfSearch';
import { usePdfVirtualizer } from '../headless/usePdfVirtualizer';
import { applyRotation, type PageLayout, type ScaleMode } from '../lib/layout';
import { resolveDestinationPageIndex } from '../lib/outline';
import { createPdfLinkService } from '../lib/link-service';
import type { FormValue } from '../lib/form';
import type { PageMatch } from '../lib/search';
import type { PdfSource } from '../lib/source';
import { OutlineView } from './OutlineView';
import { PasswordPrompt } from './PasswordPrompt';
import { PdfPage } from './PdfPage';
import { SearchBox } from './SearchBox';
import { Sidebar, type SidebarTab } from './Sidebar';
import { ThumbnailList } from './ThumbnailList';
import { Toolbar } from './Toolbar';

export interface PdfViewerProps {
  src: PdfSource;
  workerSrc?: string;
  defaultScale?: ScaleMode;
  /** Vertical gap between pages in CSS pixels. */
  gap?: number;
  /** Initial global rotation in degrees; user can rotate via the toolbar. */
  defaultRotation?: number;
  /** Initial page layout mode. */
  defaultLayout?: PageLayout;
  /** Show the navigation sidebar (thumbnails/outline) on first render. */
  defaultSidebarOpen?: boolean;
  /** Render interactive AcroForm widgets. Defaults to true. */
  renderForms?: boolean;
  /** Show the print control and bind Ctrl/Cmd+P. Defaults to true (never on iOS). */
  enablePrint?: boolean;
  /** Canvas scale for printing; 1 = the 72 dpi PDF unit. Auto-tuned to fit memory by default. */
  printScale?: number;
  /** Show the download control. Defaults to true. */
  enableDownload?: boolean;
  /** Name for the saved file; defaults to the document's own name. */
  downloadFileName?: string;
  /** Notified with the current values whenever the user edits a form field. */
  onFormValuesChange?: (values: Record<string, FormValue>) => void;
  className?: string;
  style?: CSSProperties;
  /**
   * Notified when the document is encrypted. Supplying this takes over the UI:
   * without it the viewer shows its own `PasswordPrompt` instead.
   */
  onPasswordRequired?: (submit: PasswordSubmit, reason: PasswordReason) => void;
  onError?: (error: Error) => void;
}

export function PdfViewer({
  src,
  workerSrc,
  defaultScale = 'fit-width',
  gap = 16,
  defaultRotation = 0,
  defaultLayout = 'continuous',
  defaultSidebarOpen = false,
  renderForms = true,
  enablePrint = true,
  printScale,
  enableDownload = true,
  downloadFileName,
  onFormValuesChange,
  className,
  style,
  onPasswordRequired,
  onError,
}: PdfViewerProps) {
  const [scaleMode, setScaleMode] = useState<ScaleMode>(defaultScale);
  const [searchOpen, setSearchOpen] = useState(false);
  const [rotation, setRotation] = useState(defaultRotation);
  const [pageLayout, setPageLayout] = useState<PageLayout>(defaultLayout);
  const [sidebarOpen, setSidebarOpen] = useState(defaultSidebarOpen);
  const [sidebarTab, setSidebarTab] = useState<SidebarTab>('thumbnails');
  const [passwordPrompt, setPasswordPrompt] = useState<PasswordReason | null>(null);
  const submitPasswordRef = useRef<PasswordSubmit | null>(null);

  // The built-in prompt stands down when the host renders its own, so an
  // encrypted document never gets two competing dialogs.
  const handlePasswordRequired = useCallback(
    (submit: PasswordSubmit, reason: PasswordReason) => {
      submitPasswordRef.current = submit;
      if (onPasswordRequired) {
        onPasswordRequired(submit, reason);
        return;
      }
      setPasswordPrompt(reason);
    },
    [onPasswordRequired],
  );

  const { doc, numPages, isReady, error, reload } = usePdfDocument({
    src,
    workerSrc,
    onPasswordRequired: handlePasswordRequired,
  });

  useEffect(() => {
    // A resolved or rejected load ends the request; drop a stale prompt.
    if (doc || error) setPasswordPrompt(null);
  }, [doc, error]);

  // `onError` lives in a ref: consumers pass inline arrows, and a changing
  // identity here would re-run every page's text/annotation effects (pdf.js
  // rebuilds those layers by clearing their container, so the document would
  // visibly flash and lose selection on each parent re-render).
  const onErrorRef = useRef(onError);
  onErrorRef.current = onError;
  const handlePageError = useCallback((err: Error) => {
    onErrorRef.current?.(err);
  }, []);

  const search = usePdfSearch({ doc, onError: handlePageError });
  const { entries: outlineEntries, loading: outlineLoading } = usePdfOutline({ doc });
  const form = usePdfFormValues({ doc, onError: handlePageError });
  const ink = usePdfInk({ resetKey: src });
  const print = usePdfPrint({
    doc,
    rotation,
    getInkStrokes: ink.strokesForPage,
    onError: handlePageError,
  });

  const {
    containerRef,
    virtualSlots,
    totalHeight,
    currentPage,
    pageEstimate,
    resolvedScale,
    scrollToPage,
    reportPageDims,
  } = usePdfVirtualizer({ doc, numPages, scale: scaleMode, gap, rotation, layout: pageLayout });

  const matchesByPage = useMemo(() => {
    const map = new Map<number, PageMatch[]>();
    for (const match of search.results) {
      const list = map.get(match.pageIndex);
      if (list) list.push(match);
      else map.set(match.pageIndex, [match]);
    }
    return map;
  }, [search.results]);

  const activeLocalByPage = useMemo(() => {
    const map = new Map<number, number>();
    const { results, activeIndex } = search;
    if (activeIndex < 0) return map;
    const activePage = results[activeIndex]?.pageIndex;
    if (activePage === undefined) return map;
    let local = 0;
    for (let i = 0; i < activeIndex; i++) {
      if (results[i]!.pageIndex === activePage) local++;
    }
    map.set(activePage, local);
    return map;
  }, [search.results, search.activeIndex]);

  // Scroll the active match's page into view, then let the page center the
  // mark itself (pages may still be virtualized away at this point).
  const [navigateToActiveAt, setNavigateToActiveAt] = useState(0);
  const scrollToPageRef = useRef(scrollToPage);
  scrollToPageRef.current = scrollToPage;
  useEffect(() => {
    if (search.activeIndex < 0) return;
    const match = search.results[search.activeIndex];
    if (!match) return;
    scrollToPageRef.current(match.pageIndex + 1);
    setNavigateToActiveAt(Date.now());
  }, [search.activeSeq, search.activeIndex, search.results]);

  // Ctrl/Cmd+F opens the search bar, Ctrl/Cmd+P the print pipeline. Scoped to
  // the viewer rather than bound to `window`: an embedded component must not
  // hijack the host app's native shortcuts, and two viewers on one page must
  // not both react.
  const canPrint = enablePrint && print.supported;
  const handlePrint = useCallback(() => {
    void print.print({ scale: printScale });
  }, [print, printScale]);

  const handleViewerKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (!(event.ctrlKey || event.metaKey)) return;
    const key = event.key.toLowerCase();
    if (key === 'f') {
      event.preventDefault();
      setSearchOpen(true);
    } else if (key === 'p' && canPrint) {
      event.preventDefault();
      handlePrint();
    }
  };

  const docRef = useRef(doc);
  docRef.current = doc;

  // Stable per document: a new identity would re-render every page's
  // annotation layer, so navigation goes through refs.
  const linkService = useMemo(
    () =>
      createPdfLinkService({
        baseUrl: typeof src === 'string' ? src : undefined,
        onDestination: async (dest) => {
          const current = docRef.current;
          if (!current) return;
          let target = dest;
          if (typeof target === 'string') {
            try {
              target = await current.getDestination(target);
            } catch {
              return;
            }
          }
          const index = await resolveDestinationPageIndex(current, target);
          if (index !== null) scrollToPageRef.current(index + 1);
        },
      }),
    [doc, src],
  );

  // Held in a ref so a consumer passing an inline arrow cannot re-trigger this
  // effect on every render (which would loop whenever it sets state).
  const onFormValuesChangeRef = useRef(onFormValuesChange);
  onFormValuesChangeRef.current = onFormValuesChange;
  useEffect(() => {
    onFormValuesChangeRef.current?.(form.values);
  }, [form.values]);

  const handleRotate = useCallback((delta: number) => {
    setRotation((r) => (((r + delta) % 360) + 360) % 360);
  }, []);

  // Ensure zoomed-in rows wider than the viewport stay reachable via
  // horizontal scrolling.
  const maxRowWidth = useMemo(() => {
    let max = applyRotation(pageEstimate, rotation).width * resolvedScale;
    for (const slot of virtualSlots) max = Math.max(max, slot.width);
    return max;
  }, [virtualSlots, pageEstimate, rotation, resolvedScale]);

  // Human-readable document name for the bar. `File` carries a name; a bare
  // Blob or data URL does not, so those simply omit the label.
  const docLabel = useMemo(() => {
    if (typeof src === 'string') {
      try {
        const url = new URL(src, window.location.href);
        const last = url.pathname.split('/').filter(Boolean).pop();
        return last ? decodeURIComponent(last).replace(/\.pdf$/i, '') : url.hostname;
      } catch {
        return undefined;
      }
    }
    const name = (src as Blob & { name?: string }).name;
    return name ? name.replace(/\.pdf$/i, '') : undefined;
  }, [src]);

  const download = usePdfDownload({
    doc,
    fileName: downloadFileName ?? docLabel,
    onError: handlePageError,
  });
  const handleDownload = useCallback(() => {
    // Save what the user is looking at: with edits pending, the download embeds
    // the current form values instead of the pristine file.
    void download.download({ withFormValues: form.isDirty });
  }, [download, form.isDirty]);

  return (
    <div
      className={className ? `pjsr-viewer ${className}` : 'pjsr-viewer'}
      style={style}
      onKeyDown={handleViewerKeyDown}
    >
      <Toolbar
        currentPage={currentPage}
        numPages={numPages}
        scaleMode={scaleMode}
        resolvedScale={resolvedScale}
        onPageChange={(page) => scrollToPage(page)}
        onScaleModeChange={setScaleMode}
        searchOpen={searchOpen}
        onSearchToggle={() => setSearchOpen((open) => !open)}
        searchContent={
          <SearchBox
            state={search}
            onClose={() => {
              setSearchOpen(false);
              search.clear();
            }}
          />
        }
        sidebarOpen={sidebarOpen}
        onSidebarToggle={() => setSidebarOpen((open) => !open)}
        pageLayout={pageLayout}
        onPageLayoutChange={setPageLayout}
        onRotate={handleRotate}
        drawMode={ink.drawing}
        onDrawToggle={() => ink.setDrawing(!ink.drawing)}
        inkSettings={ink.settings}
        onInkSettingsChange={ink.updateSettings}
        onInkUndo={ink.undo}
        onInkClear={ink.clear}
        inkCanUndo={ink.strokes.length > 0}
        docLabel={docLabel}
        zoomLabel={`${Math.round(resolvedScale * 100)}%`}
        onPrint={canPrint ? handlePrint : undefined}
        onPrintCancel={print.cancel}
        printing={print.isPrinting}
        printProgress={print.progress}
        onDownload={enableDownload ? handleDownload : undefined}
        downloading={download.isBusy}
      />

      <div className="pjsr-body">
        <Sidebar
          open={sidebarOpen}
          tab={sidebarTab}
          onTabChange={setSidebarTab}
          onClose={() => setSidebarOpen(false)}
        >
          {sidebarTab === 'thumbnails' ? (
            doc && (
              <ThumbnailList
                doc={doc}
                numPages={numPages}
                currentPage={currentPage}
                rotation={rotation}
                onSelectPage={(page) => scrollToPage(page)}
              />
            )
          ) : (
            <OutlineView
              entries={outlineEntries}
              loading={outlineLoading}
              onSelectPage={(page) => scrollToPage(page)}
            />
          )}
        </Sidebar>

        <div
          ref={containerRef}
          className="pjsr-viewport"
          // Focusable: a scrollable region that cannot receive keyboard focus is
          // a WCAG 2.1.1 failure, and it also gates the viewer's Ctrl/Cmd+F.
          role="region"
          aria-label="PDF pages"
          tabIndex={0}
        >
          {passwordPrompt ? (
            <PasswordPrompt
              reason={passwordPrompt}
              onSubmit={(password) => {
                submitPasswordRef.current?.(password);
                setPasswordPrompt(null);
              }}
              onCancel={() => {
                submitPasswordRef.current?.(new Error('No password provided.'));
                setPasswordPrompt(null);
              }}
            />
          ) : error ? (
            <div className="pjsr-status" role="alert">
              <span>Failed to load PDF: {error.message}</span>
              <button type="button" className="pjsr-button pjsr-status-action" onClick={() => reload()}>
                Try again
              </button>
            </div>
          ) : !isReady || !doc ? (
            <div className="pjsr-status" role="status">
              Loading PDF…
            </div>
          ) : (
            <div
              className="pjsr-spacer"
              style={{ height: totalHeight, width: `max(100%, ${Math.ceil(maxRowWidth)}px)` }}
            >
              {virtualSlots.map((slot) => (
                <div
                  key={slot.indices[0]}
                  className="pjsr-page-slot"
                  style={{
                    width: slot.width,
                    height: slot.height,
                    transform: `translate(-50%, ${slot.offsetTop}px)`,
                  }}
                >
                  <div className="pjsr-page-row" style={{ gap }}>
                    {slot.indices.map((index) => (
                      <div key={index} className="pjsr-page">
                        <PdfPage
                          doc={doc}
                          pageNumber={index + 1}
                          scale={resolvedScale}
                          rotation={rotation}
                          className="pjsr-page-canvas"
                          highlights={matchesByPage.get(index)}
                          activeHighlight={activeLocalByPage.get(index) ?? -1}
                          navigateToActiveAt={navigateToActiveAt}
                          renderForms={renderForms}
                          annotationStorage={form.storage}
                          linkService={linkService}
                          formVersion={form.version}
                          onFormChange={form.refresh}
                          inkStrokes={ink.strokesForPage(index)}
                          inkDrawing={ink.drawing}
                          inkSettings={ink.settings}
                          onInkCommit={(points) => ink.addStroke(index, points)}
                          onBaseDimensions={reportPageDims}
                          onError={handlePageError}
                        />
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
