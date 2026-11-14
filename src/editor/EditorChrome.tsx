import type { MouseEvent, ReactNode } from 'react';
import type { SaveStatus } from './autosave';

export const STATUS_TEXT: Record<SaveStatus, string> = {
  saved: 'Saved',
  pending: 'Saving…',
  saving: 'Saving…',
  retrying: 'Not saved, retrying',
  conflict: 'Not saved: conflict',
  unauthorized: 'Not saved: sign in again',
  rejected: 'Not saved: rejected by the server',
};

export function SaveBadge({ status }: { status: SaveStatus }) {
  return (
    <span className={`save-badge ${status}`} data-testid="save-status" role="status">
      {STATUS_TEXT[status]}
    </span>
  );
}

// Buttons don't take focus on mouse click, so keyboard shortcuts keep working afterwards.
const noFocus = (e: MouseEvent) => e.preventDefault();

export interface ToolbarProps {
  zoom: number;
  canUndo: boolean;
  canRedo: boolean;
  canDelete: boolean;
  onAddChild(): void;
  onAddSibling(): void;
  onDelete(): void;
  onUndo(): void;
  onRedo(): void;
  onZoomIn(): void;
  onZoomOut(): void;
  onFit(): void;
  extra?: ReactNode;
}

export function Toolbar(p: ToolbarProps) {
  return (
    <div className="float toolbar" role="toolbar" aria-label="Map tools">
      <button type="button" onMouseDown={noFocus} onClick={p.onAddChild} title="Add child topic (Tab)">+ Child</button>
      <button type="button" onMouseDown={noFocus} onClick={p.onAddSibling} title="Add sibling topic (Enter)">+ Sibling</button>
      <button type="button" onMouseDown={noFocus} onClick={p.onDelete} disabled={!p.canDelete} title="Delete topic (Delete)">Delete</button>
      <span className="sep" />
      <button type="button" onMouseDown={noFocus} onClick={p.onUndo} disabled={!p.canUndo} title="Undo (⌘/Ctrl Z)">Undo</button>
      <button type="button" onMouseDown={noFocus} onClick={p.onRedo} disabled={!p.canRedo} title="Redo (⌘/Ctrl Shift Z)">Redo</button>
      <span className="sep" />
      <button type="button" onMouseDown={noFocus} onClick={p.onZoomOut} aria-label="Zoom out">−</button>
      <span className="zoom">{Math.round(p.zoom * 100)}%</span>
      <button type="button" onMouseDown={noFocus} onClick={p.onZoomIn} aria-label="Zoom in">+</button>
      <button type="button" onMouseDown={noFocus} onClick={p.onFit}>Fit</button>
      {p.extra}
    </div>
  );
}

export function ConflictDialog({ onLoadNewer, onKeepMine, error }: { onLoadNewer(): void; onKeepMine(): void; error?: string }) {
  return (
    <div className="dialog-backdrop">
      <div className="dialog" role="dialog" aria-modal="true" aria-labelledby="conflict-title">
        <h2 id="conflict-title">This map changed somewhere else</h2>
        <p>Another tab or device saved a newer version after you opened this one. Your latest changes are kept in this browser until you choose.</p>
        {error && <p role="alert" className="error">{error}</p>}
        <button type="button" className="primary" onClick={onLoadNewer}>Load the newer version</button>
        <button type="button" onClick={onKeepMine}>Keep mine and overwrite</button>
      </div>
    </div>
  );
}

export function DraftBanner({
  savedAt,
  onRestore,
  onDiscard,
  olderThanServer,
}: {
  savedAt: number;
  onRestore(): void;
  onDiscard(): void;
  olderThanServer?: boolean;
}) {
  const when = new Date(savedAt).toLocaleString();
  return (
    <div className="banner" role="status">
      <span>
        {olderThanServer
          ? `This browser has unsaved changes from ${when}, older than the saved map. Restoring will ask before overwriting.`
          : `This browser has unsaved changes from ${when}.`}
      </span>
      <button type="button" onClick={onRestore}>Restore</button>
      <button type="button" onClick={onDiscard}>Discard</button>
    </div>
  );
}
