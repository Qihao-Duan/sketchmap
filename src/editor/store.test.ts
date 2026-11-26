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

describe('setImage and resizeImage', () => {
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

  it('resizeImage gives the image a new size and keeps its file, as one undo step', () => {
    let s = reduce(initEditor(base()), { type: 'setImage', id: 'a', image });
    s = reduce(s, { type: 'resizeImage', id: 'a', w: 260, h: 130 });
    expect(nodeA(s).image).toEqual({ ...image, w: 260, h: 130 });
    expect(s.past).toHaveLength(2);
    s = reduce(s, { type: 'undo' });
    expect(nodeA(s).image).toEqual(image);
    s = reduce(s, { type: 'redo' });
    expect(nodeA(s).image).toEqual({ ...image, w: 260, h: 130 });
  });

  it('resizeImage keeps both sides whole and within what a saved map may hold (16-2048px)', () => {
    let s = reduce(initEditor(base()), { type: 'setImage', id: 'a', image });
    s = reduce(s, { type: 'resizeImage', id: 'a', w: 260.4, h: 130.6 });
    expect(nodeA(s).image).toEqual({ ...image, w: 260, h: 131 });
    s = reduce(s, { type: 'resizeImage', id: 'a', w: 3, h: 5000 });
    expect(nodeA(s).image).toEqual({ ...image, w: 16, h: 2048 });
  });

  it('resizeImage changes the image when only one of its sides differs', () => {
    const s = reduce(initEditor(base()), { type: 'setImage', id: 'a', image });
    expect(nodeA(reduce(s, { type: 'resizeImage', id: 'a', w: 200, h: 120 })).image).toEqual({ ...image, w: 200, h: 120 });
    expect(nodeA(reduce(s, { type: 'resizeImage', id: 'a', w: 220, h: 100 })).image).toEqual({ ...image, w: 220, h: 100 });
  });

  it('resizeImage is a no-op for the same size, a size that is no number, without an image, for a topic that is gone, or while editing', () => {
    const s = reduce(initEditor(base()), { type: 'setImage', id: 'a', image });
    expect(reduce(s, { type: 'resizeImage', id: 'a', w: 200, h: 100 })).toBe(s);
    expect(reduce(s, { type: 'resizeImage', id: 'a', w: 200.2, h: 99.8 })).toBe(s);
    expect(reduce(s, { type: 'resizeImage', id: 'a', w: NaN, h: 100 })).toBe(s);
    expect(reduce(s, { type: 'resizeImage', id: 'a', w: 200, h: Infinity })).toBe(s);
    expect(reduce(s, { type: 'resizeImage', id: 'gone', w: 120, h: 60 })).toBe(s);
    const noImage = initEditor(base());
    expect(reduce(noImage, { type: 'resizeImage', id: 'a', w: 120, h: 60 })).toBe(noImage);
    const editing = reduce(s, { type: 'startEdit', id: 'a' });
    expect(reduce(editing, { type: 'resizeImage', id: 'a', w: 120, h: 60 })).toBe(editing);
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

describe('setWrap and stepWrap (where a topic’s text wraps)', () => {
  const nodeA = (s: EditorState) => s.map.root.children[0];
  const nodeA1 = (s: EditorState) => s.map.root.children[0].children[0];

  it('setWrap sets the width, as one undo step; null takes it away again', () => {
    let s = reduce(initEditor(base()), { type: 'setWrap', id: 'a1', wrap: 420 });
    expect(nodeA1(s).wrap).toBe(420);
    expect(s.past).toHaveLength(1);
    s = reduce(s, { type: 'setWrap', id: 'a1', wrap: null });
    expect('wrap' in nodeA1(s)).toBe(false);
    expect(s.past).toHaveLength(2);
    s = reduce(s, { type: 'undo' });
    expect(nodeA1(s).wrap).toBe(420);
    s = reduce(s, { type: 'undo' });
    expect('wrap' in nodeA1(s)).toBe(false);
  });

  it('setWrap keeps the width whole and within what a saved map may hold (60-1600px)', () => {
    const at = (wrap: number) => nodeA1(reduce(initEditor(base()), { type: 'setWrap', id: 'a1', wrap })).wrap;
    expect(at(420.4)).toBe(420);
    expect(at(420.5)).toBe(421);
    expect(at(3)).toBe(60);
    expect(at(-50)).toBe(60);
    expect(at(9000)).toBe(1600);
  });

  it('setWrap is a no-op for the same width, a width that is no number, automatic when it is that already, a topic that is gone, or while editing', () => {
    const fresh = initEditor(base());
    expect(reduce(fresh, { type: 'setWrap', id: 'a1', wrap: null })).toBe(fresh);
    expect(reduce(fresh, { type: 'setWrap', id: 'a1', wrap: NaN })).toBe(fresh);
    expect(reduce(fresh, { type: 'setWrap', id: 'a1', wrap: Infinity })).toBe(fresh);
    expect(reduce(fresh, { type: 'setWrap', id: 'gone', wrap: 420 })).toBe(fresh);
    const s = reduce(fresh, { type: 'setWrap', id: 'a1', wrap: 420 });
    expect(reduce(s, { type: 'setWrap', id: 'a1', wrap: 420 })).toBe(s);
    expect(reduce(s, { type: 'setWrap', id: 'a1', wrap: 420.3 })).toBe(s);
    const editing = reduce(s, { type: 'startEdit', id: 'a1' });
    expect(reduce(editing, { type: 'setWrap', id: 'a1', wrap: 300 })).toBe(editing);
    expect(reduce(editing, { type: 'setWrap', id: 'a1', wrap: null })).toBe(editing);
  });

  describe('stepWrap', () => {
    const measure = (t: string, size: number) => t.length * size * 0.5;
    /** 24 words: enough for a step to move words to other lines at every level. */
    const long = Array.from({ length: 24 }, () => 'word').join(' ');
    /** A map with long texts on `a` and `a1`, and a third topic, `b`, with one short word. */
    const wordy = (layout: MindMap['layout'] = 'map'): MindMap => ({
      ...base(), layout,
      root: { id: 'r', text: long, children: [
        { id: 'a', text: long, children: [{ id: 'a1', text: long, children: [] }] },
        { id: 'b', text: 'Short', children: [] },
      ] },
    });
    const nodeB = (s: EditorState) => s.map.root.children[1];
    const press = (s: EditorState, id: string, step: 'wider' | 'narrower' | 'auto') => reduce(s, { type: 'stepWrap', id, step, measure });
    const sel = (id: string, layout?: MindMap['layout']) => reduce(initEditor(wordy(layout)), { type: 'select', id });

    it('goes a step wider or narrower from the width that goes with the topic’s level', () => {
      // Central topic 300, main branch 230, deeper 250; in an org chart, deeper 200.
      expect(press(sel('r'), 'r', 'wider').map.root.wrap).toBe(380);
      expect(nodeA(press(sel('a'), 'a', 'wider')).wrap).toBe(290);
      expect(nodeA1(press(sel('a1'), 'a1', 'wider')).wrap).toBe(310);
      expect(nodeA1(press(sel('a1'), 'a1', 'narrower')).wrap).toBe(200);
      expect(nodeA1(press(sel('a1', 'org'), 'a1', 'wider')).wrap).toBe(250);
    });

    it('goes on from a width set before, back to where it came from, and is one undo step each time', () => {
      let s = sel('a1');
      s = press(s, 'a1', 'wider');
      s = press(s, 'a1', 'wider');
      expect(nodeA1(s).wrap).toBe(390);
      s = press(s, 'a1', 'narrower');
      expect(nodeA1(s).wrap).toBe(310);
      expect(s.past).toHaveLength(3);
      s = reduce(s, { type: 'undo' });
      expect(nodeA1(s).wrap).toBe(390);
    });

    it('a step that would move no word to another line changes nothing: no width that does not show is kept', () => {
      const s = sel('b');
      expect(press(s, 'b', 'narrower')).toBe(s);
      expect(press(s, 'b', 'wider')).toBe(s);
    });

    it('to automatic takes the width away; with none set it changes nothing', () => {
      const fresh = sel('a1');
      expect(press(fresh, 'a1', 'auto')).toBe(fresh);
      const s = press(press(fresh, 'a1', 'wider'), 'a1', 'auto');
      expect('wrap' in nodeA1(s)).toBe(false);
      expect(s.past).toHaveLength(2);
    });

    it('with several topics selected, each goes from its own width, as one undo step; a topic it would not show on is left alone', () => {
      let s = reduce(initEditor(wordy()), { type: 'setWrap', id: 'a1', wrap: 390 });
      s = reduce(s, { type: 'selectMany', ids: ['a', 'a1', 'b'] });
      const before = s.past.length;
      s = press(s, s.selectedId!, 'wider');
      expect([nodeA(s).wrap, nodeA1(s).wrap]).toEqual([290, 490]);
      expect('wrap' in nodeB(s)).toBe(false);
      expect(s.past).toHaveLength(before + 1);
      s = press(s, s.selectedId!, 'auto');
      expect(['wrap' in nodeA(s), 'wrap' in nodeA1(s)]).toEqual([false, false]);
      s = reduce(s, { type: 'undo' });
      expect([nodeA(s).wrap, nodeA1(s).wrap]).toEqual([290, 490]);
    });

    it('on a topic that is not the current one changes only that topic, and nothing while editing or for a topic that is gone', () => {
      const many = reduce(initEditor(wordy()), { type: 'selectMany', ids: ['a', 'a1'] });
      const other = many.selectedId === 'a' ? 'a1' : 'a';
      const s = press(many, other, 'wider');
      expect([nodeA(s).wrap, nodeA1(s).wrap].filter((w) => w !== undefined)).toHaveLength(1);
      expect(press(many, 'gone', 'wider')).toBe(many);
      const editing = reduce(initEditor(wordy()), { type: 'startEdit', id: 'a1' });
      expect(press(editing, 'a1', 'wider')).toBe(editing);
    });
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

  it('selectMany drops unknown ids and repeats; with none left, nothing is selected', () => {
    let s = start(['a', 'a', 'nope', 'b']);
    expect(selectedIds(s)).toEqual(['a', 'b']);
    s = reduce(s, { type: 'selectMany', ids: [] });
    expect(s.selectedId).toBeNull();
    expect(selectedIds(s)).toEqual([]);
    expect(reduce(start(['a', 'b']), { type: 'selectMany', ids: ['nope'] }).selectedId).toBeNull();
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

  it('a map loaded with a side on only some main branches has the others written down at once, so the first change cannot move them', () => {
    const mixed = wide();
    mixed.root.children[0].side = 'right';
    mixed.root.children[1].side = 'left';
    let s = initEditor(mixed);
    expect(s.map.root.children.map((c) => `${c.id}:${c.side}`)).toEqual(['a:right', 'b:left', 'c:left']);
    expect(s.revision).toBe(0);
    s = reduce(reduce(s, { type: 'select', id: 'b' }), { type: 'delete' });
    expect(s.map.root.children.map((c) => `${c.id}:${c.side}`)).toEqual(['a:right', 'c:left']);
    // a map with all sides, or none, is taken as it is
    const plain = wide();
    expect(initEditor(plain).map).toBe(plain);
    expect(reduce(s, { type: 'replaceMap', map: mixed, dirty: false }).map.root.children.map((c) => c.side)).toEqual(['right', 'left', 'left']);
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
    s = reduce(s, { type: 'setPriority', id: s.selectedId!, priority: 2 });
    s = reduce(s, { type: 'setEmphasis', id: s.selectedId!, emphasis: 'key' });
    s = reduce(s, { type: 'setMarker', id: s.selectedId!, emoji: MARKERS[0] });
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
    s = reduce(s, { type: 'setPriority', id: s.selectedId!, priority: 1 });
    expect(reduce(s, { type: 'setPriority', id: s.selectedId!, priority: 1 })).toBe(s);
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
    const created = s.selectedId!;
    s = reduce(s, { type: 'selectMany', ids: [created, 'b', 'c'] });
    expect(selectedIds(s)).toEqual([created, 'b', 'c']);
    s = reduce(s, { type: 'undo' });
    expect(selectedIds(s)).toEqual(['b', 'c']);
    s = reduce(s, { type: 'redo' });
    expect(selectedIds(s)).toEqual(['b', 'c']);
  });

  describe('with nothing selected (a click on the background)', () => {
    const none = (map = wide()) => reduce(reduce(initEditor(map), { type: 'select', id: 'a' }), { type: 'selectMany', ids: [] });

    it('selecting nothing changes neither the map nor its history, and doing it again changes nothing', () => {
      const before = reduce(initEditor(wide()), { type: 'select', id: 'a' });
      const s = reduce(before, { type: 'selectMany', ids: [] });
      expect([s.selectedId, s.extraIds]).toEqual([null, []]);
      expect([s.map, s.revision, s.past]).toEqual([before.map, 0, []]);
      expect(reduce(s, { type: 'selectMany', ids: [] })).toBe(s);
    });

    it('Tab, Enter, Delete, a fold, an edit, Alt ↑ and a paste have no topic to act on: nothing changes', () => {
      const s = none();
      const pasted = [{ id: 'p', text: 'P', children: [] }];
      for (const action of [
        { type: 'addChild' }, { type: 'addSibling' }, { type: 'delete' }, { type: 'toggleFold' }, { type: 'startEdit' },
        { type: 'bumpEmphasis', delta: 1 }, { type: 'pasteNodes', nodes: pasted },
      ] as const) {
        expect(reduce(s, action), action.type).toBe(s);
      }
    });

    it('a click on a topic, a Shift-click, a box and select-all select again', () => {
      expect(selectedIds(reduce(none(), { type: 'select', id: 'b' }))).toEqual(['b']);
      const shift = reduce(none(), { type: 'toggleSelect', id: 'b' });
      expect([shift.selectedId, shift.extraIds]).toEqual(['b', []]);
      expect(selectedIds(reduce(none(), { type: 'selectMany', ids: ['b', 'c'] }))).toEqual(['b', 'c']);
    });

    it('an action that names its topic still works: a fold from the canvas, a double-click edit, a drag', () => {
      expect(node(reduce(none(), { type: 'toggleFold', id: 'a' }), 'a').collapsed).toBe(true);
      const edit = reduce(none(), { type: 'startEdit', id: 'b' });
      expect([edit.selectedId, edit.editing]).toEqual(['b', { id: 'b', isNew: false }]);
      const moved = reduce(none(), { type: 'move', id: 'c', targetId: 'a' });
      expect(kids(moved, 'a')).toEqual(['a1', 'a2', 'c']);
      expect(selectedIds(moved)).toEqual(['c']);
    });

    it('undo and redo change the map and still select nothing', () => {
      let s = reduce(reduce(initEditor(wide()), { type: 'select', id: 'b' }), { type: 'delete' });
      s = reduce(s, { type: 'selectMany', ids: [] });
      s = reduce(s, { type: 'undo' });
      expect(kids(s, 'r')).toEqual(['a', 'b', 'c']);
      expect(s.selectedId).toBeNull();
      s = reduce(s, { type: 'redo' });
      expect(kids(s, 'r')).toEqual(['a', 'c']);
      expect(s.selectedId).toBeNull();
    });

    it('a new map loaded in its place starts on the central topic again', () => {
      expect(selectedIds(reduce(none(), { type: 'replaceMap', map: wide(), dirty: false }))).toEqual(['r']);
    });
  });
});
