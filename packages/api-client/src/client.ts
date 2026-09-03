import type { ApiErrorBody, AuthTokens, LoginResponse } from '@fpc/shared';

/**
 * Typed API client shared by the web and mobile apps.
 *
 * Handles the two things every caller would otherwise repeat: attaching the
 * access token, and transparently refreshing it once when the server says it
 * has expired. Token storage is injected, because the web app uses
 * localStorage and the mobile app uses secure storage.
 */

export interface TokenStore {
  getAccessToken(): string | null | Promise<string | null>;
  getRefreshToken(): string | null | Promise<string | null>;
  setTokens(tokens: AuthTokens | null): void | Promise<void>;
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = 'ApiError';
  }

  /** True when the caller is authenticated but lacks the permission. */
  get isForbidden(): boolean {
    return this.status === 403;
  }

  /** Field-level messages from a validation failure, ready to show on a form. */
  get fieldErrors(): Record<string, string> {
    if (!Array.isArray(this.details)) return {};
    return Object.fromEntries(
      (this.details as Array<{ path?: string; message?: string }>)
        .filter((entry) => entry.path && entry.message)
        .map((entry) => [entry.path!, entry.message!]),
    );
  }
}

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
  body?: unknown;
  query?: Record<string, unknown>;
  /** Multipart upload; `body` is ignored when set. */
  formData?: FormData;
  signal?: AbortSignal;
  /** Skips the auth header, for login and refresh. */
  anonymous?: boolean;
}

export interface ApiClientOptions {
  baseUrl: string;
  tokens: TokenStore;
  /** Called when refresh fails, so the app can send the user to login. */
  onUnauthenticated?: () => void;
}

export class ApiClient {
  private refreshing: Promise<boolean> | null = null;

  constructor(private readonly options: ApiClientOptions) {}

  get baseUrl(): string {
    return this.options.baseUrl;
  }

  async request<T>(path: string, options: RequestOptions = {}): Promise<T> {
    const response = await this.send(path, options);

    // One refresh attempt, then give up — a loop here would hammer the API
    // with an expired session.
    if (response.status === 401 && !options.anonymous) {
      const refreshed = await this.refreshOnce();
      if (refreshed) return this.parse<T>(await this.send(path, options));
      this.options.onUnauthenticated?.();
    }

    return this.parse<T>(response);
  }

  get<T>(path: string, query?: Record<string, unknown>, signal?: AbortSignal): Promise<T> {
    return this.request<T>(path, { method: 'GET', query, signal });
  }

  post<T>(path: string, body?: unknown, query?: Record<string, unknown>): Promise<T> {
    return this.request<T>(path, { method: 'POST', body, query });
  }

  patch<T>(path: string, body?: unknown): Promise<T> {
    return this.request<T>(path, { method: 'PATCH', body });
  }

  delete<T>(path: string): Promise<T> {
    return this.request<T>(path, { method: 'DELETE' });
  }

  upload<T>(path: string, formData: FormData): Promise<T> {
    return this.request<T>(path, { method: 'POST', formData });
  }

  /** Fetches a binary response (a bank file, an Excel export). */
  async download(path: string, query?: Record<string, unknown>): Promise<Blob> {
    const response = await this.send(path, { method: 'GET', query });
    if (response.status === 401) {
      if (await this.refreshOnce()) return this.download(path, query);
      this.options.onUnauthenticated?.();
    }
    if (!response.ok) await this.parse(response);
    return response.blob();
  }

  async login(email: string, password: string): Promise<LoginResponse> {
    const result = await this.request<LoginResponse>('/auth/login', {
      method: 'POST',
      body: { email, password },
      anonymous: true,
    });
    await this.options.tokens.setTokens(result);
    return result;
  }

  /**
   * Stores tokens obtained from an endpoint other than login — currently
   * invitation acceptance, which returns a full session.
   */
  async adoptSession(tokens: AuthTokens): Promise<void> {
    await this.options.tokens.setTokens(tokens);
  }

  async logout(): Promise<void> {
    const refreshToken = await this.options.tokens.getRefreshToken();
    try {
      await this.request('/auth/logout', { method: 'POST', body: { refreshToken } });
    } finally {
      await this.options.tokens.setTokens(null);
    }
  }

  private async send(path: string, options: RequestOptions): Promise<Response> {
    const url = new URL(`${this.options.baseUrl}${path}`);
    for (const [key, value] of Object.entries(options.query ?? {})) {
      if (value === undefined || value === null || value === '') continue;
      if (Array.isArray(value)) {
        for (const entry of value) url.searchParams.append(key, String(entry));
      } else {
        url.searchParams.set(key, String(value));
      }
    }

    const headers: Record<string, string> = {};
    if (!options.anonymous) {
      const token = await this.options.tokens.getAccessToken();
      if (token) headers.authorization = `Bearer ${token}`;
    }
    // Never set Content-Type for FormData — the browser must add the boundary.
    if (options.body !== undefined && !options.formData)
      headers['content-type'] = 'application/json';

    return fetch(url.toString(), {
      method: options.method ?? 'GET',
      headers,
      body:
        options.formData ?? (options.body !== undefined ? JSON.stringify(options.body) : undefined),
      signal: options.signal,
    });
  }

  /** Deduplicates concurrent refreshes so a burst of 401s makes one call. */
  private refreshOnce(): Promise<boolean> {
    this.refreshing ??= this.doRefresh().finally(() => {
      this.refreshing = null;
    });
    return this.refreshing;
  }

  private async doRefresh(): Promise<boolean> {
    const refreshToken = await this.options.tokens.getRefreshToken();
    if (!refreshToken) return false;

    try {
      const response = await this.send('/auth/refresh', {
        method: 'POST',
        body: { refreshToken },
        anonymous: true,
      });
      if (!response.ok) {
        await this.options.tokens.setTokens(null);
        return false;
      }
      await this.options.tokens.setTokens((await response.json()) as LoginResponse);
      return true;
    } catch {
      return false;
    }
  }

  private async parse<T>(response: Response): Promise<T> {
    if (response.status === 204) return undefined as T;

    const text = await response.text();
    const payload = text ? safeJson(text) : null;

    if (!response.ok) {
      const error = (payload as ApiErrorBody | null)?.error;
      throw new ApiError(
        response.status,
        error?.code ?? 'UNKNOWN',
        error?.message ?? `Request failed with ${response.status}`,
        error?.details,
      );
    }
    return payload as T;
  }
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return { raw: text };
  }
}
