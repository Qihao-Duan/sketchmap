import { produce } from 'immer';
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { ApiError, createApi } from '../api/client';
import { Canvas, type CanvasHandle } from '../editor/Canvas';
import { layoutMap } from '../layout';
import type { Measure } from '../layout/wrap';
import { allText, findNode, toggleCollapsed } from '../model/tree';
import { canvasMeasure, ensureFonts } from '../render/fonts';
import type { MindMap } from '../shared/types';

interface Box {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

const MARGIN = 8;

/**
 * Where a note card goes, in page coordinates: under its icon when it fits there, else above it, else as low
 * as the page allows; never past an edge (8 px to spare), and when it is taller than the page, from the top.
 */
export function placeNoteCard(page: { width: number; height: number }, icon: Box, card: { width: number; height: number }): { left: number; top: number } {
  const left = Math.max(MARGIN, Math.min(icon.left - 12, page.width - card.width - MARGIN));
  const below = icon.bottom + MARGIN;
  const above = icon.top - MARGIN - card.height;
  const lowest = page.height - MARGIN - card.height;
  const top = below <= lowest ? below : above >= MARGIN ? above : lowest;
  return { left, top: Math.max(MARGIN, top) };
}

export function MapView({ map, measureFactory = canvasMeasure }: { map: MindMap; measureFactory?: () => Measure }) {
  const [local, setLocal] = useState(map); // folding only changes this viewer's screen
  useEffect(() => setLocal(map), [map]);
  const factory = useRef(measureFactory);
  const [measure, setMeasure] = useState<Measure>(() => factory.current());
  const [fontsReady, setFontsReady] = useState(false);
  const canvas = useRef<CanvasHandle>(null);
  const layout = useMemo(() => layoutMap(local.root, local.layout, measure), [local.root, local.layout, measure]);
  // The topic whose note is being read. Where its card goes is read from the icon on screen each time,
  // because the map can move, be redrawn (when the fonts arrive) or be refitted while the card is open.
  const [openId, setOpenId] = useState<string | null>(null);
  const view = useRef<HTMLDivElement>(null);
  const card = useRef<HTMLDivElement>(null);
  const noteText = openId ? findNode(local.root, openId)?.node.note?.trim() : undefined;

  // A hover tooltip can't be opened on a touch screen, so a tap on the icon shows the note in a card.
  // A second tap on the same icon puts it away.
  const showNote = (id: string) => setOpenId((current) => (current === id ? null : id));

  /**
   * Hangs the card on its icon. With `closeIfGone`, a card whose icon is no longer on the page (folded away,
   * or moved out of sight) is put away instead.
   */
  const placeCard = (id: string, closeIfGone: boolean) => {
    const page = view.current;
    const icon = page?.querySelector(`[data-note="${id}"]`);
    if (!page || !icon) {
      if (closeIfGone) setOpenId(null);
      return;
    }
    const p = page.getBoundingClientRect();
    const r = icon.getBoundingClientRect();
    const onPage = r.right > p.left && r.left < p.right && r.bottom > p.top && r.top < p.bottom;
    if (!onPage && closeIfGone) {
      setOpenId(null);
      return;
    }
    const el = card.current;
    if (!el) return;
    const at = placeNoteCard(
      { width: page.clientWidth, height: page.clientHeight },
      { left: r.left - p.left, top: r.top - p.top, right: r.right - p.left, bottom: r.bottom - p.top },
      { width: el.offsetWidth, height: el.offsetHeight },
    );
    el.style.left = `${at.left}px`;
    el.style.top = `${at.top}px`;
  };

  useLayoutEffect(() => {
    if (openId) placeCard(openId, false);
  }, [openId, noteText]); // eslint-disable-line react-hooks/exhaustive-deps

  // Escape, or a press anywhere else, puts the card away. A press on a note icon is left to showNote.
  useEffect(() => {
    if (!openId) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpenId(null);
    };
    const onPress = (e: Event) => {
      const target = e.target as Element | null;
      if (!target?.closest?.('.note-card, [data-note]')) setOpenId(null);
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('pointerdown', onPress, true);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('pointerdown', onPress, true);
    };
  }, [openId]);

  useEffect(() => {
    let alive = true;
    void ensureFonts(allText(map.root)).then(() => {
      if (!alive) return;
      setMeasure(() => factory.current());
      setFontsReady(true);
    });
    return () => {
      alive = false;
    };
  }, [map]);

  useEffect(() => {
    if (fontsReady) canvas.current?.fit(); // real font widths are known now
  }, [fontsReady, layout]);

  useEffect(() => {
    const onResize = () => canvas.current?.fit();
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  // A fold closes an open card through the press it starts with (see above).
  const toggle = (id: string) =>
    setLocal((m) =>
      produce(m, (d) => {
        toggleCollapsed(d.root, id);
      }),
    );

  return (
    <div className="view" ref={view}>
      {/* The canvas reports every move and redraw of the map: the card follows its icon. */}
      <Canvas
        ref={canvas}
        layout={layout}
        selectedId={null}
        interactive={false}
        onToggleFold={toggle}
        onNote={showNote}
        onViewChange={() => openId && placeCard(openId, true)}
        fitMaxK={1.5}
      />
      {openId && noteText && (
        <div ref={card} className="note-card" role="dialog" aria-label="Note">
          <button type="button" className="note-close" aria-label="Close note" onClick={() => setOpenId(null)}>×</button>
          <p className="note-text">{noteText}</p>
        </div>
      )}
      <div className="view-bar">
        <span className="pill">View only</span>
        <a className="edit-link" href={`/e/${map.id}`} target="_blank" rel="noopener">Edit in a tab ↗</a>
      </div>
    </div>
  );
}

type Load = { status: 'loading' } | { status: 'missing' } | { status: 'error'; message: string } | { status: 'ready'; map: MindMap };

export function ViewPage({ id }: { id: string }) {
  const api = useMemo(() => createApi(() => null), []);
  const [load, setLoad] = useState<Load>({ status: 'loading' });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let alive = true;
    setLoad({ status: 'loading' });
    api.getMap(id).then(
      ({ map }) => {
        if (!alive) return;
        document.title = `${map.title} · Sketchmap`;
        setLoad({ status: 'ready', map });
      },
      (e) => alive && setLoad(e instanceof ApiError && e.status === 404 ? { status: 'missing' } : { status: 'error', message: String(e?.message ?? e) }),
    );
    return () => {
      alive = false;
    };
  }, [api, id, attempt]);

  if (load.status === 'loading') return <p className="center muted">Loading map…</p>;
  if (load.status === 'missing') return <p className="center muted">This map doesn’t exist or was deleted.</p>;
  if (load.status === 'error') {
    return (
      <div className="center">
        <p role="alert">Couldn’t load the map: {load.message}</p>
        <button type="button" onClick={() => setAttempt((n) => n + 1)}>Try again</button>
      </div>
    );
  }
  return <MapView map={load.map} />;
}
