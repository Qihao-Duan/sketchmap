import { produce } from 'immer';
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { ApiError, createApi } from '../api/client';
import { Canvas, type CanvasHandle } from '../editor/Canvas';
import { layoutMap } from '../layout';
import type { Measure } from '../layout/wrap';
import { allText, findNode, toggleCollapsed } from '../model/tree';
import { canvasMeasure, ensureFonts } from '../render/fonts';
import type { MindMap } from '../shared/types';

export function MapView({ map, measureFactory = canvasMeasure }: { map: MindMap; measureFactory?: () => Measure }) {
  const [local, setLocal] = useState(map); // folding only changes this viewer's screen
  useEffect(() => setLocal(map), [map]);
  const factory = useRef(measureFactory);
  const [measure, setMeasure] = useState<Measure>(() => factory.current());
  const [fontsReady, setFontsReady] = useState(false);
  const canvas = useRef<CanvasHandle>(null);
  const layout = useMemo(() => layoutMap(local.root, local.layout, measure), [local.root, local.layout, measure]);
  // The note being read: its topic, and where its icon is inside this page (to hang the card on).
  const [open, setOpen] = useState<{ id: string; x: number; top: number; bottom: number } | null>(null);
  const view = useRef<HTMLDivElement>(null);
  const card = useRef<HTMLDivElement>(null);
  const noteText = open ? findNode(local.root, open.id)?.node.note?.trim() : undefined;

  // A hover tooltip can't be opened on a touch screen, so a tap on the icon shows the note in a card.
  const showNote = (id: string, icon: Element) => {
    if (open?.id === id) {
      setOpen(null); // a second tap on the same icon puts it away
      return;
    }
    const page = view.current!.getBoundingClientRect();
    const r = icon.getBoundingClientRect();
    setOpen({ id, x: r.left - page.left, top: r.top - page.top, bottom: r.bottom - page.top });
  };

  // Keep the card inside the page (an embed can be small): under the icon when it fits there, else above it.
  useLayoutEffect(() => {
    const el = card.current;
    const page = view.current;
    if (!open || !el || !page) return;
    const left = Math.max(8, Math.min(open.x - 12, page.clientWidth - el.offsetWidth - 8));
    const below = open.bottom + 8;
    const above = open.top - 8 - el.offsetHeight;
    const top = below + el.offsetHeight <= page.clientHeight - 8 || above < 8 ? below : above;
    el.style.left = `${left}px`;
    el.style.top = `${Math.max(8, top)}px`;
  }, [open, noteText]);

  // Escape, or a press anywhere else, puts the card away. A press on a note icon is left to showNote.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(null);
    };
    const onPress = (e: Event) => {
      const target = e.target as Element | null;
      if (!target?.closest?.('.note-card, [data-note]')) setOpen(null);
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('pointerdown', onPress, true);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('pointerdown', onPress, true);
    };
  }, [open]);

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

  const toggle = (id: string) => {
    setOpen(null);
    setLocal((m) =>
      produce(m, (d) => {
        toggleCollapsed(d.root, id);
      }),
    );
  };

  return (
    <div className="view" ref={view}>
      {/* The card hangs on a place on screen, so it goes away when the map moves under it. */}
      <Canvas ref={canvas} layout={layout} selectedId={null} interactive={false} onToggleFold={toggle} onNote={showNote} onViewChange={() => setOpen(null)} fitMaxK={1.5} />
      {open && noteText && (
        <div ref={card} className="note-card" role="dialog" aria-label="Note" style={{ left: open.x, top: open.bottom + 8 }}>
          <button type="button" className="note-close" aria-label="Close note" onClick={() => setOpen(null)}>×</button>
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
