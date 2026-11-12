import { useCallback, useEffect, useMemo, useState } from 'react';
import { ApiError, createApi } from '../api/client';
import { KeyPrompt } from '../auth/KeyPrompt';
import { clearOwnerKey, getOwnerKey, setOwnerKey } from '../auth/ownerKey';
import type { MapSummary } from '../shared/types';

export function ListPage({ go = (url: string) => location.assign(url) }: { go?: (url: string) => void }) {
  const api = useMemo(() => createApi(() => getOwnerKey()), []);
  const [hasKey, setHasKey] = useState(() => !!getOwnerKey());
  const [maps, setMaps] = useState<MapSummary[] | null>(null);
  const [error, setError] = useState<string>();
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const fail = useCallback((e: unknown) => {
    if (e instanceof ApiError && e.status === 401) {
      clearOwnerKey();
      setHasKey(false);
      setError('That owner key was rejected. Check it and try again.');
    } else {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  const refresh = useCallback(() => {
    api.listMaps().then(setMaps, fail);
  }, [api, fail]);

  useEffect(() => {
    if (hasKey) refresh();
  }, [hasKey, refresh]);

  useEffect(() => {
    document.title = 'Your maps · Sketchmap';
  }, []);

  if (!hasKey) {
    return (
      <div className="center">
        <KeyPrompt
          error={error}
          onSubmit={(key) => {
            setOwnerKey(key);
            setError(undefined);
            setHasKey(true);
          }}
        />
      </div>
    );
  }

  const create = async () => {
    try {
      const { map } = await api.createMap();
      go(`/e/${map.id}`);
    } catch (e) {
      fail(e);
    }
  };
  const remove = async (id: string) => {
    try {
      await api.deleteMap(id);
      setConfirmId(null);
      refresh();
    } catch (e) {
      fail(e);
    }
  };
  const copy = (id: string) => {
    navigator.clipboard?.writeText(`${location.origin}/m/${id}`).then(() => setCopiedId(id), () => setError('Copy was blocked by the browser.'));
  };

  return (
    <div className="list">
      <header>
        <h1>Your maps</h1>
        <button type="button" className="primary" onClick={create}>New map</button>
      </header>
      {error && <p role="alert" className="error">{error}</p>}
      {maps === null ? (
        <p className="muted">Loading…</p>
      ) : maps.length === 0 ? (
        <p className="muted">No maps yet. Start one with “New map”.</p>
      ) : (
        <ul className="maps">
          {maps.map((m) => (
            <li key={m.id}>
              <a className="title" href={`/e/${m.id}`}>{m.title}</a>
              <span className="muted">{new Date(m.updatedAt).toLocaleString()}</span>
              <button type="button" onClick={() => copy(m.id)}>{copiedId === m.id ? 'Link copied' : 'Copy Notion embed link'}</button>
              {confirmId === m.id ? (
                <>
                  <span>Delete for good?</span>
                  <button type="button" className="danger" onClick={() => remove(m.id)}>Delete</button>
                  <button type="button" onClick={() => setConfirmId(null)}>Keep</button>
                </>
              ) : (
                <button type="button" onClick={() => setConfirmId(m.id)}>Delete…</button>
              )}
            </li>
          ))}
        </ul>
      )}
      <footer className="muted credits">
        Handwriting fonts: Excalifont and Xiaolai, under the <a href="/fonts/OFL.txt">SIL Open Font License 1.1</a>.
      </footer>
    </div>
  );
}
