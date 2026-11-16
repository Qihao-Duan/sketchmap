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
    [k('k', { metaKey: true }), { type: 'link' }],
    [k('K', { ctrlKey: true }), { type: 'link' }],
    [k('a', { metaKey: true }), { type: 'selectAll' }],
    [k('A', { ctrlKey: true }), { type: 'selectAll' }],
    [k('Escape'), { type: 'selectOne' }],
    [k('ArrowLeft'), { type: 'navigate', dir: 'left' }],
    [k('ArrowDown'), { type: 'navigate', dir: 'down' }],
    [k('q'), { type: 'edit', initial: 'q' }],
    [k('ArrowUp', { metaKey: true }), { type: 'reorder', dir: 'up' }],
    [k('ArrowDown', { ctrlKey: true }), { type: 'reorder', dir: 'down' }],
    [k('ArrowLeft', { metaKey: true }), { type: 'reorder', dir: 'left' }],
    [k('ArrowRight', { ctrlKey: true }), { type: 'reorder', dir: 'right' }],
    [k('ArrowUp', { altKey: true }), { type: 'emphasis', delta: 1 }],
    [k('ArrowDown', { altKey: true }), { type: 'emphasis', delta: -1 }],
    [k('¡', { altKey: true, code: 'Digit1' }), { type: 'priority', value: 1 }],
    [k('3', { altKey: true, code: 'Numpad3' }), { type: 'priority', value: 3 }],
    [k('º', { altKey: true, code: 'Digit0' }), { type: 'priority', value: 0 }],
  ])('%o → %o', (input, expected) => {
    expect(keyToCommand(input)).toEqual(expected);
  });

  it('ignores IME composition, Alt combos, Shift+Tab and unknown keys', () => {
    expect(keyToCommand(k('Process', { isComposing: true }))).toBeNull();
    expect(keyToCommand(k('a', { isComposing: true }))).toBeNull();
    expect(keyToCommand(k('ArrowLeft', { altKey: true }))).toBeNull();
    expect(keyToCommand(k('4', { altKey: true, code: 'Digit4' }))).toBeNull();
    expect(keyToCommand(k('å', { altKey: true, code: 'KeyA' }))).toBeNull();
    expect(keyToCommand(k('Tab', { shiftKey: true }))).toBeNull();
    expect(keyToCommand(k('Escape', { metaKey: true }))).toBeNull();
    expect(keyToCommand(k('c', { metaKey: true }))).toBeNull();
    expect(keyToCommand(k('ArrowUp', { metaKey: true, shiftKey: true }))).toBeNull();
    expect(keyToCommand(k('ArrowUp', { ctrlKey: true, altKey: true }))).toBeNull();
  });
});
