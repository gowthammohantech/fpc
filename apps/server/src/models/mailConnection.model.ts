import { Schema, Types, model } from 'mongoose';
import {
  MAIL_CONNECTION_STATUSES,
  MAIL_PROVIDERS,
  MAIL_ROUTE_MATCHES,
  MailConnectionStatus,
  SUPPORTED_INVOICE_CONTENT_TYPES,
  type MailConnectionStatus as MailConnectionStatusType,
  type MailProvider,
  type MailRouteMatch,
  type MailSyncOutcome,
  type MailSyncState,
} from '@fpc/shared';
import { baseSchemaOptions } from './base.js';

/**
 * A user's own mailbox, connected to pull invoices from (PRD §11).
 *
 * Deliberately not `scopedFields()`. The connection belongs to a person, not a
 * company: it is tenant-scoped, and `defaultCompanyId` is a routing target for
 * the invoices it creates rather than an ownership scope. This is what lets one
 * mailbox feed several companies through `rules.companyRoutes`.
 *
 * Complementary to `Company.invoiceInboxAddress`, which is a shared mailbox the
 * platform polls with application credentials on everyone's behalf. This one is
 * delegated: it reads as the signed-in user, and only ever reads.
 */

export interface MailCompanyRouteDoc {
  match: MailRouteMatch;
  value: string;
  companyId: Types.ObjectId;
}

export interface MailSyncRulesDoc {
  folder: string;
  senderAllowlist: string[];
  subjectKeywords: string[];
  allowedContentTypes: string[];
  maxMessagesPerSync: number;
  lookbackDays: number;
  companyRoutes: MailCompanyRouteDoc[];
}

export interface MailConnectionDoc {
  tenantId: Types.ObjectId;
  userId: Types.ObjectId;
  provider: MailProvider;
  /** Graph `/me.id` — stable even if the user's address changes. */
  providerAccountId: string;
  providerTenantId?: string;
  accountEmail: string;
  accountName?: string;
  status: MailConnectionStatusType;
  statusMessage?: string;
  /** What the provider actually granted, which may be less than we asked for. */
  scopes: string[];
  accessTokenCipher?: string;
  accessTokenExpiresAt?: Date;
  refreshTokenCipher?: string;
  refreshTokenIssuedAt?: Date;
  defaultCompanyId: Types.ObjectId;
  rules: MailSyncRulesDoc;
  /** Reserved for a future poller; nothing reads it yet. */
  autoSyncEnabled: boolean;
  /** Reserved for a future delta-based poller; v1 uses `watermarkAt`. */
  deltaLink?: string;
  /** `receivedDateTime` high-water mark — how a sync knows where it left off. */
  watermarkAt?: Date;
  lastSyncAt?: Date;
  lastSyncStatus?: MailSyncOutcome;
  lastSyncError?: string;
  syncState: MailSyncState;
  syncStartedAt?: Date;
  syncRunId?: string;
  connectedAt: Date;
  disconnectedAt?: Date;
  totalMessagesSeen: number;
  totalInvoicesCreated: number;
}

const companyRouteSchema = new Schema<MailCompanyRouteDoc>(
  {
    match: { type: String, enum: MAIL_ROUTE_MATCHES, required: true },
    value: { type: String, required: true, trim: true, lowercase: true },
    companyId: { type: Schema.Types.ObjectId, ref: 'Company', required: true },
  },
  { _id: false },
);

const rulesSchema = new Schema<MailSyncRulesDoc>(
  {
    folder: { type: String, default: 'inbox', trim: true },
    // Empty means "any", not "none" — a freshly connected mailbox with no rules
    // must still pull something.
    senderAllowlist: { type: [String], default: [] },
    subjectKeywords: { type: [String], default: [] },
    allowedContentTypes: {
      type: [String],
      default: () => [...SUPPORTED_INVOICE_CONTENT_TYPES],
    },
    maxMessagesPerSync: { type: Number, default: 25, min: 1, max: 100 },
    lookbackDays: { type: Number, default: 30, min: 1, max: 365 },
    companyRoutes: { type: [companyRouteSchema], default: [] },
  },
  { _id: false },
);

const schema = new Schema<MailConnectionDoc>(
  {
    tenantId: { type: Schema.Types.ObjectId, ref: 'Tenant', required: true, index: true },
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    provider: { type: String, enum: MAIL_PROVIDERS, required: true },
    providerAccountId: { type: String, required: true },
    providerTenantId: { type: String },
    accountEmail: { type: String, required: true, trim: true, lowercase: true },
    accountName: { type: String, trim: true },
    status: {
      type: String,
      enum: MAIL_CONNECTION_STATUSES,
      default: MailConnectionStatus.CONNECTED,
      index: true,
    },
    statusMessage: { type: String },
    scopes: { type: [String], default: [] },
    // `select: false` so a token can only be read by code that asks for it by
    // name; `base.ts` additionally strips both from every JSON response.
    accessTokenCipher: { type: String, select: false },
    accessTokenExpiresAt: { type: Date },
    refreshTokenCipher: { type: String, select: false },
    refreshTokenIssuedAt: { type: Date },
    defaultCompanyId: { type: Schema.Types.ObjectId, ref: 'Company', required: true },
    rules: { type: rulesSchema, default: () => ({}) },
    autoSyncEnabled: { type: Boolean, default: false },
    deltaLink: { type: String },
    watermarkAt: { type: Date },
    lastSyncAt: { type: Date },
    lastSyncStatus: { type: String, enum: ['SUCCESS', 'PARTIAL', 'FAILED'] },
    lastSyncError: { type: String },
    syncState: { type: String, enum: ['IDLE', 'RUNNING'], default: 'IDLE' },
    syncStartedAt: { type: Date },
    syncRunId: { type: String },
    connectedAt: { type: Date, default: () => new Date() },
    disconnectedAt: { type: Date },
    totalMessagesSeen: { type: Number, default: 0 },
    totalInvoicesCreated: { type: Number, default: 0 },
  },
  baseSchemaOptions,
);

/** One connection per user per provider — reconnecting updates it in place. */
schema.index({ tenantId: 1, userId: 1, provider: 1 }, { unique: true });

/**
 * The same mailbox cannot be claimed by two users. Without this, two sync locks
 * would fight over one inbox and each would ingest the other's messages.
 */
schema.index({ tenantId: 1, providerAccountId: 1 }, { unique: true, sparse: true });

/** The selection query a future poller would run. Costs nothing today. */
schema.index({ status: 1, autoSyncEnabled: 1, lastSyncAt: 1 });

export const MailConnection = model<MailConnectionDoc>('MailConnection', schema);
