/*
 * FR-07's watching half: the device pixel ratio as an environment value, not a prop.
 *
 * Nothing here can move a real display's density — one screen, and no way for a page to change its own
 * `devicePixelRatio` — so the media query is a stub that records what it was asked for and lets the test
 * deliver the change. What that still proves is the part the requirement is actually about: *which* query
 * gets armed, whether a change reaches a listener, and whether something that is not a change does not.
 * The flip itself, on real hardware, is the device matrix's (`#141`), and the premise that a pinned query
 * tracks the live ratio was measured in Chromium rather than assumed (see `src/lib/dpr.ts`'s header).
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

import { getDevicePixelRatio, watchDevicePixelRatio } from './dpr';

type Realm = {
  devicePixelRatio?: number;
  matchMedia?: (query: string) => MediaQueryList;
};

const realm = globalThis as typeof globalThis & Realm;

/** Every query `matchMedia` was asked for, every change handler registered, every `resize` handler. */
type Stub = {
  queries: string[];
  changes: Set<() => void>;
  resizes: Set<() => void>;
  removed: string[];
};

let stub: Stub;
let live = 1;
const unsubscribes: Array<() => void> = [];

/**
 * Install an environment. `supportsResolution` is the engine's answer to `(min-resolution: 0dppx)`, which
 * is how `dpr.ts` decides whether a pinned `resolution` query means anything: real, or a watcher that will
 * never fire (caniuse-lite's `css-media-resolution` records Safari and iOS Safari as partial below 16).
 */
function environment(ratio: number, options: { supportsResolution?: boolean } = {}): void {
  const { supportsResolution = true } = options;
  stub = { queries: [], changes: new Set(), resizes: new Set(), removed: [] };
  live = ratio;
  Object.defineProperty(realm, 'devicePixelRatio', { configurable: true, get: () => live });
  realm.matchMedia = (query: string) => {
    stub.queries.push(query);
    const matches = query === '(min-resolution: 0dppx)' ? supportsResolution : false;
    return {
      media: query,
      matches,
      addEventListener: (_type: string, handler: () => void) => stub.changes.add(handler),
      removeEventListener: (_type: string, handler: () => void) => {
        stub.changes.delete(handler);
        stub.removed.push(query);
      },
    } as unknown as MediaQueryList;
  };
  /*
   * Installed through `defineProperty` rather than assignment: the DOM lib declares `addEventListener` as an
   * overloaded method, so intersecting it with a stub signature gives a type neither side satisfies. The
   * value read at the call site is only ever tested with `typeof … === 'function'`.
   */
  Object.defineProperty(realm, 'addEventListener', {
    configurable: true,
    value: (type: string, handler: () => void) => {
      if (type === 'resize') stub.resizes.add(handler);
    },
  });
  Object.defineProperty(realm, 'removeEventListener', {
    configurable: true,
    value: (type: string, handler: () => void) => {
      if (type === 'resize') stub.resizes.delete(handler);
    },
  });
}

/** Move the display and let the engine report it, the way a media query change and a resize both would. */
function moveTo(ratio: number): void {
  live = ratio;
  for (const handler of [...stub.changes]) handler();
  for (const handler of [...stub.resizes]) handler();
}

function watch(ratio: number, options?: { supportsResolution?: boolean }): () => void {
  environment(ratio, options);
  const unsubscribe = watchDevicePixelRatio(vi.fn());
  unsubscribes.push(unsubscribe);
  return unsubscribe;
}

afterEach(() => {
  for (const unsubscribe of unsubscribes.splice(0)) unsubscribe();
  // `Reflect.deleteProperty` rather than `delete` because the DOM types declare all four as required, so
  // TypeScript refuses to delete them — and Node's `globalThis` genuinely has none of them, which is the
  // state the next file (and the first test below) expects.
  for (const key of ['devicePixelRatio', 'matchMedia', 'addEventListener', 'removeEventListener']) {
    Reflect.deleteProperty(realm, key);
  }
});

describe('reading the ratio', () => {
  it('is 1 where there is no display, which is the server’s answer too', () => {
    expect(realm.devicePixelRatio).toBeUndefined();
    expect(getDevicePixelRatio()).toBe(1);
  });

  it('reads the live value when there is one', () => {
    environment(1.5);
    expect(getDevicePixelRatio()).toBe(1.5);
  });

  /*
   * The counterfactual that makes the guard a decision: a ratio that is not a usable number would reach
   * `resolveRenderScale` and size a canvas at `width * NaN`, which allocates nothing and paints a blank
   * page — the failure the canvas ceilings exist to prevent, arriving from the other direction.
   */
  it('refuses a ratio that is not a positive finite number rather than passing it on', () => {
    environment(1);
    for (const hostile of [Number.NaN, 0, -2, Number.POSITIVE_INFINITY]) {
      live = hostile;
      expect(getDevicePixelRatio(), `devicePixelRatio ${hostile}`).toBe(1);
    }
  });
});

describe('watching the ratio', () => {
  it('arms a query pinned to the current density', () => {
    watch(1.25);
    // The detect question first, then the one that is the watcher.
    expect(stub.queries).toEqual(['(min-resolution: 0dppx)', '(resolution: 1.25dppx)']);
  });

  it('tells a listener when the density moved, and re-arms on the new number', () => {
    const seen = vi.fn();
    environment(1);
    unsubscribes.push(watchDevicePixelRatio(seen));
    expect(seen).not.toHaveBeenCalled();

    moveTo(2);
    expect(seen).toHaveBeenCalledTimes(1);
    expect(seen).toHaveBeenLastCalledWith(2);
    // A query left armed at 1 would fire once and then never again: the watcher has to follow the value.
    expect(stub.queries.at(-1)).toBe('(resolution: 2dppx)');
    expect(stub.removed).toEqual(['(resolution: 1dppx)']);
  });

  /*
   * The media query on its own, with no `resize` to lean on. Without this the test above would pass on the
   * fallback channel alone and the primary mechanism would be unasserted — the two channels are wired
   * through the same `report`, so only firing one of them tells them apart.
   */
  it('reports a change the media query alone announces', () => {
    const seen = vi.fn();
    environment(1);
    unsubscribes.push(watchDevicePixelRatio(seen));
    Object.defineProperty(realm, 'devicePixelRatio', { configurable: true, value: 2 });
    for (const handler of [...stub.changes]) handler();
    expect(seen).toHaveBeenCalledTimes(1);
    expect(seen).toHaveBeenCalledWith(2);
  });

  it('stays silent when the environment reports a change that is not one', () => {
    const seen = vi.fn();
    environment(2);
    unsubscribes.push(watchDevicePixelRatio(seen));

    // A `resize` from a window drag, a keyboard opening, a scrollbar appearing: same display, same density.
    for (const handler of [...stub.resizes]) handler();
    for (const handler of [...stub.resizes]) handler();
    expect(seen).not.toHaveBeenCalled();

    moveTo(2);
    expect(seen).not.toHaveBeenCalled();
  });

  it('watches through `resize` alone on an engine that does not know the `resolution` feature', () => {
    const seen = vi.fn();
    environment(1, { supportsResolution: false });
    unsubscribes.push(watchDevicePixelRatio(seen));

    // Only the detect question was asked, and it was answered no: no query can be armed against a feature
    // the engine would evaluate as never-matching, since that is a watcher that never fires.
    expect(stub.queries).toEqual(['(min-resolution: 0dppx)']);
    expect(stub.changes.size).toBe(0);

    moveTo(2);
    expect(seen).toHaveBeenCalledTimes(1);
    expect(seen).toHaveBeenCalledWith(2);
  });

  it('arms one watcher for every component that asks, and none once they have all gone', () => {
    environment(1);
    const first = watchDevicePixelRatio(vi.fn());
    const second = watchDevicePixelRatio(vi.fn());
    const third = watchDevicePixelRatio(vi.fn());
    expect(stub.queries.filter((q) => q.startsWith('(resolution:'))).toHaveLength(1);
    expect(stub.changes.size).toBe(1);
    expect(stub.resizes.size).toBe(1);

    first();
    second();
    expect(stub.changes.size).toBe(1);
    expect(stub.resizes.size).toBe(1);

    third();
    expect(stub.changes.size).toBe(0);
    expect(stub.resizes.size).toBe(0);

    // And it starts again cleanly, rather than leaving a torn-down hub behind.
    const late = watchDevicePixelRatio(vi.fn());
    unsubscribes.push(late);
    expect(stub.changes.size).toBe(1);
  });

  it('brings a late component up to a density that moved while nothing was watching it', () => {
    const early = vi.fn();
    environment(1);
    const unsubscribe = watchDevicePixelRatio(early);
    unsubscribes.push(unsubscribe);

    // The display moves with no listener left to hear it — every page unmounted, the document closed.
    unsubscribe();
    live = 3;

    const late = vi.fn();
    const next = watchDevicePixelRatio(late);
    unsubscribes.push(next);

    expect(late).not.toHaveBeenCalled();
    expect(stub.queries.at(-1)).toBe('(resolution: 3dppx)');

    // Now a change that the *previous* watcher would have missed reaches both subscribers.
    moveTo(4);
    expect(late).toHaveBeenCalledWith(4);
  });

  it('notifies no listener once they have all unsubscribed, whatever the environment does', () => {
    const seen = vi.fn();
    environment(1);
    const unsubscribe = watchDevicePixelRatio(seen);
    unsubscribe();
    moveTo(2);
    expect(seen).not.toHaveBeenCalled();
  });

  /*
   * The reason the returned function is idempotent rather than a plain `count--`: a cleanup that runs twice
   * would drive the subscriber count below zero, after which `subscribers === 1` never holds again and the
   * hub stops arming. Every page in the document would then watch nothing, and nothing would look broken.
   */
  it('survives a listener unsubscribing itself twice', () => {
    environment(1);
    const first = watchDevicePixelRatio(vi.fn());
    const second = watchDevicePixelRatio(vi.fn());
    unsubscribes.push(second);
    first();
    first();
    expect(stub.changes.size).toBe(1);

    const moved = vi.fn();
    unsubscribes.push(watchDevicePixelRatio(moved));
    moveTo(2);
    expect(moved).toHaveBeenCalledWith(2);
  });

  /*
   * The StrictMode shape: React subscribes, unsubscribes and re-subscribes *the same function* around a
   * double mount, and every page in a document hands the hub its own copy of one. Keyed by callback, a
   * second subscribe is a no-op and the first unsubscribe then removes a watcher that is still wanted.
   */
  it('treats one callback subscribed twice as two subscriptions', () => {
    const shared = vi.fn();
    environment(1);
    const first = watchDevicePixelRatio(shared);
    const second = watchDevicePixelRatio(shared);
    expect(stub.changes.size).toBe(1);

    first();
    moveTo(2);
    expect(shared).toHaveBeenCalledTimes(1);

    second();
    moveTo(3);
    expect(shared, 'nothing is watching after both records are gone').toHaveBeenCalledTimes(1);
  });
});
