import { describe, expect, it } from 'vitest';
import { parseRoute } from './router';

const id = 'abcdefghijklmnopqrstu';
describe('parseRoute', () => {
  it.each([
    ['/', { name: 'list' }],
    [`/e/${id}`, { name: 'editor', id }],
    [`/m/${id}`, { name: 'view', id }],
    [`/m/${id}/`, { name: 'view', id }],
    ['/m/short', { name: 'notFound' }],
    ['/x', { name: 'notFound' }],
  ])('%s', (path, route) => {
    expect(parseRoute(path)).toEqual(route);
  });
});
