import { mergeDocuments } from '../../dist/merge.js';

/**
 * The merge entry on its own, with no viewer in the bundle: a host that assembles documents in a
 * worker or on a button press imports this and never loads the shell. What the measurement is for is
 * the writer's cost stated separately from the tier that shares it — `@cantoo/pdf-lib` is external, so
 * this figure is our code around it, not the 251 kB under it.
 */
export const run = (plan) => mergeDocuments(plan);
