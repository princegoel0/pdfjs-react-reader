import type { ReactNode } from 'react';
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

/** The viewer frame. Everything else in a layout belongs inside this. */
export function ViewerRoot({ children }: { children: ReactNode }) {
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
        className={rootClassName}
        style={rootStyle}
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
    ink,
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
      drawMode={ink.drawing}
      onDrawToggle={() => ink.setDrawing(!ink.drawing)}
      inkSettings={ink.settings}
      onInkSettingsChange={ink.updateSettings}
      onInkUndo={ink.undo}
      onInkClear={ink.clear}
      inkCanUndo={ink.strokes.length > 0}
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

/** The sidebar: thumbnails, or whatever panel the mounted features contribute. */
export function ViewerSidebar() {
  const {
    doc,
    numPages,
    currentPage,
    rotation,
    pageRotations,
    scrollToPage,
    sidebarOpen,
    setSidebarOpen,
    sidebarTab,
    setSidebarTab,
    featurePanels,
    activePanelFeature,
    ActivePanel,
    store,
  } = useViewer();

  return (
    <Sidebar
      open={sidebarOpen}
      tab={sidebarTab}
      onTabChange={setSidebarTab}
      onClose={() => setSidebarOpen(false)}
      extraTabs={featurePanels}
    >
      {sidebarTab === 'thumbnails' ? (
        doc && (
          <ThumbnailList
            doc={doc}
            numPages={numPages}
            currentPage={currentPage}
            rotation={rotation}
            pageRotations={pageRotations}
            onSelectPage={(page) => scrollToPage(page)}
          />
        )
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
    gap,
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
    ink,
    commitFor,
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
                      rotation={rotation + (pageRotations[index] ?? 0)}
                      devicePixelRatio={devicePixelRatio}
                      maxRenderPixels={renderPixels}
                      contentVersion={contentVersion}
                      optionalContentConfig={optionalContentConfig}
                      className="pjsr-page-canvas"
                      highlights={matchesByPage.get(index)}
                      activeHighlight={activeLocalByPage.get(index) ?? -1}
                      navigateToActiveAt={navigateToActiveAt}
                      linkService={linkService}
                      {...pageProps}
                      inkStrokes={ink.strokesForPage(index)}
                      inkDrawing={ink.drawing}
                      inkSettings={ink.settings}
                      onInkCommit={commitFor(index)}
                      onBaseDimensions={reportPageDims}
                      // Before `{...pageProps}`, so a host writing their own retry state keeps it.
                      retryToken={pageRetries[index + 1] ?? 0}
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
  );
}
