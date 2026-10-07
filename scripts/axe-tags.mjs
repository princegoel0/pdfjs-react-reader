/*
 * The axe rule set, read out of the harness that runs it.
 *
 * Two scripts need the same list — `a11y-record.mjs`, which wraps the jsdom audits in a record, and
 * `a11y-browser-record.mjs`, which asks the same questions inside a real engine — and the record entries claim
 * which standards were checked. Restating the tags in a second place would let a browser record say "wcag22aa"
 * about a run the harness no longer performs, which is the failure class #244 and #262 were both about: an
 * evidence instrument naming a condition it did not measure. So both scripts read the one list off
 * `src/components/axe-audit-harness.ts`, and if the harness stops spelling its tags in a `values: [...]` list the
 * read fails loudly rather than defaulting.
 */
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const HARNESS = join(root, 'src', 'components', 'axe-audit-harness.ts');

export function auditTags() {
  const source = readFileSync(HARNESS, 'utf8');
  const match = /values:\s*\[([^\]]*)\]/.exec(source);
  if (!match) {
    throw new Error(
      'src/components/axe-audit-harness.ts no longer spells its rule tags in a `values: [...]` list, so no record ' +
        'here can say what was checked.',
    );
  }
  return match[1]
    .split(',')
    .map((entry) => entry.trim().replace(/^['"]|['"]$/g, ''))
    .filter(Boolean);
}
