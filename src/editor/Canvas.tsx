import { useEffect, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState, type PointerEvent, type Ref } from 'react';
import type { MapLayout } from '../layout/map';
import { renderMap } from '../render/renderMap';
import { dropAt, type Drop, type DropAt } from './reorder';
import { ensureVisible, fitView, zoomAt, type View } from './viewport';

export interface CanvasHandle {
  fit(): void;
  zoomBy(factor: number): void;
  view(): View;
  ensureVisible(id: string): void;
  svg(): SVGSVGElement | null;
}

interface Props {
  layout: MapLayout;
  selectedId: string | null;
  /** The other topics of a multi-selection; never holds `selectedId`. */
  extraIds?: readonly string[];
  interactive: boolean;
  onToggleFold(id: string): void;
  onSelect?(id: string): void;
  /** Shift-click on a topic: it joins the selection or leaves it. */
  onToggleSelect?(id: string): void;
  /** A box dragged over the background: every topic it touches, in drawing order (none: an empty list). */
  onSelectMany?(ids: string[]): void;
  onEdit?(id: string): void;
  /** Topic `id` (with the rest of a multi-selection it is part of) was dragged to a place: onto a topic, or next to one. */
  onMove?(id: string, drop: Drop): void;
  onViewChange?(view: View): void;
  onDropFile?(topicId: string | null, file: File): void;
  /** View-only page: the note icon of topic `id` was tapped, or activated from the keyboard. */
  onNote?(id: string): void;
  rightInset?: number;
  fitMaxK?: number;
  ref?: Ref<CanvasHandle>;
}

type Gesture =
  /** `link` / `note`: what a press that never became a drag opens (view-only page). */
  | { kind: 'pan'; x: number; y: number; tx: number; ty: number; link: string | null; note: Element | null; moved: boolean }
  /**
   * `base`: what Shift keeps selected while the box adds to it. `origin`: the current topic when the drag
   * began, which stays selected when the box touches nothing. `last`: the selection last reported.
   */
  | { kind: 'box'; x: number; y: number; base: string[]; origin: string | null; last: string | null; moved: boolean }
  /** `grouped`: the pressed topic is one of several selected ones, so a drag moves them all (`moving`). */
  | { kind: 'topic'; id: string; x: number; y: number; moved: boolean; dbl: boolean; grouped: boolean; moving: string[]; ghosts: SVGGElement[] }
  | { kind: 'link'; x: number; y: number; href: string; moved: boolean };

const NO_IDS: readonly string[] = [];

/**
 * The world groups a dragged topic's bits live on besides the drawing's own overlay ghost: the photo
 * (unfiltered, keeps its colours) and the frame (filtered, stays on top of the photo like everywhere else).
 * One list instead of a photo/frame pair of near-duplicate fields and effects.
 */
interface SideLayer {
  world: SVGGElement | null;
  ghostParent: SVGGElement | null;
  selector(id: string): string;
  ghostClass: string;
}

/** Opens a topic's link in a new tab, without giving that page a handle on this one. */
function openLink(href: string) {
  if (/^https?:\/\//i.test(href)) window.open(href, '_blank', 'noopener,noreferrer');
}

export function Canvas({
  layout, selectedId, extraIds = NO_IDS, interactive, onToggleFold, onSelect, onToggleSelect, onSelectMany, onEdit, onMove, onViewChange, onDropFile, onNote,
  rightInset = 0, fitMaxK, ref,
}: Props) {
  const canvasRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const worldRef = useRef<SVGGElement>(null);
  const overlayRef = useRef<SVGGElement>(null);
  const dropLineRef = useRef<SVGGElement>(null);
  const photosRef = useRef<SVGGElement>(null);
  const photosGhostRef = useRef<SVGGElement>(null);
  const framesRef = useRef<SVGGElement>(null);
  const framesGhostRef = useRef<SVGGElement>(null);
  const viewRef = useRef<View>({ tx: 0, ty: 0, k: 1 });
  const fitted = useRef(false);
  const gesture = useRef<Gesture | null>(null);
  const lastDown = useRef({ id: '', t: 0 });
  const [drop, setDropState] = useState<DropAt | null>(null);
  const dropRef = useRef<DropAt | null>(null);
  /** The topic marked as the one the dragged topics would go onto; a place next to a topic shows a line instead. */
  const dropInto = drop?.where === 'into' ? drop.targetId : null;
  const onViewChangeRef = useRef(onViewChange);
  onViewChangeRef.current = onViewChange;

  const size = (): [number, number] => {
    const r = svgRef.current?.getBoundingClientRect();
    return [r?.width ?? 0, r?.height ?? 0];
  };
  const applyView = (v: View) => {
    viewRef.current = v;
    const t = `translate(${v.tx} ${v.ty}) scale(${v.k})`;
    worldRef.current?.setAttribute('transform', t);
    overlayRef.current?.setAttribute('transform', t);
    dropLineRef.current?.setAttribute('transform', t);
    photosRef.current?.setAttribute('transform', t);
    photosGhostRef.current?.setAttribute('transform', t);
    framesRef.current?.setAttribute('transform', t);
    framesGhostRef.current?.setAttribute('transform', t);
    onViewChangeRef.current?.(v);
  };
  const fit = () => {
    const [w, h] = size();
    if (w > 0) applyView(fitView(layout.bounds, w, h, { rightInset, maxK: fitMaxK }));
  };

  const selectedSet = useMemo(() => new Set(extraIds), [extraIds]);
  // In the view-only page a note opens on a tap of its icon; in the editor the note is in the Details panel.
  const notesOpen = !interactive && !!onNote;
  useLayoutEffect(() => {
    renderMap(svgRef.current!, worldRef.current!, layout, {
      selectedId, selectedIds: selectedSet, dropTargetId: dropInto, photos: photosRef.current ?? undefined, frames: framesRef.current ?? undefined,
      noteButtons: notesOpen,
    });
    if (!fitted.current && size()[0] > 0) {
      fitted.current = true;
      fit();
    } else {
      applyView(viewRef.current);
    }
  }, [layout, selectedId, selectedSet, dropInto, notesOpen]); // eslint-disable-line react-hooks/exhaustive-deps

  useImperativeHandle(ref, () => ({
    fit,
    zoomBy: (factor) => {
      const [w, h] = size();
      applyView(zoomAt(viewRef.current, factor, w / 2, h / 2));
    },
    view: () => viewRef.current,
    ensureVisible: (id) => {
      // While a selection box is being dragged the canvas stays put: the box is drawn in screen space.
      if (gesture.current?.kind === 'box') return;
      const b = layout.byId.get(id);
      const [w, h] = size();
      // Keep the topic clear of a panel on the right (the Details sidebar).
      if (b && w > 0) applyView(ensureVisible(viewRef.current, b, w - rightInset, h));
    },
    svg: () => svgRef.current,
  }));

  // Wheel needs a non-passive listener so preventDefault works.
  useEffect(() => {
    const svg = svgRef.current!;
    const onWheel = (e: WheelEvent) => {
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault();
        const r = svg.getBoundingClientRect();
        applyView(zoomAt(viewRef.current, Math.exp(-e.deltaY * 0.01), e.clientX - r.left, e.clientY - r.top));
      } else if (interactive) {
        e.preventDefault();
        applyView({ ...viewRef.current, tx: viewRef.current.tx - e.deltaX, ty: viewRef.current.ty - e.deltaY });
      }
    };
    svg.addEventListener('wheel', onWheel, { passive: false });
    return () => svg.removeEventListener('wheel', onWheel);
  }, [interactive]); // eslint-disable-line react-hooks/exhaustive-deps

  // On Windows and Linux the right-click menu opens when the button is released, wherever the pointer is
  // by then (the Details panel, the toolbar), so the canvas's own handler can't stop it. A right-button drag
  // therefore holds the menu back for the whole page until shortly after the release.
  const menuHeld = useRef(false);
  const menuTimer = useRef<number | undefined>(undefined);
  useEffect(() => {
    if (!interactive) return;
    const hold = (e: MouseEvent) => {
      if (menuHeld.current) e.preventDefault();
    };
    window.addEventListener('contextmenu', hold, true);
    return () => {
      window.removeEventListener('contextmenu', hold, true);
      window.clearTimeout(menuTimer.current);
    };
  }, [interactive]);
  const holdMenu = () => {
    window.clearTimeout(menuTimer.current);
    menuHeld.current = true;
  };
  const letMenuGo = () => {
    if (!menuHeld.current) return;
    window.clearTimeout(menuTimer.current);
    menuTimer.current = window.setTimeout(() => {
      menuHeld.current = false;
    }, 300);
  };

  const setDrop = (next: DropAt | null) => {
    const now = dropRef.current;
    // Every change redraws, so the same place found again (each mouse move) is not one.
    if (now?.targetId === next?.targetId && now?.where === next?.where && now?.side === next?.side) return;
    dropRef.current = next;
    setDropState(next);
  };

  /**
   * Where the dragged topics would go if released at the pointer. Worked out from the layout, in map
   * units, so the edges of a topic and the gaps between topics count too. Nowhere while the pointer is
   * over something that covers the canvas (the Details panel, the toolbar) or outside it.
   */
  const placeAt = (e: PointerEvent<SVGSVGElement>, moving: readonly string[]): DropAt | null => {
    const over = document.elementFromPoint?.(e.clientX, e.clientY);
    if (over && !canvasRef.current?.contains(over)) return null;
    const r = svgRef.current!.getBoundingClientRect();
    if (r.width > 0 && (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom)) return null;
    const { tx, ty, k } = viewRef.current;
    return dropAt(layout, (e.clientX - r.left - tx) / k, (e.clientY - r.top - ty) / k, moving);
  };

  /** Where a dragged topic's photo and frame live, each paired with where its drag ghost goes. */
  const sideLayers = (): SideLayer[] => [
    { world: photosRef.current, ghostParent: photosGhostRef.current, selector: (id) => `image[data-id="${id}"]`, ghostClass: 'ghost-photo' },
    { world: framesRef.current, ghostParent: framesGhostRef.current, selector: (id) => `g.topic-frame[data-id="${id}"]`, ghostClass: 'ghost-frame' },
  ];

  /** Clears what a gesture put on screen (drag ghosts, the drop target, the selection box) without firing onMove/onEdit. */
  const releaseGesture = (g: Gesture) => {
    if (g.kind === 'topic') {
      g.ghosts.forEach((el) => el.remove());
      setDrop(null);
    } else if (g.kind === 'box' && boxRef.current) {
      boxRef.current.hidden = true;
    }
  };

  /**
   * The selected topics a drag moves: those not inside another selected one. The root never moves, and
   * a selected root does not stand in for the topics below it.
   */
  const selectedTops = (): string[] => {
    const chosen = new Set(selectedId ? [selectedId, ...extraIds] : extraIds);
    const out: string[] = [];
    for (const b of layout.boxes) {
      if (!chosen.has(b.id) || b.parentId == null) continue;
      let up = layout.byId.get(b.parentId);
      while (up && (up.parentId == null || !chosen.has(up.id))) up = up.parentId == null ? undefined : layout.byId.get(up.parentId);
      if (!up) out.push(b.id);
    }
    return out;
  };

  const onPointerDown = (e: PointerEvent<SVGSVGElement>) => {
    // In the editor the right (or middle) button moves the canvas, from anywhere; the left button selects.
    const panButton = interactive && (e.button === 1 || e.button === 2);
    if (e.button !== 0 && !panButton) return;
    if (gesture.current) {
      // A previous pointerup/pointercancel never arrived; clean up before starting a new gesture.
      releaseGesture(gesture.current);
      gesture.current = null;
    }
    const startPan = (link: string | null, note: Element | null = null) => {
      svgRef.current?.setPointerCapture?.(e.pointerId);
      gesture.current = { kind: 'pan', x: e.clientX, y: e.clientY, tx: viewRef.current.tx, ty: viewRef.current.ty, link, note, moved: false };
    };
    if (panButton) {
      if (e.button === 2) holdMenu();
      startPan(null);
      return;
    }
    const target = e.target as Element;
    const fold = target.closest('[data-fold]');
    if (fold) {
      onToggleFold(fold.getAttribute('data-fold')!);
      return;
    }
    const href = target.closest('a')?.getAttribute('href') ?? null;
    if (href && interactive && (e.metaKey || e.ctrlKey)) {
      gesture.current = { kind: 'link', x: e.clientX, y: e.clientY, href, moved: false };
      return;
    }
    const topic = interactive ? target.closest('g.topic') : null;
    if (!topic) {
      // The view-only page has nothing to select, and a finger has no second button: there a drag on the
      // background moves the canvas. In the editor, with a mouse, it draws a selection box.
      if (!interactive || e.pointerType === 'touch') {
        startPan(interactive ? null : href, notesOpen ? target.closest('[data-note]') : null);
        return;
      }
      svgRef.current?.setPointerCapture?.(e.pointerId);
      const base = e.shiftKey && selectedId ? [selectedId, ...extraIds] : [];
      gesture.current = { kind: 'box', x: e.clientX, y: e.clientY, base, origin: selectedId, last: null, moved: false };
      return;
    }
    const id = topic.getAttribute('data-id')!;
    if (e.shiftKey) {
      onToggleSelect?.(id);
      return;
    }
    svgRef.current?.setPointerCapture?.(e.pointerId);
    const now = Date.now();
    const dbl = lastDown.current.id === id && now - lastDown.current.t < 420;
    lastDown.current = { id, t: dbl ? 0 : now };
    // Pressing one of several selected topics keeps them all selected, so the press can start a drag of
    // the whole group; released without a drag, it selects just that topic (see endGesture).
    const grouped = extraIds.length > 0 && (id === selectedId || extraIds.includes(id));
    if (!grouped) onSelect?.(id);
    gesture.current = { kind: 'topic', id, x: e.clientX, y: e.clientY, moved: false, dbl, grouped, moving: [id], ghosts: [] };
  };

  /** Draws the selection box from where the drag started to the pointer and reports the topics it touches. */
  const dragBox = (g: Extract<Gesture, { kind: 'box' }>, e: PointerEvent<SVGSVGElement>) => {
    const r = svgRef.current!.getBoundingClientRect();
    const x0 = Math.min(g.x, e.clientX) - r.left;
    const y0 = Math.min(g.y, e.clientY) - r.top;
    const w = Math.abs(e.clientX - g.x);
    const h = Math.abs(e.clientY - g.y);
    const mark = boxRef.current;
    if (mark) {
      mark.hidden = false;
      Object.assign(mark.style, { left: `${x0}px`, top: `${y0}px`, width: `${w}px`, height: `${h}px` });
    }
    // The box is in screen pixels; the topics are in map units.
    const { tx, ty, k } = viewRef.current;
    const [left, top, right, bottom] = [(x0 - tx) / k, (y0 - ty) / k, (x0 + w - tx) / k, (y0 + h - ty) / k];
    const kept = new Set(g.base);
    const ids = [...g.base];
    for (const b of layout.boxes) {
      if (!kept.has(b.id) && b.x < right && b.x + b.w > left && b.y < bottom && b.y + b.h > top) ids.push(b.id);
    }
    // The editor follows every report, so once the box has selected a topic that topic is its current one.
    // A box that has let go of everything therefore names the topic that was current before the drag.
    if (!ids.length && g.origin) ids.push(g.origin);
    // Every report redraws the map, so only a change in what is touched is reported.
    const key = ids.join(' ');
    if (key === g.last) return;
    g.last = key;
    onSelectMany?.(ids);
  };

  const onPointerMove = (e: PointerEvent<SVGSVGElement>) => {
    const g = gesture.current;
    if (!g) return;
    if (e.buttons === 0) {
      // The browser never delivered pointerup/pointercancel (e.g. released off-window); recover quietly.
      releaseGesture(g);
      gesture.current = null;
      letMenuGo();
      return;
    }
    const dx = e.clientX - g.x;
    const dy = e.clientY - g.y;
    if (g.kind === 'link') {
      if (!g.moved && Math.hypot(dx, dy) >= 6) g.moved = true;
      return;
    }
    if (g.kind === 'pan') {
      if (!g.moved && Math.hypot(dx, dy) >= 6) g.moved = true;
      applyView({ ...viewRef.current, tx: g.tx + dx, ty: g.ty + dy });
      return;
    }
    if (g.kind === 'box') {
      if (!g.moved && Math.hypot(dx, dy) < 4) return;
      g.moved = true;
      dragBox(g, e);
      return;
    }
    if (!g.moved) {
      if (Math.hypot(dx, dy) < 6 || layout.byId.get(g.id)?.parentId == null) return;
      g.moved = true;
      if (g.grouped) g.moving = selectedTops();
      for (const id of g.moving) {
        const source = worldRef.current?.querySelector(`g.topic[data-id="${id}"]`);
        if (source) {
          const ghost = source.cloneNode(true) as SVGGElement;
          ghost.setAttribute('opacity', '0.55');
          ghost.style.pointerEvents = 'none';
          ghost.querySelectorAll('[pointer-events]').forEach((n) => n.setAttribute('pointer-events', 'none'));
          ghost.setAttribute('pointer-events', 'none');
          overlayRef.current?.appendChild(ghost);
          g.ghosts.push(ghost);
        }
        // The photo and frame clones live on their own (photo: unfiltered; frame: filtered) layers, not in
        // the drawing's ghost, so the photo keeps its colours and the frame keeps sitting above it.
        for (const { world, ghostParent, selector, ghostClass } of sideLayers()) {
          const sideSource = world?.querySelector(selector(id));
          if (!sideSource) continue;
          const ghost = document.createElementNS('http://www.w3.org/2000/svg', 'g');
          ghost.setAttribute('class', ghostClass);
          ghost.setAttribute('opacity', '0.55');
          ghost.appendChild(sideSource.cloneNode(true));
          ghostParent?.appendChild(ghost);
          g.ghosts.push(ghost);
        }
      }
    }
    const dragT = `translate(${dx / viewRef.current.k} ${dy / viewRef.current.k})`;
    g.ghosts.forEach((el) => el.setAttribute('transform', dragT));
    // No dropping a topic on itself or into its own branch; for a group, into any of the moved branches.
    setDrop(placeAt(e, g.moving));
  };

  const endGesture = (e: PointerEvent<SVGSVGElement>, cancelled: boolean) => {
    const g = gesture.current;
    gesture.current = null;
    letMenuGo();
    if (!g) return;
    const still = Math.hypot(e.clientX - g.x, e.clientY - g.y) < 6;
    if (g.kind === 'link') {
      if (still && !g.moved && !cancelled) openLink(g.href);
      return;
    }
    if (g.kind === 'pan') {
      if (!still || g.moved || cancelled) return;
      if (g.note) onNote?.(g.note.getAttribute('data-note')!);
      else if (g.link) openLink(g.link);
      return;
    }
    if (g.kind === 'box') {
      if (boxRef.current) boxRef.current.hidden = true;
      // A plain click on the background (no box, no Shift) leaves only the current topic selected.
      if (!g.moved && !cancelled && !e.shiftKey) onSelectMany?.([]);
      return;
    }
    if (g.moved) {
      g.ghosts.forEach((el) => el.remove());
      const target = dropRef.current;
      setDrop(null);
      if (target && !cancelled) {
        const { line: _line, ...place } = target;
        onMove?.(g.id, place);
      }
      return;
    }
    // A press on one of several selected topics that never became a drag: a click selects just that topic.
    // A press that travelled without dragging anything (the central topic can't be moved) changes nothing.
    if (g.grouped && !cancelled && still) onSelect?.(g.id);
    if (g.dbl) onEdit?.(g.id);
  };

  return (
    <div className="canvas" ref={canvasRef}>
      <svg
        ref={svgRef}
        role="img"
        aria-label="Mind map"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={(e) => endGesture(e, false)}
        onPointerCancel={(e) => endGesture(e, true)}
        onKeyDown={(e) => {
          // A note icon reached with the Tab key (view-only page) opens like a button.
          const icon = notesOpen && (e.key === 'Enter' || e.key === ' ') ? (e.target as Element).closest('[data-note]') : null;
          if (!icon) return;
          e.preventDefault();
          onNote?.(icon.getAttribute('data-note')!);
        }}
        onContextMenu={(e) => {
          // The right button moves the canvas here, and on macOS the menu would open the moment it goes down.
          if (interactive) e.preventDefault();
        }}
        onDragOver={(e) => {
          if (interactive && e.dataTransfer.types.includes('Files')) e.preventDefault();
        }}
        onDrop={(e) => {
          if (!interactive) return;
          e.preventDefault();
          // Any dropped file goes to onDropFile, whatever its claimed type: image preparation sniffs
          // the bytes and says why when it refuses one, instead of the drop being ignored silently.
          const file = e.dataTransfer.files[0];
          if (!file) return;
          const topicId = (e.target as Element).closest('g.topic')?.getAttribute('data-id') ?? null;
          onDropFile?.(topicId, file);
        }}
        onClick={(e) => {
          // Links open from the pointer handlers above, or here from the keyboard; never by the browser's own navigation.
          const a = (e.target as Element).closest('a');
          if (!a) return;
          e.preventDefault();
          if (e.detail === 0) openLink(a.getAttribute('href') ?? '');
        }}
      >
        <g ref={worldRef} className="world" />
        <g ref={overlayRef} className="overlay" />
        {/* Where dragged topics would go when that is next to a topic, not onto one. */}
        <g ref={dropLineRef} className="drop-line">{drop?.line && <line {...drop.line} />}</g>
      </svg>
      {/* Topic images, outside the drawing's dark-mode filter so photos keep their colours; clicks pass through to the drawing. */}
      <svg className="photos" aria-hidden="true">
        <g ref={photosRef} className="photos-world" />
        {/* The dragged topic's photo, also outside the filter. A sibling of photos-world (not passed
            to renderMap as `photos`), so a re-render mid-drag (e.g. the drop-target highlight) never
            wipes it via replaceChildren(). */}
        <g ref={photosGhostRef} className="photos-ghost" />
      </svg>
      {/* Image frames, above the photos but still filtered like the drawing, so the frame's ink stays
          visible (and inverted in dark mode) instead of being hidden under the opaque photo. */}
      <svg className="frames" aria-hidden="true">
        <g ref={framesRef} className="frames-world" />
        <g ref={framesGhostRef} className="frames-ghost" />
      </svg>
      {/* The selection box: screen pixels, moved by hand while dragging so each mouse move costs no render. */}
      <div ref={boxRef} className="select-box" hidden />
    </div>
  );
}
