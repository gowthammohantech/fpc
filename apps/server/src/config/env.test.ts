import { describe, expect, it } from 'vitest';
import { booleanFlag, validateOutlookConfig } from './env.js';

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

describe('Outlook environment configuration', () => {
  const validOutlookConfig = {
    NODE_ENV: 'development',
    OUTLOOK_ENABLED: true,
    OUTLOOK_CLIENT_ID: '00000000-0000-0000-0000-000000000001',
    OUTLOOK_CLIENT_SECRET: 'client-secret-value',
    OUTLOOK_REDIRECT_URI: 'http://localhost:4000/api/auth/outlook/callback',
  } satisfies Parameters<typeof validateOutlookConfig>[0];

  it('allows localhost callback URLs in development', () => {
    expect(() => validateOutlookConfig(validOutlookConfig)).not.toThrow();
  });

  it('does not require Outlook credentials while the connector is disabled', () => {
    expect(() =>
      validateOutlookConfig({
        NODE_ENV: 'development',
        OUTLOOK_ENABLED: false,
        OUTLOOK_REDIRECT_URI: 'http://localhost:4000/api/auth/outlook/callback',
      }),
    ).not.toThrow();
  });

  it('requires both delegated OAuth credentials when the connector is enabled', () => {
    expect(() =>
      validateOutlookConfig({ ...validOutlookConfig, OUTLOOK_CLIENT_ID: undefined }),
    ).toThrow(/OUTLOOK_ENABLED=true/);
    expect(() =>
      validateOutlookConfig({ ...validOutlookConfig, OUTLOOK_CLIENT_SECRET: undefined }),
    ).toThrow(/OUTLOOK_ENABLED=true/);
  });

  it('rejects client secret values pasted into OUTLOOK_CLIENT_ID', () => {
    expect(() =>
      validateOutlookConfig({
        ...validOutlookConfig,
        OUTLOOK_CLIENT_ID: 'Q6c8Q~2upJx5Li6LvgwFj1Eb2G~8A.NhMGRxsdxw',
      }),
    ).toThrow(/Application \(client\) ID/);
  });

  it('requires an HTTPS Outlook callback in production', () => {
    expect(() => validateOutlookConfig({ ...validOutlookConfig, NODE_ENV: 'production' })).toThrow(
      /OUTLOOK_REDIRECT_URI must be https/,
    );
  });
});
