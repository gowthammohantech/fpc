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

/**
 * Where the API lives.
 *
 * VITE_API_URL is baked in at build time and wins when set, which is what a
 * deploy that serves the SPA and the API from different origins needs. Without
 * it the base stays the relative '/api' that the dev server proxies and nginx
 * reverse-proxies in the container, so the browser sees a single origin and the
 * auth flow stays free of CORS and third-party cookie rules.
 */
function resolveBaseUrl(): string {
  const configured = import.meta.env.VITE_API_URL?.trim();
  if (!configured) return '/api';
  // Paths are appended verbatim, so a trailing slash would double up.
  return configured.replace(/\/+$/, '');
}

export const apiBaseUrl = resolveBaseUrl();

export const apiClient = new ApiClient({
  baseUrl: apiBaseUrl,
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
