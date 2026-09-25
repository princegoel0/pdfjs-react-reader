/**
 * Turning a document's optional-content groups into rows a panel can render.
 *
 * Deliberately engine-free: pdf.js exposes the layer tree through two methods on
 * a mutable config object (`getOrder()` and `getGroup()`), and `getOrder()` mixes
 * bare group ids with named bundles. Flattening that is the part worth testing,
 * and it is testable as a pure function over shapes.
 */

export interface OptionalContentGroupState {
  id: string;
  name: string;
  visible: boolean;
}

/** A named bundle in `getOrder()` — a heading in the layer tree, not a layer itself. */
export interface OptionalContentBundle {
  name?: string | null;
  order?: readonly OptionalContentOrderEntry[];
}

export type OptionalContentOrderEntry = string | OptionalContentBundle;

export type OptionalContentRow =
  | ({ kind: 'group'; depth: number } & OptionalContentGroupState)
  | { kind: 'section'; name: string; depth: number };

/** A `SetOCGState` action, in the shape pdf.js parses it into and consumes. */
export interface OcStateAction {
  /** `ON`, `OFF`, `Toggle` interleaved with group ids, e.g. `['ON', '10R']`. */
  state: readonly unknown[];
  preserveRB?: boolean;
}

/**
 * The parts of pdf.js's `OptionalContentConfig` this package touches.
 *
 * `OptionalContentConfig` is not an exported type, and the important fact about it
 * cannot be expressed in types anyway: `getOptionalContentConfig()` builds a **new
 * object on every call** from cached worker data. Mutating one instance therefore
 * changes nothing for a render that fetched its own — so exactly one instance has to
 * be shared by the panel, the annotation handler and every `page.render()`, which is
 * why the shell owns it rather than whoever wants to read the layers.
 */
export interface OptionalContentConfigHandle {
  /** From 5.7 onward the tree is behind accessors; older builds exposed plain fields. */
  getOrder?: () => readonly OptionalContentOrderEntry[];
  getGroup?: (id: string) => { name?: string; visible?: boolean } | null;
  order?: readonly OptionalContentOrderEntry[];
  groups?: readonly { id?: string; name?: string; visible?: boolean }[];
  setVisibility: (id: string, visible: boolean) => void;
  setOCGState: (action: { state: readonly unknown[]; preserveRB?: boolean }) => void;
}

/** pdf.js caps its own nested-order parsing at ten levels; a hand-built tree must not recurse further. */
const MAX_DEPTH = 10;

function isBundle(entry: OptionalContentOrderEntry): entry is OptionalContentBundle {
  return typeof entry === 'object' && entry !== null && Array.isArray(entry.order);
}

function groupState(id: string, groupOf: (id: string) => OptionalContentGroupState | null | undefined) {
  const group = groupOf(id);
  if (!group) return null;
  return { id: group.id, name: group.name, visible: group.visible };
}

/**
 * Walks the order tree in document order.
 *
 * A name in the order array is a bundle, not a group, so it becomes a heading row
 * and its children indent under it. An id the document never declared is dropped:
 * a toggle for a group that does not exist would move nothing the reader can see.
 */
export function flattenOptionalContent(
  order: readonly OptionalContentOrderEntry[] | null | undefined,
  groupOf: (id: string) => OptionalContentGroupState | null | undefined,
): OptionalContentRow[] {
  const rows: OptionalContentRow[] = [];

  const walk = (entries: readonly OptionalContentOrderEntry[], depth: number): void => {
    if (depth > MAX_DEPTH) return;
    for (const entry of entries) {
      if (typeof entry === 'string') {
        const group = groupState(entry, groupOf);
        if (group) rows.push({ kind: 'group', depth, ...group });
        continue;
      }
      if (!isBundle(entry)) continue;
      const name = typeof entry.name === 'string' ? entry.name.trim() : '';
      if (name) rows.push({ kind: 'section', name, depth });
      walk(entry.order ?? [], name ? depth + 1 : depth);
    }
  };

  walk(order ?? [], 0);
  return rows;
}

/** The ids a panel can switch, which is every group row in order. */
export function optionalContentGroupIds(rows: readonly OptionalContentRow[]): string[] {
  return rows.filter((row): row is Extract<OptionalContentRow, { kind: 'group' }> => row.kind === 'group').map((row) => row.id);
}
