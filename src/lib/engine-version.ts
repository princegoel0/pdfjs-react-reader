/*
 * Which `pdfjs-dist` is actually loaded, and whether it is at least some release.
 *
 * The package's engine contract is a range (`^6.2.108`), and a range hides the fact that one release in it is not
 * like the others: the annotation layer learned to connect a link to the words it lies on in 6.3.289, so a promise
 * that rests on that behaviour needs to know which engine the page is running. `version` is the engine's own
 * export, so this asks the engine rather than `package.json` — the manifest describes what a host *installed*,
 * which is not the same fact as what this realm imported.
 *
 * Comparison is numeric on dotted segments, never lexical: `'6.10.0' < '6.2.0'` is true as a string and false as a
 * release, and the boundary this module exists to test (`6.2.108` against `6.3.289`) is one segment apart, so a
 * string compare would not be noticed by either of them.
 */
import { version } from 'pdfjs-dist';

/** The engine's own version string, or `null` when it answers nothing usable (a stub, or a build without it). */
export function readEngineVersion(): string | null {
  const value = typeof version === 'string' ? version.trim() : '';
  return value === '' || /^\d+\.\d+\.\d+/.test(value) === false ? null : value;
}

/**
 * `true` when `version` is at or above `minimum`.
 *
 * Unknown version reads as *not* at least: a feature that silently assumed a capability it could not confirm is
 * the failure this exists to prevent, so an unreadable engine string reports the conservative answer.
 */
export function engineAtLeast(version: string | null, minimum: string): boolean {
  if (version === null) return false;
  const have = version.split(/[.\-+]/).map((part) => Number.parseInt(part, 10) || 0);
  const want = minimum.split(/[.\-+]/).map((part) => Number.parseInt(part, 10) || 0);
  for (let i = 0; i < Math.max(have.length, want.length); i += 1) {
    const a = have[i] ?? 0;
    const b = want[i] ?? 0;
    if (a !== b) return a > b;
  }
  return true;
}
