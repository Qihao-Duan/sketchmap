// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ListPage } from './ListPage';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const id = 'abcdefghijklmnopqrstu';
let container: HTMLDivElement;
const render = async (go = vi.fn()) => {
  container = document.createElement('div');
  document.body.appendChild(container);
  await act(async () => createRoot(container).render(<ListPage go={go} />));
  await act(async () => {});
  return go;
};
const button = (text: string) => [...container.querySelectorAll('button')].find((b) => b.textContent === text)!;
const click = (text: string) => act(async () => { button(text).click(); });

function stubApi() {
  const calls: Array<[string, string]> = [];
  vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit = {}) => {
    const method = init.method ?? 'GET';
    calls.push([method, url]);
    if (method === 'POST') return Response.json({ id, title: 'Central topic', layout: 'map', version: 1, updatedAt: 't', root: { id: 'r', text: 'Central topic', children: [] } }, { status: 201 });
    if (method === 'DELETE') return new Response(null, { status: 204 });
    return Response.json([{ id, title: 'Weekly plan', updatedAt: '2026-11-12T10:00:00.000Z' }]);
  }));
  return calls;
}

beforeEach(() => localStorage.clear());
afterEach(() => { container.remove(); vi.unstubAllGlobals(); });

describe('ListPage', () => {
  it('asks for the owner key first', async () => {
    stubApi();
    await render();
    expect(container.querySelector('#owner-key')).not.toBeNull();
  });

  it('lists maps and opens a new one after creating it', async () => {
    localStorage.setItem('sketchmap:owner-key', 'k');
    const calls = stubApi();
    const go = await render();
    expect(container.textContent).toContain('Weekly plan');
    expect(container.querySelector(`a[href="/e/${id}"]`)).not.toBeNull();
    await click('New map');
    expect(calls).toContainEqual(['POST', '/api/maps']);
    expect(go).toHaveBeenCalledWith(`/e/${id}`);
  });

  it('deletes only after the in-page confirmation', async () => {
    localStorage.setItem('sketchmap:owner-key', 'k');
    const calls = stubApi();
    await render();
    await click('Delete…');
    expect(calls.some(([m]) => m === 'DELETE')).toBe(false);
    await click('Delete');
    expect(calls).toContainEqual(['DELETE', `/api/maps/${id}`]);
  });
});
