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
  floating = 0;
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
    if (this.floating) out.push(`${this.floating} floating topic${plural(this.floating)}`);
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

/** Shared state threaded through a tree build: what gets dropped, and how many topics made it in. */
interface BuildCtx {
  dropped: Dropped;
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

/** A topic plus its attached subtree, for counting topics that get dropped whole (floating, too deep). */
function countJsonTopics(topics: JsonTopic[]): number {
  let n = 0;
  for (const t of topics) n += 1 + countJsonTopics(t.children?.attached ?? []);
  return n;
}

function buildJsonTopic(topic: JsonTopic, depth: number, ctx: BuildCtx): MapNode {
  ctx.topics++;
  const markerIds = (topic.markers ?? [])
    .map((m) => m.markerId)
    .filter((id): id is string => typeof id === 'string');
  const fields = buildFields(topic.title ?? '', topic.href, topic.notes?.plain?.content ?? '', markerIds, ctx.dropped);

  ctx.dropped.labels += topic.labels?.length ?? 0;
  ctx.dropped.boundaries += topic.boundaries?.length ?? 0;
  if (topic.image) ctx.dropped.images++;
  ctx.dropped.summaryTopics += topic.children?.summary?.length ?? 0;
  for (const floating of topic.children?.detached ?? []) ctx.dropped.floating += countJsonTopics([floating]);

  const children: MapNode[] = [];
  for (const child of topic.children?.attached ?? []) {
    const childDepth = depth + 1;
    if (childDepth > MAX_OUTLINE_DEPTH) ctx.dropped.tooDeep += countJsonTopics([child]);
    else children.push(buildJsonTopic(child, childDepth, ctx));
  }

  const node: MapNode = { id: newNodeId(), ...fields, children };
  if (topic.branch === 'folded' && children.length > 0) node.collapsed = true;
  return node;
}

/** `content.json`: an array of sheets. Only the first sheet is imported; the rest are counted. */
export function fromXmindJson(content: unknown): XmindImport {
  if (!Array.isArray(content) || content.length === 0 || typeof content[0] !== 'object' || content[0] === null) {
    throw new XmindError('This does not look like an XMind file.');
  }
  const sheets = content as JsonSheet[];
  const [first, ...rest] = sheets;
  const dropped = new Dropped();
  dropped.sheets = rest.length;
  dropped.relationships = first.relationships?.length ?? 0;

  const ctx: BuildCtx = { dropped, topics: 0 };
  const root = buildJsonTopic(first.rootTopic ?? {}, 0, ctx);
  const layout = layoutFromStructureClass(first.rootTopic?.structureClass);
  return { root, layout, topics: ctx.topics, dropped: dropped.list() };
}

// ---------- XMind 8 (content.xml) ----------
// Only titles, children and notes are kept for this format (spec §9); styles, relationships, boundaries,
// floating topics, priority and markers are dropped the same as any other XMind 8 feature we don't read.

function xmlChildren(el: Element, localName: string): Element[] {
  return Array.from(el.children).filter((c) => c.localName === localName);
}

function countXmlTopics(topics: Element[]): number {
  let n = 0;
  for (const t of topics) {
    n += 1;
    const childrenEl = xmlChildren(t, 'children')[0];
    const attached = childrenEl && xmlChildren(childrenEl, 'topics').find((x) => x.getAttribute('type') === 'attached');
    if (attached) n += countXmlTopics(xmlChildren(attached, 'topic'));
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

  for (const floating of detachedContainer ? xmlChildren(detachedContainer, 'topic') : []) {
    ctx.dropped.floating += countXmlTopics([floating]);
  }

  const children: MapNode[] = [];
  for (const child of attachedContainer ? xmlChildren(attachedContainer, 'topic') : []) {
    const childDepth = depth + 1;
    if (childDepth > MAX_OUTLINE_DEPTH) ctx.dropped.tooDeep += countXmlTopics([child]);
    else children.push(buildXmlTopic(child, childDepth, ctx));
  }

  const node: MapNode = { id: newNodeId(), ...fields, children };
  if (topicEl.getAttribute('branch') === 'folded' && children.length > 0) node.collapsed = true;
  return node;
}

/** `content.xml` (XMind 8): `<xmap-content><sheet><topic structure-class="…">…`. */
export function fromXmindXml(xml: string): XmindImport {
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

  const ctx: BuildCtx = { dropped, topics: 0 };
  const rootNode = buildXmlTopic(topicEl, 0, ctx);
  const layout = layoutFromStructureClass(topicEl.getAttribute('structure-class') ?? undefined);
  return { root: rootNode, layout, topics: ctx.topics, dropped: dropped.list() };
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

  if (JSON.stringify(result.root).length > LIMITS.mapJsonBytes * 0.9) {
    throw new XmindError('This map is too big to import (over 2 MB).');
  }
  return result;
}
