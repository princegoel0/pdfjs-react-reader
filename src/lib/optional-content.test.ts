/*
 * FR-24: an optional-content group is a state the whole render shares, not a copy a panel mutates. The order it
 * flattens into and the ids it exposes are asserted here, where the engine's per-call config cannot hide a
 * divergence between what the panel shows and what the page draws.
 */
import { describe, expect, it } from 'vitest';
import { flattenOptionalContent, optionalContentGroupIds } from './optional-content';
import type { OptionalContentGroupState, OptionalContentOrderEntry } from './optional-content';

const GROUPS: Record<string, OptionalContentGroupState> = {
  '8R': { id: '8R', name: 'Heading layer', visible: true },
  '9R': { id: '9R', name: 'Body layer', visible: true },
  '10R': { id: '10R', name: 'Stamp layer', visible: false },
};

const groupOf = (id: string) => GROUPS[id] ?? null;

describe('flattenOptionalContent', () => {
  it('reads a flat list of ids in document order', () => {
    expect(flattenOptionalContent(['8R', '9R', '10R'], groupOf)).toEqual([
      { kind: 'group', depth: 0, ...GROUPS['8R'] },
      { kind: 'group', depth: 0, ...GROUPS['9R'] },
      { kind: 'group', depth: 0, ...GROUPS['10R'] },
    ]);
  });

  it('keeps visibility as the engine reported it rather than assuming on', () => {
    const rows = flattenOptionalContent(['8R', '10R'], groupOf);
    expect(rows.map((row) => row.kind === 'group' && row.visible)).toEqual([true, false]);
  });

  it('turns a named bundle into a heading and indents its children', () => {
    const order: OptionalContentOrderEntry[] = [
      '8R',
      { name: 'Watermarks', order: ['10R', '9R'] },
    ];
    expect(flattenOptionalContent(order, groupOf)).toEqual([
      { kind: 'group', depth: 0, ...GROUPS['8R'] },
      { kind: 'section', name: 'Watermarks', depth: 0 },
      { kind: 'group', depth: 1, ...GROUPS['10R'] },
      { kind: 'group', depth: 1, ...GROUPS['9R'] },
    ]);
  });

  it('walks an unnamed bundle without inventing a heading', () => {
    const order: OptionalContentOrderEntry[] = [{ name: null, order: ['8R'] }];
    expect(flattenOptionalContent(order, groupOf)).toEqual([
      { kind: 'group', depth: 0, ...GROUPS['8R'] },
    ]);
  });

  it('nests bundles recursively', () => {
    const order: OptionalContentOrderEntry[] = [
      { name: 'A', order: [{ name: 'B', order: ['8R'] }] },
    ];
    expect(flattenOptionalContent(order, groupOf)).toEqual([
      { kind: 'section', name: 'A', depth: 0 },
      { kind: 'section', name: 'B', depth: 1 },
      { kind: 'group', depth: 2, ...GROUPS['8R'] },
    ]);
  });

  it('drops an id the document never declared', () => {
    // A toggle for a group that does not exist would move nothing the reader can see.
    expect(flattenOptionalContent(['8R', '99R'], groupOf)).toHaveLength(1);
  });

  it('stops at the depth pdf.js itself stops at', () => {
    let order: OptionalContentOrderEntry = '8R';
    for (let level = 0; level < 14; level++) order = { name: `L${level}`, order: [order] };
    const rows = flattenOptionalContent([order], groupOf);
    expect(rows.some((row) => row.kind === 'group')).toBe(false);
  });

  it('tolerates an empty or missing order', () => {
    expect(flattenOptionalContent([], groupOf)).toEqual([]);
    expect(flattenOptionalContent(null, groupOf)).toEqual([]);
    expect(flattenOptionalContent(undefined, groupOf)).toEqual([]);
  });

  it('ignores entries that are neither an id nor a bundle', () => {
    const order = ['8R', null, 7, {}, { name: 'X', order: null }] as unknown as OptionalContentOrderEntry[];
    expect(flattenOptionalContent(order, groupOf)).toEqual([
      { kind: 'group', depth: 0, ...GROUPS['8R'] },
    ]);
  });
});

describe('optionalContentGroupIds', () => {
  it('lists group rows only, skipping headings', () => {
    const rows = flattenOptionalContent(['8R', { name: 'S', order: ['10R'] }], groupOf);
    expect(optionalContentGroupIds(rows)).toEqual(['8R', '10R']);
  });
});
