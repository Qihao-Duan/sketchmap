import type { LayoutKind, MapNode } from '../shared/types';
import { computeLayout, type MapLayout } from './map';
import { computeOrgLayout } from './org';
import type { Measure } from './wrap';

/** The one entry point the editor, the view and export use. */
export function layoutMap(root: MapNode, kind: LayoutKind, measure: Measure): MapLayout {
  return kind === 'org' ? computeOrgLayout(root, measure) : computeLayout(root, measure, kind);
}
