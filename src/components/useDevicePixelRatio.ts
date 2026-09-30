import { useSyncExternalStore } from 'react';

import { getDevicePixelRatio, watchDevicePixelRatio } from '../lib/dpr';

/*
 * The ratio as a value that moves with the display.
 *
 * `useSyncExternalStore` rather than state in an effect because the store is read at render time: a page
 * mounted after a monitor switch gets the ratio its canvas is going to be painted at, instead of the one
 * the hub happened to have noticed. The hub notifies only on an actual move, so a `resize` that changed
 * nothing does not re-render anything.
 *
 * `getServerSnapshot` is the same function: off a display the ratio is 1, which is also what the server
 * renders. It does not matter in practice — this package's render path needs a canvas — and a host
 * hydrating one of these components should pass `devicePixelRatio` explicitly rather than trust the first
 * client read to agree with the markup.
 */
export function useDevicePixelRatio(): number {
  return useSyncExternalStore(subscribeToRatio, getDevicePixelRatio, getDevicePixelRatio);
}

function subscribeToRatio(onStoreChange: () => void): () => void {
  return watchDevicePixelRatio(onStoreChange);
}
