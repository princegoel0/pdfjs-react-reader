import { useCallback, useState } from 'react';
import { downloadBytes } from 'pdfjs-react-reader/headless';
import { usePdfMerge, type MergeSource } from 'pdfjs-react-reader/merge';

/*
 * The merge recipe, running.
 *
 * `pdfjs-react-reader/merge` ships a writer and a hook and no component, because which documents may be
 * merged, where they come from, and what happens to the result are the host's business — the same reason
 * `enableDrop` hands a dropped file back rather than opening it. This file is what the host then has to
 * write, which is the honest test of that decision: if the picker below is awkward, the awkwardness is a
 * bug report against `usePdfMerge`.
 *
 * The part a host is most likely to get wrong is the preview, so it is the part spelled out here: the plan
 * is an ordered list the reader can rearrange and take rows out of, and it is shown before anything is
 * written. The sources are never modified — the button below hands back a file it made.
 */

const CANDIDATES = [
  'page-order-sample.pdf',
  'tagged-sample.pdf',
  'outline-sample.pdf',
  'form-sample.pdf',
] as const;

type Candidate = (typeof CANDIDATES)[number];

async function load(name: Candidate): Promise<MergeSource> {
  const response = await fetch(`/fixtures/${name}`);
  if (!response.ok) throw new Error(`${name}: ${response.status}`);
  return { bytes: new Uint8Array(await response.arrayBuffer()), name };
}

export function MergeDemo() {
  const [pair, setPair] = useState<[Candidate, Candidate]>(['page-order-sample.pdf', 'tagged-sample.pdf']);
  const [sources, setSources] = useState<readonly MergeSource[]>([]);
  const [note, setNote] = useState('');

  const open = useCallback(async () => {
    setNote('reading…');
    try {
      setSources(await Promise.all(pair.map(load)));
      setNote('');
    } catch (error) {
      setNote(error instanceof Error ? error.message : String(error));
    }
  }, [pair]);

  const merge = usePdfMerge({
    sources,
    onError: (error) => setNote(error.message),
  });

  const write = useCallback(async () => {
    const result = await merge.merge();
    if (!result) {
      setNote('nothing was written — the plan is empty, or it was stopped');
      return;
    }
    downloadBytes(result.bytes, 'merged.pdf');
    setNote(`wrote ${result.pages} pages: ${result.taken.join(' + ')}`);
  }, [merge]);

  if (sources.length === 0) {
    return (
      <div className="merge-demo">
        <label>
          from{' '}
          <select
            value={pair[0]}
            onChange={(event) => setPair([event.target.value as Candidate, pair[1]])}
          >
            {CANDIDATES.map((name) => (
              <option key={name}>{name}</option>
            ))}
          </select>
        </label>
        <label>
          and{' '}
          <select
            value={pair[1]}
            onChange={(event) => setPair([pair[0], event.target.value as Candidate])}
          >
            {CANDIDATES.map((name) => (
              <option key={name}>{name}</option>
            ))}
          </select>
        </label>
        <button type="button" onClick={open}>
          Open both
        </button>
        {note && <p role="status">{note}</p>}
      </div>
    );
  }

  return (
    <div className="merge-demo">
      <div className="merge-demo-sources">
        {sources.map((source, at) => (
          <fieldset key={source.name}>
            <legend>
              {source.name} — {merge.available[at] ?? '…'} pages, {merge.taken[at]} taken
            </legend>
            {Array.from({ length: merge.available[at] ?? 0 }, (_, page) => (
              <button
                key={page}
                type="button"
                onClick={() => merge.add(at, page)}
                aria-label={`Add page ${page + 1} of ${source.name}`}
              >
                {page + 1}
              </button>
            ))}
          </fieldset>
        ))}
      </div>

      <p role="status">
        {merge.order.length === 0
          ? 'Pick pages from either document; the merge writes a new file and leaves both alone.'
          : `${merge.order.length} pages queued.`}
      </p>

      <ol className="merge-demo-plan">
        {merge.order.map((ref, position) => (
          <li key={`${ref.source}-${ref.page}-${position}`}>
            <span>
              {sources[ref.source]?.name} · page {ref.page + 1}
            </span>
            <button
              type="button"
              disabled={position === 0}
              onClick={() => merge.move(position, position - 1)}
              aria-label="Move earlier"
            >
              ↑
            </button>
            <button
              type="button"
              disabled={position === merge.order.length - 1}
              onClick={() => merge.move(position, position + 1)}
              aria-label="Move later"
            >
              ↓
            </button>
            <button type="button" onClick={() => merge.remove(position)} aria-label="Remove">
              ✕
            </button>
          </li>
        ))}
      </ol>

      <div className="merge-demo-actions">
        <button type="button" disabled={merge.order.length === 0} onClick={write}>
          Merge to a new file
        </button>
        <button type="button" disabled={merge.order.length === 0} onClick={merge.clear}>
          Clear
        </button>
        <button
          type="button"
          onClick={() => {
            setSources([]);
            setNote('');
          }}
        >
          Close both
        </button>
      </div>
      {note && <p role="status">{note}</p>}
    </div>
  );
}
