import { describe, expect, it } from 'vitest';
import { parseMindMap, MapValidationError } from './schema';

const valid = {
  id: 'abcdefghijklmnopqrstu',
  title: 'Plan',
  layout: 'map',
  version: 3,
  updatedAt: '2026-11-12T10:00:00.000Z',
  root: {
    id: 'root000001',
    text: 'Plan',
    children: [
      {
        id: 'child00001',
        text: 'A',
        children: [],
        collapsed: true,
        note: 'n',
        emoji: '💡',
        emphasis: 'key',
        priority: 2,
        image: { key: 'img/abcdefghijklmnopqrstu/x1.png', w: 200, h: 120 },
        color: '#e03131',
      },
    ],
  },
};

describe('parseMindMap', () => {
  it('accepts a valid map and keeps every optional field', () => {
    expect(parseMindMap(structuredClone(valid))).toEqual(valid);
  });

  it('rejects unknown fields on a topic', () => {
    const bad = structuredClone(valid) as any;
    bad.root.children[0].script = 'x';
    expect(() => parseMindMap(bad)).toThrow(MapValidationError);
  });

  it('rejects a map id that is not 21 url-safe characters', () => {
    expect(() => parseMindMap({ ...structuredClone(valid), id: 'short' })).toThrow(MapValidationError);
  });

  it('rejects a priority outside 1..3', () => {
    const bad = structuredClone(valid) as any;
    bad.root.children[0].priority = 4;
    expect(() => parseMindMap(bad)).toThrow(MapValidationError);
  });

  it('rejects an unknown layout', () => {
    expect(() => parseMindMap({ ...structuredClone(valid), layout: 'radial' })).toThrow(MapValidationError);
  });

  it('accepts the side a main branch was put on, and nothing but left or right', () => {
    const withSide = (side: unknown) => ({ ...valid, root: { ...valid.root, children: [{ id: 'child00001', text: 'A', children: [], side }] } });
    expect(parseMindMap(withSide('left')).root.children[0].side).toBe('left');
    expect(parseMindMap(withSide('right')).root.children[0].side).toBe('right');
    expect(() => parseMindMap(withSide('up'))).toThrow(MapValidationError);
  });

  it('accepts where a topic’s text wraps when set by hand: whole px from 60 to 1600', () => {
    const withWrap = (wrap: unknown) => ({ ...valid, root: { ...valid.root, children: [{ id: 'child00001', text: 'A', children: [], wrap }] } });
    expect(parseMindMap(withWrap(60)).root.children[0].wrap).toBe(60);
    expect(parseMindMap(withWrap(1600)).root.children[0].wrap).toBe(1600);
    for (const bad of [59, 1601, 250.5, '250', null]) expect(() => parseMindMap(withWrap(bad))).toThrow(MapValidationError);
  });
});
