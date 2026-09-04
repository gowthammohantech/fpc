import { describe, expect, it } from 'vitest';
import { SecretKeyMismatchError, decryptSecret, encryptSecret } from './crypto.js';

const AAD = '65b0f1a2c3d4e5f60718293a:refresh';

describe('encryptSecret / decryptSecret', () => {
  it('round trips a secret', () => {
    const secret = '0.AXoA-fake-microsoft-refresh-token';
    expect(decryptSecret(encryptSecret(secret, AAD), AAD)).toBe(secret);
  });

  it('produces a different ciphertext each time', () => {
    // A fresh IV per call, so an observer cannot tell that two rows hold the
    // same token.
    expect(encryptSecret('same', AAD)).not.toBe(encryptSecret('same', AAD));
  });

  it('writes a versioned, five-part payload', () => {
    const parts = encryptSecret('token', AAD).split(':');
    expect(parts).toHaveLength(5);
    expect(parts[0]).toBe('v1');
  });

  it('rejects a payload encrypted for a different owner', () => {
    const payload = encryptSecret('token', AAD);
    expect(() => decryptSecret(payload, 'other-connection:refresh')).toThrow();
  });

  it('rejects an access-slot payload replayed into the refresh slot', () => {
    const payload = encryptSecret('token', '65b0f1a2c3d4e5f60718293a:access');
    expect(() => decryptSecret(payload, AAD)).toThrow();
  });

  it('rejects a tampered ciphertext rather than returning garbage', () => {
    const parts = encryptSecret('token', AAD).split(':');
    const body = Buffer.from(parts[4]!, 'base64');
    body[0] ^= 0xff;
    parts[4] = body.toString('base64');
    expect(() => decryptSecret(parts.join(':'), AAD)).toThrow();
  });

  it('rejects a tampered auth tag', () => {
    const parts = encryptSecret('token', AAD).split(':');
    const tag = Buffer.from(parts[3]!, 'base64');
    tag[0] ^= 0xff;
    parts[3] = tag.toString('base64');
    expect(() => decryptSecret(parts.join(':'), AAD)).toThrow();
  });

  it('reports a rotated key distinctly, so the UI can offer Reconnect', () => {
    const parts = encryptSecret('token', AAD).split(':');
    parts[1] = 'deadbeef';
    expect(() => decryptSecret(parts.join(':'), AAD)).toThrow(SecretKeyMismatchError);
  });

  it('rejects a malformed payload', () => {
    expect(() => decryptSecret('not-encrypted', AAD)).toThrow('Malformed encrypted secret');
  });
});
