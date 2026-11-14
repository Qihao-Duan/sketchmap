// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import type { MapNode } from '../shared/types';
import { computeLayout } from '../layout/map';
import { hashSeed, renderMap, storedImageKey } from './renderMap';
import { PALETTE } from '../layout/styles';

const measure = (t: string, size: number) => t.length * size * 0.5;
const tree: MapNode = {
  id: 'r', text: 'Root',
  children: [
    { id: 'a', text: 'A', children: [{ id: 'a1', text: 'A1', children: [] }] },
    { id: 'b', text: 'Folded', collapsed: true, children: [{ id: 'b1', text: 'x', children: [] }, { id: 'b2', text: 'y', children: [] }] },
  ],
};

function draw(selectedId: string | null = null) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  const world = document.createElementNS('http://www.w3.org/2000/svg', 'g');
  svg.appendChild(world);
  renderMap(svg, world, computeLayout(tree, measure), { selectedId });
  return world;
}

describe('renderMap', () => {
  it('draws one topic group per visible topic and one path per branch', () => {
    const world = draw();
    const ids = [...world.querySelectorAll('g.topic')].map((g) => g.getAttribute('data-id'));
    expect(ids).toEqual(['r', 'a', 'a1', 'b']);
    expect(world.querySelector('g.branches')!.children).toHaveLength(3);
    expect(world.querySelector('g.topic')!.firstElementChild!.getAttribute('class')).toBe('hit');
  });

  it('writes each wrapped line as its own text element in the hand-drawn font', () => {
    const t = draw().querySelector('g.topic[data-id="a1"] text')!;
    expect(t.textContent).toBe('A1');
    expect(t.getAttribute('font-family')).toContain('Excalifont');
  });

  it('is deterministic: same layout, same strokes', () => {
    expect(draw().innerHTML).toBe(draw().innerHTML);
  });

  it('marks the selected topic and shows how many topics a fold hides', () => {
    const world = draw('a');
    expect(world.querySelector('g.topic[data-id="a"]')!.getAttribute('class')).toContain('selected');
    const fold = world.querySelector('g.fold[data-fold="b"]')!;
    expect(fold.getAttribute('class')).toContain('folded');
    expect(fold.querySelector('text')!.textContent).toBe('2');
    expect(world.querySelector('g.fold[data-fold="a"]')!.getAttribute('class')).toBe('fold');
  });

  it('hashSeed is stable and positive', () => {
    expect(hashSeed('abc')).toBe(hashSeed('abc'));
    expect(hashSeed('abc')).not.toBe(hashSeed('abd'));
    expect(hashSeed('')).toBeGreaterThan(0);
  });

  describe('storedImageKey', () => {
    it('returns the key when the topic has a stored image', () => {
      const withImage: MapNode = {
        id: 'r', text: 'Root',
        children: [{ id: 'img', text: 'Cat', image: { key: 'img/abcdefghijklmnopqrstu/x.png', w: 200, h: 100 }, children: [] }],
      };
      const layout = computeLayout(withImage, measure);
      expect(storedImageKey(layout.byId.get('img')!)).toBe('img/abcdefghijklmnopqrstu/x.png');
    });

    it('returns null for a foreign URL key, which the canvas and exports must not draw', () => {
      const foreign: MapNode = {
        id: 'r', text: 'Root',
        children: [{ id: 'img', text: 'Cat', image: { key: 'https://evil.example/x.png', w: 200, h: 100 }, children: [] }],
      };
      const layout = computeLayout(foreign, measure);
      expect(storedImageKey(layout.byId.get('img')!)).toBeNull();
    });

    it('returns null when the topic has no image', () => {
      const layout = computeLayout(tree, measure);
      expect(storedImageKey(layout.byId.get('a')!)).toBeNull();
    });
  });

  it('draws links as blue <a> elements that open in a new tab, each with a sketchy underline', () => {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    const world = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    svg.appendChild(world);
    const linked: MapNode = { id: 'r', text: 'Root', children: [{ id: 'l', text: 'Read [the docs](https://example.com/docs) now', children: [] }] };
    renderMap(svg, world, computeLayout(linked, measure), { selectedId: null });
    const topic = world.querySelector('g.topic[data-id="l"]')!;
    const a = topic.querySelector('text a')!;
    expect(a.getAttribute('href')).toBe('https://example.com/docs');
    expect(a.getAttribute('target')).toBe('_blank');
    expect(a.getAttribute('rel')).toBe('noopener noreferrer');
    expect(a.querySelector('tspan')!.getAttribute('fill')).toBe('#1971c2');
    expect(topic.querySelector('text')!.textContent).toBe('Read the docs now');
    expect(topic.querySelectorAll('g.link-line')).toHaveLength(1);
    expect(world.querySelector('g.topic[data-id="r"] text a')).toBeNull();
  });

  it('draws the topic image above the text, with a sketchy frame', () => {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    const world = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    svg.appendChild(world);
    const withImage: MapNode = {
      id: 'r', text: 'Root',
      children: [{ id: 'img', text: 'Cat', image: { key: 'img/abcdefghijklmnopqrstu/x.png', w: 200, h: 100 }, children: [] }],
    };
    const layout = computeLayout(withImage, measure);
    renderMap(svg, world, layout, { selectedId: null });
    const topic = world.querySelector('g.topic[data-id="img"]')!;
    const images = topic.querySelectorAll('image.topic-image');
    expect(images).toHaveLength(1);
    const img = images[0];
    const box = layout.byId.get('img')!;
    expect(img.getAttribute('href')).toBe('/img/abcdefghijklmnopqrstu/x.png');
    expect(Number(img.getAttribute('x'))).toBeCloseTo(box.x + box.image!.x);
    expect(Number(img.getAttribute('y'))).toBeCloseTo(box.y + box.image!.y);
    expect(img.getAttribute('width')).toBe('200');
    expect(img.getAttribute('height')).toBe('100');
    const text = topic.querySelector('text')!;
    expect(Number(text.getAttribute('y'))).toBeGreaterThan(box.y + box.image!.y + box.image!.h);
  });

  it('draws images into the photo layer when one is given, leaving the frame in the topic', () => {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    const world = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    const photos = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    photos.appendChild(document.createElementNS('http://www.w3.org/2000/svg', 'image')); // stale, from a previous render
    svg.append(world, photos);
    const withImage: MapNode = {
      id: 'r', text: 'Root',
      children: [{ id: 'img', text: 'Cat', image: { key: 'img/abcdefghijklmnopqrstu/x.png', w: 200, h: 100 }, children: [] }],
    };
    const layout = computeLayout(withImage, measure);
    renderMap(svg, world, layout, { selectedId: null, photos });
    expect(world.querySelectorAll('image')).toHaveLength(0);
    const imgs = photos.querySelectorAll('image.topic-image');
    expect(imgs).toHaveLength(1);
    const box = layout.byId.get('img')!;
    expect(imgs[0].getAttribute('data-id')).toBe('img');
    expect(Number(imgs[0].getAttribute('x'))).toBeCloseTo(box.x + box.image!.x);
    expect(Number(imgs[0].getAttribute('y'))).toBeCloseTo(box.y + box.image!.y);
    // The rough frame is still drawn with the topic (a g of rough paths after the hit rect and the box).
    const topic = world.querySelector('g.topic[data-id="img"]')!;
    expect(topic.querySelectorAll('path').length).toBeGreaterThan(1);
  });

  it('draws the frame inline when frames is absent, but moves it to the frame layer (clearing stale children) when given', () => {
    const withImage: MapNode = {
      id: 'r', text: 'Root',
      children: [{ id: 'img', text: 'Cat', image: { key: 'img/abcdefghijklmnopqrstu/x.png', w: 200, h: 100 }, children: [] }],
    };
    const build = (withFrames: boolean) => {
      const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      const world = document.createElementNS('http://www.w3.org/2000/svg', 'g');
      const photos = document.createElementNS('http://www.w3.org/2000/svg', 'g');
      const frames = document.createElementNS('http://www.w3.org/2000/svg', 'g');
      if (withFrames) frames.appendChild(document.createElementNS('http://www.w3.org/2000/svg', 'g')); // stale, from a previous render
      svg.append(world, photos, frames);
      const layout = computeLayout(withImage, measure);
      renderMap(svg, world, layout, { selectedId: null, photos, frames: withFrames ? frames : undefined });
      const topic = world.querySelector('g.topic[data-id="img"]')!;
      // Every rough shape (box outline, frame) is an unclassed <g>; count them directly under the topic.
      const bareGroups = [...topic.children].filter((c) => c.tagName === 'g' && !c.hasAttribute('class'));
      return { frames, bareGroups };
    };

    const inline = build(false);
    const sideLayer = build(true);
    // Exactly one bare group (the frame) left the topic for the side layer; the box outline stays.
    expect(sideLayer.bareGroups).toHaveLength(inline.bareGroups.length - 1);
    // Stale children are cleared: exactly the fresh frame remains.
    expect(sideLayer.frames.children).toHaveLength(1);
    const wrapper = sideLayer.frames.querySelector('g.topic-frame[data-id="img"]')!;
    expect(wrapper).not.toBeNull();
    expect(wrapper.querySelectorAll('path').length).toBeGreaterThan(0); // the rough rectangle
  });

  it('draws org-chart deep topics as unfilled outlines', async () => {
    const { computeOrgLayout } = await import('../layout/org');
    const { PALETTE } = await import('../layout/styles');
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    const world = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    svg.appendChild(world);
    const layout = computeOrgLayout({ id: 'r', text: 'Root', children: [{ id: 'a', text: 'A', children: [{ id: 'a1', text: 'A1', children: [] }] }] }, measure);
    renderMap(svg, world, layout, { selectedId: null });
    const small = world.querySelector('g.topic[data-id="a1"]')!;
    const strokes = [...small.querySelectorAll('path')].map((p) => p.getAttribute('stroke'));
    expect(strokes.length).toBeGreaterThan(0);
    expect(strokes).not.toContain(PALETTE[0].fill); // no hachure fill
  });

  describe('importance, priority and notes', () => {
    const decorated: MapNode = {
      id: 'r', text: 'Root',
      children: [
        { id: 'k', text: 'Key', emphasis: 'key', children: [{ id: 'k1', text: 'Under key', children: [] }] },
        { id: 'h', text: 'Two\nlines', emphasis: 'highlight', children: [] },
        { id: 's', text: 'Aside', emphasis: 'aside', children: [] },
        { id: 'p', text: 'Urgent', priority: 2, note: 'Call Ana', children: [] },
      ],
    };
    const drawn = () => {
      const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      const world = document.createElementNS('http://www.w3.org/2000/svg', 'g');
      svg.appendChild(world);
      renderMap(svg, world, computeLayout(decorated, measure), { selectedId: null });
      return world;
    };
    const topic = (w: Element, id: string) => w.querySelector(`g.topic[data-id="${id}"]`)!;
    const fills = (g: Element) => [...g.querySelectorAll('path')].map((p) => p.getAttribute('fill'));

    it('Key: solid fill, heavier text', () => {
      const k = topic(drawn(), 'k');
      expect(fills(k)).toContain(PALETTE[0].fill);
      expect(k.querySelector('text')!.getAttribute('stroke')).toBe('#1e1e1e');
    });

    it('Highlight: one highlighter swipe per line', () => {
      const h = topic(drawn(), 'h');
      expect(h.querySelectorAll('g.swipe')).toHaveLength(2);
      expect(fills(h.querySelector('g.swipe')!)).toContain('#ffe066');
    });

    it('Aside: grey dashed outline, no fill, grey text', () => {
      const s = topic(drawn(), 's');
      expect(s.querySelector('text')!.getAttribute('fill')).toBe('#868e96');
      const outlines = [...s.querySelectorAll('path')].filter((p) => p.getAttribute('stroke') === '#868e96');
      expect(outlines.length).toBeGreaterThan(0);
      expect(outlines.every((p) => p.getAttribute('stroke-dasharray'))).toBe(true);
      expect(fills(s).filter((f) => f && f !== 'none')).toEqual([]);
    });

    it('Priority: an orange badge with its number; Note: a page icon whose tooltip is the note', () => {
      const p = topic(drawn(), 'p');
      expect(p.querySelector('g.badge text')!.textContent).toBe('2');
      expect(p.querySelector('g.badge title')!.textContent).toBe('Priority 2');
      expect(fills(p.querySelector('g.badge')!)).toContain('#f08c00');
      expect(p.querySelector('g.note-icon title')!.textContent).toBe('Call Ana');
      expect(topic(drawn(), 'k').querySelector('g.badge, g.note-icon')).toBeNull();
    });

    it('the note icon names its topic; where notes open on a tap it can also be reached with the Tab key', () => {
      const plain = topic(drawn(), 'p').querySelector('g.note-icon')!;
      expect(plain.getAttribute('data-note')).toBe('p');
      expect(plain.hasAttribute('tabindex')).toBe(false);
      const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      const world = document.createElementNS('http://www.w3.org/2000/svg', 'g');
      svg.appendChild(world);
      renderMap(svg, world, computeLayout(decorated, measure), { selectedId: null, noteButtons: true });
      const button = topic(world, 'p').querySelector('g.note-icon')!;
      expect([button.getAttribute('tabindex'), button.getAttribute('role'), button.getAttribute('aria-label')]).toEqual(['0', 'button', 'Show note']);
    });

    it('branches into Key topics are 1.45× wider, into Aside topics 0.8× and dashed', () => {
      const w = drawn();
      const layout = computeLayout(decorated, measure);
      const branch = (to: string) => w.querySelector('g.branches')!.children[layout.branches.findIndex((b) => b.to === to)].querySelector('path')!;
      expect(Number(branch('k').getAttribute('stroke-width'))).toBeCloseTo(2.4 * 1.45);
      expect(Number(branch('s').getAttribute('stroke-width'))).toBeCloseTo(2.4 * 0.8);
      expect(branch('s').getAttribute('stroke-dasharray')).toBeTruthy();
      expect(Number(branch('h').getAttribute('stroke-width'))).toBeCloseTo(2.4);
    });
  });

  it('draws a framed image only for keys of the stored-image form', () => {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    const world = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    svg.appendChild(world);
    const t: MapNode = { id: 'r', text: 'Root', children: [
      { id: 'ok', text: 'Ok', image: { key: 'img/abcdefghijklmnopqrstu/x.png', w: 40, h: 30 }, children: [] },
      { id: 'bad', text: 'Bad', image: { key: '//evil.example/x.png', w: 40, h: 30 }, children: [] },
    ] };
    renderMap(svg, world, computeLayout(t, measure), { selectedId: null });
    const ok = world.querySelector('g.topic[data-id="ok"]')!;
    expect(ok.querySelectorAll('image.topic-image')).toHaveLength(1);
    expect(ok.querySelector('image.topic-image')!.nextElementSibling!.tagName).toBe('g'); // the rough frame follows it
    expect(world.querySelector('g.topic[data-id="bad"] image')).toBeNull();
  });
});
