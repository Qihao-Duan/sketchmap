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

  it('setLayout changes the layout as one undo step; the same layout is a no-op', () => {
    const s0 = initEditor(base());
    expect(reduce(s0, { type: 'setLayout', layout: 'map' })).toBe(s0);
    let s = reduce(s0, { type: 'setLayout', layout: 'org' });
    expect([s.map.layout, s.revision, s.past.length]).toEqual(['org', 1, 1]);
    s = reduce(s, { type: 'undo' });
    expect(s.map.layout).toBe('map');
  });

  it('pasteNodes adds topics under the selection, unfolds it, selects the first, one undo step', () => {
    let s = reduce(reduce(initEditor(base()), { type: 'toggleFold', id: 'a' }), { type: 'select', id: 'a' });
    const pasted = [{ id: 'p1', text: 'P1', children: [{ id: 'p11', text: 'P11', children: [] }] }, { id: 'p2', text: 'P2', children: [] }];
    s = reduce(s, { type: 'pasteNodes', nodes: pasted });
    const a = s.map.root.children[0];
    expect(a.collapsed).toBeUndefined();
    expect(a.children.map((c) => c.id)).toEqual(['a1', 'p1', 'p2']);
    expect(s.selectedId).toBe('p1');
    s = reduce(s, { type: 'undo' });
    expect(s.map.root.children[0].children.map((c) => c.id)).toEqual(['a1']);
    expect(reduce(s, { type: 'pasteNodes', nodes: [] })).toBe(s);
  });

  it('setLayout, pasteNodes and replaceRoot do nothing while a topic is being edited', () => {
    const s = reduce(initEditor(base()), { type: 'addChild' });
    expect(s.editing).not.toBeNull();
    expect(reduce(s, { type: 'setLayout', layout: 'org' })).toBe(s);
    expect(reduce(s, { type: 'pasteNodes', nodes: [{ id: 'p1', text: 'P1', children: [] }] })).toBe(s);
    expect(reduce(s, { type: 'replaceRoot', root: { id: 'nr', text: 'New', children: [] } })).toBe(s);
  });

  it('replaceRoot swaps the whole tree as one undo step', () => {
    let s = reduce(initEditor(base()), { type: 'replaceRoot', root: { id: 'nr', text: 'New', children: [] } });
    expect([s.map.root.text, s.selectedId, s.revision]).toEqual(['New', 'nr', 1]);
    expect(Object.isFrozen(s.map.root)).toBe(true);
    s = reduce(s, { type: 'undo' });
    expect(s.map.root.text).toBe('Root');
  });
});

describe('importance, priority, marker and note', () => {
  const sel = (id: string) => reduce(initEditor(base()), { type: 'select', id });
  const nodeA = (s: EditorState) => s.map.root.children[0];

  it('setEmphasis, setPriority and setMarker set and clear fields on the selected topic, one undo step each', () => {
    let s = sel('a');
    s = reduce(s, { type: 'setEmphasis', emphasis: 'key' });
    s = reduce(s, { type: 'setPriority', priority: 2 });
    s = reduce(s, { type: 'setMarker', emoji: '💡' });
    expect(nodeA(s)).toMatchObject({ emphasis: 'key', priority: 2, emoji: '💡' });
    expect(s.past).toHaveLength(3);
    s = reduce(s, { type: 'setPriority', priority: null });
    expect('priority' in nodeA(s)).toBe(false);
    s = reduce(s, { type: 'undo' });
    expect(nodeA(s).priority).toBe(2);
  });

  it('setting the value a topic already has changes nothing', () => {
    const s = sel('a');
    expect(reduce(s, { type: 'setEmphasis', emphasis: null })).toBe(s);
    expect(reduce(s, { type: 'setMarker', emoji: null })).toBe(s);
  });

  it('bumpEmphasis steps Aside ↔ Normal ↔ Highlight ↔ Key and stops at both ends', () => {
    let s = sel('a');
    const bump = (delta: 1 | -1) => (s = reduce(s, { type: 'bumpEmphasis', delta }));
    bump(1);
    expect(nodeA(s).emphasis).toBe('highlight');
    bump(1);
    expect(nodeA(s).emphasis).toBe('key');
    const top = s;
    bump(1);
    expect(s).toBe(top);
    bump(-1);
    bump(-1);
    expect('emphasis' in nodeA(s)).toBe(false);
    bump(-1);
    expect(nodeA(s).emphasis).toBe('aside');
    const bottom = s;
    bump(-1);
    expect(s).toBe(bottom);
  });

  it('note edits on one topic share one undo step until anything else happens', () => {
    let s = sel('a');
    s = reduce(s, { type: 'setNote', id: 'a', note: 'Re' });
    s = reduce(s, { type: 'setNote', id: 'a', note: 'Remember  ' });
    expect(nodeA(s).note).toBe('Remember');
    expect(s.past).toHaveLength(1);
    s = reduce(s, { type: 'select', id: 'r' });
    s = reduce(s, { type: 'setNote', id: 'a', note: 'Remember this' });
    expect(s.past).toHaveLength(2);
    s = reduce(s, { type: 'undo' });
    expect(nodeA(s).note).toBe('Remember');
    s = reduce(s, { type: 'undo' });
    expect('note' in nodeA(s)).toBe(false);
  });

  it('an empty note removes the field', () => {
    let s = reduce(sel('a'), { type: 'setNote', id: 'a', note: 'x' });
    s = reduce(s, { type: 'select', id: 'a' });
    s = reduce(s, { type: 'setNote', id: 'a', note: '  \n' });
    expect('note' in nodeA(s)).toBe(false);
  });

  it('does nothing while a topic is being edited', () => {
    const s = reduce(sel('a'), { type: 'addChild' });
    const actions = [
      { type: 'setEmphasis', emphasis: 'key' },
      { type: 'bumpEmphasis', delta: 1 },
      { type: 'setPriority', priority: 1 },
      { type: 'setMarker', emoji: '💡' },
      { type: 'setNote', id: 'a', note: 'x' },
    ] as const;
    for (const action of actions) expect(reduce(s, action)).toBe(s);
  });
});
