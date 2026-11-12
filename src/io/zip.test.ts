import { describe, expect, it } from 'vitest';
import { makeZip } from '../test/zipFixture';
import { readZip, ZipError } from './zip';

const text = (b: Uint8Array | undefined) => new TextDecoder().decode(b);

describe('readZip', () => {
  it('reads stored and deflated entries by name, ignoring the rest', async () => {
    const zip = await makeZip([
      { name: 'content.json', data: '[{"a":1}]' },
      { name: 'metadata.json', data: '{}', deflate: false },
      { name: 'Thumbnails/thumbnail.png', data: new Uint8Array([1, 2, 3]) },
    ]);
    const got = await readZip(zip, ['content.json', 'metadata.json', 'content.xml']);
    expect([...got.keys()].sort()).toEqual(['content.json', 'metadata.json']);
    expect(text(got.get('content.json'))).toBe('[{"a":1}]');
    expect(text(got.get('metadata.json'))).toBe('{}');
  });

  it('refuses something that is not a zip, and entries over the size cap', async () => {
    await expect(readZip(new TextEncoder().encode('not a zip at all'), ['content.json'])).rejects.toBeInstanceOf(ZipError);
    const zip = await makeZip([{ name: 'content.json', data: 'x'.repeat(5000) }]);
    await expect(readZip(zip, ['content.json'], 1000)).rejects.toBeInstanceOf(ZipError);
  });

  it('stops inflating as soon as the output passes the cap (zip bomb)', async () => {
    const zip = await makeZip([{ name: 'content.json', data: '0'.repeat(200_000) }]);
    // Lie in the central directory about the size so only the streaming cap can catch it.
    const v = new DataView(zip.buffer, zip.byteOffset);
    const cdStart = v.getUint32(zip.length - 22 + 16, true);
    v.setUint32(cdStart + 24, 10, true);
    await expect(readZip(zip, ['content.json'], 1000)).rejects.toBeInstanceOf(ZipError);
  });
});
