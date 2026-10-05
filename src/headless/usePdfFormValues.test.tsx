/*
 * FR-17: the published form hook — the surface a host actually calls.
 *
 * `src/lib/form.ts` has been tested since it was written: it classifies widgets, reads values, writes them
 * back, and compares against what arrived. What had never been mounted is the hook on top of it —
 * `usePdfFormValues` is imported by no test in the repository, so `setValue`, `setFormData`, `getFormData`,
 * `reset`, `version` and `isDirty` were each asserted one layer below where a host meets them, and a hook
 * that forgot to bump `version`, or read from a stale store, or cleared the wrong keys, kept the suite
 * green while every consumer's form went stale on screen.
 *
 * "Two-way binding" is the clause that needs both directions said out loud, and they are different
 * mechanisms. Out: the hook writes `{value: …}` under each widget's own id into the annotation storage
 * pdf.js renders from, and bumps `version` because `AnnotationLayer.update` repositions without re-reading
 * stored values. Back: a reader typing into the rendered layer writes the same store directly — the hook
 * never sees that call — and `refresh()` is what folds it back into `values`. Both are asserted here,
 * against a store that mirrors pdf.js's merge behaviour rather than a plain map, because that merge is the
 * one thing a fake tends to get wrong and the one thing the reads depend on.
 */
import { act, renderHook, waitFor } from '@testing-library/react';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { usePdfFormValues } from './usePdfFormValues';
import type { AnnotationValueStore } from '../lib/form';
import { isPdfError } from '../lib/errors';

const WIDGET = 20;

/** The pdf.js store, with the quirk that matters: `getValue` merges onto an object default. */
function createStore() {
  const map = new Map<string, unknown>();
  const store: AnnotationValueStore & { map: Map<string, unknown> } = {
    map,
    getValue: (key, defaultValue) => {
      const stored = map.get(key);
      if (stored === undefined) return defaultValue;
      if (typeof defaultValue !== 'object' || defaultValue === null) {
        throw new TypeError('Cannot convert undefined or null to object');
      }
      return Object.assign(defaultValue, stored);
    },
    getRawValue: (key) => map.get(key),
    setValue: (key, value) => void map.set(key, value),
    remove: (key) => void map.delete(key),
    has: (key) => map.has(key),
    resetModified: vi.fn(),
  };
  return store;
}

/** One of every shape a form arrives in, plus a read-only field nothing may write. */
const ANNOTATIONS = [
  { id: '10R', annotationType: WIDGET, fieldType: 'Tx', fieldName: 'fullName', fieldValue: 'Ada' },
  {
    id: '11R',
    annotationType: WIDGET,
    fieldType: 'Tx',
    fieldName: 'notes',
    fieldValue: '',
    multiLine: true,
  },
  {
    id: '12R',
    annotationType: WIDGET,
    fieldType: 'Btn',
    fieldName: 'subscribe',
    checkBox: true,
    exportValue: 'Yes',
    fieldValue: 'Off',
  },
  {
    id: '16R',
    annotationType: WIDGET,
    fieldType: 'Btn',
    fieldName: 'priority',
    radioButton: true,
    buttonValue: 'Low',
    fieldValue: 'Medium',
  },
  {
    id: '17R',
    annotationType: WIDGET,
    fieldType: 'Btn',
    fieldName: 'priority',
    radioButton: true,
    buttonValue: 'Medium',
    fieldValue: 'Medium',
  },
  {
    id: '18R',
    annotationType: WIDGET,
    fieldType: 'Btn',
    fieldName: 'priority',
    radioButton: true,
    buttonValue: 'High',
    fieldValue: 'Medium',
  },
  {
    id: '19R',
    annotationType: WIDGET,
    fieldType: 'Ch',
    fieldName: 'country',
    combo: true,
    fieldValue: ['DE'],
    options: [
      { exportValue: 'DE', displayValue: 'Germany' },
      { exportValue: 'FR', displayValue: 'France' },
    ],
  },
  {
    id: '20R',
    annotationType: WIDGET,
    fieldType: 'Ch',
    fieldName: 'skills',
    combo: false,
    fieldValue: ['PDF'],
    options: [{ exportValue: 'PDF' }, { exportValue: 'A11Y' }],
  },
  { id: '21R', annotationType: WIDGET, fieldType: 'Tx', fieldName: 'stamp', fieldValue: 'x', readOnly: true },
  // A Link annotation: not a widget, and nothing in the form model may claim it.
  { id: '22R', annotationType: 1, fieldName: 'notAField' },
];

function fakeDoc(annotations = ANNOTATIONS) {
  const store = createStore();
  const doc = {
    numPages: 1,
    annotationStorage: store,
    getPage: async () => ({ getAnnotations: async () => annotations }),
  } as unknown as PDFDocumentProxy;
  return { doc, store };
}

async function mount(annotations = ANNOTATIONS) {
  const { doc, store } = fakeDoc(annotations);
  const onError = vi.fn();
  const hook = renderHook(() => usePdfFormValues({ doc, onError }));
  await waitFor(() => expect(hook.result.current.loading).toBe(false));
  await act(async () => undefined);
  return { ...hook, store, onError };
}

const NAMES = (fields: { name: string }[]) => fields.map((f) => f.name);

afterEach(vi.restoreAllMocks);

describe('what the form hook publishes', () => {
  it('groups the document’s widgets into fields, one entry per name', async () => {
    const { result } = await mount();
    expect(NAMES(result.current.fields)).toEqual([
      'fullName',
      'notes',
      'subscribe',
      'priority',
      'country',
      'skills',
      'stamp',
    ]);
    // Widgets stay per-kid, because each radio option is a separate annotation to render.
    expect(result.current.widgets).toHaveLength(9);
    expect(result.current.storage).toBeTruthy();
    // The arriving values, in the shape each type uses — the read side of the binding.
    expect(result.current.values).toEqual({
      fullName: 'Ada',
      notes: '',
      subscribe: false,
      priority: 'Medium',
      country: 'DE',
      skills: ['PDF'],
      stamp: 'x',
    });
    expect(result.current.isDirty, 'nothing has been touched').toBe(false);
    expect(result.current.version, 'a load is not an edit').toBe(0);
  });

  /*
   * The out direction, asserted where the layer would see it: the widget's own id, the `{value}` envelope
   * pdf.js stores under it, and the version bump that is the only reason a mounted annotation layer
   * re-reads. A hook that wrote the right value and forgot `version` passes a data test and shows the
   * reader a form that did not change.
   */
  it('writes through to the storage the rendered layer reads, and says it changed', async () => {
    const { result, store } = await mount();

    act(() => result.current.setValue('fullName', 'Grace'));
    expect(store.map.get('10R')).toEqual({ value: 'Grace' });
    expect(result.current.version, 'the layer needs a reason to re-read').toBe(1);
    expect(result.current.values.fullName).toBe('Grace');
    expect(result.current.isDirty, 'and the host needs to know work exists').toBe(true);
  });

  it('writes a radio group into every one of its kids, not just the one clicked', async () => {
    const { result, store } = await mount();
    act(() => result.current.setValue('priority', 'High'));

    // Each kid holds a boolean: this is how pdf.js decides which circle is filled, and a writer
    // that set only the chosen one would leave two selected.
    expect(store.map.get('16R')).toEqual({ value: false });
    expect(store.map.get('17R')).toEqual({ value: false });
    expect(store.map.get('18R')).toEqual({ value: true });
    expect(result.current.values.priority).toBe('High');
  });

  it('keeps a checkbox boolean and a list box an array, in both directions', async () => {
    const { result, store } = await mount();
    act(() => {
      result.current.setValue('subscribe', true);
      result.current.setValue('skills', ['PDF', 'A11Y']);
    });
    expect(store.map.get('12R')).toEqual({ value: true });
    expect(store.map.get('20R')).toEqual({ value: ['PDF', 'A11Y'] });
    expect(result.current.values.subscribe).toBe(true);
    expect(result.current.values.skills).toEqual(['PDF', 'A11Y']);
  });

  it('refuses a read-only field rather than writing over it', async () => {
    const { result, store } = await mount();
    act(() => result.current.setValue('stamp', 'changed'));
    expect(store.map.has('21R'), 'the store was never asked').toBe(false);
    expect(result.current.version, 'and nothing changed, so no re-render is claimed').toBe(0);
    expect(result.current.values.stamp).toBe('x');
  });

  /*
   * The back direction, and the one no library test can reach: a reader types into the rendered widget,
   * pdf.js writes the store itself, and the hook's `values` only follow on `refresh()`. Without it a host
   * reading `getFormData()` gets the values as of mount and discards what the reader just wrote.
   */
  it('takes back what the reader typed into the layer', async () => {
    const { result, store } = await mount();
    // What a focused text widget does: the same envelope, under the same id, without the hook knowing.
    store.setValue('11R', { value: 'written by hand' });
    expect(result.current.values.notes, 'no re-read was asked for yet').toBe('');

    act(() => result.current.refresh());
    expect(result.current.values.notes).toBe('written by hand');
    expect(result.current.isDirty).toBe(true);
    expect(result.current.getFormData().notes).toBe('written by hand');
  });

  it('serialises out to a plain object and back in, field for field', async () => {
    const { result, store } = await mount();
    const data = {
      fullName: 'Ada L.',
      subscribe: true,
      priority: 'Low' as const,
      country: 'FR',
      skills: ['A11Y'],
    };

    act(() => result.current.setFormData(data));
    expect(result.current.getFormData()).toMatchObject(data);
    // The plain object is keyed by field name; the store is keyed by widget id. That translation is
    // the hook's job, and the round trip is what proves it happened in both directions.
    expect([...store.map.keys()].sort()).toEqual(['12R', '16R', '17R', '18R', '19R', '10R', '20R'].sort());
    expect(result.current.isDirty).toBe(true);

    act(() => result.current.setFormData(result.current.getFormData()));
    expect(result.current.getFormData()).toEqual({
      ...result.current.getFormData(),
      notes: '',
      stamp: 'x',
    });
  });

  /*
   * Reset means the values the document arrived with — not empty, not zero, and not whatever the store
   * happens to hold. The distinction bites on a form whose fields are pre-filled, which is what this
   * fixture is.
   */
  it('resets to what the document arrived with, and stops calling it dirty', async () => {
    const { result, store } = await mount();
    act(() => result.current.setValue('fullName', 'Grace'));
    expect(result.current.isDirty).toBe(true);

    act(() => result.current.reset());
    expect(result.current.values.fullName).toBe('Ada');
    expect(result.current.values.priority).toBe('Medium');
    expect(result.current.values.skills).toEqual(['PDF']);
    expect(store.map.has('10R'), 'the stored edit is gone, not merely unread').toBe(false);
    expect(store.resetModified, 'and the store is told nothing is modified any more').toHaveBeenCalled();
    expect(result.current.isDirty, 'a discarded form is not a warning worth showing').toBe(false);
    expect(result.current.version, 'the layer still has to be told to re-read').toBe(2);
  });

  it('is dirty by comparison, not by history: changing a value back clears the flag', async () => {
    const { result } = await mount();
    act(() => result.current.setValue('fullName', 'Grace'));
    expect(result.current.isDirty).toBe(true);

    act(() => result.current.setValue('fullName', 'Ada'));
    expect(
      result.current.isDirty,
      'a reader who typed and then untyped has no work to lose',
    ).toBe(false);
    expect(result.current.version, 'but both writes happened, and the layer saw both').toBe(2);
  });

  it('reports a document whose annotations cannot be read, and shows no fields', async () => {
    const doc = {
      numPages: 1,
      annotationStorage: createStore(),
      getPage: async () => ({
        getAnnotations: async () => {
          throw new Error('annotations are not in this file');
        },
      }),
    } as unknown as PDFDocumentProxy;
    const onError = vi.fn();
    const { result } = renderHook(() => usePdfFormValues({ doc, onError }));
    await waitFor(() => expect(onError).toHaveBeenCalled());

    expect(result.current.loading).toBe(false);
    expect(result.current.fields).toEqual([]);
    expect(isPdfError(onError.mock.calls[0]![0])).toBe(true);
  });

  /*
   * The coercions are the point, not the happy path: form data arrives from a host as JSON, where a
   * checkbox is `"true"` and a single selection is a bare string. Storing those raw would leave the layer
   * rendering an unchecked box and a list with one option highlighted by luck, and `readFormValues` would
   * answer with a shape the next `getFormData()` comparison calls dirty forever.
   */
  it('coerces what JSON form data gives: a string for a boolean, a scalar for a list', async () => {
    const { result, store } = await mount();
    act(() => result.current.setFormData({ subscribe: 'true', skills: 'A11Y' }));

    expect(store.map.get('12R'), '“true” is what a form post says a checked box means').toEqual({
      value: true,
    });
    expect(store.map.get('20R'), 'one value in a multi-select is still a list of one').toEqual({
      value: ['A11Y'],
    });

    act(() => result.current.setFormData({ subscribe: false, skills: null }));
    expect(store.map.get('12R')).toEqual({ value: false });
    expect(store.map.get('20R')).toEqual({ value: [] });
    expect(result.current.values.subscribe).toBe(false);
    expect(result.current.values.skills).toEqual([]);
  });

  it('answers for a document that is not there without throwing', async () => {
    const doc = null;
    const { result } = renderHook(() => usePdfFormValues({ doc }));
    await act(async () => undefined);

    expect(result.current.fields).toEqual([]);
    expect(result.current.values).toEqual({});
    expect(result.current.storage).toBeNull();
    expect(result.current.getFormData()).toEqual({});
    expect(() => {
      result.current.setValue('fullName', 'x');
      result.current.setFormData({ fullName: 'x' });
      result.current.reset();
      result.current.refresh();
    }).not.toThrow();
    expect(result.current.version).toBe(0);
  });
});
