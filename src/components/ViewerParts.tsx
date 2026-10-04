import type { CSSProperties, ReactNode } from 'react';
import { formatLabel } from '../lib/labels';
import { FeaturePart, FeatureRunners } from './FeatureHost';
import { LabelsContext } from './labels-context';
import { PasswordPrompt } from './PasswordPrompt';
import { PdfPage } from './PdfPage';
import { SearchBox } from './SearchBox';
import { Sidebar } from './Sidebar';
import { ThumbnailList } from './ThumbnailList';
import { Toolbar } from './Toolbar';
import { useViewer } from './ViewerContext';

/**
 * The parts a layout is made of, each reading the viewer around it.
 *
 * `ViewerRoot` is the frame — the element that carries the theme tokens, the
 * keyboard and drop handlers, and the mounted feature Runners. Everything else
 * goes inside it, in whatever order a host wants. They take no props on
 * purpose: the controller is the interface, so a custom arrangement cannot fall
 * out of step with the shell's state.
 */

/**
 * The viewer frame. Everything else in a layout belongs inside this.
 *
 * `className` and `style` are the two props a part is allowed to take, because they are the arrangement the
 * host owns and the controller cannot know: the shell's own frame classes and theme tokens stay, and what
 * the host passes is added to them — the style last, so a host laying the frame out as a grid gets a grid.
 * `PdfViewer` reaches the same two fields through its own props; a part is the same door with the knobs the
 * layout needed.
 */
export function ViewerRoot({
  children,
  className,
  style,
}: {
  children: ReactNode;
  className?: string;
  style?: CSSProperties;
}) {
  const {
    labels,
    features,
    store,
    dragOver,
    rootRef,
    rootClassName,
    rootStyle,
    onKeyDown,
    onDragOver,
    onDragLeave,
    onDrop,
  } = useViewer();

  return (
    <LabelsContext.Provider value={labels}>
      <div
        ref={rootRef}
        className={className ? `${rootClassName} ${className}` : rootClassName}
        style={style ? { ...rootStyle, ...style } : rootStyle}
        onKeyDown={onKeyDown}
        onDragOver={onDragOver}
        onDragLeave={onDragLeave}
        onDrop={onDrop}
      >
        {dragOver && (
          <div className="pjsr-drop-overlay" role="status">
            {labels.dropToOpen}
          </div>
        )}
        {/* One Runner per feature, keyed by id: this is where a feature's hooks
            live, so the shell body never calls one whose count could change. */}
        <FeatureRunners features={features} store={store} />
        {children}
      </div>
    </LabelsContext.Provider>
  );
}

/** The toolbar, including the search bar it hosts and the feature controls it folds. */
export function ViewerToolbar() {
  const {
    currentPage,
    numPages,
    pageLabels,
    scaleMode,
    resolvedScale,
    scrollToPage,
    setScaleMode,
    searchOpen,
    setSearchOpen,
    search,
    sidebarOpen,
    setSidebarOpen,
    pageLayout,
    setPageLayout,
    rotate,
    docLabel,
    zoomLabel,
    featureItems,
    controls,
    fsAvailable,
    toggleFullscreen,
    isFullscreen,
    rotatePage,
  } = useViewer();

  return (
    <Toolbar
      currentPage={currentPage}
      numPages={numPages}
      pageLabels={pageLabels}
      scaleMode={scaleMode}
      resolvedScale={resolvedScale}
      onPageChange={(page) => scrollToPage(page)}
      onScaleModeChange={setScaleMode}
      searchOpen={searchOpen}
      onSearchToggle={() => setSearchOpen(!searchOpen)}
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
      onSidebarToggle={() => setSidebarOpen(!sidebarOpen)}
      pageLayout={pageLayout}
      onPageLayoutChange={setPageLayout}
      onRotate={rotate}
      docLabel={docLabel}
      zoomLabel={zoomLabel}
      featureItems={featureItems}
      controls={controls}
      onFullscreenToggle={fsAvailable ? toggleFullscreen : undefined}
      fullscreenActive={isFullscreen}
      onRotatePage={rotatePage}
    />
  );
}

/**
 * The sidebar: the shell's tabbed panel, or whatever a host puts in it.
 *
 * With no children the tabs are the viewer's own — thumbnails, then every mounted feature's panel — and
 * which one is open is controller state, so a host does not track it. With children the host has said what
 * the sidebar holds, so there is nothing to switch between and the strip is not drawn; the region name, the
 * close control and Escape are still the shell's, which is the part worth having a component for.
 */
export function ViewerSidebar({ children }: { children?: ReactNode } = {}) {
  const {
    labels,
    sidebarOpen,
    setSidebarOpen,
    sidebarTab,
    setSidebarTab,
    featurePanels,
    activePanelFeature,
    ActivePanel,
    store,
  } = useViewer();

  if (children !== undefined) {
    return (
      <Sidebar open={sidebarOpen} onClose={() => setSidebarOpen(false)}>
        {children}
      </Sidebar>
    );
  }

  return (
    <Sidebar
      open={sidebarOpen}
      tabs={[{ id: 'thumbnails', label: labels.thumbnailsTab }, ...featurePanels]}
      tab={sidebarTab}
      onTabChange={setSidebarTab}
      onClose={() => setSidebarOpen(false)}
    >
      {sidebarTab === 'thumbnails' ? (
        <ThumbnailList />
      ) : activePanelFeature && ActivePanel ? (
        <FeaturePart feature={activePanelFeature} store={store}>
          <ActivePanel />
        </FeaturePart>
      ) : null}
    </Sidebar>
  );
}

/** The scrollable page region: its status states, and the virtualized rows. */
export function ViewerPages() {
  const {
    doc,
    status,
    numPages,
    error,
    reload,
    labels,
    containerRef,
    virtualSlots,
    totalHeight,
    resolvedScale,
    rotation,
    pageRotations,
    devicePixelRatio,
    renderPixels,
    contentVersion,
    optionalContentConfig,
    maxRowWidth,
    reportPageDims,
    linkService,
    matchesByPage,
    activeLocalByPage,
    navigateToActiveAt,
    pageProps,
    handlePageError,
    pageRetries,
    passwordPrompt,
    submitPassword,
  } = useViewer();

  return (
    <div
      ref={containerRef}
      className="pjsr-viewport"
      // Focusable: a scrollable region that cannot receive keyboard focus is
      // a WCAG 2.1.1 failure, and it also gates the viewer's Ctrl/Cmd+F.
      role="region"
      aria-label={labels.pagesRegion}
      tabIndex={0}
    >
      {/*
       * One value from the §3.5 model drives this region: prompt while a credential is asked for, the
       * engine's own message plus a retry when the load did not survive, the waiting notice until there is
       * a document, and only then the pages. `!doc` is not a second check on `status` — it is TypeScript
       * narrowing the handle for `PdfPage`, whose prop is non-nullable.
       */}
      {passwordPrompt ? (
        <PasswordPrompt
          reason={passwordPrompt}
          onSubmit={submitPassword}
          onCancel={() => submitPassword(new Error('No password provided.'))}
        />
      ) : status === 'error' && error ? (
        <div className="pjsr-status" role="alert">
          <span>{formatLabel(labels.loadFailed, { message: error.message })}</span>
          <button type="button" className="pjsr-button pjsr-status-action" onClick={() => reload()}>
            {labels.retry}
          </button>
        </div>
      ) : status !== 'ready' || !doc ? (
        <div className="pjsr-status" role="status">
          {labels.loadingDocument}
        </div>
      ) : (
        <div
          className="pjsr-spacer"
          style={{ height: totalHeight, width: `max(100%, ${Math.ceil(maxRowWidth)}px)` }}
        >
          {/*
           * FR-08: a row is a box the shell paints, not a parent the pages live in.
           *
           * They used to be children of the row, and a layout switch then destroyed pages: switching to a
           * spread moves page 2 out of the row keyed 2 and into the row keyed 1, and React cannot move a
           * mounted component between parents — so the canvas it had rendered, its editor state and its
           * scroll anchor went with the old element, and a reader who picked two-up watched every other page
           * go blank and repaint. Now the row is an empty sheet-sized box and the pages are its siblings,
           * keyed by page index, which is the one identity a regrouping never changes. The geometry the
           * browser used to do with flexbox comes from the virtualizer as numbers.
           */}
          {virtualSlots.map((slot) => (
            <div
              key={slot.pageNumber}
              className="pjsr-page-slot"
              style={{
                width: slot.width,
                height: slot.height,
                transform: `translate(-50%, ${slot.offsetTop}px)`,
              }}
            />
          ))}
          {virtualSlots.flatMap((slot) =>
            slot.pages.map((page) => (
              <div
                key={page.index}
                className="pjsr-page"
                style={{
                  width: page.width,
                  height: page.height,
                  transform: `translate(calc(-50% + ${
                    page.left + page.width / 2 - slot.width / 2
                  }px), ${slot.offsetTop + page.top}px)`,
                }}
              >
                <PdfPage
                  doc={doc}
                  pageNumber={page.pageNumber}
                  scale={resolvedScale}
                  rotation={rotation + (pageRotations[page.index] ?? 0)}
                  devicePixelRatio={devicePixelRatio}
                  maxRenderPixels={renderPixels}
                  contentVersion={contentVersion}
                  optionalContentConfig={optionalContentConfig}
                  className="pjsr-page-canvas"
                  highlights={matchesByPage.get(page.index)}
                  activeHighlight={activeLocalByPage.get(page.index) ?? -1}
                  navigateToActiveAt={navigateToActiveAt}
                  linkService={linkService}
                  {...pageProps}
                  onBaseDimensions={reportPageDims}
                  // Before `{...pageProps}`, so a host writing their own retry state keeps it.
                  retryToken={pageRetries[page.pageNumber] ?? 0}
                  onError={handlePageError}
                />
              </div>
            )),
          )}
        </div>
      )}
    </div>
  );
}
