import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { PdfError } from '../lib/errors';
import type { AnyPdfFeature, FeaturePublication, PdfViewerShell } from '../lib/features';
import { orderFeatures, samePublication } from '../lib/features';

/**
 * Where a feature's state lives while it is mounted (FR-21).
 *
 * A Runner owns the hooks and publishes their results here; the shell merges
 * page contributions back out of it, and a feature's own controls and panels
 * read them. That indirection is the point: the shell calling a hook per feature
 * breaks as soon as the feature list changes length, and a control owning its own
 * hook breaks too, because the toolbar renders every control three times — the
 * off-screen sizer, the bar, and the overflow menu.
 */
export interface FeatureStore {
  shell: PdfViewerShell;
  /** Never undefined: an unmounted feature reads as an empty object. */
  get: (id: string) => FeaturePublication;
  publish: (id: string, value: FeaturePublication) => void;
  retire: (id: string) => void;
}

const NO_PUBLICATION: FeaturePublication = Object.freeze({});

interface ScopedStore extends FeatureStore {
  feature: AnyPdfFeature;
}

const FeatureScope = createContext<ScopedStore | null>(null);

function useScope(): ScopedStore {
  const scope = useContext(FeatureScope);
  if (!scope) {
    // §3.7: a feature used where it was never registered is a configuration failure, and it fails
    // deterministically with the code rather than with a sentence a bundler minifies away.
    throw new PdfError(
      'CONFIGURATION_ERROR',
      'pdfjs-react-reader: feature hooks only work inside a mounted feature.',
    );
  }
  return scope;
}

/** Creates the publication store one viewer instance runs its features from. */
export function useFeatureStore(shell: PdfViewerShell): FeatureStore {
  const [states, setStates] = useState<Map<string, FeaturePublication>>(() => new Map());

  const publish = useCallback((id: string, value: FeaturePublication) => {
    setStates((prev) =>
      samePublication(prev.get(id), value) ? prev : new Map(prev).set(id, value),
    );
  }, []);

  // A feature that is gone must stop being readable: download decides whether to
  // save form edits by asking the forms feature, and a stale answer would be a
  // wrong answer rather than no answer.
  const retire = useCallback((id: string) => {
    setStates((prev) => {
      if (!prev.has(id)) return prev;
      const next = new Map(prev);
      next.delete(id);
      return next;
    });
  }, []);

  const get = useCallback(
    (id: string) => states.get(id) ?? NO_PUBLICATION,
    [states],
  );

  return useMemo(() => ({ shell, get, publish, retire }), [shell, get, publish, retire]);
}

function FeatureScopeProvider({
  feature,
  store,
  children,
}: {
  feature: AnyPdfFeature;
  store: FeatureStore;
  children: ReactNode;
}) {
  const scoped = useMemo<ScopedStore>(() => ({ ...store, feature }), [store, feature]);
  return <FeatureScope.Provider value={scoped}>{children}</FeatureScope.Provider>;
}

export interface FeaturePartProps {
  feature: AnyPdfFeature;
  store: FeatureStore;
  children: ReactNode;
}

/** Re-scopes a control or panel so the feature hooks resolve inside the shell. */
export function FeaturePart({ feature, store, children }: FeaturePartProps) {
  return (
    <FeatureScopeProvider feature={feature} store={store}>
      {children}
    </FeatureScopeProvider>
  );
}

/**
 * Mounts one Runner per feature, keyed by `feature.id`, in registration order.
 *
 * Keying by position instead would remount the surviving feature whenever an
 * earlier sibling is dropped, discarding its state with no error — `features` is
 * expected to be rebuilt inline on every render.
 *
 * The list is put through `orderFeatures` here rather than trusted: this is the place
 * runners mount, and §3.7's refusal has to arrive before that happens. A list with a
 * duplicate id, a missing dependency or a cycle therefore throws without running a
 * single Runner, and a valid one mounts its dependencies first.
 */
export function FeatureRunners({
  features,
  store,
}: {
  features: readonly AnyPdfFeature[];
  store: FeatureStore;
}) {
  return (
    <>
      {orderFeatures(features).map((feature) => (
        <FeatureMount key={feature.id} feature={feature} store={store} />
      ))}
    </>
  );
}

function FeatureMount({ feature, store }: { feature: AnyPdfFeature; store: FeatureStore }) {
  const { Runner } = feature;
  const { retire } = store;
  // Read the teardown off the current value, not the one that first mounted: the host
  // pattern rebuilds the feature object on every render, and the effect below deliberately
  // does not depend on it — re-running it would unregister a feature that never left.
  const latest = useRef(feature);
  latest.current = feature;
  useEffect(
    () => () => {
      // Retire first: a peer that asks this feature whether the document is dirty must
      // read `{}` while the teardown runs, not the last publication of a feature gone.
      retire(feature.id);
      latest.current.cleanup?.();
    },
    [feature.id, retire],
  );
  if (!Runner) return null;
  return (
    <FeatureScopeProvider feature={feature} store={store}>
      <Runner />
    </FeatureScopeProvider>
  );
}

/** The shell services a feature may use. */
export function usePdfFeatureShell(): PdfViewerShell {
  return useScope().shell;
}

/** The feature's own published state — `{}` until its Runner has published. */
export function usePdfFeatureState<S extends object = FeaturePublication>(): S {
  const scope = useScope();
  return scope.get(scope.feature.id) as S;
}

/**
 * Another feature's state, e.g. download asking forms whether the doc is dirty.
 *
 * `Partial`, because a peer's Runner publishes from an effect: until that effect has
 * run — the first render of every viewer, and every render of a feature that mounts
 * later — the store hands back a frozen empty object. Reading a nested field off the
 * peer without a guard is therefore a crash, not a miss, and the type is written to
 * say so rather than to flatter the call site.
 */
export function usePdfFeaturePeer<S extends object = FeaturePublication>(id: string): Partial<S> {
  return useScope().get(id) as Partial<S>;
}

/** The options given to the `create*Feature` factory that made this feature. */
export function usePdfFeatureOptions<O>(): O {
  return useScope().feature.options as O;
}

/**
 * Publishes the Runner's state on every render; the store's shallow compare is
 * what keeps that from re-rendering the shell forever, so published values must
 * be primitives or stable references.
 */
export function usePdfFeaturePublish<S extends object>(value: S): void {
  const { feature, publish } = useScope();
  const latest = useRef(value);
  latest.current = value;
  useEffect(() => {
    publish(feature.id, latest.current as FeaturePublication);
  });
}
