import { useEffect, useState } from 'react';
import { ensureCanvasCeiling, maxRenderPixelsFor, probedCanvasCeiling } from '../lib/canvas';
import type { CanvasEnvironment } from '../lib/canvas';

/**
 * The realm's probed canvas ceiling, or `null` until it has been measured.
 *
 * §6.1 asks for two things that pull against each other: the platform-safe ceiling has to be
 * *probed* rather than inferred from a user-agent string, and the probe has to run "off the
 * render path and never delay a first paint". Waiting two frames is how both hold — by the
 * second frame the browser has composited the page under the assumed ceiling, which is the
 * state the caller repaints out of if the answer turns out to be lower.
 *
 * The search is capped at the ceiling already in force (`maxRenderPixelsFor`: the class default
 * and the viewport working set, whichever is smaller) rather than at the class default. That is
 * not a shortcut — it is the combination rule. A platform-safe ceiling above the number the
 * renderer is already using cannot change the minimum, so measuring up to it buys a slower page
 * and the same answer. Measured in Chromium: 33.5 Mpx of search costs about two seconds of main
 * thread, 3 Mpx costs tens of milliseconds.
 *
 * The cap is also the one place a user-agent string is allowed to matter: it lowers where the
 * probe starts, because everything above the cap is irrelevant to a minimum, and it can never
 * raise the result.
 *
 * The host's working-set factor is passed through for the same reason it is passed to the budget: a host that
 * tightened it is saying the working set here is smaller than the package's 200 %, and a search that allocates
 * above the ceiling in force would be measuring a size the renderer has already been refused.
 */
export function useCanvasCeiling(env: CanvasEnvironment, capAreaFactor?: number): number | null {
  const [ceiling, setCeiling] = useState<number | null>(() => probedCanvasCeiling());

  useEffect(() => {
    if (ceiling !== null) return;
    const raf = (globalThis as typeof globalThis & {
      requestAnimationFrame?: (callback: () => void) => number;
      cancelAnimationFrame?: (handle: number) => void;
    }).requestAnimationFrame;
    // No frames to wait for means no compositor, which means there is no ceiling to measure.
    if (!raf) return;
    let cancelled = false;
    let first = 0;
    let second = 0;
    first = raf(() => {
      second = raf(() => {
        void ensureCanvasCeiling({ limit: maxRenderPixelsFor(env, capAreaFactor) }).then((answer) => {
          if (!cancelled && answer !== null) setCeiling(answer);
        });
      });
    });
    return () => {
      cancelled = true;
      const cancel = (globalThis as typeof globalThis & { cancelAnimationFrame?: (h: number) => void })
        .cancelAnimationFrame;
      cancel?.(first);
      cancel?.(second);
    };
  }, [ceiling, env, capAreaFactor]);

  return ceiling;
}
