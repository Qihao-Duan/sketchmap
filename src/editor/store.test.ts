import { describe, expect, it } from 'vitest';
import type { MindMap } from '../shared/types';
import { editorReducer as reduce, HISTORY_LIMIT, initEditor, type EditorState } from './store';

const base = (): MindMap => ({
  id: 'abcdefghijklmnopqrstu', title: 'Root', layout: 'map', version: 1, updatedAt: 't',
  root: { id: 'r', text: 'Root', children: [{ id: 'a', text: 'A', children: [{ id: 'a1', text: 'A1', children: [] }] }] },
});
const texts = (s: EditorState) => s.map.root.children.map((c) => c.text);

describe('editorReducer', () => {
  it('addChild creates an empty topic, selects it and opens it for editing', () => {
    let s = reduce(initEditor(base()), { type: 'select', id: 'a' });
    s = reduce(s, { type: 'addChild' });
    const created = s.map.root.children[0].children[1];
    expect(created.text).toBe('');
    expect(s.selectedId).toBe(created.id);
    expect(s.editing).toEqual({ id: created.id, isNew: true });
    expect(s.revision).toBe(1);
  });

  it('committing a new topic keeps one undo step; undo removes the topic entirely', () => {
    let s = reduce(initEditor(base()), { type: 'addSibling' }); // on root → child
    s = reduce(s, { type: 'commitEdit', text: 'B  ' });
    expect(texts(s)).toEqual(['A', 'B']);
    expect(s.past).toHaveLength(1);
    s = reduce(s, { type: 'undo' });
    expect(texts(s)).toEqual(['A']);
    s = reduce(s, { type: 'redo' });
    expect(texts(s)).toEqual(['A', 'B']);
  });

  it('an empty new topic disappears on commit or cancel and selection returns to the parent', () => {
    let s = reduce(reduce(initEditor(base()), { type: 'select', id: 'a' }), { type: 'addChild' });
    s = reduce(s, { type: 'commitEdit', text: '   ' });
    expect(s.map.root.children[0].children).toHaveLength(1);
    expect([s.selectedId, s.editing, s.past.length]).toEqual(['a', null, 0]);
    s = reduce(reduce(s, { type: 'addChild' }), { type: 'cancelEdit' });
    expect(s.map.root.children[0].children).toHaveLength(1);
  });

  it('editing an existing topic creates its own undo step; unchanged text creates none', () => {
    let s = reduce(initEditor(base()), { type: 'startEdit', id: 'a' });
    s = reduce(s, { type: 'commitEdit', text: 'A' });
    expect(s.past).toHaveLength(0);
    s = reduce(reduce(s, { type: 'startEdit', id: 'a' }), { type: 'commitEdit', text: 'Alpha' });
    expect([texts(s), s.past.length]).toEqual([['Alpha'], 1]);
  });

  it('delete selects the neighbour and ignores the root', () => {
    let s = reduce(initEditor(base()), { type: 'delete' });
    expect(s.map.root.children).toHaveLength(1);
    s = reduce(reduce(s, { type: 'select', id: 'a1' }), { type: 'delete' });
    expect(s.selectedId).toBe('a');
  });

  it('move and toggleFold are undoable; invalid ones change nothing', () => {
    let s = initEditor(base());
    expect(reduce(s, { type: 'move', id: 'a', targetId: 'a1' })).toBe(s);
    s = reduce(s, { type: 'toggleFold', id: 'a' });
    expect(s.map.root.children[0].collapsed).toBe(true);
    s = reduce(s, { type: 'undo' });
    expect(s.map.root.children[0].collapsed).toBeUndefined();
  });

  it('keeps at most HISTORY_LIMIT undo steps', () => {
    let s = initEditor(base());
    for (let i = 0; i < HISTORY_LIMIT + 5; i++) s = reduce(s, { type: 'toggleFold', id: 'a' });
    expect(s.past).toHaveLength(HISTORY_LIMIT);
  });

  it('serverSaved updates version fields only; replaceMap resets history', () => {
    let s = reduce(initEditor(base()), { type: 'toggleFold', id: 'a' });
    s = reduce(s, { type: 'serverSaved', map: { ...base(), version: 7, updatedAt: 'later', title: 'T' } });
    expect([s.map.version, s.map.updatedAt, s.map.title, s.past.length]).toEqual([7, 'later', 'T', 1]);
    expect(s.map.root.children[0].collapsed).toBe(true);
    const before = s.revision;
    s = reduce(s, { type: 'replaceMap', map: base(), dirty: false });
    expect([s.past.length, s.revision]).toEqual([0, before]);
    expect(reduce(s, { type: 'replaceMap', map: base(), dirty: true }).revision).toBe(before + 1);
  });
});
