import rough from 'roughjs';
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type MouseEvent } from 'react';
import { IMAGE_SIZES } from '../io/imagePrep';
import { ASIDE_INK, HIGHLIGHTER, INK, PRIORITY_COLORS } from '../layout/styles';
import { parseRich } from '../shared/rich';
import { MARKERS, type Emphasis, type MapNode } from '../shared/types';

type Rough = ReturnType<typeof rough.svg>;
type Draw = (rc: Rough, svg: SVGSVGElement) => void;

const SVGNS = 'http://www.w3.org/2000/svg';
/** The note is saved after this long without typing, and on blur. */
const NOTE_DELAY_MS = 800;
// Buttons don't take focus on mouse click, so keyboard shortcuts keep working afterwards.
const noFocus = (e: MouseEvent) => e.preventDefault();

/** A small hand-drawn preview; `draw` must be a stable (module-level) function. */
function Mini({ w, h, draw }: { w: number; h: number; draw: Draw }) {
  const ref = useRef<SVGSVGElement>(null);
  useLayoutEffect(() => {
    const svg = ref.current!;
    svg.replaceChildren();
    draw(rough.svg(svg), svg);
  }, [draw]);
  return <svg ref={ref} className="mini" width={w} height={h} viewBox={`0 0 ${w} ${h}`} aria-hidden="true" />;
}

const IMPORTANCE: Array<{ value: Emphasis | null; label: string; title: string; draw: Draw }> = [
  {
    value: 'key', label: 'Key', title: 'Key (Alt ↑ raises importance)',
    draw: (rc, s) => { s.appendChild(rc.rectangle(4, 4, 32, 16, { stroke: INK, strokeWidth: 2.6, fill: '#a5d8ff', fillStyle: 'solid', roughness: 1, seed: 3 })); },
  },
  {
    value: 'highlight', label: 'Highlight', title: 'Highlight',
    draw: (rc, s) => {
      s.appendChild(rc.polygon([[3, 8], [37, 5], [36, 18], [4, 20]], { fill: HIGHLIGHTER, fillStyle: 'solid', stroke: 'none', roughness: 1.4, seed: 4 }));
      s.appendChild(rc.line(9, 13, 31, 12, { stroke: INK, strokeWidth: 1.4, roughness: 0.8, seed: 5 }));
    },
  },
  {
    value: null, label: 'Normal', title: 'Normal',
    draw: (rc, s) => { s.appendChild(rc.rectangle(4, 4, 32, 16, { stroke: INK, strokeWidth: 1.2, fill: '#a5d8ff', fillStyle: 'hachure', hachureGap: 4, roughness: 1, seed: 7 })); },
  },
  {
    value: 'aside', label: 'Aside', title: 'Aside (Alt ↓ lowers importance)',
    draw: (rc, s) => { s.appendChild(rc.rectangle(4, 5, 32, 14, { stroke: ASIDE_INK, strokeWidth: 1.2, strokeLineDash: [4, 4], roughness: 1, seed: 6 })); },
  },
];

const badge = (n: 1 | 2 | 3): Draw => (rc, s) => {
  s.appendChild(rc.circle(13, 13, 20, { fill: PRIORITY_COLORS[n], fillStyle: 'solid', stroke: PRIORITY_COLORS[n], roughness: 0.8, seed: 9 + n }));
  const t = s.ownerDocument.createElementNS(SVGNS, 'text');
  const attrs: Array<[string, string]> = [
    ['x', '13'], ['y', '17.5'], ['text-anchor', 'middle'], ['font-size', '13'], ['font-weight', '800'],
    ['font-family', 'system-ui, sans-serif'], ['fill', '#ffffff'],
  ];
  for (const [k, v] of attrs) t.setAttribute(k, v);
  t.textContent = String(n);
  s.appendChild(t);
};

const PRIORITIES: Array<{ value: 1 | 2 | 3 | null; label: string; title: string; draw: Draw }> = [
  { value: 1, label: 'Priority 1', title: 'Priority 1 (Alt 1)', draw: badge(1) },
  { value: 2, label: 'Priority 2', title: 'Priority 2 (Alt 2)', draw: badge(2) },
  { value: 3, label: 'Priority 3', title: 'Priority 3 (Alt 3)', draw: badge(3) },
  {
    value: null, label: 'No priority', title: 'No priority (Alt 0)',
    draw: (rc, s) => { s.appendChild(rc.circle(13, 13, 18, { stroke: ASIDE_INK, strokeWidth: 1.2, strokeLineDash: [3, 3], roughness: 0.8, seed: 8 })); },
  },
];

const IMAGE_SIZE_KEYS = ['S', 'M', 'L'] as const;

export interface DetailsPanelProps {
  /** The current topic. With several topics selected, importance, priority and marker go to all of them. */
  node: MapNode;
  /** How many topics are selected (default 1). Above 1 the panel shows only what applies to all of them. */
  count?: number;
  onEmphasis(emphasis: Emphasis | null): void;
  onPriority(priority: 1 | 2 | 3 | null): void;
  onMarker(emoji: string | null): void;
  onNote(id: string, note: string): void;
  onImageFile(file: File): void;
  onImageSize(size: 'S' | 'M' | 'L'): void;
  onImageRemove(): void;
  /** An image is being uploaded: the Add/Replace button is disabled and reads "Uploading…". */
  uploading?: boolean;
  /** A new topic is open for typing: finish it before writing a note. */
  newTopicOpen?: boolean;
  /** Folds the panel into a slim tab at the right edge. */
  onFold(): void;
}

/** The panel while no topic is selected (after a click on the background): it stays where it is and says so. */
export function NoTopicDetails({ onFold }: { onFold(): void }) {
  return (
    <aside className="float details" aria-label="Topic details">
      <div className="details-head">
        <h2>Topic details</h2>
        <button type="button" className="fold-details" aria-label="Fold the details panel" title="Fold into a tab" onMouseDown={noFocus} onClick={onFold}>
          ▸
        </button>
      </div>
      <p className="muted hint">No topic selected. Click a topic to see its details.</p>
    </aside>
  );
}

/** The selected topic's importance, priority, marker, note and image. Mount it with `key={node.id}`. */
export function DetailsPanel({ node, count = 1, onEmphasis, onPriority, onMarker, onNote, onImageFile, onImageSize, onImageRemove, uploading, newTopicOpen, onFold }: DetailsPanelProps) {
  const many = count > 1;
  const [note, setNote] = useState(node.note ?? '');
  const noteBox = useRef<HTMLTextAreaElement>(null);
  const pending = useRef<string | null>(null);
  const timer = useRef<number | undefined>(undefined);
  const onNoteRef = useRef(onNote);
  onNoteRef.current = onNote;
  const imageInput = useRef<HTMLInputElement>(null);
  const pickImage = () => imageInput.current?.click();

  const flush = () => {
    window.clearTimeout(timer.current);
    if (pending.current === null) return;
    const text = pending.current;
    pending.current = null;
    onNoteRef.current(node.id, text);
  };
  // A note still waiting for its pause is saved when the panel goes away (another topic was selected).
  useEffect(() => () => flush(), []);
  // Leaving the page: save a note still waiting for its pause, and ask before closing while it is unsaved.
  useEffect(() => {
    const onHide = () => {
      if (document.visibilityState === 'hidden') flush();
    };
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      if (pending.current === null) return;
      flush();
      e.preventDefault();
      e.returnValue = '';
    };
    document.addEventListener('visibilitychange', onHide);
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => {
      document.removeEventListener('visibilitychange', onHide);
      window.removeEventListener('beforeunload', onBeforeUnload);
    };
  }, []);
  // Undo or redo can change the note underneath: show the stored note unless the user is typing here.
  useEffect(() => {
    if (document.activeElement !== noteBox.current) setNote(node.note ?? '');
  }, [node.note]);

  const rich = useMemo(() => parseRich(node.text), [node.text]);
  const title = (node.emoji ? `${node.emoji} ` : '') + (rich.plain.split('\n')[0].trim() || 'Untitled topic');
  return (
    <aside className="float details" aria-label="Topic details">
      <div className="details-head">
        <h2>{many ? `${count} topics selected` : 'Topic details'}</h2>
        <button type="button" className="fold-details" aria-label="Fold the details panel" title="Fold into a tab" onMouseDown={noFocus} onClick={onFold}>
          ▸
        </button>
      </div>
      {many ? <p className="muted hint">Importance, priority and marker go to all of them. Shown here: {title}.</p> : <div className="topic-title">{title}</div>}
      <div className="field">
        <span className="flabel">Importance</span>
        <div className="chips importance" role="group" aria-label="Importance">
          {IMPORTANCE.map((it) => (
            <button
              key={it.label}
              type="button"
              className="chip tool"
              title={it.title}
              aria-pressed={(node.emphasis ?? null) === it.value}
              onMouseDown={noFocus}
              onClick={() => onEmphasis(it.value)}
            >
              <Mini w={40} h={24} draw={it.draw} />
              <span>{it.label}</span>
            </button>
          ))}
        </div>
      </div>
      <div className="field">
        <span className="flabel">Priority</span>
        <div className="chips" role="group" aria-label="Priority">
          {PRIORITIES.map((p) => (
            <button
              key={p.label}
              type="button"
              className="chip"
              aria-label={p.label}
              title={p.title}
              aria-pressed={(node.priority ?? null) === p.value}
              onMouseDown={noFocus}
              onClick={() => onPriority(p.value)}
            >
              <Mini w={26} h={26} draw={p.draw} />
            </button>
          ))}
        </div>
      </div>
      <div className="field">
        <span className="flabel">Marker</span>
        <div className="chips" role="group" aria-label="Marker">
          {MARKERS.map((mk) => (
            <button
              key={mk}
              type="button"
              className="chip"
              aria-label={`Marker ${mk}`}
              aria-pressed={node.emoji === mk}
              onMouseDown={noFocus}
              onClick={() => onMarker(node.emoji === mk ? null : mk)}
            >
              {mk}
            </button>
          ))}
        </div>
      </div>
      {!many && <label className="field">
        <span className="flabel">Note</span>
        <textarea
          ref={noteBox}
          aria-label="Note"
          rows={4}
          readOnly={newTopicOpen}
          onMouseDown={newTopicOpen ? noFocus : undefined}
          placeholder={newTopicOpen ? 'Finish the new topic first (Enter)' : 'Add a note…'}
          maxLength={50_000}
          value={note}
          onChange={(e) => {
            setNote(e.target.value);
            pending.current = e.target.value;
            window.clearTimeout(timer.current);
            timer.current = window.setTimeout(flush, NOTE_DELAY_MS);
          }}
          onBlur={flush}
        />
      </label>}
      {!many && rich.links.length > 0 && (
        <div className="field">
          <span className="flabel">Links in this topic</span>
          <ul className="links">
            {rich.links.map((l, i) => (
              <li key={`${i}-${l.href}`}>
                <a href={l.href} target="_blank" rel="noopener noreferrer" onMouseDown={noFocus}>{l.label} ↗</a>
                <span>{l.href}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
      {!many && <div className="field">
        <span className="flabel">Image</span>
        {node.image ? (
          <div className="image-actions">
            <div className="chips" role="group" aria-label="Image size">
              {IMAGE_SIZE_KEYS.map((sz) => (
                <button
                  key={sz}
                  type="button"
                  className="chip"
                  aria-pressed={node.image!.w === IMAGE_SIZES[sz]}
                  disabled={uploading}
                  onMouseDown={noFocus}
                  onClick={() => onImageSize(sz)}
                >
                  {sz}
                </button>
              ))}
            </div>
            <button
              type="button"
              onMouseDown={noFocus}
              onClick={pickImage}
              disabled={uploading || newTopicOpen}
              title={newTopicOpen ? 'Finish the new topic first (Enter)' : undefined}
            >
              {uploading ? 'Uploading…' : 'Replace…'}
            </button>
            {/* Locked while a replacement uploads: its late arrival would otherwise undo a Remove or a resize. */}
            <button type="button" onMouseDown={noFocus} onClick={onImageRemove} disabled={uploading}>Remove</button>
            <p className="muted hint image-size">{node.image.w} × {node.image.h} px. For any other size, drag the corner of the image.</p>
          </div>
        ) : (
          <button
            type="button"
            onMouseDown={noFocus}
            onClick={pickImage}
            disabled={uploading || newTopicOpen}
            title={newTopicOpen ? 'Finish the new topic first (Enter)' : undefined}
          >
            {uploading ? 'Uploading…' : 'Add image…'}
          </button>
        )}
        <input
          ref={imageInput}
          type="file"
          accept="image/png,image/jpeg,image/webp,image/gif,image/svg+xml,.svg"
          aria-label="Image file"
          className="image-file-input"
          onChange={(e) => {
            const file = e.target.files?.[0] ?? null;
            e.target.value = '';
            if (file) onImageFile(file);
          }}
        />
      </div>}
      {!many && <p className="muted hint">Select a topic and press ⌘/Ctrl K to link all of it. While editing, select words and press ⌘/Ctrl K, or paste a link over them.</p>}
    </aside>
  );
}
