import { z } from 'zod';
import { PERMISSIONS } from '../permissions.js';
import { bankAccountNumber, gstin, ifsc, objectId } from './common.js';

/**
 * A role key: the eight built into the product plus whatever a tenant defines.
 *
 * Deliberately a pattern rather than an enum of `ROLE_KEYS` — custom roles are
 * rows, so the closed list moved to a database lookup in the route, which is
 * the only place that knows the tenant.
 */
export const roleKey = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z][A-Z0-9_]{1,39}$/, 'Role keys are uppercase letters, digits and underscores');

export const permission = z.enum(PERMISSIONS);

export const createCompanyRequest = z.object({
  name: z.string().trim().min(2).max(160),
  legalName: z.string().trim().max(200).optional(),
  gstin: gstin.optional().or(z.literal('')),
  cin: z.string().trim().max(40).optional(),
  invoiceInboxAddress: z.string().trim().email().optional().or(z.literal('')),
  baseCurrency: z.literal('INR').default('INR'),
});
export type CreateCompanyRequest = z.infer<typeof createCompanyRequest>;
export const updateCompanyRequest = createCompanyRequest.partial().extend({
  active: z.boolean().optional(),
});

export const createLocationRequest = z.object({
  companyId: objectId,
  name: z.string().trim().min(2).max(120),
  code: z.string().trim().min(1).max(20).toUpperCase(),
  city: z.string().trim().max(80).optional(),
  state: z.string().trim().max(80).optional(),
});
export type CreateLocationRequest = z.infer<typeof createLocationRequest>;
export const updateLocationRequest = createLocationRequest
  .omit({ companyId: true })
  .partial()
  .extend({ active: z.boolean().optional() });

export const createDepartmentRequest = z.object({
  companyId: objectId,
  name: z.string().trim().min(2).max(120),
  code: z.string().trim().min(1).max(20).toUpperCase(),
  headUserId: objectId.optional(),
});
export type CreateDepartmentRequest = z.infer<typeof createDepartmentRequest>;
export const updateDepartmentRequest = createDepartmentRequest
  .omit({ companyId: true })
  .partial()
  .extend({ active: z.boolean().optional() });

export const createUserRequest = z.object({
  name: z.string().trim().min(2).max(120),
  email: z.string().trim().toLowerCase().email(),
  password: z.string().min(10).optional(),
  roleKeys: z.array(roleKey).min(1, 'At least one role'),
  companyIds: z.array(objectId).default([]),
  locationIds: z.array(objectId).default([]),
  departmentIds: z.array(objectId).default([]),
});
export type CreateUserRequest = z.infer<typeof createUserRequest>;
export const updateUserRequest = createUserRequest.partial().extend({
  status: z.enum(['ACTIVE', 'INVITED', 'SUSPENDED']).optional(),
});

export const createRoleRequest = z.object({
  label: z.string().trim().min(2).max(60),
  /** Derived from the label when omitted, so the form only asks for a name. */
  key: roleKey.optional(),
  description: z.string().trim().max(240).optional(),
  permissions: z.array(permission).min(1, 'Select at least one permission'),
});
export type CreateRoleRequest = z.infer<typeof createRoleRequest>;

export const updateRoleRequest = createRoleRequest
  .omit({ key: true })
  .partial()
  .extend({ active: z.boolean().optional() });
export type UpdateRoleRequest = z.infer<typeof updateRoleRequest>;

export const createVendorRequest = z.object({
  companyId: objectId,
  code: z.string().trim().min(1).max(30).toUpperCase().optional(),
  name: z.string().trim().min(2).max(200),
  email: z.string().trim().toLowerCase().email().optional().or(z.literal('')),
  phone: z.string().trim().max(30).optional(),
  gstin: gstin.optional().or(z.literal('')),
  bankAccountNumber: bankAccountNumber.optional().or(z.literal('')),
  ifsc: ifsc.optional().or(z.literal('')),
  beneficiaryName: z.string().trim().max(200).optional(),
  paymentTermsDays: z.coerce.number().int().min(0).max(365).default(30),
  notes: z.string().trim().max(1000).optional(),
});
export type CreateVendorRequest = z.infer<typeof createVendorRequest>;
export const updateVendorRequest = createVendorRequest
  .omit({ companyId: true })
  .partial()
  .extend({
    status: z.enum(['ACTIVE', 'INACTIVE', 'BLOCKED']).optional(),
  });

export const createBankAccountRequest = z.object({
  companyId: objectId,
  label: z.string().trim().min(2).max(120),
  bankName: z.string().trim().min(2).max(120),
  accountNumber: bankAccountNumber,
  ifsc,
  currentBalance: z.number().int().default(0),
  bankFileFormat: z.enum(['HDFC', 'ICICI', 'GENERIC_CSV', 'GENERIC_XLSX']).default('GENERIC_XLSX'),
});
export type CreateBankAccountRequest = z.infer<typeof createBankAccountRequest>;
export const updateBankAccountRequest = createBankAccountRequest
  .omit({ companyId: true })
  .partial()
  .extend({ active: z.boolean().optional() });
