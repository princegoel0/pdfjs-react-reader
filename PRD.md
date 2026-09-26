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
the surviving feature and discards its internal state, with no error raised. Both halves have a
regression test, because neither failure announces itself.

_Acceptance note for FR-22:_ one stylesheet per tier is a published entry (`/print.css`, `/forms.css`,
`/outline.css`), not a rule inside `styles.css`. Shipping them as separate JavaScript-side imports was
tested and does not work: tsup resolves the CSS import at build time, strips it from the module, and
emits a sibling file nothing loads — so the styles were missing with no error, which is the failure
mode this requirement exists to prevent. `sideEffects: ["**/*.css"]` keeps the sheets alive.

_Acceptance note for FR-23:_ the marker is the name of the headless hook a feature wraps
(`usePdfPrint`, `usePdfDownload`, `usePdfFormValues`, `usePdfOutline`), grepped on the unminified
`dist` so a rename cannot hide it, and asserted in both directions: absent from the core consumer
bundle, present in its own. Gate proven in both directions — a reintroduced static import fails it,
and a fabricated 5 kB of growth in the committed baseline fails it too.

### 4.8 Composition & Document Structure (added with `0.5`)
| Requirement ID | Feature | Specification |
| :--- | :--- | :--- |
| **FR-24** | Optional-Content Layers | List a document's optional-content groups and let the reader switch one, with every page redrawing from the *same* `OptionalContentConfig` instance the render uses. A `SetOCGState` link in the document must move the same state the panel shows, not a copy of it. |
| **FR-25** | Embedded File List | Surface a document's embedded files with their descriptions and save any one on demand, reading contents per file rather than prefetching the set. Must work on both engine shapes: 5.x carries the bytes in the attachment map, 6.x behind `getAttachmentContent()`. A file an annotation carries rather than the name tree names saves the same way, from the annotation itself. |
| **FR-26** | Replaceable Find Strategy | The find bar, the in-page marks and the match counter are driven by a host-supplied controller conforming to `PdfFindController`, so an alternative strategy (external index, stemming, fuzzy matching) is passed in rather than built around. |
| **FR-27** | Search Depth | Multi-word queries require every word on the page, `regex` treats the query as an expression, an uncompilable pattern is reported as such rather than as zero matches, and per-page match counts are exposed to the consumer. |
| **FR-28** | Composed Shell | Viewer state lives behind one controller published through a provider, and the toolbar, sidebar, page list and frame are importable parts that read it. A host can arrange its own layout without forking the shell, and can configure which controls the bar holds. |

---

## 5. Developer Experience & API Architecture

The package exposes two consumption models: **Compound Components** (for rapid installation) and **Headless Hooks** (for 100% custom user interfaces). Both share a third axis, **feature tiers** (§5.3), which decides how much of the library an application actually ships.

### 5.1 Headless API Example

_Shipped, with the names as they are today._ An earlier draft of this section used `results`,
`virtualPages` and a `{ index, offsetTop, height }` slot; the hook returns `search`/`results` from
`usePdfSearch`, and `virtualSlots` of `{ indices, pageNumber, offsetTop, width, height }` from
`usePdfVirtualizer`.

```tsx
import {
  PdfPage,
  usePdfDocument,
  usePdfSearch,
  usePdfVirtualizer,
} from 'pdfjs-react-reader/headless';

export function CustomViewer({ fileUrl }: { fileUrl: string }) {
  const { doc, numPages, isReady } = usePdfDocument({ src: fileUrl });
  const { results, activeIndex, search, nextMatch } = usePdfSearch({ doc });
  const { virtualSlots, containerRef, totalHeight, resolvedScale, reportPageDims } =
    usePdfVirtualizer({ doc, numPages, scale: 'fit-width' });

  return (
    <div ref={containerRef} className="viewer-viewport">
      <button onClick={() => search('indemnity')}>Find</button>
      <div style={{ position: 'relative', height: totalHeight }}>
        {virtualSlots.map((slot) => (
          <div
            key={slot.pageNumber}
            style={{ position: 'absolute', transform: `translateY(${slot.offsetTop}px)` }}
          >
            {slot.indices.map((index) => (
              <PdfPage
                key={index}
                doc={doc}
                pageNumber={index + 1}
                scale={resolvedScale}
                onBaseDimensions={reportPageDims}
              />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
```

### 5.2 Compound Components Example

_Not the shipped API._ This is the target shape, and `ROADMAP.md` §0.5 schedules it. Today's
`PdfViewer` is uncontrolled and takes its parts as props plus a `features` list; the pieces it is
assembled from (`Toolbar`, `Sidebar`, `ThumbnailList`, `PdfPage`, …) are exported and composable by
hand, but the children-as-slots form below is not. Written against the original proposal, in which the
stylesheet was `dist/style.css`; it is `pdfjs-react-reader/styles.css`.

```tsx
import { 
  PdfViewer, 
  PdfToolbar, 
  PdfSidebar, 
  PdfThumbnailList, 
  PdfPages 
} from 'pdfjs-react-reader';
import 'pdfjs-react-reader/styles.css';

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
// Basic: display only. Nothing beyond the core viewer is in the bundle — measured at 20.61 kB gz,
// and search, thumbnails and ink are in this tier, so "basic" is not "read-only".
import { PdfViewer } from 'pdfjs-react-reader';
import 'pdfjs-react-reader/styles.css';

<PdfViewer src={url} />

// Full: each feature is named, so each one is separately droppable. Search stayed core when the
// tier split landed, because a reader who cannot search is missing the first thing a reader does.
import { PdfViewer } from 'pdfjs-react-reader';
import { printFeature } from 'pdfjs-react-reader/features/print';
import { formsFeature } from 'pdfjs-react-reader/features/forms';
import 'pdfjs-react-reader/styles.css';
import 'pdfjs-react-reader/print.css';
import 'pdfjs-react-reader/forms.css';

<PdfViewer src={url} features={[printFeature, formsFeature]} />
```

A convenience barrel for "everything without listing it" is the root entry itself: `index.js` re-exports
the shell, its parts, the feature contract and every headless hook, and a bundler still shakes it down
to what a file names. No separate `/full` entry was made, because it would be an ordinary re-export
module with nothing to add.

---

## 6. Non-Functional Requirements (NFR)

* **Performance & Memory Footprint:** Off-screen canvases must be unmounted and their pixel buffers explicitly cleared (`context.clearRect()`) to prevent mobile Safari crashes.
* **Bundle Budgets:** Excluding `pdfjs-dist`, size is governed by a **ratchet**, not a ceiling: `scripts/check-size.mjs` measures every consumer path gzipped and fails the build when one grows more than 2 % above the baseline committed in `size-baseline.json` (256 B of slack absorbs minifier jitter). Accepting a growth means running `npm run size:update`, so the increase is a reviewed line in the same diff as the code that caused it. Per tier, the gate that stayed fixed is **no single feature above 4 kB gzipped over core**, and `0.4` measures it: print 2.02, download 0.86, forms 1.99, outline 0.93 kB, all four 5.18 kB over a 20.61 kB core. The **8 kB core target was dropped rather than met** — it was written against a prototype, and the real core viewer (pages, text, search, ink, thumbnails, layout, toolbar, sidebar, virtualization, worker lifecycle) measured 20.61 kB on the first run, so the number became a baseline instead of a requirement. For context the engine itself costs ~532 kB gzipped, so these numbers govern our own layer only. *(Amended 2026-09-25: the 45 kB ceiling was raised to 48 kB when `0.3`'s Trust features took the shell path from 42.88 to 45.45 kB, and then replaced by the ratchet — a ceiling that has to be renegotiated by whichever feature release happens to cross it is a scheduling artifact, not a requirement. Restated again at the close of `0.4`, which is what measuring per path was for.)*
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