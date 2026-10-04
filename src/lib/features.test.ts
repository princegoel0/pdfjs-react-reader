import { describe, expect, it, vi } from 'vitest';
import {
  findFeatureKey,
  mergeFeaturePageProps,
  NO_FEATURES,
  replacedControlIds,
  samePublication,
  type AnyPdfFeature,
  type FeaturePublication,
  type PdfFeature,
  type PdfViewerShell,
} from './features';

const shell = {} as PdfViewerShell;

const eventFor = (key: string, ctrl = false) => ({
  key,
  ctrlKey: ctrl,
  metaKey: false,
  altKey: false,
  preventDefault: vi.fn(),
});

describe('samePublication', () => {
  it('accepts an identical reference and a rebuilt equal one', () => {
    const value = { a: 1, b: 'two' };
    expect(samePublication(value, value)).toBe(true);
    expect(samePublication(value, { a: 1, b: 'two' })).toBe(true);
    expect(samePublication({ a: 1 }, { a: 1, b: undefined })).toBe(false);
  });

  it('rejects a changed value, a missing key, and a changed key count', () => {
    expect(samePublication({ a: 1 }, { a: 2 })).toBe(false);
    expect(samePublication({ a: 1, b: 2 }, { a: 1 })).toBe(false);
    expect(samePublication(undefined, { a: 1 })).toBe(false);
  });

  it('is shallow, which is the documented limit a Runner must respect', () => {
    // A rebuilt nested object compares unequal, so a feature that published one
    // every render would re-render the shell forever. Recorded here because the
    // behaviour is load-bearing and easy to break by accident.
    expect(samePublication({ nested: { a: 1 } }, { nested: { a: 1 } })).toBe(false);
    const nested = { a: 1 };
    expect(samePublication({ nested }, { nested })).toBe(true);
  });

  it('treats a different key order as the same publication', () => {
    expect(samePublication({ a: 1, b: 2 }, { b: 2, a: 1 })).toBe(true);
  });
});

describe('mergeFeaturePageProps', () => {
  const pageFeature = (
    id: string,
    props: Partial<{ renderForms: boolean; formVersion: number }>,
  ): PdfFeature => ({ id, pageProps: () => props });

  it('merges in list order, later feature winning a clash', () => {
    const features = [pageFeature('one', { renderForms: true, formVersion: 1 }), pageFeature('two', { formVersion: 2 })];
    expect(mergeFeaturePageProps(features, () => ({}))).toEqual({
      renderForms: true,
      formVersion: 2,
    });
  });

  it('ignores features that contribute nothing to pages', () => {
    const features = [{ id: 'controls-only' }, pageFeature('forms', { renderForms: true })];
    expect(mergeFeaturePageProps(features, () => ({}))).toEqual({ renderForms: true });
  });

  it('hands each feature only its own published state', () => {
    const seen: FeaturePublication[] = [];
    const peeking = (id: string): AnyPdfFeature => ({
      id,
      pageProps: (state) => {
        seen.push(state as FeaturePublication);
        return {};
      },
    });
    mergeFeaturePageProps([peeking('a'), peeking('b')], (id) => ({ which: id }));
    expect(seen).toEqual([{ which: 'a' }, { which: 'b' }]);
  });

  it('produces nothing at all for an empty list', () => {
    expect(mergeFeaturePageProps(NO_FEATURES, () => ({}))).toEqual({});
    expect(NO_FEATURES).toHaveLength(0);
  });
});

describe('findFeatureKey', () => {
  const keyFeature = (
    id: string,
    key: string,
    options: { ctrl?: boolean; when?: boolean } = {},
  ): PdfFeature => ({
    id,
    keys: [
      {
        key,
        ...(options.ctrl === undefined ? {} : { ctrl: options.ctrl }),
        ...(options.when === undefined ? {} : { when: () => options.when === true }),
        run: () => {},
      },
    ],
  });

  const states = (map: Record<string, FeaturePublication>) => (id: string) => map[id] ?? {};

  it('claims a Ctrl/Cmd chord only when the binding asks for one', () => {
    const features = [keyFeature('print', 'p', { ctrl: true })];
    expect(findFeatureKey(features, states({}), shell, eventFor('p', true))?.feature.id).toBe(
      'print',
    );
    // macOS reports Cmd as metaKey, which the event above already folded in by
    // setting ctrl; a plain 'p' must fall through to the host application.
    expect(findFeatureKey(features, states({}), shell, eventFor('p'))).toBeNull();
  });

  it('matches the key case-insensitively, because Shift is not part of the chord', () => {
    const features = [keyFeature('print', 'p', { ctrl: true })];
    expect(findFeatureKey(features, states({}), shell, eventFor('P', true))?.feature.id).toBe(
      'print',
    );
  });

  it('skips a binding whose guard says no, and lets the next feature have the chord', () => {
    const features = [keyFeature('print', 'p', { ctrl: true, when: false }), keyFeature('other', 'p', { ctrl: true })];
    expect(findFeatureKey(features, states({}), shell, eventFor('p', true))?.feature.id).toBe(
      'other',
    );
  });

  it('gives the guard the state that feature published', () => {
    const when = vi.fn(() => false);
    const features: AnyPdfFeature[] = [{ id: 'print', keys: [{ key: 'p', ctrl: true, when, run: () => {} }] }];
    findFeatureKey(features, states({ print: { supported: false } }), shell, eventFor('p', true));
    expect(when).toHaveBeenCalledWith({ supported: false }, shell);
  });

  it('gives a chord two features both bind to the first of them in the list', () => {
    const features = [keyFeature('first', 'g'), keyFeature('second', 'g')];
    expect(findFeatureKey(features, states({}), shell, eventFor('g'))?.feature.id).toBe('first');
  });
});

describe('replacedControlIds', () => {
  const feature = (id: string, replaces?: string[]): AnyPdfFeature => ({ id, replaces });

  it('is empty for a feature list where nobody declares a takeover', () => {
    // The counterfactual: without this a built-in control would vanish from some
    // viewer no one configured that way. No built-in is superseded today, so this
    // is the ordinary answer rather than the exceptional one.
    expect(replacedControlIds([feature('print'), feature('forms')])).toEqual([]);
    expect(replacedControlIds(NO_FEATURES)).toEqual([]);
  });

  it('collects the ids from the features that do', () => {
    expect(replacedControlIds([feature('print'), feature('custom', ['search'])])).toEqual(['search']);
  });

  it('says each id once when two features drop the same control', () => {
    expect(
      replacedControlIds([feature('custom', ['search']), feature('other', ['search', 'layout'])]),
    ).toEqual(['search', 'layout']);
  });
});
