import { newNodeId } from '../model/ids';
import { settleSides } from '../model/tree';
import { MAX_SOURCE_IMAGE_BYTES } from './imagePrep';
import { escapeLabel, linkWhole, normalizeHref } from '../shared/rich';
import { LIMITS, type LayoutKind, type MapNode } from '../shared/types';
import { MAX_OUTLINE_DEPTH } from './markdown';
import { readZip, ZipError } from './zip';

export class XmindError extends Error {}

/** A topic's image, recorded for the list page to read, prepare and upload after the tree is built (spec §9). */
export interface XmindImageRef {
  /** The id `importXmind` gave the topic that carries this image, to find it again with `findNode`. */
  nodeId: string;
  /** The zip entry to read the bytes from, e.g. `resources/abc.png`. */
  resource: string;
  width?: number;
  height?: number;
}

export interface XmindImport {
  root: MapNode;
  layout: LayoutKind;
  /** Topics imported, the root included. */
  topics: number;
  /** What could not be brought over, as readable phrases for the import summary ("2 relationships"). */
  dropped: string[];
  /** What was brought over in a different form, for the summary ("2 floating topics attached to the root"). */
  changed: string[];
  /** Image resources found on topics (content.json only), up to `MAX_IMAGES`; the rest are counted in `dropped`. */
  images: XmindImageRef[];
}

const MAX_TEXT = 5000;
const MAX_NOTE = 50_000;
const MAX_IMAGES = 100;
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
  taskCheckboxes = 0;
  markers = 0;
  links = 0;
  linksTooLong = 0;
  imagesOverLimit = 0;
  xml8Images = 0;
  tooDeep = 0;

  /** Readable phrases, in the fixed order the import summary shows them. */
  list(): string[] {
    const out: string[] = [];
    if (this.sheets) out.push(`${this.sheets} more sheet${plural(this.sheets)}`);
    if (this.relationships) out.push(`${this.relationships} relationship${plural(this.relationships)}`);
    if (this.boundaries) out.push(`${this.boundaries} ${this.boundaries === 1 ? 'boundary' : 'boundaries'}`);
    if (this.summaryTopics) out.push(`${this.summaryTopics} summary topic${plural(this.summaryTopics)}`);
    if (this.labels) out.push(`${this.labels} label${plural(this.labels)}`);
    if (this.taskCheckboxes) out.push(`${this.taskCheckboxes} task checkbox${this.taskCheckboxes === 1 ? '' : 'es'}`);
    if (this.markers) out.push(`${this.markers} other marker${plural(this.markers)}`);
    if (this.links) {
      out.push(this.links === 1 ? '1 link to another topic or file' : `${this.links} links to other topics or files`);
    }
    if (this.linksTooLong) {
      out.push(this.linksTooLong === 1 ? '1 link too long to keep' : `${this.linksTooLong} links too long to keep`);
    }
    if (this.imagesOverLimit) out.push(`${this.imagesOverLimit} image${plural(this.imagesOverLimit)} not imported (over 100)`);
    if (this.xml8Images) out.push(`${this.xml8Images} image${plural(this.xml8Images)} (XMind 8 images aren’t imported)`);
    if (this.tooDeep) out.push(`${this.tooDeep} topic${plural(this.tooDeep)} nested too deep`);
    return out;
  }
}

/** Counts what an import changed from its original form, then words it. */
class Changed {
  floatingAttached = 0;
  calloutsAttached = 0;

  /** Readable phrases for the import summary; counts top-level floating topics and callouts, not their subtrees. */
  list(): string[] {
    const out: string[] = [];
    if (this.floatingAttached) {
      out.push(
        this.floatingAttached === 1
          ? '1 floating topic attached to the root'
          : `${this.floatingAttached} floating topics attached to the root`,
      );
    }
    if (this.calloutsAttached) {
      out.push(
        this.calloutsAttached === 1
          ? '1 callout attached to its topic'
          : `${this.calloutsAttached} callouts attached to their topics`,
      );
    }
    return out;
  }
}

/** Shared state threaded through a tree build: what gets dropped, what gets changed, how many topics made it in,
 * and the image resources found along the way. */
interface BuildCtx {
  dropped: Dropped;
  changed: Changed;
  topics: number;
  images: XmindImageRef[];
}

/**
 * `image.src = "xap:resources/<name>"` (content.json only): a resource (SVG included — the list page's
 * `prepareImage` draws it into a PNG) is recorded on `ctx.images` for the list page to upload, up to
 * `MAX_IMAGES`; anything past the cap is counted in `ctx.dropped` instead. Any other shape — no `image`, no
 * `src`, or a `src` that isn't a `xap:resources/` string — is left alone: real files only ever use this one
 * form, and a non-image reference is not something this import can act on anyway.
 */
function recordImage(image: unknown, nodeId: string, ctx: BuildCtx): void {
  if (!image || typeof image !== 'object') return;
  const src = (image as { src?: unknown }).src;
  if (typeof src !== 'string' || !src.startsWith('xap:resources/')) return;
  const name = src.slice('xap:resources/'.length);
  if (!name || name.length > 255) return; // not a resource name any real file uses
  if (ctx.images.length >= MAX_IMAGES) {
    ctx.dropped.imagesOverLimit++;
    return;
  }
  const w = (image as { width?: unknown }).width;
  const h = (image as { height?: unknown }).height;
  // Use XMind's display size only when both sides are usable; otherwise the image's own size is used later.
  const sized = typeof w === 'number' && typeof h === 'number' && w > 0 && h > 0 && Number.isFinite(w) && Number.isFinite(h);
  const width = sized ? w : undefined;
  const height = sized ? h : undefined;
  ctx.images.push({
    nodeId,
    resource: `resources/${name}`,
    ...(typeof width === 'number' ? { width } : {}),
    ...(typeof height === 'number' ? { height } : {}),
  });
}

/** `org.xmind.ui.org-chart.down` → `org`, `…logic…`/`…tree…` → `logic`, anything else → `map`. */
function layoutFromStructureClass(structureClass: string | undefined): LayoutKind {
  if (structureClass?.includes('org-chart')) return 'org';
  if (structureClass?.includes('logic') || structureClass?.includes('tree')) return 'logic';
  return 'map';
}

/** `\r\n` and a lone `\r` both become `\n`, matching what the textarea does on edit. */
const toLf = (s: string): string => s.replace(/\r\n?/g, '\n');

/** The fields every topic shares, regardless of format: text (with its link), note and marker-derived priority/emoji. */
function buildFields(
  title: string,
  href: string | undefined,
  noteRaw: string,
  markerIds: string[],
  dropped: Dropped,
): Pick<MapNode, 'text'> & Partial<Pick<MapNode, 'note' | 'priority' | 'emoji'>> {
  const text = escapeLabel(toLf(title)).slice(0, MAX_TEXT);
  const fields: Pick<MapNode, 'text'> & Partial<Pick<MapNode, 'note' | 'priority' | 'emoji'>> = { text };
  if (href) {
    const normalized = /^https?:\/\//i.test(href) ? normalizeHref(href) : null;
    if (normalized) {
      const linked = linkWhole(text, normalized);
      if (linked.length <= MAX_TEXT) fields.text = linked;
      else dropped.linksTooLong++;
    } else dropped.links++;
  }

  const note = toLf(noteRaw).replace(/\s+$/, '').slice(0, MAX_NOTE);
  if (note) fields.note = note;

  let emojiSet = false;
  for (const id of markerIds) {
    const priorityMatch = /^priority-(\d+)$/.exec(id);
    if (priorityMatch) {
      const n = Number(priorityMatch[1]);
      if (n >= 1 && fields.priority === undefined) fields.priority = Math.min(3, n) as 1 | 2 | 3;
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

/** A topic's `org.xmind.ui.task` status, read defensively: arrays and objects only, `status` only when a string. */
function taskStatus(extensions: unknown): string | undefined {
  if (!Array.isArray(extensions)) return undefined;
  let status: string | undefined;
  for (const ext of extensions) {
    if (!ext || typeof ext !== 'object' || (ext as { provider?: unknown }).provider !== 'org.xmind.ui.task') continue;
    const content = (ext as { content?: unknown }).content;
    if (content && typeof content === 'object' && typeof (content as { status?: unknown }).status === 'string') {
      status = (content as { status: string }).status;
    }
  }
  return status;
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
  extensions?: unknown[];
  children?: { attached?: JsonTopic[]; detached?: JsonTopic[]; summary?: JsonTopic[]; callout?: JsonTopic[] };
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
  const nodeId = newNodeId();
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
  recordImage(topic.image, nodeId, ctx);
  ctx.dropped.summaryTopics += Array.isArray(topic.children?.summary) ? topic.children.summary.length : 0;

  // A task checkbox (`extensions: [{ provider: 'org.xmind.ui.task', content: { status } }]`). `done` gives the
  // marker ✅, unless the topic already has a mapped marker (only one marker is kept per topic). Any other status
  // (only `todo` is seen in practice) is counted in `dropped`, since it is otherwise lost silently.
  const status = taskStatus(topic.extensions);
  if (status === 'done') {
    if (fields.emoji === undefined) fields.emoji = '✅';
  } else if (status !== undefined) {
    ctx.dropped.taskCheckboxes++;
  }

  const attached = Array.isArray(topic.children?.attached) ? topic.children.attached : [];
  const detached = Array.isArray(topic.children?.detached) ? topic.children.detached : [];
  const callouts = Array.isArray(topic.children?.callout) ? topic.children.callout : [];

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
  // Callouts (`children.callout`) are attached under the topic that holds them, after attached and floating
  // children, at the same depth rules; counted in `changed`, after floating topics.
  for (const callout of callouts) {
    if (!isTopic(callout)) continue;
    const childDepth = depth + 1;
    if (childDepth > MAX_OUTLINE_DEPTH) ctx.dropped.tooDeep += countJsonTopics([callout]);
    else {
      children.push(buildJsonTopic(callout, childDepth, ctx));
      ctx.changed.calloutsAttached++;
    }
  }

  const node: MapNode = { id: nodeId, ...fields, children };
  // The root never collapses: the editor has no fold control at depth 0, so a folded root would hide the whole map.
  if (depth > 0 && topic.branch === 'folded' && children.length > 0) node.collapsed = true;
  return node;
}

/** The structure in which XMind keeps a fixed number of main branches on the right of the central topic. */
const UNBALANCED_MAP = 'org.xmind.ui.map.unbalanced';

/**
 * How many main branches XMind keeps on the right of the central topic, or null when the file doesn't say.
 * Seen in real files as an extension of the central topic:
 * `{ provider: 'org.xmind.ui.map.unbalanced', content: [{ name: 'right-number', content: '4' }] }`.
 * Read only for that structure: files with other structures carry the same extension as a leftover.
 */
function rightNumber(topic: JsonTopic): number | null {
  if (topic.structureClass !== UNBALANCED_MAP || !Array.isArray(topic.extensions)) return null;
  for (const ext of topic.extensions) {
    if (!ext || typeof ext !== 'object' || (ext as { provider?: unknown }).provider !== UNBALANCED_MAP) continue;
    const content = (ext as { content?: unknown }).content;
    if (!Array.isArray(content)) continue;
    for (const entry of content) {
      if (!entry || typeof entry !== 'object' || (entry as { name?: unknown }).name !== 'right-number') continue;
      const value = (entry as { content?: unknown }).content;
      const text = typeof value === 'number' ? String(value) : value;
      if (typeof text === 'string' && /^\d{1,6}$/.test(text)) return Number(text);
    }
  }
  return null;
}

/**
 * Puts the main branches on the sides XMind had them on: the first `right` attached topics on the right,
 * the rest on the left. Floating topics and callouts, which are attached after them, go where the last
 * of those is.
 */
function keepSides(root: MapNode, topic: JsonTopic, right: number): void {
  const attached = Array.isArray(topic.children?.attached) ? topic.children.attached : [];
  // Entries that are not topics were skipped when the branches were built, so the two lists are counted alike.
  const kept = attached.filter(isTopic).length;
  const onRight = attached.slice(0, right).filter(isTopic).length;
  root.children.slice(0, kept).forEach((child, i) => {
    child.side = i < onRight ? 'right' : 'left';
  });
  settleSides(root);
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

    const ctx: BuildCtx = { dropped, changed: new Changed(), topics: 0, images: [] };
    const root = buildJsonTopic(first.rootTopic, 0, ctx);
    const layout = layoutFromStructureClass(first.rootTopic.structureClass);
    const right = layout === 'map' ? rightNumber(first.rootTopic) : null;
    if (right !== null) keepSides(root, first.rootTopic, right);
    return { root, layout, topics: ctx.topics, dropped: dropped.list(), changed: ctx.changed.list(), images: ctx.images };
  } catch (e) {
    if (e instanceof XmindError) throw e;
    throw new XmindError('The XMind file is damaged.');
  }
}

// ---------- XMind 8 (content.xml) ----------
// Titles, children and notes are kept (spec §9); floating topics are attached the same way as content.json, and
// priority/other markers and http(s) `xlink:href` links are read the same way too. Styles, boundaries, labels and
// other sheets are dropped, and counted the same way as content.json; relationships are counted per sheet.

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
  const href = topicEl.getAttribute('xlink:href') ?? undefined;
  const markerRefsEl = xmlChildren(topicEl, 'marker-refs')[0];
  const markerIds = markerRefsEl
    ? xmlChildren(markerRefsEl, 'marker-ref')
        .map((m) => m.getAttribute('marker-id'))
        .filter((id): id is string => typeof id === 'string')
    : [];
  const fields = buildFields(title, href, noteRaw, markerIds, ctx.dropped);

  const boundariesEl = xmlChildren(topicEl, 'boundaries')[0];
  ctx.dropped.boundaries += boundariesEl ? xmlChildren(boundariesEl, 'boundary').length : 0;
  const labelsEl = xmlChildren(topicEl, 'labels')[0];
  ctx.dropped.labels += labelsEl ? xmlChildren(labelsEl, 'label').length : 0;
  // XMind 8 images have no `xap:resources/` mapping to read later, so they are just counted, never uploaded.
  if (xmlChildren(topicEl, 'image').length > 0) ctx.dropped.xml8Images++;

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
  // The root never collapses: the editor has no fold control at depth 0, so a folded root would hide the whole map.
  if (depth > 0 && topicEl.getAttribute('branch') === 'folded' && children.length > 0) node.collapsed = true;
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

    const ctx: BuildCtx = { dropped, changed: new Changed(), topics: 0, images: [] };
    const rootNode = buildXmlTopic(topicEl, 0, ctx);
    const layout = layoutFromStructureClass(topicEl.getAttribute('structure-class') ?? undefined);
    return { root: rootNode, layout, topics: ctx.topics, dropped: dropped.list(), changed: ctx.changed.list(), images: ctx.images };
  } catch (e) {
    if (e instanceof XmindError) throw e;
    throw new XmindError('The XMind file is damaged.');
  }
}

// ---------- Container (.xmind zip) ----------

/** Reads a `.xmind` archive: `content.json` when present (the truth, even next to a `content.xml` warning stub), else `content.xml`.
 * `content.xml` is read only when `content.json` is missing, so a hostile `content.xml` can't cost anything on a file
 * that has a good `content.json`. */
export async function importXmind(bytes: Uint8Array): Promise<XmindImport> {
  let files: Map<string, Uint8Array>;
  try {
    files = await readZip(bytes, ['content.json']);
    if (!files.has('content.json')) files = await readZip(bytes, ['content.xml']);
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

/** Reads the `resources/<name>` entries `importXmind` recorded on `XmindImport.images`, out of the same archive. */
export async function readXmindResources(bytes: Uint8Array, names: string[]): Promise<Map<string, Uint8Array>> {
  // The same cap as prepareImage's source-file limit, so a resource that could be prepared isn't refused first here.
  return readZip(bytes, names, MAX_SOURCE_IMAGE_BYTES);
}
