/**
 * Ids of the built-in features, in one tiny module so a feature can name a peer
 * without importing that peer's code: `download` asks `forms` whether the
 * document has unsaved edits, and a string import must not drag the form engine
 * into a bundle that did not ask for it.
 *
 * It is in `lib/` rather than `features/` for the same reason the contract module is: the shell's parts
 * read a tier's publication by id too — `OutlineView` asks the store for what `outlineFeature` published —
 * and `src/lib/feature-boundary.test.ts` forbids a shell module importing from `src/features/` at all,
 * which is the rule that keeps a feature out of a bundle that never asked for it.
 */
export const PRINT_FEATURE_ID = 'print';
export const DOWNLOAD_FEATURE_ID = 'download';
export const FORMS_FEATURE_ID = 'forms';
export const OUTLINE_FEATURE_ID = 'outline';
export const LAYERS_FEATURE_ID = 'layers';
export const ATTACHMENTS_FEATURE_ID = 'attachments';
export const ANNOTATE_FEATURE_ID = 'annotate';
/** The `edit` tier's own id, so a feature can ask for it without importing the writer. */
export const EDIT_FEATURE_ID = 'edit';
/** The structure tier's id. Nothing asks it today; it is listed with the others rather than inline. */
export const STRUCTURE_FEATURE_ID = 'structure';
