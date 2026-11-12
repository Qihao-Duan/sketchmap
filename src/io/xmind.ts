import { newNodeId } from '../model/ids';
import { escapeLabel, linkWhole, normalizeHref } from '../shared/rich';
import { LIMITS, type LayoutKind, type MapNode } from '../shared/types';
import { MAX_OUTLINE_DEPTH } from './markdown';
import { readZip, ZipError } from './zip';

export class XmindError extends Error {}

export interface XmindImport {
  root: MapNode;
  layout: LayoutKind;
  /** Topics imported, the root included. */
  topics: number;
  /** What could not be brought over, as readable phrases for the import summary ("2 relationships"). */
  dropped: string[];
  /** What was brought over in a different form, for the summary ("2 floating topics attached to the root"). */
  changed: string[];
}

const MAX_TEXT = 5000;
const MAX_NOTE = 50_000;
/** XMind marker → our marker (ids seen in real files, except task-done/symbol-exclam/symbol-wrong, which are documented). */
const MARKER_MAP: Array<[RegExp, string]> = [
  [/^star-/, '⭐'], [/^flag-/, '📌'], [/^people-/, '👤'], [/^symbol-question$/, '❓'],
  [/^task-done$/, '✅'], [/^symbol-exclam$/, '⚠️'], [/^symbol-wrong$/, '❌'],
];

const plural = (n: number) => (n === 1 ? '' : 's');

/** Counts what an import drops, then words it ("1 boundary", "2 boundaries"). */
class Dropped {
  sheets = 0;
  relationships = 0;
  boundaries = 0;
  summaryTopics = 0;
  labels = 0;
  markers = 0;
  links = 0;
  images = 0;
  tooDeep = 0;

  /** Readable phrases, in the fixed order the import summary shows them. */
  list(): string[] {
    const out: string[] = [];
    if (this.sheets) out.push(`${this.sheets} more sheet${plural(this.sheets)}`);
    if (this.relationships) out.push(`${this.relationships} relationship${plural(this.relationships)}`);
    if (this.boundaries) out.push(`${this.boundaries} ${this.boundaries === 1 ? 'boundary' : 'boundaries'}`);
    if (this.summaryTopics) out.push(`${this.summaryTopics} summary topic${plural(this.summaryTopics)}`);
    if (this.labels) out.push(`${this.labels} label${plural(this.labels)}`);
    if (this.markers) out.push(`${this.markers} other marker${plural(this.markers)}`);
    if (this.links) {
      out.push(this.links === 1 ? '1 link to another topic or file' : `${this.links} links to other topics or files`);
    }
    if (this.images) out.push(`${this.images} image${plural(this.images)} (images arrive in step 4)`);
    if (this.tooDeep) out.push(`${this.tooDeep} topic${plural(this.tooDeep)} nested too deep`);
    return out;
  }
}

/** Counts what an import changed from its original form (currently just floating topics), then words it. */
class Changed {
  floatingAttached = 0;

  /** Readable phrases for the import summary; counts top-level floating topics, not their subtrees. */
  list(): string[] {
    const out: string[] = [];
    if (this.floatingAttached) {
      out.push(
        this.floatingAttached === 1
          ? '1 floating topic attached to the root'
          : `${this.floatingAttached} floating topics attached to the root`,
      );
    }
    return out;
  }
}

/** Shared state threaded through a tree build: what gets dropped, what gets changed, and how many topics made it in. */
interface BuildCtx {
  dropped: Dropped;
  changed: Changed;
  topics: number;
}

/** `org.xmind.ui.org-chart.down` → `org`, `…logic…`/`…tree…` → `logic`, anything else → `map`. */
function layoutFromStructureClass(structureClass: string | undefined): LayoutKind {
  if (structureClass?.includes('org-chart')) return 'org';
  if (structureClass?.includes('logic') || structureClass?.includes('tree')) return 'logic';
  return 'map';
}

/** The fields every topic shares, regardless of format: text (with its link), note and marker-derived priority/emoji. */
function buildFields(
  title: string,
  href: string | undefined,
  noteRaw: string,
  markerIds: string[],
  dropped: Dropped,
): Pick<MapNode, 'text'> & Partial<Pick<MapNode, 'note' | 'priority' | 'emoji'>> {
  let text = escapeLabel(title).slice(0, MAX_TEXT);
  if (href) {
    const normalized = /^https?:\/\//i.test(href) ? normalizeHref(href) : null;
    if (normalized) text = linkWhole(text, normalized);
    else dropped.links++;
  }

  const fields: Pick<MapNode, 'text'> & Partial<Pick<MapNode, 'note' | 'priority' | 'emoji'>> = { text };
  const note = noteRaw.replace(/\s+$/, '').slice(0, MAX_NOTE);
  if (note) fields.note = note;

  let emojiSet = false;
  for (const id of markerIds) {
    const priorityMatch = /^priority-(\d+)$/.exec(id);
    if (priorityMatch) {
      if (fields.priority === undefined) fields.priority = Math.min(3, Number(priorityMatch[1])) as 1 | 2 | 3;
      continue;
    }
    if (!emojiSet) {
      const hit = MARKER_MAP.find(([re]) => re.test(id));
      if (hit) {
        fields.emoji = hit[1];
        emojiSet = true;
        continue;
      }
    }
    dropped.markers++;
  }
  return fields;
}

// ---------- XMind 2020+ (content.json) ----------

interface JsonTopic {
  title?: string;
  href?: string;
  notes?: { plain?: { content?: string } };
  markers?: Array<{ markerId?: string }>;
  branch?: string;
  labels?: unknown[];
  image?: unknown;
  boundaries?: unknown[];
  structureClass?: string;
  children?: { attached?: JsonTopic[]; detached?: JsonTopic[]; summary?: JsonTopic[] };
}

interface JsonSheet {
  rootTopic?: JsonTopic;
  relationships?: unknown[];
}

/** A topic that survived `JSON.parse` but may be any shape at all; only a plain object counts as a topic. */
function isTopic(x: unknown): x is JsonTopic {
  return typeof x === 'object' && x !== null && !Array.isArray(x);
}

/** A topic plus its attached subtree, for counting topics that get dropped whole (too deep). Iterative: arbitrarily deep input must never overflow the stack. */
function countJsonTopics(topics: unknown[]): number {
  let n = 0;
  const stack: unknown[] = [...topics];
  while (stack.length > 0) {
    const t = stack.pop();
    if (!isTopic(t)) continue;
    n++;
    const attached = Array.isArray(t.children?.attached) ? t.children.attached : [];
    for (const c of attached) stack.push(c);
  }
  return n;
}

function buildJsonTopic(topic: JsonTopic, depth: number, ctx: BuildCtx): MapNode {
  ctx.topics++;
  const title = typeof topic.title === 'string' ? topic.title : '';
  const href = typeof topic.href === 'string' ? topic.href : undefined;
  const noteRaw = typeof topic.notes?.plain?.content === 'string' ? topic.notes.plain.content : '';
  const markers = Array.isArray(topic.markers) ? topic.markers : [];
  const markerIds = markers
    .map((m) => (m && typeof m === 'object' ? m.markerId : undefined))
    .filter((id): id is string => typeof id === 'string');
  const fields = buildFields(title, href, noteRaw, markerIds, ctx.dropped);

  ctx.dropped.labels += Array.isArray(topic.labels) ? topic.labels.length : 0;
  ctx.dropped.boundaries += Array.isArray(topic.boundaries) ? topic.boundaries.length : 0;
  if (topic.image) ctx.dropped.images++;
  ctx.dropped.summaryTopics += Array.isArray(topic.children?.summary) ? topic.children.summary.length : 0;

  const attached = Array.isArray(topic.children?.attached) ? topic.children.attached : [];
  const detached = Array.isArray(topic.children?.detached) ? topic.children.detached : [];

  const children: MapNode[] = [];
  for (const child of attached) {
    if (!isTopic(child)) continue;
    const childDepth = depth + 1;
    if (childDepth > MAX_OUTLINE_DEPTH) ctx.dropped.tooDeep += countJsonTopics([child]);
    else children.push(buildJsonTopic(child, childDepth, ctx));
  }
  // Floating topics are attached under the same topic, after its attached children, at the same depth rules
  // (XMind only puts these under the root, but treated generically here); counted in `changed`, not `dropped`.
  for (const floating of detached) {
    if (!isTopic(floating)) continue;
    const childDepth = depth + 1;
    if (childDepth > MAX_OUTLINE_DEPTH) ctx.dropped.tooDeep += countJsonTopics([floating]);
    else {
      children.push(buildJsonTopic(floating, childDepth, ctx));
      ctx.changed.floatingAttached++;
    }
  }

  const node: MapNode = { id: newNodeId(), ...fields, children };
  if (topic.branch === 'folded' && children.length > 0) node.collapsed = true;
  return node;
}

/** `content.json`: an array of sheets. Only the first sheet is imported; the rest are counted. */
export function fromXmindJson(content: unknown): XmindImport {
  try {
    if (!Array.isArray(content) || content.length === 0 || typeof content[0] !== 'object' || content[0] === null) {
      throw new XmindError('This does not look like an XMind file.');
    }
    const sheets = content as JsonSheet[];
    const [first, ...rest] = sheets;
    if (!isTopic(first.rootTopic)) throw new XmindError('The XMind file has no map in it.');

    const dropped = new Dropped();
    dropped.sheets = rest.length;
    dropped.relationships = Array.isArray(first.relationships) ? first.relationships.length : 0;

    const ctx: BuildCtx = { dropped, changed: new Changed(), topics: 0 };
    const root = buildJsonTopic(first.rootTopic, 0, ctx);
    const layout = layoutFromStructureClass(first.rootTopic.structureClass);
    return { root, layout, topics: ctx.topics, dropped: dropped.list(), changed: ctx.changed.list() };
  } catch (e) {
    if (e instanceof XmindError) throw e;
    throw new XmindError('The XMind file is damaged.');
  }
}

// ---------- XMind 8 (content.xml) ----------
// Only titles, children and notes are kept for this format (spec §9); styles, relationships, boundaries,
// floating topics, priority and markers are dropped the same as any other XMind 8 feature we don't read.

function xmlChildren(el: Element, localName: string): Element[] {
  return Array.from(el.children).filter((c) => c.localName === localName);
}

/** Iterative (explicit stack): arbitrarily deep input must never overflow the stack. */
function countXmlTopics(topics: Element[]): number {
  let n = 0;
  const stack: Element[] = [...topics];
  while (stack.length > 0) {
    const t = stack.pop() as Element;
    n++;
    const childrenEl = xmlChildren(t, 'children')[0];
    const attached = childrenEl && xmlChildren(childrenEl, 'topics').find((x) => x.getAttribute('type') === 'attached');
    if (attached) for (const c of xmlChildren(attached, 'topic')) stack.push(c);
  }
  return n;
}

function buildXmlTopic(topicEl: Element, depth: number, ctx: BuildCtx): MapNode {
  ctx.topics++;
  const title = xmlChildren(topicEl, 'title')[0]?.textContent ?? '';
  const notesEl = xmlChildren(topicEl, 'notes')[0];
  const noteRaw = (notesEl && xmlChildren(notesEl, 'plain')[0]?.textContent) ?? '';
  const fields = buildFields(title, undefined, noteRaw, [], ctx.dropped);

  const childrenEl = xmlChildren(topicEl, 'children')[0];
  const topicsEls = childrenEl ? xmlChildren(childrenEl, 'topics') : [];
  const attachedContainer = topicsEls.find((t) => t.getAttribute('type') === 'attached');
  const detachedContainer = topicsEls.find((t) => t.getAttribute('type') === 'detached');

  const children: MapNode[] = [];
  for (const child of attachedContainer ? xmlChildren(attachedContainer, 'topic') : []) {
    const childDepth = depth + 1;
    if (childDepth > MAX_OUTLINE_DEPTH) ctx.dropped.tooDeep += countXmlTopics([child]);
    else children.push(buildXmlTopic(child, childDepth, ctx));
  }
  // Floating topics are attached under the same topic, after its attached children, at the same depth rules.
  for (const floating of detachedContainer ? xmlChildren(detachedContainer, 'topic') : []) {
    const childDepth = depth + 1;
    if (childDepth > MAX_OUTLINE_DEPTH) ctx.dropped.tooDeep += countXmlTopics([floating]);
    else {
      children.push(buildXmlTopic(floating, childDepth, ctx));
      ctx.changed.floatingAttached++;
    }
  }

  const node: MapNode = { id: newNodeId(), ...fields, children };
  if (topicEl.getAttribute('branch') === 'folded' && children.length > 0) node.collapsed = true;
  return node;
}

/** `content.xml` (XMind 8): `<xmap-content><sheet><topic structure-class="…">…`. */
export function fromXmindXml(xml: string): XmindImport {
  try {
    const doc = new DOMParser().parseFromString(xml, 'application/xml');
    if (doc.getElementsByTagName('parsererror').length > 0) throw new XmindError('The XMind file is damaged.');
    const root = doc.documentElement;
    const sheets = xmlChildren(root, 'sheet');
    if (sheets.length === 0) throw new XmindError('No mind map found in this file.');

    const dropped = new Dropped();
    dropped.sheets = sheets.length - 1;
    const first = sheets[0];
    const relationshipsEl = xmlChildren(first, 'relationships')[0];
    dropped.relationships = relationshipsEl ? xmlChildren(relationshipsEl, 'relationship').length : 0;

    const topicEl = xmlChildren(first, 'topic')[0];
    if (!topicEl) throw new XmindError('No mind map found in this file.');

    const ctx: BuildCtx = { dropped, changed: new Changed(), topics: 0 };
    const rootNode = buildXmlTopic(topicEl, 0, ctx);
    const layout = layoutFromStructureClass(topicEl.getAttribute('structure-class') ?? undefined);
    return { root: rootNode, layout, topics: ctx.topics, dropped: dropped.list(), changed: ctx.changed.list() };
  } catch (e) {
    if (e instanceof XmindError) throw e;
    throw new XmindError('The XMind file is damaged.');
  }
}

// ---------- Container (.xmind zip) ----------

/** Reads a `.xmind` archive: `content.json` when present (the truth, even next to a `content.xml` warning stub), else `content.xml`. */
export async function importXmind(bytes: Uint8Array): Promise<XmindImport> {
  let files: Map<string, Uint8Array>;
  try {
    files = await readZip(bytes, ['content.json', 'content.xml']);
  } catch (e) {
    if (e instanceof ZipError) {
      if (/not a zip/i.test(e.message)) throw new XmindError('This is not an XMind file (it is not a zip archive).');
      throw new XmindError(`This XMind file can't be read: ${e.message.charAt(0).toLowerCase()}${e.message.slice(1)}`);
    }
    throw e;
  }

  const dec = new TextDecoder();
  let result: XmindImport;
  const json = files.get('content.json');
  if (json) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(dec.decode(json));
    } catch {
      throw new XmindError('The XMind file is damaged.');
    }
    result = fromXmindJson(parsed);
  } else {
    const xml = files.get('content.xml');
    if (!xml) throw new XmindError('No mind map found in this file.');
    result = fromXmindXml(dec.decode(xml));
  }

  const rootBytes = new TextEncoder().encode(JSON.stringify(result.root)).byteLength;
  if (rootBytes > LIMITS.mapJsonBytes * 0.9) {
    throw new XmindError('This map is too big to import (over 2 MB).');
  }
  return result;
}
