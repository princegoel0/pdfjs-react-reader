import { useState } from 'react';
import type { ReactNode } from 'react';

export interface ExampleProps {
  title: string;
  /** The example's own source, imported with Vite's `?raw` suffix. */
  source: string;
  /** Optional prop editors rendered under the preview. */
  controls?: ReactNode;
  children: ReactNode;
}

/**
 * Wraps a running example with its source. The preview is the real component,
 * not a screenshot, so knobs and edits take effect immediately.
 */
export function Example({ title, source, controls, children }: ExampleProps) {
  const [showSource, setShowSource] = useState(false);
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(source);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      /* Non-secure context or a denied permission: the code stays selectable. */
    }
  };

  return (
    <section className="doc-example">
      <header className="doc-example-head">
        <span className="doc-example-title">{title}</span>
        <span className="doc-example-live">Live</span>
        <div className="doc-example-actions">
          <button type="button" onClick={copy} title="Copy the example source">
            {copied ? 'Copied' : 'Copy'}
          </button>
          <button
            type="button"
            aria-expanded={showSource}
            onClick={() => setShowSource((open) => !open)}
          >
            {showSource ? 'Hide code' : 'Show code'}
          </button>
        </div>
      </header>
      <div className="doc-example-preview">{children}</div>
      {controls && <div className="doc-example-controls">{controls}</div>}
      {showSource && (
        <div className="doc-example-source">
          <pre>
            <code>{source}</code>
          </pre>
        </div>
      )}
    </section>
  );
}

export function SelectKnob({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: { label: string; value: string }[];
  onChange: (value: string) => void;
}) {
  return (
    <label>
      {label}
      <select value={value} onChange={(e) => onChange(e.target.value)}>
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  );
}

export function CheckKnob({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label>
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      {label}
    </label>
  );
}
