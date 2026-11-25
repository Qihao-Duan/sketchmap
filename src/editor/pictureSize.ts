/**
 * A stored picture's own size in pixels. A resize needs it to keep the picture's true proportions: the map
 * only holds the size the picture is shown at, in whole pixels, and going by that alone would bend the
 * proportions a little more with every resize, until the frame cuts off the picture's edges.
 */
const sizes = new Map<string, { w: number; h: number }>();
const asked = new Set<string>();

/** Starts loading stored picture `key` to learn its size, unless that was done before. */
export function learnPictureSize(key: string): void {
  if (asked.has(key)) return;
  asked.add(key);
  const img = new Image();
  img.onload = () => {
    if (img.naturalWidth > 0 && img.naturalHeight > 0) sizes.set(key, { w: img.naturalWidth, h: img.naturalHeight });
  };
  // Not kept as asked for: the next time may work (the network was down, or the upload had not arrived yet).
  img.onerror = () => asked.delete(key);
  img.src = `/${key}`;
}

/** The picture's own size, or null while the browser has not loaded it. */
export function pictureSize(key: string): { w: number; h: number } | null {
  return sizes.get(key) ?? null;
}
