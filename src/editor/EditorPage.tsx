import { useCallback, useEffect, useLayoutEffect, useMemo, useReducer, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import { ApiError, createApi, type ApiClient } from '../api/client';
import { fetchSession } from '../auth/access';
import { clearOwnerKey, getOwnerKey, setOwnerKey } from '../auth/ownerKey';
import { SignIn } from '../auth/SignIn';
import { useAccess } from '../auth/useAccess';
import { buildExcalidraw, EXCALIDRAW_MIME, excalidrawLosses } from '../io/excalidraw';
import { buildSvg, download, fileName, svgToPng, visibleText } from '../io/exportImage';
import { parseHtmlOutline } from '../io/htmlOutline';
import { displaySize, IMAGE_SIZES, prepareImage } from '../io/imagePrep';
import { mainBranchTextsInOutline, markdownLosses, parseOutline, toMarkdown } from '../io/markdown';
import { layoutMap } from '../layout';
import type { Measure } from '../layout/wrap';
import { allText, carrySides, findNode } from '../model/tree';
import { canvasMeasure, ensureFonts } from '../render/fonts';
import { linkWhole, parseRich } from '../shared/rich';
import { plainTitle } from '../shared/title';
import type { LayoutKind, MindMap } from '../shared/types';
import { browserStorage } from '../storage';
import { ThemePicker } from '../ThemePicker';
import { Autosaver, draftKey, readDraft, type Draft, type SaveStatus } from './autosave';
import { Canvas, type CanvasHandle } from './Canvas';
import { DetailsPanel, NoTopicDetails } from './DetailsPanel';
import { ConflictDialog, DraftBanner, SaveBadge, Toolbar } from './EditorChrome';
import { InlineEditor } from './InlineEditor';
import { keyToCommand, type Command } from './keymap';
import { shownSides, stepSibling, type Drop } from './reorder';
import { LinkPrompt } from './LinkPrompt';
import { navigate } from './navigate';
import { OutlinePanel } from './OutlinePanel';
import { pictureSize } from './pictureSize';
import { editorReducer, initEditor, selectedIds } from './store';
import { steppedWrap } from './wrapStep';
import type { View } from './viewport';

const IGNORE_KEYS_IN = new Set(['INPUT', 'TEXTAREA', 'SELECT', 'BUTTON', 'A']);
const LAYOUTS: Array<[LayoutKind, string]> = [['map', 'Mind map'], ['logic', 'Logic chart'], ['org', 'Org chart']];
const DETAILS_KEY = 'sketchmap:details';
const NOT_PASTED = 'Not pasted: no topic is selected. Click the topic the pasted topics should go under, then paste again.';

export interface EditorProps {
  initial: MindMap;
  etag: string;
  api: ApiClient;
  measureFactory?: () => Measure;
  storage?: Storage;
  /** The page was opened with a Google session, not the owner key: a refused save then offers Google again. */
  googleSession?: boolean;
}

export function Editor({ initial, etag, api, measureFactory = canvasMeasure, storage = browserStorage(), googleSession = false }: EditorProps) {
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
  /** Set when the user follows the Google link out of the sign-in dialog, in this tab, with their changes safely kept. */
  const leavingToSignIn = useRef(false);
  /** For a key user's refused save: whether the site offers Google too (asked once the save is refused). */
  const [keyUserGoogle, setKeyUserGoogle] = useState<boolean | null>(null);
  const [copied, setCopied] = useState(false);
  const [exportError, setExportError] = useState<string>();
  const [rejectedMessage, setRejectedMessage] = useState<string>();
  const [editInitial, setEditInitial] = useState<string | null>(null);
  const [outlineOpen, setOutlineOpen] = useState(false);
  const [linkFor, setLinkFor] = useState<string | null>(null);
  const [mdCopied, setMdCopied] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const [imageUploads, setImageUploads] = useState(0);
  const [imageError, setImageError] = useState<string | null>(null);
  const [detailsOpen, setDetailsOpen] = useState(() => {
    try {
      const stored = storage.getItem(DETAILS_KEY);
      if (stored !== null) return stored === '1';
    } catch {
      // Storage blocked: fall back to the default.
    }
    return window.innerWidth >= 760;
  });
  const [draft, setDraft] = useState<Draft | null>(() => {
    const d = readDraft(storage, initial.id);
    return d && JSON.stringify([d.map.root, d.map.layout]) !== JSON.stringify([initial.root, initial.layout]) ? d : null;
  });

  const stateRef = useRef(state);
  stateRef.current = state;
  const layoutRef = useRef(layout);
  layoutRef.current = layout;
  /** The topic selected last: while nothing is selected, an arrow key goes back to it. */
  const lastSelected = useRef(state.selectedId);
  if (state.selectedId !== null) lastSelected.current = state.selectedId;
  const statusRef = useRef(status);
  statusRef.current = status;
  const modalRef = useRef(false);
  const linkNode = linkFor ? findNode(state.map.root, linkFor)?.node ?? null : null;
  modalRef.current = conflict || askKey || outlineOpen || linkNode !== null;

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
          if (s === 'unauthorized') {
            // A key that was refused is of no further use; kept, it would be sent again with every request.
            clearOwnerKey();
            setAskKey(true);
          }
          if (s === 'rejected') setRejectedMessage(message);
        },
        (saved) => dispatch({ type: 'serverSaved', map: saved.map }),
      ),
    [api, etag, storage],
  );
  useEffect(() => () => saver.dispose(), [saver]);

  // The sign-in dialog opened or closed. Closed: whatever it was going to do is over. Opened for a key user:
  // ask whether the site also offers Google; the dialog waits for the answer, so its layout doesn't jump.
  useEffect(() => {
    leavingToSignIn.current = false;
    setKeyUserGoogle(null);
    if (!askKey || googleSession) return;
    let alive = true;
    void fetchSession(null).then((s) => alive && setKeyUserGoogle(s.google));
    return () => {
      alive = false;
    };
  }, [askKey, googleSession]);

  // Autosave every user change (server echoes don't bump `revision`).
  const lastRevision = useRef(state.revision);
  useEffect(() => {
    if (state.revision === lastRevision.current) return;
    lastRevision.current = state.revision;
    saver.schedule(state.map);
  }, [state.revision, state.map, saver]);

  // Try to save when the tab is hidden or closed, and at once when the connection returns; warn if something is still unsaved.
  useEffect(() => {
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') void saver.flush();
    };
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      // On the way to Google from the sign-in dialog, with the changes kept in this browser: nothing to
      // warn about, and nothing to send (the save would only be refused again).
      if (leavingToSignIn.current) return;
      const unsaved = statusRef.current !== 'saved';
      const editingOpen = stateRef.current.editing != null;
      if (!unsaved && !editingOpen) return;
      if (unsaved) void saver.flush();
      e.preventDefault();
      e.returnValue = '';
    };
    const onOnline = () => saver.retryNow();
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('beforeunload', onBeforeUnload);
    window.addEventListener('online', onOnline);
    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('online', onOnline);
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
    if (state.selectedId !== null) canvas.current?.ensureVisible(state.selectedId);
  }, [state.selectedId, layout]);

  // Refit when the layout changes (not on first render, where the canvas fits itself).
  // Compares with the last layout rather than a "first run" flag, which StrictMode's double effect run would defeat.
  const fittedLayout = useRef(state.map.layout);
  useEffect(() => {
    if (fittedLayout.current === state.map.layout) return;
    fittedLayout.current = state.map.layout;
    canvas.current?.fit();
  }, [state.map.layout]);

  // Refit when the Details sidebar opens or closes, so it doesn't cover topics (compared with the last state; StrictMode-safe).
  const fittedDetails = useRef(detailsOpen);
  useEffect(() => {
    if (fittedDetails.current === detailsOpen) return;
    fittedDetails.current = detailsOpen;
    canvas.current?.fit();
  }, [detailsOpen]);

  // Paste an outline (or plain lines) anywhere outside a text field: topics go under the selection.
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      if (stateRef.current.editing || modalRef.current) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
      const imageFile = [...(e.clipboardData?.files ?? [])].find((f) => f.type.startsWith('image/'));
      if (imageFile) {
        e.preventDefault();
        void attachImage(stateRef.current.selectedId, imageFile);
        return;
      }
      const html = e.clipboardData?.getData('text/html') ?? '';
      const text = e.clipboardData?.getData('text/plain') ?? '';
      const parsed = (html ? parseHtmlOutline(html) : null) ?? (text.trim() ? parseOutline(text) : null);
      if (!parsed) return;
      e.preventDefault();
      if (stateRef.current.selectedId === null) {
        setNotice(NOT_PASTED);
        return;
      }
      // The paste has a topic to go to now: a notice left by one that had none is out of date.
      setNotice((n) => (n === NOT_PASTED ? null : n));
      dispatch({ type: 'pasteNodes', nodes: parsed.synthetic ? parsed.root.children : [parsed.root] });
    };
    window.addEventListener('paste', onPaste);
    return () => window.removeEventListener('paste', onPaste);
  }, []);

  // A file dropped outside the canvas (the header, the toolbar, the Details panel) must not make the
  // browser navigate away and open it in place of the editor.
  useEffect(() => {
    const hasFiles = (e: DragEvent) => !!e.dataTransfer?.types.includes('Files');
    const onDragOver = (e: DragEvent) => { if (hasFiles(e)) e.preventDefault(); };
    const onDrop = (e: DragEvent) => { if (hasFiles(e)) e.preventDefault(); };
    window.addEventListener('dragover', onDragOver);
    window.addEventListener('drop', onDrop);
    return () => {
      window.removeEventListener('dragover', onDragOver);
      window.removeEventListener('drop', onDrop);
    };
  }, []);

  useEffect(() => {
    document.title = `${state.map.title || 'Untitled map'} · Sketchmap`;
  }, [state.map.title]);

  // The ⌘K prompt belongs to one topic: close it when that topic goes away, gets edited, or stops being selected.
  useEffect(() => {
    if (linkFor && (!linkNode || state.editing || state.selectedId !== linkFor)) setLinkFor(null);
  }, [linkFor, linkNode, state.editing, state.selectedId]);

  /**
   * Header, toolbar and sidebar buttons keep focus where it is, so first close what is open there:
   * an inline edit commits (or a new empty topic is dropped), and a note still waiting for its pause is saved.
   */
  const endEdit = () => {
    const active = document.activeElement as HTMLElement | null;
    // Only what is typed into: a button of the panel pressed from the keyboard keeps the focus, so the
    // next key is the button's again and not the map's.
    const field = active?.tagName === 'TEXTAREA' || active?.tagName === 'INPUT';
    if (stateRef.current.editing || (field && active?.closest('.details'))) active?.blur();
  };
  // Uploads that finished while a topic was being edited: applied once editing ends (I1), so a finished
  // upload never blurs the inline editor or the Note box. If the topic is gone by then, the reducer
  // ignores the dispatch and the banner says why.
  const pendingImages = useRef<Array<{ id: string; image: { key: string; w: number; h: number } }>>([]);
  const applyPendingImages = () => {
    if (stateRef.current.editing || !pendingImages.current.length) return;
    const pending = pendingImages.current;
    pendingImages.current = [];
    for (const { id, image } of pending) {
      if (findNode(stateRef.current.map.root, id)) dispatch({ type: 'setImage', id, image });
      else setImageError('Image not added: the topic was removed before the upload finished.');
    }
  };
  // A layout effect, not a passive one: its dispatch is then flushed inside the same flushSync that ended the edit
  // (see exportAs), whereas a passive effect's update would be drawn only after the export had read the layout.
  useLayoutEffect(() => {
    if (!state.editing) applyPendingImages();
  }, [state.editing]);
  /** `id`: the topic the image goes to; null when nothing is selected and the image was not dropped on a topic. */
  const attachImage = async (id: string | null, file: File) => {
    if (id === null) {
      setImageError('Image not added: no topic is selected. Click a topic first, or drop the image on one.');
      return;
    }
    if (stateRef.current.editing?.isNew) {
      setImageError('Image not added: finish the new topic first (Enter), then add the image.');
      return;
    }
    setImageUploads((n) => n + 1);
    setImageError(null);
    try {
      const prepared = await prepareImage(file);
      const { key } = await api.uploadImage(initial.id, prepared.blob);
      const image = { key, ...displaySize(prepared.width, prepared.height) };
      // Never blur to apply the result: a focused Note box is fine (setImage doesn't touch notes), and a
      // focused inline editor keeps the keys it's given until the edit commits or cancels.
      if (stateRef.current.editing) pendingImages.current.push({ id, image });
      else dispatch({ type: 'setImage', id, image });
    } catch (e) {
      setImageError(`Image not added: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setImageUploads((n) => n - 1);
    }
  };
  const toggleDetails = () => {
    const next = !detailsOpen;
    setDetailsOpen(next);
    try {
      storage.setItem(DETAILS_KEY, next ? '1' : '0');
    } catch {
      // Storage blocked: the choice lasts until reload.
    }
  };
  const selectedNode = state.selectedId === null ? null : layout.byId.get(state.selectedId)?.node ?? findNode(state.map.root, state.selectedId)?.node ?? null;
  const selection = selectedIds(state);
  // Which steps of the text width would show on the selected topic: the Details panel offers only those.
  // Not known for several topics at once (each may differ), nor while the topic's text is open.
  const selectedDepth = state.selectedId === null ? undefined : layout.byId.get(state.selectedId)?.depth;
  const widthSteps = useMemo(() => {
    if (!selectedNode || selectedDepth === undefined || selection.length !== 1 || state.editing) return undefined;
    const leads = (step: 'wider' | 'narrower') => steppedWrap(selectedNode, selectedDepth, state.map.layout, step, measure) !== null;
    return { wider: leads('wider'), narrower: leads('narrower') };
  }, [selectedNode, selectedDepth, selection.length, state.editing, state.map.layout, measure]);

  /**
   * Moves topic `id` to a place. A place with a side (among the main branches of the map layout) also
   * fixes the side every other main branch is shown on, so nothing else changes sides.
   */
  const move = useCallback((id: string, place: Drop, alone = false) => {
    dispatch({ type: 'move', id, ...place, ...(place.side && { shown: shownSides(layoutRef.current) }), ...(alone && { alone }) });
  }, []);

  const run = useCallback((cmd: Command) => {
    const s = stateRef.current;
    // These need no selected topic.
    switch (cmd.type) {
      case 'selectAll':
        // Every topic on screen; topics inside a folded branch stay out, like for a box.
        dispatch({ type: 'selectMany', ids: layoutRef.current.boxes.map((b) => b.id) });
        return;
      case 'undo':
      case 'redo':
        dispatch({ type: cmd.type });
        return;
    }
    const current = s.selectedId;
    if (current === null) {
      // Nothing is selected (a click on the background). An arrow key selects the topic that was selected
      // last, or the central one when that topic is gone or folded away. Every other key has no topic to act on.
      if (cmd.type !== 'navigate') return;
      const back = lastSelected.current;
      dispatch({ type: 'select', id: back !== null && layoutRef.current.byId.has(back) ? back : s.map.root.id });
      return;
    }
    switch (cmd.type) {
      case 'edit':
        setEditInitial(cmd.initial ?? null);
        dispatch({ type: 'startEdit' });
        return;
      case 'fold':
        dispatch({ type: 'toggleFold' });
        return;
      case 'navigate': {
        const id = navigate(layoutRef.current, current, cmd.dir, s.map.layout);
        if (id) dispatch({ type: 'select', id });
        return;
      }
      case 'reorder': {
        // Only the current topic moves, also when several are selected.
        const place = stepSibling(layoutRef.current, current, cmd.dir);
        if (place) move(current, place, true);
        return;
      }
      case 'emphasis':
        dispatch({ type: 'bumpEmphasis', delta: cmd.delta });
        return;
      case 'priority':
        dispatch({ type: 'setPriority', id: current, priority: cmd.value === 0 ? null : cmd.value });
        return;
      case 'link':
        setLinkFor(current);
        return;
      case 'selectOne':
        dispatch({ type: 'select', id: current });
        return;
      default:
        dispatch({ type: cmd.type });
    }
  }, [move]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (stateRef.current.editing || modalRef.current) return;
      const t = e.target as HTMLElement | null;
      const cmd = keyToCommand(e);
      // Keys pressed in a field or on a control belong to it. The exception: a focused button or link has
      // no use for ⌘/Ctrl with an arrow, and left alone ⌘← would send the browser back.
      const ownKeys = !!t && (IGNORE_KEYS_IN.has(t.tagName) || t.isContentEditable);
      if (ownKeys && !(cmd?.type === 'reorder' && (t.tagName === 'BUTTON' || t.tagName === 'A'))) return;
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
    try {
      storage.removeItem(draftKey(initial.id));
    } catch {
      // nothing to remove
    }
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
      setLinkFor(null);
      return;
    }
    // Unlike the Outline panel, Copy writes images as `![](…)`, so they aren't lost here.
    const lost = markdownLosses(state.map.root).filter((l) => l !== 'images');
    navigator.clipboard.writeText(toMarkdown(state.map.root, { imageBase: location.origin })).then(
      () => {
        setMdCopied(true);
        setNotice(lost.length ? `Copied. Not kept in Markdown: ${lost.join(', ')}.` : null);
      },
      () => {
        setOutlineOpen(true);
        setLinkFor(null);
      },
    );
  };
  const applyOutline = (text: string): string | null => {
    const parsed = parseOutline(text);
    if (!parsed) return 'The outline is empty.';
    // The outline has no place for the side of a main branch: a branch whose text is still there keeps its
    // side. "Still there" is judged on the text as the outline shows it, which is what comes back.
    const before = stateRef.current.map.root;
    carrySides(before, parsed.root, mainBranchTextsInOutline(before) ?? undefined);
    dispatch({ type: 'replaceRoot', root: parsed.root });
    setOutlineOpen(false);
    return null;
  };
  const exportAs = async (kind: 'svg' | 'png' | 'excalidraw') => {
    if (exporting) return;
    // An inline edit still open, or a note still waiting for its pause, goes into the map first, so the
    // file shows what is on screen. flushSync makes the refs below reflect that commit before they are read.
    flushSync(endEdit);
    flushSync(applyPendingImages);
    const current = layoutRef.current;
    const title = plainTitle(stateRef.current.map.root);
    setExporting(true);
    try {
      setExportError(undefined);
      if (kind === 'excalidraw') {
        const { json, missingImages } = await buildExcalidraw(current);
        download(new Blob([json], { type: EXCALIDRAW_MIME }), fileName(title, 'excalidraw'));
        const items = [
          ...excalidrawLosses(current),
          ...(missingImages > 0 ? [`${missingImages} image${missingImages === 1 ? '' : 's'} that could not be loaded`] : []),
        ];
        setNotice(items.length ? `Downloaded. Not kept in .excalidraw: ${items.join(', ')}.` : null);
        return;
      }
      const svg = await buildSvg(current, visibleText(current));
      const blob = kind === 'svg' ? new Blob([svg], { type: 'image/svg+xml' }) : await svgToPng(svg);
      download(blob, fileName(title, kind));
    } catch (e) {
      setExportError(`Export failed: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setExporting(false);
    }
  };

  const editing = state.editing;
  const editBox = editing ? layout.byId.get(editing.id) : undefined;

  // The sign-in dialog after a refused save. Signing in with Google leaves this page, so it matters whether
  // this browser holds a copy of the changes as they are now (not when site data is blocked or full, and not
  // when only an older copy got written before storage filled up).
  const offerGoogle = askKey && (googleSession || keyUserGoogle === true);
  const dialogReady = askKey && (googleSession || keyUserGoogle !== null);
  const kept = offerGoogle ? readDraft(storage, initial.id) : null;
  const draftKept = !!kept && JSON.stringify([kept.map.root, kept.map.layout]) === JSON.stringify([state.map.root, state.map.layout]);
  const refused = googleSession ? 'Your sign-in has ended.' : 'The owner key was rejected.';
  const signInAgainMessage = !offerGoogle
    ? `${refused} Enter it again to keep saving.`
    : draftKept
      ? `${refused} Sign in again to keep saving. Your changes are kept in this browser and offered back when you return.`
      : `${refused} Signing in with Google leaves this page, and this browser could not keep a copy of your changes. Copy what you need first (Copy as Markdown), or use the owner key.`;

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
        <button type="button" aria-pressed={detailsOpen} onClick={toggleDetails}>Details</button>
        <button type="button" onClick={() => { setOutlineOpen(true); setLinkFor(null); }}>Outline</button>
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
      {notice && (
        <div className="banner" role="status">
          {notice}
          <button type="button" onClick={() => setNotice(null)}>Dismiss</button>
        </div>
      )}
      {exportError && <div className="banner" role="alert">{exportError}</div>}
      {imageError && (
        <div className="banner" role="alert">
          {imageError}
          <button type="button" onClick={() => setImageError(null)}>Dismiss</button>
        </div>
      )}
      {status === 'rejected' && (
        <div className="banner" role="alert">
          The server refused this save: {rejectedMessage}. Your changes are kept in this browser.
        </div>
      )}
      <main className={detailsOpen ? 'editor-stage details-open' : 'editor-stage'}>
        <Canvas
          ref={canvas}
          layout={layout}
          selectedId={state.selectedId}
          extraIds={state.extraIds}
          interactive
          onSelect={(id) => dispatch({ type: 'select', id })}
          onToggleSelect={(id) => dispatch({ type: 'toggleSelect', id })}
          onSelectMany={(ids) => {
            // A click on the background takes the focus from an open text box before it gets here, which ends
            // the typing. A tap with a finger gets here first (and on a phone may take no focus at all): end
            // the typing now, so that in both cases the text is kept first and the selection changes after.
            endEdit();
            dispatch({ type: 'selectMany', ids });
          }}
          onEdit={(id) => {
            setEditInitial(null);
            dispatch({ type: 'startEdit', id });
          }}
          onMove={move}
          // No handle while an image uploads, as S, M and L are locked then: a replacement that arrives
          // late would undo the new size.
          onResizeImage={imageUploads > 0 ? undefined : (id, size) => {
            // The press on the handle takes no focus, so a text box that is open is closed here: its text is
            // kept first, and the image changes after (the reducer changes no image while a text is open).
            endEdit();
            dispatch({ type: 'resizeImage', id, ...size });
          }}
          // No bar on the topic's side while a text box is open: the box is over the topic then.
          onWrapText={state.editing ? undefined : (id, wrap) => dispatch({ type: 'setWrap', id, wrap })}
          measure={measure}
          onToggleFold={(id) => dispatch({ type: 'toggleFold', id })}
          onDropFile={(id, file) => void attachImage(id ?? state.selectedId, file)}
          onViewChange={setView}
          rightInset={detailsOpen ? 296 : 44}
        />
        {editing && editBox && (
          <InlineEditor
            key={editing.id}
            box={editBox}
            view={view}
            measure={measure}
            initialText={editInitial ?? editBox.node.text}
            selectAll={editInitial === null}
            onCommit={commit}
            onCancel={cancel}
            onTab={tab}
            // A long text makes the box wide: it stays clear of the Details panel and inside the canvas.
            onGrow={(place, grows) => canvas.current?.reveal(place, grows)}
          />
        )}
        {!detailsOpen && (
          <button type="button" className="float details-tab" aria-label="Show topic details" title="Show topic details" onMouseDown={(e) => e.preventDefault()} onClick={toggleDetails}>
            <span aria-hidden="true">◂</span>
            <span className="details-tab-label">Details</span>
          </button>
        )}
        {detailsOpen && selectedNode && (
          <DetailsPanel
            // Prefixed so this key never collides with the inline editor's `key={editing.id}` sibling above:
            // when a topic is both selected and being edited (the common case), the bare ids would match and
            // React's reconciler would misattribute the two different-typed siblings, leaking a stale <textarea>.
            key={`details-${selectedNode.id}`}
            node={selectedNode}
            count={selection.length}
            onEmphasis={(emphasis) => {
              const id = selectedNode.id;
              endEdit();
              dispatch({ type: 'setEmphasis', id, emphasis });
            }}
            onPriority={(priority) => {
              const id = selectedNode.id;
              endEdit();
              dispatch({ type: 'setPriority', id, priority });
            }}
            onMarker={(emoji) => {
              const id = selectedNode.id;
              endEdit();
              dispatch({ type: 'setMarker', id, emoji });
            }}
            onNote={(id, note) => dispatch({ type: 'setNote', id, note })}
            onImageFile={(file) => void attachImage(selectedNode.id, file)}
            onImageSize={(size) => {
              const { id, image } = selectedNode;
              // The size it already has stays as it is, to the pixel.
              if (!image || image.w === IMAGE_SIZES[size]) return;
              endEdit();
              // In the picture's own proportions when the browser knows them (the canvas asks for them when
              // the topic is selected); else in those of the size it has now.
              const own = pictureSize(image.key) ?? image;
              dispatch({ type: 'resizeImage', id, ...displaySize(own.w, own.h, IMAGE_SIZES[size]) });
            }}
            onImageRemove={() => {
              const id = selectedNode.id;
              endEdit();
              dispatch({ type: 'setImage', id, image: null });
            }}
            onTextWidth={(step) => {
              const id = selectedNode.id;
              endEdit();
              dispatch({ type: 'stepWrap', id, step, measure });
            }}
            autoWrap={layout.byId.get(selectedNode.id)?.style.maxW}
            steps={widthSteps}
            uploading={imageUploads > 0}
            newTopicOpen={!!state.editing?.isNew}
            onFold={toggleDetails}
          />
        )}
        {detailsOpen && !selectedNode && <NoTopicDetails onFold={toggleDetails} />}
        {outlineOpen && (
          <OutlinePanel initialText={toMarkdown(state.map.root)} onApply={applyOutline} onClose={() => setOutlineOpen(false)} lost={markdownLosses(state.map.root)} />
        )}
        {linkFor && linkNode && (
          <LinkPrompt
            key={`link-${linkFor}`}
            hasLink={parseRich(linkNode.text).links.some((l) => !l.bare)}
            onApply={(href) => {
              if (linkWhole(linkNode.text, href).length > 5000) return 'With this link the topic would be longer than 5000 characters.';
              dispatch({ type: 'setLink', id: linkFor, href });
              setLinkFor(null);
              return null;
            }}
            onClose={() => setLinkFor(null)}
          />
        )}
        <Toolbar
          zoom={view.k}
          canUndo={state.past.length > 0}
          canRedo={state.future.length > 0}
          canAdd={selection.length > 0}
          canDelete={selection.some((id) => id !== state.map.root.id)}
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
              <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => exportAs('svg')} disabled={exporting}>SVG</button>
              <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => exportAs('png')} disabled={exporting}>PNG</button>
              <button
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => exportAs('excalidraw')}
                disabled={exporting}
                title="Download a .excalidraw file to keep drawing in Excalidraw"
              >
                Excalidraw
              </button>
              <span className="sep" />
              <ThemePicker save={(theme) => api.saveTheme(theme)} />
            </>
          }
        />
      </main>
      {conflict && <ConflictDialog onLoadNewer={loadNewer} onKeepMine={keepMine} error={dialogError} />}
      {dialogReady && (
        <div className="dialog-backdrop">
          <SignIn
            google={offerGoogle}
            next={`/e/${initial.id}`}
            message={signInAgainMessage}
            onGoogle={(e) => {
              // Only a plain click leaves this page; a ⌘/Ctrl, Shift or middle click opens Google elsewhere.
              const sameTab = e.button === 0 && !e.metaKey && !e.ctrlKey && !e.shiftKey && !e.altKey;
              leavingToSignIn.current = sameTab && draftKept;
            }}
            onKey={(key) => {
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
  const { access, enterKey, recheck } = useAccess();
  const signedIn = access.state === 'in';
  const [attempt, setAttempt] = useState(0);
  const [load, setLoad] = useState<Load>({ status: 'loading' });

  useEffect(() => {
    if (!signedIn) return;
    let alive = true;
    setLoad({ status: 'loading' });
    api.getMap(id).then(
      ({ map, etag }) => alive && setLoad({ status: 'ready', map, etag }),
      (e) => alive && setLoad(e instanceof ApiError && e.status === 404 ? { status: 'missing' } : { status: 'error', message: String(e?.message ?? e) }),
    );
    return () => {
      alive = false;
    };
  }, [api, id, signedIn, attempt]);

  if (access.state === 'checking') return <p className="center muted">Loading…</p>;
  if (access.state === 'out') {
    return (
      <div className="center">
        <SignIn google={access.google} next={`/e/${id}`} message={access.message} onRetry={access.unreachable ? recheck : undefined} onKey={enterKey} />
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
  return <Editor initial={load.map} etag={load.etag} api={api} googleSession={access.email !== null} />;
}
