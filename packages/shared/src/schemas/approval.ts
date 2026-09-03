import { z } from 'zod';
import { ROLE_KEYS } from '../enums.js';
import { objectId, paginationQuery } from './common.js';

export const ruleCondition = z.object({
  field: z.enum(['amount', 'vendorId', 'departmentId', 'locationId', 'currency', 'employeeCount']),
  operator: z.enum(['eq', 'ne', 'gt', 'gte', 'lt', 'lte', 'in', 'nin', 'between']),
  value: z.unknown(),
});

export const ruleStep = z
  .object({
    order: z.number().int().min(1),
    approverType: z.enum(['ROLE', 'USER', 'DEPARTMENT_HEAD']),
    roleKey: z.enum(ROLE_KEYS as [string, ...string[]]).optional(),
    userId: objectId.optional(),
    label: z.string().trim().max(120).optional(),
    slaHours: z.number().int().min(1).max(720).optional(),
  })
  .refine((step) => step.approverType !== 'ROLE' || !!step.roleKey, {
    message: 'A ROLE step requires roleKey',
    path: ['roleKey'],
  })
  .refine((step) => step.approverType !== 'USER' || !!step.userId, {
    message: 'A USER step requires userId',
    path: ['userId'],
  });

export const createApprovalRuleRequest = z.object({
  companyId: objectId,
  name: z.string().trim().min(2).max(160),
  description: z.string().trim().max(500).optional(),
  appliesTo: z.enum(['VENDOR_INVOICE', 'PAYROLL_BATCH']),
  priority: z.number().int().min(0).max(1000).default(100),
  active: z.boolean().default(true),
  conditions: z.array(ruleCondition).max(20).default([]),
  steps: z.array(ruleStep).min(1, 'At least one approval step').max(10),
});
export type CreateApprovalRuleRequest = z.infer<typeof createApprovalRuleRequest>;

export const updateApprovalRuleRequest = createApprovalRuleRequest.omit({ companyId: true }).partial();

export const approvalActionRequest = z.object({
  action: z.enum(['APPROVE', 'REJECT']),
  comment: z.string().trim().max(1000).optional(),
});
export type ApprovalActionRequest = z.infer<typeof approvalActionRequest>;

export const approvalCommentRequest = z.object({
  comment: z.string().trim().min(1).max(1000),
});

export const approvalListQuery = paginationQuery.extend({
  companyId: objectId.optional(),
  subjectType: z.enum(['VENDOR_INVOICE', 'PAYROLL_BATCH']).optional(),
  status: z.enum(['PENDING', 'IN_PROGRESS', 'APPROVED', 'REJECTED', 'CANCELLED']).optional(),
  /** `MINE` restricts to requests where the caller is an eligible approver. */
  scope: z.enum(['MINE', 'ALL']).default('MINE'),
});
export type ApprovalListQuery = z.infer<typeof approvalListQuery>;
