import { Schema, Types, model } from 'mongoose';
import {
  INVOICE_STATUSES,
  InvoiceStatus,
  TDS_SECTIONS,
  netPayableFor,
  normalizeInvoiceNumber,
  type ApprovalStatus,
  type ExtractionResult,
  type InvoiceSource,
  type TdsSection,
  type ValidationFinding,
} from '@fpc/shared';
import { baseSchemaOptions, orgScopedFields, scopedFields } from './base.js';

export interface InvoiceLineDoc {
  description: string;
  quantity?: number;
  unitPrice?: number;
  /** Minor units. */
  amount: number;
  hsnSac?: string;
  taxRate?: number;
}

/** What the accounting team recorded when it verified an invoice. */
export interface InvoiceAccountingDoc {
  verifiedByUserId?: Types.ObjectId;
  verifiedAt?: Date;
  glCode?: string;
  costCentre?: string;
  notes?: string;
}

export interface InvoiceDoc {
  tenantId: Types.ObjectId;
  companyId: Types.ObjectId;
  groupId?: Types.ObjectId;
  regionId?: Types.ObjectId;
  verticalId?: Types.ObjectId;
  businessUnitId?: Types.ObjectId;
  locationId?: Types.ObjectId;
  departmentId?: Types.ObjectId;
  /** Human-readable identifier, e.g. FIN-INV-2026-000182. */
  trackingId: string;
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
  /**
   * GROSS — what the vendor billed.
   *
   * TDS is a deduction at payment, not a change to the bill, so this keeps its
   * original meaning and every consumer of it (ageing, duplicate detection,
   * the invoice register, search) is unaffected. What actually leaves the bank
   * is `netPayable`.
   */
  totalAmount?: number;
  tdsApplicable: boolean;
  tdsSection?: TdsSection;
  tdsRateBasisPoints?: number;
  /** The taxable value the deduction was calculated on. */
  tdsBaseAmount?: number;
  tdsAmount: number;
  /** `totalAmount - tdsAmount`. Derived — never accepted from a client. */
  netPayable: number;
  accounting?: InvoiceAccountingDoc;
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
  /** The open Treasury escalation, when the invoice has one. */
  financeRequestId?: Types.ObjectId;
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
    ...orgScopedFields(),
    trackingId: { type: String, required: true },
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
    tdsApplicable: { type: Boolean, default: false },
    tdsSection: { type: String, enum: [...TDS_SECTIONS, null] },
    tdsRateBasisPoints: { type: Number, min: 0, max: 10_000 },
    tdsBaseAmount: Number,
    tdsAmount: { type: Number, default: 0, min: 0 },
    netPayable: { type: Number, default: 0, min: 0 },
    accounting: {
      type: new Schema<InvoiceAccountingDoc>(
        {
          verifiedByUserId: { type: Schema.Types.ObjectId, ref: 'User' },
          verifiedAt: Date,
          glCode: String,
          costCentre: String,
          notes: String,
        },
        { _id: false },
      ),
      default: undefined,
    },
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
    financeRequestId: { type: Schema.Types.ObjectId, ref: 'FinanceRequest' },
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
schema.index({ tenantId: 1, trackingId: 1 }, { unique: true });
// The accounting and Treasury queues, and the vertical-wise dashboard.
schema.index({ tenantId: 1, companyId: 1, verticalId: 1, status: 1 });

schema.pre('validate', function normalize(next) {
  if (this.isModified('invoiceNumber')) {
    this.invoiceNumberNormalized = normalizeInvoiceNumber(this.invoiceNumber);
  }
  // Derived here rather than at each call site, so the figure the bank pays
  // can never drift from the figure the invoice carries.
  this.netPayable = netPayableFor(this.totalAmount ?? 0, this.tdsAmount ?? 0);
  next();
});

export const Invoice = model<InvoiceDoc>('Invoice', schema);
