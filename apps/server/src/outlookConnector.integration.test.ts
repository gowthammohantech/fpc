import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import request from 'supertest';
import type { Express } from 'express';
import { Types } from 'mongoose';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { InvoiceStatus, MailIngestionStatus, MailSkipReason } from '@fpc/shared';
import { createApp } from './app.js';
import { setDelegatedMailFetcher } from './integrations/email/index.js';
import { setExtractor } from './integrations/ocr/index.js';
import type { DocumentExtractor } from './integrations/ocr/types.js';
import { Invoice } from './models/invoice.model.js';
import { MailConnection } from './models/mailConnection.model.js';
import { MailIngestion } from './models/mailIngestion.model.js';
import { decryptSecret } from './core/crypto.js';
import { setOutlookOAuth } from './modules/integrations/outlook/oauth.client.js';
import { runSync } from './modules/integrations/outlook/outlook.sync.js';
import { DEMO_PASSWORD } from './seed/data.js';
import { seed } from './seed/seed.js';
import {
  FAKE_REFRESH_TOKEN,
  FakeDelegatedMailFetcher,
  FakeOutlookOAuth,
  fakeAttachment,
  fakeMessage,
} from './test/fakes/outlook.js';
import { startTestDatabase, stopTestDatabase } from './test/db.js';

/**
 * The Outlook connector, end to end: consent, sync, and the log the Invoice
 * Mailbox screen reads.
 *
 * Microsoft is replaced through the driver seams, so what is under test is our
 * own filtering, idempotency and isolation rather than Graph's behaviour.
 */
let app: Express;
let directory: string;
let companyId: string;

// Connected at module scope, not in `beforeAll`: vitest collects the suites —
// and so evaluates `RUN()` — before any hook runs.
const available = (await startTestDatabase('outlook')) !== null;

const oauth = new FakeOutlookOAuth({
  id: 'graph-account-1',
  displayName: 'Ravi Kumar',
  mail: 'ravi@nova.example.com',
  userPrincipalName: 'ravi@nova.example.com',
});
const fetcher = new FakeDelegatedMailFetcher();

/** Deterministic extraction: the connector's job is routing, not reading. */
const extractor: DocumentExtractor = {
  name: 'test',
  async extract(input) {
    if (input.fileName.includes('boom')) throw new Error('Simulated extraction failure');
    return {
      provider: 'test',
      model: 'test',
      overallConfidence: 0.95,
      fields: {
        invoiceNumber: { value: 'INV-7001', confidence: 0.99 },
        vendorName: { value: 'TechZone Systems', confidence: 0.97 },
        invoiceDate: { value: '2026-09-01', confidence: 0.98 },
        totalAmount: { value: '11800.00', confidence: 0.96 },
      },
      lineItems: [],
    };
  },
};

beforeAll(async () => {
  if (!available) return;
  directory = await mkdtemp(join(tmpdir(), 'fpc-outlook-'));
  // OUTLOOK_ENABLED is set in vitest.config.ts: env is parsed at import time.
  setOutlookOAuth(oauth);
  setDelegatedMailFetcher(fetcher);
  setExtractor(extractor);

  app = createApp();
  const result = await seed({ reset: true });
  companyId = String(result.companyIds.engineering);
}, 180_000);

afterAll(async () => {
  if (!available) return;
  setOutlookOAuth(null);
  setDelegatedMailFetcher(null);
  setExtractor(null);
  await rm(directory, { recursive: true, force: true });
  await stopTestDatabase();
});

async function token(email: string): Promise<string> {
  const response = await request(app)
    .post('/api/auth/login')
    .send({ email, password: DEMO_PASSWORD });
  expect(response.status, JSON.stringify(response.body)).toBe(200);
  return response.body.accessToken as string;
}

/**
 * Drives the real consent round trip, including the public callback, and
 * returns the resulting connection id.
 */
async function connect(accessToken: string): Promise<string> {
  const authorize = await request(app)
    .post('/api/integrations/outlook/authorize')
    .set('authorization', `Bearer ${accessToken}`)
    .send({ defaultCompanyId: companyId });
  expect(authorize.status, JSON.stringify(authorize.body)).toBe(200);

  const state = new URL(authorize.body.authorizeUrl).searchParams.get('state');
  const callback = await request(app)
    .get('/api/auth/outlook/callback')
    .query({ code: 'fake-code', state });
  expect(callback.status).toBe(302);
  expect(callback.headers.location).toContain('connect=success');

  const connection = await MailConnection.findOne({ accountEmail: 'ravi@nova.example.com' });
  expect(connection).not.toBeNull();
  return String(connection!._id);
}

/** Runs a sync deterministically: the route fires and forgets by design. */
async function sync(connectionId: string) {
  return runSync(new Types.ObjectId(connectionId), `test-run-${Date.now()}`);
}

const RUN = () => (available ? describe : describe.skip);

RUN()('outlook connector', () => {
  let ravi: string;
  let connectionId: string;

  beforeEach(async () => {
    ravi = await token('ravi@nova.example.com');
  });

  it('connects a mailbox and stores the refresh token encrypted', async () => {
    connectionId = await connect(ravi);

    const stored = await MailConnection.findById(connectionId).select('+refreshTokenCipher');
    expect(stored!.status).toBe('CONNECTED');
    // Encrypted at rest, but recoverable — which is exactly why this cannot
    // reuse the one-way hashing our own refresh tokens get.
    expect(stored!.refreshTokenCipher).not.toContain(FAKE_REFRESH_TOKEN);
    expect(decryptSecret(stored!.refreshTokenCipher!, `${connectionId}:refresh`)).toBe(
      FAKE_REFRESH_TOKEN,
    );
  });

  it('never emits the stored tokens over the API', async () => {
    const response = await request(app)
      .get('/api/integrations/outlook/connection')
      .set('authorization', `Bearer ${ravi}`);
    expect(response.status).toBe(200);
    expect(response.body.accountEmail).toBe('ravi@nova.example.com');
    expect(JSON.stringify(response.body)).not.toContain(FAKE_REFRESH_TOKEN);
    expect(response.body.refreshTokenCipher).toBeUndefined();
    expect(response.body.accessTokenCipher).toBeUndefined();
  });

  it('rejects a callback whose state is not ours', async () => {
    const response = await request(app)
      .get('/api/auth/outlook/callback')
      .query({ code: 'x', state: 'garbage' });
    expect(response.status).toBe(400);
    expect(response.body.error.message).toContain('expired');
  });

  it('pulls invoices, and records why the others were left alone', async () => {
    await request(app)
      .patch('/api/integrations/outlook/connection')
      .set('authorization', `Bearer ${ravi}`)
      .send({ rules: { senderAllowlist: ['ap@vendor.com'], subjectKeywords: ['invoice'] } })
      .expect(200);

    fetcher.messages = [
      fakeMessage(),
      fakeMessage({
        messageId: 'AAM=fake-2',
        internetMessageId: '<fake-2@spam.com>',
        from: 'newsletter@spam.com',
        subject: 'Invoice tips for you',
      }),
      fakeMessage({
        messageId: 'AAM=fake-3',
        internetMessageId: '<fake-3@vendor.com>',
        subject: 'Invoice terms',
        attachments: [
          fakeAttachment({ filename: 'terms.docx', contentType: 'application/msword' }),
        ],
      }),
      fakeMessage({
        messageId: 'AAM=fake-4',
        internetMessageId: '<fake-4@vendor.com>',
        subject: 'Invoice INV-7004',
        attachments: [fakeAttachment({ filename: 'boom.pdf' })],
      }),
    ];

    const summary = await sync(connectionId);

    expect(summary.messagesSeen).toBe(4);
    expect(summary.invoicesCreated).toBe(1);

    const rows = await MailIngestion.find({ connectionId }).sort({ providerMessageId: 1 }).lean();
    expect(rows).toHaveLength(4);

    const [first, spam, docx, boom] = rows;

    expect(first!.status).toBe(MailIngestionStatus.COMPLETED);
    expect(first!.attachments[0]!.status).toBe('READY_FOR_REVIEW');
    expect(first!.attachments[0]!.invoiceId).toBeTruthy();

    expect(spam!.status).toBe(MailIngestionStatus.SKIPPED);
    expect(spam!.skipReason).toBe(MailSkipReason.SENDER_NOT_ALLOWED);

    expect(docx!.status).toBe(MailIngestionStatus.SKIPPED);
    expect(docx!.skipReason).toBe(MailSkipReason.UNSUPPORTED_ATTACHMENTS);

    // Per-attachment isolation: this one failed and the first still succeeded.
    expect(boom!.status).toBe(MailIngestionStatus.FAILED);
  });

  it('always leaves a pulled invoice for a human to review', async () => {
    const row = await MailIngestion.findOne({ status: MailIngestionStatus.COMPLETED }).lean();
    const invoice = await Invoice.findById(row!.attachments[0]!.invoiceId).lean();
    expect(invoice!.status).toBe(InvoiceStatus.REVIEW_REQUIRED);
    expect(invoice!.source).toBe('EMAIL');
  });

  it('does not duplicate anything when the same mailbox is synced again', async () => {
    const before = {
      rows: await MailIngestion.countDocuments({ connectionId }),
      invoices: await Invoice.countDocuments({ source: 'EMAIL' }),
    };

    await sync(connectionId);

    expect(await MailIngestion.countDocuments({ connectionId })).toBe(before.rows);
    expect(await Invoice.countDocuments({ source: 'EMAIL' })).toBe(before.invoices);
  });

  it('accepts a sync request and runs it in the background', async () => {
    // Nothing to pull, so the background run settles immediately and cannot
    // race the assertions that follow.
    fetcher.messages = [];
    const response = await request(app)
      .post('/api/integrations/outlook/sync')
      .set('authorization', `Bearer ${ravi}`);
    expect(response.status).toBe(202);
    expect(response.body.syncRunId).toBeTruthy();
  });

  it('refuses a second sync while one is already running', async () => {
    // Held directly rather than by racing a real run: what is under test is the
    // conditional claim, not the timing of the background task.
    await MailConnection.updateOne(
      { _id: connectionId },
      { $set: { syncState: 'RUNNING', syncStartedAt: new Date() } },
    );

    const response = await request(app)
      .post('/api/integrations/outlook/sync')
      .set('authorization', `Bearer ${ravi}`);
    expect(response.status).toBe(409);

    await MailConnection.updateOne({ _id: connectionId }, { $set: { syncState: 'IDLE' } });
  });

  it('lets an overseer read the log but not run somebody else’s sync', async () => {
    const manager = await token('financemanager@nova.example.com');

    const list = await request(app)
      .get('/api/integrations/outlook/ingestions')
      .set('authorization', `Bearer ${manager}`)
      .query({ companyId });
    expect(list.status).toBe(200);
    expect(list.body.items.length).toBeGreaterThan(0);

    // read_all is oversight, not control: there is no connection of their own
    // to sync, and they cannot reach Ravi's.
    const attempt = await request(app)
      .post('/api/integrations/outlook/sync')
      .set('authorization', `Bearer ${manager}`);
    expect([403, 404]).toContain(attempt.status);
  });

  it('hides the screen from roles that were not granted it', async () => {
    const auditor = await token('auditor@nova.example.com');
    const response = await request(app)
      .get('/api/integrations/outlook/ingestions')
      .set('authorization', `Bearer ${auditor}`);
    expect(response.status).toBe(403);
  });

  it('joins live invoice state onto the attachment rows', async () => {
    const response = await request(app)
      .get('/api/integrations/outlook/ingestions')
      .set('authorization', `Bearer ${ravi}`)
      .query({ view: 'READY' });
    expect(response.status).toBe(200);

    const ready = response.body.items.find(
      (item: { attachments: Array<{ invoice: unknown }> }) => item.attachments[0]?.invoice,
    );
    expect(ready.attachments[0].invoice.status).toBe(InvoiceStatus.REVIEW_REQUIRED);
    expect(ready.attachments[0].invoice.invoiceNumber).toBe('INV-7001');
  });

  it('disconnects without losing the history, and refuses to sync afterwards', async () => {
    await request(app)
      .delete('/api/integrations/outlook/connection')
      .set('authorization', `Bearer ${ravi}`)
      .expect(204);

    const stored = await MailConnection.findById(connectionId).select('+refreshTokenCipher');
    expect(stored!.status).toBe('REVOKED');
    expect(stored!.refreshTokenCipher).toBeUndefined();

    // The log survives: what was pulled must stay auditable after a disconnect.
    expect(await MailIngestion.countDocuments({ connectionId })).toBeGreaterThan(0);

    const attempt = await request(app)
      .post('/api/integrations/outlook/sync')
      .set('authorization', `Bearer ${ravi}`);
    expect(attempt.status).toBe(409);
  });
});
