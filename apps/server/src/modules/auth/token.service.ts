import { createHash, randomBytes } from 'node:crypto';
import jwt from 'jsonwebtoken';
import { env } from '../../config/env.js';
import { ORG_SCOPE_FIELDS, type OrgScopeField } from '../../middleware/types.js';

/** Org scope as it travels on the wire: ids as strings. */
export type ScopeClaims = Record<OrgScopeField, string[]>;

export interface AccessClaims extends ScopeClaims {
  sub: string;
  tenantId: string;
  email: string;
  name: string;
  roleKeys: string[];
}

/** Every axis unrestricted. Used by the TTL probe and by tests. */
export function emptyScopeClaims(): ScopeClaims {
  return Object.fromEntries(
    ORG_SCOPE_FIELDS.map((field) => [field, [] as string[]]),
  ) as ScopeClaims;
}

export interface RefreshClaims {
  sub: string;
  tenantId: string;
  jti: string;
}

export function signAccessToken(claims: AccessClaims): string {
  return jwt.sign(claims, env.JWT_ACCESS_SECRET, {
    expiresIn: env.JWT_ACCESS_TTL,
    issuer: 'fpc',
    audience: 'fpc-api',
  } as jwt.SignOptions);
}

export function verifyAccessToken(token: string): AccessClaims {
  return jwt.verify(token, env.JWT_ACCESS_SECRET, {
    issuer: 'fpc',
    audience: 'fpc-api',
  }) as AccessClaims;
}

export function signRefreshToken(userId: string, tenantId: string): { token: string; jti: string } {
  const jti = randomBytes(24).toString('hex');
  const token = jwt.sign({ sub: userId, tenantId, jti }, env.JWT_REFRESH_SECRET, {
    expiresIn: env.JWT_REFRESH_TTL,
    issuer: 'fpc',
    audience: 'fpc-refresh',
  } as jwt.SignOptions);
  return { token, jti };
}

export function verifyRefreshToken(token: string): RefreshClaims {
  return jwt.verify(token, env.JWT_REFRESH_SECRET, {
    issuer: 'fpc',
    audience: 'fpc-refresh',
  }) as RefreshClaims;
}

/** Refresh tokens are stored hashed, so a database leak cannot mint sessions. */
export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/** Seconds until an access token expires, for the client's refresh timer. */
export function accessTokenTtlSeconds(): number {
  const decoded = jwt.decode(
    signAccessToken({
      sub: '0'.repeat(24),
      tenantId: '0'.repeat(24),
      email: 'ttl@probe',
      name: 'ttl',
      roleKeys: [],
      ...emptyScopeClaims(),
    }),
  ) as { exp?: number; iat?: number } | null;
  return decoded?.exp && decoded.iat ? decoded.exp - decoded.iat : 900;
}
