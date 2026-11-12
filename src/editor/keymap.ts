export type Direction = 'up' | 'down' | 'left' | 'right';

export type Command =
  | { type: 'addChild' }
  | { type: 'addSibling' }
  | { type: 'delete' }
  | { type: 'edit'; initial?: string }
  | { type: 'fold' }
  | { type: 'undo' }
  | { type: 'redo' }
  | { type: 'navigate'; dir: Direction };

export interface KeyInput {
  key: string;
  metaKey: boolean;
  ctrlKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
  isComposing?: boolean;
}

const ARROWS: Record<string, Direction> = { ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right' };

/** Keys while a topic is selected and no text box is open. */
export function keyToCommand(e: KeyInput): Command | null {
  if (e.isComposing) return null;
  if (e.metaKey || e.ctrlKey) {
    const key = e.key.toLowerCase();
    if (key === 'z') return { type: e.shiftKey ? 'redo' : 'undo' };
    if (key === 'y') return { type: 'redo' };
    if (e.key === '/') return { type: 'fold' };
    return null;
  }
  if (e.altKey) return null;
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
  }
  return e.key.length === 1 ? { type: 'edit', initial: e.key } : null;
}
