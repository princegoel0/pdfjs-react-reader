export {
  usePdfDocument,
  type PdfCapabilities,
  type PdfLoadProgress,
  type UsePdfDocumentOptions,
  type UsePdfDocumentResult,
} from './headless/usePdfDocument';
export {
  type PasswordReason,
  type PasswordSubmit,
  type PdfDocumentStatus,
  type PdfPageStatus,
  type PdfPasswordRequest,
} from './lib/status';
/** §3.6's error contract, on the headless entry too — a host with no shell still has to branch on a code. */
export {
  PDF_ERROR_CODES,
  PdfError,
  isCancellationCode,
  isPdfError,
  type PdfErrorCode,
} from './lib/errors';
export {
  usePdfVirtualizer,
  type PdfViewportRef,
  type UsePdfVirtualizerOptions,
  type UsePdfVirtualizerResult,
  type VirtualSlot,
  type VirtualSlotPage,
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
  type PdfDownloadOutcome,
  type PdfSaveRefusal,
} from './headless/usePdfDownload';
export { usePdfPageLabels } from './headless/usePdfPageLabels';
export {
  usePdfOptionalContent,
  type OcStateAction,
  type UsePdfOptionalContentOptions,
  type UsePdfOptionalContentResult,
} from './headless/usePdfOptionalContent';
export {
  usePdfAttachments,
  type UsePdfAttachmentsOptions,
  type UsePdfAttachmentsResult,
} from './headless/usePdfAttachments';
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
  HIGHLIGHT_COLORS,
  HIGHLIGHT_COLOR_PARAM,
  HIGHLIGHT_PALETTE_STRING,
  DEFAULT_HIGHLIGHT_COLOR,
  readEditingParams,
  readEditingState,
  type PdfAnnotationState,
} from './lib/editing-state';
export {
  createPdfLinkService,
  type CreatePdfLinkServiceOptions,
  type PdfLinkService,
} from './lib/link-service';
export {
  buildPageText,
  convertMatchRanges,
  convertMatches,
  countPerPage,
  DEFAULT_MAX_PATTERN_UNITS,
  escapeRegExp,
  extractAllText,
  buildTextIndex,
  extractPageText,
  findPageMatches,
  invalidatePageText,
  outwardPageOrder,
  planFind,
  validateTextIndex,
  type ExternalPageText,
  type ExternalTextIndex,
  type FindPlan,
  type FindPlanError,
  type PageMatch,
  type PageTextIndex,
  type ResolvedSearchOptions,
  type SearchOptions,
  type TextItemLike,
} from './lib/search';
export {
  parseDestination,
  parseDestinationPosition,
  resolveDestination,
  resolveDestinationPageIndex,
  type DestinationKind,
  type DestinationRef,
  type OutlineEntry,
  type PdfDestinationPosition,
} from './lib/outline';
export {
  flattenOptionalContent,
  optionalContentGroupIds,
  type OptionalContentBundle,
  type OptionalContentGroupState,
  type OptionalContentOrderEntry,
  type OptionalContentRow,
} from './lib/optional-content';
export {
  attachmentMimeType,
  normalizeAttachments,
  type AttachmentInfo,
} from './lib/attachments';
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
  MIN_RENDER_SCALE,
  ensureCanvasCeiling,
  isMobileCanvasEnvironment,
  maxRenderPixelsFor,
  probedCanvasCeiling,
  readCanvasEnvironment,
  resolveCanvasBudget,
  resolveRenderScale,
  type CanvasBudget,
  type CanvasCeilingSource,
  type CanvasEnvironment,
  type CanvasProbeOptions,
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
  type PdfPoint,
  type ViewportPoint,
} from './lib/layout';
export {
  formatPageLabel,
  labelsDifferFromNumbers,
  pageLabelForIndex,
  resolvePageInput,
  type PdfPageLabels,
} from './lib/page-labels';
