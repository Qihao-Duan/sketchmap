import { describe, expect, it } from 'vitest';
import { plainTitle } from './title';

const node = (text: string) => ({ id: 'r', text, children: [] });

describe('plainTitle', () => {
  it('uses the first line of the root text, trimmed', () => {
    expect(plainTitle(node('  Weekly plan \nsecond line'))).toBe('Weekly plan');
  });
  it('falls back to "Untitled map" for empty text', () => {
    expect(plainTitle(node('   '))).toBe('Untitled map');
  });
  it('caps the title at 120 characters', () => {
    expect(plainTitle(node('x'.repeat(300)))).toHaveLength(120);
  });
});
