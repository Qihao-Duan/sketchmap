// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import type { MapNode } from '../shared/types';
import { makeZip } from '../test/zipFixture';
import { fromXmindXml, importXmind } from './xmind';

const shape = (n: MapNode): unknown => ({ t: n.text, c: n.children.map(shape) });
// XMind 8 content.xml (documented format; namespace and nesting match the stub found in real files).
const xml = `<?xml version="1.0" encoding="UTF-8"?>
<xmap-content xmlns="urn:xmind:xmap:xmlns:content:2.0" xmlns:xlink="http://www.w3.org/1999/xlink" version="2.0">
  <sheet id="s"><topic id="r" structure-class="org.xmind.ui.logic.right"><title>Old map</title>
    <children><topics type="attached">
      <topic id="a" branch="folded"><title>First</title><notes><plain>A note</plain></notes>
        <children><topics type="attached"><topic id="a1"><title>Deep</title></topic></topics></children></topic>
      <topic id="b"><title>Second</title></topic>
    </topics><topics type="detached"><topic id="f"><title>Floating</title></topic></topics></children>
  </topic><title>Sheet 1</title></sheet>
</xmap-content>`;

describe('fromXmindXml (XMind 8)', () => {
  it('keeps titles, attached children, notes and fold state', () => {
    const got = fromXmindXml(xml);
    expect(shape(got.root)).toEqual({
      t: 'Old map',
      c: [{ t: 'First', c: [{ t: 'Deep', c: [] }] }, { t: 'Second', c: [] }, { t: 'Floating', c: [] }],
    });
    expect(got.root.children[0]).toMatchObject({ note: 'A note', collapsed: true });
    expect(got.layout).toBe('logic');
    expect(got.dropped).toEqual([]);
    expect(got.changed).toEqual(['1 floating topic attached to the root']);
  });

  it('is used when an archive has no content.json', async () => {
    const got = await importXmind(await makeZip([{ name: 'content.xml', data: xml, deflate: false }]));
    expect(got.root.text).toBe('Old map');
  });
});
