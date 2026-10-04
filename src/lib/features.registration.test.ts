/**
 * FR-21 and FR-56: §3.7's registration contract, as three refusals and one order.
 *
 * The clause under test is "Registration is validated, not hoped over." Each of the three
 * failure kinds — a duplicate id, a missing dependency, a dependency cycle — has to fail
 * with a `PdfError` coded `CONFIGURATION_ERROR` that names the feature and the problem, and
 * each has to be *deterministic*: same list, same verdict, every time. The counterfactual for
 * all three is the same one: delete the corresponding pass in `orderFeatures` and the list
 * that used to be refused is handed back to the shell, where the runners mount and the
 * failure becomes state that belongs to nobody.
 *
 * Precedence between the three is pinned here too, because "deterministic" means the same
 * input gives the same answer, and a list can be malformed twice over at once.
 */
import { describe, expect, it, vi } from 'vitest';
import { isPdfError } from './errors';
import {
  findFeatureKey,
  mergeFeaturePageProps,
  NO_FEATURES,
  orderFeatures,
  type AnyPdfFeature,
  type FeaturePublication,
  type PdfViewerShell,
} from './features';

const shell = {} as PdfViewerShell;

const feature = (id: string, dependsOn?: string[]): AnyPdfFeature =>
  dependsOn ? { id, dependsOn } : { id };

const ids = (features: readonly AnyPdfFeature[]) => features.map((f) => f.id);

/** The thrown value, narrowed, so a test that asserts a code cannot pass on a `TypeError`. */
function configurationError(thunk: () => unknown) {
  let thrown: unknown;
  try {
    thunk();
  } catch (error) {
    thrown = error;
  }
  expect(isPdfError(thrown, 'CONFIGURATION_ERROR')).toBe(true);
  return thrown as { message: string; details?: Record<string, unknown> };
}

describe('orderFeatures: duplicate registration (FR-21)', () => {
  it('refuses two features under one id, naming the id and the problem', () => {
    const error = configurationError(() => orderFeatures([feature('print'), feature('print')]));
    expect(error.message).toContain('print');
    expect(error.details).toMatchObject({ problem: 'duplicate-id', feature: 'print' });
  });

  it('refuses a duplicate that differs only by its options, because the id is the key', () => {
    const configured: AnyPdfFeature = { id: 'download', options: { fileName: 'a' } };
    const error = configurationError(() => orderFeatures([configured, feature('download')]));
    expect(error.details).toMatchObject({ problem: 'duplicate-id', feature: 'download' });
  });

  it('reports a duplicate before a cycle, because the id map is what the cycle walk reads', () => {
    const error = configurationError(() =>
      orderFeatures([feature('a', ['b']), feature('b', ['a']), feature('a')]),
    );
    expect(error.details).toMatchObject({ problem: 'duplicate-id' });
  });
});

describe('orderFeatures: missing dependency (FR-21)', () => {
  it('refuses a dependency that is not in the list, naming both features', () => {
    const error = configurationError(() => orderFeatures([feature('download', ['forms'])]));
    expect(error.message).toContain('download');
    expect(error.message).toContain('forms');
    expect(error.details).toMatchObject({
      problem: 'missing-dependency',
      feature: 'download',
      dependency: 'forms',
    });
  });

  it('refuses the second missing dependency of a three-feature list, not just the first', () => {
    const error = configurationError(() =>
      orderFeatures([feature('a', ['b']), feature('b', ['ghost'])]),
    );
    expect(error.details).toMatchObject({ feature: 'b', dependency: 'ghost' });
  });

  it('accepts a dependency that is present, however it is written', () => {
    expect(ids(orderFeatures([feature('b'), feature('a', ['b'])]))).toEqual(['b', 'a']);
  });
});

describe('orderFeatures: dependency cycle (FR-21)', () => {
  it('refuses a two-feature cycle and names every feature in it, in the order it was walked', () => {
    const error = configurationError(() =>
      orderFeatures([feature('a', ['b']), feature('b', ['a'])]),
    );
    expect(error.message).toContain('a');
    expect(error.message).toContain('b');
    expect(error.details).toMatchObject({ problem: 'dependency-cycle', cycle: ['a', 'b', 'a'] });
  });

  it('refuses a three-feature cycle whose tail closes back on the start', () => {
    const error = configurationError(() =>
      orderFeatures([feature('a', ['b']), feature('b', ['c']), feature('c', ['a'])]),
    );
    expect(error.details).toMatchObject({ cycle: ['a', 'b', 'c', 'a'] });
  });

  it('refuses a feature that depends on itself', () => {
    const error = configurationError(() => orderFeatures([feature('forms', ['forms'])]));
    expect(error.details).toMatchObject({ feature: 'forms', cycle: ['forms', 'forms'] });
  });

  it('refuses a cycle that only the ordering would have walked, so it cannot be escaped by chance', () => {
    // `x` mounts first and needs nothing; `c` is reachable only from `b`. A sort that
    // emitted what it could and threw later would leave the shell half-registered.
    const error = configurationError(() =>
      orderFeatures([feature('x'), feature('a', ['b']), feature('b', ['c']), feature('c', ['a'])]),
    );
    expect(error.details).toMatchObject({ problem: 'dependency-cycle' });
  });

  it('reports the same failure for the same list every time', () => {
    const list = [feature('a', ['b']), feature('b', ['a'])];
    expect(configurationError(() => orderFeatures(list)).message).toBe(
      configurationError(() => orderFeatures(list)).message,
    );
  });
});

describe('orderFeatures: registration order (FR-56)', () => {
  it('puts a dependency before its dependent whatever the host wrote', () => {
    expect(ids(orderFeatures([feature('dependent', ['dependency']), feature('dependency')]))).toEqual(
      ['dependency', 'dependent'],
    );
  });

  it('walks a chain, so the deepest dependency initialises first', () => {
    expect(ids(orderFeatures([feature('c', ['b']), feature('a'), feature('b', ['a'])]))).toEqual([
      'a',
      'b',
      'c',
    ]);
  });

  it('keeps two features that have nothing to do with each other in declaration order', () => {
    expect(ids(orderFeatures([feature('print'), feature('forms'), feature('outline')]))).toEqual([
      'print',
      'forms',
      'outline',
    ]);
  });

  it('resolves a diamond with each dependency before both of its dependents', () => {
    const ordered = ids(
      orderFeatures([
        feature('top', ['left', 'right']),
        feature('left', ['bottom']),
        feature('right', ['bottom']),
        feature('bottom'),
      ]),
    );
    expect(ordered.indexOf('bottom')).toBeLessThan(ordered.indexOf('left'));
    expect(ordered.indexOf('left')).toBeLessThan(ordered.indexOf('top'));
    expect(ordered.indexOf('right')).toBeLessThan(ordered.indexOf('top'));
  });

  it('emits every feature exactly once, including one two features depend on', () => {
    const ordered = orderFeatures([
      feature('a', ['shared']),
      feature('b', ['shared']),
      feature('shared'),
    ]);
    expect(ids(ordered)).toEqual(['shared', 'a', 'b']);
  });

  it('hands back the very array it was given when nothing declares a dependency', () => {
    /*
     * Not a convenience. `features` is rebuilt inline on every render by the documented host
     * pattern, and the shell's memos key on it; a list with no dependencies that came back as a
     * fresh array would recompute every page contribution on every viewer render.
     */
    const list = [feature('print'), feature('forms')];
    expect(orderFeatures(list)).toBe(list);
    expect(orderFeatures(NO_FEATURES)).toBe(NO_FEATURES);
  });

  it('accepts an empty list and a single feature that needs nothing', () => {
    expect(orderFeatures([])).toEqual([]);
    expect(ids(orderFeatures([feature('print')]))).toEqual(['print']);
  });
});

describe('registration order resolves the ties the shell has (FR-56)', () => {
  /*
   * `dependsOn` is documented as answering every place the shell breaks a tie, and two of them
   * disagree by construction: the *later* feature wins a page contribution and the *first* one
   * to claim a chord wins the keyboard. Each assertion here is paired with what the raw written
   * order would have answered, which is the difference the sort makes and the reason one order
   * is applied to both.
   */
  const versioned = (id: string, formVersion: number, dependsOn?: string[]): AnyPdfFeature => ({
    id,
    ...(dependsOn ? { dependsOn } : {}),
    pageProps: () => ({ formVersion }),
  });
  const keyed = (id: string, dependsOn?: string[]): AnyPdfFeature => ({
    id,
    ...(dependsOn ? { dependsOn } : {}),
    keys: [{ key: 'p', ctrl: true, run: () => {} }],
  });
  const chord = { key: 'p', ctrlKey: true, metaKey: false, altKey: false, preventDefault: vi.fn() };
  const get = () => ({}) as FeaturePublication;

  it('gives the last word on a page contribution to the dependent, not to whoever was written last', () => {
    const written = [versioned('dependent', 2, ['dependency']), versioned('dependency', 1)];
    // The counterfactual, stated rather than assumed: without the sort the dependency, written
    // second, wins the merge.
    expect(mergeFeaturePageProps(written, get).formVersion).toBe(1);
    expect(mergeFeaturePageProps(orderFeatures(written), get).formVersion).toBe(2);
  });

  it('gives a chord both of them bind to the dependency, which is now the first of the two', () => {
    const written = [keyed('dependent', ['dependency']), keyed('dependency')];
    expect(findFeatureKey(written, get, shell, chord)?.feature.id).toBe('dependent');
    expect(findFeatureKey(orderFeatures(written), get, shell, chord)?.feature.id).toBe(
      'dependency',
    );
  });
});
