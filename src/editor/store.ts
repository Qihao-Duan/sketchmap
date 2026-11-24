import { produce } from 'immer';
import { displaySize, IMAGE_SIZES } from '../io/imagePrep';
import { linkWhole } from '../shared/rich';
import type { BranchSide, Emphasis, LayoutKind, MapNode, MindMap } from '../shared/types';
import * as T from '../model/tree';

export const HISTORY_LIMIT = 200;

export interface EditorState {
  map: MindMap;
  /**
   * The current topic: the one keys, the Details panel and a paste act on. An existing topic, or null while
   * nothing is selected (after a click on the background): then those have no topic to act on.
   */
  selectedId: string | null;
  /** The other topics of a multi-selection (a box, Shift-click, select all). Never holds `selectedId`; empty while that is null. */
  extraIds: readonly string[];
  editing: { id: string; isNew: boolean } | null;
  past: MindMap[];
  future: MindMap[];
  /** Goes up on every user change to `map`; autosave watches it. */
  revision: number;
  /** `note:<id>` while consecutive note edits on that topic share one undo step. */
  lastEdit?: string;
}

export type EditorAction =
  | { type: 'select'; id: string }
  | { type: 'toggleSelect'; id: string }
  | { type: 'selectMany'; ids: readonly string[] }
  | { type: 'addChild' }
  | { type: 'addSibling' }
  | { type: 'delete' }
  | { type: 'toggleFold'; id?: string }
  | { type: 'startEdit'; id?: string }
  | { type: 'commitEdit'; text: string }
  | { type: 'cancelEdit' }
  /**
   * `where`: onto the target (its last child; the default), or just before or after it. `side` / `shown`:
   * see `MoveTo` in the model. `alone`: move only this topic, even when it is one of several selected ones
   * (the keyboard), and leave the selection as it is.
   */
  | { type: 'move'; id: string; targetId: string; where?: T.Place; side?: BranchSide; shown?: Readonly<Record<string, BranchSide>>; alone?: boolean }
  | { type: 'undo' }
  | { type: 'redo' }
  | { type: 'serverSaved'; map: MindMap }
  | { type: 'replaceMap'; map: MindMap; dirty: boolean }
  | { type: 'setLayout'; layout: LayoutKind }
  | { type: 'pasteNodes'; nodes: MapNode[] }
  | { type: 'replaceRoot'; root: MapNode }
  | { type: 'setEmphasis'; id: string; emphasis: Emphasis | null }
  | { type: 'bumpEmphasis'; delta: 1 | -1 }
  | { type: 'setPriority'; id: string; priority: 1 | 2 | 3 | null }
  | { type: 'setMarker'; id: string; emoji: string | null }
  | { type: 'setNote'; id: string; note: string }
  | { type: 'setLink'; id: string; href: string | null }
  | { type: 'setImage'; id: string; image: { key: string; w: number; h: number } | null }
  | { type: 'setImageSize'; id: string; size: 'S' | 'M' | 'L' };

/** One shared empty list, so "no multi-selection" never looks like a change. */
const NONE: readonly string[] = [];

export function initEditor(map: MindMap): EditorState {
  // A map saved with a side on only some main branches: the others get theirs written down before any
  // change, so that the first change (removing the branch before them, say) cannot move them. Not a
  // change of the user's: nothing is saved for it.
  const settled = produce(map, (d) => void T.settleSides(d.root));
  return { map: settled, selectedId: map.root.id, extraIds: NONE, editing: null, past: [], future: [], revision: 0 };
}

/** Every selected topic, the current one first; none while nothing is selected. */
export function selectedIds(state: Pick<EditorState, 'selectedId' | 'extraIds'>): string[] {
  return state.selectedId === null ? [] : [state.selectedId, ...state.extraIds];
}

/** The topics a change made to `id` applies to: the whole selection when `id` is the current topic. */
function targetsOf(state: EditorState, id: string): Set<string> {
  return new Set(id === state.selectedId ? selectedIds(state) : [id]);
}

/**
 * After the map changed underneath (undo, redo): the selected topics that still exist, or the root. With
 * nothing selected, nothing is selected afterwards either.
 */
function survivingSelection(map: MindMap, state: EditorState): Pick<EditorState, 'selectedId' | 'extraIds'> {
  if (state.selectedId === null) return { selectedId: null, extraIds: NONE };
  if (!state.extraIds.length) return { selectedId: keepSelection(map, state.selectedId), extraIds: NONE };
  const wanted = new Set(selectedIds(state));
  const found = new Set<string>();
  T.eachNode(map.root, (n) => void (wanted.has(n.id) && found.add(n.id)));
  const [first, ...rest] = selectedIds(state).filter((id) => found.has(id));
  return { selectedId: first ?? map.root.id, extraIds: rest.length ? rest : NONE };
}

function commit(state: EditorState, next: MindMap, patch: Partial<EditorState> = {}): EditorState {
  const past = [...state.past, state.map].slice(-HISTORY_LIMIT);
  // A main branch that arrived without a side (pasted, moved in) keeps the one it is shown on from now on.
  const settled = produce(next, (d) => void T.settleSides(d.root));
  return { ...state, ...patch, map: settled, past, future: [], revision: state.revision + 1 };
}

/** Throws away a just-created topic by restoring the map from before it existed. */
function dropNewTopic(state: EditorState): EditorState {
  const prev = state.past[state.past.length - 1];
  const f = state.editing ? T.findNode(state.map.root, state.editing.id) : null;
  if (!prev) return { ...state, editing: null };
  return {
    ...state, map: prev, past: state.past.slice(0, -1), editing: null,
    selectedId: f?.parent?.id ?? prev.root.id, extraIds: NONE, revision: state.revision + 1,
  };
}

function keepSelection(map: MindMap, id: string): string {
  return T.findNode(map.root, id) ? id : map.root.id;
}

/** Every topic hidden inside a folded branch, mapped to the outermost folded topic that hides it. */
function hiddenBy(root: MapNode): Map<string, string> {
  const out = new Map<string, string>();
  const walk = (node: MapNode, hider: string | null) => {
    const h = hider ?? (node.collapsed ? node.id : null);
    for (const child of node.children) {
      if (h) out.set(child.id, h);
      walk(child, h);
    }
  };
  walk(root, null);
  return out;
}

/**
 * A selection never rests on a topic that a fold hides, so Delete or a drag can't reach a topic nobody
 * sees. Hidden topics leave the selection; if that empties it, the folded topic above the current one
 * becomes the selected one.
 */
function onlyVisible(state: EditorState): EditorState {
  const hidden = hiddenBy(state.map.root);
  const all = selectedIds(state);
  if (!all.some((id) => hidden.has(id))) return state;
  const [first, ...rest] = all.filter((id) => !hidden.has(id));
  if (first === undefined) return { ...state, selectedId: hidden.get(all[0])!, extraIds: NONE };
  return { ...state, selectedId: first, extraIds: rest.length ? rest : NONE };
}

/** Importance from lowest to highest; undefined is Normal. */
const IMPORTANCE: ReadonlyArray<Emphasis | undefined> = ['aside', undefined, 'highlight', 'key'];

type Decoration = 'emphasis' | 'priority' | 'emoji';

/**
 * Sets or clears one decoration, as one undo step: on `id`, or on every selected topic when `id` is the
 * current one. Topics that no longer exist, or already have the value, are left alone.
 */
function decorate<K extends Decoration>(state: EditorState, id: string, field: K, value: (node: MapNode) => NonNullable<MapNode[K]> | null): EditorState {
  if (state.editing) return state;
  const targets = targetsOf(state, id);
  let changed = false;
  const next = produce(state.map, (d) => {
    T.eachNode(d.root, (node) => {
      if (!targets.has(node.id)) return;
      const v = value(node);
      if ((node[field] ?? null) === v) return;
      changed = true;
      if (v === null) delete node[field];
      else (node as MapNode)[field] = v as MapNode[K];
    });
  });
  return changed ? commit(state, next) : state;
}

function reduce(state: EditorState, action: EditorAction): EditorState {
  switch (action.type) {
    case 'select':
      return T.findNode(state.map.root, action.id) ? { ...state, selectedId: action.id, extraIds: NONE } : state;

    case 'toggleSelect': {
      if (!T.findNode(state.map.root, action.id)) return state;
      const all = selectedIds(state);
      // A topic that joins becomes the current one; the old current one stays selected behind it.
      if (!all.includes(action.id)) return { ...state, selectedId: action.id, extraIds: all.length ? all : NONE };
      if (all.length === 1) return state;
      const [first, ...rest] = all.filter((id) => id !== action.id);
      return { ...state, selectedId: first, extraIds: rest.length ? rest : NONE };
    }

    case 'selectMany': {
      const wanted = new Set(action.ids);
      const found = new Set<string>();
      T.eachNode(state.map.root, (n) => void (wanted.has(n.id) && found.add(n.id)));
      const ids = [...wanted].filter((id) => found.has(id));
      // A box that touches nothing, or a click on the background: nothing is selected.
      const selectedId = state.selectedId !== null && ids.includes(state.selectedId) ? state.selectedId : ids[0] ?? null;
      const extra = ids.filter((id) => id !== selectedId);
      const same = selectedId === state.selectedId && extra.length === state.extraIds.length && extra.every((id, i) => id === state.extraIds[i]);
      return same ? state : { ...state, selectedId, extraIds: extra.length ? extra : NONE };
    }

    case 'addChild':
    case 'addSibling': {
      const at = state.selectedId;
      if (at === null) return state;
      const created = T.newNode();
      let ok = false;
      const next = produce(state.map, (d) => {
        ok = action.type === 'addChild' ? T.addChild(d.root, at, created) : T.addSiblingAfter(d.root, at, created);
      });
      return ok ? commit(state, next, { selectedId: created.id, extraIds: NONE, editing: { id: created.id, isNew: true } }) : state;
    }

    case 'delete': {
      const current = state.selectedId;
      if (current === null) return state;
      let nextSel: string | null = null;
      const next = produce(state.map, (d) => {
        nextSel = T.removeNodes(d.root, selectedIds(state), current);
      });
      return nextSel ? commit(state, next, { selectedId: nextSel, extraIds: NONE, editing: null }) : state;
    }

    case 'toggleFold': {
      const id = action.id ?? state.selectedId;
      if (id === null) return state;
      let ok = false;
      const next = produce(state.map, (d) => {
        ok = T.toggleCollapsed(d.root, id);
      });
      return ok ? commit(state, next) : state;
    }

    case 'startEdit': {
      const id = action.id ?? state.selectedId;
      if (id === null) return state;
      return T.findNode(state.map.root, id) ? { ...state, selectedId: id, extraIds: NONE, editing: { id, isNew: false } } : state;
    }

    case 'commitEdit': {
      const ed = state.editing;
      if (!ed) return state;
      const text = action.text.replace(/\s+$/, '');
      if (!text.trim()) {
        if (ed.isNew) return dropNewTopic(state);
        // An existing topic that carries an image is never empty: clear its text instead of ignoring the commit,
        // so it becomes an image-only topic. A topic without an image keeps today's behaviour (ignored).
        const found = T.findNode(state.map.root, ed.id);
        if (!found?.node.image || found.node.text === '') return { ...state, editing: null };
        const cleared = produce(state.map, (d) => {
          T.setText(d.root, ed.id, '');
        });
        return commit(state, cleared, { editing: null });
      }
      const current = T.findNode(state.map.root, ed.id);
      if (!current || current.node.text === text) return { ...state, editing: null };
      const next = produce(state.map, (d) => {
        T.setText(d.root, ed.id, text);
      });
      // A new topic already has the undo step from addChild/addSibling: fold the text into it.
      if (ed.isNew) return { ...state, map: next, editing: null, revision: state.revision + 1 };
      return commit(state, next, { editing: null });
    }

    case 'cancelEdit':
      return state.editing?.isNew ? dropNewTopic(state) : { ...state, editing: null };

    case 'move': {
      // Dragging one topic of a multi-selection takes the whole selection along; any other topic moves alone.
      const all = selectedIds(state);
      const group = !action.alone && all.length > 1 && all.includes(action.id) ? all : [action.id];
      let ok = false;
      const next = produce(state.map, (d) => {
        ok = T.moveNodes(d.root, group, action.targetId, { where: action.where, side: action.side, shown: action.shown });
      });
      if (!ok) return state;
      if (action.alone) return commit(state, next);
      const rest = group.filter((id) => id !== action.id);
      return commit(state, next, { selectedId: action.id, extraIds: rest.length ? rest : NONE });
    }

    case 'setLayout':
      if (state.editing) return state;
      return state.map.layout === action.layout ? state : commit(state, { ...state.map, layout: action.layout });

    case 'pasteNodes': {
      if (state.editing) return state;
      const under = state.selectedId;
      if (!action.nodes.length || under === null || !T.findNode(state.map.root, under)) return state;
      const next = produce(state.map, (d) => {
        const f = T.findNode(d.root, under)!;
        delete f.node.collapsed;
        f.node.children.push(...action.nodes);
      });
      return commit(state, next, { selectedId: action.nodes[0].id, extraIds: NONE, editing: null });
    }

    case 'replaceRoot':
      if (state.editing) return state;
      return commit(
        state,
        produce(state.map, (d) => {
          d.root = action.root;
        }),
        { selectedId: action.root.id, extraIds: NONE, editing: null },
      );

    case 'setEmphasis':
      return decorate(state, action.id, 'emphasis', () => action.emphasis);

    case 'bumpEmphasis':
      if (state.selectedId === null) return state;
      // Each selected topic moves one step from its own level.
      return decorate(state, state.selectedId, 'emphasis', (node) => {
        const j = Math.max(0, Math.min(IMPORTANCE.length - 1, IMPORTANCE.indexOf(node.emphasis) + action.delta));
        return IMPORTANCE[j] ?? null;
      });

    case 'setPriority':
      return decorate(state, action.id, 'priority', () => action.priority);

    case 'setMarker':
      return decorate(state, action.id, 'emoji', () => action.emoji);

    case 'setNote': {
      if (state.editing) return state;
      const note = action.note.replace(/\s+$/, '');
      const f = T.findNode(state.map.root, action.id);
      if (!f || (f.node.note ?? '') === note) return state;
      const next = produce(state.map, (d) => {
        const node = T.findNode(d.root, action.id)!.node;
        if (note) node.note = note;
        else delete node.note;
      });
      const session = `note:${action.id}`;
      // The note box dispatches at every pause in typing; one typing session on one topic is one undo step.
      if (state.lastEdit === session) return { ...state, map: next, future: [], revision: state.revision + 1 };
      return { ...commit(state, next), lastEdit: session };
    }

    case 'setLink': {
      if (state.editing) return state;
      const f = T.findNode(state.map.root, action.id);
      if (!f) return state;
      const text = linkWhole(f.node.text, action.href);
      if (text === f.node.text || text.length > 5000) return state;
      return commit(state, produce(state.map, (d) => void T.setText(d.root, action.id, text)));
    }

    case 'setImage': {
      if (state.editing) return state;
      const f = T.findNode(state.map.root, action.id);
      if (!f) return state;
      const current = f.node.image ?? null;
      const img = action.image;
      const same = current === img || (current !== null && img !== null && current.key === img.key && current.w === img.w && current.h === img.h);
      if (same) return state;
      const next = produce(state.map, (d) => {
        const node = T.findNode(d.root, action.id)!.node;
        if (img === null) delete node.image;
        else node.image = img;
      });
      return commit(state, next);
    }

    case 'setImageSize': {
      if (state.editing) return state;
      const img = T.findNode(state.map.root, action.id)?.node.image;
      if (!img) return state;
      const resized = displaySize(img.w, img.h, IMAGE_SIZES[action.size]);
      if (resized.w === img.w) return state;
      const next = produce(state.map, (d) => {
        const node = T.findNode(d.root, action.id)!.node;
        node.image = { ...node.image!, ...resized };
      });
      return commit(state, next);
    }

    case 'undo': {
      const prev = state.past[state.past.length - 1];
      if (!prev) return state;
      return {
        ...state, map: prev, past: state.past.slice(0, -1), future: [state.map, ...state.future],
        editing: null, ...survivingSelection(prev, state), revision: state.revision + 1,
      };
    }

    case 'redo': {
      const next = state.future[0];
      if (!next) return state;
      return {
        ...state, map: next, past: [...state.past, state.map].slice(-HISTORY_LIMIT), future: state.future.slice(1),
        editing: null, ...survivingSelection(next, state), revision: state.revision + 1,
      };
    }

    case 'serverSaved':
      return {
        ...state,
        map: { ...state.map, version: action.map.version, updatedAt: action.map.updatedAt, title: action.map.title },
      };

    case 'replaceMap':
      return { ...initEditor(action.map), revision: state.revision + (action.dirty ? 1 : 0) };
  }
}

export function editorReducer(state: EditorState, action: EditorAction): EditorState {
  const reduced = reduce(state, action);
  // Only a change to the topics can fold a branch over the selection (a fold, an undo, a redo).
  const next = reduced.map.root === state.map.root ? reduced : onlyVisible(reduced);
  // Anything except another note edit (or a save echo) ends a note-typing session.
  if (next.lastEdit === undefined || action.type === 'setNote' || action.type === 'serverSaved') return next;
  return { ...next, lastEdit: undefined };
}
