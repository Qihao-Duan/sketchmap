// @ts-expect-error -- `jsdom` ships no type declarations in this project; used only to borrow its `window.DOMParser`.
import { JSDOM } from 'jsdom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MapNode } from '../shared/types';
import { makeZip } from '../test/zipFixture';
import { fromXmindJson, fromXmindXml, importXmind, readXmindResources, XmindError } from './xmind';

const shape = (n: MapNode): unknown => ({ t: n.text, c: n.children.map(shape) });
// Shaped like real XMind 2020+ content.json (see the plan's evidence section); the content is made up.
const sheet = (rootTopic: object, extra: object = {}) => ({ id: 's1', class: 'sheet', title: 'Sheet 1', rootTopic, ...extra });
const content = [
  sheet(
    {
      id: 'r', class: 'topic', title: 'Plan [draft]', structureClass: 'org.xmind.ui.org-chart.down',
      children: {
        attached: [
          {
            id: 'a', title: 'Site', href: 'https://example.com/plan', notes: { plain: { content: 'Call Ana\n' } },
            markers: [{ markerId: 'priority-4' }, { markerId: 'star-red' }, { markerId: 'people-blue' }],
            branch: 'folded', labels: ['x'],
            children: { attached: [{ id: 'a1', title: 'Hidden child' }] },
          },
          { id: 'b', title: 'Spec', href: 'xmind:#a', image: { src: 'xap:resources/abc.png' }, markers: [{ markerId: 'c_symbol_money' }] },
        ],
        detached: [{ id: 'f', title: 'Floating', children: { attached: [{ id: 'f1', title: 'Under it' }] } }],
        summary: [{ id: 'm', title: 'Summary' }],
      },
      boundaries: [{ id: 'bd', range: '(0,1)' }],
    },
    { relationships: [{ id: 'r1' }, { id: 'r2' }] },
  ),
  sheet({ id: 'r2', title: 'Second sheet' }),
];

describe('fromXmindJson', () => {
  it('keeps titles, attached children, notes, http links, fold state, priority and a mapped marker', () => {
    const got = fromXmindJson(content);
    expect(got.layout).toBe('org');
    expect(shape(got.root)).toEqual({
      t: 'Plan \\[draft\\]',
      c: [
        { t: '[Site](https://example.com/plan)', c: [{ t: 'Hidden child', c: [] }] },
        { t: 'Spec', c: [] },
        { t: 'Floating', c: [{ t: 'Under it', c: [] }] },
      ],
    });
    const a = got.root.children[0];
    expect(a).toMatchObject({ note: 'Call Ana', priority: 3, emoji: '⭐', collapsed: true });
    expect(got.root.children[1]).not.toHaveProperty('priority');
    expect(got.topics).toBe(6);
    expect(got.root.id).toMatch(/^[A-Za-z0-9_-]{10}$/);
    // 'b' (Spec) carries `image: { src: 'xap:resources/abc.png' }`: a non-SVG resource, recorded for upload.
    expect(got.images).toEqual([{ nodeId: got.root.children[1].id, resource: 'resources/abc.png' }]);
  });

  it('lists what it could not bring over', () => {
    expect(fromXmindJson(content).dropped).toEqual([
      '1 more sheet',
      '2 relationships',
      '1 boundary',
      '1 summary topic',
      '1 label',
      '2 other markers',
      '1 link to another topic or file',
    ]);
    expect(fromXmindJson(content).changed).toEqual(['1 floating topic attached to the root']);
  });

  it('records non-SVG image resources for upload, and drops SVG resources as unsupported', () => {
    const got = fromXmindJson([sheet({
      id: 'r',
      title: 'R',
      children: {
        attached: [
          { id: 'a', title: 'A', image: { src: 'xap:resources/a.png' } },
          { id: 'b', title: 'B', image: { src: 'xap:resources/b.svg' } },
        ],
      },
    })]);
    expect(got.images).toEqual([{ nodeId: got.root.children[0].id, resource: 'resources/a.png' }]);
    expect(got.dropped).toEqual(['1 SVG image (not supported)']);
  });

  it('keeps numeric width/height recorded on an image resource, ignoring non-numeric ones', () => {
    const got = fromXmindJson([sheet({
      id: 'r',
      title: 'R',
      children: {
        attached: [
          { id: 'a', title: 'A', image: { src: 'xap:resources/a.png', width: 120, height: 80.5 } },
          { id: 'b', title: 'B', image: { src: 'xap:resources/b.png', width: 'nope' } },
        ],
      },
    })]);
    expect(got.images).toEqual([
      { nodeId: got.root.children[0].id, resource: 'resources/a.png', width: 120, height: 80.5 },
      { nodeId: got.root.children[1].id, resource: 'resources/b.png' },
    ]);
  });

  it('caps recorded images at 100, counting the rest', () => {
    const many = Array.from({ length: 105 }, (_, i) => ({ id: `t${i}`, title: 'x', image: { src: `xap:resources/${i}.png` } }));
    const got = fromXmindJson([sheet({ id: 'r', title: 'R', children: { attached: many } })]);
    expect(got.images).toHaveLength(100);
    expect(got.dropped).toEqual(['5 images not imported (over 100)']);
  });

  it('ignores an image whose src is not a xap:resources/ string', () => {
    const got = fromXmindJson([sheet({ id: 'r', title: 'R', children: { attached: [
      { id: 'a', title: 'A', image: { src: 'http://example.com/a.png' } },
      { id: 'b', title: 'B', image: 'not an object' },
      { id: 'c', title: 'C', image: {} },
    ] } })]);
    expect(got.images).toEqual([]);
    expect(got.dropped).toEqual([]);
  });

  it('maps the layout and caps priority at ③', () => {
    expect(fromXmindJson([sheet({ id: 'r', title: 'R', structureClass: 'org.xmind.ui.logic.right' })]).layout).toBe('logic');
    expect(fromXmindJson([sheet({ id: 'r', title: 'R', structureClass: 'org.xmind.ui.map.clockwise' })]).layout).toBe('map');
    const p = fromXmindJson([sheet({ id: 'r', title: 'R', markers: [{ markerId: 'priority-1' }] })]);
    expect(p.root.priority).toBe(1);
  });

  it('refuses content that is not an XMind sheet list', () => {
    expect(() => fromXmindJson({ nope: true })).toThrow(XmindError);
    expect(() => fromXmindJson([])).toThrow(XmindError);
  });

  it('never crashes on malformed fields', () => {
    const odd = [
      { id: 's', rootTopic: { id: 'r', title: 42, notes: { plain: { content: 7 } }, markers: 'priority-1', href: { x: 1 },
        children: { attached: [null, 5, 'x', { id: 'a', title: ['no'], children: { attached: {} } }], detached: 'nope', summary: 3 },
        labels: 'l', boundaries: {} }, relationships: 'r' },
    ];
    const got = fromXmindJson(odd);
    expect(got.root.text).toBe('');
    expect(got.root.children.map((c) => c.text)).toEqual(['']);
    expect(() => fromXmindJson([{ id: 's', rootTopic: 'not a topic' }])).toThrow(XmindError);
  });

  it('handles absurdly deep nesting without overflowing the stack', () => {
    let deep: Record<string, unknown> = { id: 'leaf', title: 'leaf' };
    for (let i = 0; i < 50_000; i++) deep = { id: `n${i}`, title: 't', children: { attached: [deep] } };
    const got = fromXmindJson([{ id: 's', rootTopic: { id: 'r', title: 'R', children: { attached: [deep], detached: [deep] } } }]);
    expect(got.dropped.some((d) => /nested too deep/.test(d))).toBe(true);
  });

  it('attaches callouts to their topic and maps done tasks to ✅; open tasks are counted', () => {
    const task = (status: string) => [{ provider: 'org.xmind.ui.task', content: { status } }];
    const got = fromXmindJson([{ id: 's', rootTopic: { id: 'r', title: 'R', children: { attached: [
      { id: 'a', title: 'A', extensions: task('done'), children: { callout: [{ id: 'c', title: 'Note this' }] } },
      { id: 'b', title: 'B', extensions: task('todo') },
      { id: 'd', title: 'D', extensions: task('todo') },
    ] } } }]);
    const a = got.root.children[0];
    expect(a.emoji).toBe('✅');
    expect(a.children.map((c) => c.text)).toEqual(['Note this']);
    expect(got.changed).toEqual(['1 callout attached to its topic']);
    expect(got.dropped).toEqual(['2 task checkboxes']);
  });

  it('keeps text within 5000 characters even with a link, and ignores priority-0', () => {
    const got = fromXmindJson([{ id: 's', rootTopic: { id: 'r', title: 'x'.repeat(4995), href: 'https://example.com/a', markers: [{ markerId: 'priority-0' }] } }]);
    expect(got.root.text.length).toBeLessThanOrEqual(5000);
    expect(got.root).not.toHaveProperty('priority');
    expect(got.dropped).toContain('1 link too long to keep');
  });

  it('never collapses the root, even when XMind marks it folded', () => {
    const got = fromXmindJson([{ id: 's', rootTopic: { id: 'r', title: 'R', branch: 'folded', children: { attached: [{ id: 'a', title: 'A' }] } } }]);
    expect(got.root.collapsed).toBeUndefined();
  });

  it('normalises CRLF and lone CR to LF in titles and notes', () => {
    const got = fromXmindJson([{ id: 's', rootTopic: { id: 'r', title: 'Line1\r\nLine2\rLine3', notes: { plain: { content: 'N1\r\nN2\rN3' } } } }]);
    expect(got.root.text).toBe('Line1\nLine2\nLine3');
    expect(got.root.note).toBe('N1\nN2\nN3');
  });
});

describe('importXmind', () => {
  const zipped = (files: Array<{ name: string; data: string }>) => makeZip(files);

  it('reads content.json and ignores the content.xml warning stub next to it', async () => {
    const stub = '<?xml version="1.0"?><xmap-content xmlns="urn:xmind:xmap:xmlns:content:2.0"><sheet><topic><title>Warning: This file can not be opened normally</title></topic></sheet></xmap-content>';
    const got = await importXmind(await zipped([{ name: 'content.json', data: JSON.stringify(content) }, { name: 'content.xml', data: stub }]));
    expect(got.root.text).toBe('Plan \\[draft\\]');
  });

  it('explains files it cannot read', async () => {
    await expect(importXmind(new TextEncoder().encode('hello'))).rejects.toThrow(/not an XMind file/);
    await expect(importXmind(await zipped([{ name: 'other.txt', data: 'x' }]))).rejects.toThrow(/No mind map/);
    await expect(importXmind(await zipped([{ name: 'content.json', data: '{broken' }]))).rejects.toThrow(XmindError);
    const damaged = await zipped([{ name: 'content.json', data: '{"some":"json that compresses"}'.repeat(20) }]);
    for (let i = 40; i < 60; i++) damaged[i] = 0xff;
    await expect(importXmind(damaged)).rejects.toThrow(/can't be read: the archive is damaged/);
  });

  it('refuses a map too big to save', async () => {
    const many = Array.from({ length: 4000 }, (_, i) => ({ id: `t${i}`, title: 'x'.repeat(500) }));
    const big = [sheet({ id: 'r', title: 'Big', children: { attached: many } })];
    await expect(importXmind(await zipped([{ name: 'content.json', data: JSON.stringify(big) }]))).rejects.toThrow(/too big/);
  });

  it('measures the size in bytes, as the server does (CJK text is 3 bytes a character)', async () => {
    const many = Array.from({ length: 1300 }, (_, i) => ({ id: `t${i}`, title: '字'.repeat(500) }));
    const big = [sheet({ id: 'r', title: 'Big', children: { attached: many } })];
    await expect(importXmind(await zipped([{ name: 'content.json', data: JSON.stringify(big) }]))).rejects.toThrow(/too big/);
  });
});

// This suite's test files run in the 'node' environment (readZip/makeZip need the real Blob.stream() and
// Compression/DecompressionStream, which jsdom's environment does not provide); fromXmindXml's `new DOMParser()`
// needs the opposite. Stub just that one global from the `jsdom` package's own window, not the whole realm.
describe('fromXmindXml', () => {
  beforeEach(() => vi.stubGlobal('DOMParser', new JSDOM().window.DOMParser));
  afterEach(() => vi.unstubAllGlobals());

  const xml = (topic: string) =>
    `<?xml version="1.0"?><xmap-content xmlns="urn:xmind:xmap:xmlns:content:2.0" xmlns:xhtml="http://www.w3.org/1999/xhtml" xmlns:xlink="http://www.w3.org/1999/xlink"><sheet><topic><title>R</title><children><topics type="attached">${topic}</topics></children></topic></sheet></xmap-content>`;

  it('counts an XMind 8 topic image as not imported, since there is no resource mapping for it', () => {
    const got = fromXmindXml(xml('<topic><title>A</title><image xhtml:src="xap:resources/a.png"/></topic>'));
    expect(got.images).toEqual([]);
    expect(got.dropped).toEqual(['1 image (XMind 8 images aren’t imported)']);
  });

  it('counts more than one XMind 8 image, and topics without one are unaffected', () => {
    const got = fromXmindXml(xml(
      '<topic><title>A</title><image xhtml:src="xap:resources/a.png"/></topic>'
      + '<topic><title>B</title></topic>'
      + '<topic><title>C</title><image xhtml:src="xap:resources/c.svg"/></topic>',
    ));
    expect(got.dropped).toEqual(['2 images (XMind 8 images aren’t imported)']);
  });
});

describe('readXmindResources', () => {
  it('reads named resources/ entries out of the .xmind zip', async () => {
    const bytes = await makeZip([
      { name: 'content.json', data: '{}' },
      { name: 'resources/a.png', data: new Uint8Array([1, 2, 3]), deflate: false },
      { name: 'resources/b.svg', data: '<svg/>', deflate: false },
    ]);
    const got = await readXmindResources(bytes, ['resources/a.png']);
    expect(got.get('resources/a.png')).toEqual(new Uint8Array([1, 2, 3]));
    expect(got.has('resources/b.svg')).toBe(false);
  });
});
