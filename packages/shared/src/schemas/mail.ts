import { z } from 'zod';
import {
  MAIL_INGESTION_STATUSES,
  MAIL_ROUTE_MATCHES,
  SUPPORTED_INVOICE_CONTENT_TYPES,
} from '../enums.js';
import { objectId, paginationQuery, scopeQuery } from './common.js';

/**
 * A sender allow-list entry: either a full address or a whole domain.
 *
 * Anything else is rejected with a message that shows both forms, because the
 * common mistake is typing a bare domain without the leading `@`.
 */
const senderPattern = z
  .string()
  .trim()
  .toLowerCase()
  .max(200)
  .refine(
    (value) => /^@[\w.-]+\.\w+$/.test(value) || /^[^@\s]+@[\w.-]+\.\w+$/.test(value),
    'Enter a full address (ap@vendor.com) or a domain (@vendor.com)',
  );

/** Sends invoices matching a pattern to a company other than the default. */
export const mailCompanyRouteInput = z.object({
  match: z.enum(MAIL_ROUTE_MATCHES as [string, ...string[]]),
  value: z.string().trim().min(2).max(200),
  companyId: objectId,
});

/**
 * What a connected mailbox may pull.
 *
 * `lookbackDays` bounds the very first sync: without it a mailbox with ten
 * years of history would try to read all of it.
 */
export const mailSyncRulesInput = z.object({
  folder: z.string().trim().min(1).max(120).default('inbox'),
  /** Empty means any sender, not no sender. */
  senderAllowlist: z.array(senderPattern).max(50).default([]),
  /** Empty means any subject. Matched case-insensitively, so stored lowercased. */
  subjectKeywords: z.array(z.string().trim().toLowerCase().min(2).max(80)).max(50).default([]),
  allowedContentTypes: z
    .array(z.enum(SUPPORTED_INVOICE_CONTENT_TYPES))
    .min(1)
    .default([...SUPPORTED_INVOICE_CONTENT_TYPES]),
  maxMessagesPerSync: z.coerce.number().int().min(1).max(100).default(25),
  lookbackDays: z.coerce.number().int().min(1).max(365).default(30),
  companyRoutes: z.array(mailCompanyRouteInput).max(25).default([]),
});
export type MailSyncRulesInput = z.infer<typeof mailSyncRulesInput>;

/**
 * Starting the connect flow.
 *
 * The default company is required up front rather than defaulted server-side:
 * the connection is per-user and global, so there is no company to infer, and
 * every invoice it creates needs one.
 */
export const connectOutlookRequest = z.object({
  defaultCompanyId: objectId,
});
export type ConnectOutlookRequest = z.infer<typeof connectOutlookRequest>;

export const updateMailConnectionRequest = z.object({
  defaultCompanyId: objectId.optional(),
  rules: mailSyncRulesInput.partial().optional(),
});
export type UpdateMailConnectionRequest = z.infer<typeof updateMailConnectionRequest>;

export const mailIngestionListQuery = paginationQuery.merge(scopeQuery).extend({
  connectionId: objectId.optional(),
  syncRunId: z.string().max(64).optional(),
  /** Honoured only for callers holding `mail_connection:read_all`. */
  userId: objectId.optional(),
  status: z
    .union([
      z.enum(MAIL_INGESTION_STATUSES as [string, ...string[]]),
      z.array(z.enum(MAIL_INGESTION_STATUSES as [string, ...string[]])),
    ])
    .optional(),
  view: z.enum(['ALL', 'IN_PROGRESS', 'READY', 'SKIPPED', 'FAILED']).default('ALL'),
});
export type MailIngestionListQuery = z.infer<typeof mailIngestionListQuery>;

/**
 * What Microsoft sends back to the redirect URI.
 *
 * Every field is optional because the error leg carries `error` instead of
 * `code`, and a malformed callback must produce a readable message rather than
 * a validation stack trace.
 */
export const outlookCallbackQuery = z.object({
  code: z.string().max(4096).optional(),
  state: z.string().max(4096).optional(),
  error: z.string().max(200).optional(),
  error_description: z.string().max(2000).optional(),
});
export type OutlookCallbackQuery = z.infer<typeof outlookCallbackQuery>;
