import { z } from 'zod';
import { objectId, paginationQuery, scopeQuery } from './common.js';

export const uploadStatementRequest = z.object({
  companyId: objectId,
  bankAccountId: objectId,
  /** Optional override when header auto-detection fails. */
  mapping: z
    .object({
      transactionDate: z.string(),
      description: z.string(),
      reference: z.string().optional(),
      debit: z.string().optional(),
      credit: z.string().optional(),
      amount: z.string().optional(),
      balance: z.string().optional(),
    })
    .optional(),
});
export type UploadStatementRequest = z.infer<typeof uploadStatementRequest>;

export const transactionListQuery = paginationQuery.merge(scopeQuery).extend({
  bankAccountId: objectId.optional(),
  bankStatementId: objectId.optional(),
  direction: z.enum(['DEBIT', 'CREDIT']).optional(),
  reconciliationStatus: z.enum(['UNMATCHED', 'SUGGESTED', 'MATCHED', 'IGNORED']).optional(),
});

export const reconciliationListQuery = paginationQuery.merge(scopeQuery).extend({
  tab: z.enum(['MATCHED', 'SUGGESTED', 'UNMATCHED', 'IGNORED']).default('SUGGESTED'),
  bankAccountId: objectId.optional(),
});

export const confirmMatchRequest = z.object({
  bankTransactionId: objectId,
  obligationId: objectId,
  note: z.string().trim().max(500).optional(),
});
export type ConfirmMatchRequest = z.infer<typeof confirmMatchRequest>;

export const ignoreTransactionRequest = z.object({
  bankTransactionId: objectId,
  note: z.string().trim().min(3).max(500),
});

export const unmatchRequest = z.object({
  reconciliationId: objectId,
  note: z.string().trim().min(3).max(500),
});
