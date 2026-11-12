import type { MindMap } from '../shared/types';
import { ApiError, type Saved } from '../api/client';

export type SaveStatus = 'saved' | 'pending' | 'saving' | 'retrying' | 'conflict' | 'unauthorized';
export const SAVE_DELAY_MS = 1000;
export const MAX_BACKOFF_MS = 60_000;

export interface AutosaveDeps {
  save(map: MindMap, etag: string): Promise<Saved>;
  storage: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
  setTimer(fn: () => void, ms: number): unknown;
  clearTimer(handle: unknown): void;
  now(): number;
}

export interface Draft {
  map: MindMap;
  etag: string;
  savedAt: number;
}

export const draftKey = (id: string) => `sketchmap:draft:${id}`;

export function readDraft(storage: Pick<Storage, 'getItem'>, id: string): Draft | null {
  try {
    const raw = storage.getItem(draftKey(id));
    return raw ? (JSON.parse(raw) as Draft) : null;
  } catch {
    return null;
  }
}

export class Autosaver {
  private etag: string;
  private latest: MindMap | null = null;
  private timer: unknown = null;
  private inFlight = false;
  private failures = 0;
  private status: SaveStatus = 'saved';

  constructor(
    private deps: AutosaveDeps,
    initialEtag: string,
    private onStatus: (status: SaveStatus) => void,
    private onSaved: (saved: Saved) => void,
  ) {
    this.etag = initialEtag;
  }

  get currentEtag(): string {
    return this.etag;
  }

  /** Call after every change: keeps a local draft now and saves 1 s after the last call. */
  schedule(map: MindMap): void {
    this.latest = map;
    try {
      this.deps.storage.setItem(draftKey(map.id), JSON.stringify({ map, etag: this.etag, savedAt: this.deps.now() }));
    } catch {
      // storage full or blocked: the server save still runs
    }
    if (this.status === 'conflict' || this.status === 'unauthorized') return;
    this.setStatus('pending');
    this.arm(SAVE_DELAY_MS);
  }

  /** Save right away, for example before the page closes. */
  async flush(): Promise<void> {
    if (this.timer) this.deps.clearTimer(this.timer);
    this.timer = null;
    await this.run();
  }

  /** Continue after a conflict was resolved or a new key was entered. */
  resume(etag: string, map?: MindMap): void {
    this.etag = etag;
    this.failures = 0;
    if (map) this.latest = map;
    this.status = 'pending';
    if (this.latest) this.arm(0);
    else this.setStatus('saved');
  }

  dispose(): void {
    if (this.timer) this.deps.clearTimer(this.timer);
    this.timer = null;
  }

  /** Drop pending changes and the local draft, e.g. after loading the newer server version. */
  discard(etag: string, mapId: string): void {
    this.dispose();
    this.etag = etag;
    this.latest = null;
    this.failures = 0;
    try {
      this.deps.storage.removeItem(draftKey(mapId));
    } catch {
      // ignore
    }
    this.setStatus('saved');
  }

  private arm(ms: number) {
    if (this.timer) this.deps.clearTimer(this.timer);
    this.timer = this.deps.setTimer(() => {
      this.timer = null;
      void this.run();
    }, ms);
  }

  private async run(): Promise<void> {
    if (this.inFlight || !this.latest) return;
    const map = this.latest;
    this.inFlight = true;
    this.setStatus('saving');
    try {
      const saved = await this.deps.save(map, this.etag);
      this.etag = saved.etag;
      this.failures = 0;
      if (this.latest === map) {
        this.latest = null;
        try {
          this.deps.storage.removeItem(draftKey(map.id));
        } catch {
          // ignore
        }
        this.setStatus('saved');
      } else {
        this.setStatus('pending'); // edits arrived while saving
        this.arm(SAVE_DELAY_MS);
      }
      this.onSaved(saved);
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) this.setStatus('conflict');
      else if (e instanceof ApiError && e.status === 401) this.setStatus('unauthorized');
      else {
        this.failures += 1;
        this.setStatus('retrying');
        this.arm(Math.min(MAX_BACKOFF_MS, 1000 * 2 ** this.failures));
      }
    } finally {
      this.inFlight = false;
    }
  }

  private setStatus(status: SaveStatus) {
    if (status === this.status) return;
    this.status = status;
    this.onStatus(status);
  }
}
