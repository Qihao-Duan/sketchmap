// A minimal, valid 2x2 RGBA PNG (one transparent pixel, three opaque ones), generated once with a
// scratch Node script (zlib.deflateSync for IDAT, a table-based CRC-32 for each chunk's trailer) and
// verified to decode both with Node's own zlib/round-trip and with macOS `sips`. Pasted here as base64
// so the e2e suite has a tiny fixture it can feed to the file input without touching the filesystem.
const PNG_2x2_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAFUlEQVR42mP4zwAE/xlA1H8gYPgPADnYB/k3uQY/AAAAAElFTkSuQmCC';

/** A valid 2x2 PNG with transparency (so `prepareImage` keeps it as PNG). Must decode in Chromium. */
export const PNG_2x2: Buffer = Buffer.from(PNG_2x2_BASE64, 'base64');
