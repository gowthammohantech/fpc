import { ApiClient, endpoints, type TokenStore } from '@fpc/api-client';
import type { AuthTokens } from '@fpc/shared';

const STORAGE_KEY = 'fpc.tokens';

/**
 * Token storage for the browser.
 *
 * localStorage is used deliberately over an in-memory store so a page reload
 * does not log the user out mid-task; the access token is short-lived and the
 * refresh token rotates on every use.
 */
const browserTokens: TokenStore = {
  getAccessToken: () => read()?.accessToken ?? null,
  getRefreshToken: () => read()?.refreshToken ?? null,
  setTokens: (tokens) => {
    if (tokens) localStorage.setItem(STORAGE_KEY, JSON.stringify(tokens));
    else localStorage.removeItem(STORAGE_KEY);
  },
};

function read(): AuthTokens | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as AuthTokens) : null;
  } catch {
    return null;
  }
}

export const apiClient = new ApiClient({
  baseUrl: '/api',
  tokens: browserTokens,
  onUnauthenticated: () => {
    localStorage.removeItem(STORAGE_KEY);
    if (!window.location.pathname.startsWith('/login')) {
      window.location.assign(`/login?next=${encodeURIComponent(window.location.pathname)}`);
    }
  },
});

export const api = endpoints(apiClient);
export const hasStoredSession = (): boolean => read() !== null;

/** Triggers a browser download from a fetched blob. */
export function downloadBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}
