export class ZipError extends Error {}

const EOCD = 0x06054b50;
const CENTRAL = 0x02014b50;
const LOCAL = 0x04034b50;

/** Inflates raw-deflate data, giving up as soon as the output passes `max` bytes. */
async function inflate(data: Uint8Array, max: number): Promise<Uint8Array> {
  const reader = new Blob([data] as BlobPart[]).stream().pipeThrough(new DecompressionStream('deflate-raw')).getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.length;
    if (total > max) {
      await reader.cancel();
      throw new ZipError('A file inside the archive is too large.');
    }
    chunks.push(value);
  }
  const out = new Uint8Array(total);
  let at = 0;
  for (const c of chunks) {
    out.set(c, at);
    at += c.length;
  }
  return out;
}

/**
 * Reads the named entries of a zip archive (stored or deflated). Entries that aren't there are left out of the result.
 * Refuses encrypted entries, ZIP64, and anything over `maxBytes` uncompressed.
 */
export async function readZip(bytes: Uint8Array, names: string[], maxBytes = 20_000_000): Promise<Map<string, Uint8Array>> {
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let end = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 22 - 0xffff); i--) {
    if (v.getUint32(i, true) === EOCD) {
      end = i;
      break;
    }
  }
  if (end < 0) throw new ZipError('This is not a zip archive.');
  const count = v.getUint16(end + 10, true);
  let p = v.getUint32(end + 16, true);
  const wanted = new Set(names);
  const out = new Map<string, Uint8Array>();
  const dec = new TextDecoder();
  for (let n = 0; n < count; n++) {
    if (p + 46 > bytes.length || v.getUint32(p, true) !== CENTRAL) throw new ZipError('The archive is damaged.');
    const flags = v.getUint16(p + 8, true);
    const method = v.getUint16(p + 10, true);
    const csize = v.getUint32(p + 20, true);
    const usize = v.getUint32(p + 24, true);
    const nameLen = v.getUint16(p + 28, true);
    const extraLen = v.getUint16(p + 30, true);
    const commentLen = v.getUint16(p + 32, true);
    const localAt = v.getUint32(p + 42, true);
    const name = dec.decode(bytes.subarray(p + 46, p + 46 + nameLen));
    p += 46 + nameLen + extraLen + commentLen;
    if (!wanted.has(name)) continue;
    if (flags & 1) throw new ZipError('Encrypted archives are not supported.');
    if (csize === 0xffffffff || usize === 0xffffffff) throw new ZipError('ZIP64 archives are not supported.');
    if (usize > maxBytes) throw new ZipError('A file inside the archive is too large.');
    if (localAt + 30 > bytes.length || v.getUint32(localAt, true) !== LOCAL) throw new ZipError('The archive is damaged.');
    const dataAt = localAt + 30 + v.getUint16(localAt + 26, true) + v.getUint16(localAt + 28, true);
    const data = bytes.subarray(dataAt, dataAt + csize);
    if (method === 0) out.set(name, data.slice());
    else if (method === 8) out.set(name, await inflate(data, maxBytes));
    else throw new ZipError('This archive uses an unsupported compression method.');
  }
  return out;
}
