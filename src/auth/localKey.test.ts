import { describe, expect, it } from 'vitest';
import { isThisMachine, mayHandOverLocalKey } from './localKey';

describe('isThisMachine', () => {
  it('accepts only the names a machine uses for itself', () => {
    for (const host of ['localhost', 'LOCALHOST', '127.0.0.1', '::1', '[::1]']) expect(isThisMachine(host), host).toBe(true);
    for (const host of ['', '0.0.0.0', '192.168.1.5', 'localhost.example.com', 'sketchmap.example.workers.dev']) {
      expect(isThisMachine(host), host).toBe(false);
    }
  });
});

describe('mayHandOverLocalKey', () => {
  it('lets the plain local dev server hand its key to the page', () => {
    expect(mayHandOverLocalKey({ command: 'serve' })).toBe(true);
    expect(mayHandOverLocalKey({ command: 'serve', host: 'localhost' })).toBe(true);
    expect(mayHandOverLocalKey({ command: 'serve', host: '127.0.0.1' })).toBe(true);
    expect(mayHandOverLocalKey({ command: 'serve', host: false })).toBe(true);
  });
  it('never does it for a build, so a deployed site always asks for the key', () => {
    expect(mayHandOverLocalKey({ command: 'build' })).toBe(false);
    expect(mayHandOverLocalKey({ command: 'serve', isPreview: true })).toBe(false);
  });
  it('never does it for the browser tests’ servers, which must ask for the key like the real site', () => {
    expect(mayHandOverLocalKey({ command: 'serve', testServer: true })).toBe(false);
  });
  it('never does it when the dev server is opened to other machines', () => {
    expect(mayHandOverLocalKey({ command: 'serve', host: true })).toBe(false);
    expect(mayHandOverLocalKey({ command: 'serve', host: '0.0.0.0' })).toBe(false);
    expect(mayHandOverLocalKey({ command: 'serve', host: '::' })).toBe(false);
    expect(mayHandOverLocalKey({ command: 'serve', host: '192.168.1.5' })).toBe(false);
  });
});
