export {
  usePdfDocument,
  type PdfCapabilities,
  type UsePdfDocumentOptions,
  type UsePdfDocumentResult,
  type PasswordReason,
  type PasswordSubmit,
} from './headless/usePdfDocument';
export {
  usePdfVirtualizer,
  type PdfViewportRef,
  type UsePdfVirtualizerOptions,
  type UsePdfVirtualizerResult,
  type VirtualSlot,
} from './headless/usePdfVirtualizer';
export {
  usePdfSearch,
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
export {
  buildPageText,
  convertMatches,
  escapeRegExp,
  extractAllText,
  extractPageText,
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
  configureTrustedTypes,
  configureWorker,
  ensureWorker,
  isTrustedTypesConfigured,
  workerAutoDetectionFailed,
} from './lib/worker';
export {
  isAllowedSource,
  normalizeSource,
  resolveSourceUrl,
  type PdfSource,
  type NormalizedSource,
} from './lib/source';
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
  computeLayout,
  computeSlots,
  findStartIndex,
  findVisibleRange,
  scaledPageSize,
  DEFAULT_PAGE_ESTIMATE,
  type PageDims,
  type PageLayout,
  type ScaleMode,
  type LayoutResult,
  type VisibleRange,
} from './lib/layout';
