import { z } from 'zod';
import { isoDate, objectId, paginationQuery, scopeQuery } from './common.js';

export const paymentQueueQuery = paginationQuery.merge(scopeQuery).extend({
  type: z.enum(['VENDOR', 'PAYROLL']).optional(),
  paymentStatus: z
    .enum(['PENDING', 'QUEUED', 'BATCHED', 'PROCESSING', 'PAID', 'FAILED', 'ON_HOLD', 'CANCELLED'])
    .optional(),
  dueBefore: z.string().optional(),
});
export type PaymentQueueQuery = z.infer<typeof paymentQueueQuery>;

export const createPaymentBatchRequest = z.object({
  companyId: objectId,
  paymentDate: isoDate,
  bankAccountId: objectId.optional(),
  bankFileFormat: z.enum(['HDFC', 'ICICI', 'GENERIC_CSV', 'GENERIC_XLSX']).optional(),
  obligationIds: z.array(objectId).min(1, 'Select at least one payment'),
  notes: z.string().trim().max(500).optional(),
});
export type CreatePaymentBatchRequest = z.infer<typeof createPaymentBatchRequest>;

export const updatePaymentBatchRequest = z.object({
  paymentDate: isoDate.optional(),
  bankAccountId: objectId.optional(),
  bankFileFormat: z.enum(['HDFC', 'ICICI', 'GENERIC_CSV', 'GENERIC_XLSX']).optional(),
  notes: z.string().trim().max(500).optional(),
  addObligationIds: z.array(objectId).optional(),
  removeObligationIds: z.array(objectId).optional(),
});

export const paymentBatchListQuery = paginationQuery.extend({
  companyId: objectId.optional(),
  status: z
    .enum([
      'DRAFT',
      'READY',
      'EXPORTED',
      'PROCESSING',
      'COMPLETED',
      'PARTIALLY_RECONCILED',
      'RECONCILED',
      'CANCELLED',
    ])
    .optional(),
});

export const holdObligationRequest = z.object({
  hold: z.boolean(),
  reason: z.string().trim().max(500).optional(),
});
