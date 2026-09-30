/*
 * FR-03's default UI, which had never been rendered in a test.
 *
 * `usePdfDownload.test.tsx` covers the save side and `source.test.ts` the input side, but the prompt a
 * reader of an encrypted document actually meets had only been looked at in a browser. Two things here
 * are easy to regress and impossible to see in a type: the empty-password guard, and which of the two
 * titles the reader gets after a rejected attempt — a wrong one of those tells someone their file is
 * broken when it is their typing that was.
 */
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_LABELS, type PdfViewerLabels } from '../lib/labels';
import { DE_LABELS } from '../locales/de';
import { PasswordPrompt } from './PasswordPrompt';
import { LabelsContext } from './labels-context';

function prompt(
  props: Partial<{ reason: 'need-password' | 'incorrect-password'; onSubmit: (p: string) => void; onCancel: () => void }> = {},
  labels: PdfViewerLabels = DEFAULT_LABELS,
) {
  const onSubmit = props.onSubmit ?? vi.fn();
  const onCancel = props.onCancel ?? vi.fn();
  const view = render(
    <LabelsContext.Provider value={labels}>
      <PasswordPrompt reason={props.reason ?? 'need-password'} onSubmit={onSubmit} onCancel={onCancel} />
    </LabelsContext.Provider>,
  );
  return { ...view, onSubmit, onCancel, input: screen.getByLabelText(labels.passwordField) as HTMLInputElement };
}

const unlock = () => screen.getByRole('button', { name: DEFAULT_LABELS.passwordUnlock }) as HTMLButtonElement;

describe('PasswordPrompt', () => {
  it('asks for the password, and does not claim anything went wrong yet', () => {
    prompt();
    expect(screen.getByText(DEFAULT_LABELS.passwordProtected)).toBeTruthy();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('says the attempt was rejected, out loud, when it was', () => {
    prompt({ reason: 'incorrect-password' });
    expect(screen.getByText(DEFAULT_LABELS.passwordRejected)).toBeTruthy();
    const alert = screen.getByRole('alert');
    expect(alert.textContent).toBe(DEFAULT_LABELS.passwordIncorrect);
  });

  /*
   * The guard that keeps a bare Enter from bouncing the reader back to the same form. The button is
   * disabled as well, and both matter: `submit` also checks, because a form can be submitted by
   * keyboard without the button ever being reached.
   */
  it('will not offer an empty password', () => {
    const { onSubmit } = prompt();
    expect(unlock().disabled).toBe(true);
    fireEvent.submit(document.querySelector('.pjsr-password')!);
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('types, enables, and hands the exact string over', () => {
    const { input, onSubmit } = prompt();
    fireEvent.change(input, { target: { value: 's3cret ' } });
    expect(unlock().disabled).toBe(false);
    fireEvent.click(unlock());
    // Passed through untouched: trimming a password is how a correct one becomes wrong.
    expect(onSubmit).toHaveBeenCalledWith('s3cret ');
  });

  it('cancels from the button', () => {
    const { onCancel } = prompt();
    fireEvent.click(screen.getByRole('button', { name: DEFAULT_LABELS.passwordCancel }));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it('cancels from Escape, and does not submit on the way out', () => {
    const { input, onCancel, onSubmit } = prompt();
    fireEvent.change(input, { target: { value: 'typed-but-abandoned' } });
    fireEvent.keyDown(input, { key: 'Escape' });
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('puts the cursor where the reader has to type', () => {
    const { input } = prompt();
    expect(document.activeElement).toBe(input);
  });

  // The catalog is the reason this component exists in `labels.ts` at all; a hard-coded string here
  // would show up in English to a German reader at the one moment they cannot read the document.
  // The catalog is the reason this component exists in `labels.ts` at all. Read from the shipped German
  // file rather than a string typed into this test, so the assertion cannot drift from what a real
  // reader gets — and so no test here depends on how this file's encoding survives an editor.
  it('words itself from the catalog it is given', () => {
    prompt({}, DE_LABELS);
    expect(screen.getByText(DE_LABELS.passwordProtected)).toBeTruthy();
    expect(screen.getByLabelText(DE_LABELS.passwordField)).toBeTruthy();
    expect(screen.getByRole('button', { name: DE_LABELS.passwordUnlock })).toBeTruthy();
  });
});
