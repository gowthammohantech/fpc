import type { Types } from 'mongoose';
import { MailConnectionStatus } from '@fpc/shared';
import { logger } from '../../../config/logger.js';
import { SecretKeyMismatchError, decryptSecret, encryptSecret } from '../../../core/crypto.js';
import { ApiError } from '../../../core/errors.js';
import { MailConnection, type MailConnectionDoc } from '../../../models/mailConnection.model.js';
import { audit } from '../../audit/audit.service.js';
import {
  OutlookGrantRevokedError,
  outlookOAuth,
  type OutlookTokenResponse,
} from './oauth.client.js';

/**
 * Keeps a connection's Microsoft access token usable.
 *
 * Tokens are stored encrypted and bound to their row (see `core/crypto.ts`), so
 * everything that touches them goes through here rather than reaching into the
 * model directly.
 */

/** Refresh a little early: a token that expires mid-request is a failed sync. */
const EXPIRY_MARGIN_MS = 60_000;

type ConnectionWithSecrets = MailConnectionDoc & { _id: Types.ObjectId };

/** AAD binds a ciphertext to both its row and its slot. */
function aadFor(connectionId: Types.ObjectId, purpose: 'access' | 'refresh'): string {
  return `${String(connectionId)}:${purpose}`;
}

export function encryptAccessToken(connectionId: Types.ObjectId, token: string): string {
  return encryptSecret(token, aadFor(connectionId, 'access'));
}

export function encryptRefreshToken(connectionId: Types.ObjectId, token: string): string {
  return encryptSecret(token, aadFor(connectionId, 'refresh'));
}

/**
 * In-flight refreshes, so two concurrent callers do not both spend the refresh
 * token. Microsoft rotates refresh tokens, and the loser of that race would
 * write back a token the winner has already invalidated. Same shape as the
 * API client's own `refreshOnce`.
 */
const inFlight = new Map<string, Promise<string>>();

/**
 * Returns a usable access token, refreshing it if necessary.
 *
 * Flips the connection to REVOKED or ERROR as a side effect when Microsoft
 * refuses, so the screen can explain what happened and offer Reconnect. Callers
 * should let the thrown error propagate rather than retrying.
 */
export async function accessTokenFor(connectionId: Types.ObjectId): Promise<string> {
  const key = String(connectionId);
  const existing = inFlight.get(key);
  if (existing) return existing;

  const pending = resolveToken(connectionId).finally(() => inFlight.delete(key));
  inFlight.set(key, pending);
  return pending;
}

async function resolveToken(connectionId: Types.ObjectId): Promise<string> {
  const connection = (await MailConnection.findById(connectionId).select(
    '+accessTokenCipher +refreshTokenCipher',
  )) as ConnectionWithSecrets | null;
  if (!connection) throw ApiError.notFound('Mailbox connection not found');

  if (connection.status === MailConnectionStatus.REVOKED) {
    throw ApiError.conflict('This mailbox is disconnected. Reconnect Outlook to resume.');
  }

  try {
    const cached = cachedAccessToken(connection);
    if (cached) return cached;

    if (!connection.refreshTokenCipher) {
      throw new OutlookGrantRevokedError('No stored credentials. Reconnect Outlook.');
    }
    const refreshToken = decryptSecret(
      connection.refreshTokenCipher,
      aadFor(connection._id, 'refresh'),
    );

    const issued = await outlookOAuth().refresh(refreshToken);
    await storeTokens(connection, issued);
    return issued.accessToken;
  } catch (error) {
    await recordTokenFailure(connection, error);
    throw error;
  }
}

function cachedAccessToken(connection: ConnectionWithSecrets): string | null {
  if (!connection.accessTokenCipher || !connection.accessTokenExpiresAt) return null;
  if (connection.accessTokenExpiresAt.getTime() - Date.now() <= EXPIRY_MARGIN_MS) return null;
  return decryptSecret(connection.accessTokenCipher, aadFor(connection._id, 'access'));
}

/**
 * Persists a freshly issued token pair.
 *
 * The refresh token is overwritten whenever the response carries one, because
 * Microsoft rotates them and keeping the old value would break the next
 * refresh. When it does not, the existing one remains valid.
 */
export async function storeTokens(
  connection: ConnectionWithSecrets,
  issued: OutlookTokenResponse,
): Promise<void> {
  const update: Record<string, unknown> = {
    accessTokenCipher: encryptAccessToken(connection._id, issued.accessToken),
    accessTokenExpiresAt: new Date(Date.now() + issued.expiresInSeconds * 1000),
    status: MailConnectionStatus.CONNECTED,
    statusMessage: undefined,
  };
  if (issued.refreshToken) {
    update.refreshTokenCipher = encryptRefreshToken(connection._id, issued.refreshToken);
    update.refreshTokenIssuedAt = new Date();
  }
  if (issued.scopes.length) update.scopes = issued.scopes;

  await MailConnection.updateOne({ _id: connection._id }, { $set: update });
}

/** Turns a token failure into a status the screen can act on. */
async function recordTokenFailure(
  connection: ConnectionWithSecrets,
  error: unknown,
): Promise<void> {
  if (error instanceof SecretKeyMismatchError) {
    await MailConnection.updateOne(
      { _id: connection._id },
      {
        $set: {
          status: MailConnectionStatus.ERROR,
          statusMessage: 'The server encryption key changed — reconnect Outlook to resume.',
        },
      },
    );
    return;
  }

  if (error instanceof OutlookGrantRevokedError) {
    await MailConnection.updateOne(
      { _id: connection._id },
      {
        $set: {
          status: MailConnectionStatus.REVOKED,
          statusMessage: 'Access was withdrawn in Microsoft 365. Reconnect to resume.',
        },
        // Clear what is now useless rather than leaving a dead secret at rest.
        $unset: { accessTokenCipher: '', refreshTokenCipher: '' },
      },
    );
    await audit.record({
      event: 'outlook.revoked',
      entityType: 'MAIL_CONNECTION',
      entityId: connection._id,
      entityLabel: connection.accountEmail,
      tenantId: connection.tenantId,
      companyId: connection.defaultCompanyId,
    });
    return;
  }

  logger.warn({ connectionId: String(connection._id) }, 'outlook token refresh failed');
  await MailConnection.updateOne(
    { _id: connection._id },
    {
      $set: {
        status: MailConnectionStatus.ERROR,
        statusMessage: (error as Error).message,
      },
    },
  );
}
