# Product Requirement Document (PRD): pdfjs-react-reader

* **Package Name:** `pdfjs-react-reader`
* **Target Audience:** React developers who need a free, production-grade, deeply extensible PDF engine — with no commercial licence gate, no unmaintained wrapper, and no engine abstraction they cannot see through.
* **Core Engine:** `pdfjs-dist` `^6.2.108`, integrated directly. Zero wrapper dependencies. The optional
  editing and merge tiers use `@cantoo/pdf-lib` `^2.11.1` as a peer dependency.
* **License:** MIT.
* **Status of this document:** **This is the target specification.** It describes the package we are building toward, not a snapshot of what exists. The as-built record — every export, every constant, every measured figure, and a log of each place a document and the code disagreed — lives in [`CODE_REFERENCE.md`](./CODE_REFERENCE.md). The gap between the two is the work list; it is reconciled deliberately, at release boundaries, and never by quietly weakening a requirement here.
* **Companion documents:** [`ROADMAP.md`](./ROADMAP.md) — the version-by-version plan, keyed on the FR ids below. [`CHANGELOG.md`](./CHANGELOG.md).

---

### How to read this document

1. **FR ids are the contract.** FR-01 … FR-58 are cited by `ROADMAP.md`, by tests and by comments in
   `scripts/`. An id is never renumbered and never reused. A requirement that is withdrawn keeps its id and
   says why, so a reader who finds `FR-19` named in a two-year-old commit can still resolve it.
2. **Everything here is a requirement.** This file does not hedge a requirement into a description of
   today's behaviour, and it does not annotate a gap inline. Whether a given line is implemented, partially
   implemented or not started is answered by `CODE_REFERENCE.md` and by the release table in §7 — one place,
   kept current, instead of a caveat on every third sentence.
3. **Every measured figure names its machine and its date,** because a number without provenance is an
   adjective. Where a figure is a *target* rather than a measurement, it says so.
4. **Every code example must compile against the published export map.** An example naming a specifier the
   package does not export is a defect in this file, not a liberty. Examples are type-checked, not
   eyeballed — see §5.1.
5. **A requirement that cannot be verified is not a requirement.** Each FR either names an observable
   behaviour, a number, or a check that fails when it regresses. §8 is the matrix that says which machine
   proves which claim.

**What changes this file:** a new, amended or withdrawn requirement; a change of scope; a target figure.
**What does not:** implementation detail, internal file layout, or a running list of exported names. A PRD
that must be edited every time a function is renamed is a PRD nobody reads.

### Specification lock decisions

The following decisions are normative. They remove choices that would otherwise be made inconsistently by
the implementation, roadmap and documentation:

* **React support:** React and `react-dom` `>=18.0.0 <20.0.0`. React 18 and 19 are the supported majors; React 17 and React 20+
  are not supported by the `1.0.0` contract. The release matrix tests the minimum supported patch for each
  supported major and the current latest patch used by the release. React 17 compatibility may be considered
  only as a future compatibility decision with a dedicated implementation and CI matrix; it is not part of
  the `1.0.0` contract.
* **Engine support:** `pdfjs-dist` `^6.2.108` is the supported major-6 range, with `6.2.108` as the
  published floor. CI tests the floor and the latest supported 6.x version selected by the compatibility
  matrix. npm semver acceptance is not, by itself, a support claim. pdf.js 7.x is unsupported until a new
  compatibility decision, regression pass and documented support-range change are completed.
* **Writer support:** `@cantoo/pdf-lib` `^2.11.1` is optional and is required only by `/edit` and
  `/merge`. The root and `/headless` entries never import it.
* **Module support:** ESM is the primary runtime format and the supported Node/build floor is `>=22`, matching
  the minimum Node version adopted by PDF.js 6.0. CommonJS files and declarations are published, and synchronous
  `require()` of supported entries is certified on Node `>=22`. Node 20 is not a supported or certified runtime
  for this package. The package does not claim support for EOL Node releases.
* **Runtime resource budgets:** the canonical defaults are defined once in §6.1 and referenced by all FRs.
  The desktop target is `33,554,432` device pixels; the mobile target is `5,242,880`; the maximum canvas
  side is `32,767` device pixels; and the default print budget is `268,435,456` bytes (256 MiB). These are
  upper budgets, not promises that every browser can allocate them. At runtime the effective canvas ceiling is
  the minimum of the package budget, the host-configured budget, and the platform-detected safe canvas ceiling.
  A Safari/iOS platform limit therefore wins even when the user agent presents a desktop-class profile. The
  renderer uses a documented minimum render scale of `0.25` before refusing a page as unrenderable.
* **React implementation alignment:** the `1.0.0` package contract requires `react` and `react-dom` peer ranges `>=18.0.0 <20.0.0`. The implementation may use React 18 APIs such as `useSyncExternalStore`; no React 17 compatibility shim or additional runtime dependency is required by this specification.
* **Compatibility evidence:** implemented means the source and focused tests exist; supported means the
  required CI job has passed; certified means the evidence in §8 has run for the release. No row is called
  certified solely because it passed on the development Windows machine.
* **Release policy:** `0.1.2` has already been published and is the final pre-1.0 public release. No further 0.x npm
  release is planned under this specification; post-0.1.2 work is developed internally and published together at `1.0.0`. The roadmap labels `0.2.0` through `0.12.0` are internal
  development milestones, not npm releases and not public compatibility promises. Their completed work is
  published together for the first time as `1.0.0` only after every required release gate passes. No feature
  is removed or weakened to make the consolidated release green; an unmet requirement blocks `1.0.0` or is
  explicitly withdrawn with its permanent reason and FR id retained.

---

### Public contract principles

The PRD distinguishes **public contract**, **implementation detail**, and **verification evidence**:

* **Public contract:** documented exports, documented types, documented configuration, documented lifecycle,
  documented errors, documented cancellation behaviour, documented compatibility and documented resource
  safety limits. Consumers may depend on these.
* **Implementation detail:** internal files, private state shapes, internal PDF.js adapters, worker pooling,
  scheduling algorithms and other mechanisms may change without a public API change when the observable
  contract remains satisfied.
* **Verification evidence:** tests, benchmarks and CI jobs prove the contract; evidence does not silently
  change the requirement.

The package MUST expose a predictable dependency contract. A consumer MUST NOT be required to discover or
manually install hidden implementation dependencies to use a documented entry point. Required runtime
capabilities are either bundled appropriately or declared as explicit peer dependencies; optional
capabilities must not impose their dependencies on consumers who do not import them.

---

## 1. Executive Summary & Vision

Open-source React PDF viewers fail in one of two ways. They are unmaintained wrappers pinned to an
`pdfjs-dist` release from three years ago, so the host application inherits an engine it cannot upgrade and
a CVE it cannot patch. Or they work, and put text search, form filling, annotation and virtualized
scrolling behind a commercial licence — so the free tier is a demo.

`pdfjs-react-reader` is the third thing: an MIT-licensed, headless-first PDF **engine** for React that talks
to Mozilla's core directly, with no wrapper in between and nothing hidden. It owns the plumbing that is
genuinely hard and genuinely shared — worker lifecycle, viewport virtualization, the layered page stack,
canvas memory release, the writer boundary — and exposes it through two consumption models that do not
overlap: hooks and pure functions for an application drawing its own UI, and a drop-in shell for one that
does not want to.

Three commitments decide the shape of everything below.

**The import statement is the API.** An application that only displays a PDF must not pay for printing,
forms, annotation editing, attachments or the writer. Features are opt-in at the import, so an unused one
is absent from the bundle rather than hidden behind a prop a bundler cannot see. Props are runtime values;
only an import is visible at build time (FR-21, FR-23).

**The engine stays the user's choice.** `pdfjs-dist` is a peer dependency, so the host's lockfile decides
the engine version. That makes our supported range a contract rather than a preference, and it makes an
upstream major bump a regression pass we run before moving the range — not after (§6, Engine
Compatibility).

**Behaviour under load does not bend.** Bytes are negotiable; what the package does to a reader's machine
is not. Every performance claim in this file is stated against a named document shape and a named device
class, and the profiles we have not measured are listed as unmeasured rather than assumed (§6, Behaviour
Under Load and Benchmark Profiles).

The ambition, stated plainly: the package a team chooses when it has evaluated the commercial viewers and
decided it would rather own the layer than rent it.

---

## 2. Product Scope & Boundaries

### 2.1 Goals

* **Zero abstraction lock-in.** `pdfjs-dist` as a peer dependency; the host upgrades the engine
  independently, and our API does not hide the engine's own objects where hiding them would only cost
  capability.
* **Enterprise performance.** 60 FPS scrolling on 1,000+ page documents, sub-100 ms cold page render, and
  strict release of off-screen canvas memory (§6).
* **Headless first, shell optional.** A complete custom UI must be buildable from hooks and primitives
  alone, without importing the shell or its stylesheet.
* **Feature parity with the commercial incumbents.** Text selection, global search, AcroForm filling,
  thumbnails, outlines, rotation, layout modes, printing, download, annotation authoring, page authoring,
  optional-content groups, embedded files, XFA display.
* **Strict memory containment.** Off-screen canvases released, stale render tasks cancelled, and hard
  ceilings on canvas area and print-job size so a hostile or merely large document cannot exhaust the tab.
* **Progressive weight.** A display-only application ships a display-only bundle (§4.7).
* **Accessible by default, not by add-on.** Keyboard-complete, screen-reader legible, high-contrast aware,
  reduced-motion respecting, and structure-tree backed on tagged documents (§4.10).
* **Honest about its own evidence.** Every compatibility and performance claim is tied to a machine that
  ran it (§8).

### 2.2 Scope: v1.0 core

* **Document loading.** URL and path strings, base64, `ArrayBuffer`, `Uint8Array`, `Blob`, `File`, and a
  `ReadableStream`-style progressive source. A formal network contract: request headers, bearer and cookie
  credentials, range-request and streaming controls, bounded retries, and an `AbortSignal` on every
  asynchronous operation the package starts (FR-01, FR-34 – FR-38).
* **Lifecycle.** Named, published state models for both the document and the page, so a consumer can branch
  on a status instead of inferring one from a nullable object (FR-37).
* **Viewing & layout.** Viewport virtualization with overscan and stable placeholder heights; zoom from 25 %
  to 500 % plus fit-width, fit-page and automatic; high-DPI canvas scaling; continuous, single-page and
  two-page spread; per-page and document rotation (FR-05 – FR-09).
* **Navigation & structure.** Outline with destination resolution, measured-width thumbnails, jump-to-page
  with clamping (FR-10 – FR-12). Keyboard operation is covered by FR-45. Fullscreen and drag-and-drop are not
  v1.0 requirements unless explicitly added as FRs below.
* **Search.** Incremental, viewport-prioritised text indexing with progress; match highlighting; case,
  whole-word, regex and multi-term depth; per-page counts; a replaceable find strategy; and an injectable
  external index (FR-13 – FR-15, FR-26, FR-27, FR-39, FR-40).
* **Forms & annotations.** AcroForm widgets as real HTML controls with two-way value binding; existing
  markup rendered; and annotation authoring of highlight, free-text and ink editors that survive a save when `annotateFeature` is loaded (FR-16 – FR-18, FR-29).
* **Document features.** In-page printing under an explicit memory budget with a selectable range; download
  of loaded or saved bytes; optional-content groups; embedded files (FR-19, FR-20, FR-24, FR-25).
* **Composition.** One controller behind a provider, with the toolbar, sidebar, page list and frame
  importable as parts; a typed label/locale override for every string the shell writes; and a typed event
  surface for transitions a host would otherwise watch the DOM for (FR-28).
* **Accessibility.** Structure-tree integration on tagged documents, forced-colours and high-contrast
  rendering, and a WCAG 2.2 AA conformance target for the shell and every primitive (FR-43 – FR-45).
* **Environments.** React 18 and 19 with matching `react-dom`, StrictMode safety across both supported
  majors, concurrent-rendering safety where applicable, an SSR-safe module graph with a documented client
  boundary, and both ESM and CommonJS output (FR-41, FR-46).
* **Verification.** A browser matrix and an engine matrix in CI, and a benchmark fixture suite covering all
  four document profiles (FR-48 – FR-58).

### 2.3 Scope: v1.x

* **Advanced mobile interaction.** Multi-touch gesture arbitration, pinch-to-zoom isolated from the host
  page's own scroll and zoom, and one-handed navigation affordances. **FR-47 is a v1.0 requirement**;
  advanced refinements beyond its explicit acceptance criteria may land in v1.x.
* **Annotation depth.** Stamp with an image source, and underline / strikeout / squiggly once the engine
  exposes a highlight subtype to build them on.
* **Attachment depth.** Embedded-file previews and per-file metadata beyond name, description and size.
* **Search depth.** Stemming, fuzzy matching and result ranking, delivered through the FR-26 controller seam
  rather than baked into the core.
* **Theming.** Published design tokens with a documented contract, so a host can re-skin the shell without
  overriding selectors.

### 2.4 Scope: the editing capability (v1.0 optional tier)

The editing capability is part of the `1.0.0` specification but remains an optional import/peer boundary. A separate tier, `pdfjs-react-reader/edit`, behind an **optional** peer dependency on the PDF writer — so
the core keeps its zero-dependency promise and an application that never imports the tier never resolves a
writer.

* **Page manipulation.** Reorder, delete, rotate, extract, split, and **merge** with a second document
  (FR-30, FR-42).
* **Flattening.** Widgets and marks turned into page content, reading the same annotation storage the forms
  and annotation features write (FR-31).
* **Visual signing.** A mark drawn by the reader, written into a `/Sig` field's appearance stream (FR-32).
* **Architecture.** The viewer core never imports the writer. The tier is a feature value like any other,
  and its pure writer functions are exported separately so a headless consumer can drive them without the
  UI.

### 2.5 Non-Goals

* **Cryptographic signing and verification.** No PKI, no X.509 certificate-chain validation, no document
  integrity assertion. Drawing a mark and writing it into a signature field's appearance stream *is* in
  scope (§2.4, FR-32); what is written is a **visual signature appearance** — a picture of a signature, in
  the same sense a stamp is one. No signature *value* is ever written into a field, and a field that
  already carries one is refused rather than covered over, because that value is somebody's claim over the
  bytes.
* **Document authoring from nothing.** Creating a PDF that did not exist is out of scope. Modifying one
  that does is §2.4.
* **XFA persistence.** XFA forms are rendered and read; XFA submit and save are Adobe LiveCycle behaviour
  with no open implementation, so an XFA document's save is refused with a reason rather than attempted and
  corrupted (FR-33).
* **Desktop-grade vector editing.** No editing of underlying paths, no font kerning, no content-stream
  surgery.
* **Embedded JavaScript execution.** Permanently disabled, with no option to enable it. A document that
  declares script actions is *reported* so a host can tell the reader, but the actions never run (§6,
  Security).

---

## 3. Architecture & API Boundaries

```text
                     ┌───────────────────────────────────────────────┐
                     │              Your React Application           │
                     └───────────────────────┬───────────────────────┘
                                             │
               ┌─────────────────────────────┴─────────────────────────────┐
               ▼                                                           ▼
┌───────────────────────────────┐                       ┌─────────────────────────────────────┐
│      Pre-built UI Shell       │                       │           Headless Hooks            │
│  Toolbar · Sidebar · pages    │                       │   document · virtualizer · search   │
│  find bar · feature panels    │                       │   outline · forms · print · edit    │
└──────────────┬────────────────┘                       └──────────────────┬──────────────────┘
               │                                                           │
               └─────────────────────────────┬─────────────────────────────┘
                                             ▼
                     ┌───────────────────────────────────────────────┐
                     │          Virtual Viewport Manager             │
                     │    (heights, visible indices, overscan)       │
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
         │ • Editor + Draw Layer │                       │ • Structure Layer     │
         │ • XFA / Editor Layer  │                       │                       │
         └───────────────────────┘                       └───────────────────────┘
                                             │
                                             ▼
                     ┌───────────────────────────────────────────────┐
                     │               pdfjs-dist Engine               │
                     │        (worker per document, §3.4)            │
                     └───────────────────────────────────────────────┘
```

Dialog-shaped surfaces have no overlay layer and no modal: the password prompt replaces the page area
inside the viewport region; outline, layers, attachments and edit each publish a panel that the sidebar
renders; print's range inputs are toolbar controls; the find bar is a row under the toolbar.

### 3.1 Module separation

Six layers, each with a reason to be separate from the one below it:

| Layer | Responsibility |
| :--- | :--- |
| **Core engine glue** | Source normalisation, worker resolution, layout and zoom mathematics, the text index, the print plan, download, the writer boundary. No React. |
| **Headless hooks** | One concern and one lifetime each: document, virtualizer, search, outline, form values, print, download, optional content, attachments, and annotation-authoring state where the annotate feature is loaded. |
| **Primitives** | Components an application assembles by hand: page, thumbnail, thumbnail list, outline view, sidebar, toolbar, search box, password prompt, annotation editor layer, structure layer. |
| **Shell parts** | One controller published through a provider and read by importable parts: root, toolbar, sidebar, pages, layout. |
| **Viewer shell** | The drop-in component — uncontrolled, taking its parts as props plus a feature list. |
| **Features & tiers** | Opt-in values the shell never imports statically: print, download, forms, outline, layers, annotate, attachments, edit. |

The rule that keeps the layers honest: **a layer may import downward and never upward.** The core engine
glue contains no React; the hooks contain no DOM; the shell imports no feature.

### 3.2 Entry points & tree-shaking

The published entry points *are* the module boundaries. A bundler cannot tree-shake what a file imports, so
the split is enforced by the export map rather than left to an optimiser:

| Entry | Contents |
| :--- | :--- |
| `pdfjs-react-reader` | Shell, shell parts, primitives, the feature contract, and every headless hook. The barrel — a bundler still shakes it down to what a file names. |
| `pdfjs-react-reader/headless` | Hooks and pure functions only, for an application that renders its own components. |
| `pdfjs-react-reader/edit` | The editing tier and its writer functions (§2.4), including page manipulation, flattening and visual signing. |
| `pdfjs-react-reader/merge` | The merge-only writer entry (FR-42), sharing the optional writer peer without importing the viewer shell. |
| `pdfjs-react-reader/features/*` | One feature per entry. A feature that would be dead weight in the core — search included — earns its own entry only if a real consumer needs it droppable; otherwise it stays core and says so. |
| `pdfjs-react-reader/*.css` | One stylesheet per tier, so a tier's rules never ship to an application that did not ask for the tier. |
| `pdfjs-react-reader/locales/*` | Label catalogues. The typed default-language catalogue needs no import. |

Both ESM and CommonJS output are published, with complete declarations for every public entry (FR-41).

### 3.2.1 Public API boundary

The public API consists only of names reachable from the documented export map and documented in the
package API reference. Public contracts include configuration objects, hooks, components, feature values,
controllers, state unions, errors, source utilities and TypeScript types. Internal PDF.js classes, private
state stores, renderer implementation objects and worker internals are **not** public unless explicitly
exported and documented.

The package MUST NOT accidentally expose a PDF.js internal object merely because it appears in an inferred
TypeScript type. Where a raw `pdfjs-dist` type is deliberately part of the public surface, the PRD and API
documentation must identify it and the engine-compatibility policy applies to that surface.

The package MUST ship declarations without accidental public `any`; public generic escape hatches must be
intentional, named and documented.

### 3.2.2 Dependency contract

* `react`, `react-dom` and `pdfjs-dist` are peer dependencies of the appropriate public entries.
* `@cantoo/pdf-lib` is an optional peer dependency required only by `/edit` and merge functionality.
* The root and `/headless` entries MUST NOT import the writer tier.
* No undeclared runtime dependency may be required by a documented entry point.
* A clean `npm pack` consumer test is part of release verification so the contract is tested against the
  actual published artifact rather than only the repository source tree.

### 3.3 Layered page pipeline

A rendered page is a stack of positioned layers inside one DOM node. Which layers exist depends on the
document and on the features the application enabled. In paint order:

1. **Canvas layer** (bottom) — high-DPI, hardware-accelerated; renders vector curves, fonts and raster
  images. Its buffer is capped by area and by side, so an over-large page lowers render scale rather than
  allocating without limit; it refuses only when the page cannot be represented safely at the minimum
  supported scale.
2. **Text layer** — invisible HTML spans positioned over canvas coordinates, giving OS-native selection,
   copy/paste and screen-reader access. Search marks are written into this layer, and a zoom step updates
   it in place rather than rebuilding it.
3. **Annotation layer** — links, popups and AcroForm widgets as real HTML controls. Made pointer-inert
   while an annotation-authoring gesture is armed, or a widget would swallow the gesture.
4. **Editor layer** — mounted only when an annotation-authoring feature is present. Its SVG roots sit
   below the text layer, so a highlight tints the page image without dimming selectable text. Ink authoring
   is part of the annotation-authoring feature, not the core.
5. **Structure layer** — the tagged document's structure tree, giving a screen reader the hierarchy rather
   than an undifferentiated run of text, and giving annotations their owning node (FR-43).
6. **XFA layer** — the whole page for an XFA form rather than an overlay on it.

The editor/draw layer is optional and belongs to annotation authoring; there is no core pen or core freehand
drawing tool. This keeps the display core free of an authoring interaction and keeps drawing weight behind its
feature boundary.

Overlay layers are laid out in unrotated page space while the canvas is drawn through a rotated viewport,
so a 90° or 270° turn is corrected in the layer's own transform rather than in engine coordinates.

### 3.4 Worker isolation & concurrency

* **State isolation.** Each document instance has an isolated engine execution state: its own worker, its
  own annotation storage. Worker allocation and reuse is an internal policy — a pool is permitted and may
  be added without a public API change, provided isolation holds.
* **Concurrency ownership.** Every asynchronous operation the package starts — fetch, parse, render, text
  extraction, indexing, write — accepts and honours an `AbortSignal`, and exposes one where a consumer
  needs to cancel it (FR-36).
* **Invalidation.** If a consumer opens document B while A is loading, or unmounts a page mid-render, every
  pending task belonging to the superseded state is invalidated immediately and its memory released. A
  superseded load is not an error and never reaches an error handler.
* **The invariants a change must not break:** no task from a superseded load can write into the successor's
  state; unmounting mid-render produces no error and no leaked buffer; scrolling a row out releases its
  canvas; a render cancelled by a zoom step is not reported as a failure.
* **Worker location.** The engine's worker-script location is process-global, so the package exposes worker
  configuration as a public contract rather than hiding it. A load captures the configured URL at its start,
  but two simultaneous viewers using different worker URLs are unsupported; hosts MUST use one worker URL
  per JavaScript realm. Conflicting active worker configurations are reported as a stable configuration
  error rather than silently switching a live document to another worker. Internal worker pooling/reuse may
  change without a public API change as long as document isolation and this configuration contract hold.

### 3.5 State models

Named, published unions — so a consumer branches on a status rather than inferring one from a nullable
object.

**Document:**

```text
idle → loading → password-required → ready → destroyed
             ├──────────────→ cancelled → destroyed
             └──────────────→ error → destroyed
password-required ──(incorrect password)──→ password-required
cancelled/error ──(explicit retry)──→ loading
```

| State | Meaning |
| :--- | :--- |
| `idle` | Constructed, no load started. |
| `loading` | A load is in flight. Progress is reportable. |
| `password-required` | The document is encrypted and waiting on a credential. Carries the reason: first request, or incorrect password. Resolves by submitting a password — or by submitting an error, which is how a cancel fails the load cleanly instead of hanging it. |
| `ready` | Open. Page count and capabilities are known. |
| `error` | A failure the load did not survive, carrying a stable `PdfErrorCode` plus a safe message. |
| `cancelled` | The consumer or owning lifetime aborted the load. Cancellation is not a failure and does not invoke the ordinary error callback. Terminal before destruction. |
| `destroyed` | Torn down. Terminal; no field of the result may be read as live. |

A superseded load transitions through `cancelled` or directly to `destroyed` according to the public
operation contract, never to `error`. Consumer-visible cancellation is distinct from an actual load failure.

**Page:**

```text
unrequested → queued → rendering → rendered → released
                  ↓         ↓           ↑
               cancelled    error ───────┘
                  ↑          │
                  └── retry ─┘
```

| State | Meaning |
| :--- | :--- |
| `unrequested` | The virtualizer has not asked for it. No work, no memory. |
| `queued` | Asked for, waiting on the page proxy or a render slot. |
| `rendering` | A render task is in flight and is cancellable. |
| `rendered` | Painted, with its overlay layers laid out. |
| `cancelled` | A render was stopped — by unmount, scroll-out, zoom or a superseded load. Not an error. A cancelled page may be re-queued when it becomes visible again. |
| `released` | Off-screen; its canvas buffer has been returned to the browser. Re-entry into the viewport may transition it back to `queued`. |
| `error` | A failure that reached the page. Reported, not swallowed. An explicit retry re-queues the page. |

**Capabilities,** reported once the document is `ready`: which form technology the document declares
(none / AcroForm / XFA / mixed), whether the pages on screen were composed from the XFA template rather
than from content streams, and whether the document declares JavaScript actions.

### 3.6 Error contract

All consumer-visible failures use a stable `PdfError` shape with a machine-readable `code`, a safe human-
readable `message`, and optional structured details. The exact implementation may carry a native `cause`,
but credentials, request headers, cookies and other secrets MUST NOT be copied into the public error.

The initial error-code vocabulary is:

```text
INVALID_SOURCE
NETWORK_ERROR
HTTP_ERROR
AUTH_ERROR
PASSWORD_REQUIRED
PASSWORD_INVALID
LOAD_CANCELLED
RENDER_CANCELLED
SEARCH_CANCELLED
WORKER_ERROR
CONFIGURATION_ERROR
UNSUPPORTED_FEATURE
RESOURCE_LIMIT
SOURCE_NOT_ALLOWED
REGEX_TIMEOUT
ALREADY_SIGNED
PDF_PARSE_ERROR
WRITER_ERROR
UNKNOWN_ERROR
```

The vocabulary is extensible without reusing an existing code for a different meaning. Cancellation codes
are not treated as ordinary failures. Public callbacks, promises and state models must preserve the
cancellation/failure distinction.

### 3.7 Feature contract

Every opt-in feature is a typed value with a stable identity and explicit dependency/lifecycle metadata.
The public feature contract MUST define, at minimum:

* a unique feature id;
* declared feature dependencies;
* registration/initialization hooks and optional cleanup;
* the context capabilities available to the feature;
* optional stylesheet entries;
* duplicate-registration behaviour;
* dependency-cycle/missing-dependency behaviour; and
* registration ordering rules where ordering is observable.

Features may depend on lower layers but MUST NOT create upward imports that violate §3.1. A feature must
release listeners, tasks, object URLs and other resources it owns during cleanup.

---

## 4. Functional Requirements & Feature Matrix

### 4.1 Document Loading & Lifecycle
| Requirement ID | Feature | Specification |
| :--- | :--- | :--- |
| **FR-01** | Input Flexibility | Accept an absolute URL, root-relative URL, relative URL, a base64 string of the file's bytes, `ArrayBuffer`, `Uint8Array`, `Blob`, `File`, or a WHATWG `ReadableStream<Uint8Array>` progressive byte source. A source string is classified before anything is fetched: empty strings, bare words, Windows backslash paths, malformed base64, and unsupported schemes are refused with a stable reason code. Relative URLs resolve against the document base URL in a browser and are refused when no base URL exists. `data:` URLs containing valid base64 bytes are treated as byte input; `blob:` URLs are treated as browser-local URLs. |
| **FR-02** | Worker Configuration | Configure the worker with a URL resolved by the host or bundler, including an imported worker asset's URL, or with an external CDN URL. The public option is a worker URL; the package does not guess a CDN URL. When it is absent, leave pdf.js's own fallback reachable and fail with a stable configuration reason when the engine cannot locate worker code. A main-thread render is available only where the worker code is reachable without a URL — pdf.js's own default in Node, or a host that has put the handler on `globalThis.pdfjsWorker` — and no ordinary browser state without one is promised. Because pdf.js stores the worker URL in process-global `GlobalWorkerOptions.workerSrc`, the value captured at load start controls that load, a later explicit configuration affects later loads, and two simultaneous viewers must use the same worker URL. Conflicting active worker URLs are unsupported and must surface as a documented configuration error. |
| **FR-03** | Password Protection | Intercept an encrypted document and emit a callback carrying a submit function and the reason (first request, or incorrect password), so a host can mount its own credential UI. Without a handler, the viewer shows its own prompt in the page area. Cancelling submits an error to the same callback, which is how the load fails cleanly instead of hanging. An incorrect password must produce an observable second prompt, not silence. |
| **FR-04** | Cancellation Safety | Cancel an active render task immediately on unmount or scroll-out. A cancellation is identified by type, is distinguishable from failure, and never reaches an ordinary error handler; anything else does. Consumer-visible operations expose the published cancellation error/type and preserve the `AbortSignal` reason where the platform provides one. |
| **FR-34** | Network Contract | Forward request headers and credential mode to the engine's fetch, so a document behind bearer auth, a signed URL or a session cookie can be loaded at all. Expose range-request and streaming controls, and a chunk size, so a host on a metered or high-latency connection can choose progressive display over whole-file download. Headers and credentials are read at load start and never re-read mid-load. |
| **FR-35** | Bounded Retries | Retry a transient network failure with bounded exponential backoff and full jitter. The default is three total attempts, with a one-second initial delay and a thirty-second maximum delay; hosts may configure the attempt count and ceiling, and tests may inject the delay source. Retry only on statuses 408, 425, 429 and 5xx, connection failures, and engine error classes explicitly classified as transient. A 401 or 403 is surfaced as an auth failure on the first response and never retried. Every attempt is reportable, and an aborted retry stops before its next delay or request. |
| **FR-36** | Cancellation Tokens | Every asynchronous operation the package starts accepts an `AbortSignal`: load, page proxy fetch, render, text extraction, indexing, thumbnail, print render, download, and every writer pass. Aborting triggers the same internal cancellation as unmount or scroll-out. Public operations report cancellation through the published `PdfError`/abort type; they do not call the ordinary error callback, and an already-aborted signal performs no work. Superseded internal work is also cancelled but is not surfaced as a host error. Each effect owns cancellation for its own lifetime, because a page-proxy fetch ends when the page number changes while a canvas render ends when the scale does. A writer pass is the honest exception: its synchronous loop stops before the next page and never returns bytes, but cannot undo a page already changed inside the writer. The cancellation contract is stable across React 18 and 19. |
| **FR-37** | Published State Models | Expose the document and page state unions of §3.5 as public types, and keep them consistent with the underlying fields — a status is never readable as `ready` while the document handle is null. State transitions are reportable, so a host can drive its own progress UI without polling. |
| **FR-38** | Source Utilities | Export the source helpers a host needs to prepare an input: base64 to a byte source, and classification of an unknown string into url / bytes / refused, with the refusal reason. A host that receives a file from an upload widget should not have to reimplement the heuristic. |

### 4.2 Display, Zoom & Layout Modes
| Requirement ID | Feature | Specification |
| :--- | :--- | :--- |
| **FR-05** | Viewport Virtualization | Render only visible pages plus a small overscan buffer. Placeholder heights come from real page dimensions once known, so the scrollbar does not jump as pages measure themselves. |
| **FR-06** | Responsive Zoom Modes | Arbitrary zoom from 25 % to 500 %, plus fit-to-width, fit-to-page and automatic. A zoom step updates existing overlay layers in place rather than rebuilding them. |
| **FR-07** | High-DPI Adaptation | Scale canvas pixel density by the device pixel ratio while layout dimensions stay in CSS pixels, and re-evaluate when the ratio changes (a window moving between displays). |
| **FR-08** | Page Layouts | Continuous vertical scroll, single-page presentation, and two-page spread. Layout mode is a property of the virtualizer, not of the page: switching regroups the rows without remounting a page, and repaints only when the fit target itself moves. At a fixed zoom the painted canvases are untouched; in a fit mode they are not, and that is correct rather than wasteful, because fitting two pages into one width is a different fit than fitting one. |
| **FR-09** | Rotation | 90° clockwise and counter-clockwise, per page or document-wide, with every overlay layer staying registered to the painted page. |

### 4.3 Navigation & Document Structure
| Requirement ID | Feature | Specification |
| :--- | :--- | :--- |
| **FR-10** | Outline | Parse the bookmark tree recursively, including nested and named destinations, and resolve a click to a page and a position. An invalid ARIA tree is a defect, not a styling choice. |
| **FR-11** | Thumbnails | Render miniature pages at the card's measured CSS width times the device pixel ratio, so a thumbnail is as crisp as the sidebar is wide, with the visible range tracked and highlighted. |
| **FR-12** | Jump-to-Page | Numeric navigation with boundary clamping, and page labels honoured where the document defines them — a reader who sees "xii" should be able to type "xii". |

### 4.4 Text Search & Selection
| Requirement ID | Feature | Specification |
| :--- | :--- | :--- |
| **FR-13** | Text Indexing | Extract page text into a per-document index. Indexing reports progress and never blocks interaction: it yields to the event loop on a bounded interval. |
| **FR-14** | Match Highlighting | Highlight matches in the text layer with native `mark` nodes, distinguishing the active match from the rest, and scroll the active match into view. |
| **FR-15** | Search Controls | Case sensitivity, whole-word, next and previous, and a live match counter reporting position within the total. |
| **FR-26** | Replaceable Find Strategy | The find bar, the in-page marks and the counter are driven by a host-supplied controller conforming to a published interface, so an alternative strategy is passed in rather than built around. |
| **FR-27** | Search Depth | Multi-word queries are phrase searches by default: the normalized terms must occur in order as a contiguous phrase; normal search treats the query as literal text and escapes it before matching; regex mode treats the query as a raw JavaScript expression. Regex patterns are limited to 256 UTF-16 code units, compiled before extraction, evaluated in an isolated worker dedicated to that regex query with a 100 ms per-page budget. On timeout or abort, the query worker is terminated and its resources released; the viewer may create a replacement worker for later regex queries. A timed-out query is therefore enforceable rather than merely best-effort. An uncompilable or timed-out pattern is reported as a pattern error rather than as zero matches; per-page match counts are exposed to the consumer. |
| **FR-39** | Incremental, Viewport-Prioritised Indexing | Index the visible range first, then continue outward, so the first query on a large document answers against what the reader can see instead of after a whole-file pass. A query may be answered from a partial index and must then say that it was: a result count that is still growing is reported as provisional, never as final. Re-indexing after a page edit invalidates only what changed. |
| **FR-40** | Injectable External Index | Accept a prebuilt index — from a server, a search service, or a previous session — conforming to the published index shape, and use it in place of extraction. A host with server-side search over its own corpus should not pay for client-side extraction to get our highlighting. |

### 4.5 Forms & Annotations
| Requirement ID | Feature | Specification |
| :--- | :--- | :--- |
| **FR-16** | AcroForm Support | Render interactive form fields — text, radio, checkbox, dropdown, list box, and signature widgets — as real HTML controls. A signature widget renders as its box; capturing a mark into one is the editing tier's job (§2.4). |
| **FR-17** | Form Data Sync | Two-way binding of field values with serialisation to and from a plain object, including initial-value reset and dirty tracking, so a host can warn before discarding a reader's work. |
| **FR-18** | Annotations: View | Render existing link, markup and form-related annotations through the annotation layer. No core drawing/pen tool is included. Authoring tools, including ink, are provided only by FR-29 through `annotateFeature`. |
| **FR-29** | Annotation Authoring | Highlight, free-text and ink authoring through the engine's own editor manager, owned and disposed by `annotateFeature`, and persisted by an incremental save. An editor survives its page scrolling out and back. Tools the engine cannot persist correctly are not offered, and the reason is recorded rather than discovered by a user at save time. |

### 4.6 Export & Utilities
| Requirement ID | Feature | Specification |
| :--- | :--- | :--- |
| **FR-19** | High-Fidelity Printing | Render the selected pages into an in-page container and let a print stylesheet hide everything else — no popup and no second document, so the host application's own print styles still apply. Resolution is the highest step that keeps the whole job inside an explicit memory budget; a selection that cannot fit is refused, and the refusal names the page count that would. Form values and persisted annotation marks travel with the pages; annotation-authoring marks travel with the pages only when the annotation-authoring feature has been loaded and its marks have been persisted; there is no transient core drawing capability. A platform whose print support is known-broken reports that instead of silently producing blank paper. |
| **FR-20** | Document Download | Download the bytes the engine holds: the loaded bytes when nothing is pending, and an incremental save when something is. A save is not a flatten, and the two are named distinctly everywhere they appear — fields stay interactive and marks stay selectable after a save. A true flatten is the editing tier's (FR-31). |

### 4.7 Bundling & Feature Tiers
| Requirement ID | Feature | Specification |
| :--- | :--- | :--- |
| **FR-21** | Opt-In Feature Registration | The core viewer must not statically import any optional feature. A feature is a typed value conforming to §3.7 that the application passes in, so an unused feature never enters the module graph. A feature's hooks live inside its own runner component, never in the shell body, and runners are keyed by feature identity rather than list position. Duplicate registration and missing/cyclic dependencies have deterministic, tested behaviour. |
| **FR-22** | Per-Feature Stylesheets | Each feature ships its own stylesheet entry, and the core stylesheet carries no rules for features the application did not request. Stylesheets are exempt from tree-shaking; JavaScript is not. |
| **FR-23** | Enforced Size Boundary | Every tier is measured independently in CI — core, each feature incrementally over core, and all — and the build additionally asserts that the core artifact contains no code belonging to a feature, so a reintroduced static import fails the build instead of silently regressing the tier. Bundle budgets are CI quality gates, not runtime feature limits: exceeding one MUST trigger optimization or an explicit reviewed budget change, never removal or degradation of required functionality. |
| **FR-41** | Dual Module Output | Publish ESM and CommonJS builds with types for each, and prove both resolve from a packed tarball. ESM import, the build toolchain and synchronous CommonJS execution are supported on Node `>=22`, matching the PDF.js 6.x runtime floor. Node 20 is not supported. A package that cannot be imported and required on Node 22 and later must fail the packaging job. |

_Acceptance note for FR-21:_ feature runner elements are keyed by feature id, never by array position.
Measured behaviour, and the reason both halves of this requirement carry a test: dropping an unrelated
feature from the list with an index key remounts the surviving feature and discards its internal state,
with no error raised.

_Acceptance note for FR-22:_ one stylesheet per tier is a published entry, not a rule inside the core
sheet. Shipping them as JavaScript-side imports does not work under our bundler: the CSS import is resolved
at build time, stripped from the module, and emitted as a sibling file nothing loads — so the styles go
missing with no error, which is precisely the failure mode this requirement exists to prevent.

_Acceptance note for FR-23:_ each feature is detected in the consumer bundle by a marker that exists only
inside it, asserted in both directions — absent from the core bundle, present in its own. A marker that
stops existing must fail the build; a size gate that only checks absence would pass green on a feature
that had been renamed out of existence.

### 4.8 Composition & Document Structure
| Requirement ID | Feature | Specification |
| :--- | :--- | :--- |
| **FR-24** | Optional-Content Layers | List a document's optional-content groups and switch one, with every page redrawing from the same configuration instance the render uses. A `SetOCGState` action inside the document must move the same state a panel shows, not a copy of it. |
| **FR-25** | Embedded Files | Surface a document's embedded files with their descriptions, and save any one on demand, reading contents per file rather than prefetching the set. A file carried by an annotation rather than named in the name tree is listed and saved the same way. |
| **FR-28** | Composed Shell, Labels, Events & Locales | Viewer state lives behind one controller published through a provider, and the toolbar, sidebar, page list and frame are importable parts that read it. A host can arrange its own layout without forking the shell, configure which controls the bar holds and in what order, override every shell-written label through the typed locale contract, and subscribe to the documented typed event surface. |

### 4.9 Authoring, Editing & Signing
| Requirement ID | Feature | Specification |
| :--- | :--- | :--- |
| **FR-30** | Page Authoring | Reorder, delete, rotate, extract and split the document's own pages, with undo at two levels: within the pending batch, which is a permutation of integers and costs no bytes; and of the last apply, which restores the snapshot that write started from. A split makes two files. Writes are batched, so a document that is megabytes is parsed once per apply and not once per keystroke. |
| **FR-31** | True Flattening | Turn widgets and marks into page content, reading the same annotation storage the forms and annotation features write, so what a reader actually marked is what gets flattened. A field with no appearance is given one before flattening, because asking a box for an appearance it does not have is how a flatten throws on every unsigned form. |
| **FR-32** | Visual Signing | A mark drawn on a pad, written into a signature field's appearance stream and scaled into each widget box that field declares. No signature *value* is written (§2.5). A field that already carries one is refused, and "already signed" is determined by that value rather than by the presence of an appearance — an empty appearance proves nothing was signed. Locating a document's boxes costs one parse, taken only when there is something to place, and reported while it runs. |
| **FR-33** | XFA Display, Save Refused | Render a pure-XFA document, whose pages have no painted content of their own. Search marks and thumbnails work against the rendered tree. Viewport changes update the layer rather than re-appending it. Saving an XFA document is refused with a reason, not attempted and corrupted. |
| **FR-42** | Document Merge | Combine the open document with one or more others into a new file, with page-level selection from each source and a preview of the resulting order. Merge is a *new document*, not a mutation of the open one: the sources stay untouched and the result is written out, so a reader cannot destroy a file by experimenting. Requires a second document lifecycle in the tier, which is why it is scoped separately from FR-30. |

### 4.10 Extended Public Contracts & Release Boundaries
| Requirement ID | Feature | Specification |
| :--- | :--- | :--- |
| **FR-52** | Public API & Export Contract | The published export map is the authoritative public surface. Root, `/headless`, `/edit`, `/merge`, `/features/*`, CSS and locale entries are explicitly classified as public; there is no standalone `/types` entry, and public TypeScript contracts are exported from the relevant documented JavaScript entries. Internal modules are unreachable from documented exports, and every documented example must compile against the packed artifact. |
| **FR-53** | Dependency & Engine Contract | Required runtime dependencies are either bundled by explicit design or declared as peer dependencies; React and `react-dom` must match major versions, `pdfjs-dist` support is limited to the documented 6.x contract with floor `6.2.108`, and `@cantoo/pdf-lib` is an optional peer used only by editing/merge entries. npm semver acceptance alone is not a support claim. |
| **FR-54** | Stable Error & Cancellation Contract | All consumer-visible failures use `PdfError` and stable codes. `SOURCE_NOT_ALLOWED`, `REGEX_TIMEOUT`, `ALREADY_SIGNED`, resource-limit failures and cancellation are distinguishable. Abort is not reported as an ordinary failure, and retry/requeue transitions are deterministic. |
| **FR-55** | Worker & Source Security Contract | Worker configuration is public and one worker configuration applies per JavaScript realm. Source policy supports same-origin defaults plus explicitly allowed cross-origin/signed URLs; redirect enforcement is claimed only where the package controls the fetch. Embedded JavaScript execution remains disabled. |
| **FR-56** | Feature Lifecycle Contract | Every feature has a stable id, dependency list, registration lifecycle, cleanup contract, ordering rules, duplicate-registration behaviour and missing/cyclic-dependency behaviour. Feature modules cannot import upward into shell consumers or bypass the public feature boundary. |
| **FR-57** | Runtime Resource Budget Contract | Canvas, print and other runtime safety budgets are centralized in §6.1. Effective canvas allocation is the minimum of package, host and detected platform limits; budgets may constrain runtime safety behaviour only where explicitly specified and never serve as excuses to remove bundle functionality. |
| **FR-58** | Release Evidence & Consumer Verification | A release candidate must pass on a clean CI runner from a packed npm artifact, cover supported React/engine/browser matrices, include the required real-device pass, validate upgrade from the previous public release, and produce reproducible benchmark and accessibility evidence before `1.0.0`. |

### 4.11 Accessibility
| Requirement ID | Feature | Specification |
| :--- | :--- | :--- |
| **FR-43** | Structure-Tree Integration | On a tagged document, surface the structure tree: the annotation and editor layers receive a structure-layer instance, so a widget is announced with its owning node rather than as an unlabelled control, and a screen reader gets heading, list and table hierarchy instead of an undifferentiated run of text. An untagged document degrades to the text layer without error. |
| **FR-44** | High Contrast & Forced Colours | Render correctly under `forced-colors` and high-contrast settings: chrome takes system colours rather than overriding them, focus remains visible, and marks that convey meaning by colour alone (search matches, the active match, annotation highlights) also convey it by shape, outline or text. |
| **FR-45** | WCAG 2.2 AA Conformance | The shell and every primitive target WCAG 2.2 AA: keyboard-complete operation with no trap, visible focus, a valid ARIA tree, instance-scoped key handling so two viewers on one page do not both react, generated ids that are unique per instance, 44 px touch targets, page-change announcements, and `prefers-reduced-motion` honoured. Evidence is split into automated axe and DOM assertions, browser keyboard and forced-colour checks, geometry checks for touch targets, and a documented screen-reader pass. The required release pass covers NVDA with Firefox, JAWS with Chromium, and VoiceOver with Safari; each pair must exercise loading, navigation, search, forms, annotations and tagged structure where applicable. Automated audit alone is not treated as proof of full conformance. |

### 4.12 Platform, Environments & Verification
| Requirement ID | Feature | Specification |
| :--- | :--- | :--- |
| **FR-46** | SSR-Safe Module Graph | Importing any documented entry point in a server environment must not throw: no module-top-level access to `document`, `window`, `canvas` or a worker. Rendering requires a DOM and is client-only, so the documented pattern is a client boundary around the viewer — and the package must make that boundary easy to write rather than easy to get wrong. Server-side import is a tested property, not an accident, and the test covers the published tarball. |
| **FR-47** | Touch & Gesture Handling (v1.0) | Multi-touch gestures arbitrated explicitly: pinch zooms the page without also scrolling the host page, a one-finger drag while an annotation drawing tool is armed draws rather than scrolls, and a tap on a link or widget activates it. Gesture handling is isolated so the host application's own listeners are not starved, and every gesture has a keyboard or control equivalent. |
| **FR-48** | Browser & Engine Verification Matrices | CI runs the suite across Chromium, Firefox and WebKit, plus a mobile-emulated pass, and tests the published engine floor `6.2.108` and the latest supported 6.x release. React tests run against React 18 and 19, covering the minimum supported patch and the latest patch of each supported major. Matching `react-dom` majors are tested. A compatibility claim in §8 is backed by a job that fails when it regresses; a browser, React major or engine that cannot start is an unverified row, not a pass. |
| **FR-49** | Benchmark Fixture Suite | A committed fixture for each benchmark profile in §6 — text-heavy, image-heavy, vector-heavy, and a low-memory device harness — generated by a script in the repository so the fixtures are reproducible rather than binary blobs nobody can regenerate. Each profile's target is measured against its fixture in CI and reported, so a regression is a failing job rather than a slower feeling. |
| **FR-50** | Published API Maturity | Every public name carries a maturity tag (§5.5), enforced by a check rather than by convention: a name that is exported and untagged fails the build. Stability promises are only meaningful if the set of names making them is legible. |
| **FR-51** | Edge-Case Suite | A committed test for each way a document can be wrong rather than merely large: a file truncated mid-object, a file whose cross-reference table points past the end, an encrypted document, a wrong password, a rotated page, and an over-large page. Each asserts the *distinction* the reader depends on — which of these recover, which refuse, and which park on a callback — because a viewer that shows a blank page for all six has not failed six times, it has failed to say anything at all. |

---

## 5. Developer Experience & API Architecture

Two consumption models: **headless**, for an application drawing its own UI, and **the shell**, for one
that wants a viewer now. They share a third axis — **feature tiers** — which decides how much of the
library an application ships.

**Every example in this file and on the docs site must compile against the published export map.** The docs
site builds its examples rather than quoting them, so an example that stops compiling stops the docs build.

### 5.1 Headless example

```tsx
import { PdfPage, usePdfDocument, usePdfSearch, usePdfVirtualizer } from 'pdfjs-react-reader';
import 'pdfjs-react-reader/styles.css';

function CredentialPrompt() { return <input type="password" aria-label="PDF password" />; }
function reportError(error: unknown) { console.error(error); }

export function CustomViewer({ fileUrl }: { fileUrl: string }) {
  const { doc, numPages, status } = usePdfDocument({ src: fileUrl });
  const { search } = usePdfSearch({ doc });
  const { virtualSlots, containerRef, totalHeight, resolvedScale, reportPageDims } =
    usePdfVirtualizer({ doc, numPages, scale: 'fit-width' });

  return (
    <div ref={containerRef} className="viewer-viewport">
      <button onClick={() => search('indemnity')}>Find</button>
      {status === 'password-required' && <CredentialPrompt />}
      {doc && (
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
      )}
    </div>
  );
}
```

Note what this example is allowed to assume: `PdfPage` and the hooks come from the same root entry; the
page component's document prop is non-nullable, so the slots render behind a guard; and the load's status
is a value a consumer can branch on (FR-37) rather than something inferred from three nullable fields.

### 5.2 Shell example

```tsx
import { PdfViewer } from 'pdfjs-react-reader';
import { printFeature } from 'pdfjs-react-reader/features/print';
import { formsFeature } from 'pdfjs-react-reader/features/forms';
import 'pdfjs-react-reader/styles.css';
import 'pdfjs-react-reader/print.css';
import 'pdfjs-react-reader/forms.css';

export function ContractViewer({ url, token }: { url: string; token: string }) {
  return (
    <PdfViewer
      src={url}
      httpHeaders={{ Authorization: `Bearer ${token}` }}
      defaultScale="fit-width"
      features={[printFeature, formsFeature]}
      onError={(error) => reportError(error)}
    />
  );
}
```

The shell is uncontrolled by default and takes its parts as props plus a feature list. A host that needs
markup *between* controls composes the parts (§5.3) rather than configuring a slot system — a slot API
earns its keep only when a host needs structure the prop list cannot express, and until then it is surface
area with nothing behind it.

### 5.3 Composed shell example

```tsx
import {
  ViewerProvider,
  ViewerRoot,
  ViewerToolbar,
  ViewerSidebar,
  ViewerPages,
  ThumbnailList,
  OutlineView,
  useViewerController,
} from 'pdfjs-react-reader';
import 'pdfjs-react-reader/styles.css';

export function TwoColumnViewer({ url }: { url: string }) {
  const controller = useViewerController({ src: url });

  return (
    <ViewerProvider controller={controller}>
      <ViewerRoot style={{ display: 'grid', gridTemplateColumns: '280px 1fr' }}>
        <ViewerSidebar>
          <OutlineView />
          <ThumbnailList />
        </ViewerSidebar>
        <div>
          <ViewerToolbar />
          <ViewerPages />
        </div>
      </ViewerRoot>
    </ViewerProvider>
  );
}
```

### 5.4 Feature tiers

```tsx
// Display only. Annotation authoring, including ink, is not part of the core bundle.
import { PdfViewer } from 'pdfjs-react-reader';
import 'pdfjs-react-reader/styles.css';

<PdfViewer src={url} />

// Each feature named, so each is separately droppable.
import { PdfViewer } from 'pdfjs-react-reader';
import { printFeature } from 'pdfjs-react-reader/features/print';
import { annotateFeature } from 'pdfjs-react-reader/features/annotate';
import 'pdfjs-react-reader/styles.css';
import 'pdfjs-react-reader/print.css';
import 'pdfjs-react-reader/annotate.css';

<PdfViewer src={url} features={[printFeature, annotateFeature]} />
```

A "everything" barrel is the root entry itself: it re-exports the shell, its parts, the feature contract
and every hook, and a bundler still shakes it down to what a file names. A separate `/full` entry would be
an ordinary re-export module with nothing to add.

### 5.5 API maturity, stability & versioning

Semantic versioning begins with the first public `1.0.0` release, with every public name in exactly one of
four states. `0.1.2` was the final pre-1.0 stabilization release and is already published; no further
0.x public release is planned under this PRD. The `0.2.0`–`0.12.0` labels are internal milestones and are not published
versions, so their APIs are development surfaces until the `1.0.0` export map is locked.

| Tag | Meaning | Change policy |
| :--- | :--- | :--- |
| **Stable** | Documented, and relied on by the shell itself. | A breaking change requires a major version. |
| **Experimental** | Shipped and typed, shape still being learned from use. | May change before `1.0.0`; after `1.0.0`, may change only in a minor version with a changelog line. |
| **Internal** | Not reachable from a published entry point. | May change at any time, no note. |
| **Deprecated** | Superseded, still working. | Removed only in a major version, after one minor of warning in the changelog. |

Tags are published per name and enforced by a build check (FR-50). Two boundaries this policy protects: the
find-controller interface is stable *as a shape*, which is what makes an alternative search strategy
possible without a fork; and where a public prop is typed with an engine class, an upstream change to that
class is a breaking change to our surface — which is why §6's engine policy pins a major and requires a
regression pass before the range moves.

---

## 5.6 Requirement Definition of Done

An FR is not considered complete merely because code exists. For release acceptance, each FR must have:

1. **Implementation evidence** — the source implementation is present and reachable from the intended public
   entry point.
2. **Automated verification** — focused unit/integration tests cover the observable contract and important
   failure paths.
3. **Acceptance evidence** — browser, engine, accessibility, benchmark or packaging evidence is present
   wherever the FR depends on it.
4. **Public documentation** — consumer-visible behaviour, configuration and limitations are documented.
5. **Regression coverage** — the test fails when the requirement is removed, weakened or accidentally
   bypassed.
6. **Packaging evidence** — where the FR concerns exports, dependencies, SSR, types, CSS or tree-shaking,
   the packed npm artifact is tested, not only the repository source.

A requirement without the evidence needed to verify it remains open even if a manual demonstration appears
to work.

---

## 6. Non-Functional Requirements (NFR)

### 6.1 Canonical Runtime Resource Budgets

All runtime resource ceilings are defined here once. FRs and other sections reference these values rather
than restating independent copies. This prevents budget drift.

| Resource | Default | Runtime rule |
| :--- | ---: | :--- |
| Desktop canvas device pixels | 33,554,432 | Upper package target; effective ceiling is the minimum of this, host limit and detected platform-safe limit |
| Mobile canvas device pixels | 5,242,880 | Used for mobile-class contexts; desktop-looking iPad/Safari contexts still use detected platform-safe limits |
| Maximum canvas side | 32,767 px | Never allocate a canvas exceeding this side length |
| Minimum render scale | 0.25 | Renderer may reduce scale down to this value before refusing an otherwise requested render |
| Print memory | 268,435,456 bytes | Print plan refuses a selection that cannot fit within this budget |

The package MUST perform runtime capability detection rather than infer canvas safety from user-agent labels.
In particular, an iPad or iOS Safari instance presented with a desktop-class user agent must not receive the
full desktop allocation merely because it identifies as desktop.

### 6.2 Performance, Security, Compatibility & Other NFRs

* **Performance & Memory Footprint.** Off-screen canvases are unmounted and their pixel buffers released —
  returned to the browser, not merely painted transparent — so a long scroll through a large document does
  not accumulate surfaces until a mobile tab dies. Hard ceilings on canvas area and side lower render scale
  for an oversized embedded image rather than allocating without limit.
* **Behaviour Under Load — the requirement that does not bend.** Size is negotiable; what the package does
  to the reader's machine is not. Each figure is stated against a named profile (§6 Benchmark Profiles) and
  a named device class.
  * **Scrolling must not drop frames.** At reader speed and at a fast fling, no frame exceeds 16.7 ms. The
    mounted canvas count stays bounded regardless of document length.
  * **A cold page must appear promptly.** Reaching and painting a page that has never been rendered takes
    under 100 ms anywhere in a 1,000-page document. Any baseline is reported only with machine model, OS,
    browser version, pdfjs-dist version, fixture hash and measurement date; the previous informal 38–55 ms
    baseline is retained as historical context but is not release evidence until those fields are recorded.
  * **A repeated interaction must not repeat its whole cost.** A zoom step re-lays out existing overlay
    layers instead of rebuilding them. *Baseline: 39.8 ms per page per step reduced to 1.0 ms.*
  * **An expensive question is asked when it is needed, not when a feature is mounted.** A pass that must
    read the file — finding signature fields, building an index — runs once per document, is not repeated
    by a second interaction, and reports progress while it runs. *Baseline: 150–200 ms on a thousand-page
    form-bearing document, 0 ms on one that declares no form.*
  * **Writes are batched, because a document is megabytes.** Rearranging pages is a permutation of integers
    plus one writer pass at apply; undo costs nothing until a file is actually written.
  * **A ceiling beats a crash.** An over-large canvas lowers render scale and still paints when the minimum
    viable render fits; only a page that cannot fit even at the minimum supported scale is refused. A print
    job that would exceed the 256 MiB default budget is refused with a shorter range suggested.
  * **A target is not a measurement.** Where a figure above is a measurement from one machine, it is marked
    as a baseline. The *requirement* is the bar; the baseline is evidence the bar is reachable, and it is
    never promoted into the requirement. A maximum observed on one device does not become a promise that a
    slower reader's machine will break. Where a metric is sampled repeatedly, benchmark reports record at
    least p50 and p95, and p99 where the sample count is sufficient; the environment, fixture revision and
    engine version are recorded with the result.
* **Benchmark Profiles.** One universal number is not a target, because these four document shapes fail in
  different ways. Each names the fixture that stands in for it (FR-49), so a measurement is comparable to
  the last one rather than to an adjective.

  | Profile | Shape | Target |
  | :--- | :--- | :--- |
  | **A — text-heavy** | 1,000 pages, nested page tree, varying page boxes, realistic mixed text blocks, headers/footers and at least three font families | Cold page under 100 ms; no frame over 16.7 ms; bounded canvas count |
  | **B — image-heavy / scanned** | High-DPI scanned book: one large image per page, little or no text | 60 FPS scrolling; strict release of off-screen buffers; the area and side caps hold without a blank page |
  | **C — vector-heavy** | Architectural or engineering drawing, very high operator count per page, repeated paths and clipping | Viewer main-thread work attributable to our layer under 200 ms; engine render time reported separately; cold page target is measured but not accepted as a package-only latency promise |
  | **D — low-memory device** | Any of the above on a mobile browser using the committed low-memory harness profile | No exhaustion crash; degraded resolution rather than a dead tab |

  Profile A is not considered certified until its fixture is materially representative of a 1,000-page
  production document and the measurement record includes machine, OS, browser, engine version, fixture hash
  and date. Profile B requires a large scanned fixture; Profile C must separate engine time from main-thread
  blocking; Profile D requires the committed low-memory harness and a real mobile-device validation. These are
  measurements and gaps, not evidence that the targets are already met.

* **Error Handling — announced, not swallowed.** A failure a reader can act on reaches the reader: the
  viewport shows an alert-role status carrying the engine's own message plus a retry that re-requests the
  document; an uncompilable search pattern reports itself as a pattern problem rather than as zero matches;
  a print selection that cannot fit the memory budget names the count that would; an auth failure says it is
  an auth failure rather than a network error; and anything the shell has not taken over reaches an error
  callback. One failure is deliberately silent: a cancelled render, because cancellation is the mechanism
  and not a defect, and a fast scroller would otherwise hear an error per frame.
* **Budget Classification.** Every budget is classified before implementation so a quality gate cannot
  accidentally become a feature restriction:

  | Budget | Purpose | May restrict runtime functionality? |
  | :--- | :--- | :--- |
  | Bundle-size budget | Control package/consumer weight and detect regressions | **No** |
  | Runtime memory budget | Prevent browser/tab exhaustion | **Yes, intentionally** |
  | Performance budget | Detect regressions against named fixtures and environments | **No, normally** |
  | Canvas pixel/side budget | Prevent unsafe canvas allocation | **Yes, intentionally** |
  | Print memory budget | Prevent unsafe print-job allocation | **Yes, intentionally** |

  A runtime safety budget may refuse or degrade an operation only where the PRD explicitly says it does so.
  A bundle or performance budget MUST NOT cause a required feature to be disabled, silently degraded or
  omitted at runtime.
* **Bundle Budgets.** Excluding the engine, size is governed by a **ratchet**, not a functional ceiling:
  every consumer path is measured gzipped and the build fails when one grows more than the committed
  allowance above its baseline. Per-feature size is measured incrementally as **core + feature − core**, so
  shared core code is not charged repeatedly to every feature. Accepting a growth is a reviewed change to
  the budget in the same diff as the code that caused it. The feature budget is therefore a CI contract, not
  a reason to remove functionality. For scale: the engine itself is external to these package-layer budgets.
* **Tree-Shakability.** Pure ES modules, one entry per tier, one stylesheet per tier, and the opt-in feature
  model of FR-21. The guarantee is that feature-specific JavaScript modules are absent from a consumer bundle
  when the feature is not imported. This is verified against more than one bundler. The PRD does not promise
  literal zero bytes for an unimported feature where shared runtime infrastructure is legitimately retained
  by another imported module.
* **CSS Budget Boundary.** Feature CSS is explicitly imported through its published stylesheet entry. CSS
  is not assumed to be tree-shaken merely because JavaScript is. A consumer that imports a feature's CSS has
  explicitly opted into that stylesheet weight; a consumer that does not import it must not receive that
  feature's CSS through the core stylesheet.
* **Engine Compatibility Policy.** The engine is a peer dependency, so its version is the host's choice —
  which makes our supported range a contract. npm accepting a version is not equivalent to us supporting it;
  only versions covered by the documented compatibility evidence are supported.
  * **One supported major at a time,** with a published floor. The floor is set by security advisories and
    by API shape, and the reason for it is recorded, so a host can judge whether to force an older engine.
  * **Worker and API versions must match exactly.** The engine refuses a mismatch; we do not paper over it.
    Support assets (cMaps, standard fonts, wasm) resolve from a root pinned to the engine version, so they
    cannot come from a different release than the worker.
  * **An upstream major bump requires a regression pass before the range moves,** automated as an engine
    matrix in CI (FR-48) and including a consumer job that installs the packed tarball into a throwaway
    app — because every in-repo check resolves the package from source, so a packaging defect can only
    surface against the installed artifact.
  * **Tolerating an older shape is not supporting it.** Where a normaliser accepts an old engine's data
    shape, that is documented as tolerance with a named boundary, never as support.
* **Security & Extension Boundaries.**
  * **Embedded JavaScript is permanently disabled,** with no option to enable it. A document declaring
    script actions is reported so a host can tell the reader; the actions never run.
  * **XFA is rendered, never scripted,** and saving one is refused with a reason (FR-33).
  * **The source is classified before it is fetched** (FR-01, FR-34). Same-origin absolute/relative URLs are
    allowed by default. Cross-origin URLs, including signed URLs, are allowed only when the host explicitly
    opts into the origin through `allowedSources` or supplies a host-controlled fetch/source adapter. A signed
    URL is not rejected merely because it is cross-origin. Redirect validation is performed only when the
    package controls the fetch; when PDF.js performs the network request directly, the package MUST NOT claim
    it can inspect each redirect, and hosts requiring redirect enforcement must use the host-controlled source
    path. Byte inputs are always accepted because they cannot initiate a network fetch.
  * **Memory exhaustion is bounded rather than trusted:** the default canvas limits are 33,554,432 desktop
    pixels, 5,242,880 mobile pixels and a 32,767-pixel side; the print plan computes its job against a
    268,435,456-byte budget and refuses one that does not fit.
  * **Search input follows the mode-specific safety contract:** literal search is escaped before matching;
    regex input is raw by design, limited to 256 UTF-16 code units, compiled before extraction, and evaluated
    in a cancellable worker with a 100 ms per-page budget. An uncompilable or timed-out pattern is reported
    rather than treated as zero matches, and it cannot block the viewer's main thread.
  * **Annotation and link DOM is not an injection vector:** URLs are resolved through a link service that
    hands external navigation to the host rather than performing it, and no document-supplied string is
    written as HTML.
  * **Object-URL and blob lifecycles are owned by whoever creates them,** and revoked rather than left for
    the lifetime of the page.
  * **Content Security Policy is respected:** a Trusted Types policy is supported for hosts whose CSP
    requires one, and nothing in the package needs `unsafe-eval`.
  * **Credentials are handled as credentials.** Headers and cookies forwarded for a load are not logged,
    not echoed into error messages, and not persisted (FR-34).
  * **The extension boundary is the feature contract,** which is ours and not the engine's, so an upstream
    refactor of engine internals cannot break a host's feature. Where a public prop must be typed with an
    engine class, that is a documented, deliberate exception with a version policy behind it (§5.5).
* **Search Architecture.** Query → plan → index → matches. The plan precedes extraction, so an uncompilable
  expression is reported before any page is read. Indexing is incremental and viewport-prioritised
  (FR-39), reports progress, yields on a bounded interval, and may be replaced wholesale by a host-supplied
  index (FR-40). Multi-word queries use phrase semantics rather than AND-per-page semantics, and per-page counts are exposed. An index belongs to
  one document and is discarded with it; a page edit invalidates only what changed.
* **Accessibility.** WCAG 2.2 AA for the shell and every primitive (FR-45), structure-tree backed on
  tagged documents (FR-43), correct under forced colours and high contrast (FR-44), keyboard-complete with
  no trap, and announcing page changes. Accessibility is a cross-cutting requirement, not a feature tier:
  it is not opt-in, not separately bundled, and not deferred to a later release.
* **React & Runtime Compatibility.**
  * **React 18 and 19,** with the matching `react-dom` major, and a CI matrix across both supported majors.
    Core functionality may use React 18 APIs where required; no React 19-only API may be required.
  * **StrictMode-safe.** React 18/19 development StrictMode effect replay is treated as a lifecycle condition;
    effects, subscriptions and cleanup must remain idempotent across both supported majors.
  * **Concurrent-rendering safe.** No render-phase side effects; asynchronous work is committed from effects and
    cancelled by scope. The implementation does not require a separate React-18 versus React-19 architecture.
  * **SSR-safe import** (FR-46): no entry point throws when imported in a server environment. Rendering is
    client-only, and the client boundary is documented as the supported pattern.
  * **ESM and CJS** (FR-41), with types for each; CJS runtime support is limited to the Node versions
    certified for ESM interop with the `pdfjs-dist` peer.
* **TypeScript Contract.** Every documented public entry ships complete declarations. Public APIs MUST
  not expose accidental `any`, private implementation types or unstable inferred PDF.js internals. Type
  tests run against React 18 and 19 and against the packed tarball.
* **Packaging & Consumer Contract.** CI runs `npm pack` and installs the resulting artifact into throwaway
  consumer applications covering root, headless, edit, feature, CSS and locale imports, ESM/CJS resolution,
  SSR import and TypeScript declarations. Repository-source imports alone are not release evidence.
* **License & Dependency Governance.**
  * **MIT,** with the engine (Apache-2.0) and the writer (MIT) as peers. Apache-2.0's notice requirement is
    preserved through the engine's own distribution.
  * **No hidden runtime dependencies.** The package does not require undeclared runtime dependencies.
    Required peer dependencies are explicit, and optional peer dependencies are loaded only by the entries
    that require them. The phrase 'zero runtime dependencies' MUST NOT be used to imply that peer dependencies
    do not exist.
  * **Automated scanning of transitive dependencies,** with a documented triage path — including for
    findings that originate inside a peer's own bundle and cannot be fixed by changing our range.
  * **Adopting a new engine release follows the compatibility policy above,** not an automated merge, and
    the changelog records the version each measurement was taken on.

---

## 7. Delivery Roadmap & Milestones

Forward work is versioned internally in [`ROADMAP.md`](./ROADMAP.md), which assigns each requirement to a
development milestone and records what each milestone actually measured. These labels do not imply that a
package was published. The publication shape is:

| Published version | Meaning | Allowed content |
| :--- | :--- | :--- |
| `0.1.2` | Already released final pre-1.0 stabilization release | Historical release; no further 0.x publication under this plan |
| `1.0.0` | First complete public release | All accepted FR-01–FR-58 work, certified evidence, locked exports and the final compatibility contract |

The internal milestone shape is:

| Milestone | Content | Gate to the next one |
| :--- | :--- | :--- |
| **Core** | FR-01 – FR-15: loading, rendering, virtualization, zoom, layout, rotation, navigation, search | A 1,000-page document scrolls at profile A's bar |
| **Trust** | FR-16 – FR-20, FR-24, FR-25: forms, annotations, print, download, layers, attachments, plus the security ceilings | Every ceiling has a test that fails when it is removed |
| **Tiers** | FR-21 – FR-23, FR-41: the feature contract, per-tier stylesheets, the size gate, dual output | Feature-specific JavaScript is absent from a consumer bundle under two bundlers, and the packed artifact resolves correctly |
| **Compose** | FR-26 – FR-28, FR-39, FR-40: replaceable find, search depth, the composed shell, index injection | A host layout is buildable without forking the shell |
| **Author** | FR-29 – FR-33, FR-42: annotation authoring, page authoring, flatten, visual signing, XFA, merge | A written mark survives a save and a reopen |
| **Access** | FR-43 – FR-45: structure tree, forced colours, WCAG conformance | An automated audit passes and a screen reader pass is recorded |
| **Reach** | FR-34 – FR-38, FR-46, FR-47: network contract, retries, cancellation, state models, source utilities, SSR, gestures | A document behind bearer auth loads; a server import does not throw |
| **Prove** | FR-48 – FR-58: browser and engine matrices, fixture suite, maturity tags, edge cases, public contracts, resource budgets and release evidence | Every claim in §8 is backed by a job that fails when it regresses; the fixture suite is available before any earlier milestone gate that depends on it |
| **1.0.0 publication gate** | The lot | All FRs green or explicitly withdrawn in writing, all §8 evidence certified, and strict semver from then on |

**Implementation delta tracked by Reach:** the current implementation uses a 250 ms initial retry delay
and a 5 s maximum delay; FR-35's locked target is 1 s initial delay and 30 s maximum. The implementation
task must update the defaults and their tests before the FR-35 gate can pass.

The ordering is deliberate: **Prove is the final certification milestone, not the first point at which verification work begins**. Benchmark fixtures, browser-floor harnesses and contract tests required by earlier milestone gates MUST be built before those gates are evaluated. Prove consolidates and certifies the full evidence set for the single consolidated `1.0.0` release. Nothing in §8 may claim a
platform is tested until a job tests it. Internal milestone completion does not authorize an npm publish.

---

## 8. Compatibility & Verification Matrix

The supported set, and what has to prove each row. A row may not be marked tested until the job named in
its evidence column runs and fails when the property regresses (FR-48).

| Environment | Supported | Minimum | Evidence required |
| :--- | :--- | :--- | :--- |
| Chrome / Chromium | Yes | 125 | PDF.js 6.0 minimum; floor job must use a browser binary/container capable of running Chrome 125 |
| Edge | Yes | 125-equivalent Chromium engine | Edge-specific job per release; exact version floor is derived from the Chromium engine requirement and must be executed with an available binary |
| Firefox | Target — not certified | 124 provisional package floor | Certified only after a pinned Firefox 124 runner passes the full supported suite against the supported React and pdfjs-dist matrices; until then this row is explicitly unverified |
| Safari (macOS) | Yes | 18 | PDF.js 6.0 minimum; WebKit job must exercise Safari 18 or an equivalent pinned runner |
| iOS Safari | Yes | 18 | PDF.js 6.0 minimum; simulator/emulation plus a real-device pass per release |
| Android Chrome | Yes | 125 | Chromium engine floor plus a real-device pass per release |
| React / `react-dom` | Yes | `>=18.0.0 <20.0.0` | Matrix at React 18 and 19 minimum/latest patches with matching DOM majors |
| `pdfjs-dist` | Yes | `6.2.108` | Floor and latest supported 6.x engine jobs, plus the consumer-tarball job; 7.x is unsupported |
| Node (ESM and build toolchain) | Yes | 22 | Matches PDF.js 6.0 minimum Node version; build, test, SSR-import and consumer jobs |
| Node (CommonJS runtime) | Yes | 22 | Packaging job requiring every JavaScript entry and type declaration |
| Server-side import | Yes | — | SSR import test over every JavaScript export |
| Server-side render | **No** | — | Out of scope: rendering requires a DOM and a canvas |


**Browser-floor execution policy.** CI MUST NOT rely on the default hosted browser. Each floor claim is backed by a
pinned browser image, container, Playwright browser build, WebKit runner or equivalent reproducible environment.
When an exact historical binary cannot be run on the hosted runner, the row remains **unverified** until a
reproducible runner is committed; a current browser passing the suite does not certify an old-version floor.
The PDF.js 6.0 release notes explicitly raised its minimum browser requirements to Chrome 125 and Safari 18
and its minimum Node.js version to 22.

**Evidence states.** The project uses three distinct labels: **implemented** means source and focused
verification exist; **supported** means the required automated compatibility job has passed; **certified**
means the complete release evidence required by this matrix has run for the release. These labels are never
interchangeable.

**Rules for this table.** A real-device pass is listed separately from emulation because they are not the
same evidence, and a mobile bug that only reproduces on hardware has been the difference between a claim
and a result more than once. Where a row's job does not yet exist, the row is a target and `ROADMAP.md`
carries the ticket — it is never marked tested on the strength of a manual look.


---

## 9. Final 1.0.0 Release Gate

The first complete public release occurs only when the following are all true:

* all accepted FR-01–FR-58 requirements have implementation and verification evidence;
* any withdrawn requirement retains its original FR id and a permanent documented reason;
* React 18 and 19 compatibility evidence is green, with matching `react-dom` majors;
* the supported `pdfjs-dist` 6.x floor and latest supported 6.x compatibility jobs are green;
* bundle budgets, feature isolation and CSS boundaries pass without disabling required functionality;
* canvas and print runtime safety budgets have deterministic tests;
* the public error, cancellation, worker, feature, dependency and TypeScript contracts are tested;
* the packed npm artifact passes consumer, SSR-import, ESM/CJS and declaration checks;
* browser, accessibility, benchmark and edge-case evidence required by §8 is certified;
* the release candidate is built and tested on a clean runner from the packed npm artifact;
* the documented upgrade path from `0.1.2` to `1.0.0` is exercised, including lockfile/dependency migration and public API checks;
* the required real-device mobile pass is complete; and
* `0.2.0` through `0.12.0` remain internal milestone labels only. No intermediate npm publication is implied
  by their completion.

The next public release after `0.1.2` is therefore `1.0.0`, subject to this gate.


---
