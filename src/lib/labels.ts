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
  drawLabel: string;
  drawWithColor: string;
  penWidth: string;
  undoStroke: string;
  undoLabel: string;
  clearAllDrawings: string;
  zoomIn: string;
  zoomOut: string;
  zoomLevel: string;
  rotateCounterclockwise: string;
  rotateClockwise: string;
  downloadDocument: string;
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
  layoutContinuous: string;
  layoutSingle: string;
  layoutSpread: string;

  // Page area
  pagesRegion: string;
  pageLabel: string;
  pageOf: string;
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
  expandSection: string;
  collapseSection: string;
  untitledEntry: string;

  // Search
  findInDocument: string;
  searchPlaceholder: string;
  matchCase: string;
  wholeWordsOnly: string;
  previousMatch: string;
  nextMatch: string;
  closeSearch: string;
  searchIndexing: string;
  searchFailed: string;
  searchNoResults: string;
  searchMatchSummary: string;
  searchMatchOnPage: string;
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
  drawLabel: 'Draw',
  drawWithColor: 'Draw with {color}',
  penWidth: 'Pen width',
  undoStroke: 'Undo stroke',
  undoLabel: 'Undo',
  clearAllDrawings: 'Clear all drawings',
  zoomIn: 'Zoom in',
  zoomOut: 'Zoom out',
  zoomLevel: 'Zoom level',
  rotateCounterclockwise: 'Rotate counterclockwise',
  rotateClockwise: 'Rotate clockwise',
  downloadDocument: 'Download document',
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
  layoutContinuous: 'Continuous',
  layoutSingle: 'Single',
  layoutSpread: 'Spread',

  pagesRegion: 'PDF pages',
  pageLabel: 'Page {page}',
  pageOf: 'Page {page} of {total}',
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
  expandSection: 'Expand {title}',
  collapseSection: 'Collapse {title}',
  untitledEntry: '(untitled)',

  findInDocument: 'Find in document',
  searchPlaceholder: 'Find in document…',
  matchCase: 'Match case',
  wholeWordsOnly: 'Whole words only',
  previousMatch: 'Previous match',
  nextMatch: 'Next match',
  closeSearch: 'Close search',
  searchIndexing: 'Indexing {percent}%',
  searchFailed: 'Search failed',
  searchNoResults: 'No results',
  searchMatchSummary: '{current} of {total}',
  searchMatchOnPage: '{current} of {total} · p{page}',
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
