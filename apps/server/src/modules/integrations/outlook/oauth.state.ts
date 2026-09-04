import { randomBytes } from 'node:crypto';
import jwt from 'jsonwebtoken';
import { env } from '../../../config/env.js';

/**
 * The OAuth `state` parameter, as a signed token.
 *
 * The callback arrives from Microsoft as a plain browser redirect with no
 * Authorization header, so there is nothing to identify the user by. Rather
 * than adding a server-side session store, the state carries the attribution
 * itself: it is unforgeable, short-lived, and therefore simultaneously the CSRF
 * defence and the answer to "whose mailbox is this?".
 *
 * The audience is deliberately different from the API's. A state token can
 * never be replayed as an access token, and an access token can never be passed
 * off as state, because `verifyAccessToken` pins `fpc-api` and this pins
 * `fpc-oauth-state`.
 */

const AUDIENCE = 'fpc-oauth-state';

/** Long enough to read a consent screen, short enough to be worth little. */
const TTL = '10m';

export interface OAuthStateClaims {
  /** The connecting user — this is the attribution. */
  sub: string;
  tenantId: string;
  /** Where invoices from this mailbox land when no routing rule matches. */
  companyId: string;
  nonce: string;
}

export function signStateToken(claims: Omit<OAuthStateClaims, 'nonce'>): string {
  return jwt.sign({ ...claims, nonce: randomBytes(16).toString('hex') }, env.JWT_ACCESS_SECRET, {
    expiresIn: TTL,
    issuer: 'fpc',
    audience: AUDIENCE,
  } as jwt.SignOptions);
}

/** Throws when the state is forged, expired, or an access token in disguise. */
export function verifyStateToken(token: string): OAuthStateClaims {
  return jwt.verify(token, env.JWT_ACCESS_SECRET, {
    issuer: 'fpc',
    audience: AUDIENCE,
  }) as OAuthStateClaims;
}
