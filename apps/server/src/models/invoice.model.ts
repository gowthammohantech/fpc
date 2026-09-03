import { Schema, Types, model } from 'mongoose';
import {
  INVOICE_STATUSES,
  InvoiceStatus,
  normalizeInvoiceNumber,
  type ApprovalStatus,
  type ExtractionResult,
  type InvoiceSource,
  type ValidationFinding,
} from '@fpc/shared';
import { baseSchemaOptions, scopedFields } from './base.js';

export interface InvoiceLineDoc {
  description: string;
  quantity?: number;
  unitPrice?: number;
  /** Minor units. */
  amount: number;
  hsnSac?: string;
  taxRate?: number;
}

export interface InvoiceDoc {
  tenantId: Types.ObjectId;
  companyId: Types.ObjectId;
  locationId?: Types.ObjectId;
  departmentId?: Types.ObjectId;
  vendorId?: Types.ObjectId;
  vendorName?: string;
  invoiceNumber?: string;
  /** Punctuation-stripped invoice number, used for duplicate detection. */
  invoiceNumberNormalized?: string;
  invoiceDate?: Date;
  dueDate?: Date;
  currency: 'INR';
  /** All amounts in minor units (paise). */
  subtotal?: number;
  taxAmount?: number;
  totalAmount?: number;
  gstin?: string;
  status: InvoiceStatus;
  source: InvoiceSource;
  documentFileId?: Types.ObjectId;
  documentFileName?: string;
  lines: InvoiceLineDoc[];
  extraction?: ExtractionResult;
  findings: ValidationFinding[];
  approvalRequestId?: Types.ObjectId;
  approvalStatus: ApprovalStatus;
  obligationId?: Types.ObjectId;
  paymentBatchId?: Types.ObjectId;
  paidAt?: Date;
  reconciledAt?: Date;
  submittedBy?: Types.ObjectId;
  submittedAt?: Date;
  receivedAt: Date;
  /** Provider message id, so the same email is never ingested twice. */
  emailMessageId?: string;
  senderEmail?: string;
  extractionAttempts: number;
  extractionError?: string;
}

const lineSchema = new Schema<InvoiceLineDoc>(
  {
    description: { type: String, required: true },
    quantity: Number,
    unitPrice: Number,
    amount: { type: Number, required: true },
    hsnSac: String,
    taxRate: Number,
  },
  { _id: false },
);

const findingSchema = new Schema<ValidationFinding>(
  {
    code: { type: String, required: true },
    severity: { type: String, required: true },
    message: { type: String, required: true },
    field: String,
    relatedEntityIds: [String],
    resolved: { type: Boolean, default: false },
    resolvedBy: String,
    resolvedAt: String,
    resolutionNote: String,
  },
  { _id: false },
);

const schema = new Schema<InvoiceDoc>(
  {
    ...scopedFields(),
    locationId: { type: Schema.Types.ObjectId, ref: 'Location' },
    departmentId: { type: Schema.Types.ObjectId, ref: 'Department' },
    vendorId: { type: Schema.Types.ObjectId, ref: 'Vendor', index: true },
    vendorName: { type: String, trim: true },
    invoiceNumber: { type: String, trim: true },
    invoiceNumberNormalized: { type: String, index: true },
    invoiceDate: Date,
    dueDate: { type: Date, index: true },
    currency: { type: String, enum: ['INR'], default: 'INR' },
    subtotal: Number,
    taxAmount: Number,
    totalAmount: { type: Number, index: true },
    gstin: { type: String, uppercase: true, trim: true },
    status: { type: String, enum: INVOICE_STATUSES, default: InvoiceStatus.RECEIVED, index: true },
    source: { type: String, enum: ['EMAIL', 'UPLOAD'], required: true },
    documentFileId: { type: Schema.Types.ObjectId, ref: 'DocumentFile' },
    documentFileName: String,
    lines: { type: [lineSchema], default: [] },
    extraction: Schema.Types.Mixed,
    findings: { type: [findingSchema], default: [] },
    approvalRequestId: { type: Schema.Types.ObjectId, ref: 'ApprovalRequest' },
    approvalStatus: { type: String, default: 'NOT_REQUIRED' },
    obligationId: { type: Schema.Types.ObjectId, ref: 'PaymentObligation' },
    paymentBatchId: { type: Schema.Types.ObjectId, ref: 'PaymentBatch', index: true },
    paidAt: Date,
    reconciledAt: Date,
    submittedBy: { type: Schema.Types.ObjectId, ref: 'User' },
    submittedAt: Date,
    receivedAt: { type: Date, default: Date.now, index: true },
    emailMessageId: { type: String, index: true, sparse: true },
    senderEmail: String,
    extractionAttempts: { type: Number, default: 0 },
    extractionError: String,
  },
  baseSchemaOptions,
);

// The operational lists (register, review queue, AP ageing) all filter on
// company + status and sort by due date.
schema.index({ tenantId: 1, companyId: 1, status: 1, dueDate: 1 });
schema.index({ tenantId: 1, companyId: 1, vendorId: 1, invoiceNumberNormalized: 1 });
schema.index({ tenantId: 1, companyId: 1, totalAmount: 1 });
schema.index({ tenantId: 1, emailMessageId: 1 }, { sparse: true });

schema.pre('validate', function normalize(next) {
  if (this.isModified('invoiceNumber')) {
    this.invoiceNumberNormalized = normalizeInvoiceNumber(this.invoiceNumber);
  }
  next();
});

export const Invoice = model<InvoiceDoc>('Invoice', schema);
