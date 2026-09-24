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
* **Progressive Weight:** An application that only displays a PDF must not pay for search, printing, forms, ink or annotation editing. Features are opt-in at the import statement, so an unused feature is absent from the bundle rather than merely hidden. See `ROADMAP.md` §0.4.

### Non-Goals (Out of Scope for v1.0)
* Authoring new PDF documents from scratch (creation/assembly).
  *Amended 2026-09-24:* **modifying** an existing document — page reorder, deletion, extraction, splitting and flattening — is now in scope, shipped through an optional `pdfjs-react-reader/edit` subpath so the core keeps its zero-dependency promise. Building a PDF from nothing is still out. See `ROADMAP.md` §0.7.
* Complex cryptographic digital signature verification (PKI / X.509 certificate validation).
  *Amended 2026-09-24:* drawing a signature and writing it into a `Sig` field's appearance stream is in scope; validating a certificate chain is not.
* Full desktop vector editing capabilities (e.g., editing underlying paths or font kerning).
* *Added 2026-09-24:* **persisting XFA form data.** pdf.js renders XFA (`enableXfa` / `XfaLayer`), and 1.0 will ship that rendering, but XFA submit/save is Adobe LiveCycle behaviour with no open implementation, so XFA stays read-only.

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

### 4.7 Bundling & Feature Tiers
| Requirement ID | Feature | Specification |
| :--- | :--- | :--- |
| **FR-21** | Opt-In Feature Registration | The core viewer component must not statically import any optional feature. Each feature is a value (`{ id, Runner, panel, controls, keys }`) the application passes in, so an unused feature never enters the module graph and is removed by tree shaking. A feature's hooks live inside its own `Runner` component, never in the shell body. |
| **FR-22** | Per-Feature Stylesheets | Each feature ships its own CSS entry; the core stylesheet must not carry rules for features the application did not request. `sideEffects` keeps CSS exempt from tree shaking. |
| **FR-23** | Enforced Size Boundary | CI measures every tier independently (core, each feature, full) and additionally asserts that the built core artifact contains no code belonging to a feature, so a reintroduced static import fails the build instead of silently regressing the tier. |

_Acceptance note for FR-21:_ feature `Runner` elements are keyed by feature id, never by array
position. Measured behaviour: dropping an unrelated feature from the list with an index key remounts
the surviving feature and discards its internal state, with no error raised.

---

## 5. Developer Experience & API Architecture

The package exposes two consumption models: **Compound Components** (for rapid installation) and **Headless Hooks** (for 100% custom user interfaces). Both share a third axis, **feature tiers** (§5.3), which decides how much of the library an application actually ships.

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

### 5.3 Feature Tiers Example
The same component serves a read-only viewer and a full editor; the difference is the import list,
which is the only place a bundler can still see what an application uses.

```tsx
// Basic: display only. Nothing beyond the core viewer is in the bundle.
import { PdfViewer } from 'pdfjs-react-reader';
import 'pdfjs-react-reader/styles.css';

<PdfViewer src={url} />

// Full: each feature is named, so each one is separately droppable.
import { PdfViewer } from 'pdfjs-react-reader';
import { search } from 'pdfjs-react-reader/search';
import { print } from 'pdfjs-react-reader/print';
import 'pdfjs-react-reader/styles.css';
import 'pdfjs-react-reader/search.css';

<PdfViewer src={url} features={[search, print]} />
```

A convenience barrel (`pdfjs-react-reader/full`) exists for applications that want everything without
listing it. It is an ordinary re-export module, not a second build.

---

## 6. Non-Functional Requirements (NFR)

* **Performance & Memory Footprint:** Off-screen canvases must be unmounted and their pixel buffers explicitly cleared (`context.clearRect()`) to prevent mobile Safari crashes.
* **Bundle Budgets:** Excluding `pdfjs-dist`, the full viewer stays under **45 kB gzipped**, the core viewer without any optional feature under **8 kB gzipped**, and no single feature above **4 kB gzipped**. For context the engine itself costs ~532 kB gzipped, so these budgets govern our own layer only; `scripts/check-size.mjs` measures every path and fails the build.
* **Tree-Shakability:** Built with pure ES Modules (`"type": "module"` in `package.json`), separate entry points for UI themes (`/styles.css`) and headless hooks (`/headless`), and the opt-in feature model in FR-21 so that unused features are eliminated at build time. `"sideEffects": ["**/*.css"]` keeps stylesheets from being shaken away while leaving JavaScript shakable. Verified against both esbuild and Rollup: an unimported feature contributes zero bytes to the consumer bundle.
* **Accessibility (a11y):** The generated Text Layer elements must preserve tab navigation orders and maintain semantic tagging corresponding to the document structure for screen reader compatibility.
* **Browser Compatibility:** Support Chrome >= 90, Safari >= 14, Firefox >= 90, Edge >= 90, and modern mobile browsers.

---

## 7. Delivery Roadmap & Milestones

_This was the original four-phase plan and all four phases have shipped. It is kept for history.
Forward work is versioned in [`ROADMAP.md`](./ROADMAP.md), and the requirements it adds are
FR-21–FR-23 in §4.7._

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