import { describe, expect, it } from 'vitest';
import {
  clearFormValues,
  describeWidget,
  formValuesDiffer,
  groupWidgets,
  readFormValues,
  readInitialValues,
  writeFormValues,
  type AnnotationValueStore,
  type FormWidget,
} from './form';

const WIDGET = 20;

function createStore(): AnnotationValueStore & { map: Map<string, unknown> } {
  const map = new Map<string, unknown>();
  return {
    map,
    getValue: (key, defaultValue) => {
      const stored = map.get(key);
      // Mirrors pdf.js: it merges the stored object onto the caller's default,
      // which throws unless the default is an object.
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
  };
}

function widget(data: Record<string, unknown>, pageIndex = 0): FormWidget | null {
  return describeWidget({ annotationType: WIDGET, ...data }, pageIndex);
}

describe('describeWidget', () => {
  it('classifies text fields', () => {
    const result = widget({ id: '10R', fieldType: 'Tx', fieldName: 'fullName', fieldValue: 'Ada' });
    expect(result).toMatchObject({ id: '10R', name: 'fullName', type: 'text', initialValue: 'Ada' });
  });

  it('treats an empty text value as an empty string', () => {
    expect(widget({ id: 'a', fieldType: 'Tx', fieldName: 'n' })?.initialValue).toBe('');
  });

  it('converts an unchecked checkbox to false and a checked one to true', () => {
    const base = { id: '12R', fieldType: 'Btn', fieldName: 'subscribe', checkBox: true, exportValue: 'Yes' };
    expect(widget({ ...base, fieldValue: 'Off' })?.initialValue).toBe(false);
    expect(widget({ ...base, fieldValue: 'Yes' })?.initialValue).toBe(true);
  });

  it('marks the matching radio kid as true', () => {
    const base = { fieldType: 'Btn', fieldName: 'priority', radioButton: true };
    expect(widget({ ...base, id: '16R', buttonValue: 'Low', fieldValue: 'Medium' })?.initialValue).toBe(false);
    expect(widget({ ...base, id: '17R', buttonValue: 'Medium', fieldValue: 'Medium' })?.initialValue).toBe(true);
  });

  it('collapses a combo value to a string but keeps list boxes as arrays', () => {
    const combo = widget({ id: '19R', fieldType: 'Ch', fieldName: 'country', combo: true, fieldValue: ['DE'] });
    expect(combo?.type).toBe('select');
    expect(combo?.initialValue).toBe('DE');

    const list = widget({ id: '20R', fieldType: 'Ch', fieldName: 'skills', combo: false, fieldValue: ['PDF'] });
    expect(list?.type).toBe('listbox');
    expect(list?.initialValue).toEqual(['PDF']);
  });

  it('ignores non-widget annotations', () => {
    expect(describeWidget({ annotationType: 2, id: 'x', fieldName: 'y' }, 0)).toBeNull();
    expect(describeWidget({ annotationType: WIDGET, id: 'x' }, 0)).toBeNull();
  });
});

describe('groupWidgets', () => {
  it('merges radio kids into one field with options', () => {
    const kids = ['Low', 'Medium', 'High'].map((state, i) =>
      widget({
        id: `${16 + i}R`,
        fieldType: 'Btn',
        fieldName: 'priority',
        radioButton: true,
        buttonValue: state,
        fieldValue: 'Medium',
      })!,
    );
    const fields = groupWidgets(kids);
    expect(fields).toHaveLength(1);
    expect(fields[0]).toMatchObject({ name: 'priority', type: 'radio', ids: ['16R', '17R', '18R'] });
    expect(fields[0]!.options.map((o) => o.value)).toEqual(['Low', 'Medium', 'High']);
  });
});

describe('form values round-trip', () => {
  function sample() {
    const widgets = [
      widget({ id: '10R', fieldType: 'Tx', fieldName: 'fullName', fieldValue: 'Ada' }, 0)!,
      widget({ id: '12R', fieldType: 'Btn', fieldName: 'subscribe', checkBox: true, exportValue: 'Yes', fieldValue: 'Off' }, 0)!,
      ...['Low', 'Medium', 'High'].map((state, i) =>
        widget(
          { id: `${16 + i}R`, fieldType: 'Btn', fieldName: 'priority', radioButton: true, buttonValue: state, fieldValue: 'Medium' },
          0,
        )!,
      ),
      widget({ id: '19R', fieldType: 'Ch', fieldName: 'country', combo: true, fieldValue: ['DE'] }, 0)!,
      widget({ id: '20R', fieldType: 'Ch', fieldName: 'skills', combo: false, fieldValue: ['PDF'] }, 0)!,
      widget({ id: '26R', fieldType: 'Btn', fieldName: 'submit', pushButton: true }, 0)!,
    ];
    const fields = groupWidgets(widgets);
    return { widgets, fields, store: createStore() };
  }

  it('reads document values when storage is empty', () => {
    const { widgets, fields, store } = sample();
    expect(readFormValues(fields, widgets, store)).toEqual({
      fullName: 'Ada',
      subscribe: false,
      priority: 'Medium',
      country: 'DE',
      skills: ['PDF'],
      submit: null,
    });
  });

  it('writes every widget type and reads it back', () => {
    const { widgets, fields, store } = sample();
    const applied = writeFormValues(fields, widgets, store, {
      fullName: 'Grace Hopper',
      subscribe: true,
      priority: 'High',
      country: 'FR',
      skills: ['JS', 'Rust'],
    });
    expect(applied.sort()).toEqual(['country', 'fullName', 'priority', 'skills', 'subscribe']);
    // Selecting "High" must clear the other two kids.
    expect(store.map.get('16R')).toEqual({ value: false });
    expect(store.map.get('17R')).toEqual({ value: false });
    expect(store.map.get('18R')).toEqual({ value: true });
    expect(readFormValues(fields, widgets, store)).toMatchObject({
      fullName: 'Grace Hopper',
      subscribe: true,
      priority: 'High',
      country: 'FR',
      skills: ['JS', 'Rust'],
    });
  });

  it('refuses to write read-only fields and push buttons', () => {
    const { fields, store } = sample();
    const readOnlyFields = fields.map((field) => ({ ...field, readOnly: true }));
    expect(writeFormValues(readOnlyFields, [], store, { fullName: 'x', submit: 'y' })).toEqual([]);
    expect(store.map.size).toBe(0);
  });

  it('ignores unknown field names', () => {
    const { fields, store } = sample();
    expect(writeFormValues(fields, [], store, { nope: 'x' })).toEqual([]);
  });

  it('restores document values after clearing storage', () => {
    const { widgets, fields, store } = sample();
    writeFormValues(fields, widgets, store, { fullName: 'Grace', priority: 'Low' });
    expect(formValuesDiffer(readFormValues(fields, widgets, store), readInitialValues(fields, widgets))).toBe(true);
    clearFormValues(fields, store);
    const restored = readFormValues(fields, widgets, store);
    expect(restored.fullName).toBe('Ada');
    expect(restored.priority).toBe('Medium');
    expect(formValuesDiffer(restored, readInitialValues(fields, widgets))).toBe(false);
  });

  it('compares list values without reference equality', () => {
    const initial = { skills: ['PDF'] };
    expect(formValuesDiffer({ skills: ['PDF'] }, initial)).toBe(false);
    expect(formValuesDiffer({ skills: ['PDF', 'JS'] }, initial)).toBe(true);
  });
});
