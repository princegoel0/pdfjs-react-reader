import { useEffect, useId, useRef, useState } from 'react';
import type { FormEvent, KeyboardEvent } from 'react';
import type { PasswordReason } from '../headless/usePdfDocument';
import { useLabels } from './labels-context';

export interface PasswordPromptProps {
  /** `incorrect-password` re-prompts after a rejected attempt. */
  reason: PasswordReason;
  onSubmit: (password: string) => void;
  onCancel: () => void;
}

/**
 * FR-03's default UI. Loading is parked on the pending password request, so
 * this replaces the page area rather than floating over it.
 */
export function PasswordPrompt({ reason, onSubmit, onCancel }: PasswordPromptProps) {
  const labels = useLabels();
  const [value, setValue] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const id = useId();
  const rejected = reason === 'incorrect-password';

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const submit = (event?: FormEvent<HTMLFormElement>) => {
    event?.preventDefault();
    // An empty password would just bounce straight back to this prompt.
    if (value) onSubmit(value);
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLFormElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      onCancel();
    }
  };

  return (
    <form className="pjsr-password" onSubmit={submit} onKeyDown={handleKeyDown}>
      <p className="pjsr-password-title">
        {rejected ? labels.passwordRejected : labels.passwordProtected}
      </p>
      <div className="pjsr-password-row">
        <label className="pjsr-password-label" htmlFor={`${id}-input`}>
          {labels.passwordField}
        </label>
        <input
          ref={inputRef}
          id={`${id}-input`}
          className="pjsr-password-input"
          type="password"
          value={value}
          autoComplete="off"
          spellCheck={false}
          onChange={(event) => setValue(event.target.value)}
        />
      </div>
      {rejected && (
        <span className="pjsr-password-error" role="alert">
          {labels.passwordIncorrect}
        </span>
      )}
      <div className="pjsr-password-actions">
        <button type="button" className="pjsr-button pjsr-status-action" onClick={onCancel}>
          {labels.passwordCancel}
        </button>
        <button
          type="submit"
          className="pjsr-button pjsr-status-action"
          disabled={value.length === 0}
        >
          {labels.passwordUnlock}
        </button>
      </div>
    </form>
  );
}
