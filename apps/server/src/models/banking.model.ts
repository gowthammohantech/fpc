import { Schema, Types, model } from 'mongoose';
import type { BankTransactionDirection, MatchMethod, MatchSignals, ReconciliationStatus, StatementImportStatus } from '@fpc/shared';
import { baseSchemaOptions, scopedFields } from './base.js';

export interface BankStatementDoc {
  tenantId: Types.ObjectId;
  companyId: Types.ObjectId;
  bankAccountId: Types.ObjectId;
  fileId?: Types.ObjectId;
  fileName: string;
  status: StatementImportStatus;
  periodStart?: Date;
  periodEnd?: Date;
  transactionCount: number;
  /** Rows recognised as already imported (PRD §24 re-upload safety). */
  duplicateCount: number;
  /** Minor units. */
  totalDebit: number;
  totalCredit: number;
  closingBalance?: number;
  uploadedBy: Types.ObjectId;
  error?: string;
}

const statementSchema = new Schema<BankStatementDoc>(
  {
    ...scopedFields(),
    bankAccountId: { type: Schema.Types.ObjectId, ref: 'BankAccount', required: true, index: true },
    fileId: { type: Schema.Types.ObjectId, ref: 'DocumentFile' },
    fileName: { type: String, required: true },
    status: { type: String, default: 'UPLOADED', index: true },
    periodStart: Date,
    periodEnd: Date,
    transactionCount: { type: Number, default: 0 },
    duplicateCount: { type: Number, default: 0 },
    totalDebit: { type: Number, default: 0 },
    totalCredit: { type: Number, default: 0 },
    closingBalance: Number,
    uploadedBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    error: String,
  },
  baseSchemaOptions,
);

statementSchema.index({ tenantId: 1, companyId: 1, createdAt: -1 });

export const BankStatement = model<BankStatementDoc>('BankStatement', statementSchema);

export interface BankTransactionDoc {
  tenantId: Types.ObjectId;
  companyId: Types.ObjectId;
  bankAccountId: Types.ObjectId;
  bankStatementId: Types.ObjectId;
  transactionDate: Date;
  valueDate?: Date;
  description: string;
  reference?: string;
  utr?: string;
  direction: BankTransactionDirection;
  /** Minor units, always positive; `direction` carries the sign. */
  amount: number;
  balance?: number;
  reconciliationStatus: ReconciliationStatus;
  reconciliationId?: Types.ObjectId;
  /** Hash of the identifying columns, so re-uploading a statement is safe. */
  dedupeHash: string;
}

const transactionSchema = new Schema<BankTransactionDoc>(
  {
    ...scopedFields(),
    bankAccountId: { type: Schema.Types.ObjectId, ref: 'BankAccount', required: true, index: true },
    bankStatementId: { type: Schema.Types.ObjectId, ref: 'BankStatement', required: true, index: true },
    transactionDate: { type: Date, required: true, index: true },
    valueDate: Date,
    description: { type: String, required: true },
    reference: String,
    utr: String,
    direction: { type: String, enum: ['DEBIT', 'CREDIT'], required: true, index: true },
    amount: { type: Number, required: true },
    balance: Number,
    reconciliationStatus: { type: String, default: 'UNMATCHED', index: true },
    reconciliationId: { type: Schema.Types.ObjectId, ref: 'Reconciliation' },
    dedupeHash: { type: String, required: true },
  },
  baseSchemaOptions,
);

// The same statement row must never be imported twice.
transactionSchema.index({ tenantId: 1, bankAccountId: 1, dedupeHash: 1 }, { unique: true });
transactionSchema.index({ tenantId: 1, companyId: 1, reconciliationStatus: 1, transactionDate: -1 });
transactionSchema.index({ tenantId: 1, companyId: 1, direction: 1, amount: 1 });

export const BankTransaction = model<BankTransactionDoc>('BankTransaction', transactionSchema);

export interface ReconciliationDoc {
  tenantId: Types.ObjectId;
  companyId: Types.ObjectId;
  bankTransactionId: Types.ObjectId;
  obligationId?: Types.ObjectId;
  paymentBatchId?: Types.ObjectId;
  status: ReconciliationStatus;
  /** 0-100, from the match scorer. */
  confidence: number;
  method: MatchMethod;
  signals?: MatchSignals;
  confirmedBy?: Types.ObjectId;
  confirmedAt?: Date;
  note?: string;
}

const reconciliationSchema = new Schema<ReconciliationDoc>(
  {
    ...scopedFields(),
    bankTransactionId: { type: Schema.Types.ObjectId, ref: 'BankTransaction', required: true, index: true },
    obligationId: { type: Schema.Types.ObjectId, ref: 'PaymentObligation', index: true },
    paymentBatchId: { type: Schema.Types.ObjectId, ref: 'PaymentBatch', index: true },
    status: { type: String, required: true, index: true },
    confidence: { type: Number, default: 0 },
    method: { type: String, enum: ['AUTO_SUGGESTED', 'MANUAL'], required: true },
    signals: Schema.Types.Mixed,
    confirmedBy: { type: Schema.Types.ObjectId, ref: 'User' },
    confirmedAt: Date,
    note: String,
  },
  baseSchemaOptions,
);

// One live match per transaction, and one per obligation: a payment cannot be
// reconciled against two different bank lines.
reconciliationSchema.index(
  { bankTransactionId: 1 },
  { unique: true, partialFilterExpression: { status: 'MATCHED' } },
);
reconciliationSchema.index(
  { obligationId: 1 },
  { unique: true, partialFilterExpression: { status: 'MATCHED' } },
);

export const Reconciliation = model<ReconciliationDoc>('Reconciliation', reconciliationSchema);
