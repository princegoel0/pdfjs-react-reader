import { describe, expect, it } from 'vitest';
import { isEditableTarget, pageNavigationKey } from './keyboard';

/**
 * Vitest runs in `node`, which has no DOM, and `isEditableTarget` starts with an
 * `instanceof HTMLElement` guard. A minimal stand-in keeps the real function
 * under test instead of skipping the cases that matter.
 */
class FakeElement {
  tagName = 'DIV';
  type = '';
  isContentEditable = false;
  /** What `closest` should find, standing in for a contenteditable ancestor. */
  ancestor = false;

  closest(_selector: string): FakeElement | null {
    return this.ancestor ? this : null;
  }
}

(globalThis as Record<string, unknown>).HTMLElement = FakeElement;

function element(init: Partial<FakeElement> = {}): EventTarget {
  return Object.assign(new FakeElement(), init) as unknown as EventTarget;
}

function input(type: string): EventTarget {
  return element({ tagName: 'INPUT', type });
}

const editable = (init: Partial<FakeElement> = {}) => isEditableTarget(element(init));
const editableInput = (type: string) => isEditableTarget(input(type));

describe('isEditableTarget', () => {
  it('is false when there is no event target', () => {
    expect(isEditableTarget(null)).toBe(false);
    expect(isEditableTarget({} as unknown as EventTarget)).toBe(false);
  });

  it('treats text-bearing form widgets as editable', () => {
    // AcroForm text fields render as real <input> elements in the annotation
    // layer, so paging must not steal keystrokes from them.
    for (const type of ['text', 'password', 'email', 'number', 'search', 'tel']) {
      expect(editableInput(type), type).toBe(true);
    }
    expect(editable({ tagName: 'TEXTAREA' })).toBe(true);
    expect(editable({ tagName: 'SELECT' })).toBe(true);
  });

  it('leaves controls that do not consume page keys alone', () => {
    for (const type of ['checkbox', 'radio', 'button', 'submit', 'range']) {
      expect(editableInput(type), type).toBe(false);
    }
  });

  it('detects contenteditable, both on the target and an ancestor', () => {
    expect(editable({ isContentEditable: true })).toBe(true);
    expect(editable({ ancestor: true })).toBe(true);
    expect(editable()).toBe(false);
  });
});

describe('pageNavigationKey', () => {
  const plain = (key: string) => ({
    key,
    ctrlKey: false,
    metaKey: false,
    altKey: false,
  });

  it('maps the paging keys', () => {
    expect(pageNavigationKey(plain('ArrowDown'))).toBe('next');
    expect(pageNavigationKey(plain('PageDown'))).toBe('next');
    expect(pageNavigationKey(plain('ArrowUp'))).toBe('prev');
    expect(pageNavigationKey(plain('PageUp'))).toBe('prev');
    expect(pageNavigationKey(plain('Home'))).toBe('first');
    expect(pageNavigationKey(plain('End'))).toBe('last');
  });

  it('ignores horizontal arrows so a zoomed page stays scrollable', () => {
    expect(pageNavigationKey(plain('ArrowLeft'))).toBeNull();
    expect(pageNavigationKey(plain('ArrowRight'))).toBeNull();
  });

  it('steps aside for every modified chord', () => {
    // Ctrl+End and Cmd+Arrow are the browser/OS's own, and Alt+key is a
    // binding the host app may already own.
    for (const mod of ['ctrlKey', 'metaKey', 'altKey'] as const) {
      for (const key of ['ArrowDown', 'PageUp', 'Home', 'End']) {
        expect(pageNavigationKey({ ...plain(key), [mod]: true }), `${mod}+${key}`).toBeNull();
      }
    }
  });

  it('returns null for keys that are not navigation', () => {
    for (const key of ['a', 'Enter', 'Escape', ' ', '+', '-', 'F5', 'Tab']) {
      expect(pageNavigationKey(plain(key)), key).toBeNull();
    }
  });
});
