import Constants from 'expo-constants';
import * as SecureStore from 'expo-secure-store';
import { ApiClient, endpoints, type TokenStore } from '@fpc/api-client';
import type { AuthTokens } from '@fpc/shared';

const TOKEN_KEY = 'fpc.tokens';

/**
 * Tokens live in the device keychain rather than AsyncStorage: this app can
 * approve payments, so a session token must not sit in plain application
 * storage.
 */
let cached: AuthTokens | null = null;

const secureTokens: TokenStore = {
  getAccessToken: async () => (await read())?.accessToken ?? null,
  getRefreshToken: async () => (await read())?.refreshToken ?? null,
  setTokens: async (tokens) => {
    cached = tokens;
    if (tokens) await SecureStore.setItemAsync(TOKEN_KEY, JSON.stringify(tokens));
    else await SecureStore.deleteItemAsync(TOKEN_KEY);
  },
};

async function read(): Promise<AuthTokens | null> {
  if (cached) return cached;
  try {
    const raw = await SecureStore.getItemAsync(TOKEN_KEY);
    cached = raw ? (JSON.parse(raw) as AuthTokens) : null;
    return cached;
  } catch {
    return null;
  }
}

const baseUrl =
  (Constants.expoConfig?.extra as { apiBaseUrl?: string } | undefined)?.apiBaseUrl ??
  'http://localhost:4000/api';

let onSessionLost: (() => void) | null = null;

export const apiClient = new ApiClient({
  baseUrl,
  tokens: secureTokens,
  onUnauthenticated: () => {
    cached = null;
    onSessionLost?.();
  },
});

export const api = endpoints(apiClient);

export function setSessionLostHandler(handler: (() => void) | null): void {
  onSessionLost = handler;
}

export async function hasStoredSession(): Promise<boolean> {
  return (await read()) !== null;
}
