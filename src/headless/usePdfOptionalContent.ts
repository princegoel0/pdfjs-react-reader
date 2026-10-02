import { useCallback, useEffect, useMemo, useState } from 'react';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import type { PdfError } from '../lib/errors';
import { toPdfError } from '../lib/errors';
import {
  flattenOptionalContent,
  type OcStateAction,
  type OptionalContentConfigHandle,
  type OptionalContentGroupState,
  type OptionalContentRow,
} from '../lib/optional-content';

export type { OcStateAction, OptionalContentConfigHandle } from '../lib/optional-content';

export interface UsePdfOptionalContentOptions {
  /**
   * The document whose layers are read. Only used when `config` is not supplied;
   * the shell always supplies it, because a config fetched here would be a
   * different object from the one its pages render with.
   */
  doc: PDFDocumentProxy | null;
  config?: OptionalContentConfigHandle | null;
  /**
   * Bumped by anything that changes layers — including this hook's own mutations
   * and a `SetOCGState` action fired by an annotation, which the config object
   * cannot announce any other way.
   */
  revision?: number;
  /** Notified after a mutation, so the caller can ask the pages to redraw. */
  onChanged?: () => void;
  onError?: (error: PdfError) => void;
}

export interface UsePdfOptionalContentResult {
  /** Layer rows in document order; null until the first read finishes. */
  rows: OptionalContentRow[] | null;
  loading: boolean;
  error: PdfError | null;
  /** False when the document declares no groups at all. */
  supported: boolean;
  /** The instance being mutated, so a caller can hand it to `page.render`. */
  config: OptionalContentConfigHandle | null;
  setVisibility: (id: string, visible: boolean) => void;
  /** Applies a `SetOCGState` action, whose `state` is pdf.js's own id-operator list. */
  applyState: (action: OcStateAction) => void;
}

/**
 * `getOrder()` and `getGroup()` exist from 5.7 onward, but the peer range starts at
 * 5.0, where both were plain public fields. Reading either shape costs two lines and
 * keeps a layer panel from being the thing that breaks an older engine.
 */
function readOrder(config: OptionalContentConfigHandle): readonly unknown[] {
  if (typeof config.getOrder === 'function') return config.getOrder() ?? [];
  return config.order ?? [];
}

function readGroup(
  config: OptionalContentConfigHandle,
  id: string,
): OptionalContentGroupState | null {
  const group =
    typeof config.getGroup === 'function'
      ? config.getGroup(id)
      : (config.groups ?? []).find((entry) => entry?.id === id);
  if (!group) return null;
  return { id, name: typeof group.name === 'string' ? group.name : '', visible: !!group.visible };
}

export function usePdfOptionalContent(
  options: UsePdfOptionalContentOptions,
): UsePdfOptionalContentResult {
  const { doc, config: injected = null, revision = 0, onChanged, onError } = options;
  const [fetched, setFetched] = useState<OptionalContentConfigHandle | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<PdfError | null>(null);

  const config = injected ?? fetched;

  useEffect(() => {
    setError(null);
    if (injected) {
      setFetched(null);
      return;
    }
    setFetched(null);
    if (!doc) return;
    let cancelled = false;
    setLoading(true);

    doc
      .getOptionalContentConfig()
      .then((result) => {
        if (cancelled) return;
        setFetched(result as unknown as OptionalContentConfigHandle);
        setLoading(false);
      })
      .catch((reason: unknown) => {
        if (cancelled) return;
        // A document whose layer tree cannot be parsed still reads; the panel is
        // what fails, and it says so in place of the list.
        setError(toPdfError(reason));
        setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [doc, injected]);

  const rows = useMemo(() => {
    if (!config) return null;
    return flattenOptionalContent(
      readOrder(config) as never,
      (id: string) => readGroup(config, id),
    );
    // `revision` is not read in here on purpose. The config object is mutable, so a
    // layer switched by an annotation action changes nothing this memo can see; the
    // counter is the only signal that the cached rows have gone stale.
  }, [config, revision]);

  const mutate = useCallback(
    (apply: (target: OptionalContentConfigHandle) => void) => {
      if (!config) return;
      try {
        apply(config);
      } catch (reason) {
        const failure = toPdfError(reason);
        setError(failure);
        onError?.(failure);
        return;
      }
      onChanged?.();
    },
    [config, onChanged, onError],
  );

  const setVisibility = useCallback(
    (id: string, visible: boolean) => mutate((target) => target.setVisibility(id, visible)),
    [mutate],
  );

  const applyState = useCallback(
    (action: OcStateAction) =>
      mutate((target) =>
        target.setOCGState({ state: [...action.state], preserveRB: action.preserveRB !== false }),
      ),
    [mutate],
  );

  return {
    rows,
    loading,
    error,
    supported: Boolean(rows && rows.length > 0),
    config,
    setVisibility,
    applyState,
  };
}
