/**
 * Every user-visible string in the shell, as data.
 *
 * Keys are flat strings with `{placeholder}` slots rather than functions, so a
 * locale catalog shipped later is a plain JSON object that can be loaded,
 * diffed and sent for translation without executing anything.
 */
export interface PdfViewerLabels {
  // Toolbar controls
  viewerControls: string;
  toggleSidebar: string;
  previousPage: string;
  nextPage: string;
  pageNumber: string;
  searchDocument: string;
  drawOnDocument: string;
  exitDrawingMode: string;
  drawingTools: string;
  /** Group name for the tools the annotate feature contributes. */
  annotationTools: string;
  highlightTool: string;
  freeTextTool: string;
  inkTool: string;
  /**
   * The Delete control the annotate group adds. The engine's own toolbar has one,
   * but its buttons are icon-only with the label behind a `data-l10n-id` this
   * viewer never resolves, so it has no accessible name — which is why the group
   * carries its own rather than showing the engine's.
   */
  deleteAnnotation: string;
  /** The highlight-colour control, whose value is one of the engine's palette names. */
  highlightColour: string;
  /**
   * Announced when the reader adds a mark. pdf.js signals these moments by
   * writing a `data-l10n-id` onto the alert element it was handed, which conveys
   * nothing unless its Fluent bundles are running — this viewer passes `l10n: null`
   * — so the words have to come from this catalog.
   */
  highlightAdded: string;
  freeTextAdded: string;
  inkAdded: string;
  drawLabel: string;
  drawWithColor: string;
  penWidth: string;
  undoStroke: string;
  undoLabel: string;
  clearAllDrawings: string;
  /** The short form on the button; `clearAllDrawings` is its accessible name. */
  clearLabel: string;
  zoomIn: string;
  zoomOut: string;
  zoomLevel: string;
  rotateCounterclockwise: string;
  rotateClockwise: string;
  downloadDocument: string;
  /** The `edit` tier's control: save the document with its form values made part of the page. */
  flattenDocument: string;
  printDocument: string;
  cancelPrinting: string;
  cancelPrintingProgress: string;
  /** Label for the page-range selector the print feature contributes. */
  printPagesLabel: string;
  printScopeAll: string;
  printScopeCurrent: string;
  printScopeRange: string;
  printFromPage: string;
  printToPage: string;
  /** Hover text on the print button: what it would send right now. */
  printRangeSummary: string;
  moreControls: string;
  pageLayout: string;
  fitWidth: string;
  fitPage: string;
  /** The zoom select's orientation-aware option (FR-06's `Automatic`). */
  zoomAutomatic: string;
  layoutContinuous: string;
  layoutSingle: string;
  layoutSpread: string;

  // Page area
  pagesRegion: string;
  pageLabel: string;
  pageOf: string;
  /**
   * The trailing half of the page counter, shown beside the page field, which
   * already carries the current number — so this one cannot be `pageOf`.
   */
  pageCountOf: string;
  zoomPercent: string;
  loadingDocument: string;
  loadFailed: string;
  retry: string;

  // Sidebar
  sidebarRegion: string;
  sidebarViews: string;
  thumbnailsTab: string;
  outlineTab: string;
  closeSidebar: string;
  goToPage: string;
  outlineLoading: string;
  outlineEmpty: string;
  layersTab: string;
  layersLoading: string;
  layersEmpty: string;
  layersFailed: string;
  attachmentsTab: string;
  attachmentsLoading: string;
  attachmentsEmpty: string;
  attachmentsFailed: string;
  downloadAttachment: string;
  pagesTab: string;
  movePageEarlier: string;
  movePageLater: string;
  removePage: string;
  applyPages: string;
  discardPages: string;
  undoApplyPages: string;
  pagesPending: string;
  pagesMoved: string;
  pagesRemoved: string;
  pagesRotated: string;
  pagesApplied: string;
  extractPages: string;
  pagesExtracted: string;
  splitPagesHere: string;
  pagesSplit: string;
  pagesRestored: string;
  pagesApplyReverted: string;
  /** The form's signature boxes, as the heading over the list of them. */
  signatureSection: string;
  /** The control that writes a drawn mark into one of those boxes. */
  signHere: string;
  /** The box already holds an appearance, so signing it replaces something. */
  signedAlready: string;
  /** Asked of a reader who has not drawn anything yet. */
  drawSignature: string;
  /** One field has the mark in it now. */
  signaturePlaced: string;
  /** Nothing was written, so say so rather than reporting a signature that is not there. */
  signatureFailed: string;
  /** Stated where the mark is placed, because a reader may believe they signed something else. */
  signatureNotCryptographic: string;
  /** The pad takes a pointer or a finger, and nothing else — said rather than hidden. */
  signatureNeedsPointer: string;
  /** Shown while the file is read for its boxes, which is a deliberate click's cost, not an open tab's. */
  signatureScanning: string;
  /** The answer after a reader has drawn something and the document turns out to hold no box for it. */
  signatureNone: string;
  expandSection: string;
  collapseSection: string;
  untitledEntry: string;

  // Search
  findInDocument: string;
  searchPlaceholder: string;
  matchCase: string;
  wholeWordsOnly: string;
  regexMode: string;
  previousMatch: string;
  nextMatch: string;
  closeSearch: string;
  searchIndexing: string;
  searchFailed: string;
  searchInvalidPattern: string;
  searchNoResults: string;
  searchMatchSummary: string;
  searchMatchOnPage: string;
  /** While pages are still being read: the count is a floor, and saying so is the requirement (FR-39). */
  searchMatchSummaryPartial: string;
  searchMatchOnPagePartial: string;
  /** Composes a control's label with its keyboard hint. */
  withShortcut: string;

  // Password prompt
  passwordProtected: string;
  passwordRejected: string;
  passwordField: string;
  passwordIncorrect: string;
  passwordCancel: string;
  passwordUnlock: string;

  // Names shown in the toolbar's collapsed overflow menu. Several controls keep
  // their own shorter group name here because the full control label ("Search
  // document") reads badly as a section heading.
  overflowSidebar: string;
  overflowGoToPage: string;
  overflowPageCount: string;
  overflowSearch: string;
  overflowZoomRange: string;
  overflowRotate: string;
  overflowDownload: string;
  overflowDocument: string;
  penThin: string;
  penMedium: string;
  penThick: string;

  // Fullscreen
  enterFullscreen: string;
  exitFullscreen: string;

  // Custom zoom entry
  zoomCustom: string;

  // Per-page rotation
  rotateCurrentPage: string;
  rotatePageLabel: string;

  // Drag and drop
  dropToOpen: string;
}

export const DEFAULT_LABELS: PdfViewerLabels = {
  viewerControls: 'PDF viewer controls',
  toggleSidebar: 'Toggle sidebar',
  previousPage: 'Previous page',
  nextPage: 'Next page',
  pageNumber: 'Page number',
  searchDocument: 'Search document',
  drawOnDocument: 'Draw on document',
  exitDrawingMode: 'Exit drawing mode',
  drawingTools: 'Drawing tools',
  annotationTools: 'Annotation tools',
  highlightTool: 'Highlight',
  freeTextTool: 'Add text',
  inkTool: 'Ink',
  deleteAnnotation: 'Delete selected annotation',
  highlightColour: 'Highlight colour',
  highlightAdded: 'Highlight added',
  freeTextAdded: 'Text added',
  inkAdded: 'Drawing added',
  drawLabel: 'Draw',
  drawWithColor: 'Draw with {color}',
  penWidth: 'Pen width',
  undoStroke: 'Undo stroke',
  undoLabel: 'Undo',
  clearAllDrawings: 'Clear all drawings',
  clearLabel: 'Clear',
  zoomIn: 'Zoom in',
  zoomOut: 'Zoom out',
  zoomLevel: 'Zoom level',
  rotateCounterclockwise: 'Rotate counterclockwise',
  rotateClockwise: 'Rotate clockwise',
  downloadDocument: 'Download document',
  flattenDocument: 'Flatten and download',
  printDocument: 'Print document',
  cancelPrinting: 'Cancel printing',
  cancelPrintingProgress: 'Cancel printing ({percent}% rendered)',
  printPagesLabel: 'Print pages',
  printScopeAll: 'All pages',
  printScopeCurrent: 'Current page',
  printScopeRange: 'From–to',
  printFromPage: 'First page to print',
  printToPage: 'Last page to print',
  printRangeSummary: 'Print pages {from}–{to}',
  moreControls: 'More controls',
  pageLayout: 'Page layout',
  fitWidth: 'Fit width',
  fitPage: 'Fit page',
  zoomAutomatic: 'Automatic',
  layoutContinuous: 'Continuous',
  layoutSingle: 'Single',
  layoutSpread: 'Spread',

  pagesRegion: 'PDF pages',
  pageLabel: 'Page {page}',
  pageOf: 'Page {page} of {total}',
  pageCountOf: 'of {total}',
  zoomPercent: '{percent}%',
  loadingDocument: 'Loading PDF…',
  loadFailed: 'Failed to load PDF: {message}',
  retry: 'Try again',

  sidebarRegion: 'Document navigation',
  sidebarViews: 'Sidebar views',
  thumbnailsTab: 'Thumbnails',
  outlineTab: 'Outline',
  closeSidebar: 'Close sidebar',
  goToPage: 'Go to page {page}',
  outlineLoading: 'Loading outline…',
  outlineEmpty: 'This document has no outline.',
  layersTab: 'Layers',
  layersLoading: 'Loading layers…',
  layersEmpty: 'This document has no layers.',
  layersFailed: 'Could not read the layers: {message}',
  attachmentsTab: 'Attachments',
  attachmentsLoading: 'Loading attachments…',
  attachmentsEmpty: 'This document has no attached files.',
  attachmentsFailed: 'Could not read the attached files: {message}',
  downloadAttachment: 'Save “{name}”',
  pagesTab: 'Pages',
  movePageEarlier: 'Move page earlier',
  movePageLater: 'Move page later',
  removePage: 'Remove page',
  applyPages: 'Apply page changes',
  discardPages: 'Discard page changes',
  undoApplyPages: 'Undo the last apply',
  pagesPending: '{count} changes not applied',
  pagesMoved: 'Page {page} moved to position {position}',
  pagesRemoved: 'Page {page} removed',
  pagesRotated: 'Page {page} turned to {angle} degrees',
  pagesApplied: 'Page changes applied',
  extractPages: 'Save these pages as a new file',
  pagesExtracted: 'Saved {count} pages as a new file',
  splitPagesHere: 'Split the list here',
  pagesSplit: 'Saved {files} files: {first} pages, then {second}',
  pagesRestored: 'Page changes discarded',
  pagesApplyReverted: 'Back to the document as it was before the apply',
  signatureSection: 'Signature fields',
  signHere: 'Sign',
  signedAlready: 'Already signed',
  drawSignature: 'Draw your signature here',
  signaturePlaced: 'Signature placed on {field}',
  signatureFailed: 'The signature could not be written',
  signatureNotCryptographic: 'A drawn mark, not a digital signature',
  signatureNeedsPointer: 'Drawing needs a mouse, a pen or a finger',
  signatureScanning: 'Finding signature fields…',
  signatureNone: 'This document has no signature fields',
  expandSection: 'Expand {title}',
  collapseSection: 'Collapse {title}',
  untitledEntry: '(untitled)',

  findInDocument: 'Find in document',
  searchPlaceholder: 'Find in document…',
  matchCase: 'Match case',
  wholeWordsOnly: 'Whole words only',
  regexMode: 'Regular expression',
  previousMatch: 'Previous match',
  nextMatch: 'Next match',
  closeSearch: 'Close search',
  searchIndexing: 'Indexing {percent}%',
  searchFailed: 'Search failed',
  searchInvalidPattern: 'Invalid pattern',
  searchNoResults: 'No results',
  searchMatchSummary: '{current} of {total}',
  searchMatchOnPage: '{current} of {total} · p{page}',
  searchMatchSummaryPartial: '{current} of {total} so far',
  searchMatchOnPagePartial: '{current} of {total} so far · p{page}',
  withShortcut: '{label} ({shortcut})',

  passwordProtected: 'This document is password protected.',
  passwordRejected: 'That password did not open this document.',
  passwordField: 'Password',
  passwordIncorrect: 'Incorrect password. Try again.',
  passwordCancel: 'Cancel',
  passwordUnlock: 'Unlock',

  overflowSidebar: 'Sidebar',
  overflowGoToPage: 'Go to page',
  overflowPageCount: 'Page count',
  overflowSearch: 'Search',
  overflowZoomRange: 'Zoom in / out',
  overflowRotate: 'Rotate',
  overflowDownload: 'Download',
  overflowDocument: 'Document',
  penThin: 'Thin',
  penMedium: 'Medium',
  penThick: 'Thick',

  enterFullscreen: 'Enter fullscreen',
  exitFullscreen: 'Exit fullscreen',

  zoomCustom: 'Custom zoom percentage',

  rotateCurrentPage: 'Rotate current page',
  rotatePageLabel: 'Rotate page {page}',

  dropToOpen: 'Drop a PDF to open it',
};

/** A partial catalog: consumers override only what they need. */
export type PdfViewerLabelsOverride = Partial<PdfViewerLabels>;

/**
 * Substitutes `{name}` slots. Missing values leave the slot intact rather than
 * collapsing to an empty string, so a mistranslated catalog is visible instead
 * of silently blanking a control's label.
 */
export function formatLabel(
  template: string,
  vars: Record<string, string | number>,
): string {
  return template.replace(/\{(\w+)\}/g, (whole, name: string) =>
    name in vars ? String(vars[name]) : whole,
  );
}
