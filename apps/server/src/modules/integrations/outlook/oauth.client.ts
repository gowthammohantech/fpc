import { env } from '../../../config/env.js';
import { logger } from '../../../config/logger.js';

/**
 * The Microsoft identity platform, behind a seam.
 *
 * Built on Node's global `fetch` rather than a new dependency: the flow is two
 * form posts and one GET. The seam exists so tests never have to monkey-patch
 * global fetch, matching how storage, extraction and mail drivers are swapped.
 */

/** Delegated scopes. `offline_access` is the only one that yields a refresh
 *  token; `Mail.ReadBasic` would be cheaper but excludes attachment content,
 *  which is the entire point. `Mail.Read` is read-only, which is what lets the
 *  consent screen honestly say nothing in the mailbox will change. */
export const OUTLOOK_SCOPES = ['offline_access', 'Mail.Read', 'User.Read'];

export interface OutlookTokenResponse {
  accessToken: string;
  refreshToken?: string;
  expiresInSeconds: number;
  scopes: string[];
}

export interface OutlookAccount {
  id: string;
  displayName?: string;
  mail?: string;
  userPrincipalName: string;
}

export interface OutlookOAuthClient {
  readonly name: string;
  authorizeUrl(state: string): string;
  exchangeCode(code: string): Promise<OutlookTokenResponse>;
  refresh(refreshToken: string): Promise<OutlookTokenResponse>;
  me(accessToken: string): Promise<OutlookAccount>;
}

/**
 * Raised when Microsoft says the grant is gone for good — consent withdrawn,
 * password changed, the app removed. Distinct from a transient failure because
 * the only cure is for the user to reconnect.
 */
export class OutlookGrantRevokedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'OutlookGrantRevokedError';
  }
}

class MicrosoftOAuthClient implements OutlookOAuthClient {
  readonly name = 'microsoft';

  private base(): string {
    return `https://login.microsoftonline.com/${env.OUTLOOK_OAUTH_TENANT}/oauth2/v2.0`;
  }

  authorizeUrl(state: string): string {
    const params = new URLSearchParams({
      client_id: requireClientId(),
      response_type: 'code',
      redirect_uri: env.OUTLOOK_REDIRECT_URI,
      response_mode: 'query',
      scope: OUTLOOK_SCOPES.join(' '),
      state,
      // Let the user pick which mailbox to connect; the account they are signed
      // into the browser with is often not the one holding vendor invoices.
      prompt: 'select_account',
    });
    return `${this.base()}/authorize?${params.toString()}`;
  }

  exchangeCode(code: string): Promise<OutlookTokenResponse> {
    return this.token({
      grant_type: 'authorization_code',
      code,
      redirect_uri: env.OUTLOOK_REDIRECT_URI,
    });
  }

  refresh(refreshToken: string): Promise<OutlookTokenResponse> {
    return this.token({ grant_type: 'refresh_token', refresh_token: refreshToken });
  }

  private async token(fields: Record<string, string>): Promise<OutlookTokenResponse> {
    const body = new URLSearchParams({
      client_id: requireClientId(),
      client_secret: requireClientSecret(),
      scope: OUTLOOK_SCOPES.join(' '),
      ...fields,
    });

    const response = await fetch(`${this.base()}/token`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body,
    });

    const payload = (await response.json().catch(() => ({}))) as TokenPayload;
    if (!response.ok || !payload.access_token) {
      const code = payload.error ?? String(response.status);
      // Never log the response body: a successful refresh carries tokens.
      logger.warn({ code }, 'outlook token request failed');
      const message = payload.error_description ?? `Microsoft rejected the request (${code})`;
      if (code === 'invalid_grant') throw new OutlookGrantRevokedError(message);
      throw new Error(message);
    }

    return {
      accessToken: payload.access_token,
      refreshToken: payload.refresh_token,
      expiresInSeconds: payload.expires_in ?? 3600,
      scopes: (payload.scope ?? '').split(' ').filter(Boolean),
    };
  }

  async me(accessToken: string): Promise<OutlookAccount> {
    const response = await fetch('https://graph.microsoft.com/v1.0/me', {
      headers: { authorization: `Bearer ${accessToken}` },
    });
    if (!response.ok) throw new Error(`Could not read the Microsoft account (${response.status})`);
    return (await response.json()) as OutlookAccount;
  }
}

function requireClientId(): string {
  if (!env.OUTLOOK_CLIENT_ID) throw new Error('OUTLOOK_CLIENT_ID is not configured');
  return env.OUTLOOK_CLIENT_ID;
}

function requireClientSecret(): string {
  if (!env.OUTLOOK_CLIENT_SECRET) throw new Error('OUTLOOK_CLIENT_SECRET is not configured');
  return env.OUTLOOK_CLIENT_SECRET;
}

interface TokenPayload {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  scope?: string;
  error?: string;
  error_description?: string;
}

let instance: OutlookOAuthClient | null = null;

export function outlookOAuth(): OutlookOAuthClient {
  if (!instance) instance = new MicrosoftOAuthClient();
  return instance;
}

/** Test seam. */
export function setOutlookOAuth(client: OutlookOAuthClient | null): void {
  instance = client;
}
