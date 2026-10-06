import type { PDFDocumentProxy } from 'pdfjs-dist';

/** A form field value as exchanged with the JSON API. */
export type FormValue = string | string[] | boolean | null;

export type FormFieldType =
  | 'text'
  | 'checkbox'
  | 'radio'
  | 'select'
  | 'listbox'
  | 'button'
  | 'signature'
  | 'unknown';

export interface FormFieldOption {
  /** The `/OS` export value stored in the field. */
  value: string;
  /** The human-readable `/OS`-parallel display text. */
  label: string;
}

/** A single widget annotation (radio groups have one widget per option). */
export interface FormWidget {
  /** pdf.js annotation id — the key used in the annotation storage. */
  id: string;
  pageIndex: number;
  name: string;
  type: FormFieldType;
  /** Value carried by the document itself, before any user edit. */
  initialValue: FormValue;
  /** Export value of this widget (checkbox / radio option). */
  exportValue: string | null;
  options: FormFieldOption[];
  readOnly: boolean;
  hidden: boolean;
}

/** A logical field: widgets grouped by fully-qualified field name. */
export interface FormField {
  name: string;
  type: FormFieldType;
  ids: string[];
  options: FormFieldOption[];
  readOnly: boolean;
  /** Page the first widget lives on (0-based). */
  pageIndex: number;
}

/**
 * Structural view of pdf.js's `AnnotationStorage` (not exported from the
 * pdfjs-dist root). Form widgets store `{ value: … }` under the annotation id.
 */
export interface AnnotationValueStore {
  /**
   * pdf.js merges the stored object onto `defaultValue`, so the default must be
   * an object. Prefer {@link AnnotationValueStore.getRawValue} for reads.
   */
  getValue(key: string, defaultValue: unknown): unknown;
  getRawValue(key: string): unknown;
  setValue(key: string, value: unknown): void;
  remove(key: string): void;
  has(key: string): boolean;
  resetModified?(): void;
}

const WIDGET_ANNOTATION_TYPE = 20;

interface RawWidgetData {
  id?: unknown;
  annotationType?: unknown;
  fieldType?: unknown;
  fieldName?: unknown;
  fieldValue?: unknown;
  exportValue?: unknown;
  buttonValue?: unknown;
  buttonValueKind?: unknown;
  checkBox?: unknown;
  radioButton?: unknown;
  pushButton?: unknown;
  combo?: unknown;
  options?: unknown;
  readOnly?: unknown;
  hidden?: unknown;
  multiLine?: unknown;
  maxLength?: unknown;
}

function normalizeOptions(raw: unknown): FormFieldOption[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((entry) => {
    if (entry && typeof entry === 'object') {
      const { exportValue, value, displayValue } = entry as Record<string, unknown>;
      const v = exportValue ?? value;
      return {
        value: typeof v === 'string' ? v : String(v ?? ''),
        label: typeof displayValue === 'string' ? displayValue : String(v ?? ''),
      };
    }
    return { value: String(entry), label: String(entry) };
  });
}

/** Maps a raw pdf.js widget annotation onto our field model, or null. */
export function describeWidget(data: unknown, pageIndex: number): FormWidget | null {
  const raw = data as RawWidgetData;
  if (!raw || raw.annotationType !== WIDGET_ANNOTATION_TYPE) return null;
  if (typeof raw.id !== 'string' || typeof raw.fieldName !== 'string') return null;

  const options = normalizeOptions(raw.options);
  let type: FormFieldType;
  let exportValue: string | null = null;
  let value: FormValue = null;

  switch (raw.fieldType) {
    case 'Tx':
      type = 'text';
      value = typeof raw.fieldValue === 'string' ? raw.fieldValue : '';
      break;
    case 'Sig':
      type = 'signature';
      value = null;
      break;
    case 'Btn': {
      const kind =
        typeof raw.buttonValueKind === 'string'
          ? raw.buttonValueKind
          : raw.radioButton
            ? 'radio'
            : raw.checkBox
              ? 'check'
              : 'pushbutton';
      if (kind === 'radio') {
        type = 'radio';
        exportValue = typeof raw.buttonValue === 'string' ? raw.buttonValue : null;
        value = exportValue !== null && raw.fieldValue === exportValue;
      } else if (kind === 'check') {
        type = 'checkbox';
        exportValue = typeof raw.exportValue === 'string' ? raw.exportValue : 'On';
        value =
          typeof raw.fieldValue === 'string'
            ? raw.fieldValue !== 'Off' && raw.fieldValue === exportValue
            : raw.fieldValue != null && raw.fieldValue !== 'Off';
      } else {
        type = 'button';
        value = null;
      }
      break;
    }
    case 'Ch': {
      type = raw.combo === false ? 'listbox' : 'select';
      // pdf.js always reports the document's choice value as an array, but
      // writes back a bare string for single-select combos. Normalize to
      // string for a combo and string[] for a list box.
      const selected = Array.isArray(raw.fieldValue)
        ? raw.fieldValue.map(String)
        : typeof raw.fieldValue === 'string'
          ? [raw.fieldValue]
          : [];
      value = type === 'listbox' ? selected : (selected[0] ?? '');
      break;
    }
    default:
      type = 'unknown';
      value = null;
  }

  return {
    id: raw.id,
    pageIndex,
    name: raw.fieldName,
    type,
    initialValue: value,
    exportValue,
    options,
    readOnly: raw.readOnly === true,
    hidden: raw.hidden === true,
  };
}

/** Groups widgets into logical fields, preserving document order. */
export function groupWidgets(widgets: ReadonlyArray<FormWidget>): FormField[] {
  const fields: FormField[] = [];
  const byName = new Map<string, FormField>();
  for (const widget of widgets) {
    if (!widget.name) continue;
    let field = byName.get(widget.name);
    if (!field) {
      field = {
        name: widget.name,
        type: widget.type,
        ids: [],
        options: [],
        readOnly: widget.readOnly,
        pageIndex: widget.pageIndex,
      };
      byName.set(widget.name, field);
      fields.push(field);
    }
    field.ids.push(widget.id);
    field.readOnly = field.readOnly && widget.readOnly;
    if (widget.type === 'radio' && widget.exportValue !== null) {
      const exists = field.options.some((option) => option.value === widget.exportValue);
      if (!exists) field.options.push({ value: widget.exportValue, label: widget.exportValue });
    } else if (widget.options.length > 0 && field.options.length === 0) {
      field.options = widget.options;
    }
  }
  return fields;
}

function storedValue(store: AnnotationValueStore, id: string): FormValue | undefined {
  if (!store.has(id)) return undefined;
  const entry = store.getRawValue(id) as { value?: FormValue } | undefined;
  return entry?.value ?? null;
}

/**
 * Current value per field name: the user's edit when present in storage,
 * otherwise the document's own value.
 */
export function readFormValues(
  fields: ReadonlyArray<FormField>,
  widgets: ReadonlyArray<FormWidget>,
  store: AnnotationValueStore,
): Record<string, FormValue> {
  const byId = new Map(widgets.map((widget) => [widget.id, widget]));
  const out: Record<string, FormValue> = {};
  for (const field of fields) {
    if (field.type === 'radio') {
      let selected: FormValue = null;
      for (const id of field.ids) {
        const widget = byId.get(id);
        if (!widget) continue;
        const stored = storedValue(store, id);
        const on = stored === undefined ? widget.initialValue === true : stored === true;
        if (on) selected = widget.exportValue;
      }
      out[field.name] = selected;
      continue;
    }
    const id = field.ids[0];
    if (id === undefined) continue;
    const widget = byId.get(id);
    const stored = storedValue(store, id);
    if (stored !== undefined) {
      out[field.name] = field.type === 'checkbox' ? stored === true : stored;
    } else {
      out[field.name] = widget ? widget.initialValue : null;
    }
  }
  return out;
}

/**
 * Writes JSON form data into the annotation storage so the rendered widgets
 * pick it up on the next layer render. Returns the names that were applied.
 */
export function writeFormValues(
  fields: ReadonlyArray<FormField>,
  widgets: ReadonlyArray<FormWidget>,
  store: AnnotationValueStore,
  data: Record<string, FormValue>,
): string[] {
  const byName = new Map(fields.map((field) => [field.name, field]));
  const byId = new Map(widgets.map((widget) => [widget.id, widget]));
  const applied: string[] = [];
  for (const [name, value] of Object.entries(data)) {
    const field = byName.get(name);
    if (!field || field.readOnly || field.type === 'button') continue;
    if (field.type === 'radio') {
      for (const id of field.ids) {
        const widget = byId.get(id);
        if (!widget) continue;
        store.setValue(id, { value: widget.exportValue === value });
      }
      applied.push(name);
      continue;
    }
    const id = field.ids[0];
    if (id === undefined) continue;
    if (field.type === 'checkbox') {
      store.setValue(id, { value: value === true || value === 'true' });
    } else if (field.type === 'listbox') {
      store.setValue(id, { value: Array.isArray(value) ? value : value == null ? [] : [String(value)] });
    } else {
      store.setValue(id, { value: value == null ? '' : Array.isArray(value) ? value.join(', ') : String(value) });
    }
    applied.push(name);
  }
  return applied;
}

/** Drops every stored value so fields fall back to the document's own values. */
export function clearFormValues(
  fields: ReadonlyArray<FormField>,
  store: AnnotationValueStore,
): void {
  for (const field of fields) {
    for (const id of field.ids) {
      if (store.has(id)) store.remove(id);
    }
  }
}

const EMPTY_STORE: AnnotationValueStore = {
  getValue: (_key, defaultValue) => defaultValue,
  getRawValue: () => undefined,
  setValue: () => {},
  remove: () => {},
  has: () => false,
};

/** The values baked into the document, ignoring any user edits. */
export function readInitialValues(
  fields: ReadonlyArray<FormField>,
  widgets: ReadonlyArray<FormWidget>,
): Record<string, FormValue> {
  return readFormValues(fields, widgets, EMPTY_STORE);
}

/** True when any field differs from its document value. */
export function formValuesDiffer(
  values: Record<string, FormValue>,
  initial: Record<string, FormValue>,
): boolean {
  for (const key of Object.keys(initial)) {
    const a = values[key];
    const b = initial[key];
    if (Array.isArray(a) || Array.isArray(b)) {
      if (String(a ?? []) !== String(b ?? [])) return true;
    } else if (a !== b) {
      return true;
    }
  }
  return false;
}

// ---- document-level widget collection with a per-document cache ----

const widgetCache = new WeakMap<PDFDocumentProxy, FormWidget[]>();

/** Reads every form widget in the document (cached per document). */
export async function collectWidgets(doc: PDFDocumentProxy): Promise<FormWidget[]> {
  const cached = widgetCache.get(doc);
  if (cached) return cached;
  const widgets: FormWidget[] = [];
  for (let page = 1; page <= doc.numPages; page++) {
    const proxy = await doc.getPage(page);
    const annotations = await proxy.getAnnotations({ intent: 'display' });
    for (const annotation of annotations) {
      const widget = describeWidget(annotation, page - 1);
      if (widget) widgets.push(widget);
    }
  }
  widgetCache.set(doc, widgets);
  return widgets;
}

/**
 * A `/Sig` widget that renders no box of its own, in fractions of the page.
 *
 * Fractions rather than pixels because they survive a zoom step: the engine positions its own annotation
 * elements the same way (`left: 11.7647%`), and the layer re-renders only when the page or its rotation
 * changes, not when the reader zooms.
 */
export interface SignatureBox {
  /** pdf.js's annotation id, so two widgets of one field are two boxes. */
  id: string;
  /** The field's fully-qualified name, empty when the document does not carry one. */
  name: string;
  left: number;
  top: number;
  width: number;
  height: number;
}

/** What `getAnnotations` says about a widget, of which only these five members are read. */
export interface WidgetAnnotationLike {
  id?: string;
  subtype?: string;
  fieldType?: string;
  /** True when the engine gives this widget its own canvas — and so paints it without us. */
  hasOwnCanvas?: boolean;
  rect?: number[];
  fieldName?: string;
}

/** The part of a `PageViewport` a box needs: its size, and the corner transform that folds rotation in. */
export interface BoxViewport {
  width: number;
  height: number;
  /** The engine types this as an open-ended array, so the caller checks what it gets back. */
  convertToViewportPoint(x: number, y: number): number[];
}

/**
 * The signature widgets nothing will give an element, as boxes over their own rects.
 *
 * Measured on `signature-sample.pdf`: of its six `/Sig` widgets the one the engine marks `hasOwnCanvas` gets an
 * element (`class="norotate"`, at the rect the engine computed) and the other five get none. Sampling the painted
 * canvas inside those five rects, four read 0 % ink and the fifth reads 4.03 % — the appearance the file already
 * carries for a signed field. The box goes over that one too: the flags do not predict what the canvas paints
 * (`sigKid` declares an appearance and reads 0 %), and the clause asks that the widget render as its box rather
 * than that this package guess which fields a reader can already see.
 *
 * `hasOwnCanvas === true` is the only exclusion, because that is the case the engine already renders; a widget
 * whose `/N` is an empty form (this package writes one for every appearance-less widget, so `flatten()` survives)
 * still gets its box. Both corners go through the viewport because a rotated page's rect is in unrotated space.
 */
export function signatureBoxes(
  annotations: Iterable<WidgetAnnotationLike>,
  viewport: BoxViewport,
): SignatureBox[] {
  const boxes: SignatureBox[] = [];
  if (!(viewport.width > 0) || !(viewport.height > 0)) return boxes;
  for (const a of annotations) {
    if (a.subtype !== 'Widget' || a.fieldType !== 'Sig') continue;
    if (a.hasOwnCanvas === true) continue;
    const rect = a.rect;
    const [x0, y0, x1, y1] = rect ?? [];
    if (typeof x0 !== 'number' || typeof y0 !== 'number' || typeof x1 !== 'number' || typeof y1 !== 'number') {
      continue;
    }
    const [ax, ay] = viewport.convertToViewportPoint(x0, y0);
    const [bx, by] = viewport.convertToViewportPoint(x1, y1);
    // A viewport that answers with anything short of four numbers is not describing a page, and a box from it
    // would be arithmetic on undefined rather than a place on the paper.
    if (
      typeof ax !== 'number' ||
      typeof ay !== 'number' ||
      typeof bx !== 'number' ||
      typeof by !== 'number'
    ) {
      continue;
    }
    const left = Math.min(ax, bx);
    const right = Math.max(ax, bx);
    const top = Math.min(ay, by);
    const bottom = Math.max(ay, by);
    if (!(right > left) || !(bottom > top)) continue;
    boxes.push({
      id: a.id ?? `${x0},${y0},${x1},${y1}`,
      name: a.fieldName ?? '',
      left: left / viewport.width,
      top: top / viewport.height,
      width: (right - left) / viewport.width,
      height: (bottom - top) / viewport.height,
    });
  }
  return boxes;
}
