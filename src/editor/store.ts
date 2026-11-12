import { produce } from 'immer';
import type { LayoutKind, MapNode, MindMap } from '../shared/types';
import * as T from '../model/tree';

export const HISTORY_LIMIT = 200;

export interface EditorState {
  map: MindMap;
  selectedId: string;
  editing: { id: string; isNew: boolean } | null;
  past: MindMap[];
  future: MindMap[];
  /** Goes up on every user change to `map`; autosave watches it. */
  revision: number;
}

export type EditorAction =
  | { type: 'select'; id: string }
  | { type: 'addChild' }
  | { type: 'addSibling' }
  | { type: 'delete' }
  | { type: 'toggleFold'; id?: string }
  | { type: 'startEdit'; id?: string }
  | { type: 'commitEdit'; text: string }
  | { type: 'cancelEdit' }
  | { type: 'move'; id: string; targetId: string }
  | { type: 'undo' }
  | { type: 'redo' }
  | { type: 'serverSaved'; map: MindMap }
  | { type: 'replaceMap'; map: MindMap; dirty: boolean }
  | { type: 'setLayout'; layout: LayoutKind }
  | { type: 'pasteNodes'; nodes: MapNode[] }
  | { type: 'replaceRoot'; root: MapNode };

export function initEditor(map: MindMap): EditorState {
  return { map, selectedId: map.root.id, editing: null, past: [], future: [], revision: 0 };
}

function commit(state: EditorState, next: MindMap, patch: Partial<EditorState> = {}): EditorState {
  const past = [...state.past, state.map].slice(-HISTORY_LIMIT);
  return { ...state, ...patch, map: next, past, future: [], revision: state.revision + 1 };
}

/** Throws away a just-created topic by restoring the map from before it existed. */
function dropNewTopic(state: EditorState): EditorState {
  const prev = state.past[state.past.length - 1];
  const f = state.editing ? T.findNode(state.map.root, state.editing.id) : null;
  if (!prev) return { ...state, editing: null };
  return {
    ...state, map: prev, past: state.past.slice(0, -1), editing: null,
    selectedId: f?.parent?.id ?? prev.root.id, revision: state.revision + 1,
  };
}

function keepSelection(map: MindMap, id: string): string {
  return T.findNode(map.root, id) ? id : map.root.id;
}

export function editorReducer(state: EditorState, action: EditorAction): EditorState {
  switch (action.type) {
    case 'select':
      return T.findNode(state.map.root, action.id) ? { ...state, selectedId: action.id } : state;

    case 'addChild':
    case 'addSibling': {
      const created = T.newNode();
      let ok = false;
      const next = produce(state.map, (d) => {
        ok = action.type === 'addChild'
          ? T.addChild(d.root, state.selectedId, created)
          : T.addSiblingAfter(d.root, state.selectedId, created);
      });
      return ok ? commit(state, next, { selectedId: created.id, editing: { id: created.id, isNew: true } }) : state;
    }

    case 'delete': {
      let nextSel: string | null = null;
      const next = produce(state.map, (d) => {
        nextSel = T.removeNode(d.root, state.selectedId);
      });
      return nextSel ? commit(state, next, { selectedId: nextSel, editing: null }) : state;
    }

    case 'toggleFold': {
      const id = action.id ?? state.selectedId;
      let ok = false;
      const next = produce(state.map, (d) => {
        ok = T.toggleCollapsed(d.root, id);
      });
      return ok ? commit(state, next) : state;
    }

    case 'startEdit': {
      const id = action.id ?? state.selectedId;
      return T.findNode(state.map.root, id) ? { ...state, selectedId: id, editing: { id, isNew: false } } : state;
    }

    case 'commitEdit': {
      const ed = state.editing;
      if (!ed) return state;
      const text = action.text.replace(/\s+$/, '');
      if (!text.trim()) return ed.isNew ? dropNewTopic(state) : { ...state, editing: null };
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
      let ok = false;
      const next = produce(state.map, (d) => {
        ok = T.moveNode(d.root, action.id, action.targetId);
      });
      return ok ? commit(state, next, { selectedId: action.id }) : state;
    }

    case 'setLayout':
      if (state.editing) return state;
      return state.map.layout === action.layout ? state : commit(state, { ...state.map, layout: action.layout });

    case 'pasteNodes': {
      if (state.editing) return state;
      if (!action.nodes.length || !T.findNode(state.map.root, state.selectedId)) return state;
      const next = produce(state.map, (d) => {
        const f = T.findNode(d.root, state.selectedId)!;
        delete f.node.collapsed;
        f.node.children.push(...action.nodes);
      });
      return commit(state, next, { selectedId: action.nodes[0].id, editing: null });
    }

    case 'replaceRoot':
      if (state.editing) return state;
      return commit(
        state,
        produce(state.map, (d) => {
          d.root = action.root;
        }),
        { selectedId: action.root.id, editing: null },
      );

    case 'undo': {
      const prev = state.past[state.past.length - 1];
      if (!prev) return state;
      return {
        ...state, map: prev, past: state.past.slice(0, -1), future: [state.map, ...state.future],
        editing: null, selectedId: keepSelection(prev, state.selectedId), revision: state.revision + 1,
      };
    }

    case 'redo': {
      const next = state.future[0];
      if (!next) return state;
      return {
        ...state, map: next, past: [...state.past, state.map].slice(-HISTORY_LIMIT), future: state.future.slice(1),
        editing: null, selectedId: keepSelection(next, state.selectedId), revision: state.revision + 1,
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
