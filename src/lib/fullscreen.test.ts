import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  enterFullscreen,
  exitFullscreen,
  fullscreenElement,
  fullscreenSupported,
  onFullscreenChange,
} from './fullscreen';

/**
 * Vitest runs in `node`, so there is no `document` unless a test installs one.
 * That is the shape this module has to survive: the viewer renders on a server,
 * and iOS Safari spells half of these APIs differently or lacks them outright.
 */
function withDocument(stub: Record<string, unknown> | undefined, run: () => void): void {
  const previous = Reflect.get(globalThis, 'document');
  Reflect.set(globalThis, 'document', stub);
  try {
    run();
  } finally {
    Reflect.set(globalThis, 'document', previous);
  }
}

async function withDocumentAsync<T>(
  stub: Record<string, unknown> | undefined,
  run: () => Promise<T>,
): Promise<T> {
  const previous = Reflect.get(globalThis, 'document');
  Reflect.set(globalThis, 'document', stub);
  try {
    return await run();
  } finally {
    Reflect.set(globalThis, 'document', previous);
  }
}

/** Stands in for `document` as an event hub, recording both subscriptions. */
type Hub = {
  added: string[];
  removed: string[];
  fire(name: string): void;
};

function eventHub(): Hub & EventTarget {
  const added: string[] = [];
  const removed: string[] = [];
  const handlers = new Map<string, () => void>();
  const hub = {
    added,
    removed,
    fire(name: string) {
      handlers.get(name)?.();
    },
    addEventListener(name: string, handler: () => void) {
      added.push(name);
      handlers.set(name, handler);
    },
    removeEventListener(name: string) {
      removed.push(name);
      handlers.delete(name);
    },
  };
  return hub as unknown as Hub & EventTarget;
}

const NOTHING = 'Fullscreen is not supported';

afterEach(() => {
  // A leaked stub would change what the next test file's guard branches see.
  Reflect.set(globalThis, 'document', undefined);
});

describe('fullscreenElement', () => {
  it('is null without a document', () => {
    withDocument(undefined, () => {
      expect(fullscreenElement()).toBeNull();
    });
  });

  it('prefers the standard property', () => {
    const standard = { id: 'standard' };
    const prefixed = { id: 'prefixed' };
    withDocument({ fullscreenElement: standard, webkitFullscreenElement: prefixed }, () => {
      expect(fullscreenElement()).toBe(standard);
    });
  });

  it('falls back to the webkit spelling', () => {
    const prefixed = { id: 'prefixed' };
    withDocument({ webkitFullscreenElement: prefixed }, () => {
      expect(fullscreenElement()).toBe(prefixed);
    });
  });

  it('is null when nothing is fullscreen', () => {
    withDocument({ fullscreenElement: null }, () => {
      expect(fullscreenElement()).toBeNull();
    });
  });
});

describe('fullscreenSupported', () => {
  const el = (init: Record<string, unknown>) => init as unknown as Element;

  it('is false without a document', () => {
    withDocument(undefined, () => {
      expect(fullscreenSupported(el({ requestFullscreen: () => Promise.resolve() }))).toBe(false);
    });
  });

  it('accepts either spelling of the request method', () => {
    withDocument({ documentElement: {} }, () => {
      expect(fullscreenSupported(el({ requestFullscreen: () => Promise.resolve() }))).toBe(true);
      expect(fullscreenSupported(el({ webkitRequestFullscreen: () => undefined }))).toBe(true);
    });
  });

  it('is false on platforms with no element fullscreen at all', () => {
    // iPhone and iPad Safari: the toolbar hides the control rather than
    // showing one that throws.
    withDocument({ documentElement: {} }, () => {
      expect(fullscreenSupported(el({}))).toBe(false);
      expect(fullscreenSupported()).toBe(false);
    });
  });

  it('checks the document element when no target is given', () => {
    withDocument({ documentElement: { requestFullscreen: () => Promise.resolve() } }, () => {
      expect(fullscreenSupported()).toBe(true);
    });
  });
});

describe('enterFullscreen', () => {
  it('calls the standard method and resolves to undefined', async () => {
    const requestFullscreen = vi.fn(() => Promise.resolve());
    await expect(
      enterFullscreen({ requestFullscreen } as unknown as HTMLElement),
    ).resolves.toBeUndefined();
    expect(requestFullscreen).toHaveBeenCalledTimes(1);
  });

  it('resolves for a prefixed request even though it returns nothing', async () => {
    // `webkitRequestFullscreen` fires the request but returns undefined;
    // reading that as "unsupported" would reject a request that worked.
    const webkitRequestFullscreen = vi.fn();
    await expect(
      enterFullscreen({ webkitRequestFullscreen } as unknown as HTMLElement),
    ).resolves.toBeUndefined();
    expect(webkitRequestFullscreen).toHaveBeenCalledTimes(1);
  });

  it('prefers the standard method when both exist', async () => {
    const standard = vi.fn(() => Promise.resolve());
    const prefixed = vi.fn();
    await enterFullscreen({
      requestFullscreen: standard,
      webkitRequestFullscreen: prefixed,
    } as unknown as HTMLElement);
    expect(standard).toHaveBeenCalledTimes(1);
    expect(prefixed).not.toHaveBeenCalled();
  });

  it('propagates a rejection from the browser', async () => {
    // Happens when the request is not tied to a user gesture.
    const el = { requestFullscreen: () => Promise.reject(new Error('NotAllowedError')) };
    await expect(enterFullscreen(el as unknown as HTMLElement)).rejects.toThrow('NotAllowedError');
  });

  it('rejects when the platform offers neither method', async () => {
    await expect(enterFullscreen({} as unknown as HTMLElement)).rejects.toThrow(NOTHING);
  });
});

describe('exitFullscreen', () => {
  it('calls the standard method on the document', async () => {
    const exit = vi.fn(() => Promise.resolve());
    await withDocumentAsync({ exitFullscreen: exit }, async () => {
      await expect(exitFullscreen()).resolves.toBeUndefined();
    });
    expect(exit).toHaveBeenCalledTimes(1);
  });

  it('falls back to the webkit method', async () => {
    const webkitExitFullscreen = vi.fn();
    await withDocumentAsync({ webkitExitFullscreen }, async () => {
      await expect(exitFullscreen()).resolves.toBeUndefined();
    });
    expect(webkitExitFullscreen).toHaveBeenCalledTimes(1);
  });

  it('rejects without a document or without a method', async () => {
    await expect(exitFullscreen()).rejects.toThrow(NOTHING);
    await withDocumentAsync({}, async () => {
      await expect(exitFullscreen()).rejects.toThrow(NOTHING);
    });
  });
});

describe('onFullscreenChange', () => {
  it('subscribes to both spellings and fires for either', () => {
    const hub = eventHub();
    const callback = vi.fn();

    onFullscreenChange(callback, hub);
    expect(hub.added).toEqual(['fullscreenchange', 'webkitfullscreenchange']);

    hub.fire('fullscreenchange');
    hub.fire('webkitfullscreenchange');
    expect(callback).toHaveBeenCalledTimes(2);
  });

  it('removes both listeners on unsubscribe', () => {
    const hub = eventHub();
    const callback = vi.fn();

    onFullscreenChange(callback, hub)();
    expect(hub.removed).toEqual(['fullscreenchange', 'webkitfullscreenchange']);

    hub.fire('fullscreenchange');
    expect(callback).not.toHaveBeenCalled();
  });

  it('is a no-op without a document to subscribe to', () => {
    withDocument(undefined, () => {
      const callback = vi.fn();
      expect(() => onFullscreenChange(callback)()).not.toThrow();
      expect(callback).not.toHaveBeenCalled();
    });
  });
});
