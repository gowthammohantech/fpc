import { z } from 'zod';

/** A Mongo ObjectId as it appears on the wire. */
export const objectId = z.string().regex(/^[a-f\d]{24}$/i, 'Invalid id');

export const isoDate = z
  .union([z.string(), z.date()])
  .transform((value) => (value instanceof Date ? value.toISOString() : value))
  .refine((value) => !Number.isNaN(Date.parse(value)), 'Invalid date');

/** Amounts cross the wire as integer minor units. */
export const minorAmount = z
  .number()
  .int('Amount must be an integer number of paise')
  .nonnegative('Amount cannot be negative');

export const signedMinorAmount = z.number().int();

export const ifsc = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z]{4}0[A-Z0-9]{6}$/, 'Invalid IFSC code');

export const gstin = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^\d{2}[A-Z]{5}\d{4}[A-Z]\d[A-Z\d]Z[A-Z\d]$/, 'Invalid GSTIN');

export const bankAccountNumber = z
  .string()
  .trim()
  .min(5, 'Account number is too short')
  .max(34, 'Account number is too long')
  .regex(/^[A-Za-z0-9]+$/, 'Account number must be alphanumeric');

export const paginationQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(25),
  sort: z.string().optional(),
  order: z.enum(['asc', 'desc']).default('desc'),
});
export type PaginationQuery = z.infer<typeof paginationQuery>;

/** Filter axes available on every operational screen (PRD §33). */
export const scopeQuery = z.object({
  companyId: objectId.optional(),
  locationId: objectId.optional(),
  departmentId: objectId.optional(),
  dateFrom: z.string().optional(),
  dateTo: z.string().optional(),
  minAmount: z.coerce.number().int().optional(),
  maxAmount: z.coerce.number().int().optional(),
  q: z.string().trim().max(200).optional(),
});
export type ScopeQuery = z.infer<typeof scopeQuery>;
