import { useEffect, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState, type PointerEvent, type Ref } from 'react';
import { displaySize } from '../io/imagePrep';
import { measureTopic, type Bounds, type MapLayout, type Measured, type TopicBox } from '../layout/map';
import type { Measure } from '../layout/wrap';
import { renderMap, storedImageKey } from '../render/renderMap';
import { WRAP_MAX_PX, WRAP_MIN_PX } from '../shared/types';
import { learnPictureSize, pictureSize } from './pictureSize';
import { dropAt, type Drop, type DropAt } from './reorder';
import { ensureVisible, fitView, zoomAt, type View } from './viewport';

export interface CanvasHandle {
  fit(): void;
  zoomBy(factor: number): void;
  view(): View;
  ensureVisible(id: string): void;
  /** Moves the canvas, if need be, so that this place on the map shows (the box a text is typed into, as it grows). */
  reveal(place: Bounds): void;
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
  /**
   * A box dragged over the background: every topic it touches, in drawing order. An empty list, which a
   * click or a tap on the background also gives, means nothing is selected.
   */
  onSelectMany?(ids: string[]): void;
  onEdit?(id: string): void;
  /** Topic `id` (with the rest of a multi-selection it is part of) was dragged to a place: onto a topic, or next to one. */
  onMove?(id: string, drop: Drop): void;
  /** The corner of topic `id`'s image was dragged to a new size (px, in the picture's proportions). */
  onResizeImage?(id: string, size: Size): void;
  /**
   * The side of topic `id` was dragged to where its text is to wrap (px), or double-clicked (null: where
   * its level says, again). Needs `measure`, which shows what the topic becomes during the drag.
   */
  onWrapText?(id: string, wrap: number | null): void;
  /** Measures text the way the layout was measured. */
  measure?: Measure;
  onViewChange?(view: View): void;
  onDropFile?(topicId: string | null, file: File): void;
  /** View-only page: the note icon of topic `id` was tapped, or activated from the keyboard. */
  onNote?(id: string): void;
  rightInset?: number;
  fitMaxK?: number;
  ref?: Ref<CanvasHandle>;
}

type Gesture =
  /**
   * `link` / `note`: what a press that never became a drag opens (view-only page). `clear`: a finger on the
   * editor's background, where a tap that never became a drag selects nothing, like a click there.
   */
  | { kind: 'pan'; x: number; y: number; tx: number; ty: number; link: string | null; note: Element | null; clear: boolean; moved: boolean }
  /** `base`: what Shift keeps selected while the box adds to it. `last`: the selection last reported. */
  | { kind: 'box'; x: number; y: number; base: string[]; last: string | null; moved: boolean }
  /** `grouped`: the pressed topic is one of several selected ones, so a drag moves them all (`moving`). */
  | { kind: 'topic'; id: string; x: number; y: number; moved: boolean; dbl: boolean; grouped: boolean; moving: string[]; ghosts: SVGGElement[] }
  | { kind: 'link'; x: number; y: number; href: string; moved: boolean };

interface Size {
  w: number;
  h: number;
}

/**
 * A drag of the corner of a topic's image. `key`: the picture the image showed at the press. `x`, `y`: where
 * the press was, on screen. `gx`, `gy`: how far from the corner the press was, in map units, so the corner
 * keeps that distance to the pointer. `from`: the size the image had. `own`: the size whose proportions are
 * kept. `size`: the size the drag is at now.
 */
interface Resize {
  id: string;
  key: string;
  x: number;
  y: number;
  gx: number;
  gy: number;
  from: Size;
  own: Size;
  size: Size;
  moved: boolean;
}

/**
 * A drag of the side of a topic's text. `x`, `y`: where the press was, on screen. `g`: how far from the
 * topic's edge the press was, in map units, so the edge keeps that distance to the pointer. `wrap`: the
 * width the drag is at now.
 */
interface Rewrap {
  id: string;
  x: number;
  y: number;
  g: number;
  wrap: number;
  moved: boolean;
}

/**
 * What the dashed outline of a drag shows: a box in map units, and what it says under it. `under`: what
 * else the words go under (the topic as it is now, which may reach lower than the outline). `words`: the
 * part of the outline the words are at, which is the part that stays where it is while the rest grows
 * (default: its start, the left edge).
 */
interface Outline {
  x: number;
  y: number;
  w: number;
  h: number;
  label: string;
  under?: number;
  words?: 'middle' | 'end';
}

const NO_IDS: readonly string[] = [];

/** What of a topic's width is not text: its padding, and the room of a priority badge and of the note icon. */
const notText = (b: TopicBox): number => b.style.padX * 2 + b.badgeW + b.noteW;
/** The edge a topic's text grows towards: its left one on the left of the map, else its right one. */
const outerEdge = (b: TopicBox): number => (b.side === -1 ? b.x : b.x + b.w);
/**
 * Where that edge is when the text is `wrap` wide. The central topic is centred, so it grows to both
 * sides; every other topic grows away from its parent.
 */
function edgeAt(b: TopicBox, wrap: number): number {
  const w = wrap + notText(b);
  if (b.parentId === null) return b.x + b.w / 2 + w / 2;
  return b.side === -1 ? b.x + b.w - w : b.x + w;
}
/** The text width that puts that edge at `edge`, within what a map may hold. */
function wrapAt(b: TopicBox, edge: number): number {
  const w = b.parentId === null ? 2 * (edge - (b.x + b.w / 2)) : b.side === -1 ? b.x + b.w - edge : edge - b.x;
  return Math.min(WRAP_MAX_PX, Math.max(WRAP_MIN_PX, Math.round(w - notText(b))));
}

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
  layout, selectedId, extraIds = NO_IDS, interactive, onToggleFold, onSelect, onToggleSelect, onSelectMany, onEdit, onMove, onResizeImage, onWrapText, measure,
  onViewChange, onDropFile, onNote, rightInset = 0, fitMaxK, ref,
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
  const handleRef = useRef<HTMLDivElement>(null);
  const sizeBoxRef = useRef<HTMLDivElement>(null);
  const resizing = useRef<Resize | null>(null);
  const wrapHandleRef = useRef<HTMLDivElement>(null);
  const rewrapping = useRef<Rewrap | null>(null);
  // The handles are for the only selected topic.
  const only = interactive && selectedId !== null && extraIds.length === 0 ? layout.byId.get(selectedId) : undefined;
  // The image whose corner can be dragged: that topic's, when the canvas draws it.
  const sized = onResizeImage && only?.image && storedImageKey(only) ? only : null;
  const sizedRef = useRef(sized);
  sizedRef.current = sized;
  // The topic whose side can be dragged: that topic, when it has text to wrap.
  const wrapped = onWrapText && measure && only && only.lines.length > 0 ? only : null;
  const wrappedRef = useRef(wrapped);
  wrappedRef.current = wrapped;
  // Read through refs: the wheel moves the canvas with the functions of the first render.
  const measureRef = useRef(measure);
  measureRef.current = measure;
  const kindRef = useRef(layout.kind);
  kindRef.current = layout.kind;
  const sizedKey = sized?.node.image?.key;
  useEffect(() => {
    if (sizedKey) learnPictureSize(sizedKey);
  }, [sizedKey]);

  const size = (): [number, number] => {
    const r = svgRef.current?.getBoundingClientRect();
    return [r?.width ?? 0, r?.height ?? 0];
  };
  /**
   * The drag of the handle that is on. It is over, without a new size, once its image is no longer the one
   * with the handle: the selection moved on, the image was replaced or removed, or no new size is taken
   * any more (an upload started).
   */
  const liveResize = (): Resize | null => {
    const r = resizing.current;
    const b = sizedRef.current;
    if (r && (b?.id !== r.id || b.node.image?.key !== r.key)) resizing.current = null;
    return resizing.current;
  };
  /** The same for a drag of the side of a topic's text: over once that topic is no longer the one with the handle. */
  const liveRewrap = (): Rewrap | null => {
    const r = rewrapping.current;
    if (r && wrappedRef.current?.id !== r.id) rewrapping.current = null;
    return rewrapping.current;
  };
  /** The topic as it is when its text wraps at `wrap`, and whether any word is on another line then. */
  const rewrapped = (b: TopicBox, wrap: number): { becomes: Measured; changes: boolean } => {
    const becomes = measureTopic({ ...b.node, wrap }, b.depth, measureRef.current!, kindRef.current);
    return { becomes, changes: becomes.lines.join('\n') !== b.lines.join('\n') };
  };
  /**
   * Puts the handle on the bottom-right corner of the selected topic's image. During a drag of the handle
   * it goes on the corner of the new size, which is what the outline is to show then.
   */
  const placeImageHandle = (v: View): Outline | null => {
    const el = handleRef.current;
    if (!el) return null;
    const b = sizedRef.current;
    const drag = liveResize();
    const r = drag?.moved ? drag : null;
    el.hidden = !b?.image;
    if (!b?.image) return null;
    const x = b.x + b.image.x;
    const y = b.y + b.image.y;
    const { w, h } = r ? r.size : b.image;
    el.style.left = `${v.tx + v.k * (x + w)}px`;
    el.style.top = `${v.ty + v.k * (y + h)}px`;
    return r && { x, y, w, h, label: `${w} × ${h}` };
  };
  /**
   * Puts the other handle on the edge the selected topic's text grows towards, at the middle of the text.
   * During a drag of the handle it goes where the pointer wants the edge, and the outline is to show the
   * topic with its text wrapped at that width: it grows from where the topic is held by the layout, as
   * the topic itself will.
   */
  const placeWrapHandle = (v: View): Outline | null => {
    const el = wrapHandleRef.current;
    if (!el) return null;
    const b = wrappedRef.current;
    const drag = liveRewrap();
    const r = drag?.moved ? drag : null;
    el.hidden = !b;
    if (!b) return null;
    // The style sheet puts the bar just inside the edge, on either side: the fold button is just outside it.
    el.classList.toggle('left', b.side === -1);
    el.style.left = `${v.tx + v.k * (r ? edgeAt(b, r.wrap) : outerEdge(b))}px`;
    el.style.top = `${v.ty + v.k * (b.y + b.textTop + (b.lines.length * b.style.lineHeight) / 2)}px`;
    if (!r) return null;
    const { becomes, changes } = rewrapped(b, r.wrap);
    return {
      x: b.parentId === null ? b.x + (b.w - becomes.w) / 2 : b.side === -1 ? b.x + b.w - becomes.w : b.x,
      y: kindRef.current === 'org' ? b.y : b.y + (b.h - becomes.h) / 2,
      w: becomes.w, h: becomes.h, label: changes ? `${r.wrap} px` : 'No change', under: b.y + b.h,
      ...(b.parentId === null ? { words: 'middle' as const } : b.side === -1 ? { words: 'end' as const } : {}),
    };
  };
  /**
   * Places both handles, and the dashed outline of the drag that is on. All in screen pixels, so they
   * have the same size at every zoom.
   */
  const placeHandles = (v: View) => {
    const ofImage = placeImageHandle(v);
    const ofText = placeWrapHandle(v);
    const shown = ofImage ?? ofText;
    const outline = sizeBoxRef.current;
    if (!outline) return;
    outline.hidden = !shown;
    if (!shown) return;
    Object.assign(outline.style, {
      left: `${v.tx + v.k * shown.x}px`, top: `${v.ty + v.k * shown.y}px`, width: `${v.k * shown.w}px`, height: `${v.k * shown.h}px`,
    });
    outline.dataset.words = shown.words ?? 'start';
    const words = outline.firstElementChild as HTMLElement;
    words.textContent = shown.label;
    words.style.top = `${v.k * (Math.max(shown.under ?? shown.y, shown.y + shown.h) - shown.y) + 5}px`;
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
    placeHandles(v);
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
  // A handle comes and goes with what it is for, also when the map itself is not drawn again (new sizes
  // stop being taken while an image uploads, new widths while a text box is open).
  useLayoutEffect(() => placeHandles(viewRef.current), [sized, wrapped]); // eslint-disable-line react-hooks/exhaustive-deps

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
    reveal: (place) => {
      const [w, h] = size();
      if (w > 0) applyView(ensureVisible(viewRef.current, place, w - rightInset, h, 24));
    },
    svg: () => svgRef.current,
  }));

  // Wheel needs a non-passive listener so preventDefault works. On the whole canvas, so that the wheel
  // over the image handle moves the map too, instead of scrolling or zooming the page.
  useEffect(() => {
    const svg = svgRef.current!;
    const canvas = canvasRef.current!;
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
    canvas.addEventListener('wheel', onWheel, { passive: false });
    return () => canvas.removeEventListener('wheel', onWheel);
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
    const startPan = (link: string | null, note: Element | null = null, clear = false) => {
      svgRef.current?.setPointerCapture?.(e.pointerId);
      gesture.current = { kind: 'pan', x: e.clientX, y: e.clientY, tx: viewRef.current.tx, ty: viewRef.current.ty, link, note, clear, moved: false };
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
        startPan(interactive ? null : href, notesOpen ? target.closest('[data-note]') : null, interactive && !e.shiftKey);
        return;
      }
      svgRef.current?.setPointerCapture?.(e.pointerId);
      const base = e.shiftKey && selectedId ? [selectedId, ...extraIds] : [];
      gesture.current = { kind: 'box', x: e.clientX, y: e.clientY, base, last: null, moved: false };
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
    // A box that touches nothing (and keeps nothing with Shift) reports no topic: nothing is selected then.
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
      else if (g.clear) onSelectMany?.([]);
      return;
    }
    if (g.kind === 'box') {
      if (boxRef.current) boxRef.current.hidden = true;
      // A plain click on the background (no box, no Shift) selects nothing.
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

  /** Where the pointer is on the map, in map units. */
  const onMap = (e: PointerEvent<HTMLDivElement>): [number, number] => {
    const r = canvasRef.current!.getBoundingClientRect();
    const { tx, ty, k } = viewRef.current;
    return [(e.clientX - r.left - tx) / k, (e.clientY - r.top - ty) / k];
  };
  const startResize = (e: PointerEvent<HTMLDivElement>) => {
    const b = sizedRef.current;
    if (e.button !== 0 || !b?.image) return;
    // One drag at a time: a press here (a second finger) ends a drag of the other handle, without a change.
    endRewrap(true);
    e.currentTarget.setPointerCapture?.(e.pointerId);
    const from = { w: b.image.w, h: b.image.h };
    const key = b.node.image!.key;
    const [px, py] = onMap(e);
    resizing.current = {
      id: b.id, key, x: e.clientX, y: e.clientY,
      gx: px - (b.x + b.image.x + from.w), gy: py - (b.y + b.image.y + from.h),
      // The picture's own proportions when the browser knows them; else those of the size it has now.
      from, own: pictureSize(key) ?? from, size: from, moved: false,
    };
  };
  const moveResize = (e: PointerEvent<HTMLDivElement>) => {
    const r = liveResize();
    const b = sizedRef.current;
    if (!r || !b?.image) return;
    if (e.buttons === 0) {
      // The release never arrived (see onPointerMove): stop without a new size.
      endResize(true);
      return;
    }
    if (!r.moved && Math.hypot(e.clientX - r.x, e.clientY - r.y) < 3) return;
    r.moved = true;
    // Where the pointer wants the corner, from the image's top-left corner. In map units, and from where
    // the image is now, so the corner stays with the pointer when the canvas moves or zooms during the drag.
    const [px, py] = onMap(e);
    const cw = px - r.gx - (b.x + b.image.x);
    const ch = py - r.gy - (b.y + b.image.y);
    // The proportions are kept, so the corner can only be somewhere on the image's diagonal: it goes to
    // the point of the diagonal nearest to where the pointer wants it.
    const { w, h } = r.from;
    r.size = displaySize(r.own.w, r.own.h, ((cw * w + ch * h) / (w * w + h * h)) * w);
    placeHandles(viewRef.current);
  };
  const endResize = (cancelled: boolean) => {
    const r = liveResize();
    if (!r) return;
    resizing.current = null;
    placeHandles(viewRef.current);
    if (!cancelled && r.moved && r.size.w !== sizedRef.current?.image?.w) onResizeImage?.(r.id, r.size);
  };

  const startRewrap = (e: PointerEvent<HTMLDivElement>) => {
    const b = wrappedRef.current;
    if (e.button !== 0 || !b) return;
    endResize(true);
    e.currentTarget.setPointerCapture?.(e.pointerId);
    const edge = outerEdge(b);
    rewrapping.current = { id: b.id, x: e.clientX, y: e.clientY, g: onMap(e)[0] - edge, wrap: wrapAt(b, edge), moved: false };
  };
  const moveRewrap = (e: PointerEvent<HTMLDivElement>) => {
    const r = liveRewrap();
    const b = wrappedRef.current;
    if (!r || !b) return;
    if (e.buttons === 0) {
      // The release never arrived (see onPointerMove): stop without a new width.
      endRewrap(true);
      return;
    }
    if (!r.moved && Math.hypot(e.clientX - r.x, e.clientY - r.y) < 3) return;
    r.moved = true;
    // Where the pointer wants the edge, in map units and from where the topic is now, so the edge stays
    // with the pointer when the canvas moves or zooms during the drag.
    r.wrap = wrapAt(b, onMap(e)[0] - r.g);
    placeHandles(viewRef.current);
  };
  const endRewrap = (cancelled: boolean) => {
    const r = liveRewrap();
    if (!r) return;
    rewrapping.current = null;
    placeHandles(viewRef.current);
    const b = wrappedRef.current;
    // The topic is as narrow as its text, so a width that leaves every word on its line would change
    // nothing that shows. It is not kept: it would only wrap a later, longer text somewhere unexpected.
    if (!cancelled && r.moved && b && rewrapped(b, r.wrap).changes) onWrapText?.(r.id, r.wrap);
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
      {interactive && (
        <>
          {/* What a handle is being dragged to: the image's new size, or the topic with its text wrapped
              at the new width. Screen pixels, moved by hand like the selection box. */}
          <div ref={sizeBoxRef} className="size-box" hidden><span /></div>
          {/* The corner of the selected topic's image: dragged to resize it. For the pointer only; the
              keyboard has the S, M and L buttons of the Details panel. */}
          <div
            ref={handleRef}
            className="image-handle"
            hidden
            aria-hidden="true"
            title="Drag to resize the image"
            // Keeps the keyboard where it is, like the buttons of the panels.
            onMouseDown={(e) => e.preventDefault()}
            // No browser menu here either: on the canvas the right button moves the map.
            onContextMenu={(e) => e.preventDefault()}
            onPointerDown={startResize}
            onPointerMove={moveResize}
            onPointerUp={() => endResize(false)}
            onPointerCancel={() => endResize(true)}
            onLostPointerCapture={() => endResize(true)}
          />
          {/* The side of the selected topic's text: dragged to set where the text wraps. For the pointer
              only too; the keyboard has Narrower, Wider and Automatic in the Details panel. */}
          <div
            ref={wrapHandleRef}
            className="wrap-handle"
            hidden
            aria-hidden="true"
            title="Drag to set where the text wraps. Double-click for the automatic width."
            onMouseDown={(e) => e.preventDefault()}
            onContextMenu={(e) => e.preventDefault()}
            onPointerDown={startRewrap}
            onPointerMove={moveRewrap}
            onPointerUp={() => endRewrap(false)}
            onPointerCancel={() => endRewrap(true)}
            onLostPointerCapture={() => endRewrap(true)}
            onDoubleClick={() => {
              const b = wrappedRef.current;
              if (b && b.node.wrap !== undefined) onWrapText?.(b.id, null);
            }}
          />
        </>
      )}
    </div>
  );
}
