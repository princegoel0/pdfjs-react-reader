/**
 * Ids of the built-in features, in one tiny module so a feature can name a peer
 * without importing that peer's code: `download` asks `forms` whether the
 * document has unsaved edits, and a string import must not drag the form engine
 * into a bundle that did not ask for it.
 */
export const PRINT_FEATURE_ID = 'print';
export const DOWNLOAD_FEATURE_ID = 'download';
export const FORMS_FEATURE_ID = 'forms';
export const OUTLINE_FEATURE_ID = 'outline';
