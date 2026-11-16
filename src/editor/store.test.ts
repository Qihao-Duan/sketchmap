import { describe, expect, it } from 'vitest';
import { MARKERS, type MindMap } from '../shared/types';
import { editorReducer as reduce, HISTORY_LIMIT, initEditor, selectedIds, type EditorState } from './store';

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
    s = reduce(s, { type: 'setEmphasis', id: 'a', emphasis: 'key' });
    s = reduce(s, { type: 'setPriority', id: 'a', priority: 2 });
    s = reduce(s, { type: 'setMarker', id: 'a', emoji: '💡' });
    expect(nodeA(s)).toMatchObject({ emphasis: 'key', priority: 2, emoji: '💡' });
    expect(s.past).toHaveLength(3);
    s = reduce(s, { type: 'setPriority', id: 'a', priority: null });
    expect('priority' in nodeA(s)).toBe(false);
    s = reduce(s, { type: 'undo' });
    expect(nodeA(s).priority).toBe(2);
  });

  it('setting the value a topic already has changes nothing', () => {
    const s = sel('a');
    expect(reduce(s, { type: 'setEmphasis', id: 'a', emphasis: null })).toBe(s);
    expect(reduce(s, { type: 'setMarker', id: 'a', emoji: null })).toBe(s);
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

  it('acts on the topic it names, and does nothing once that topic is gone', () => {
    let s = sel('a');
    s = reduce(s, { type: 'setMarker', id: 'a1', emoji: '💡' });
    expect(s.map.root.children[0].children[0].emoji).toBe('💡');
    expect(reduce(s, { type: 'setEmphasis', id: 'gone', emphasis: 'key' })).toBe(s);
  });

  it('does nothing while a topic is being edited', () => {
    const s = reduce(sel('a'), { type: 'addChild' });
    const actions = [
      { type: 'setEmphasis', id: 'a', emphasis: 'key' },
      { type: 'bumpEmphasis', delta: 1 },
      { type: 'setPriority', id: 'a', priority: 1 },
      { type: 'setMarker', id: 'a', emoji: '💡' },
      { type: 'setNote', id: 'a', note: 'x' },
    ] as const;
    for (const action of actions) expect(reduce(s, action)).toBe(s);
  });
});

describe('setLink', () => {
  it('links a whole topic, removes the link with null, one undo step each; no change changes nothing', () => {
    let s = initEditor(base());
    s = reduce(s, { type: 'setLink', id: 'a', href: 'https://a.com' });
    expect(s.map.root.children[0].text).toBe('[A](https://a.com)');
    s = reduce(s, { type: 'setLink', id: 'a', href: null });
    expect(s.map.root.children[0].text).toBe('A');
    expect(s.past).toHaveLength(2);
    expect(reduce(s, { type: 'setLink', id: 'a', href: null })).toBe(s);
    expect(reduce(s, { type: 'setLink', id: 'gone', href: 'https://a.com' })).toBe(s);
  });
});

describe('setImage and setImageSize', () => {
  const nodeA = (s: EditorState) => s.map.root.children[0];
  const image = { key: 'img/abcdefghijklmnopqrstu/a.png', w: 200, h: 100 };

  it('setImage sets the image, null removes it, and undo restores it', () => {
    let s = initEditor(base());
    s = reduce(s, { type: 'setImage', id: 'a', image });
    expect(nodeA(s).image).toEqual(image);
    expect(s.past).toHaveLength(1);
    s = reduce(s, { type: 'setImage', id: 'a', image: null });
    expect(nodeA(s).image).toBeUndefined();
    expect(s.past).toHaveLength(2);
    s = reduce(s, { type: 'undo' });
    expect(nodeA(s).image).toEqual(image);
  });

  it('setImage is a no-op while editing, for the same value, and for a topic that no longer exists', () => {
    const s = reduce(initEditor(base()), { type: 'setImage', id: 'a', image });
    expect(reduce(s, { type: 'setImage', id: 'a', image })).toBe(s);
    expect(reduce(s, { type: 'setImage', id: 'gone', image })).toBe(s);
    const editing = reduce(s, { type: 'startEdit', id: 'a' });
    expect(reduce(editing, { type: 'setImage', id: 'a', image: null })).toBe(editing);
  });

  it('setImageSize scales a 200x100 image to each size, keeping the aspect ratio, as one undo step', () => {
    let s = reduce(initEditor(base()), { type: 'setImage', id: 'a', image });
    s = reduce(s, { type: 'setImageSize', id: 'a', size: 'S' });
    expect(nodeA(s).image).toEqual({ ...image, w: 120, h: 60 });
    expect(s.past).toHaveLength(2);
    s = reduce(s, { type: 'setImageSize', id: 'a', size: 'L' });
    expect(nodeA(s).image).toEqual({ ...image, w: 300, h: 150 });
  });

  it('setImageSize is a no-op for the same size, without an image, or while editing', () => {
    let s = reduce(initEditor(base()), { type: 'setImage', id: 'a', image });
    s = reduce(s, { type: 'setImageSize', id: 'a', size: 'M' });
    expect(reduce(s, { type: 'setImageSize', id: 'a', size: 'M' })).toBe(s);
    const noImage = initEditor(base());
    expect(reduce(noImage, { type: 'setImageSize', id: 'a', size: 'S' })).toBe(noImage);
    const editing = reduce(s, { type: 'startEdit', id: 'a' });
    expect(reduce(editing, { type: 'setImageSize', id: 'a', size: 'S' })).toBe(editing);
  });

  it('commitEdit with empty text on an existing topic keeps it when it has an image, clearing its text as one undo step; a topic without an image keeps today’s behaviour (ignored)', () => {
    let s = reduce(initEditor(base()), { type: 'setImage', id: 'a', image });
    s = reduce(s, { type: 'startEdit', id: 'a' });
    s = reduce(s, { type: 'commitEdit', text: '  ' });
    expect(nodeA(s).text).toBe('');
    expect(nodeA(s).image).toEqual(image);
    expect(s.past).toHaveLength(2);
    expect(s.editing).toBeNull();

    let t = reduce(initEditor(base()), { type: 'startEdit', id: 'a' });
    t = reduce(t, { type: 'commitEdit', text: '  ' });
    expect(nodeA(t).text).toBe('A');
    expect(t.past).toHaveLength(0);
    expect(t.editing).toBeNull();
  });
});

describe('selecting several topics', () => {
  const wide = (): MindMap => ({
    ...base(),
    root: {
      id: 'r', text: 'Root', children: [
        { id: 'a', text: 'A', children: [{ id: 'a1', text: 'A1', children: [] }, { id: 'a2', text: 'A2', children: [] }] },
        { id: 'b', text: 'B', children: [] },
        { id: 'c', text: 'C', children: [] },
      ],
    },
  });
  const start = (ids: string[], map = wide()) => reduce(initEditor(map), { type: 'selectMany', ids });
  const node = (s: EditorState, id: string) => {
    const walk = (n: MindMap['root']): MindMap['root'] | null => (n.id === id ? n : n.children.map(walk).find(Boolean) ?? null);
    return walk(s.map.root)!;
  };
  const kids = (s: EditorState, id: string) => node(s, id).children.map((c) => c.id);

  it('starts with the central topic alone', () => {
    expect(selectedIds(initEditor(wide()))).toEqual(['r']);
  });

  it('selectMany selects the topics given; the current topic stays the current one when it is among them', () => {
    let s = reduce(initEditor(wide()), { type: 'select', id: 'b' });
    s = reduce(s, { type: 'selectMany', ids: ['a', 'b', 'c'] });
    expect(selectedIds(s)).toEqual(['b', 'a', 'c']);
    s = reduce(s, { type: 'selectMany', ids: ['a1', 'a2'] });
    expect(selectedIds(s)).toEqual(['a1', 'a2']);
  });

  it('selectMany drops unknown ids and repeats; with none left, only the current topic stays selected', () => {
    let s = start(['a', 'a', 'nope', 'b']);
    expect(selectedIds(s)).toEqual(['a', 'b']);
    s = reduce(s, { type: 'selectMany', ids: [] });
    expect(selectedIds(s)).toEqual(['a']);
    expect(reduce(s, { type: 'selectMany', ids: ['nope'] })).toBe(s);
  });

  it('selectMany returns the same state when the selection is already that', () => {
    const s = start(['a', 'b']);
    expect(reduce(s, { type: 'selectMany', ids: ['a', 'b'] })).toBe(s);
  });

  it('toggleSelect adds a topic, which becomes the current one, and takes a topic out again', () => {
    let s = reduce(initEditor(wide()), { type: 'select', id: 'a' });
    s = reduce(s, { type: 'toggleSelect', id: 'c' });
    expect(selectedIds(s)).toEqual(['c', 'a']);
    s = reduce(s, { type: 'toggleSelect', id: 'b' });
    expect(selectedIds(s)).toEqual(['b', 'c', 'a']);
    s = reduce(s, { type: 'toggleSelect', id: 'c' });
    expect(selectedIds(s)).toEqual(['b', 'a']);
    s = reduce(s, { type: 'toggleSelect', id: 'b' });
    expect(selectedIds(s)).toEqual(['a']);
  });

  it('toggleSelect leaves the last selected topic selected, and ignores unknown ids', () => {
    const s = reduce(initEditor(wide()), { type: 'select', id: 'a' });
    expect(reduce(s, { type: 'toggleSelect', id: 'a' })).toBe(s);
    expect(reduce(s, { type: 'toggleSelect', id: 'nope' })).toBe(s);
  });

  it('delete removes every selected branch as one undo step', () => {
    let s = start(['a1', 'b']);
    s = reduce(s, { type: 'delete' });
    expect(kids(s, 'r')).toEqual(['a', 'c']);
    expect(kids(s, 'a')).toEqual(['a2']);
    expect(selectedIds(s)).toEqual(['a2']);
    expect(s.past).toHaveLength(1);
    s = reduce(s, { type: 'undo' });
    expect(s.map).toEqual(wide());
  });

  it('delete keeps the central topic when it is part of the selection', () => {
    let s = start(['r', 'b']);
    s = reduce(s, { type: 'delete' });
    expect(kids(s, 'r')).toEqual(['a', 'c']);
    expect(selectedIds(s)).toEqual(['c']);
    const only = start(['r']);
    expect(reduce(only, { type: 'delete' })).toBe(only);
  });

  it('move takes the whole selection along when the dragged topic is part of it', () => {
    let s = start(['a1', 'b']);
    s = reduce(s, { type: 'move', id: 'b', targetId: 'c' });
    expect(kids(s, 'c')).toEqual(['a1', 'b']);
    expect(kids(s, 'a')).toEqual(['a2']);
    expect(selectedIds(s)).toEqual(['b', 'a1']);
    expect(s.past).toHaveLength(1);
  });

  it('move takes only the dragged topic when it is not part of the selection', () => {
    let s = start(['a1', 'a2']);
    s = reduce(s, { type: 'move', id: 'b', targetId: 'c' });
    expect(kids(s, 'c')).toEqual(['b']);
    expect(kids(s, 'a')).toEqual(['a1', 'a2']);
    expect(selectedIds(s)).toEqual(['b']);
  });

  it('move refuses a target inside the selection and changes nothing', () => {
    const s = start(['a', 'c']);
    expect(reduce(s, { type: 'move', id: 'c', targetId: 'a1' })).toBe(s);
  });

  it('move puts the dragged topic just before or after another one, as one undo step', () => {
    let s = start(['c']);
    s = reduce(s, { type: 'move', id: 'c', targetId: 'a', where: 'before' });
    expect(kids(s, 'r')).toEqual(['c', 'a', 'b']);
    s = reduce(s, { type: 'move', id: 'c', targetId: 'a1', where: 'after' });
    expect(kids(s, 'a')).toEqual(['a1', 'c', 'a2']);
    expect(s.past).toHaveLength(2);
    s = reduce(reduce(s, { type: 'undo' }), { type: 'undo' });
    expect(kids(s, 'r')).toEqual(['a', 'b', 'c']);
  });

  it('move to where the topic already is changes nothing and leaves no undo step', () => {
    const s = start(['b']);
    expect(reduce(s, { type: 'move', id: 'b', targetId: 'a', where: 'after' })).toBe(s);
    expect(reduce(s, { type: 'move', id: 'c', targetId: 'r' })).toBe(s);
  });

  it('move onto a side fixes the side of every main branch as shown, in the same undo step', () => {
    let s = start(['a']);
    s = reduce(s, { type: 'move', id: 'a', targetId: 'c', where: 'after', side: 'left', shown: { a: 'right', b: 'right', c: 'left' } });
    expect(s.map.root.children.map((c) => `${c.id}:${c.side}`)).toEqual(['b:right', 'c:left', 'a:left']);
    expect(s.past).toHaveLength(1);
    s = reduce(s, { type: 'undo' });
    expect(s.map.root.children.map((c) => `${c.id}:${c.side ?? '-'}`)).toEqual(['a:-', 'b:-', 'c:-']);
  });

  it('move with `alone` takes only the current topic and keeps the selection as it is', () => {
    let s = start(['c', 'a1']);
    s = reduce(s, { type: 'move', id: 'c', targetId: 'b', where: 'before', alone: true });
    expect(kids(s, 'r')).toEqual(['a', 'c', 'b']);
    expect(kids(s, 'a')).toEqual(['a1', 'a2']);
    expect(selectedIds(s)).toEqual(['c', 'a1']);
  });

  it('with the sides fixed, a new main branch gets its side when it is made, and loses nothing on undo', () => {
    let s = start(['a']);
    s = reduce(s, { type: 'move', id: 'a', targetId: 'r', side: 'left', shown: { a: 'right', b: 'right', c: 'left' } });
    expect(s.map.root.children.map((c) => `${c.id}:${c.side}`)).toEqual(['b:right', 'c:left', 'a:left']);
    s = reduce(reduce(s, { type: 'select', id: 'b' }), { type: 'addSibling' });
    s = reduce(s, { type: 'commitEdit', text: 'New' });
    expect(s.map.root.children.map((c) => `${c.text}:${c.side}`)).toEqual(['B:right', 'New:right', 'C:left', 'A:left']);
    s = reduce(reduce(s, { type: 'select', id: 'r' }), { type: 'addChild' });
    s = reduce(s, { type: 'commitEdit', text: 'Last' });
    expect(s.map.root.children.map((c) => `${c.text}:${c.side}`)).toEqual(['B:right', 'New:right', 'C:left', 'A:left', 'Last:right']);
  });

  it('with the sides fixed, a main branch that arrives without a side takes one for good: it stays when the branch before it goes', () => {
    let s = start(['a']);
    s = reduce(s, { type: 'move', id: 'a', targetId: 'r', side: 'left', shown: { a: 'right', b: 'right', c: 'left' } });
    const main = () => s.map.root.children.map((c) => `${c.text}:${c.side ?? '-'}`);
    expect(main()).toEqual(['B:right', 'C:left', 'A:left']);
    // pasted on the central topic: after A, so on the left
    s = reduce(reduce(s, { type: 'select', id: 'r' }), { type: 'pasteNodes', nodes: [{ id: 'p1', text: 'P1', children: [] }, { id: 'p2', text: 'P2', children: [] }] });
    expect(main()).toEqual(['B:right', 'C:left', 'A:left', 'P1:left', 'P2:left']);
    // a topic from deeper in the map, dropped on the central topic in a layout without sides: after P2
    s = reduce(s, { type: 'move', id: 'a1', targetId: 'r' });
    expect(main()).toEqual(['B:right', 'C:left', 'A:left', 'P1:left', 'P2:left', 'A1:left']);
    // the branches before them go: nothing changes sides
    s = reduce(reduce(s, { type: 'selectMany', ids: ['c', 'a'] }), { type: 'delete' });
    expect(main()).toEqual(['B:right', 'P1:left', 'P2:left', 'A1:left']);
    s = reduce(reduce(s, { type: 'select', id: 'b' }), { type: 'delete' });
    expect(main()).toEqual(['P1:left', 'P2:left', 'A1:left']);
    // and each of these was one undo step
    s = reduce(reduce(reduce(reduce(s, { type: 'undo' }), { type: 'undo' }), { type: 'undo' }), { type: 'undo' });
    expect(main()).toEqual(['B:right', 'C:left', 'A:left']);
  });

  it('a map whose sides are automatic gets no sides from changes that place nothing by hand', () => {
    let s = start(['r']);
    s = reduce(s, { type: 'pasteNodes', nodes: [{ id: 'p1', text: 'P1', children: [] }] });
    s = reduce(s, { type: 'move', id: 'a1', targetId: 'r' });
    s = reduce(s, { type: 'move', id: 'c', targetId: 'a', where: 'before' });
    expect(s.map.root.children.every((c) => c.side === undefined)).toBe(true);
  });

  it('importance, priority and marker set on the current topic go to the whole selection, one undo step each', () => {
    let s = start(['a1', 'b']);
    s = reduce(s, { type: 'setPriority', id: s.selectedId, priority: 2 });
    s = reduce(s, { type: 'setEmphasis', id: s.selectedId, emphasis: 'key' });
    s = reduce(s, { type: 'setMarker', id: s.selectedId, emoji: MARKERS[0] });
    for (const id of ['a1', 'b']) expect(node(s, id)).toMatchObject({ priority: 2, emphasis: 'key', emoji: MARKERS[0] });
    expect(node(s, 'c').priority).toBeUndefined();
    expect(s.past).toHaveLength(3);
    expect(selectedIds(s)).toEqual(['a1', 'b']);
    s = reduce(s, { type: 'undo' });
    for (const id of ['a1', 'b']) expect(node(s, id).emoji).toBeUndefined();
    expect(selectedIds(s)).toEqual(['a1', 'b']);
  });

  it('setting what every selected topic already has changes nothing', () => {
    let s = start(['a1', 'b']);
    s = reduce(s, { type: 'setPriority', id: s.selectedId, priority: 1 });
    expect(reduce(s, { type: 'setPriority', id: s.selectedId, priority: 1 })).toBe(s);
  });

  it('a change aimed at a topic other than the current one touches only that topic', () => {
    let s = start(['a1', 'b']);
    s = reduce(s, { type: 'setPriority', id: 'c', priority: 3 });
    expect(node(s, 'c').priority).toBe(3);
    expect(node(s, 'a1').priority).toBeUndefined();
    expect(node(s, 'b').priority).toBeUndefined();
  });

  it('Alt ↑ raises each selected topic from its own level, as one undo step', () => {
    const map = wide();
    map.root.children[0].children[0].emphasis = 'aside';
    let s = start(['a1', 'b'], map);
    s = reduce(s, { type: 'bumpEmphasis', delta: 1 });
    expect(node(s, 'a1').emphasis).toBeUndefined();
    expect(node(s, 'b').emphasis).toBe('highlight');
    expect(s.past).toHaveLength(1);
  });

  it('selecting one topic, adding a topic, editing and pasting all go back to a single selected topic', () => {
    expect(selectedIds(reduce(start(['a', 'b']), { type: 'select', id: 'c' }))).toEqual(['c']);
    expect(selectedIds(reduce(start(['a', 'b']), { type: 'select', id: 'a' }))).toEqual(['a']);
    expect(selectedIds(reduce(start(['a', 'b']), { type: 'addChild' }))).toHaveLength(1);
    expect(selectedIds(reduce(start(['a', 'b']), { type: 'addSibling' }))).toHaveLength(1);
    expect(selectedIds(reduce(start(['a', 'b']), { type: 'startEdit' }))).toEqual(['a']);
    expect(selectedIds(reduce(start(['a', 'b']), { type: 'pasteNodes', nodes: [{ id: 'p', text: 'P', children: [] }] }))).toEqual(['p']);
  });

  it('folding a branch takes the topics it hides out of the selection, so nothing unseen is deleted or moved', () => {
    let s = start(['a1', 'b', 'c']);
    s = reduce(s, { type: 'toggleFold', id: 'a' });
    expect(selectedIds(s)).toEqual(['b', 'c']);
    s = reduce(s, { type: 'delete' });
    expect(kids(s, 'r')).toEqual(['a']);
    expect(kids(s, 'a')).toEqual(['a1', 'a2']);
  });

  it('when a fold hides every selected topic, the folded topic becomes the selected one', () => {
    let s = reduce(initEditor(wide()), { type: 'select', id: 'a1' });
    s = reduce(s, { type: 'toggleFold', id: 'a' });
    expect(selectedIds(s)).toEqual(['a']);
    s = reduce(start(['a1', 'a2']), { type: 'toggleFold', id: 'a' });
    expect(selectedIds(s)).toEqual(['a']);
  });

  it('an undo that folds a branch again also takes its topics out of the selection', () => {
    const map = wide();
    map.root.children[0].collapsed = true;
    let s = reduce(initEditor(map), { type: 'toggleFold', id: 'a' }); // unfolded
    s = reduce(s, { type: 'selectMany', ids: ['a2', 'b'] });
    s = reduce(s, { type: 'undo' }); // folded again
    expect(selectedIds(s)).toEqual(['b']);
  });

  it('undo keeps the selected topics that still exist', () => {
    let s = reduce(reduce(initEditor(wide()), { type: 'select', id: 'a' }), { type: 'addChild' });
    s = reduce(s, { type: 'commitEdit', text: 'New' });
    const created = s.selectedId;
    s = reduce(s, { type: 'selectMany', ids: [created, 'b', 'c'] });
    expect(selectedIds(s)).toEqual([created, 'b', 'c']);
    s = reduce(s, { type: 'undo' });
    expect(selectedIds(s)).toEqual(['b', 'c']);
    s = reduce(s, { type: 'redo' });
    expect(selectedIds(s)).toEqual(['b', 'c']);
  });
});
