import { produce } from 'immer';
import { useEffect, useMemo, useRef, useState } from 'react';
import { ApiError, createApi } from '../api/client';
import { Canvas, type CanvasHandle } from '../editor/Canvas';
import { layoutMap } from '../layout';
import type { Measure } from '../layout/wrap';
import { allText, toggleCollapsed } from '../model/tree';
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

  const toggle = (id: string) =>
    setLocal((m) =>
      produce(m, (d) => {
        toggleCollapsed(d.root, id);
      }),
    );

  return (
    <div className="view">
      <Canvas ref={canvas} layout={layout} selectedId={null} interactive={false} onToggleFold={toggle} fitMaxK={1.5} />
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
