import { measureTopic } from '../layout/map';
import { styleFor } from '../layout/styles';
import type { Measure } from '../layout/wrap';
import { WRAP_MAX_PX, WRAP_MIN_PX, type LayoutKind, type MapNode } from '../shared/types';

const within = (px: number) => Math.min(WRAP_MAX_PX, Math.max(WRAP_MIN_PX, px));

/**
 * The text width a step wider or narrower leads to, for a topic `depth` levels down in a layout of
 * `kind`. A step is a quarter of the width, in whole tens, from where the text wraps now (the width
 * that goes with the topic's level when none was set by hand): it shows at every width and leads back
 * to where it came from. Steps are taken until a word changes its line, because the topic is as narrow
 * as its text: a width that changes no line would not show. Null when no width a map may hold changes
 * one (a single line cannot get wider, one word to a line cannot get narrower, an image alone has no text).
 */
export function steppedWrap(node: MapNode, depth: number, kind: LayoutKind, step: 'wider' | 'narrower', measure: Measure): number | null {
  const shown = measureTopic(node, depth, measure, kind).lines.join('\n');
  if (!shown) return null;
  let at = node.wrap ?? styleFor(depth, kind, node.emphasis).maxW;
  for (;;) {
    const next = within(Math.round((step === 'wider' ? at * 1.25 : at / 1.25) / 10) * 10);
    if (next === at) return null;
    at = next;
    if (measureTopic({ ...node, wrap: at }, depth, measure, kind).lines.join('\n') !== shown) return at;
  }
}
