/**
 * The declaration for `scripts/axe-tags.mjs`, so a test can import the harness's rule list without the type
 * checker being asked to read JavaScript (`src/lib/a11y-browser-record.test.ts` does, and a record that restated
 * the tags would be a claim about a rule set nothing runs).
 */
export declare function auditTags(): string[];
