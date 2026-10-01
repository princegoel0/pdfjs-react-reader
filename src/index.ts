export {
  PdfViewer,
  type PdfViewerHandle,
  type PdfViewerProps,
} from './components/PdfViewer';
export {
  useViewerController,
  type ViewerController,
} from './components/ViewerController';
export { ViewerProvider, useViewer } from './components/ViewerContext';
export { ViewerLayout } from './components/ViewerLayout';
export {
  ViewerPages,
  ViewerRoot,
  ViewerSidebar,
  ViewerToolbar,
} from './components/ViewerParts';
export { PdfPage, type PdfPageProps } from './components/PdfPage';
export {
  Toolbar,
  ZOOM_LEVELS,
  INK_COLORS,
  INK_WIDTHS,
  type ToolbarControls,
  type ToolbarItem,
  type ToolbarProps,
} from './components/Toolbar';
export { SearchBox, type SearchBoxProps } from './components/SearchBox';
export { Sidebar, type SidebarProps, type SidebarTab } from './components/Sidebar';
export {
  ThumbnailList,
  type ThumbnailListProps,
} from './components/ThumbnailList';
export { PdfThumbnail, type PdfThumbnailProps } from './components/PdfThumbnail';
export { OutlineView, type OutlineViewProps } from './components/OutlineView';
export { InkLayer, type InkLayerProps } from './components/InkLayer';
export { PasswordPrompt, type PasswordPromptProps } from './components/PasswordPrompt';
export {
  findFeatureKey,
  mergeFeaturePageProps,
  NO_FEATURES,
  samePublication,
  type AnyPdfFeature,
  type FeaturePageProps,
  type FeaturePublication,
  type FeatureKeyEvent,
  type PdfFeature,
  type PdfFeatureControl,
  type PdfFeatureKeyBinding,
  type PdfFeaturePanel,
  type PdfStructTreeLayer,
  type PdfStructTreeLayerBuilder,
  type PdfViewerShell,
} from './lib/features';
export {
  usePdfFeatureOptions,
  usePdfFeaturePeer,
  usePdfFeaturePublish,
  usePdfFeatureShell,
  usePdfFeatureState,
  type FeatureStore,
} from './components/FeatureHost';
export {
  usePdfDocument,
  type PdfCapabilities,
  type PdfLoadProgress,
  type UsePdfDocumentOptions,
  type UsePdfDocumentResult,
} from './headless/usePdfDocument';
/**
 * The `PRD.md` §3.5 state models. Types only, so publishing them on both entries costs no bytes; the page
 * union belongs here as much as in headless because `PdfPage` is the only thing that reports it.
 */
export {
  type PasswordReason,
  type PasswordSubmit,
  type PdfDocumentStatus,
  type PdfPageStatus,
  type PdfPasswordRequest,
} from './lib/status';
export {
  usePdfVirtualizer,
  type PdfViewportRef,
  type UsePdfVirtualizerOptions,
  type UsePdfVirtualizerResult,
  type VirtualSlot,
} from './headless/usePdfVirtualizer';
export {
  usePdfSearch,
  type PdfFindController,
  type SearchStatus,
  type UsePdfSearchOptions,
  type UsePdfSearchResult,
} from './headless/usePdfSearch';
export {
  usePdfOutline,
  type UsePdfOutlineOptions,
  type UsePdfOutlineResult,
} from './headless/usePdfOutline';
export {
  usePdfFormValues,
  type UsePdfFormValuesOptions,
  type UsePdfFormValuesResult,
} from './headless/usePdfFormValues';
export { usePdfInk, type UsePdfInkOptions, type UsePdfInkResult } from './headless/usePdfInk';
export { usePdfPageLabels } from './headless/usePdfPageLabels';
export {
  usePdfPrint,
  isPrintSupported,
  PRINT_CONTAINER_CLASS,
  type UsePdfPrintOptions,
  type UsePdfPrintResult,
  type PrintOptions,
} from './headless/usePdfPrint';
export {
  usePdfDownload,
  type UsePdfDownloadOptions,
  type UsePdfDownloadResult,
  type PdfDownloadOptions,
} from './headless/usePdfDownload';
export {
  clearFormValues,
  collectWidgets,
  describeWidget,
  formValuesDiffer,
  groupWidgets,
  readFormValues,
  readInitialValues,
  writeFormValues,
  type AnnotationValueStore,
  type FormField,
  type FormFieldOption,
  type FormFieldType,
  type FormValue,
  type FormWidget,
} from './lib/form';
export {
  createStrokeId,
  drawInkStrokes,
  pointsBounds,
  simplifyPoints,
  strokeBounds,
  strokePathD,
  type InkSettings,
  type InkStroke,
  type PdfPoint,
  type ViewportPoint,
} from './lib/ink';
export {
  createPdfLinkService,
  type CreatePdfLinkServiceOptions,
  type PdfLinkService,
} from './lib/link-service';
/**
 * The search helpers are on both entries on purpose: a host replacing the shell's
 * find strategy through `PdfViewer`'s `find` prop builds it from the same planner
 * the built-in one uses, without reaching into the headless entry.
 */
export {
  buildPageText,
  convertMatchRanges,
  convertMatches,
  countPerPage,
  escapeRegExp,
  extractAllText,
  extractPageText,
  findPageMatches,
  planFind,
  type FindPlan,
  type PageMatch,
  type PageTextIndex,
  type ResolvedSearchOptions,
  type SearchOptions,
  type TextItemLike,
} from './lib/search';
export {
  parseDestination,
  resolveDestinationPageIndex,
  type DestinationRef,
  type OutlineEntry,
} from './lib/outline';
export {
  BYTES_PER_PIXEL,
  PRINT_MEMORY_BUDGET,
  PRINT_SCALES,
  estimatePrintBytes,
  formatBytes,
  maxPrintablePages,
  planPrintPages,
  planPrintScale,
  printCanvasSize,
  printRangeFor,
  type PrintScope,
} from './lib/print';
export { downloadBytes, pdfFileName } from './lib/download';
export {
  DEFAULT_LABELS,
  formatLabel,
  type PdfViewerLabels,
  type PdfViewerLabelsOverride,
} from './lib/labels';
export { LabelsContext, useLabels } from './components/labels-context';
export {
  configureTrustedTypes,
  configureWorker,
  ensureWorker,
  isTrustedTypesConfigured,
  workerAutoDetectionFailed,
} from './lib/worker';
export {
  HIGHLIGHT_COLORS,
  HIGHLIGHT_COLOR_PARAM,
  HIGHLIGHT_PALETTE_STRING,
  DEFAULT_HIGHLIGHT_COLOR,
  readEditingParams,
  readEditingState,
  type PdfAnnotationState,
} from './lib/editing-state';
export {
  base64ToBytes,
  classifySource,
  isAllowedSource,
  normalizeSource,
  resolveSourceUrl,
  type NormalizedSource,
  type PdfSource,
  type PdfSourceClassification,
  type PdfSourceRefusal,
} from './lib/source';
export { abortError, isAbortError, onAbort, throwIfAborted } from './lib/abort';
export {
  classifyLoadError,
  DEFAULT_RETRY_POLICY,
  type RetryAttemptInfo,
  type RetryPolicy,
  type RetryVerdict,
} from './lib/retry';
export {
  CDN_ASSET_ROOT,
  pdfAssetUrls,
  resolveAssetRoot,
  type AssetUrl,
  type PdfAssetUrls,
} from './lib/assets';
export {
  CAP_AREA_FACTOR,
  MAX_RENDER_PIXELS,
  MAX_RENDER_PIXELS_MOBILE,
  MAX_RENDER_SIDE,
  isMobileCanvasEnvironment,
  maxRenderPixelsFor,
  readCanvasEnvironment,
  resolveRenderScale,
  type CanvasEnvironment,
  type RenderScale,
  type RenderScaleOptions,
} from './lib/canvas';
export {
  applyRotation,
  automaticFitMode,
  computeLayout,
  computeSlots,
  findStartIndex,
  findVisibleRange,
  meanBox,
  spreadSample,
  scaledPageSize,
  DEFAULT_PAGE_ESTIMATE,
  type PageDims,
  type PageLayout,
  type ScaleMode,
  type LayoutResult,
  type VisibleRange,
} from './lib/layout';
export {
  formatPageLabel,
  labelsDifferFromNumbers,
  pageLabelForIndex,
  resolvePageInput,
  type PdfPageLabels,
} from './lib/page-labels';
