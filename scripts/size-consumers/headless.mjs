import { usePdfDocument } from '../../dist/headless.js';

/**
 * One hook from `/headless`, which is the path an application with its own user
 * interface takes. It must stay small on its own account: the shell is opt-in,
 * but headless consumers never agreed to carry it.
 */
export const useDoc = usePdfDocument;
