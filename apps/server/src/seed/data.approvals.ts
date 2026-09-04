import { RoleKey, toMinor } from '@fpc/shared';

/**
 * The PRD §15 approval ladders, seeded as data.
 *
 * Bands are expressed with `lte` / `gt` against the same boundary so that
 * ₹1,00,000 and ₹10,00,000 each fall in exactly one band.
 *
 * CONSTRAINT — do not break the flagship demo. The journeys test asserts that
 * INV-9821 (TechZone, IT, Chennai, ₹35,40,000) routes through the three-step
 * "Above ₹10L" rule. `evaluate` picks the matching rule with the highest
 * priority, so no other Nova Engineering VENDOR_INVOICE rule may both match
 * that context and sit at priority 30 or above. Every rule below is either
 * scoped to a different vendor/location, capped below ₹10L, or inactive.
 */

/** A condition value the writer resolves to an ObjectId at seed time. */
export interface ConditionRef {
  kind: 'vendor' | 'location' | 'department';
  /** Company-qualified key, e.g. `engineering:ZENITH`. */
  key: string;
}

export interface ApprovalRuleSeed {
  company: string;
  name: string;
  description: string;
  appliesTo: 'VENDOR_INVOICE' | 'PAYROLL_BATCH';
  priority: number;
  active?: boolean;
  conditions: Array<{
    field: string;
    operator: string;
    value?: unknown;
    ref?: ConditionRef;
  }>;
  steps: Array<{
    order: number;
    approverType: 'ROLE' | 'USER' | 'DEPARTMENT_HEAD';
    roleKey?: RoleKey;
    /** Resolved to a userId by the writer; USER steps only. */
    userEmail?: string;
    label?: string;
    slaHours?: number;
  }>;
}

export const APPROVAL_RULES: ApprovalRuleSeed[] = [
  // ── Nova Engineering: the PRD ladder ─────────────────────
  {
    company: 'engineering',
    name: 'Up to ₹1L — Finance Manager',
    description: 'Routine spend needs one finance approval.',
    appliesTo: 'VENDOR_INVOICE',
    priority: 10,
    conditions: [{ field: 'amount', operator: 'lte', value: toMinor(1_00_000) }],
    steps: [{ order: 1, approverType: 'ROLE', roleKey: RoleKey.FINANCE_MANAGER }],
  },
  {
    company: 'engineering',
    name: '₹1L to ₹10L — Department Head then Finance Manager',
    description: 'Mid-size spend needs the requesting department and finance.',
    appliesTo: 'VENDOR_INVOICE',
    priority: 20,
    conditions: [
      { field: 'amount', operator: 'gt', value: toMinor(1_00_000) },
      { field: 'amount', operator: 'lte', value: toMinor(10_00_000) },
    ],
    steps: [
      { order: 1, approverType: 'DEPARTMENT_HEAD', label: 'Department Head' },
      { order: 2, approverType: 'ROLE', roleKey: RoleKey.FINANCE_MANAGER },
    ],
  },
  {
    company: 'engineering',
    name: 'Above ₹10L — Department Head, Finance Head, CFO',
    description: 'Large spend needs three levels, ending with the CFO.',
    appliesTo: 'VENDOR_INVOICE',
    priority: 30,
    conditions: [{ field: 'amount', operator: 'gt', value: toMinor(10_00_000) }],
    steps: [
      { order: 1, approverType: 'DEPARTMENT_HEAD', label: 'Department Head' },
      {
        order: 2,
        approverType: 'ROLE',
        roleKey: RoleKey.FINANCE_MANAGER,
        label: 'Finance Head',
      },
      { order: 3, approverType: 'ROLE', roleKey: RoleKey.CFO },
    ],
  },

  // ── Nova Engineering: the rules the ladder alone cannot show ──
  {
    // Scoped to one vendor, so it cannot steal the TechZone chain. Names a
    // specific person rather than a role, and carries an SLA.
    company: 'engineering',
    name: 'Zenith Metals — straight to the CFO',
    description: 'A named approver for a single vendor, on a one-day SLA.',
    appliesTo: 'VENDOR_INVOICE',
    priority: 40,
    conditions: [
      { field: 'vendorId', operator: 'eq', ref: { kind: 'vendor', key: 'engineering:ZENITH' } },
    ],
    steps: [
      {
        order: 1,
        approverType: 'USER',
        userEmail: 'cfo@nova.example.com',
        label: 'CFO (named approver)',
        slaHours: 24,
      },
    ],
  },
  {
    // Scoped to Pune, so Chennai invoices are untouched.
    company: 'engineering',
    name: 'Pune operations above ₹1L — Department Head then Finance',
    description: 'Site spend is approved locally first, then by finance, against an SLA.',
    appliesTo: 'VENDOR_INVOICE',
    priority: 35,
    conditions: [
      { field: 'locationId', operator: 'eq', ref: { kind: 'location', key: 'engineering:PNQ' } },
      { field: 'amount', operator: 'gt', value: toMinor(1_00_000) },
    ],
    steps: [
      { order: 1, approverType: 'DEPARTMENT_HEAD', label: 'Department Head', slaHours: 8 },
      {
        order: 2,
        approverType: 'ROLE',
        roleKey: RoleKey.FINANCE_MANAGER,
        label: 'Finance Head',
        slaHours: 24,
      },
    ],
  },
  {
    // Uses `between`, and sits below the ₹10L rule so it cannot compete for it.
    company: 'engineering',
    name: 'IT spend between ₹50k and ₹1L — department gate',
    description: 'The IT department signs off its own mid-band spend.',
    appliesTo: 'VENDOR_INVOICE',
    priority: 15,
    conditions: [
      { field: 'departmentId', operator: 'eq', ref: { kind: 'department', key: 'engineering:IT' } },
      { field: 'amount', operator: 'between', value: [toMinor(50_000), toMinor(1_00_000)] },
    ],
    steps: [{ order: 1, approverType: 'DEPARTMENT_HEAD', label: 'IT Head' }],
  },
  {
    // Inactive, and at the highest priority in the company: proof that the
    // engine filters on `active` before it looks at priority at all.
    company: 'engineering',
    name: 'Legacy — every invoice to Finance (retired)',
    description: 'Superseded by the amount ladder. Kept to show a retired rule.',
    appliesTo: 'VENDOR_INVOICE',
    priority: 100,
    active: false,
    conditions: [],
    steps: [{ order: 1, approverType: 'ROLE', roleKey: RoleKey.FINANCE_MANAGER }],
  },
  {
    company: 'engineering',
    name: 'All payroll — CFO',
    // The Finance Head is deliberately not in this chain: payroll is walled off
    // from the rest of finance (PRD §18), so FINANCE_MANAGER holds neither
    // `payroll:read` nor `payroll:approve` and could never action the step.
    description: 'Every payroll run needs the CFO.',
    appliesTo: 'PAYROLL_BATCH',
    priority: 10,
    conditions: [],
    steps: [{ order: 1, approverType: 'ROLE', roleKey: RoleKey.CFO, label: 'CFO' }],
  },
  {
    // Same outcome as the rule above, so the flagship payroll journey is
    // unchanged; it exists to exercise the `employeeCount` condition field.
    company: 'engineering',
    name: 'Payroll over 500 employees — CFO',
    description: 'A large payroll run is explicitly routed to the CFO.',
    appliesTo: 'PAYROLL_BATCH',
    priority: 20,
    conditions: [{ field: 'employeeCount', operator: 'gt', value: 500 }],
    steps: [{ order: 1, approverType: 'ROLE', roleKey: RoleKey.CFO, label: 'CFO' }],
  },

  // ── Nova Technologies: its own, shorter ladder ───────────
  {
    company: 'technologies',
    name: 'Up to ₹5L — Finance Manager',
    description: 'A smaller company, so one finance approval covers more.',
    appliesTo: 'VENDOR_INVOICE',
    priority: 10,
    conditions: [{ field: 'amount', operator: 'lte', value: toMinor(5_00_000) }],
    steps: [{ order: 1, approverType: 'ROLE', roleKey: RoleKey.FINANCE_MANAGER }],
  },
  {
    company: 'technologies',
    name: 'Above ₹5L — Department Head then CFO',
    description: 'Anything larger goes to the department and then the CFO.',
    appliesTo: 'VENDOR_INVOICE',
    priority: 20,
    conditions: [{ field: 'amount', operator: 'gt', value: toMinor(5_00_000) }],
    steps: [
      { order: 1, approverType: 'DEPARTMENT_HEAD', label: 'Department Head', slaHours: 24 },
      { order: 2, approverType: 'ROLE', roleKey: RoleKey.CFO },
    ],
  },
  {
    company: 'technologies',
    name: 'All payroll — CFO',
    description: 'Every payroll run needs the CFO.',
    appliesTo: 'PAYROLL_BATCH',
    priority: 10,
    conditions: [],
    steps: [{ order: 1, approverType: 'ROLE', roleKey: RoleKey.CFO, label: 'CFO' }],
  },
];
