import { z } from 'zod';
import { PAYROLL_BATCH_STATUSES } from '../enums.js';
import { objectId, paginationQuery } from './common.js';

/**
 * Column mapping from the uploaded sheet to our fields. The importer
 * auto-detects these from the header row; the UI lets finance override before
 * committing the import.
 */
export const payrollColumnMapping = z.object({
  employeeCode: z.string().min(1),
  employeeName: z.string().min(1),
  bankAccountNumber: z.string().min(1),
  ifsc: z.string().min(1),
  netAmount: z.string().min(1),
  department: z.string().optional(),
  location: z.string().optional(),
  email: z.string().optional(),
});
export type PayrollColumnMapping = z.infer<typeof payrollColumnMapping>;

export const createPayrollBatchRequest = z.object({
  companyId: objectId,
  label: z.string().trim().min(2).max(120),
  periodMonth: z.coerce.number().int().min(1).max(12),
  periodYear: z.coerce.number().int().min(2000).max(2100),
  mapping: payrollColumnMapping.optional(),
});
export type CreatePayrollBatchRequest = z.infer<typeof createPayrollBatchRequest>;

export const payrollListQuery = paginationQuery.extend({
  companyId: objectId.optional(),
  status: z.enum(PAYROLL_BATCH_STATUSES as [string, ...string[]]).optional(),
  periodYear: z.coerce.number().int().optional(),
});

export const payrollEmployeeListQuery = paginationQuery.extend({
  locationId: objectId.optional(),
  q: z.string().trim().max(120).optional(),
  onlyWithFindings: z.coerce.boolean().optional(),
});
