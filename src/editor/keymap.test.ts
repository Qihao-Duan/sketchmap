import { describe, expect, it } from 'vitest';
import { keyToCommand, type KeyInput } from './keymap';

const k = (key: string, mods: Partial<KeyInput> = {}): KeyInput => ({ key, metaKey: false, ctrlKey: false, shiftKey: false, altKey: false, ...mods });

describe('keyToCommand', () => {
  it.each([
    [k('Tab'), { type: 'addChild' }],
    [k('Enter'), { type: 'addSibling' }],
    [k('Delete'), { type: 'delete' }],
    [k('Backspace'), { type: 'delete' }],
    [k(' '), { type: 'edit' }],
    [k('F2'), { type: 'edit' }],
    [k('/'), { type: 'fold' }],
    [k('/', { metaKey: true }), { type: 'fold' }],
    [k('z', { metaKey: true }), { type: 'undo' }],
    [k('z', { ctrlKey: true }), { type: 'undo' }],
    [k('Z', { metaKey: true, shiftKey: true }), { type: 'redo' }],
    [k('y', { ctrlKey: true }), { type: 'redo' }],
    [k('ArrowLeft'), { type: 'navigate', dir: 'left' }],
    [k('ArrowDown'), { type: 'navigate', dir: 'down' }],
    [k('q'), { type: 'edit', initial: 'q' }],
  ])('%o → %o', (input, expected) => {
    expect(keyToCommand(input)).toEqual(expected);
  });

  it('ignores IME composition, Alt combos, Shift+Tab and unknown keys', () => {
    expect(keyToCommand(k('Process', { isComposing: true }))).toBeNull();
    expect(keyToCommand(k('a', { isComposing: true }))).toBeNull();
    expect(keyToCommand(k('ArrowUp', { altKey: true }))).toBeNull();
    expect(keyToCommand(k('Tab', { shiftKey: true }))).toBeNull();
    expect(keyToCommand(k('Escape'))).toBeNull();
    expect(keyToCommand(k('c', { metaKey: true }))).toBeNull();
  });
});
