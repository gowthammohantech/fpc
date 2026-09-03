import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createApp } from './app.js';

/**
 * HTTP-layer wiring: these exercise the middleware chain and need no database,
 * because every one of them is rejected before a service is reached.
 */
describe('app wiring', () => {
  const app = createApp();

  it('serves health without authentication', async () => {
    const response = await request(app).get('/health');
    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ status: 'ok', service: 'fpc-api' });
  });

  it('rejects an unauthenticated API call', async () => {
    const response = await request(app).get('/api/settings/companies');
    expect(response.status).toBe(401);
    expect(response.body.error.code).toBe('UNAUTHORIZED');
  });

  it('rejects a malformed bearer token', async () => {
    const response = await request(app)
      .get('/api/settings/companies')
      .set('authorization', 'Bearer not-a-real-token');
    expect(response.status).toBe(401);
  });

  it('does not let an unauthenticated caller enumerate API routes', async () => {
    // The auth gate sits above the 404 handler for /api, so an unknown path
    // and a real one are indistinguishable without credentials.
    const unknown = await request(app).get('/api/does-not-exist');
    const known = await request(app).get('/api/settings/companies');
    expect(unknown.status).toBe(401);
    expect(unknown.status).toBe(known.status);
  });

  it('returns a structured 404 outside the API surface', async () => {
    const response = await request(app).get('/does-not-exist');
    expect(response.status).toBe(404);
    expect(response.body.error.code).toBe('NOT_FOUND');
  });

  it('validates the login payload before touching the database', async () => {
    const response = await request(app)
      .post('/api/auth/login')
      .send({ email: 'nope', password: '1' });
    expect(response.status).toBe(422);
    expect(response.body.error.details).toEqual(
      expect.arrayContaining([expect.objectContaining({ path: 'email' })]),
    );
  });

  it('echoes a request id on every response', async () => {
    const response = await request(app).get('/health').set('x-request-id', 'abc-123');
    expect(response.headers['x-request-id']).toBe('abc-123');
  });
});
