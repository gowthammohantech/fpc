import { Types, type HydratedDocument } from 'mongoose';
import {
  MailConnectionStatus,
  MailProvider,
  SUPPORTED_INVOICE_CONTENT_TYPES,
  type schemas,
} from '@fpc/shared';
import { env } from '../../../config/env.js';
import { ApiError } from '../../../core/errors.js';
import { Company } from '../../../models/company.model.js';
import { MailConnection, type MailConnectionDoc } from '../../../models/mailConnection.model.js';
import { User } from '../../../models/user.model.js';
import { audit, type AuditContext } from '../../audit/audit.service.js';
import { outlookOAuth, type OutlookTokenResponse } from './oauth.client.js';
import { signStateToken, verifyStateToken } from './oauth.state.js';
import { encryptAccessToken, encryptRefreshToken } from './outlook.tokens.js';

/**
 * Connecting, reconfiguring and disconnecting a user's own Outlook.
 *
 * The sync itself lives in `outlook.sync.ts`; this file owns the connection
 * record and nothing that talks to a mailbox.
 */

export type MailConnectionWithId = HydratedDocument<MailConnectionDoc>;

/** Where the browser lands after the OAuth round trip, with an outcome flag. */
function returnUrl(outcome: 'success' | 'error' | 'conflict', reason?: string): string {
  const url = new URL('/integrations/outlook', env.WEB_APP_URL);
  url.searchParams.set('connect', outcome);
  if (reason) url.searchParams.set('reason', reason);
  return url.toString();
}

export const outlookReturnUrl = returnUrl;

/**
 * Builds the Microsoft consent URL for a user.
 *
 * Returned as JSON for the browser to navigate to, rather than a redirect: the
 * caller is a bearer-token fetch client, which cannot follow a redirect that
 * needed its Authorization header.
 */
export async function buildAuthorizeUrl(input: {
  userId: Types.ObjectId;
  tenantId: Types.ObjectId;
  defaultCompanyId: Types.ObjectId;
}): Promise<{ authorizeUrl: string }> {
  if (!env.OUTLOOK_ENABLED) {
    throw ApiError.unprocessable(
      'The Outlook connector is not enabled on this deployment. Ask an administrator to configure it.',
    );
  }

  const company = await Company.findOne({
    _id: input.defaultCompanyId,
    tenantId: input.tenantId,
    active: true,
  }).lean();
  if (!company) throw ApiError.notFound('Company not found');

  const state = signStateToken({
    sub: String(input.userId),
    tenantId: String(input.tenantId),
    companyId: String(input.defaultCompanyId),
  });

  return { authorizeUrl: outlookOAuth().authorizeUrl(state) };
}

export interface CallbackResult {
  redirectTo: string;
}

/**
 * Completes the OAuth round trip.
 *
 * Always resolves to a redirect rather than throwing on a business failure: the
 * caller is a browser mid-navigation, and an error page from the API would
 * strand the user outside the application.
 */
export async function completeConnect(
  input: { code?: string; state?: string; error?: string; errorDescription?: string },
  context: AuditContext,
): Promise<CallbackResult> {
  if (input.error) {
    return { redirectTo: returnUrl('error', input.error) };
  }
  if (!input.code || !input.state) {
    return { redirectTo: returnUrl('error', 'missing_code') };
  }

  let claims;
  try {
    claims = verifyStateToken(input.state);
  } catch {
    // Never echo the state back — it is a signed token, and a bad one is more
    // likely an expired tab than an attack.
    throw ApiError.badRequest(
      'This connection link has expired. Start again from the Invoice Mailbox screen.',
    );
  }

  const issued = await outlookOAuth().exchangeCode(input.code);
  const account = await outlookOAuth().me(issued.accessToken);
  const accountEmail = (account.mail ?? account.userPrincipalName ?? '').toLowerCase();

  const tenantId = new Types.ObjectId(claims.tenantId);
  const userId = new Types.ObjectId(claims.sub);
  const defaultCompanyId = new Types.ObjectId(claims.companyId);

  const existing = await MailConnection.findOne({
    tenantId,
    userId,
    provider: MailProvider.OUTLOOK,
  });

  try {
    const connection = existing ?? newConnection({ tenantId, userId, defaultCompanyId });
    applyAccountIdentity(connection, {
      providerAccountId: account.id,
      accountEmail,
      accountName: account.displayName,
      defaultCompanyId,
      issued,
    });
    await connection.save();

    await audit.record(
      {
        event: 'outlook.connected',
        entityType: 'MAIL_CONNECTION',
        entityId: connection._id,
        entityLabel: accountEmail,
        tenantId,
        companyId: defaultCompanyId,
        metadata: { reconnect: Boolean(existing), scopes: issued.scopes },
      },
      context,
    );

    return { redirectTo: returnUrl('success') };
  } catch (error) {
    // The unique index on providerAccountId: someone else in the tenant has
    // already connected this mailbox, and two sync locks over one inbox would
    // each ingest the other's mail.
    if ((error as { code?: number }).code === 11000) {
      return { redirectTo: returnUrl('conflict') };
    }
    throw error;
  }
}

function newConnection(input: {
  tenantId: Types.ObjectId;
  userId: Types.ObjectId;
  defaultCompanyId: Types.ObjectId;
}) {
  // `new` rather than `create`, because the token ciphers are bound to the
  // row's own _id and Mongoose assigns that client-side.
  return new MailConnection({
    tenantId: input.tenantId,
    userId: input.userId,
    provider: MailProvider.OUTLOOK,
    defaultCompanyId: input.defaultCompanyId,
    rules: {
      folder: 'inbox',
      senderAllowlist: [],
      subjectKeywords: [],
      allowedContentTypes: [...SUPPORTED_INVOICE_CONTENT_TYPES],
      maxMessagesPerSync: 25,
      lookbackDays: 30,
      companyRoutes: [],
    },
    connectedAt: new Date(),
  }) as MailConnectionWithId;
}

/**
 * Writes the account identity and freshly issued tokens onto a connection.
 *
 * A reconnect keeps the rules and the watermark: the user is repairing access,
 * not starting over, and resetting the watermark would re-ingest a month of
 * mail.
 */
function applyAccountIdentity(
  connection: MailConnectionWithId,
  input: {
    providerAccountId: string;
    accountEmail: string;
    accountName?: string;
    defaultCompanyId: Types.ObjectId;
    issued: OutlookTokenResponse;
  },
): void {
  connection.providerAccountId = input.providerAccountId;
  connection.accountEmail = input.accountEmail;
  if (input.accountName) connection.accountName = input.accountName;
  connection.defaultCompanyId = input.defaultCompanyId;
  connection.status = MailConnectionStatus.CONNECTED;
  connection.statusMessage = undefined;
  connection.scopes = input.issued.scopes;
  connection.connectedAt = connection.connectedAt ?? new Date();
  connection.disconnectedAt = undefined;
  connection.syncState = 'IDLE';

  connection.accessTokenCipher = encryptAccessToken(connection._id, input.issued.accessToken);
  connection.accessTokenExpiresAt = new Date(Date.now() + input.issued.expiresInSeconds * 1000);
  if (input.issued.refreshToken) {
    connection.refreshTokenCipher = encryptRefreshToken(connection._id, input.issued.refreshToken);
    connection.refreshTokenIssuedAt = new Date();
  }

  // Only seed the watermark on a first connect, so a reconnect resumes rather
  // than replaying the lookback window.
  if (!connection.watermarkAt) {
    const since = new Date();
    since.setDate(since.getDate() - (connection.rules?.lookbackDays ?? 30));
    connection.watermarkAt = since;
  }
}

export async function findConnection(
  tenantId: Types.ObjectId,
  userId: Types.ObjectId,
): Promise<MailConnectionWithId | null> {
  return MailConnection.findOne({ tenantId, userId, provider: MailProvider.OUTLOOK });
}

export async function updateConnection(
  connection: MailConnectionWithId,
  body: schemas.UpdateMailConnectionRequest,
  context: AuditContext,
): Promise<MailConnectionWithId> {
  const before = { defaultCompanyId: String(connection.defaultCompanyId), rules: connection.rules };

  if (body.defaultCompanyId) {
    const company = await Company.findOne({
      _id: body.defaultCompanyId,
      tenantId: connection.tenantId,
      active: true,
    }).lean();
    if (!company) throw ApiError.notFound('Company not found');
    connection.defaultCompanyId = company._id;
  }

  if (body.rules) {
    // Merged, not replaced: the editor may send only the section it changed.
    connection.rules = { ...connection.rules, ...body.rules } as typeof connection.rules;
    if (body.rules.companyRoutes) {
      await assertRoutedCompaniesExist(connection);
    }
  }

  await connection.save();

  await audit.record(
    {
      event: 'outlook.rules_updated',
      entityType: 'MAIL_CONNECTION',
      entityId: connection._id,
      entityLabel: connection.accountEmail,
      tenantId: connection.tenantId,
      companyId: connection.defaultCompanyId,
      oldValue: before,
      newValue: { defaultCompanyId: String(connection.defaultCompanyId), rules: connection.rules },
    },
    context,
  );

  return connection;
}

async function assertRoutedCompaniesExist(connection: MailConnectionWithId): Promise<void> {
  const ids = (connection.rules.companyRoutes ?? []).map((route) => route.companyId);
  if (!ids.length) return;
  const found = await Company.countDocuments({
    _id: { $in: ids },
    tenantId: connection.tenantId,
    active: true,
  });
  if (found !== new Set(ids.map(String)).size) {
    throw ApiError.unprocessable('A routing rule points at a company that does not exist');
  }
}

/**
 * Disconnects a mailbox.
 *
 * The row is kept rather than deleted: the ingestion log references it, and the
 * history of what was pulled must stay readable after a disconnect. Microsoft
 * exposes no per-application revocation API for delegated grants, so this stops
 * us using the access rather than withdrawing the consent — which is why the
 * confirmation copy points the user at their Microsoft account.
 */
export async function disconnect(
  connection: MailConnectionWithId,
  context: AuditContext,
): Promise<void> {
  await MailConnection.updateOne(
    { _id: connection._id },
    {
      $set: {
        status: MailConnectionStatus.REVOKED,
        statusMessage: 'Disconnected. Reconnect Outlook to resume pulling invoices.',
        disconnectedAt: new Date(),
        syncState: 'IDLE',
      },
      $unset: { accessTokenCipher: '', refreshTokenCipher: '', syncRunId: '' },
    },
  );

  await audit.record(
    {
      event: 'outlook.disconnected',
      entityType: 'MAIL_CONNECTION',
      entityId: connection._id,
      entityLabel: connection.accountEmail,
      tenantId: connection.tenantId,
      companyId: connection.defaultCompanyId,
    },
    context,
  );
}

/**
 * The API shape of a connection.
 *
 * Hand-written rather than `toApi`, so the token fields cannot be emitted even
 * if someone later loads them with `.select('+...')`.
 */
export async function toConnectionApi(
  connection: MailConnectionWithId,
): Promise<Record<string, unknown>> {
  const [owner, company] = await Promise.all([
    User.findById(connection.userId).select('name email').lean(),
    Company.findById(connection.defaultCompanyId).select('name').lean(),
  ]);

  return {
    id: String(connection._id),
    tenantId: String(connection.tenantId),
    userId: String(connection.userId),
    ownerName: owner?.name ?? owner?.email ?? 'Unknown user',
    provider: connection.provider,
    accountEmail: connection.accountEmail,
    accountName: connection.accountName,
    status: connection.status,
    statusMessage: connection.statusMessage,
    scopes: connection.scopes,
    defaultCompanyId: String(connection.defaultCompanyId),
    defaultCompanyName: company?.name ?? 'Unknown company',
    rules: {
      folder: connection.rules.folder,
      senderAllowlist: connection.rules.senderAllowlist,
      subjectKeywords: connection.rules.subjectKeywords,
      allowedContentTypes: connection.rules.allowedContentTypes,
      maxMessagesPerSync: connection.rules.maxMessagesPerSync,
      lookbackDays: connection.rules.lookbackDays,
      companyRoutes: (connection.rules.companyRoutes ?? []).map((route) => ({
        match: route.match,
        value: route.value,
        companyId: String(route.companyId),
      })),
    },
    autoSyncEnabled: connection.autoSyncEnabled,
    watermarkAt: connection.watermarkAt?.toISOString(),
    lastSyncAt: connection.lastSyncAt?.toISOString(),
    lastSyncStatus: connection.lastSyncStatus,
    lastSyncError: connection.lastSyncError,
    syncState: connection.syncState,
    syncStartedAt: connection.syncStartedAt?.toISOString(),
    syncRunId: connection.syncRunId,
    connectedAt: connection.connectedAt?.toISOString(),
    disconnectedAt: connection.disconnectedAt?.toISOString(),
    totalMessagesSeen: connection.totalMessagesSeen,
    totalInvoicesCreated: connection.totalInvoicesCreated,
  };
}
