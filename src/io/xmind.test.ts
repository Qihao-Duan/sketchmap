import { describe, expect, it } from 'vitest';
import type { MapNode } from '../shared/types';
import { makeZip } from '../test/zipFixture';
import { fromXmindJson, importXmind, XmindError } from './xmind';

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
    expect(shape(got.root)).toEqual({ t: 'Plan \\[draft\\]', c: [{ t: '[Site](https://example.com/plan)', c: [{ t: 'Hidden child', c: [] }] }, { t: 'Spec', c: [] }] });
    const a = got.root.children[0];
    expect(a).toMatchObject({ note: 'Call Ana', priority: 3, emoji: '⭐', collapsed: true });
    expect(got.root.children[1]).not.toHaveProperty('priority');
    expect(got.topics).toBe(4);
    expect(got.root.id).toMatch(/^[A-Za-z0-9_-]{10}$/);
  });

  it('lists what it could not bring over', () => {
    expect(fromXmindJson(content).dropped).toEqual([
      '1 more sheet',
      '2 relationships',
      '1 boundary',
      '2 floating topics',
      '1 summary topic',
      '1 label',
      '2 other markers',
      '1 link to another topic or file',
      '1 image (images arrive in step 4)',
    ]);
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
  });

  it('refuses a map too big to save', async () => {
    const many = Array.from({ length: 4000 }, (_, i) => ({ id: `t${i}`, title: 'x'.repeat(500) }));
    const big = [sheet({ id: 'r', title: 'Big', children: { attached: many } })];
    await expect(importXmind(await zipped([{ name: 'content.json', data: JSON.stringify(big) }]))).rejects.toThrow(/too big/);
  });
});
