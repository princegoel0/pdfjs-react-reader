/**
 * The device pixel ratio, watched rather than sampled.
 *
 * FR-07 asks that canvas density be re-evaluated when the ratio *changes* — a window moving to another
 * display. Reading `window.devicePixelRatio` at render time, which is every call site in this package used
 * to do, answers that question once and never again: nothing re-runs a render effect because the environment
 * moved, and the environment is not a prop.
 *
 * How a ratio change is observed at all is not obvious, because there is no `devicePixelRatio` event. The
 * mechanism is a media query pinned to the current value — `matchMedia('(resolution: 1.25dppx)')` — which
 * stops matching the moment the device moves off it, and whose `change` event is therefore the
 * notification. Measured in Chromium at 1.25: the query for `1.25dppx` matches while `2.5dppx` and
 * `1.55dppx` do not, so a change in the ratio necessarily flips the state the event reports. The flip
 * itself is not measurable here — one display, and no way for a page to change its own ratio — so the real
 * monitor switch belongs to the device matrix (`#141`), and what is proven below is the bookkeeping.
 *
 * The query is not available everywhere. `caniuse-lite`'s `css-media-resolution` records Safari and iOS
 * Safari as partial-and-unknown below 16, which is inside this package's advertised floor, and an engine
 * that does not know a media feature evaluates a query for it as never-matching: a watcher that silently
 * never fires, on exactly the browsers nobody has open. So the feature is detected by asking a question it
 * must answer yes to — `(min-resolution: 0dppx)`, measured beside two controls that must answer no: an
 * unknown unit and an unknown feature — and where the answer is no the ratio is re-read on `resize`
 * instead, which catches a display switch that also changes the layout size and nothing beyond that.
 *
 * One watcher per realm however many components subscribe. A long document keeps tens of mounted pages, and
 * each arming its own query would multiply both the listeners and the re-arms.
 */

/** Called with the new ratio whenever the environment reports one. */
export type DevicePixelRatioChange = (ratio: number) => void;

type DprRealm = typeof globalThis & {
  devicePixelRatio?: number;
  matchMedia?: (query: string) => MediaQueryList;
};

/** The ratio now. Off a display — on a server, or before one exists — the answer is 1, not a guess. */
export function getDevicePixelRatio(): number {
  const ratio = (globalThis as DprRealm).devicePixelRatio;
  return typeof ratio === 'number' && Number.isFinite(ratio) && ratio > 0 ? ratio : 1;
}

/**
 * Whether this engine answers `resolution` queries at all.
 *
 * A query naming a feature the engine does not know is not an error and not `false`-forever-by-accident:
 * it is a list that never matches, so it can only be probed with a query that must match when the feature
 * is understood. `0dppx` is that question, and both controls in the comment above come back `false`.
 */
function canObserveResolution(): boolean {
  const matchMedia = (globalThis as DprRealm).matchMedia;
  if (typeof matchMedia !== 'function') return false;
  try {
    return matchMedia('(min-resolution: 0dppx)').matches === true;
  } catch {
    return false;
  }
}

let watched = 1;
let armed: MediaQueryList | null = null;

/**
 * One record per `watchDevicePixelRatio` call, not one per callback. React's StrictMode subscribes and
 * unsubscribes the *same* function around a double mount, and a document keeps several pages subscribed to
 * one hub, so a set of callbacks would either drop a live subscription on the first unsubscribe or leak the
 * channels after the last one. The record's identity is what an unsubscribe removes.
 */
type Subscription = { listener: DevicePixelRatioChange };
const subscriptions: Subscription[] = [];

function report(): void {
  const ratio = getDevicePixelRatio();
  // Both channels can see one change, and `resize` fires for reasons that have nothing to do with density.
  // A host repaints on a *move*, so anything else stays silent here rather than reaching the render effect.
  if (ratio === watched) return;
  watched = ratio;
  // Re-arm before notifying: a listener that changed the ratio itself (a host writing the prop back) must
  // not be watched against the number it has just left.
  armQuery();
  // A copy: a listener may unsubscribe during the round, and splicing while walking the live array would
  // hand the next subscription the slot the previous one vacated — or skip it.
  for (const subscription of [...subscriptions]) subscription.listener(ratio);
}

function armQuery(): void {
  const matchMedia = (globalThis as DprRealm).matchMedia;
  disarmQuery();
  if (typeof matchMedia !== 'function') return;
  if (!canObserveResolution()) return;
  let list: MediaQueryList;
  try {
    list = matchMedia(`(resolution: ${watched}dppx)`);
  } catch {
    // A ratio the parser refuses — the fallback channel is the only one left, and it is already installed.
    return;
  }
  if (typeof list.addEventListener !== 'function') return;
  list.addEventListener('change', report);
  armed = list;
}

function disarmQuery(): void {
  if (armed && typeof armed.removeEventListener === 'function') {
    armed.removeEventListener('change', report);
  }
  armed = null;
}

function onResize(): void {
  report();
}

/**
 * Watch the ratio, and return the unsubscribe.
 *
 * The first subscriber reads the environment and installs the channels; the last one out tears them down,
 * so a document that closed is not holding a media query open.
 */
export function watchDevicePixelRatio(listener: DevicePixelRatioChange): () => void {
  const subscription: Subscription = { listener };
  subscriptions.push(subscription);
  if (subscriptions.length === 1) {
    watched = getDevicePixelRatio();
    armQuery();
    if (typeof globalThis.addEventListener === 'function') {
      globalThis.addEventListener('resize', onResize);
    }
  } else if (watched !== getDevicePixelRatio()) {
    /*
     * Armed already, and the environment moved since — a late subscriber joining after a monitor switch must
     * not be left watching the number the room is no longer at.
     */
    report();
  }

  return () => {
    // Removing this call's own record, and nothing if it has already gone: a cleanup that runs twice — a
    // StrictMode unmount, a host holding the returned function in a ref — must not take a live subscriber's
    // watcher away, and must not leave the hub armed with nobody left to tell.
    const at = subscriptions.indexOf(subscription);
    if (at === -1) return;
    subscriptions.splice(at, 1);
    if (subscriptions.length > 0) return;
    disarmQuery();
    if (typeof globalThis.removeEventListener === 'function') {
      globalThis.removeEventListener('resize', onResize);
    }
  };
}
