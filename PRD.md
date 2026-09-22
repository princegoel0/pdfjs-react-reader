# Product Requirement Document (PRD): pdfjs-react-reader

* **Package Name:** `pdfjs-react-reader`
* **Target Audience:** React developers seeking a free, production-ready, highly extensible PDF viewer without commercial license restrictions or unmaintained wrapper bloat.
* **Core Engine:** `pdfjs-dist` (direct integration, zero wrapper dependencies)
* **License:** MIT

---

## 1. Executive Summary & Vision

Existing open-source React PDF viewers suffer from two distinct problems: they are either unmaintained wrappers around outdated `pdfjs-dist` releases, or they lock essential features (text search, form filling, annotations, virtualized scrolling) behind commercial paywalls. 

The goal of `pdfjs-react-reader` is to build an MIT-licensed, headless-first PDF viewer for React that interfaces directly with Mozilla's engine. It provides the foundational plumbing—virtualization, multi-layer rendering (Canvas, Text, Annotation), and worker lifecycle management—packaged both as headless hooks for custom UI designs and as an optional drop-in standard viewer component.

---

## 2. Product Goals & Non-Goals

### Goals
* **Zero Abstraction Lock-in:** Directly utilize `pdfjs-dist` as a peer dependency, enabling users to upgrade the underlying engine independently.
* **Enterprise Performance:** Sustain 60 FPS scrolling on 1,000+ page documents with sub-100ms viewport render times using built-in DOM virtualization.
* **Headless + Compound Component Architecture:** Support developers who want fully custom enterprise UI designs as well as those needing a quick drop-in viewer.
* **Complete Feature Parity:** Provide out-of-the-box support for text selection, global search, AcroForms/form-filling, thumbnails, responsive scaling, outlines, and printing.
* **Strict Memory Containment:** Aggressively destroy off-screen canvas contexts and abort stale render tasks during rapid user interactions.

### Non-Goals (Out of Scope for v1.0)
* Authoring new PDF documents from scratch (creation/assembly).
* Complex cryptographic digital signature verification (PKI / X.509 certificate validation).
* Full desktop vector editing capabilities (e.g., editing underlying paths or font kerning).

---

## 3. Architecture & Technical Specifications

```text
                     ┌───────────────────────────────────────────────┐
                     │              Your React Application           │
                     └───────────────────────┬───────────────────────┘
                                             │
               ┌─────────────────────────────┴─────────────────────────────┐
               ▼                                                           ▼
┌───────────────────────────────┐                       ┌─────────────────────────────────────┐
│    Pre-built UI Shell         │                       │         Headless Hooks              │
│    (Toolbar, Sidebar, Modal)  │                       │  (usePdf, usePdfSearch, usePage)    │
└──────────────┬────────────────┘                       └──────────────────┬──────────────────┘
               │                                                           │
               └─────────────────────────────┬─────────────────────────────┘
                                             ▼
                     ┌───────────────────────────────────────────────┐
                     │          Virtual Viewport Manager             │
                     │    (Calculates heights & visible indices)     │
                     └───────────────────────┬───────────────────────┘
                                             │
                     ┌───────────────────────┴───────────────────────┐
                     ▼                                               ▼
         ┌───────────────────────┐                       ┌───────────────────────┐
         │     Visible Page      │                       │     Visible Page      │
         ├───────────────────────┤                       ├───────────────────────┤
         │ • Canvas Layer        │                       │ • Canvas Layer        │
         │ • Text Layer          │                       │ • Text Layer          │
         │ • Annotation Layer    │                       │ • Annotation Layer    │
         └───────────────────────┘                       └───────────────────────┘
                                             │
                                             ▼
                     ┌───────────────────────────────────────────────┐
                     │               pdfjs-dist Engine               │
                     │          (Dedicated Web Worker Pool)          │
                     └───────────────────────────────────────────────┘
```

### 3.1 Layered Page Pipeline
Each rendered page DOM node contains three coordinated layers stacked via CSS positioning:
1. **Canvas Layer (Bottom):** High-DPI hardware-accelerated canvas context that renders vector curves, fonts, and raster images.
2. **Text Layer (Middle):** Invisible HTML text spans positioned precisely over canvas coordinates to enable OS-native mouse selection, copy/paste, and screen reader recognition.
3. **Annotation/Interaction Layer (Top):** Dynamic HTML form controls (text fields, checkboxes, dropdowns) and SVG overlays (links, notes, highlight paths).

---

## 4. Functional Requirements & Feature Matrix

### 4.1 Document Loading & Lifecycle
| Requirement ID | Feature | Specification |
| :--- | :--- | :--- |
| **FR-01** | Input Flexibility | Accept inputs as URL strings, `ArrayBuffer`, `Uint8Array`, Base64 strings, or `Blob`/`File` objects. |
| **FR-02** | Worker Configuration | Expose simple worker initialization via local bundler import or external CDN URL. |
| **FR-03** | Password Protection | Intercept password-protected documents; emit `onPasswordRequired` event to mount custom auth modals. |
| **FR-04** | Cancellation Safety | Cancel active `page.render()` tasks instantly if unmounted or scrolled out of view, avoiding canvas errors. |

### 4.2 Display, Zoom & Layout Modes
| Requirement ID | Feature | Specification |
| :--- | :--- | :--- |
| **FR-05** | Viewport Virtualization | Render only visible pages + a 1-page overscan buffer. Dynamic placeholder heights prevent scrollbar jumping. |
| **FR-06** | Responsive Zoom Modes | Support arbitrary zoom percentages (25% to 500%), `Fit-to-Width`, `Fit-to-Page`, and `Automatic`. |
| **FR-07** | High-DPI Adaptation | Read `window.devicePixelRatio` to multiply canvas pixel density while retaining standard layout dimensions. |
| **FR-08** | Page Layouts | Support continuous vertical scroll, single-page presentation mode, and two-page spread (book view). |
| **FR-09** | Rotation | Dynamic 90-degree clockwise and counter-clockwise rotation per-page or globally across the document. |

### 4.3 Navigation & Document Structure
| Requirement ID | Feature | Specification |
| :--- | :--- | :--- |
| **FR-10** | Table of Contents / Outline | Parse PDF bookmark tree structure recursively; clicking an item dispatches an internal anchor jump. |
| **FR-11** | Thumbnails Sidebar | Render miniature virtualized pages (scale 0.15–0.25) with viewport tracking highlights. |
| **FR-12** | Jump-to-Page | Direct numeric input navigation with boundary clamping (`1` to `numPages`). |

### 4.4 Text Search & Selection
| Requirement ID | Feature | Specification |
| :--- | :--- | :--- |
| **FR-13** | In-Memory Indexing | Extract text content across all pages via worker threads into a unified search index. |
| **FR-14** | Match Highlighting | Highlight matches across the Text Layer using native `<mark>` nodes with active match contrast. |
| **FR-15** | Search Controls | Case sensitivity toggle, match whole words, find next/previous match, and search progress indicators. |

### 4.5 Forms & Annotations
| Requirement ID | Feature | Specification |
| :--- | :--- | :--- |
| **FR-16** | AcroForms Support | Render standard PDF interactive form fields: text inputs, radio buttons, checkboxes, signatures, and select lists. |
| **FR-17** | Form Data Sync | Two-way binding for form field values with JSON serialization/deserialization methods (`getFormData()`). |
| **FR-18** | Annotations View & Draw | Render existing link annotations, highlight highlights, and support freehand drawing/signatures via SVG overlays. |

### 4.6 Export & Utilities
| Requirement ID | Feature | Specification |
| :--- | :--- | :--- |
| **FR-19** | High-Fidelity Printing | Render full-resolution invisible canvases across the entire document into an isolated print stylesheet (`@media print`). |
| **FR-20** | Document Download | Direct file download triggering, with an option to download modified forms with state flattened. |

---

## 5. Developer Experience & API Architecture

The package exposes two consumption models: **Compound Components** (for rapid installation) and **Headless Hooks** (for 100% custom user interfaces).

### 5.1 Headless API Example
```tsx
import { usePdfDocument, usePdfSearch, usePdfVirtualizer } from 'pdfjs-react-reader';

export function CustomViewer({ fileUrl }: { fileUrl: string }) {
  const { doc, numPages, isReady } = usePdfDocument({ src: fileUrl });
  const { results, activeIndex, search, nextMatch } = usePdfSearch({ doc });
  const { virtualPages, containerRef } = usePdfVirtualizer({ doc, numPages });

  return (
    <div ref={containerRef} className="viewer-viewport">
      {virtualPages.map(({ index, offsetTop, height }) => (
        <CustomPageRenderer 
          key={index} 
          doc={doc} 
          pageNumber={index + 1} 
          style={{ transform: `translateY(${offsetTop}px)`, height }} 
        />
      ))}
    </div>
  );
}
```

### 5.2 Compound Components Example
```tsx
import { 
  PdfViewer, 
  PdfToolbar, 
  PdfSidebar, 
  PdfThumbnailList, 
  PdfPages 
} from 'pdfjs-react-reader';
import 'pdfjs-react-reader/dist/style.css';

export function StandardViewer({ fileUrl }: { fileUrl: string }) {
  return (
    <PdfViewer src={fileUrl} defaultScale="fit-width">
      <PdfToolbar>
        <PdfToolbar.ZoomControls />
        <PdfToolbar.SearchInput />
        <PdfToolbar.PageNavigation />
      </PdfToolbar>
      <div className="viewer-body">
        <PdfSidebar>
          <PdfThumbnailList />
        </PdfSidebar>
        <PdfPages />
      </div>
    </PdfViewer>
  );
}
```

---

## 6. Non-Functional Requirements (NFR)

* **Performance & Memory Footprint:** Total uncompressed bundle size (excluding `pdfjs-dist`) must remain under **45 kB gzipped**. Off-screen canvases must be unmounted and their pixel buffers explicitly cleared (`context.clearRect()`) to prevent mobile Safari crashes.
* **Tree-Shakability:** Built with pure ES Modules (`"type": "module"` in `package.json`), providing separate entry points for UI themes (`/styles.css`) and headless hooks (`/headless`).
* **Accessibility (a11y):** The generated Text Layer elements must preserve tab navigation orders and maintain semantic tagging corresponding to the document structure for screen reader compatibility.
* **Browser Compatibility:** Support Chrome >= 90, Safari >= 14, Firefox >= 90, Edge >= 90, and modern mobile browsers.

---

## 7. Delivery Roadmap & Milestones

### Phase 1: Engine Foundation (MVP)
* Web worker lifecycle hook and binary loader.
* Custom `PdfPage` supporting Canvas Layer rendering and automatic High-DPI calibration.
* Integrated viewport virtualization layer.
* Basic Zoom (`fit-width`, percentages) and document navigation.

### Phase 2: Interactivity & Document Parsing
* Absolute-coordinate Text Layer implementation with standard browser text selection.
* In-memory full-text search engine with match highlighting.
* Document Outline (TOC) extraction and thumbnail sidebar components.

### Phase 3: Forms, Annotations & Pre-built Shell
* AcroForms parsing and interactive form-field layer.
* Freehand signature and annotation overlays.
* Production-ready default Toolbar and Sidebar component library.
* Full-document headless printing pipeline.

### Phase 4: Developer Ecosystem & Launch
* Comprehensive documentation site with live interactive code sandboxes.
* Standardized test suite covering edge cases (damaged files, encrypted documents, rotated pages).
* NPM deployment with TypeScript declaration files and automated GitHub Actions CI/CD.