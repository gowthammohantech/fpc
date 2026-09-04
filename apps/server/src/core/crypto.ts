import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { decodeEncryptionKey, env } from '../config/env.js';

/**
 * Symmetric encryption for secrets we have to replay.
 *
 * This is deliberately separate from `hashToken()` in the auth module: that is
 * SHA-256 and one-way, which is right for our own refresh tokens because we
 * only ever need to compare them. A third-party OAuth refresh token has to be
 * sent back to the provider verbatim, so it must be recoverable — hashing it
 * would be useless and encrypting our own tokens would be weaker than hashing.
 */

const ALGORITHM = 'aes-256-gcm';
const IV_BYTES = 12;
const VERSION = 'v1';

export class SecretKeyMismatchError extends Error {
  constructor() {
    super('This value was encrypted with a different SECRET_ENCRYPTION_KEY');
    this.name = 'SecretKeyMismatchError';
  }
}

function key(): Buffer {
  const decoded = decodeEncryptionKey(env.SECRET_ENCRYPTION_KEY);
  if (decoded.length !== 32) {
    throw new Error('SECRET_ENCRYPTION_KEY must decode to exactly 32 bytes');
  }
  return decoded;
}

/**
 * A short fingerprint of the active key, stored alongside the ciphertext.
 *
 * Not a secret: it is a truncated hash used only to tell "wrong key" apart
 * from "corrupt data", so a rotated key produces a clear message and a
 * Reconnect button rather than an opaque decryption failure.
 */
function keyId(material: Buffer): string {
  return createHash('sha256').update(material).digest('hex').slice(0, 8);
}

/**
 * Encrypts a secret, binding it to its owner.
 *
 * `aad` is additional authenticated data — pass something that identifies both
 * the row and the slot, e.g. `${connectionId}:refresh`. It is not stored, and
 * decryption fails without the identical value, so a ciphertext cannot be
 * moved to another row or swapped between an access and a refresh slot.
 */
export function encryptSecret(plain: string, aad: string): string {
  const material = key();
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, material, iv);
  cipher.setAAD(Buffer.from(aad, 'utf8'));
  const ciphertext = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  return [
    VERSION,
    keyId(material),
    iv.toString('base64'),
    cipher.getAuthTag().toString('base64'),
    ciphertext.toString('base64'),
  ].join(':');
}

/**
 * Reverses {@link encryptSecret}.
 *
 * Throws `SecretKeyMismatchError` when the key has been rotated, and a plain
 * error when the payload is malformed or has been tampered with — GCM
 * authenticates, so a modified ciphertext fails loudly instead of decrypting
 * to garbage that would then be sent to the provider.
 */
export function decryptSecret(payload: string, aad: string): string {
  const parts = payload.split(':');
  if (parts.length !== 5 || parts[0] !== VERSION) {
    throw new Error('Malformed encrypted secret');
  }
  const [, storedKeyId, ivB64, tagB64, ciphertextB64] = parts as [
    string,
    string,
    string,
    string,
    string,
  ];

  const material = key();
  if (storedKeyId !== keyId(material)) throw new SecretKeyMismatchError();

  const decipher = createDecipheriv(ALGORITHM, material, Buffer.from(ivB64, 'base64'));
  decipher.setAAD(Buffer.from(aad, 'utf8'));
  decipher.setAuthTag(Buffer.from(tagB64, 'base64'));
  return Buffer.concat([
    decipher.update(Buffer.from(ciphertextB64, 'base64')),
    decipher.final(),
  ]).toString('utf8');
}
