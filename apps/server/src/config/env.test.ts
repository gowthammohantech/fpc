import { describe, expect, it } from 'vitest';
import { booleanFlag } from './env.js';

/**
 * These lock down a bug that shipped once: `z.coerce.boolean()` is
 * `Boolean(value)`, and environment variables are always strings, so
 * `SMTP_SECURE=false` became `true` and the documented Mailpit setup tried
 * TLS against a plaintext port. Every one of these cases would have passed
 * incorrectly under the old parser.
 */
describe('boolean environment flags', () => {
  it('reads the words people write in a .env file as false', () => {
    for (const value of ['false', 'FALSE', 'False', '0', 'no', 'off', ' false ', '']) {
      expect(booleanFlag(true).parse(value), value || '(empty)').toBe(false);
    }
  });

  it('reads the affirmative spellings as true', () => {
    for (const value of ['true', 'TRUE', '1', 'yes', 'on', ' true ']) {
      expect(booleanFlag(false).parse(value), value).toBe(true);
    }
  });

  it('applies the default when the variable is absent', () => {
    expect(booleanFlag(true).parse(undefined)).toBe(true);
    expect(booleanFlag(false).parse(undefined)).toBe(false);
  });

  it('passes real booleans through unchanged', () => {
    expect(booleanFlag(false).parse(true)).toBe(true);
    expect(booleanFlag(true).parse(false)).toBe(false);
  });

  it('rejects an ambiguous value rather than guessing', () => {
    expect(() => booleanFlag(false).parse('maybe')).toThrow(/Expected a boolean/);
    expect(() => booleanFlag(false).parse('2')).toThrow(/Expected a boolean/);
  });
});
