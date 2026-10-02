// Lists every name a consumer can import from each JS entry point, read out of the built declarations
// rather than out of a document. `CODE_REFERENCE.md` §4 is generated from this, and §22 tells anyone
// checking that document to run it, which means it has to live in `scripts/` and not in the ignored spike
// folder where it was written.
//
// The parsing is shared with `check-maturity.mjs` through `api-names.mjs`: one scan, two consumers, so the
// inventory and the maturity audit cannot disagree about what the public surface is.
// Requires `npm run build` first — it reads `dist/`, the thing consumers actually resolve.
import { publishedNames, printed } from './api-names.mjs';

const { entries, missing } = publishedNames();
if (missing.length) console.error(`missing declaration files: ${missing.join(', ')}`);
console.log(JSON.stringify(printed(entries), null, 1));
