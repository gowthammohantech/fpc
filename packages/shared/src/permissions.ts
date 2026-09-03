import { RoleKey } from './enums.js';

/**
 * Permission catalogue.
 *
 * Every protected API route names one of these, and the web/mobile clients
 * gate navigation on the same list, so the UI can never offer an action the
 * server will refuse.
 *
 * Format is `resource:action`.
 */
export const PERMISSIONS = [
  // Organisation & administration
  'tenant:manage',
  'company:read',
  'company:create',
  'company:update',
  'company:delete',
  'location:read',
  'location:create',
  'location:update',
  'location:delete',
  'department:read',
  'department:create',
  'department:update',
  'department:delete',
  'user:read',
  'user:create',
  'user:update',
  'user:delete',
  'role:read',
  'role:update',

  // Vendor master & company bank accounts
  'vendor:read',
  'vendor:create',
  'vendor:update',
  'vendor:delete',
  'bank_account:read',
  'bank_account:create',
  'bank_account:update',
  'bank_account:delete',

  // Invoices
  'invoice:read',
  'invoice:create',
  'invoice:update',
  'invoice:submit',
  'invoice:resolve_duplicate',
  'invoice:cancel',
  'invoice:delete',
  'invoice:approve',

  // Approvals
  'approval_rule:read',
  'approval_rule:create',
  'approval_rule:update',
  'approval_rule:delete',
  'approval:read',
  'approval:read_all',

  // Accounts payable
  'payable:read',

  // Payroll — deliberately separate from every other finance permission,
  // because salary data must not be visible to ordinary AP users (PRD §18).
  'payroll:read',
  'payroll:create',
  'payroll:update',
  'payroll:submit',
  'payroll:delete',
  'payroll:approve',

  // Payment pipeline
  'obligation:read',
  'obligation:update',
  'payment_batch:read',
  'payment_batch:create',
  'payment_batch:update',
  'payment_batch:export',
  'payment_batch:delete',

  // Banking
  'bank_statement:read',
  'bank_statement:create',
  'bank_statement:delete',
  'bank_transaction:read',

  // Reconciliation
  'reconciliation:read',
  'reconciliation:match',
  'reconciliation:confirm',
  'reconciliation:ignore',

  // Insight
  'report:read',
  'report:export',
  'audit:read',
  'dashboard:read',
  'notification:read',
] as const;

export type Permission = (typeof PERMISSIONS)[number];

const ALL: Permission[] = [...PERMISSIONS];

const READ_ONLY: Permission[] = ALL.filter(
  (p) => p.endsWith(':read') || p.endsWith(':read_all') || p === 'report:export',
);

/**
 * Finance Executive (PRD §7): prepares work but never approves it and never
 * sees payroll. Explicitly excludes `invoice:approve` and every `payroll:*`.
 */
const FINANCE_EXECUTIVE: Permission[] = [
  'company:read',
  'location:read',
  'department:read',
  'vendor:read',
  'vendor:create',
  'vendor:update',
  'bank_account:read',
  'invoice:read',
  'invoice:create',
  'invoice:update',
  'invoice:submit',
  'invoice:resolve_duplicate',
  'approval:read',
  'payable:read',
  'obligation:read',
  'payment_batch:read',
  'payment_batch:create',
  'payment_batch:update',
  'payment_batch:export',
  'bank_statement:read',
  'bank_statement:create',
  'bank_transaction:read',
  'reconciliation:read',
  'reconciliation:match',
  'reconciliation:confirm',
  'reconciliation:ignore',
  'report:read',
  'report:export',
  'dashboard:read',
  'notification:read',
];

const FINANCE_MANAGER: Permission[] = [
  ...FINANCE_EXECUTIVE,
  'invoice:approve',
  'invoice:cancel',
  'approval:read_all',
  'approval_rule:read',
  'obligation:update',
  'payment_batch:delete',
  'bank_statement:delete',
  'audit:read',
  'user:read',
];

const APPROVER: Permission[] = [
  'company:read',
  'location:read',
  'department:read',
  'vendor:read',
  'invoice:read',
  'invoice:approve',
  'approval:read',
  'payable:read',
  'dashboard:read',
  'notification:read',
  'report:read',
];

const CFO: Permission[] = [
  ...FINANCE_MANAGER,
  'payroll:read',
  'payroll:approve',
  'approval:read_all',
  'company:read',
  'audit:read',
  'approval_rule:read',
];

const PAYROLL_USER: Permission[] = [
  'company:read',
  'location:read',
  'department:read',
  'payroll:read',
  'payroll:create',
  'payroll:update',
  'payroll:submit',
  'payroll:delete',
  'approval:read',
  'dashboard:read',
  'notification:read',
  'report:read',
  'report:export',
];

const COMPANY_ADMIN: Permission[] = [
  'company:read',
  'company:create',
  'company:update',
  'company:delete',
  'location:read',
  'location:create',
  'location:update',
  'location:delete',
  'department:read',
  'department:create',
  'department:update',
  'department:delete',
  'user:read',
  'user:create',
  'user:update',
  'user:delete',
  'role:read',
  'role:update',
  'vendor:read',
  'vendor:create',
  'vendor:update',
  'vendor:delete',
  'bank_account:read',
  'bank_account:create',
  'bank_account:update',
  'bank_account:delete',
  'approval_rule:read',
  'approval_rule:create',
  'approval_rule:update',
  'approval_rule:delete',
  'approval:read_all',
  'invoice:read',
  'payable:read',
  'obligation:read',
  'payment_batch:read',
  'bank_statement:read',
  'bank_transaction:read',
  'reconciliation:read',
  'report:read',
  'report:export',
  'audit:read',
  'dashboard:read',
  'notification:read',
];

const AUDITOR: Permission[] = [...new Set([...READ_ONLY, 'audit:read' as Permission])];

/** Role → permission grants. Deduplicated and frozen. */
export const ROLE_PERMISSIONS: Record<RoleKey, Permission[]> = {
  [RoleKey.PLATFORM_ADMIN]: ALL,
  [RoleKey.COMPANY_ADMIN]: dedupe(COMPANY_ADMIN),
  [RoleKey.FINANCE_EXECUTIVE]: dedupe(FINANCE_EXECUTIVE),
  [RoleKey.FINANCE_MANAGER]: dedupe(FINANCE_MANAGER),
  [RoleKey.APPROVER]: dedupe(APPROVER),
  [RoleKey.CFO]: dedupe(CFO),
  [RoleKey.PAYROLL_USER]: dedupe(PAYROLL_USER),
  [RoleKey.AUDITOR]: dedupe(AUDITOR),
};

function dedupe(list: Permission[]): Permission[] {
  return [...new Set(list)];
}

/** Union of the permissions granted by a set of roles. */
export function permissionsForRoles(roleKeys: RoleKey[]): Permission[] {
  const granted = new Set<Permission>();
  for (const key of roleKeys) {
    for (const permission of ROLE_PERMISSIONS[key] ?? []) granted.add(permission);
  }
  return [...granted];
}

export function hasPermission(
  granted: readonly Permission[] | undefined,
  required: Permission,
): boolean {
  return !!granted?.includes(required);
}

export function hasAnyPermission(
  granted: readonly Permission[] | undefined,
  required: readonly Permission[],
): boolean {
  return required.some((permission) => hasPermission(granted, permission));
}

export function hasAllPermissions(
  granted: readonly Permission[] | undefined,
  required: readonly Permission[],
): boolean {
  return required.every((permission) => hasPermission(granted, permission));
}

/**
 * Roles allowed to see individual salary figures. Used by the payment queue to
 * decide whether payroll obligations are itemised or shown as one aggregate
 * line (PRD §18, §21).
 */
export const PAYROLL_VISIBILITY_PERMISSION: Permission = 'payroll:read';
