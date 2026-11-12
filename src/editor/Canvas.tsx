import { useEffect, useImperativeHandle, useLayoutEffect, useRef, useState, type PointerEvent, type Ref } from 'react';
import type { MapLayout } from '../layout/map';
import { isInBranch } from '../model/tree';
import { renderMap } from '../render/renderMap';
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
  interactive: boolean;
  onToggleFold(id: string): void;
  onSelect?(id: string): void;
  onEdit?(id: string): void;
  onMove?(id: string, targetId: string): void;
  onViewChange?(view: View): void;
  rightInset?: number;
  fitMaxK?: number;
  ref?: Ref<CanvasHandle>;
}

type Gesture =
  | { kind: 'pan'; x: number; y: number; tx: number; ty: number }
  | { kind: 'topic'; id: string; x: number; y: number; moved: boolean; dbl: boolean; ghost: SVGGElement | null };

export function Canvas({ layout, selectedId, interactive, onToggleFold, onSelect, onEdit, onMove, onViewChange, rightInset = 0, fitMaxK, ref }: Props) {
  const svgRef = useRef<SVGSVGElement>(null);
  const worldRef = useRef<SVGGElement>(null);
  const overlayRef = useRef<SVGGElement>(null);
  const viewRef = useRef<View>({ tx: 0, ty: 0, k: 1 });
  const fitted = useRef(false);
  const gesture = useRef<Gesture | null>(null);
  const lastDown = useRef({ id: '', t: 0 });
  const [dropTarget, setDropTarget] = useState<string | null>(null);
  const dropRef = useRef<string | null>(null);
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
    onViewChangeRef.current?.(v);
  };
  const fit = () => {
    const [w, h] = size();
    if (w > 0) applyView(fitView(layout.bounds, w, h, { rightInset, maxK: fitMaxK }));
  };

  useLayoutEffect(() => {
    renderMap(svgRef.current!, worldRef.current!, layout, { selectedId, dropTargetId: dropTarget });
    if (!fitted.current && size()[0] > 0) {
      fitted.current = true;
      fit();
    } else {
      applyView(viewRef.current);
    }
  }, [layout, selectedId, dropTarget]); // eslint-disable-line react-hooks/exhaustive-deps

  useImperativeHandle(ref, () => ({
    fit,
    zoomBy: (factor) => {
      const [w, h] = size();
      applyView(zoomAt(viewRef.current, factor, w / 2, h / 2));
    },
    view: () => viewRef.current,
    ensureVisible: (id) => {
      const b = layout.byId.get(id);
      const [w, h] = size();
      if (b && w > 0) applyView(ensureVisible(viewRef.current, b, w, h));
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

  const setDrop = (id: string | null) => {
    if (dropRef.current !== id) {
      dropRef.current = id;
      setDropTarget(id);
    }
  };

  /** Clears a topic gesture's ghost and drop target without firing onMove/onEdit. */
  const releaseGesture = (g: Gesture) => {
    if (g.kind === 'topic') {
      g.ghost?.remove();
      setDrop(null);
    }
  };

  const onPointerDown = (e: PointerEvent<SVGSVGElement>) => {
    if (e.button !== 0) return;
    if (gesture.current) {
      // A previous pointerup/pointercancel never arrived; clean up before starting a new gesture.
      releaseGesture(gesture.current);
      gesture.current = null;
    }
    const target = e.target as Element;
    const fold = target.closest('[data-fold]');
    if (fold) {
      onToggleFold(fold.getAttribute('data-fold')!);
      return;
    }
    svgRef.current?.setPointerCapture?.(e.pointerId);
    const topic = interactive ? target.closest('g.topic') : null;
    if (!topic) {
      gesture.current = { kind: 'pan', x: e.clientX, y: e.clientY, tx: viewRef.current.tx, ty: viewRef.current.ty };
      return;
    }
    const id = topic.getAttribute('data-id')!;
    const now = Date.now();
    const dbl = lastDown.current.id === id && now - lastDown.current.t < 420;
    lastDown.current = { id, t: dbl ? 0 : now };
    onSelect?.(id);
    gesture.current = { kind: 'topic', id, x: e.clientX, y: e.clientY, moved: false, dbl, ghost: null };
  };

  const onPointerMove = (e: PointerEvent<SVGSVGElement>) => {
    const g = gesture.current;
    if (!g) return;
    if (e.buttons === 0) {
      // The browser never delivered pointerup/pointercancel (e.g. released off-window); recover quietly.
      releaseGesture(g);
      gesture.current = null;
      return;
    }
    const dx = e.clientX - g.x;
    const dy = e.clientY - g.y;
    if (g.kind === 'pan') {
      applyView({ ...viewRef.current, tx: g.tx + dx, ty: g.ty + dy });
      return;
    }
    if (!g.moved) {
      if (Math.hypot(dx, dy) < 6 || layout.byId.get(g.id)?.parentId == null) return;
      g.moved = true;
      const source = worldRef.current?.querySelector(`g.topic[data-id="${g.id}"]`);
      if (source) {
        g.ghost = source.cloneNode(true) as SVGGElement;
        g.ghost.setAttribute('opacity', '0.55');
        g.ghost.style.pointerEvents = 'none';
        overlayRef.current?.appendChild(g.ghost);
      }
    }
    g.ghost?.setAttribute('transform', `translate(${dx / viewRef.current.k} ${dy / viewRef.current.k})`);
    const under = document.elementFromPoint?.(e.clientX, e.clientY)?.closest('g.topic');
    const tid = under?.getAttribute('data-id') ?? null;
    const moving = layout.byId.get(g.id)!.node;
    setDrop(tid && tid !== g.id && !isInBranch(moving, tid) ? tid : null);
  };

  const onPointerUp = () => {
    const g = gesture.current;
    gesture.current = null;
    if (!g || g.kind !== 'topic') return;
    if (g.moved) {
      g.ghost?.remove();
      const target = dropRef.current;
      setDrop(null);
      if (target) onMove?.(g.id, target);
    } else if (g.dbl) {
      onEdit?.(g.id);
    }
  };

  return (
    <div className="canvas">
      <svg
        ref={svgRef}
        role="img"
        aria-label="Mind map"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      >
        <g ref={worldRef} className="world" />
        <g ref={overlayRef} className="overlay" />
      </svg>
    </div>
  );
}
