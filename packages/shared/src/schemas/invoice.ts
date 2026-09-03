import { z } from 'zod';
import { INVOICE_STATUSES } from '../enums.js';
import { isoDate, minorAmount, objectId, paginationQuery, scopeQuery } from './common.js';

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

export const invoiceListQuery = paginationQuery.merge(scopeQuery).extend({
  status: z
    .union([
      z.enum(INVOICE_STATUSES as [string, ...string[]]),
      z.array(z.enum(INVOICE_STATUSES as [string, ...string[]])),
    ])
    .optional(),
  vendorId: objectId.optional(),
  view: z
    .enum(['ALL', 'REVIEW', 'PENDING_APPROVAL', 'APPROVED', 'PAYMENT_PENDING', 'PAID', 'OVERDUE'])
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
