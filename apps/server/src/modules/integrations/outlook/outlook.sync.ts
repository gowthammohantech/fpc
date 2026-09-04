import { randomBytes } from 'node:crypto';
import { Types } from 'mongoose';
import {
  InvoiceStatus,
  MailAttachmentStatus,
  MailConnectionStatus,
  MailIngestionStatus,
  MailSkipReason,
  type MailSyncOutcome,
  type MailSyncSummary,
} from '@fpc/shared';
import { logger } from '../../../config/logger.js';
import { ApiError } from '../../../core/errors.js';
import { delegatedMailFetcher } from '../../../integrations/email/index.js';
import type { InboundAttachment, InboundMessage } from '../../../integrations/email/types.js';
import { Invoice } from '../../../models/invoice.model.js';
import { MailConnection, type MailConnectionDoc } from '../../../models/mailConnection.model.js';
import {
  MailIngestion,
  type MailIngestionAttachmentDoc,
  type MailIngestionDoc,
} from '../../../models/mailIngestion.model.js';
import { User } from '../../../models/user.model.js';
import { audit, type AuditContext } from '../../audit/audit.service.js';
import * as invoiceService from '../../invoices/invoice.service.js';
import { accessTokenFor } from './outlook.tokens.js';
import {
  AttachmentSkipReason,
  evaluateMessage,
  partitionAttachments,
  queryFromRules,
  routeCompany,
} from './rules.js';

/**
 * Pulling invoices out of a connected mailbox.
 *
 * Manual only: a sync happens because somebody pressed the button. There is no
 * queue in this codebase, so a run follows the pattern the extraction worker
 * already established — claim a lock in the database, fire and forget, write
 * progress as you go, and let a sweep reclaim anything a crash left behind.
 */

type Connection = MailConnectionDoc & { _id: Types.ObjectId };
type Ingestion = MailIngestionDoc & { _id: Types.ObjectId };

/**
 * How long a claimed sync may sit before we assume the process died. Mirrors
 * `STUCK_AFTER_MS` in the extraction worker.
 */
const STALE_SYNC_MS = 10 * 60 * 1000;

/** Graph's indexing can surface a message after one with a later timestamp, so
 *  the watermark is rewound slightly on every advance. The redundant re-reads
 *  cost nothing: the unique index on the ingestion collapses them. */
const WATERMARK_OVERLAP_MS = 2 * 60 * 1000;

/**
 * Claims the sync lock and starts a run in the background.
 *
 * The claim is a conditional update rather than a read-then-write, because two
 * clicks genuinely race and only the database can arbitrate.
 */
export async function startSync(
  connectionId: Types.ObjectId,
  context: AuditContext,
): Promise<{ syncRunId: string; status: 'RUNNING' }> {
  const syncRunId = randomBytes(12).toString('hex');
  const staleBefore = new Date(Date.now() - STALE_SYNC_MS);

  const claimed = await MailConnection.findOneAndUpdate(
    {
      _id: connectionId,
      status: MailConnectionStatus.CONNECTED,
      $or: [
        { syncState: 'IDLE' },
        { syncState: { $exists: false } },
        // A run whose process died self-heals rather than needing an operator.
        { syncState: 'RUNNING', syncStartedAt: { $lt: staleBefore } },
      ],
    },
    { $set: { syncState: 'RUNNING', syncStartedAt: new Date(), syncRunId } },
    { new: true },
  );

  if (!claimed) {
    const current = await MailConnection.findById(connectionId).lean();
    if (!current) throw ApiError.notFound('Mailbox connection not found');
    if (current.status !== MailConnectionStatus.CONNECTED) {
      throw ApiError.conflict('This mailbox is not connected. Reconnect Outlook to sync.');
    }
    throw ApiError.conflict('A sync is already running for this mailbox');
  }

  await audit.record(
    {
      event: 'outlook.sync.started',
      entityType: 'MAIL_CONNECTION',
      entityId: connectionId,
      entityLabel: claimed.accountEmail,
      tenantId: claimed.tenantId,
      companyId: claimed.defaultCompanyId,
      metadata: { syncRunId },
    },
    context,
  );

  // Fire and forget, exactly as invoice upload does with extraction: the caller
  // gets a 202 and watches the ingestion rows fill in.
  void runSync(connectionId, syncRunId).catch((error: unknown) => {
    logger.error({ err: error, connectionId: String(connectionId) }, 'outlook sync crashed');
  });

  return { syncRunId, status: 'RUNNING' };
}

/**
 * Performs one sync.
 *
 * Exported so the integration test can await a deterministic run rather than
 * racing the fire-and-forget call in {@link startSync}.
 */
export async function runSync(
  connectionId: Types.ObjectId,
  syncRunId: string,
): Promise<MailSyncSummary> {
  const summary: MailSyncSummary = {
    syncRunId,
    messagesSeen: 0,
    invoicesCreated: 0,
    skipped: 0,
    failed: 0,
    outcome: 'SUCCESS',
    hasMore: false,
  };
  let lastSyncError: string | undefined;

  try {
    const connection = (await MailConnection.findById(connectionId)) as Connection | null;
    if (!connection) throw new Error('Mailbox connection not found');

    const token = await accessTokenFor(connectionId);
    const page = await delegatedMailFetcher().fetchMessages(
      token,
      queryFromRules(connection.rules, connection.watermarkAt),
    );
    summary.hasMore = page.hasMore;
    summary.messagesSeen = page.messages.length;

    const companyIds = await accessibleCompanyIds(connection);

    for (const message of page.messages) {
      let ingestion: Ingestion | null = null;
      try {
        ingestion = await upsertIngestion(connection, message, syncRunId);
        const result = await processMessage(connection, message, ingestion, companyIds);
        summary.invoicesCreated += result.created;
        if (result.skipped) summary.skipped += 1;
        if (result.failed) summary.failed += 1;
      } catch (error) {
        // Per-message isolation: one unreadable email must not abandon the rest.
        summary.failed += 1;
        logger.warn(
          { err: error, messageId: message.messageId },
          'outlook sync failed for one message',
        );
        if (ingestion) await markIngestionFailed(ingestion, (error as Error).message);
      }
    }

    await advanceWatermark(connectionId, page.newestReceivedAt);
    summary.outcome = summary.failed ? 'PARTIAL' : 'SUCCESS';
  } catch (error) {
    summary.outcome = 'FAILED';
    lastSyncError = (error as Error).message;
    logger.error({ err: error, connectionId: String(connectionId) }, 'outlook sync failed');
  } finally {
    // Non-negotiable. Without releasing the lock here a thrown fetch would keep
    // the Sync button disabled until the stale-claim window elapsed.
    await releaseLock(connectionId, summary, lastSyncError);
  }

  return summary;
}

async function releaseLock(
  connectionId: Types.ObjectId,
  summary: MailSyncSummary,
  lastSyncError: string | undefined,
): Promise<void> {
  await MailConnection.updateOne(
    { _id: connectionId },
    {
      $set: {
        syncState: 'IDLE',
        lastSyncAt: new Date(),
        lastSyncStatus: summary.outcome as MailSyncOutcome,
        ...(lastSyncError ? { lastSyncError } : {}),
      },
      $unset: { syncRunId: '', ...(lastSyncError ? {} : { lastSyncError: '' }) },
      $inc: {
        totalMessagesSeen: summary.messagesSeen,
        totalInvoicesCreated: summary.invoicesCreated,
      },
    },
  );
}

/**
 * Moves the high-water mark forward, slightly behind the newest message seen.
 *
 * Only ever advances: a sync that read nothing must not rewind the mark and
 * re-read the previous window.
 */
async function advanceWatermark(
  connectionId: Types.ObjectId,
  newest: Date | undefined,
): Promise<void> {
  if (!newest) return;
  const next = new Date(newest.getTime() - WATERMARK_OVERLAP_MS);
  await MailConnection.updateOne(
    {
      _id: connectionId,
      $or: [{ watermarkAt: { $lt: next } }, { watermarkAt: { $exists: false } }],
    },
    { $set: { watermarkAt: next } },
  );
}

/**
 * Creates or refreshes the row for one message.
 *
 * A re-sync re-reads messages by design, so this is an upsert on the
 * idempotency key rather than an insert.
 */
async function upsertIngestion(
  connection: Connection,
  message: InboundMessage,
  syncRunId: string,
): Promise<Ingestion> {
  const companyId = resolveCompanyId(connection, message);

  return (await MailIngestion.findOneAndUpdate(
    {
      tenantId: connection.tenantId,
      connectionId: connection._id,
      providerMessageId: message.messageId,
    },
    {
      $set: {
        companyId,
        userId: connection.userId,
        provider: connection.provider,
        internetMessageId: message.internetMessageId,
        conversationId: message.conversationId,
        subject: message.subject,
        fromAddress: message.from,
        toAddresses: message.to,
        receivedAt: message.receivedAt,
        bodyPreview: message.bodyPreview,
        folderName: connection.rules.folder,
        webLink: message.webLink,
        status: MailIngestionStatus.PROCESSING,
        attachmentCount: message.attachments.length,
        syncRunId,
        startedAt: new Date(),
      },
      $unset: { completedAt: '', error: '', skipReason: '' },
    },
    { new: true, upsert: true, setDefaultsOnInsert: true },
  )) as unknown as Ingestion;
}

function resolveCompanyId(connection: Connection, message: InboundMessage): Types.ObjectId {
  const routed = routeCompany(connection.rules, message);
  return routed ? new Types.ObjectId(routed) : connection.defaultCompanyId;
}

/** The companies the mailbox owner may still file invoices against. */
async function accessibleCompanyIds(connection: Connection): Promise<Set<string> | null> {
  const owner = await User.findById(connection.userId).select('companyIds').lean();
  // An empty list means tenant-wide access, which is what `null` signals here.
  if (!owner || !owner.companyIds?.length) return null;
  return new Set(owner.companyIds.map(String));
}

interface MessageResult {
  created: number;
  skipped: boolean;
  failed: boolean;
}

/**
 * Turns one email into invoices, or records why it did not.
 *
 * Rules are applied before anything expensive, and a rejection is written to
 * the row rather than dropped — a skipped message with a reason is the only
 * thing that can answer "why didn't my invoice come in?".
 */
async function processMessage(
  connection: Connection,
  message: InboundMessage,
  ingestion: Ingestion,
  companyIds: Set<string> | null,
): Promise<MessageResult> {
  const verdict = evaluateMessage(connection.rules, message);
  const { supported, skipped } = partitionAttachments(connection.rules, message.attachments);

  if (!verdict.accepted) {
    await finishIngestion(ingestion, {
      status: MailIngestionStatus.SKIPPED,
      skipReason: verdict.skipReason,
      attachments: skipped.map((entry) => skippedAttachment(entry.attachment, entry.reason)),
      processedCount: 0,
    });
    return { created: 0, skipped: true, failed: false };
  }

  // Access can be withdrawn between connecting and syncing, and an invoice must
  // never land in a company its owner can no longer see.
  if (companyIds && !companyIds.has(String(ingestion.companyId))) {
    await finishIngestion(ingestion, {
      status: MailIngestionStatus.SKIPPED,
      skipReason: MailSkipReason.COMPANY_ACCESS_LOST,
      attachments: supported.map((attachment) =>
        skippedAttachment(attachment, 'COMPANY_ACCESS_LOST'),
      ),
      processedCount: 0,
    });
    return { created: 0, skipped: true, failed: false };
  }

  const rows: MailIngestionAttachmentDoc[] = skipped.map((entry) =>
    skippedAttachment(entry.attachment, entry.reason),
  );
  let created = 0;
  let failed = 0;

  for (const [index, attachment] of supported.entries()) {
    const row = await ingestAttachment(connection, message, ingestion, attachment, index);
    rows.push(row);
    if (row.status === MailAttachmentStatus.READY_FOR_REVIEW) created += 1;
    if (row.status === MailAttachmentStatus.FAILED) failed += 1;
  }

  await finishIngestion(ingestion, {
    status:
      failed === 0
        ? MailIngestionStatus.COMPLETED
        : created > 0
          ? MailIngestionStatus.PARTIAL
          : MailIngestionStatus.FAILED,
    attachments: rows,
    processedCount: created,
  });

  return { created, skipped: false, failed: failed > 0 && created === 0 };
}

/**
 * Stores one attachment as an invoice and reads it.
 *
 * `intake` and `runExtraction` are the same functions the upload endpoint and
 * the shared-mailbox poller use, unchanged. Extraction is awaited rather than
 * fired and forgotten, because the whole point of the screen is to say how each
 * attachment is proceeding, and only the caller can record that outcome.
 */
async function ingestAttachment(
  connection: Connection,
  message: InboundMessage,
  ingestion: Ingestion,
  attachment: InboundAttachment,
  index: number,
): Promise<MailIngestionAttachmentDoc> {
  const messageKey = ingestionKey(message, index);
  const base: MailIngestionAttachmentDoc = {
    name: attachment.filename,
    contentType: attachment.contentType,
    size: attachment.size ?? attachment.content.length,
    ...(attachment.attachmentId ? { attachmentId: attachment.attachmentId } : {}),
    status: MailAttachmentStatus.EXTRACTING,
    messageKey,
    extractionStartedAt: new Date(),
  };

  try {
    const invoice = await invoiceService.intake(
      {
        tenantId: connection.tenantId,
        companyId: ingestion.companyId,
        fileName: attachment.filename,
        contentType: attachment.contentType,
        content: attachment.content,
        source: 'EMAIL',
        uploadedBy: connection.userId,
        emailMessageId: messageKey,
        senderEmail: message.from,
      },
      {},
    );

    // Written before extraction so the polling screen shows the row moving
    // rather than sitting blank for the length of an LLM call.
    await setAttachment(ingestion, { ...base, invoiceId: invoice._id });

    await invoiceService.runExtraction(invoice._id);

    const settled = await Invoice.findById(invoice._id).select('status extractionError').lean();
    const failed = settled?.status === InvoiceStatus.FAILED;

    return {
      ...base,
      invoiceId: invoice._id,
      status: failed ? MailAttachmentStatus.FAILED : MailAttachmentStatus.READY_FOR_REVIEW,
      ...(failed && settled?.extractionError ? { error: settled.extractionError } : {}),
      extractionCompletedAt: new Date(),
    };
  } catch (error) {
    // Per-attachment isolation: a corrupt PDF must not lose the other files on
    // the same email.
    logger.warn(
      { err: error, messageId: message.messageId, file: attachment.filename },
      'outlook attachment ingestion failed',
    );
    return {
      ...base,
      status: MailAttachmentStatus.FAILED,
      error: (error as Error).message,
      extractionCompletedAt: new Date(),
    };
  }
}

/**
 * The key an attachment is ingested under.
 *
 * Prefers the RFC 5322 Message-ID, which is identical across every copy of an
 * email. Two colleagues both CC'd on one vendor invoice therefore produce one
 * invoice rather than two, for free, through the existing sparse index on
 * `Invoice.emailMessageId`.
 *
 * The `#index` suffix is unconditional, unlike the shared-mailbox poller which
 * omits it for single-attachment mail. That avoids a subtle trap: without it,
 * an email gaining a second attachment would change the first one's key and
 * re-ingest it. The two key spaces do not overlap — provider ids versus
 * angle-bracketed message-ids — so the divergence is safe.
 */
function ingestionKey(message: InboundMessage, index: number): string {
  return `${message.internetMessageId ?? message.messageId}#${index}`;
}

function skippedAttachment(
  attachment: InboundAttachment,
  reason: AttachmentSkipReason | string,
): MailIngestionAttachmentDoc {
  return {
    name: attachment.filename,
    contentType: attachment.contentType,
    size: attachment.size ?? attachment.content.length,
    ...(attachment.attachmentId ? { attachmentId: attachment.attachmentId } : {}),
    status: MailAttachmentStatus.SKIPPED,
    skipReason: String(reason),
  };
}

/** Publishes one attachment's progress mid-run so the screen can show it. */
async function setAttachment(ingestion: Ingestion, row: MailIngestionAttachmentDoc): Promise<void> {
  await MailIngestion.updateOne({ _id: ingestion._id }, { $push: { attachments: row } }).catch(
    () => undefined,
  );
}

async function finishIngestion(
  ingestion: Ingestion,
  input: {
    status: MailIngestionStatus;
    skipReason?: MailSkipReason | undefined;
    attachments: MailIngestionAttachmentDoc[];
    processedCount: number;
  },
): Promise<void> {
  await MailIngestion.updateOne(
    { _id: ingestion._id },
    {
      $set: {
        status: input.status,
        // Replaced wholesale rather than appended: the in-progress rows pushed
        // during the run are provisional, and this is the settled truth.
        attachments: input.attachments,
        processedCount: input.processedCount,
        completedAt: new Date(),
        ...(input.skipReason ? { skipReason: input.skipReason } : {}),
      },
    },
  );
}

async function markIngestionFailed(ingestion: Ingestion, error: string): Promise<void> {
  await MailIngestion.updateOne(
    { _id: ingestion._id },
    { $set: { status: MailIngestionStatus.FAILED, error, completedAt: new Date() } },
  );
}

/**
 * Retries one email's attachments.
 *
 * Re-runs extraction on the documents already stored rather than going back to
 * the mailbox: by the time somebody presses Retry the attachment has been
 * fetched and saved, and the usual cause is a transient extraction failure. An
 * attachment that never produced an invoice — an unreadable type, an oversize
 * file — cannot be retried this way and is left as it is.
 */
export async function retryIngestion(
  ingestionId: Types.ObjectId,
  context: AuditContext,
): Promise<MailIngestionDoc & { _id: Types.ObjectId }> {
  const ingestion = (await MailIngestion.findById(ingestionId)) as Ingestion | null;
  if (!ingestion) throw ApiError.notFound('Email not found');

  const retryable = (ingestion.attachments ?? []).filter(
    (attachment) => attachment.invoiceId && attachment.status === MailAttachmentStatus.FAILED,
  );
  if (!retryable.length) {
    throw ApiError.unprocessable('Nothing on this email can be retried');
  }

  await MailIngestion.updateOne(
    { _id: ingestion._id },
    { $set: { status: MailIngestionStatus.PROCESSING }, $unset: { error: '' } },
  );

  const rows = [...(ingestion.attachments ?? [])];
  let recovered = 0;

  for (const [index, attachment] of rows.entries()) {
    if (!attachment.invoiceId || attachment.status !== MailAttachmentStatus.FAILED) continue;
    try {
      await invoiceService.runExtraction(attachment.invoiceId);
      const settled = await Invoice.findById(attachment.invoiceId)
        .select('status extractionError')
        .lean();
      const stillFailed = settled?.status === InvoiceStatus.FAILED;
      rows[index] = {
        ...attachment,
        status: stillFailed ? MailAttachmentStatus.FAILED : MailAttachmentStatus.READY_FOR_REVIEW,
        ...(stillFailed
          ? { error: settled?.extractionError ?? attachment.error }
          : { error: undefined }),
        extractionCompletedAt: new Date(),
      };
      if (!stillFailed) recovered += 1;
    } catch (error) {
      rows[index] = { ...attachment, error: (error as Error).message };
    }
  }

  const stillFailing = rows.some((attachment) => attachment.status === MailAttachmentStatus.FAILED);
  const readyCount = rows.filter(
    (attachment) => attachment.status === MailAttachmentStatus.READY_FOR_REVIEW,
  ).length;

  await MailIngestion.updateOne(
    { _id: ingestion._id },
    {
      $set: {
        attachments: rows,
        processedCount: readyCount,
        completedAt: new Date(),
        status: !stillFailing
          ? MailIngestionStatus.COMPLETED
          : readyCount > 0
            ? MailIngestionStatus.PARTIAL
            : MailIngestionStatus.FAILED,
      },
    },
  );

  await audit.record(
    {
      event: 'outlook.ingestion.retried',
      entityType: 'MAIL_INGESTION',
      entityId: ingestion._id,
      entityLabel: ingestion.subject,
      tenantId: ingestion.tenantId,
      companyId: ingestion.companyId,
      metadata: { attempted: retryable.length, recovered },
    },
    context,
  );

  return (await MailIngestion.findById(
    ingestionId,
  ).lean<MailIngestionDoc>()) as MailIngestionDoc & {
    _id: Types.ObjectId;
  };
}

/**
 * Repairs state a crashed process left behind.
 *
 * This is deliberately not a mail poller: it never contacts Microsoft and never
 * pulls anything. It only releases locks and closes rows that a dead run left
 * claimed, which is what stops a server restart wedging somebody's Sync button
 * until the stale window elapses.
 */
export async function reclaimStuckSyncs(): Promise<{ connections: number; ingestions: number }> {
  const staleBefore = new Date(Date.now() - STALE_SYNC_MS);

  const connections = await MailConnection.updateMany(
    { syncState: 'RUNNING', syncStartedAt: { $lt: staleBefore } },
    {
      $set: {
        syncState: 'IDLE',
        lastSyncStatus: 'FAILED',
        lastSyncError: 'Sync was interrupted — try again',
        lastSyncAt: new Date(),
      },
      $unset: { syncRunId: '' },
    },
  );

  const ingestions = await MailIngestion.updateMany(
    { status: MailIngestionStatus.PROCESSING, startedAt: { $lt: staleBefore } },
    {
      $set: {
        status: MailIngestionStatus.FAILED,
        error: 'Sync was interrupted before this email finished',
        completedAt: new Date(),
        'attachments.$[stuck].status': MailAttachmentStatus.FAILED,
      },
    },
    {
      arrayFilters: [{ 'stuck.status': { $in: ['QUEUED', 'EXTRACTING'] } }],
    },
  );

  const result = {
    connections: connections.modifiedCount,
    ingestions: ingestions.modifiedCount,
  };
  if (result.connections || result.ingestions) {
    logger.info(result, 'reclaimed interrupted outlook syncs');
  }
  return result;
}
