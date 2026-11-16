import { z } from 'zod';
import { IMAGE_KEY_RE, MARKERS, type MapNode, type MindMap } from './types';

export class MapValidationError extends Error {}

const nodeId = z.string().regex(/^[A-Za-z0-9_-]{1,64}$/);

const mapNodeSchema: z.ZodType<MapNode> = z.lazy(() =>
  z.strictObject({
    id: nodeId,
    text: z.string().max(5000),
    children: z.array(mapNodeSchema),
    collapsed: z.boolean().optional(),
    note: z.string().max(50_000).optional(),
    emoji: z.enum(MARKERS).optional(),
    emphasis: z.enum(['key', 'highlight', 'aside']).optional(),
    priority: z.union([z.literal(1), z.literal(2), z.literal(3)]).optional(),
    image: z
      .strictObject({
        key: z.string().regex(IMAGE_KEY_RE),
        w: z.number().int().min(16).max(2048),
        h: z.number().int().min(16).max(2048),
      })
      .optional(),
    color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
    side: z.enum(['left', 'right']).optional(),
  }),
);

const mindMapSchema = z.strictObject({
  id: z.string().regex(/^[A-Za-z0-9_-]{21}$/),
  title: z.string().max(5000),
  layout: z.enum(['map', 'logic', 'org']),
  version: z.number().int().min(0),
  updatedAt: z.string().min(1),
  root: mapNodeSchema,
});

export function parseMindMap(value: unknown): MindMap {
  const result = mindMapSchema.safeParse(value);
  if (!result.success) {
    const first = result.error.issues[0];
    throw new MapValidationError(`${first.path.join('.') || 'map'}: ${first.message}`);
  }
  return result.data;
}
