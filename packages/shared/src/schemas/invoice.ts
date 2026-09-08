import { z } from 'zod';
import { FINANCE_REQUEST_PRIORITIES, INVOICE_STATUSES, TDS_SECTIONS } from '../enums.js';
import {
  basisPoints,
  isoDate,
  minorAmount,
  objectId,
  paginationQuery,
  scopeQuery,
} from './common.js';

export const invoiceLineInput = z.object({
  description: z.string().trim().min(1).max(500),
  quantity: z.number().nonnegative().optional(),
  unitPrice: z.number().int().nonnegative().optional(),
  amount: minorAmount,
  hsnSac: z.string().trim().max(20).optional(),
  taxRate: z.number().min(0).max(100).optional(),
});

/** Payload used by the review screen when finance corrects extracted values. */
export const updateInvoiceRequest = z.object({
  vendorId: objectId.optional(),
  vendorName: z.string().trim().max(200).optional(),
  invoiceNumber: z.string().trim().max(80).optional(),
  invoiceDate: isoDate.optional(),
  dueDate: isoDate.optional(),
  locationId: objectId.optional().or(z.literal('')),
  departmentId: objectId.optional().or(z.literal('')),
  regionId: objectId.optional().or(z.literal('')),
  verticalId: objectId.optional().or(z.literal('')),
  businessUnitId: objectId.optional().or(z.literal('')),
  gstin: z.string().trim().max(20).optional(),
  subtotal: minorAmount.optional(),
  taxAmount: minorAmount.optional(),
  totalAmount: minorAmount.optional(),
  lines: z.array(invoiceLineInput).max(500).optional(),
});
export type UpdateInvoiceRequest = z.infer<typeof updateInvoiceRequest>;

export const createInvoiceRequest = updateInvoiceRequest.extend({
  companyId: objectId,
});
export type CreateInvoiceRequest = z.infer<typeof createInvoiceRequest>;

export const resolveFindingRequest = z.object({
  code: z.string().min(1),
  /** `KEEP` continues with the invoice, `DUPLICATE` marks it a duplicate. */
  resolution: z.enum(['KEEP', 'DUPLICATE']),
  note: z.string().trim().min(3).max(500),
});
export type ResolveFindingRequest = z.infer<typeof resolveFindingRequest>;

export const cancelInvoiceRequest = z.object({
  reason: z.string().trim().min(3).max(500),
});

const tdsSection = z.enum(TDS_SECTIONS as unknown as [string, ...string[]]);

/**
 * The accounting team's decision on a business-approved invoice.
 *
 * `RELEASE` clears it for payment, `ESCALATE` raises a trustee request, and
 * `RETURN` sends it back to the originating department. The TDS fields are
 * accepted on every action so a return still records what accounting found.
 *
 * `netPayable` is deliberately absent: the server derives it, so a client can
 * never dictate what the bank pays.
 */
export const verifyInvoiceRequest = z
  .object({
    action: z.enum(['RELEASE', 'ESCALATE', 'RETURN']),
    tdsApplicable: z.boolean(),
    tdsSection: tdsSection.optional().or(z.literal('')),
    tdsRateBasisPoints: basisPoints.optional(),
    tdsBaseAmount: minorAmount.optional(),
    /** Overrides the computed figure. Kept in minor units like every amount. */
    tdsAmount: minorAmount.optional(),
    glCode: z.string().trim().max(40).optional(),
    costCentre: z.string().trim().max(60).optional(),
    notes: z.string().trim().max(1000).optional(),
    priority: z.enum(FINANCE_REQUEST_PRIORITIES as [string, ...string[]]).optional(),
    remarks: z.string().trim().max(1000).optional(),
  })
  .refine((body) => !body.tdsApplicable || !!body.tdsSection, {
    message: 'A TDS section is required when TDS applies',
    path: ['tdsSection'],
  })
  .refine((body) => !body.tdsApplicable || (body.tdsRateBasisPoints ?? 0) > 0, {
    message: 'A TDS rate is required when TDS applies',
    path: ['tdsRateBasisPoints'],
  })
  .refine((body) => body.action !== 'ESCALATE' || !!body.priority, {
    message: 'A trustee request needs a priority',
    path: ['priority'],
  })
  .refine((body) => body.action === 'RELEASE' || (body.remarks?.length ?? 0) >= 3, {
    message: 'Say why, so the next person does not have to guess',
    path: ['remarks'],
  });
export type VerifyInvoiceRequest = z.infer<typeof verifyInvoiceRequest>;

export const invoiceListQuery = paginationQuery.merge(scopeQuery).extend({
  status: z
    .union([
      z.enum(INVOICE_STATUSES as [string, ...string[]]),
      z.array(z.enum(INVOICE_STATUSES as [string, ...string[]])),
    ])
    .optional(),
  vendorId: objectId.optional(),
  view: z
    .enum([
      'ALL',
      'REVIEW',
      'PENDING_APPROVAL',
      'ACCOUNTING',
      'TRUSTEE',
      'APPROVED',
      'PAYMENT_PENDING',
      'PAID',
      'OVERDUE',
    ])
    .optional(),
});
export type InvoiceListQuery = z.infer<typeof invoiceListQuery>;

/** Accounts payable views — PRD §16. */
export const payableListQuery = paginationQuery.merge(scopeQuery).extend({
  view: z
    .enum(['ALL', 'DUE_TODAY', 'DUE_THIS_WEEK', 'OVERDUE', 'APPROVED', 'PAYMENT_PENDING', 'PAID'])
    .default('ALL'),
  vendorId: objectId.optional(),
});
export type PayableListQuery = z.infer<typeof payableListQuery>;
