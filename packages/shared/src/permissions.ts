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
  'role:create',
  'role:update',
  'role:delete',

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

  // Mailbox connectors — a user's own Outlook, connected to pull invoices.
  // `manage` is deliberately one permission rather than a create/update/delete
  // set: there is exactly one connection per user and every action on it is the
  // same act of owning your own mailbox.
  'mail_connection:manage',
  'mail_connection:read_all',

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

/** The `resource` half of a `resource:action` permission. */
export function permissionResource(permission: Permission): string {
  return permission.slice(0, permission.indexOf(':'));
}

/** The `action` half of a `resource:action` permission. */
export function permissionAction(permission: Permission): string {
  return permission.slice(permission.indexOf(':') + 1);
}

/** Human names for each resource, used to head the permission picker. */
export const PERMISSION_RESOURCE_LABELS: Record<string, string> = {
  tenant: 'Tenant',
  company: 'Companies',
  location: 'Locations',
  department: 'Departments',
  user: 'Users',
  role: 'Roles',
  vendor: 'Vendors',
  bank_account: 'Bank accounts',
  invoice: 'Invoices',
  mail_connection: 'Mailbox connectors',
  approval_rule: 'Approval rules',
  approval: 'Approvals',
  payable: 'Accounts payable',
  payroll: 'Payroll',
  obligation: 'Payment obligations',
  payment_batch: 'Payment batches',
  bank_statement: 'Bank statements',
  bank_transaction: 'Bank transactions',
  reconciliation: 'Reconciliation',
  report: 'Reports',
  audit: 'Audit trail',
  dashboard: 'Dashboard',
  notification: 'Notifications',
};

export interface PermissionGroup {
  resource: string;
  label: string;
  permissions: Permission[];
}

/**
 * The catalogue arranged by resource, in declaration order.
 *
 * The role editor renders one checkbox group per entry, so this is what keeps
 * the picker and the enforced catalogue from drifting apart: a permission
 * added above shows up in the interface without further work.
 */
export const PERMISSION_GROUPS: PermissionGroup[] = buildPermissionGroups();

function buildPermissionGroups(): PermissionGroup[] {
  const groups = new Map<string, PermissionGroup>();
  for (const permission of PERMISSIONS) {
    const resource = permissionResource(permission);
    const group = groups.get(resource) ?? {
      resource,
      label: PERMISSION_RESOURCE_LABELS[resource] ?? resource.replace(/_/g, ' '),
      permissions: [],
    };
    group.permissions.push(permission);
    groups.set(resource, group);
  }
  return [...groups.values()];
}

const PERMISSION_SET: ReadonlySet<string> = new Set<string>(PERMISSIONS);

/** Narrows an arbitrary string — a request body, a stored role — to a known permission. */
export function isPermission(value: string): value is Permission {
  return PERMISSION_SET.has(value);
}

const ALL: Permission[] = [...PERMISSIONS];

const READ_ONLY: Permission[] = ALL.filter(
  (p) =>
    (p.endsWith(':read') || p.endsWith(':read_all') || p === 'report:export') &&
    // Oversight of colleagues' mailboxes is a deliberate grant, not something a
    // read-only role picks up from the `:read_all` suffix. An auditor reading
    // the subjects and senders of personal mail is a privacy decision, so it is
    // made explicitly per role rather than by naming convention.
    p !== 'mail_connection:read_all',
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
  // Matches `invoice:create`: whoever may create an invoice may connect their
  // own Outlook to pull them.
  'mail_connection:manage',
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
  'mail_connection:read_all',
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
  'role:create',
  'role:update',
  'role:delete',
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
  // Oversight only. A company admin cannot create invoices, so it never gets
  // `mail_connection:manage` — it can watch the connectors, not run them.
  'mail_connection:read_all',
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

/** True when the key names one of the roles built into the product. */
export function isSystemRoleKey(key: string): key is RoleKey {
  return key in ROLE_PERMISSIONS;
}

/**
 * Union of the permissions granted by a set of roles.
 *
 * `customGrants` carries the tenant's own roles, which are rows rather than
 * code; anything not found in either map grants nothing, so a role deleted
 * out from under a user silently narrows their access instead of widening it.
 */
export function permissionsForRoles(
  roleKeys: readonly string[],
  customGrants?: Readonly<Record<string, readonly Permission[]>>,
): Permission[] {
  const granted = new Set<Permission>();
  for (const key of roleKeys) {
    const fromRole = isSystemRoleKey(key) ? ROLE_PERMISSIONS[key] : (customGrants?.[key] ?? []);
    for (const permission of fromRole) granted.add(permission);
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
