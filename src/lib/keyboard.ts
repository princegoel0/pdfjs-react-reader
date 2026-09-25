export type PageKey = 'prev' | 'next' | 'first' | 'last';

/**
 * True when `target` is somewhere keystrokes belong to the page rather than to
 * the viewer. This is load-bearing, not defensive: AcroForm widgets render as
 * real `input`/`textarea`/`select` elements inside the annotation layer, so
 * without it typing a name into a form field would page the document.
 */
export function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  if (tag === 'TEXTAREA' || tag === 'SELECT') return true;
  if (tag === 'INPUT') {
    // Buttons, checkboxes and radios do not consume arrow or page keys.
    return !['checkbox', 'radio', 'button', 'submit', 'range'].includes(
      (target as HTMLInputElement).type,
    );
  }
  if (target.isContentEditable) return true;
  return !!target.closest('[contenteditable=""], [contenteditable="true"]');
}

interface ModifierKeys {
  key: string;
  ctrlKey: boolean;
  metaKey: boolean;
  altKey: boolean;
}

/**
 * Maps a key to a page move, or `null` when the viewer should leave it alone.
 *
 * Deliberately omits ArrowLeft/ArrowRight: the viewport scrolls horizontally at
 * high zoom and in spread layout, and stealing those keys would make the wide
 * row unreachable by keyboard.
 */
export function pageNavigationKey(event: ModifierKeys): PageKey | null {
  if (event.ctrlKey || event.metaKey || event.altKey) return null;
  switch (event.key) {
    case 'ArrowDown':
    case 'PageDown':
      return 'next';
    case 'ArrowUp':
    case 'PageUp':
      return 'prev';
    case 'Home':
      return 'first';
    case 'End':
      return 'last';
    default:
      return null;
  }
}
