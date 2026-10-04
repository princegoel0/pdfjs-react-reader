import { useEffect, useRef } from 'react';
import { usePdfFeatureOptions, usePdfFeaturePublish, usePdfFeatureShell } from '../components/FeatureHost';
import { usePdfFormValues } from '../headless/usePdfFormValues';
import { FORMS_FEATURE_ID } from '../lib/feature-ids';
import type { PdfFeature } from '../lib/features';
import type { AnnotationValueStore, FormValue } from '../lib/form';

export interface FormsFeatureOptions {
  /** Notified with the current values whenever the user edits a form field. */
  onChange?: (values: Record<string, FormValue>) => void;
}

export interface FormFeatureState {
  /** pdf.js annotation storage the widgets write into. */
  storage: AnnotationValueStore | null;
  /** Bumped by a programmatic write, which is how a page re-renders its layer. */
  version: number;
  values: Record<string, FormValue>;
  isDirty: boolean;
  loading: boolean;
  refresh: () => void;
  setValue: (name: string, value: FormValue) => void;
  setFormData: (data: Record<string, FormValue>) => void;
  getFormData: () => Record<string, FormValue>;
  reset: () => void;
}

/**
 * FR-16/17: interactive AcroForm widgets, wired to pdf.js annotation storage.
 *
 * This is the feature the shell cannot do anything about: it publishes the page
 * props below, and the annotation layer the core already renders turns its
 * widgets on. Links keep working without it.
 */
function FormsRunner() {
  const shell = usePdfFeatureShell();
  const options = usePdfFeatureOptions<FormsFeatureOptions>();
  const { storage, version, values, isDirty, loading, refresh, setValue, setFormData, getFormData, reset } =
    usePdfFormValues({ doc: shell.doc, onError: shell.reportError });

  const onChange = useRef(options?.onChange);
  onChange.current = options?.onChange;
  useEffect(() => {
    onChange.current?.(values);
  }, [values]);

  usePdfFeaturePublish<FormFeatureState>({
    storage,
    version,
    values,
    isDirty,
    loading,
    refresh,
    setValue,
    setFormData,
    getFormData,
    reset,
  });
  return null;
}

export const formsFeature: PdfFeature<FormFeatureState> = {
  id: FORMS_FEATURE_ID,
  stylesheets: ['pdfjs-react-reader/forms.css'],
  Runner: FormsRunner,
  pageProps: (state) => ({
    renderForms: true,
    annotationStorage: (state.storage as AnnotationValueStore | null | undefined) ?? null,
    formVersion: (state.version as number | undefined) ?? 0,
    onFormChange: state.refresh as (() => void) | undefined,
  }),
};

/** The same feature, reporting edits as they happen. */
export function createFormsFeature(
  options: FormsFeatureOptions,
): PdfFeature<FormFeatureState> {
  return { ...formsFeature, options };
}
