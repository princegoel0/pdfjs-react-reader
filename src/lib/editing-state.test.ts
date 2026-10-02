/*
 * FR-29 depends on this mapping: the editor manager reports six keys and a resting state, and the annotate
 * feature offers a tool only when the engine says that tool can be persisted. Getting a name wrong here turns a
 * working editor into a silently disabled control.
 */
import { describe, expect, it } from 'vitest';
import {
  HIGHLIGHT_COLORS,
  HIGHLIGHT_PALETTE_STRING,
  readEditingParams,
  readEditingState,
} from './editing-state';

const RESTING = {
  isEditing: false,
  isEmpty: true,
  canUndo: false,
  canRedo: false,
  canDelete: false,
  hasSelectedText: false,
};

describe('readEditingState', () => {
  it('maps the six keys the manager reports, by their engine names', () => {
    expect(
      readEditingState({
        isEditing: true,
        isEmpty: false,
        hasSomethingToUndo: true,
        hasSomethingToRedo: false,
        hasSelectedEditor: true,
        hasSelectedText: false,
      }),
    ).toEqual({
      isEditing: true,
      isEmpty: false,
      canUndo: true,
      canRedo: false,
      canDelete: true,
      hasSelectedText: false,
    });
  });

  it('reports the resting state for a payload that says nothing', () => {
    expect(readEditingState(undefined)).toEqual(RESTING);
    expect(readEditingState(null)).toEqual(RESTING);
    expect(readEditingState({})).toEqual(RESTING);
    expect(readEditingState('nonsense')).toEqual(RESTING);
  });

  it('defaults isEmpty to true, because an untouched document is the common case', () => {
    // The manager only starts reporting `isEmpty` once editing begins, so a payload
    // without it is a document nobody has touched yet.
    expect(readEditingState({ isEditing: true }).isEmpty).toBe(true);
    expect(readEditingState({ isEmpty: false }).isEmpty).toBe(false);
  });

  it('keeps canUndo distinct from isEmpty, which is the trap in offering Save', () => {
    // Undo the last mark and the editor list is empty again while the storage still
    // holds the change. The state that means "there is something to save" is canUndo;
    // a host that reads isEmpty instead loses edits on close.
    expect(
      readEditingState({ isEditing: true, isEmpty: true, hasSomethingToUndo: true }),
    ).toMatchObject({ isEmpty: true, canUndo: true });
  });

  it('treats only a selected editor as deletable', () => {
    // `hasSelectedText` is true the moment a reader drags across words, and deleting
    // then would remove nothing the viewer could point at.
    expect(readEditingState({ hasSelectedText: true }).canDelete).toBe(false);
    expect(readEditingState({ hasSelectedEditor: true }).canDelete).toBe(true);
  });
});

describe('readEditingParams', () => {
  it('reads the colour out of the [type, value] pairs the manager dispatches', () => {
    expect(readEditingParams([[31, '#FF0093'], [32, 3]])).toEqual({
      color: '#FF0093',
      thickness: 3,
    });
  });

  it('ignores every parameter this viewer does not surface', () => {
    expect(readEditingParams([[11, 24], [12, '#FF0000']])).toEqual({
      color: null,
      thickness: null,
    });
  });

  it('survives a payload that is not a pair list at all', () => {
    expect(readEditingParams(undefined)).toEqual({ color: null, thickness: null });
    expect(readEditingParams({ type: 31, value: '#000000' })).toEqual({
      color: null,
      thickness: null,
    });
  });
});

describe('the highlight palette', () => {
  it('gives every colour a value the browser can paint', () => {
    // The regression this guards is silent: `FFFF00` is valid input to the manager's
    // parser and invalid as a paint, and an invalid `fill` resolves by inheritance to
    // black — so a reader got a black bar over their text instead of a highlight.
    for (const { name, color } of HIGHLIGHT_COLORS) {
      expect(/^#[0-9A-F]{6}$/.test(color), `${name}=${color}`).toBe(true);
    }
  });

  it('builds the string form the manager wants: NAME=#RRGGBB pairs', () => {
    // Asserted on the produced string rather than on the array above, because the
    // failure this guards is the join dropping or mangling a `#` — which pdf.js's
    // parser accepts and the browser then paints black.
    const pairs = HIGHLIGHT_PALETTE_STRING.split(',');
    expect(pairs).toHaveLength(HIGHLIGHT_COLORS.length);
    for (const pair of pairs) expect(pair, pair).toMatch(/^[A-Za-z]+=[#][0-9A-F]{6}$/);
  });
});
