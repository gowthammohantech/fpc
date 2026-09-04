import { describe, expect, it } from 'vitest';
import { signAccessToken, verifyAccessToken } from '../../auth/token.service.js';
import { signStateToken, verifyStateToken } from './oauth.state.js';

const CLAIMS = {
  sub: '65b0f1a2c3d4e5f60718293a',
  tenantId: '65b0f1a2c3d4e5f60718293b',
  companyId: '65b0f1a2c3d4e5f60718293c',
};

describe('oauth state token', () => {
  it('round trips the attribution claims', () => {
    const verified = verifyStateToken(signStateToken(CLAIMS));
    expect(verified.sub).toBe(CLAIMS.sub);
    expect(verified.tenantId).toBe(CLAIMS.tenantId);
    expect(verified.companyId).toBe(CLAIMS.companyId);
  });

  it('carries a nonce, so two states for the same user differ', () => {
    expect(signStateToken(CLAIMS)).not.toBe(signStateToken(CLAIMS));
  });

  it('rejects a forged token', () => {
    expect(() => verifyStateToken('not.a.token')).toThrow();
  });

  // The audience split is the whole point: neither token can stand in for the
  // other, so a leaked state cannot be used to call the API and an access token
  // cannot be used to attribute a mailbox connection.
  it('rejects a real access token presented as state', () => {
    const access = signAccessToken({
      sub: CLAIMS.sub,
      tenantId: CLAIMS.tenantId,
      email: 'ravi@nova.example.com',
      name: 'Ravi',
      roleKeys: ['FINANCE_EXECUTIVE'],
      companyIds: [],
      locationIds: [],
      departmentIds: [],
    });
    expect(() => verifyStateToken(access)).toThrow();
  });

  it('is rejected by the API access-token verifier', () => {
    expect(() => verifyAccessToken(signStateToken(CLAIMS))).toThrow();
  });
});
