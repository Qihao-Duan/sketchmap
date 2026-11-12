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

describe('readZip on damaged archives', () => {
  it('turns corrupt deflate data, mismatched sizes and names past the end into ZipError', async () => {
    const deflated = await makeZip([{ name: 'content.json', data: '{"some":"json that compresses"}'.repeat(20) }]);
    const broken = deflated.slice();
    for (let i = 40; i < 60; i++) broken[i] = 0xff; // inside the compressed data
    await expect(readZip(broken, ['content.json'])).rejects.toBeInstanceOf(ZipError);

    const stored = await makeZip([{ name: 'content.json', data: 'hello', deflate: false }]);
    const v = new DataView(stored.buffer, stored.byteOffset);
    const cd = v.getUint32(stored.length - 22 + 16, true);
    const lying = stored.slice();
    new DataView(lying.buffer).setUint32(cd + 24, 4, true); // usize 4 ≠ csize 5
    await expect(readZip(lying, ['content.json'])).rejects.toBeInstanceOf(ZipError);

    const longName = stored.slice();
    new DataView(longName.buffer).setUint16(cd + 28, 60_000, true);
    await expect(readZip(longName, ['content.json'])).rejects.toBeInstanceOf(ZipError);
    expect(new ZipError('x').name).toBe('ZipError');
  });
});
