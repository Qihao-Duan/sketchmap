// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { computeLayout } from '../layout/map';
import { buildSvg, bytesToBase64, fileName } from './exportImage';

const layout = computeLayout(
  { id: 'r', text: 'Root', children: [{ id: 'a', text: 'A', children: [{ id: 'a1', text: 'A1', children: [] }] }] },
  (t, s) => t.length * s * 0.5,
);

describe('export', () => {
  it('builds a standalone SVG with only the needed font subset embedded', async () => {
    const fetchImpl = vi.fn(async () => new Response(new Uint8Array([1, 2, 3]))) as unknown as typeof fetch;
    const svg = await buildSvg(layout, 'Root\nA\nA1', { fetchImpl });
    expect(vi.mocked(fetchImpl)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(fetchImpl).mock.calls[0][0]).toMatch(/^\/fonts\/Excalifont\//);
    expect(svg).toContain('xmlns="http://www.w3.org/2000/svg"');
    expect(svg).toContain('src:url(data:font/woff2;base64,AQID)');
    expect(svg.match(/class="topic"/g)).toHaveLength(3);
    expect(svg).not.toContain('class="hit"');
    const { x, y } = layout.bounds;
    expect(svg).toContain(`viewBox="${x - 40} ${y - 40} `);
  });

  it('fails clearly when a font file cannot be fetched', async () => {
    const fetchImpl = (async () => new Response('', { status: 404 })) as unknown as typeof fetch;
    await expect(buildSvg(layout, 'Root', { fetchImpl })).rejects.toThrow(/Font .*404/);
  });

  it('encodes bytes and makes safe file names', () => {
    expect(bytesToBase64(new Uint8Array([0, 1, 2]))).toBe('AAEC');
    expect(fileName('  Plan: Q4/Q1?  ', 'png')).toBe('Plan- Q4-Q1-.png');
    expect(fileName('   ', 'svg')).toBe('mindmap.svg');
  });
});
