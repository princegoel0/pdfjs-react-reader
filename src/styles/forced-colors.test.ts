/*
 * FR-44's gate: a colour this package picked is either the reader's to change or ours to keep, and the
 * choice has to be written down in the file that makes it.
 *
 * Two invariants, both derived from the sheets rather than from a list this file would have to remember to
 * update:
 *
 *  1. A stylesheet that declares a literal colour — a hex, an `rgb()`, anything not read through a
 *     `var(--pjsr-*)` token — must carry a `@media (forced-colors: active)` block. A literal is the colour
 *     the UA will override, so the file has to say which ones it hands over and which it keeps; a sheet
 *     that only uses tokens needs no block, because the core sheet re-points the tokens once for all of
 *     them. This is the check that found forms.css's field tint: an SVG inside a data URL, invisible to the
 *     override, staying indigo in a black-on-white theme.
 *  2. Inside such a block, no literal colour: the block's entire purpose is to stop authoring a hue the
 *     reader asked not to have, so `#4f46e5` there would be the bug wearing the fix's clothes.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const dir = join(process.cwd(), 'src/styles');

/** Strips comments, so a `#hex` in prose is not mistaken for a declaration and `white-space` is not `white`. */
const code = (css: string) => css.replace(/\/\*[\s\S]*?\*\//g, '');

/** The text inside every `@media (forced-colors: active)` block, and everything that is not. */
function split(css: string): { outside: string; inside: string } {
  const stripped = code(css);
  let inside = '';
  let outside = '';
  let cursor = 0;
  for (const open of stripped.matchAll(/@media\s*\(forced-colors:\s*active\)\s*\{/g)) {
    let depth = 1;
    let i = (open.index ?? 0) + open[0].length;
    while (i < stripped.length && depth > 0) {
      if (stripped[i] === '{') depth++;
      if (stripped[i] === '}') depth--;
      i++;
    }
    outside += stripped.slice(cursor, open.index);
    inside += stripped.slice((open.index ?? 0) + open[0].length, i);
    cursor = i;
  }
  return { outside: outside + stripped.slice(cursor), inside };
}

/*
 * A colour the UA will override, as opposed to one it inherits the reader's choice through: a hex, a
 * functional colour, or a colour written into a data URL. `color-mix()` of two `var(--pjsr-*)` tokens is
 * not on this list — the mix keeps its alpha, the UA replaces the hue, and the alpha is ours to want.
 */
const LITERAL = /#[0-9a-fA-F]{3,8}\b|\brgba?\(|\bhsla?\(|fill:\s*[#!]?[0-9a-fA-F]/;

const sheets = readdirSync(dir)
  .filter((name) => name.endsWith('.css'))
  .map((name) => ({ name, css: readFileSync(join(dir, name), 'latin1') }));

describe('the stylesheets under forced colours', () => {
  it('are all found, and none of them is empty', () => {
    expect(sheets.length).toBeGreaterThanOrEqual(9);
    for (const sheet of sheets) expect(sheet.css.trim().length).toBeGreaterThan(0);
  });

  it('declare a literal colour only where the file also says what forced colours does with it', () => {
    const unadapted = sheets.filter((sheet) => {
      const { outside } = split(sheet.css);
      return LITERAL.test(outside) && !/@media\s*\(forced-colors:\s*active\)/.test(sheet.css);
    });
    // The message has to be actionable: which file, and what it declares.
    expect(unadapted.map((sheet) => sheet.name)).toEqual([]);
  });

  it('author no literal colour inside the forced-colours blocks themselves', () => {
    const offenders = sheets
      .map((sheet) => ({ sheet, inside: split(sheet.css).inside }))
      .filter(({ inside }) => /#[0-9a-fA-F]{3,8}\b|\brgba?\(/.test(inside))
      .map(({ sheet }) => sheet.name);
    expect(offenders).toEqual([]);
  });

  /*
   * The three signals `PRD.md` names as colour-only, each with the non-colour channel that now carries it.
   * Asserted here rather than in a component test because the channel *is* a declaration: a rule that
   * deletes the `border-bottom` from the mark would leave every DOM test green and the requirement unmet.
   */
  it('give each colour-only signal a second channel, and mean by it', () => {
    const viewer = code(sheets.find((s) => s.name === 'viewer.css')!.css);

    // A match carries a rule; the active one a ring; both survive a palette that forces the hue.
    const marked = viewer.match(/mark\.pjsr-mark\s*\{([^}]*)\}/)?.[1] ?? '';
    const active = viewer.match(/mark\.pjsr-mark--active\s*\{([^}]*)\}/)?.[1] ?? '';
    expect(marked).toMatch(/border-bottom:/);
    expect(active).toMatch(/outline:/);

    // An armed control gets the ring as well as the tint.
    const pressed = viewer.match(
      /\.pjsr-button:is\(\[aria-pressed='true'\][^{]*\)\s*\{([^}]*)\}/,
    )?.[1] ?? '';
    expect(pressed).toMatch(/border-color:/);

    // The selected tab thickens the underline it already has, instead of only recolouring it.
    const tab = viewer.match(/\.pjsr-sidebar-tab--active\s*\{([^}]*)\}/)?.[1] ?? '';
    expect(tab).toMatch(/border-bottom-width:/);

    /*
     * FR-44's third signal, and the one the clause names last: annotation highlights. A mark that arrived in
     * the file and a mark the reader is making now are two different layers with two different owners, so the
     * channel has to be on both — an edge that appears only after a reload is a channel for archaeologists.
     * Each is drawn from the theme's own foreground, which is what makes the forced-colours case need no rule
     * of its own: the sheet's `@media (forced-colors: active)` block re-points `--pjsr-fg` at `CanvasText`,
     * so the edge follows the palette instead of becoming a black ring on a black theme.
     */
    const display = viewer.match(/\.pjsr-annotation-layer section\.highlightAnnotation\s*\{([^}]*)\}/)?.[1] ?? '';
    const annotate = code(sheets.find((s) => s.name === 'annotate.css')!.css);
    const authored =
      annotate.match(/\.pjsr-editor-layer \.highlightEditor \.internal\s*\{([^}]*)\}/)?.[1] ?? '';
    expect(display).toMatch(/outline: 1px solid/);
    expect(authored).toMatch(/box-shadow: inset 0 0 0 1px/);
    expect(display).toContain('var(--pjsr-fg)');
    expect(authored).toContain('var(--pjsr-fg)');
  });
});
