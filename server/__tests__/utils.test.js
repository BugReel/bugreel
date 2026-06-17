import { describe, it, expect } from 'vitest';
import { decodeHeaderValue } from '../utils.js';

describe('decodeHeaderValue', () => {
  it('returns empty string for null/undefined/empty', () => {
    expect(decodeHeaderValue(null)).toBe('');
    expect(decodeHeaderValue(undefined)).toBe('');
    expect(decodeHeaderValue('')).toBe('');
  });

  it('passes plain ASCII through unchanged', () => {
    expect(decodeHeaderValue('John Doe')).toBe('John Doe');
    expect(decodeHeaderValue('john@example.com')).toBe('john@example.com');
  });

  it('decodes percent-encoded Cyrillic from a proxy header', () => {
    // "Ксения" URL-encoded the way a proxy does for non-ASCII header values
    const encoded = encodeURIComponent('Ксения Петрова');
    expect(encoded).toMatch(/%[0-9A-F]{2}/);
    expect(decodeHeaderValue(encoded)).toBe('Ксения Петрова');
  });

  it('is idempotent: an already-decoded name has no %XX, returns unchanged', () => {
    const name = 'Ксения Петрова';
    expect(decodeHeaderValue(name)).toBe(name);
    expect(decodeHeaderValue(decodeHeaderValue(name))).toBe(name);
  });

  it('falls back to the raw value on malformed percent-encoding', () => {
    // a stray % that is not a valid escape would throw inside decodeURIComponent
    expect(decodeHeaderValue('50% off')).toBe('50% off');
    expect(decodeHeaderValue('%')).toBe('%');
    expect(decodeHeaderValue('%zz')).toBe('%zz');
  });

  it('coerces non-string input to string', () => {
    expect(decodeHeaderValue(12345)).toBe('12345');
  });
});
