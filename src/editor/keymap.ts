export type Direction = 'up' | 'down' | 'left' | 'right';

export type Command =
  | { type: 'addChild' }
  | { type: 'addSibling' }
  | { type: 'delete' }
  | { type: 'edit'; initial?: string }
  | { type: 'fold' }
  | { type: 'undo' }
  | { type: 'redo' }
  | { type: 'navigate'; dir: Direction }
  /** Move the current topic one place that way among its siblings. */
  | { type: 'reorder'; dir: Direction }
  | { type: 'selectAll' }
  | { type: 'selectOne' }
  | { type: 'emphasis'; delta: 1 | -1 }
  | { type: 'priority'; value: 0 | 1 | 2 | 3 }
  | { type: 'link' };

export interface KeyInput {
  key: string;
  metaKey: boolean;
  ctrlKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
  isComposing?: boolean;
  /** Physical key, such as "Digit2". Option+2 types "™" on macOS, so the priority shortcuts read the code. */
  code?: string;
}

const ARROWS: Record<string, Direction> = { ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right' };

/** Keys while a topic is selected and no text box is open. */
export function keyToCommand(e: KeyInput): Command | null {
  if (e.isComposing) return null;
  if (e.metaKey || e.ctrlKey) {
    const key = e.key.toLowerCase();
    if (key === 'z') return { type: e.shiftKey ? 'redo' : 'undo' };
    if (key === 'y') return { type: 'redo' };
    if (key === 'k') return { type: 'link' };
    if (key === 'a') return { type: 'selectAll' };
    if (e.key === '/') return { type: 'fold' };
    if (e.key in ARROWS && !e.shiftKey && !e.altKey) return { type: 'reorder', dir: ARROWS[e.key] };
    return null;
  }
  if (e.altKey) {
    if (e.key === 'ArrowUp') return { type: 'emphasis', delta: 1 };
    if (e.key === 'ArrowDown') return { type: 'emphasis', delta: -1 };
    const digit = /^(?:Digit|Numpad)([0-3])$/.exec(e.code ?? '');
    return digit ? { type: 'priority', value: Number(digit[1]) as 0 | 1 | 2 | 3 } : null;
  }
  if (e.key in ARROWS) return { type: 'navigate', dir: ARROWS[e.key] };
  switch (e.key) {
    case 'Tab':
      return e.shiftKey ? null : { type: 'addChild' };
    case 'Enter':
      return { type: 'addSibling' };
    case 'Delete':
    case 'Backspace':
      return { type: 'delete' };
    case ' ':
    case 'F2':
      return { type: 'edit' };
    case '/':
      return { type: 'fold' };
    case 'Escape':
      return { type: 'selectOne' };
  }
  return e.key.length === 1 ? { type: 'edit', initial: e.key } : null;
}
