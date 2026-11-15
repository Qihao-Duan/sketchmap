import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ApiError, createApi } from '../api/client';
import { getOwnerKey } from '../auth/ownerKey';
import { SignIn } from '../auth/SignIn';
import { useAccess } from '../auth/useAccess';
import { displaySize, prepareImage } from '../io/imagePrep';
import { importXmind, readXmindResources, XmindError } from '../io/xmind';
import { findNode } from '../model/tree';
import { parseRich } from '../shared/rich';
import type { MapSummary } from '../shared/types';
import { ThemePicker } from '../ThemePicker';

export function ListPage({ go = (url: string) => location.assign(url) }: { go?: (url: string) => void }) {
  const api = useMemo(() => createApi(() => getOwnerKey()), []);
  const { access, enterKey, rejected, recheck, signOut } = useAccess();
  const [maps, setMaps] = useState<MapSummary[] | null>(null);
  const [error, setError] = useState<string>();
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  const [imported, setImported] = useState<{ id: string; title: string; topics: number; dropped: string[]; changed: string[] } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const fail = useCallback((e: unknown) => {
    // 401: the key or the session is no good any more. The sign-in page says so and offers the way back in.
    if (e instanceof ApiError && e.status === 401) rejected();
    else setError(e instanceof Error ? e.message : String(e));
  }, [rejected]);

  const refresh = useCallback(() => {
    api.listMaps().then(setMaps, fail);
  }, [api, fail]);

  const signedIn = access.state === 'in';
  useEffect(() => {
    if (signedIn) refresh();
  }, [signedIn, refresh]);

  useEffect(() => {
    document.title = 'Your maps · Sketchmap';
  }, []);

  if (access.state === 'checking') return <p className="center muted">Loading…</p>;
  if (access.state === 'out') {
    return (
      <div className="center">
        <SignIn
          google={access.google}
          next="/"
          message={access.message}
          onRetry={access.unreachable ? recheck : undefined}
          onKey={(key) => {
            setError(undefined);
            setMaps(null);
            setImported(null);
            enterKey(key);
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

  const importFile = async (file: File) => {
    setImporting(true);
    setError(undefined);
    setImported(null);
    let createdId: string | null = null;
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      const result = await importXmind(bytes);
      const { map, etag } = await api.createMap();
      createdId = map.id;

      let failedImages = 0;
      if (result.images.length > 0) {
        for (const img of result.images) {
          try {
            // One resource at a time: an oversized or damaged one fails only itself.
            const raw = (await readXmindResources(bytes, [img.resource])).get(img.resource);
            if (!raw) throw new Error('resource not found in the archive');
            const prepared = await prepareImage(new Blob([raw] as BlobPart[]));
            const { key } = await api.uploadImage(map.id, prepared.blob);
            const found = findNode(result.root, img.nodeId);
            if (!found) throw new Error('topic not found');
            found.node.image = { key, ...displaySize(img.width ?? prepared.width, img.height ?? prepared.height) };
          } catch {
            failedImages++;
          }
        }
      }
      const dropped = failedImages > 0
        ? [...result.dropped, `${failedImages} image${failedImages === 1 ? '' : 's'} could not be added`]
        : result.dropped;

      await api.saveMap({ ...map, root: result.root, layout: result.layout }, etag);
      setImported({
        id: map.id,
        title: parseRich(result.root.text).plain.split('\n')[0] || 'Untitled map',
        topics: result.topics,
        dropped,
        changed: result.changed,
      });
      refresh();
    } catch (e) {
      if (createdId) void api.deleteMap(createdId).catch(() => {});
      if (e instanceof XmindError) setError(e.message);
      else fail(e);
    } finally {
      setImporting(false);
    }
  };

  return (
    <div className="list">
      <header>
        <h1>Your maps</h1>
        <button type="button" className="primary" onClick={create}>New map</button>
        <button type="button" disabled={importing} onClick={() => fileRef.current?.click()}>{importing ? 'Importing…' : 'Import .xmind'}</button>
        <ThemePicker save={(theme) => api.saveTheme(theme)} />
        {access.email && (
          <>
            <span className="muted account">{access.email}</span>
            <button
              type="button"
              onClick={async () => {
                setError(undefined);
                // Only the server can remove the session cookie, so an unanswered sign-out has not signed out.
                if (await signOut()) {
                  setMaps(null);
                  setImported(null);
                } else {
                  setError('Couldn’t sign out: the server didn’t answer. This browser is still signed in. Try again when you are back online.');
                }
              }}
            >
              Sign out
            </button>
          </>
        )}
        <input
          ref={fileRef}
          type="file"
          accept=".xmind"
          aria-label="XMind file"
          hidden
          onChange={(e) => {
            const file = e.target.files?.[0];
            e.target.value = '';
            if (file) void importFile(file);
          }}
        />
      </header>
      {error && <p role="alert" className="error">{error}</p>}
      {imported && (
        <p role="status" className="import-result">
          Imported “{imported.title}”: {imported.topics} {imported.topics === 1 ? 'topic' : 'topics'}.
          {imported.changed.length > 0 && <> Changed: {imported.changed.join(', ')}.</>}
          {imported.dropped.length > 0 && <> Not brought over: {imported.dropped.join(', ')}.</>} <a href={`/e/${imported.id}`}>Open it</a>
        </p>
      )}
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
