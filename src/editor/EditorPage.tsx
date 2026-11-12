import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { ApiError, createApi, type ApiClient } from '../api/client';
import { KeyPrompt } from '../auth/KeyPrompt';
import { getOwnerKey, setOwnerKey } from '../auth/ownerKey';
import { buildSvg, download, fileName, svgToPng, visibleText } from '../io/exportImage';
import { parseHtmlOutline } from '../io/htmlOutline';
import { parseOutline, toMarkdown } from '../io/markdown';
import { layoutMap } from '../layout';
import type { Measure } from '../layout/wrap';
import { allText } from '../model/tree';
import { canvasMeasure, ensureFonts } from '../render/fonts';
import type { LayoutKind, MindMap } from '../shared/types';
import { Autosaver, draftKey, readDraft, type Draft, type SaveStatus } from './autosave';
import { Canvas, type CanvasHandle } from './Canvas';
import { ConflictDialog, DraftBanner, SaveBadge, Toolbar } from './EditorChrome';
import { InlineEditor } from './InlineEditor';
import { keyToCommand, type Command } from './keymap';
import { navigate } from './navigate';
import { OutlinePanel } from './OutlinePanel';
import { editorReducer, initEditor } from './store';
import type { View } from './viewport';

const IGNORE_KEYS_IN = new Set(['INPUT', 'TEXTAREA', 'SELECT', 'BUTTON', 'A']);
const LAYOUTS: Array<[LayoutKind, string]> = [['map', 'Mind map'], ['logic', 'Logic chart'], ['org', 'Org chart']];

export interface EditorProps {
  initial: MindMap;
  etag: string;
  api: ApiClient;
  measureFactory?: () => Measure;
  storage?: Storage;
}

export function Editor({ initial, etag, api, measureFactory = canvasMeasure, storage = localStorage }: EditorProps) {
  const [state, dispatch] = useReducer(editorReducer, initial, initEditor);
  const factory = useRef(measureFactory);
  const [measure, setMeasure] = useState<Measure>(() => factory.current());
  const layout = useMemo(
    () => layoutMap(state.map.root, state.map.layout, measure),
    [state.map.root, state.map.layout, measure],
  );
  const canvas = useRef<CanvasHandle>(null);
  const [view, setView] = useState<View>({ tx: 0, ty: 0, k: 1 });
  const [status, setStatus] = useState<SaveStatus>('saved');
  const [conflict, setConflict] = useState(false);
  const [dialogError, setDialogError] = useState<string>();
  const [askKey, setAskKey] = useState(false);
  const [copied, setCopied] = useState(false);
  const [exportError, setExportError] = useState<string>();
  const [rejectedMessage, setRejectedMessage] = useState<string>();
  const [editInitial, setEditInitial] = useState<string | null>(null);
  const [outlineOpen, setOutlineOpen] = useState(false);
  const [mdCopied, setMdCopied] = useState(false);
  const [draft, setDraft] = useState<Draft | null>(() => {
    const d = readDraft(storage, initial.id);
    return d && JSON.stringify([d.map.root, d.map.layout]) !== JSON.stringify([initial.root, initial.layout]) ? d : null;
  });

  const stateRef = useRef(state);
  stateRef.current = state;
  const layoutRef = useRef(layout);
  layoutRef.current = layout;
  const statusRef = useRef(status);
  statusRef.current = status;
  const modalRef = useRef(false);
  modalRef.current = conflict || askKey || outlineOpen;

  const saver = useMemo(
    () =>
      new Autosaver(
        {
          save: (m, e) => api.saveMap(m, e),
          storage,
          setTimer: (fn, ms) => window.setTimeout(fn, ms),
          clearTimer: (h) => window.clearTimeout(h as number),
          now: () => Date.now(),
        },
        etag,
        (s, message) => {
          setStatus(s);
          if (s === 'conflict') setConflict(true);
          if (s === 'unauthorized') setAskKey(true);
          if (s === 'rejected') setRejectedMessage(message);
        },
        (saved) => dispatch({ type: 'serverSaved', map: saved.map }),
      ),
    [api, etag, storage],
  );
  useEffect(() => () => saver.dispose(), [saver]);

  // Autosave every user change (server echoes don't bump `revision`).
  const lastRevision = useRef(state.revision);
  useEffect(() => {
    if (state.revision === lastRevision.current) return;
    lastRevision.current = state.revision;
    saver.schedule(state.map);
  }, [state.revision, state.map, saver]);

  // Try to save when the tab is hidden or closed; warn if something is still unsaved.
  useEffect(() => {
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') void saver.flush();
    };
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      const unsaved = statusRef.current !== 'saved';
      const editingOpen = stateRef.current.editing != null;
      if (!unsaved && !editingOpen) return;
      if (unsaved) void saver.flush();
      e.preventDefault();
      e.returnValue = '';
    };
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('beforeunload', onBeforeUnload);
    };
  }, [saver]);

  // Load font subsets when new characters appear, then measure again with the real font.
  const chars = useMemo(() => [...new Set(allText(state.map.root))].sort().join(''), [state.map.root]);
  useEffect(() => {
    let alive = true;
    void ensureFonts(chars).then(() => {
      if (alive) setMeasure(() => factory.current());
    });
    return () => {
      alive = false;
    };
  }, [chars]);

  useEffect(() => {
    canvas.current?.ensureVisible(state.selectedId);
  }, [state.selectedId, layout]);

  // Refit when the layout changes (not on first render, where the canvas fits itself).
  // Compares with the last layout rather than a "first run" flag, which StrictMode's double effect run would defeat.
  const fittedLayout = useRef(state.map.layout);
  useEffect(() => {
    if (fittedLayout.current === state.map.layout) return;
    fittedLayout.current = state.map.layout;
    canvas.current?.fit();
  }, [state.map.layout]);

  // Paste an outline (or plain lines) anywhere outside a text field: topics go under the selection.
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      if (stateRef.current.editing || modalRef.current) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
      const html = e.clipboardData?.getData('text/html') ?? '';
      const text = e.clipboardData?.getData('text/plain') ?? '';
      const parsed = (html ? parseHtmlOutline(html) : null) ?? (text.trim() ? parseOutline(text) : null);
      if (!parsed) return;
      e.preventDefault();
      dispatch({ type: 'pasteNodes', nodes: parsed.synthetic ? parsed.root.children : [parsed.root] });
    };
    window.addEventListener('paste', onPaste);
    return () => window.removeEventListener('paste', onPaste);
  }, []);

  useEffect(() => {
    document.title = `${state.map.title || 'Untitled map'} · Sketchmap`;
  }, [state.map.title]);

  /** Header and toolbar buttons keep focus where it is, so close an open inline edit first: its blur commits the text, or drops a new empty topic. */
  const endEdit = () => {
    if (stateRef.current.editing) (document.activeElement as HTMLElement | null)?.blur();
  };

  const run = useCallback((cmd: Command) => {
    const s = stateRef.current;
    switch (cmd.type) {
      case 'edit':
        setEditInitial(cmd.initial ?? null);
        dispatch({ type: 'startEdit' });
        return;
      case 'fold':
        dispatch({ type: 'toggleFold' });
        return;
      case 'navigate': {
        const id = navigate(layoutRef.current, s.selectedId, cmd.dir, s.map.layout);
        if (id) dispatch({ type: 'select', id });
        return;
      }
      case 'emphasis':
        dispatch({ type: 'bumpEmphasis', delta: cmd.delta });
        return;
      case 'priority':
        dispatch({ type: 'setPriority', priority: cmd.value === 0 ? null : cmd.value });
        return;
      default:
        dispatch({ type: cmd.type });
    }
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (stateRef.current.editing || modalRef.current) return;
      const t = e.target as HTMLElement | null;
      if (t && (IGNORE_KEYS_IN.has(t.tagName) || t.isContentEditable)) return;
      const cmd = keyToCommand(e);
      if (!cmd) return;
      e.preventDefault();
      run(cmd);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [run]);

  const commit = (text: string) => {
    setEditInitial(null);
    dispatch({ type: 'commitEdit', text });
  };
  const cancel = () => {
    setEditInitial(null);
    dispatch({ type: 'cancelEdit' });
  };
  const tab = (text: string) => {
    commit(text);
    dispatch({ type: 'addChild' });
  };

  const loadNewer = async () => {
    try {
      const fresh = await api.getMap(initial.id);
      dispatch({ type: 'replaceMap', map: fresh.map, dirty: false });
      saver.discard(fresh.etag, initial.id);
      setConflict(false);
      setDialogError(undefined);
    } catch (e) {
      setDialogError(e instanceof Error ? e.message : String(e));
    }
  };
  const keepMine = async () => {
    try {
      const fresh = await api.getMap(initial.id);
      saver.resume(fresh.etag, stateRef.current.map);
      setConflict(false);
      setDialogError(undefined);
    } catch (e) {
      setDialogError(e instanceof Error ? e.message : String(e));
    }
  };
  const restoreDraft = () => {
    if (!draft) return;
    if (draft.etag && draft.etag !== saver.currentEtag) saver.resume(draft.etag);
    dispatch({ type: 'replaceMap', map: { ...draft.map, id: initial.id }, dirty: true });
    setDraft(null);
  };
  const discardDraft = () => {
    storage.removeItem(draftKey(initial.id));
    setDraft(null);
  };
  const copyLink = () => {
    const url = `${location.origin}/m/${initial.id}`;
    navigator.clipboard?.writeText(url).then(
      () => setCopied(true),
      () => window.prompt('Copy this link into a Notion /embed block:', url),
    );
  };
  const copyMarkdown = () => {
    if (!navigator.clipboard) {
      setOutlineOpen(true);
      return;
    }
    navigator.clipboard.writeText(toMarkdown(state.map.root)).then(
      () => setMdCopied(true),
      () => setOutlineOpen(true),
    );
  };
  const applyOutline = (text: string): string | null => {
    const parsed = parseOutline(text);
    if (!parsed) return 'The outline is empty.';
    dispatch({ type: 'replaceRoot', root: parsed.root });
    setOutlineOpen(false);
    return null;
  };
  const exportAs = async (kind: 'svg' | 'png') => {
    try {
      setExportError(undefined);
      const svg = await buildSvg(layout, visibleText(layout));
      const blob = kind === 'svg' ? new Blob([svg], { type: 'image/svg+xml' }) : await svgToPng(svg);
      download(blob, fileName(state.map.title, kind));
    } catch (e) {
      setExportError(`Export failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  };

  const editing = state.editing;
  const editBox = editing ? layout.byId.get(editing.id) : undefined;

  return (
    <div className="editor">
      <header className="editor-bar">
        <a href="/">All maps</a>
        <h1 className="map-title">{state.map.title || 'Untitled map'}</h1>
        <SaveBadge status={status} />
        <div className="layout-switch" role="group" aria-label="Layout">
          {LAYOUTS.map(([kind, label]) => (
            <button
              key={kind}
              type="button"
              aria-pressed={state.map.layout === kind}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => { endEdit(); dispatch({ type: 'setLayout', layout: kind }); }}
            >
              {label}
            </button>
          ))}
        </div>
        <button type="button" onClick={() => setOutlineOpen(true)}>Outline</button>
        <button type="button" onClick={copyMarkdown}>{mdCopied ? 'Markdown copied' : 'Copy as Markdown'}</button>
        <button type="button" onClick={copyLink}>{copied ? 'Link copied' : 'Copy Notion embed link'}</button>
        <a href={`/m/${initial.id}`} target="_blank" rel="noopener">Open view ↗</a>
      </header>
      {draft && (
        <DraftBanner
          savedAt={draft.savedAt}
          onRestore={restoreDraft}
          onDiscard={discardDraft}
          olderThanServer={draft.savedAt < Date.parse(initial.updatedAt)}
        />
      )}
      {exportError && <div className="banner" role="alert">{exportError}</div>}
      {status === 'rejected' && (
        <div className="banner" role="alert">
          The server refused this save: {rejectedMessage}. Your changes are kept in this browser.
        </div>
      )}
      <main className="editor-stage">
        <Canvas
          ref={canvas}
          layout={layout}
          selectedId={state.selectedId}
          interactive
          onSelect={(id) => dispatch({ type: 'select', id })}
          onEdit={(id) => {
            setEditInitial(null);
            dispatch({ type: 'startEdit', id });
          }}
          onMove={(id, targetId) => dispatch({ type: 'move', id, targetId })}
          onToggleFold={(id) => dispatch({ type: 'toggleFold', id })}
          onViewChange={setView}
        />
        {editing && editBox && (
          <InlineEditor
            key={editing.id}
            box={editBox}
            view={view}
            initialText={editInitial ?? editBox.node.text}
            selectAll={editInitial === null}
            onCommit={commit}
            onCancel={cancel}
            onTab={tab}
          />
        )}
        {outlineOpen && (
          <OutlinePanel initialText={toMarkdown(state.map.root)} onApply={applyOutline} onClose={() => setOutlineOpen(false)} />
        )}
        <Toolbar
          zoom={view.k}
          canUndo={state.past.length > 0}
          canRedo={state.future.length > 0}
          canDelete={state.selectedId !== state.map.root.id}
          onAddChild={() => { endEdit(); dispatch({ type: 'addChild' }); }}
          onAddSibling={() => { endEdit(); dispatch({ type: 'addSibling' }); }}
          onDelete={() => { endEdit(); dispatch({ type: 'delete' }); }}
          onUndo={() => { endEdit(); dispatch({ type: 'undo' }); }}
          onRedo={() => { endEdit(); dispatch({ type: 'redo' }); }}
          onZoomIn={() => canvas.current?.zoomBy(1.2)}
          onZoomOut={() => canvas.current?.zoomBy(1 / 1.2)}
          onFit={() => canvas.current?.fit()}
          extra={
            <>
              <span className="sep" />
              <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => exportAs('svg')}>SVG</button>
              <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => exportAs('png')}>PNG</button>
            </>
          }
        />
      </main>
      {conflict && <ConflictDialog onLoadNewer={loadNewer} onKeepMine={keepMine} error={dialogError} />}
      {askKey && (
        <div className="dialog-backdrop">
          <KeyPrompt
            error="The owner key was rejected. Enter it again to keep saving."
            onSubmit={(key) => {
              setOwnerKey(key);
              setAskKey(false);
              saver.resume(saver.currentEtag);
            }}
          />
        </div>
      )}
    </div>
  );
}

type Load =
  | { status: 'loading' }
  | { status: 'missing' }
  | { status: 'error'; message: string }
  | { status: 'ready'; map: MindMap; etag: string };

export function EditorPage({ id }: { id: string }) {
  const api = useMemo(() => createApi(() => getOwnerKey()), []);
  const [hasKey, setHasKey] = useState(() => !!getOwnerKey());
  const [attempt, setAttempt] = useState(0);
  const [load, setLoad] = useState<Load>({ status: 'loading' });

  useEffect(() => {
    if (!hasKey) return;
    let alive = true;
    setLoad({ status: 'loading' });
    api.getMap(id).then(
      ({ map, etag }) => alive && setLoad({ status: 'ready', map, etag }),
      (e) => alive && setLoad(e instanceof ApiError && e.status === 404 ? { status: 'missing' } : { status: 'error', message: String(e?.message ?? e) }),
    );
    return () => {
      alive = false;
    };
  }, [api, id, hasKey, attempt]);

  if (!hasKey) {
    return (
      <div className="center">
        <KeyPrompt
          onSubmit={(key) => {
            setOwnerKey(key);
            setHasKey(true);
          }}
        />
      </div>
    );
  }
  if (load.status === 'loading') return <p className="center muted">Loading…</p>;
  if (load.status === 'missing') return <div className="center"><p>This map doesn’t exist or was deleted. <a href="/">All maps</a></p></div>;
  if (load.status === 'error') {
    return (
      <div className="center">
        <p role="alert">Couldn’t load the map: {load.message}</p>
        <button type="button" onClick={() => setAttempt((n) => n + 1)}>Try again</button>
      </div>
    );
  }
  return <Editor initial={load.map} etag={load.etag} api={api} />;
}
