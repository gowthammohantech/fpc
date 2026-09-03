import { describe, expect, it, vi } from 'vitest';
import { ApiClient, type TokenStore } from './client.js';

const noTokens: TokenStore = {
  getAccessToken: () => null,
  getRefreshToken: () => null,
  setTokens: () => {},
};

/** Captures the URL fetch was called with and returns an empty 200. */
function stubFetch(): { calls: string[] } {
  const calls: string[] = [];
  vi.stubGlobal('fetch', (url: string) => {
    calls.push(url);
    return Promise.resolve(new Response('{}', { status: 200 }));
  });
  return { calls };
}

describe('ApiClient request URLs', () => {
  it('accepts the relative base the web app proxies through', async () => {
    const { calls } = stubFetch();
    const client = new ApiClient({ baseUrl: '/api', tokens: noTokens });

    await client.get('/invoices');

    expect(calls).toEqual(['/api/invoices']);
  });

  it('accepts the absolute base the mobile app uses', async () => {
    const { calls } = stubFetch();
    const client = new ApiClient({ baseUrl: 'http://localhost:4000/api', tokens: noTokens });

    await client.get('/invoices');

    expect(calls).toEqual(['http://localhost:4000/api/invoices']);
  });

  it('appends query parameters, repeating a key for array values', async () => {
    const { calls } = stubFetch();
    const client = new ApiClient({ baseUrl: '/api', tokens: noTokens });

    await client.get('/invoices', {
      page: 2,
      status: ['DRAFT', 'APPROVED'],
      vendor: undefined,
      search: '',
    });

    expect(calls).toEqual(['/api/invoices?page=2&status=DRAFT&status=APPROVED']);
  });

  it('leaves the path untouched when no query survives filtering', async () => {
    const { calls } = stubFetch();
    const client = new ApiClient({ baseUrl: '/api', tokens: noTokens });

    await client.get('/invoices', { vendor: null, search: '' });

    expect(calls).toEqual(['/api/invoices']);
  });
});
