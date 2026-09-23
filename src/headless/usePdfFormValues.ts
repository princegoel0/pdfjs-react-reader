import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import {
  clearFormValues,
  collectWidgets,
  formValuesDiffer,
  groupWidgets,
  readFormValues,
  readInitialValues,
  writeFormValues,
  type AnnotationValueStore,
  type FormField,
  type FormValue,
  type FormWidget,
} from '../lib/form';

export interface UsePdfFormValuesOptions {
  doc: PDFDocumentProxy | null;
  onError?: (error: Error) => void;
}

export interface UsePdfFormValuesResult {
  /** Logical fields, one entry per fully-qualified field name. */
  fields: FormField[];
  /** Raw widgets, including one per radio option. */
  widgets: FormWidget[];
  /** Current value per field name. */
  values: Record<string, FormValue>;
  /** True when any field differs from the document's own value. */
  isDirty: boolean;
  /**
   * Bumped by programmatic changes; pages re-render their annotation layer on
   * it (pdf.js's `AnnotationLayer.update` only repositions, it doesn't re-read
   * stored values).
   */
  version: number;
  loading: boolean;
  /** Re-reads the annotation storage; call after the user edits a field. */
  refresh: () => void;
  /** The pdf.js annotation storage backing this document's form. */
  storage: AnnotationValueStore | null;
  setValue: (name: string, value: FormValue) => void;
  getFormData: () => Record<string, FormValue>;
  setFormData: (data: Record<string, FormValue>) => void;
  reset: () => void;
}

function asStore(doc: PDFDocumentProxy | null): AnnotationValueStore | null {
  if (!doc) return null;
  // Touching the getter makes pdf.js create the document's storage lazily.
  return doc.annotationStorage as unknown as AnnotationValueStore;
}

export function usePdfFormValues(options: UsePdfFormValuesOptions): UsePdfFormValuesResult {
  const { doc, onError } = options;
  const [widgets, setWidgets] = useState<FormWidget[]>([]);
  const [values, setValues] = useState<Record<string, FormValue>>({});
  const [version, setVersion] = useState(0);
  const [loading, setLoading] = useState(false);

  const onErrorRef = useRef(onError);
  onErrorRef.current = onError;

  const storage = useMemo(() => asStore(doc), [doc]);
  const fields = useMemo(() => groupWidgets(widgets), [widgets]);

  // Latest-value refs so `refresh` keeps a stable identity.
  const fieldsRef = useRef(fields);
  fieldsRef.current = fields;
  const widgetsRef = useRef(widgets);
  widgetsRef.current = widgets;
  const storageRef = useRef(storage);
  storageRef.current = storage;

  const read = useCallback((): Record<string, FormValue> => {
    const store = storageRef.current;
    if (!store) return {};
    return readFormValues(fieldsRef.current, widgetsRef.current, store);
  }, []);

  useEffect(() => {
    setWidgets([]);
    setValues({});
    setVersion(0);
    if (!doc) return;
    let cancelled = false;
    setLoading(true);
    collectWidgets(doc)
      .then((found) => {
        if (cancelled) return;
        setWidgets(found);
        setLoading(false);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setLoading(false);
        onErrorRef.current?.(err instanceof Error ? err : new Error(String(err)));
      });
    return () => {
      cancelled = true;
    };
  }, [doc]);

  // Derive values whenever the field set or a programmatic write changed.
  useEffect(() => {
    setValues(read());
  }, [read, fields, version, storage]);

  const refresh = useCallback(() => {
    setValues(read());
  }, [read]);

  const setValue = useCallback(
    (name: string, value: FormValue) => {
      const store = storageRef.current;
      if (!store) return;
      writeFormValues(fieldsRef.current, widgetsRef.current, store, { [name]: value });
      setVersion((v) => v + 1);
    },
    [],
  );

  const getFormData = useCallback(() => read(), [read]);

  const setFormData = useCallback((data: Record<string, FormValue>) => {
    const store = storageRef.current;
    if (!store) return;
    writeFormValues(fieldsRef.current, widgetsRef.current, store, data);
    setVersion((v) => v + 1);
  }, []);

  const reset = useCallback(() => {
    const store = storageRef.current;
    if (!store) return;
    clearFormValues(fieldsRef.current, store);
    store.resetModified?.();
    setVersion((v) => v + 1);
  }, []);

  const isDirty = useMemo(
    () => formValuesDiffer(values, readInitialValues(fields, widgets)),
    [values, fields, widgets],
  );

  return {
    fields,
    widgets,
    values,
    isDirty,
    version,
    loading,
    refresh,
    storage,
    setValue,
    getFormData,
    setFormData,
    reset,
  };
}
